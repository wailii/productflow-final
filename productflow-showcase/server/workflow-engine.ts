import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import fs from "fs";
import path from "path";
import {
  appendAgentAction,
  appendWorkflowArtifact,
  finishAgentRun,
  getAgentContextAssetsWithUrls,
  getAgentContextArtifacts,
  getWorkflowStepsByProjectId,
  startAgentRun,
  updateAgentRunProgress,
} from "./db-helpers";
import type { MessageContent } from "./_core/llm";
import { getLocalStorageDirectory } from "./storage";

/**
 * AI 工作流引擎（Agent Runtime v2）
 * 核心能力：
 * 1) 显式阶段状态机（context -> plan -> draft/review loop -> final）
 * 2) 评审驱动的迭代闭环（最多 N 轮，达到质量阈值后收敛）
 * 3) 每轮状态快照持久化，便于后续可观测与恢复
 */

const AGENT_STRATEGY = "agent-v2";
const AGENT_MAX_ITERATIONS = ENV.agentMaxIterations;
const AGENT_PASS_SCORE = ENV.agentPassScore;

// 定义每个步骤的 Prompt 模板
const STEP_PROMPTS = {
  0: {
    name: "需求预处理与澄清",
    systemPrompt: `# Role: 需求澄清专家

## Profile
- Author: Manus
- Version: 1.0
- Language: Chinese
- Description: 你是一个经验丰富的产品需求分析专家，尤其擅长处理模糊、不完整、甚至充满矛盾的原始需求。你的任务不是直接进行需求分析，而是通过与用户的互动，将这些"垃圾输入"净化为一份结构清晰、无歧义的"需求澄清文档"。

## Rules
1. **永不猜测**：如果信息模糊，你的第一反应是"提问"，而不是"猜测"。
2. **遵循四步法**：严格按照"初步诊断 → 生成问卷 → 生成初稿 → 最终确认"的流程工作。
3. **强制停止**：在"生成问卷"和"生成初稿"后，必须停止并等待用户输入。
4. **用户友好**：向用户提问时，必须友好、清晰，并尽可能提供选项。

## Workflow
### IF (初次接收到原始需求)
1. **执行步骤 0.1**：在内心默读并分析原始需求，根据"需求模糊性检查清单"生成一份内部的"问题列表"。
2. **执行步骤 0.2**：将"问题列表"转化为一份面向用户的澄清问卷，然后停止，等待用户回答。

## Output Format
- **澄清问卷**：使用 Markdown 的标题、列表和引用格式。
- **需求澄清文档**：严格遵循"需求澄清文档模板"的结构。`,
    userPromptTemplate: (rawRequirement: string) =>
      `请分析以下原始需求，生成澄清问卷：\n\n${rawRequirement}`,
  },
  1: {
    name: "原始需求提炼",
    systemPrompt: `# Gem1（需求提炼）

## 角色定位
你是一位需求分析专家，专注于把模糊的需求讲清楚。你的核心职责是：用对话式的讲解，帮产品经理理解"真正要做什么"，然后输出一份清晰的业务需求清单。

## 工作流程
### 第 1 步：快速诊断
判断需求类型（战略需求 vs 普通需求）和信息完整度

### 第 2 步：信息收集
根据需求类型调整处理方式

### 第 3 步：对话式讲解
用口语化的方式，帮产品经理理解"真正要做什么"

### 第 4 步：输出结构化的业务需求清单
包含：需求概览、用户画像、现有方案分析、项目目标、业务需求清单、优先级划分

## 禁止行为
- 不输出功能列表（那是 Gem2 的事）
- 不输出技术方案
- 不输出风险分析
- 不做无意义的肯定
- 不接受"用户说要，所以我们就做"的逻辑，要理解背后的原因`,
    userPromptTemplate: (clarifiedRequirement: string) =>
      `基于以下澄清后的需求，进行需求提炼：\n\n${clarifiedRequirement}`,
  },
  2: {
    name: "需求转功能列表",
    systemPrompt: `# Gem2（需求转功能列表）

你是功能设计专家，负责将业务需求转化为具体的功能列表。

## 核心职责
1. 将业务需求转化为可实现的功能模块
2. 为每个功能定义清晰的边界和职责
3. 识别功能之间的依赖关系
4. 输出结构化的功能列表

## 输出格式
每个功能包含：
- 功能名称
- 功能描述
- 用户价值
- 优先级（P0/P1/P2）
- 依赖关系`,
    userPromptTemplate: (businessRequirements: string) =>
      `基于以下业务需求，生成功能列表：\n\n${businessRequirements}`,
  },
  3: {
    name: "功能设计细化",
    systemPrompt: `# Gem2.5（功能设计细化）

你是功能设计专家，负责将功能列表细化为详细的功能设计文档。

## 核心职责
1. 为每个功能定义详细的交互流程
2. 定义数据结构和字段
3. 识别边界条件和异常情况
4. 输出详细的功能设计文档

## 输出格式
每个功能包含：
- 功能场景说明
- 数据字典
- 交互流程
- 边界条件`,
    userPromptTemplate: (functionList: string) =>
      `基于以下功能列表，进行功能设计细化：\n\n${functionList}`,
  },
  4: {
    name: "AI 原型提示词优化",
    systemPrompt: `# Motif Prompt Optimizer

你是 AI 原型工具的提示词优化专家，负责将功能设计转化为适合 AI 原型工具（如 Motiff、Ready、Galileo AI 等）的提示词。

## 核心职责
1. 提取功能设计中的关键视觉元素
2. 转化为清晰、具体的提示词
3. 包含布局、交互、样式等细节
4. 输出优化后的提示词

## 输出格式
每个页面/组件包含：
- 页面名称
- 布局描述
- 组件列表
- 交互说明
- 样式建议`,
    userPromptTemplate: (functionDesign: string) =>
      `基于以下功能设计，生成 AI 原型工具的提示词：\n\n${functionDesign}`,
  },
  5: {
    name: "原型设计",
    systemPrompt: `# Gem3（原型设计）

你是原型设计指导专家，负责指导用户使用 AI 原型工具生成原型。

## 核心职责
1. 提供原型设计的最佳实践
2. 推荐合适的 AI 原型工具（Motiff、Ready、Galileo AI、Figma AI 等）
3. 指导用户如何使用提示词生成原型
4. 提供原型迭代的建议

## 输出格式
- 推荐的 AI 原型工具
- 使用步骤
- 提示词使用建议
- 迭代优化建议`,
    userPromptTemplate: (optimizedPrompts: string) =>
      `基于以下优化后的提示词，指导用户进行原型设计：\n\n${optimizedPrompts}`,
  },
  6: {
    name: "需求确认与调整",
    systemPrompt: `# Gem3.5（需求确认与调整）

你是需求确认专家，负责帮助用户确认和调整需求。

## 核心职责
1. 检查需求的完整性和一致性
2. 识别潜在的遗漏和矛盾
3. 提供调整建议
4. 输出确认清单

## 输出格式
- 完整性检查清单
- 一致性检查清单
- 潜在问题列表
- 调整建议`,
    userPromptTemplate: (prototypeInfo: string) =>
      `基于以下原型信息，进行需求确认与调整：\n\n${prototypeInfo}`,
  },
  7: {
    name: "功能性需求文档",
    systemPrompt: `# Gem4（功能性需求文档）

你是 PRD 文档专家，负责生成完整的功能性需求文档。

## 核心职责
1. 整合前面所有步骤的输出
2. 生成结构化的 PRD 文档
3. 包含功能描述、数据字典、交互流程等
4. 输出符合行业标准的 PRD

## 输出格式
- 项目概述
- 功能列表
- 功能详细设计
- 数据字典
- 交互流程
- 非功能性需求`,
    userPromptTemplate: (confirmedRequirements: string) =>
      `基于以下确认后的需求，生成功能性需求文档：\n\n${confirmedRequirements}`,
  },
  8: {
    name: "补充章节生成",
    systemPrompt: `# 补充章节生成

你是 PRD 文档完善专家，负责补充 PRD 文档中的其他章节。

## 核心职责
1. 补充非功能性需求（性能、安全、兼容性等）
2. 补充项目背景和目标
3. 补充术语表和参考文档
4. 输出完整的 PRD 文档

## 输出格式
- 非功能性需求
- 项目背景
- 术语表
- 参考文档
- 附录`,
    userPromptTemplate: (functionalRequirements: string) =>
      `基于以下功能性需求文档，补充其他章节：\n\n${functionalRequirements}`,
  },
};

type AgentPlan = {
  objective: string;
  deliverables: string[];
  executionPlan: string[];
  qualityGate: string[];
  riskWatchlist: string[];
};

type AgentIssue = {
  severity: "high" | "medium" | "low";
  issue: string;
  fix: string;
};

type AgentReview = {
  score: number;
  verdict: "pass" | "revise" | "block";
  summary: string;
  issues: AgentIssue[];
  missingInformation: string[];
};

export type ChangeIntentType =
  | "copy_edit"
  | "ux_tweak"
  | "feature_adjustment"
  | "new_feature"
  | "scope_change"
  | "technical_constraint";

export type ChangeImpactAnalysis = {
  intentType: ChangeIntentType;
  recommendedStartStep: number;
  impactedSteps: number[];
  reason: string;
  risks: string[];
  conflicts: string[];
  actionPlan: string[];
  summary: string;
};

type AgentContextAsset = {
  id: number;
  assetType: "document" | "image" | "prototype" | "other";
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  note: string | null;
  sourceLabel: string | null;
  url: string | null;
};

function readChoiceText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (part && typeof part === "object" && "type" in part) {
        const typed = part as { type?: string; text?: string };
        if (typed.type === "text" && typed.text) return typed.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

function isReviewPassed(review: AgentReview | null): boolean {
  if (!review) return false;
  const hasHighIssue = review.issues.some((item) => item.severity === "high");
  return review.verdict === "pass" && review.score >= AGENT_PASS_SCORE && !hasHighIssue;
}

function summarizeInput(input: Record<string, any>) {
  const inputText = input.text || input.rawRequirement || JSON.stringify(input);
  return String(inputText).slice(0, 5000);
}

function summarizeConversation(
  history: Array<{ role: string; content: string }> | undefined
) {
  if (!history || history.length === 0) return "无";
  return history
    .slice(-10)
    .map((item, idx) => `${idx + 1}. [${item.role}] ${item.content}`)
    .join("\n")
    .slice(0, 5000);
}

function summarizePreviousStepOutputs(
  steps: Array<{ stepNumber: number; output: Record<string, any> | null | undefined }>,
  currentStepNumber: number
): string {
  const snippets = steps
    .filter((step) => step.stepNumber < currentStepNumber && step.output)
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .map((step) => {
      const title = getStepName(step.stepNumber);
      const raw = step.output?.text || JSON.stringify(step.output);
      const excerpt = String(raw).slice(0, 900);
      return `Step ${step.stepNumber + 1} ${title}:\n${excerpt}`;
    });

  if (snippets.length === 0) return "无";
  return snippets.join("\n\n").slice(0, 7000);
}

function summarizeAllStepOutputs(
  steps: Array<{ stepNumber: number; output: Record<string, any> | null | undefined }>
): string {
  const snippets = steps
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .map((step) => {
      const title = getStepName(step.stepNumber);
      const raw = step.output?.text || JSON.stringify(step.output ?? {});
      const excerpt = String(raw).slice(0, 650);
      return `Step ${step.stepNumber + 1} ${title}:\n${excerpt}`;
    });

  if (snippets.length === 0) return "无";
  return snippets.join("\n\n").slice(0, 9000);
}

function summarizeArtifactContext(
  artifacts: Array<{
    stepNumber: number | null;
    artifactType: string;
    title: string;
    content: string;
    createdAt: Date;
  }>
): string {
  if (artifacts.length === 0) return "无";

  return artifacts
    .slice(0, 24)
    .map((item, index) => {
      const stepLabel =
        typeof item.stepNumber === "number" ? `Step ${item.stepNumber + 1}` : "全局";
      const excerpt = item.content.slice(0, 320);
      return `${index + 1}. [${item.artifactType}] ${stepLabel} ${item.title}\n${excerpt}`;
    })
    .join("\n\n")
    .slice(0, 7000);
}

function summarizeModelAssets(assets: AgentContextAsset[]): string {
  if (assets.length === 0) return "无";
  return assets
    .slice(0, 20)
    .map((asset, index) => {
      return `${index + 1}. [${asset.assetType}] ${asset.fileName} (${asset.mimeType}, ${asset.fileSize} bytes)${
        asset.note ? `\n说明: ${asset.note}` : ""
      }`;
    })
    .join("\n")
    .slice(0, 5000);
}

function isTextLikeMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return (
    lower.startsWith("text/") ||
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("yaml") ||
    lower.includes("csv")
  );
}

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

function resolveLocalAssetPath(storageKey: string): string | null {
  const root = getLocalStorageDirectory();
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

function readLocalTextExcerpt(storageKey: string, limit = 4000): string | null {
  const filePath = resolveLocalAssetPath(storageKey);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text.slice(0, limit);
  } catch {
    return null;
  }
}

function readLocalImageAsDataUrl(storageKey: string, mimeType: string): string | null {
  const filePath = resolveLocalAssetPath(storageKey);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const bytes = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function buildAssetMessageContext(assets: AgentContextAsset[]): {
  parts: MessageContent[];
  textHints: string[];
} {
  const parts: MessageContent[] = [];
  const textHints: string[] = [];

  for (const asset of assets.slice(0, 8)) {
    const remoteUrl =
      asset.url && /^https?:\/\//i.test(asset.url) ? asset.url : null;

    if (remoteUrl) {
      if (isImageMime(asset.mimeType)) {
        parts.push({
          type: "image_url",
          image_url: { url: remoteUrl, detail: "auto" },
        });
      } else {
        parts.push({
          type: "file_url",
          file_url: {
            url: remoteUrl,
            mime_type: asset.mimeType,
          },
        });
      }
      continue;
    }

    if (isImageMime(asset.mimeType) && asset.fileSize <= 3 * 1024 * 1024) {
      const dataUrl = readLocalImageAsDataUrl(asset.storageKey, asset.mimeType);
      if (dataUrl) {
        parts.push({
          type: "image_url",
          image_url: { url: dataUrl, detail: "auto" },
        });
        continue;
      }
    }

    if (isTextLikeMime(asset.mimeType) && asset.fileSize <= 2 * 1024 * 1024) {
      const excerpt = readLocalTextExcerpt(asset.storageKey, 3000);
      if (excerpt) {
        textHints.push(`文件 ${asset.fileName} 摘要:\n${excerpt}`);
        continue;
      }
    }

    textHints.push(
      `文件 ${asset.fileName} (${asset.mimeType}) 无法直接解析为可读文本，请结合标题和说明审阅。`
    );
  }

  return { parts, textHints };
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("模型返回为空，无法解析 JSON");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate) as T;
    }
    throw new Error("模型返回不是合法 JSON");
  }
}

type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string | MessageContent[];
};

async function invokeText(
  messages: AgentMessage[],
  maxTokens?: number
) {
  const response = await invokeLLM({ messages, maxTokens: maxTokens ?? 6000 });
  return readChoiceText(response.choices[0]?.message?.content).trim();
}

async function invokeStructured<T>(
  messages: AgentMessage[],
  schemaName: string,
  schema: Record<string, unknown>,
  maxTokens?: number
): Promise<T> {
  try {
    const response = await invokeLLM({
      messages,
      maxTokens: maxTokens ?? 2200,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          schema,
          strict: true,
        },
      },
    });

    const text = readChoiceText(response.choices[0]?.message?.content).trim();
    return parseJsonObject<T>(text);
  } catch {
    // fallback：兼容部分模型对 response_format 能力不完整的情况
    const fallbackText = await invokeText([
      ...messages,
      {
        role: "user",
        content: "请仅输出合法 JSON，不要输出 Markdown 或解释。",
      },
    ], maxTokens ?? 2200);
    return parseJsonObject<T>(fallbackText);
  }
}

function normalizePlan(raw: AgentPlan): AgentPlan {
  return {
    objective: raw.objective || "完成当前步骤并交付可执行结果",
    deliverables: Array.isArray(raw.deliverables) ? raw.deliverables.slice(0, 8) : [],
    executionPlan: Array.isArray(raw.executionPlan) ? raw.executionPlan.slice(0, 8) : [],
    qualityGate: Array.isArray(raw.qualityGate) ? raw.qualityGate.slice(0, 8) : [],
    riskWatchlist: Array.isArray(raw.riskWatchlist) ? raw.riskWatchlist.slice(0, 8) : [],
  };
}

function normalizeReview(raw: AgentReview): AgentReview {
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .map((item) => ({
          severity:
            item?.severity === "high" || item?.severity === "medium" || item?.severity === "low"
              ? item.severity
              : "medium",
          issue: item?.issue ? String(item.issue) : "未提供问题描述",
          fix: item?.fix ? String(item.fix) : "未提供修改建议",
        }))
        .slice(0, 10)
    : [];

  return {
    score: clampScore(raw.score),
    verdict:
      raw.verdict === "pass" || raw.verdict === "revise" || raw.verdict === "block"
        ? raw.verdict
        : "revise",
    summary: raw.summary ? String(raw.summary) : "未提供审查摘要",
    issues,
    missingInformation: Array.isArray(raw.missingInformation)
      ? raw.missingInformation.map(String).slice(0, 8)
      : [],
  };
}

function normalizeChangeAnalysis(raw: ChangeImpactAnalysis): ChangeImpactAnalysis {
  const normalizedIntent: ChangeIntentType =
    raw.intentType === "copy_edit" ||
    raw.intentType === "ux_tweak" ||
    raw.intentType === "feature_adjustment" ||
    raw.intentType === "new_feature" ||
    raw.intentType === "scope_change" ||
    raw.intentType === "technical_constraint"
      ? raw.intentType
      : "feature_adjustment";

  const recommendedStartStep = Math.max(
    0,
    Math.min(8, Number.isFinite(raw.recommendedStartStep) ? Math.round(raw.recommendedStartStep) : 0)
  );

  const impactedSteps = Array.isArray(raw.impactedSteps)
    ? Array.from(
        new Set(
          raw.impactedSteps
            .map((step) => Number(step))
            .filter((step) => Number.isInteger(step) && step >= 0 && step <= 8)
        )
      ).sort((a, b) => a - b)
    : [];

  return {
    intentType: normalizedIntent,
    recommendedStartStep,
    impactedSteps: impactedSteps.length > 0 ? impactedSteps : [recommendedStartStep],
    reason: raw.reason ? String(raw.reason) : "未提供原因",
    risks: Array.isArray(raw.risks) ? raw.risks.map(String).slice(0, 12) : [],
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts.map(String).slice(0, 12) : [],
    actionPlan: Array.isArray(raw.actionPlan) ? raw.actionPlan.map(String).slice(0, 12) : [],
    summary: raw.summary ? String(raw.summary) : "未提供摘要",
  };
}

function formatPlan(plan: AgentPlan): string {
  const lines: string[] = [];
  lines.push(`目标：${plan.objective}`);
  lines.push("\n交付物：");
  for (const item of plan.deliverables) {
    lines.push(`- ${item}`);
  }
  lines.push("\n执行计划：");
  for (const item of plan.executionPlan) {
    lines.push(`- ${item}`);
  }
  lines.push("\n质量门槛：");
  for (const item of plan.qualityGate) {
    lines.push(`- ${item}`);
  }
  if (plan.riskWatchlist.length > 0) {
    lines.push("\n风险观察：");
    for (const item of plan.riskWatchlist) {
      lines.push(`- ${item}`);
    }
  }
  return lines.join("\n");
}

function formatReview(review: AgentReview): string {
  const lines: string[] = [];
  lines.push(`评分：${review.score}`);
  lines.push(`结论：${review.verdict}`);
  lines.push(`摘要：${review.summary}`);

  lines.push("\n问题清单：");
  if (review.issues.length === 0) {
    lines.push("- 无");
  } else {
    for (const issue of review.issues) {
      lines.push(`- [${issue.severity}] ${issue.issue}`);
      lines.push(`  修复：${issue.fix}`);
    }
  }

  lines.push("\n缺失信息：");
  if (review.missingInformation.length === 0) {
    lines.push("- 无");
  } else {
    for (const missing of review.missingInformation) {
      lines.push(`- ${missing}`);
    }
  }

  return lines.join("\n");
}

async function generatePlan(input: {
  systemPrompt: string;
  taskPrompt: string;
  historySummary: string;
  previousOutputSummary: string;
  artifactsSummary: string;
  assetSummary: string;
  assetTextHints: string[];
  assetParts: MessageContent[];
}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["objective", "deliverables", "executionPlan", "qualityGate", "riskWatchlist"],
    properties: {
      objective: { type: "string" },
      deliverables: { type: "array", items: { type: "string" } },
      executionPlan: { type: "array", items: { type: "string" } },
      qualityGate: { type: "array", items: { type: "string" } },
      riskWatchlist: { type: "array", items: { type: "string" } },
    },
  } as const;

  const result = await invokeStructured<AgentPlan>(
    [
      {
        role: "system",
        content: `${input.systemPrompt}\n\n你是 Agent 的规划模块。只负责生成执行计划与质量门槛。`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `任务指令:\n${input.taskPrompt}`,
              `历史对话:\n${input.historySummary}`,
              `历史步骤输出摘要:\n${input.previousOutputSummary}`,
              `历史流程资产摘要:\n${input.artifactsSummary}`,
              `已上传文件摘要:\n${input.assetSummary}`,
              input.assetTextHints.length > 0
                ? `可读文件内容摘录:\n${input.assetTextHints.join("\n\n")}`
                : "",
              "请结合上传的文件/图片生成结构化计划。",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          ...input.assetParts,
        ],
      },
    ],
    "agent_plan",
    schema,
    2200
  );

  return normalizePlan(result);
}

async function generateDraft(input: {
  systemPrompt: string;
  taskPrompt: string;
  plan: AgentPlan;
  previousOutputSummary: string;
  artifactsSummary: string;
  assetSummary: string;
  assetTextHints: string[];
  assetParts: MessageContent[];
  historySummary: string;
  iteration: number;
  lastReview: AgentReview | null;
}) {
  const reviewHints = input.lastReview
    ? `上一轮审查结论:\n${formatReview(input.lastReview)}`
    : "这是第一轮执行，无上一轮审查结论。";

  return invokeText([
    {
      role: "system",
      content: input.systemPrompt,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `当前是第 ${input.iteration} 轮执行。`,
            `任务指令:\n${input.taskPrompt}`,
            `执行计划:\n${formatPlan(input.plan)}`,
            `历史步骤输出摘要:\n${input.previousOutputSummary}`,
            `历史流程资产摘要:\n${input.artifactsSummary}`,
            `已上传文件摘要:\n${input.assetSummary}`,
            input.assetTextHints.length > 0
              ? `可读文件内容摘录:\n${input.assetTextHints.join("\n\n")}`
              : "",
            `历史对话:\n${input.historySummary}`,
            reviewHints,
            "请直接输出当前轮完整结果正文，不要解释你的思考过程。",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
        ...input.assetParts,
      ],
    },
  ], 6500);
}

async function reviewDraft(input: {
  taskPrompt: string;
  draft: string;
  plan: AgentPlan;
}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["score", "verdict", "summary", "issues", "missingInformation"],
    properties: {
      score: { type: "number" },
      verdict: { type: "string", enum: ["pass", "revise", "block"] },
      summary: { type: "string" },
      missingInformation: { type: "array", items: { type: "string" } },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "issue", "fix"],
          properties: {
            severity: { type: "string", enum: ["high", "medium", "low"] },
            issue: { type: "string" },
            fix: { type: "string" },
          },
        },
      },
    },
  } as const;

  const result = await invokeStructured<AgentReview>(
    [
      {
        role: "system",
        content:
          "你是严苛的质量审查 Agent。你必须根据任务目标和计划检查完整性、准确性、可执行性与一致性。",
      },
      {
        role: "user",
        content: [
          `原始任务:\n${input.taskPrompt}`,
          `执行计划:\n${formatPlan(input.plan)}`,
          `待审查草稿:\n${input.draft}`,
          "请给出审查评分与可执行修改建议。",
        ].join("\n\n"),
      },
    ],
    "agent_review",
    schema,
    2200
  );

  return normalizeReview(result);
}

async function finalizeOutput(input: {
  systemPrompt: string;
  taskPrompt: string;
  plan: AgentPlan;
  draft: string;
  review: AgentReview | null;
  artifactsSummary: string;
  assetSummary: string;
  assetTextHints: string[];
  assetParts: MessageContent[];
}) {
  const reviewBlock = input.review
    ? `审查结果:\n${formatReview(input.review)}`
    : "无审查结果。";

  return invokeText([
    { role: "system", content: input.systemPrompt },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `任务指令:\n${input.taskPrompt}`,
            `执行计划:\n${formatPlan(input.plan)}`,
            `历史流程资产摘要:\n${input.artifactsSummary}`,
            `已上传文件摘要:\n${input.assetSummary}`,
            input.assetTextHints.length > 0
              ? `可读文件内容摘录:\n${input.assetTextHints.join("\n\n")}`
              : "",
            `当前草稿:\n${input.draft}`,
            reviewBlock,
            "请输出最终版本，要求结构清晰、内容完整、可直接交付；不要输出过程说明。",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
        ...input.assetParts,
      ],
    },
  ], 6500);
}

/**
 * 执行指定步骤的 Agent 生成（Agent Runtime v2）
 */
export async function executeWorkflowStep(
  projectId: number,
  stepNumber: number,
  input: Record<string, any>,
  conversationHistory?: Array<{ role: string; content: string }>
): Promise<{ success: boolean; output?: Record<string, any>; error?: string }> {
  const stepConfig = STEP_PROMPTS[stepNumber as keyof typeof STEP_PROMPTS];
  if (!stepConfig) {
    return { success: false, error: `Invalid step number: ${stepNumber}` };
  }

  const inputText = summarizeInput(input);
  const userPrompt = stepConfig.userPromptTemplate(inputText);
  const historySummary = summarizeConversation(conversationHistory);

  let runId: number | null = null;
  let iteration = 0;
  let plan: AgentPlan | null = null;
  let lastReview: AgentReview | null = null;
  let bestScore = 0;

  try {
    const previousSteps = await getWorkflowStepsByProjectId(projectId);
    const previousOutputSummary = summarizePreviousStepOutputs(previousSteps, stepNumber);
    const contextArtifacts = await getAgentContextArtifacts(projectId, stepNumber, 80);
    const artifactsSummary = summarizeArtifactContext(contextArtifacts);
    const contextAssets = await getAgentContextAssetsWithUrls(projectId, stepNumber, 18);
    const assetsSummary = summarizeModelAssets(contextAssets as AgentContextAsset[]);
    const { parts: assetParts, textHints: assetTextHints } = buildAssetMessageContext(
      contextAssets as AgentContextAsset[]
    );

    const run = await startAgentRun(projectId, stepNumber, AGENT_STRATEGY);
    runId = run.id;

    await updateAgentRunProgress({
      runId,
      currentStage: "context",
      currentIteration: 0,
      stateSnapshot: {
        stepName: stepConfig.name,
        hasConversation: (conversationHistory?.length ?? 0) > 0,
      },
    });

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "context",
      title: "上下文装载",
      content: [
        `Step: ${stepNumber + 1} ${stepConfig.name}`,
        `输入摘要:\n${inputText}`,
        `最近对话:\n${historySummary}`,
        `历史步骤摘要:\n${previousOutputSummary}`,
        `历史资产摘要:\n${artifactsSummary}`,
        `上传文件摘要:\n${assetsSummary}`,
      ].join("\n\n"),
      metadata: {
        conversationCount: conversationHistory?.length ?? 0,
        artifactCount: contextArtifacts.length,
        assetCount: contextAssets.length,
      },
    });

    await appendWorkflowArtifact({
      projectId,
      stepNumber,
      runId,
      artifactType: "step_input",
      source: "system",
      visibility: "both",
      title: `Step ${stepNumber + 1} 输入快照`,
      content: inputText,
      payload: {
        historySummary,
        previousOutputSummary,
        artifactsSummary,
        assetsSummary,
      },
    });

    await updateAgentRunProgress({
      runId,
      currentStage: "plan",
      currentIteration: 0,
    });

    plan = await generatePlan({
      systemPrompt: stepConfig.systemPrompt,
      taskPrompt: userPrompt,
      historySummary,
      previousOutputSummary,
      artifactsSummary,
      assetSummary: assetsSummary,
      assetTextHints,
      assetParts,
    });

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "plan",
      title: "计划阶段",
      content: formatPlan(plan),
      metadata: {
        planItemCount: plan.executionPlan.length,
      },
    });

    await appendWorkflowArtifact({
      projectId,
      stepNumber,
      runId,
      iteration: 0,
      artifactType: "plan",
      source: "agent",
      visibility: "both",
      title: `Step ${stepNumber + 1} 执行计划`,
      content: formatPlan(plan),
      payload: { plan },
    });

    await updateAgentRunProgress({
      runId,
      currentStage: "plan",
      currentIteration: 0,
      stateSnapshot: {
        stepName: stepConfig.name,
        plan,
      },
    });

    let draftText = "";

    for (let round = 1; round <= AGENT_MAX_ITERATIONS; round += 1) {
      iteration = round;

      await updateAgentRunProgress({
        runId,
        currentStage: "draft",
        currentIteration: round,
        stateSnapshot: {
          stepName: stepConfig.name,
          round,
          bestScore,
          lastVerdict: lastReview?.verdict ?? null,
        },
      });

      draftText = await generateDraft({
        systemPrompt: stepConfig.systemPrompt,
        taskPrompt: userPrompt,
        plan,
        previousOutputSummary,
        artifactsSummary,
        assetSummary: assetsSummary,
        assetTextHints,
        assetParts,
        historySummary,
        iteration: round,
        lastReview,
      });

      await appendAgentAction({
        runId,
        projectId,
        stepNumber,
        actionType: "draft",
        title: `草稿阶段（第 ${round} 轮）`,
        content: draftText || "（模型未返回草稿）",
        metadata: {
          iteration: round,
        },
      });

      await appendWorkflowArtifact({
        projectId,
        stepNumber,
        runId,
        iteration: round,
        artifactType: "draft",
        source: "agent",
        visibility: "both",
        title: `Step ${stepNumber + 1} 草稿 · 第 ${round} 轮`,
        content: draftText || "（模型未返回草稿）",
      });

      await updateAgentRunProgress({
        runId,
        currentStage: "review",
        currentIteration: round,
      });

      lastReview = await reviewDraft({
        taskPrompt: userPrompt,
        draft: draftText,
        plan,
      });

      bestScore = Math.max(bestScore, lastReview.score);

      await appendAgentAction({
        runId,
        projectId,
        stepNumber,
        actionType: "review",
        title: `审查阶段（第 ${round} 轮）`,
        content: formatReview(lastReview),
        metadata: {
          iteration: round,
          score: lastReview.score,
          verdict: lastReview.verdict,
          highIssues: lastReview.issues.filter((item) => item.severity === "high").length,
        },
      });

      await appendWorkflowArtifact({
        projectId,
        stepNumber,
        runId,
        iteration: round,
        artifactType: "review",
        source: "agent",
        visibility: "both",
        title: `Step ${stepNumber + 1} 审查 · 第 ${round} 轮`,
        content: formatReview(lastReview),
        payload: {
          score: lastReview.score,
          verdict: lastReview.verdict,
          issues: lastReview.issues,
          missingInformation: lastReview.missingInformation,
        },
      });

      if (isReviewPassed(lastReview)) {
        break;
      }
    }

    await updateAgentRunProgress({
      runId,
      currentStage: "final",
      currentIteration: iteration,
      stateSnapshot: {
        stepName: stepConfig.name,
        bestScore,
        lastVerdict: lastReview?.verdict ?? null,
      },
    });

    const fallbackDraft = "当前轮未生成有效草稿，请根据任务重新执行。";
    const finalText = await finalizeOutput({
      systemPrompt: stepConfig.systemPrompt,
      taskPrompt: userPrompt,
      plan,
      draft: draftText || fallbackDraft,
      review: lastReview,
      artifactsSummary,
      assetSummary: assetsSummary,
      assetTextHints,
      assetParts,
    });

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "final",
      title: "定稿阶段",
      content: finalText || draftText || "（模型未返回定稿）",
      metadata: {
        iterations: iteration,
        bestScore,
        passed: isReviewPassed(lastReview),
      },
    });

    await appendWorkflowArtifact({
      projectId,
      stepNumber,
      runId,
      iteration,
      artifactType: "final",
      source: "agent",
      visibility: "both",
      title: `Step ${stepNumber + 1} 定稿`,
      content: finalText || draftText || "（模型未返回定稿）",
      payload: {
        bestScore,
        verdict: lastReview?.verdict ?? "revise",
        passed: isReviewPassed(lastReview),
      },
    });

    const output = {
      text: finalText || draftText || fallbackDraft,
      timestamp: new Date().toISOString(),
      agent: {
        runId,
        strategy: AGENT_STRATEGY,
        iterations: iteration,
        maxIterations: AGENT_MAX_ITERATIONS,
        bestScore,
        passScore: AGENT_PASS_SCORE,
        verdict: lastReview?.verdict ?? "revise",
        passed: isReviewPassed(lastReview),
        missingInformation: lastReview?.missingInformation ?? [],
      },
      artifacts: {
        plan,
        latestReview: lastReview,
      },
    };

    await appendWorkflowArtifact({
      projectId,
      stepNumber,
      runId,
      iteration,
      artifactType: "step_output",
      source: "system",
      visibility: "both",
      title: `Step ${stepNumber + 1} 输出`,
      content: output.text,
      payload: output,
    });

    await finishAgentRun({
      runId,
      status: "completed",
      currentStage: "completed",
      currentIteration: iteration,
      stateSnapshot: {
        stepName: stepConfig.name,
        bestScore,
        lastVerdict: lastReview?.verdict ?? null,
      },
      finalOutput: output,
    });

    return {
      success: true,
      output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error executing step ${stepNumber}:`, error);

    if (runId) {
      try {
        await appendAgentAction({
          runId,
          projectId,
          stepNumber,
          actionType: "error",
          title: "执行异常",
          content: message,
          metadata: {
            iteration,
            hasPlan: Boolean(plan),
            lastReview: lastReview ? toPrettyJson(lastReview) : null,
          },
        });
        await appendWorkflowArtifact({
          projectId,
          stepNumber,
          runId,
          iteration,
          artifactType: "snapshot",
          source: "system",
          visibility: "both",
          title: `Step ${stepNumber + 1} 失败快照`,
          content: message,
          payload: {
            hasPlan: Boolean(plan),
            lastReview,
            bestScore,
          },
        });
        await finishAgentRun({
          runId,
          status: "error",
          currentStage: "error",
          currentIteration: iteration,
          stateSnapshot: {
            hasPlan: Boolean(plan),
            bestScore,
          },
          errorMessage: message,
        });
      } catch (traceError) {
        console.error("[Agent] Failed to persist error trace:", traceError);
      }
    }

    return {
      success: false,
      error: message,
    };
  }
}

export async function analyzeChangeImpact(params: {
  projectId: number;
  projectTitle: string;
  rawRequirement: string;
  changeRequest: string;
  steps: Array<{
    stepNumber: number;
    status: "pending" | "processing" | "completed" | "error";
    output: Record<string, any> | null;
  }>;
}): Promise<ChangeImpactAnalysis> {
  const stepSummary = summarizeAllStepOutputs(
    params.steps.map((step) => ({
      stepNumber: step.stepNumber,
      output: step.output,
    }))
  );

  const artifacts = await getAgentContextArtifacts(params.projectId, 8, 80);
  const artifactsSummary = summarizeArtifactContext(artifacts);
  const contextAssets = await getAgentContextAssetsWithUrls(params.projectId, 8, 20);
  const assetsSummary = summarizeModelAssets(contextAssets as AgentContextAsset[]);
  const { parts: assetParts, textHints: assetTextHints } = buildAssetMessageContext(
    contextAssets as AgentContextAsset[]
  );

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "intentType",
      "recommendedStartStep",
      "impactedSteps",
      "reason",
      "risks",
      "conflicts",
      "actionPlan",
      "summary",
    ],
    properties: {
      intentType: {
        type: "string",
        enum: [
          "copy_edit",
          "ux_tweak",
          "feature_adjustment",
          "new_feature",
          "scope_change",
          "technical_constraint",
        ],
      },
      recommendedStartStep: { type: "integer" },
      impactedSteps: { type: "array", items: { type: "integer" } },
      reason: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      conflicts: { type: "array", items: { type: "string" } },
      actionPlan: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
  } as const;

  const raw = await invokeStructured<ChangeImpactAnalysis>(
    [
      {
        role: "system",
        content:
          "你是产品需求全生命周期变更分析 Agent。目标：判断用户变更请求应从第几步重新开始，给出影响范围、冲突与执行建议。优先复用已有产物，避免不必要的全流程重跑。",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `项目名称: ${params.projectTitle}`,
              `原始需求:\n${params.rawRequirement}`,
              `最新步骤产物摘要:\n${stepSummary}`,
              `历史资产摘要:\n${artifactsSummary}`,
              `已上传文件摘要:\n${assetsSummary}`,
              assetTextHints.length > 0
                ? `可读文件内容摘录:\n${assetTextHints.join("\n\n")}`
                : "",
              `本次变更请求:\n${params.changeRequest}`,
              "请输出结构化变更影响分析。",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          ...assetParts,
        ],
      },
    ],
    "change_impact_analysis",
    schema,
    2200
  );

  return normalizeChangeAnalysis(raw);
}

/**
 * 获取步骤名称
 */
export function getStepName(stepNumber: number): string {
  const stepConfig = STEP_PROMPTS[stepNumber as keyof typeof STEP_PROMPTS];
  return stepConfig?.name || `Step ${stepNumber}`;
}

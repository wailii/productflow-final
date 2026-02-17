import { invokeLLM } from "./_core/llm";
import {
  appendAgentAction,
  finishAgentRun,
  startAgentRun,
} from "./db-helpers";

/**
 * AI 工作流引擎
 * 负责执行 9 个步骤的 AI Prompt 并生成结果
 */

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

function readChoiceText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map(part => {
      if (part && typeof part === "object" && "type" in part) {
        const typed = part as { type?: string; text?: string };
        if (typed.type === "text" && typed.text) return typed.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function invokeText(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) {
  const response = await invokeLLM({ messages });
  return readChoiceText(response.choices[0]?.message?.content).trim();
}

function summarizeInput(input: Record<string, any>) {
  const inputText = input.text || input.rawRequirement || JSON.stringify(input);
  return String(inputText).slice(0, 4000);
}

function summarizeConversation(
  history: Array<{ role: string; content: string }> | undefined
) {
  if (!history || history.length === 0) return "无";
  return history
    .slice(-8)
    .map((item, idx) => `${idx + 1}. [${item.role}] ${item.content}`)
    .join("\n")
    .slice(0, 4000);
}

/**
 * 执行指定步骤的 Agent 生成（Plan -> Draft -> Review -> Final）
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

  try {
    const run = await startAgentRun(projectId, stepNumber, "loop-v1");
    runId = run.id;

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "context",
      title: "上下文装载",
      content: `Step: ${stepNumber + 1} ${stepConfig.name}\n\n输入摘要:\n${inputText}\n\n最近对话:\n${historySummary}`,
      metadata: {
        conversationCount: conversationHistory?.length ?? 0,
      },
    });

    const plannerSystem = `${stepConfig.systemPrompt}

你是一个流程化 Agent 的 Planner 子模块。
任务：给出本步骤的执行计划，不直接输出最终答案。`;

    const planText = await invokeText([
      { role: "system", content: plannerSystem },
      {
        role: "user",
        content: `请基于以下信息给出 4-6 条执行计划，每条一句话。\n\n任务指令:\n${userPrompt}\n\n最近对话:\n${historySummary}`,
      },
    ]);

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "plan",
      title: "计划阶段",
      content: planText || "（模型未返回计划）",
    });

    const draftText = await invokeText([
      { role: "system", content: stepConfig.systemPrompt },
      {
        role: "user",
        content: `你将执行以下计划，先输出一个完整初稿：\n\n${planText}\n\n任务指令:\n${userPrompt}\n\n最近对话:\n${historySummary}`,
      },
    ]);

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "draft",
      title: "草稿阶段",
      content: draftText || "（模型未返回草稿）",
    });

    const reviewText = await invokeText([
      {
        role: "system",
        content:
          "你是审稿 Agent。请严格检查内容的完整性、可执行性、逻辑一致性、与输入匹配度。",
      },
      {
        role: "user",
        content: `请审查这份草稿，并输出两部分：\n1) 问题清单\n2) 修改建议\n\n草稿如下：\n${draftText}\n\n原始任务：\n${userPrompt}`,
      },
    ]);

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "review",
      title: "审查阶段",
      content: reviewText || "（模型未返回审查意见）",
    });

    const finalText = await invokeText([
      { role: "system", content: stepConfig.systemPrompt },
      {
        role: "user",
        content: `根据草稿和审查意见，输出最终版本。要求：结构清晰、可执行、不要解释过程。\n\n草稿：\n${draftText}\n\n审查意见：\n${reviewText}`,
      },
    ]);

    await appendAgentAction({
      runId,
      projectId,
      stepNumber,
      actionType: "final",
      title: "定稿阶段",
      content: finalText || "（模型未返回定稿）",
    });

    const output = {
      text: finalText || draftText,
      timestamp: new Date().toISOString(),
      agent: {
        runId,
        strategy: "loop-v1",
      },
    };

    await finishAgentRun({
      runId,
      status: "completed",
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
        });
        await finishAgentRun({
          runId,
          status: "error",
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

/**
 * 获取步骤名称
 */
export function getStepName(stepNumber: number): string {
  const stepConfig = STEP_PROMPTS[stepNumber as keyof typeof STEP_PROMPTS];
  return stepConfig?.name || `Step ${stepNumber}`;
}

import { COOKIE_NAME } from "@shared/const";
import { AI_PROVIDER_IDS, AI_PROVIDER_PRESET_MAP, AI_PROVIDER_PRESETS, type AiProviderId } from "@shared/ai-providers";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as dbHelpers from "./db-helpers";
import { decryptSecret, encryptSecret } from "./_core/secrets";
import {
  analyzeChangeImpact,
  continueWorkflowStepConversation,
  executeWorkflowStep,
  getStepName,
} from "./workflow-engine";
import { storagePut } from "./storage";
import { invokeLLM, type LLMRuntimeConfig, type MessageContent } from "./_core/llm";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const providerIdSchema = z.enum(AI_PROVIDER_IDS);

function normalizeProviderBaseUrl(value: string) {
  return value
    .trim()
    .replace(/\/chat\/completions\/?$/i, "")
    .replace(/\/$/, "");
}

function readChoiceText(content: string | MessageContent[] | undefined) {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      if (part.type === "image_url") return `[image:${part.image_url.url}]`;
      if (part.type === "file_url") return `[file:${part.file_url.url}]`;
      return "";
    })
    .join("\n")
    .trim();
}

type UserAiConfigPublic = {
  providerId: AiProviderId;
  providerLabel: string;
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  docsUrl?: string;
  updatedAt: string | null;
};

function toUserAiConfigPublic(setting: Awaited<ReturnType<typeof dbHelpers.getUserAiSettingByUserId>>): UserAiConfigPublic {
  if (!setting) {
    const preset = AI_PROVIDER_PRESET_MAP.custom;
    return {
      providerId: "custom",
      providerLabel: preset.label,
      enabled: false,
      baseUrl: "",
      model: "",
      hasApiKey: false,
      docsUrl: preset.docsUrl,
      updatedAt: null,
    };
  }

  const normalizedProviderId = (AI_PROVIDER_IDS as readonly string[]).includes(setting.providerId)
    ? (setting.providerId as AiProviderId)
    : "custom";
  const preset = AI_PROVIDER_PRESET_MAP[normalizedProviderId];

  return {
    providerId: normalizedProviderId,
    providerLabel: preset.label,
    enabled: setting.enabled === 1,
    baseUrl: setting.baseUrl || preset.defaultBaseUrl,
    model: setting.model || preset.defaultModel,
    hasApiKey: Boolean(setting.apiKeyEncrypted && setting.apiKeyEncrypted.trim().length > 0),
    docsUrl: preset.docsUrl,
    updatedAt: setting.updatedAt ? new Date(setting.updatedAt).toISOString() : null,
  };
}

async function resolveUserLlmRuntimeConfigOrThrow(userId: number): Promise<LLMRuntimeConfig> {
  const setting = await dbHelpers.getUserAiSettingByUserId(userId);
  if (!setting) {
    throw new Error("请先在「个人 AI 设置」中配置并启用模型。");
  }
  if (setting.enabled !== 1) {
    throw new Error("个人 AI 配置未启用，请到「个人 AI 设置」开启后再试。");
  }

  const apiKey = decryptSecret(setting.apiKeyEncrypted);
  if (!apiKey) {
    throw new Error("个人 AI 配置缺少 API Key，请到「个人 AI 设置」补全。");
  }

  const baseUrl = normalizeProviderBaseUrl(setting.baseUrl);
  const model = setting.model?.trim();
  if (!baseUrl || !model) {
    throw new Error("个人 AI 配置不完整，请填写 Base URL 和模型名称。");
  }

  return {
    apiUrl: baseUrl,
    apiKey,
    model,
  };
}

function sanitizeFileName(name: string) {
  return name
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

function inferAssetType(mimeType: string): "document" | "image" | "prototype" | "other" {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "document";
  if (
    mime.includes("officedocument") ||
    mime.includes("msword") ||
    mime.includes("spreadsheet") ||
    mime.includes("presentation")
  ) {
    return "document";
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("yaml")
  ) {
    return "document";
  }
  return "other";
}

function formatExportTimestampForFileName(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function normalizeStepOutputText(output: Record<string, any> | null | undefined) {
  const raw = output?.text;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (output && Object.keys(output).length > 0) {
    return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``;
  }
  return "（暂无输出）";
}

function buildPrdMarkdown(params: {
  project: Awaited<ReturnType<typeof dbHelpers.getProjectById>>;
  steps: Awaited<ReturnType<typeof dbHelpers.getWorkflowStepsByProjectId>>;
  exportedAt: Date;
}) {
  const { project, steps, exportedAt } = params;
  if (!project) {
    throw new Error("Project not found");
  }

  const lines: string[] = [];
  lines.push(`# ${project.title} - PRD`);
  lines.push("");
  lines.push(`- 导出时间：${exportedAt.toISOString()}`);
  lines.push(`- 项目 ID：${project.id}`);
  lines.push(`- 当前进度：Step ${Math.min(project.currentStep + 1, 9)}/9`);
  lines.push("");
  lines.push("## 原始需求");
  lines.push("");
  lines.push(project.rawRequirement?.trim() || "（未填写）");
  lines.push("");
  lines.push("## 工作流输出");
  lines.push("");

  for (let stepNumber = 0; stepNumber < 9; stepNumber += 1) {
    const step = steps.find((item) => item.stepNumber === stepNumber) ?? null;
    lines.push(`### Step ${stepNumber + 1}: ${getStepName(stepNumber)}`);
    lines.push("");
    lines.push(`- 状态：${step?.status ?? "pending"}`);
    lines.push("");
    lines.push(normalizeStepOutputText(step?.output ?? null));
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, cookieOptions);
      return {
        success: true,
      } as const;
    }),
  }),

  settings: router({
    providerPresets: protectedProcedure.query(() => {
      return AI_PROVIDER_PRESETS;
    }),

    getAiConfig: protectedProcedure.query(async ({ ctx }) => {
      const setting = await dbHelpers.getUserAiSettingByUserId(ctx.user.id);
      return toUserAiConfigPublic(setting);
    }),

    saveAiConfig: protectedProcedure
      .input(
        z.object({
          providerId: providerIdSchema,
          enabled: z.boolean().default(true),
          baseUrl: z.string().min(1).max(500),
          model: z.string().min(1).max(180),
          apiKey: z.string().max(2000).optional(),
          clearApiKey: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const preset = AI_PROVIDER_PRESET_MAP[input.providerId];
        const existing = await dbHelpers.getUserAiSettingByUserId(ctx.user.id);
        const nextBaseUrl = normalizeProviderBaseUrl(input.baseUrl || preset.defaultBaseUrl);
        const nextModel = input.model.trim() || preset.defaultModel;

        const apiKeyInput = input.apiKey?.trim();
        let apiKeyEncrypted: string | null;
        if (input.clearApiKey) {
          apiKeyEncrypted = null;
        } else if (apiKeyInput && apiKeyInput.length > 0) {
          apiKeyEncrypted = encryptSecret(apiKeyInput);
        } else {
          apiKeyEncrypted = existing?.apiKeyEncrypted ?? null;
        }

        if (input.enabled && (!apiKeyEncrypted || apiKeyEncrypted.trim().length === 0)) {
          throw new Error("启用个人配置前，请填写有效的 API Key");
        }

        await dbHelpers.upsertUserAiSetting({
          userId: ctx.user.id,
          providerId: input.providerId,
          enabled: input.enabled,
          baseUrl: nextBaseUrl,
          model: nextModel,
          apiKeyEncrypted,
          metadata: {
            providerLabel: preset.label,
            category: preset.category,
          },
        });

        const latest = await dbHelpers.getUserAiSettingByUserId(ctx.user.id);
        return toUserAiConfigPublic(latest);
      }),

    testAiConfig: protectedProcedure
      .input(
        z.object({
          providerId: providerIdSchema,
          baseUrl: z.string().min(1).max(500),
          model: z.string().min(1).max(180),
          apiKey: z.string().max(2000).optional(),
          useSavedApiKey: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await dbHelpers.getUserAiSettingByUserId(ctx.user.id);
        const savedKey = input.useSavedApiKey ? decryptSecret(existing?.apiKeyEncrypted) : "";
        const runtimeApiKey = input.apiKey?.trim() || savedKey;
        if (!runtimeApiKey) {
          throw new Error("请先填写 API Key，或保存后再测试");
        }

        const runtimeConfig: LLMRuntimeConfig = {
          apiKey: runtimeApiKey,
          apiUrl: normalizeProviderBaseUrl(input.baseUrl),
          model: input.model.trim(),
        };

        const response = await invokeLLM({
          runtimeConfig,
          maxTokens: 32,
          messages: [
            {
              role: "user",
              content: "请只回复：连接测试成功",
            },
          ],
        });

        return {
          ok: true,
          preview: readChoiceText(response.choices[0]?.message?.content).slice(0, 120),
        } as const;
      }),
  }),

  // ProductFlow routers
  projects: router({
    // 获取用户的所有项目
    list: protectedProcedure.query(async ({ ctx }) => {
      return dbHelpers.getProjectsByUserId(ctx.user.id);
    }),

    // 创建新项目
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          rawRequirement: z.string().optional().default(""),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const title = input.title.trim();
        if (!title) {
          throw new Error("请填写项目标题");
        }
        const rawRequirement = input.rawRequirement.trim();
        const project = await dbHelpers.createProjectWithSteps(
          ctx.user.id,
          title,
          rawRequirement
        );
        return project;
      }),

    // 获取项目详情
    get: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        return dbHelpers.getProjectById(input.projectId, ctx.user.id);
      }),

    // 删除项目
    delete: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await dbHelpers.deleteProject(input.projectId, ctx.user.id);
        return { success: true };
      }),
  }),

  workflow: router({
    // 上传生命周期资产（文档/图片/原型等）
    uploadAsset: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8).optional(),
          scope: z.enum(["project", "step"]).optional(),
          assetType: z.enum(["document", "image", "prototype", "other"]).optional(),
          fileName: z.string().min(1).max(255),
          mimeType: z.string().min(1).max(160),
          base64Data: z.string().min(1),
          sourceLabel: z.string().max(120).optional(),
          note: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }

        const base64 = input.base64Data.includes(",")
          ? input.base64Data.split(",").pop() ?? ""
          : input.base64Data;
        const fileBuffer = Buffer.from(base64, "base64");

        if (!fileBuffer || fileBuffer.length === 0) {
          throw new Error("Invalid file data");
        }
        if (fileBuffer.length > MAX_UPLOAD_BYTES) {
          throw new Error("File too large. Max 15MB per upload.");
        }

        const normalizedName = sanitizeFileName(input.fileName);
        const keyPrefix = `productflow/${project.id}/assets/${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}`;
        const storageKey = `${keyPrefix}-${Math.random()
          .toString(36)
          .slice(2, 10)}-${normalizedName}`;

        const stored = await storagePut(storageKey, fileBuffer, input.mimeType);

        const assetType = input.assetType ?? inferAssetType(input.mimeType);
        const asset = await dbHelpers.appendWorkflowAsset({
          projectId: input.projectId,
          stepNumber: input.stepNumber,
          scope: input.scope ?? (typeof input.stepNumber === "number" ? "step" : "project"),
          assetType,
          fileName: normalizedName,
          mimeType: input.mimeType,
          fileSize: fileBuffer.length,
          storageKey: stored.key,
          sourceLabel: input.sourceLabel,
          note: input.note,
        });

        await dbHelpers.appendWorkflowArtifact({
          projectId: input.projectId,
          stepNumber: input.stepNumber,
          artifactType: "conversation_note",
          source: "user",
          visibility: "both",
          title: `上传资产 · ${normalizedName}`,
          content: [
            `assetType=${assetType}`,
            `scope=${asset.scope}`,
            `mimeType=${asset.mimeType}`,
            `fileSize=${asset.fileSize}`,
            input.note ? `note=${input.note}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          payload: {
            assetId: asset.id,
            storageKey: asset.storageKey,
          },
        });

        return {
          asset: {
            ...asset,
            url: stored.url,
          },
        } as const;
      }),

    // 获取步骤/项目的已上传资产
    getAssets: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8).optional(),
          limit: z.number().min(1).max(5000).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }

        const assets = await dbHelpers.getWorkflowAssetsWithUrls({
          projectId: input.projectId,
          stepNumber: input.stepNumber,
          limit: input.limit ?? 120,
        });
        return {
          items: assets,
        } as const;
      }),

    // 获取生命周期资产（含每轮草稿/审查/定稿/变更分析等）
    getArtifacts: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8).optional(),
          limit: z.number().min(1).max(5000).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }

        const artifacts = await dbHelpers.getWorkflowArtifacts({
          projectId: input.projectId,
          stepNumber: input.stepNumber,
          limit: input.limit ?? 160,
        });

        return {
          items: artifacts,
        } as const;
      }),

    // 导出 PRD（Markdown 文件）
    exportPrd: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }

        const steps = await dbHelpers.getWorkflowStepsByProjectId(input.projectId);
        const exportedAt = new Date();
        const markdown = buildPrdMarkdown({
          project,
          steps,
          exportedAt,
        });

        const fileTimestamp = formatExportTimestampForFileName(exportedAt);
        const exportedFileName = `${sanitizeFileName(project.title)}-PRD-${fileTimestamp}.md`;
        const storageKey = `productflow/${project.id}/exports/${fileTimestamp}-${Math.random()
          .toString(36)
          .slice(2, 10)}-${exportedFileName}`;

        const stored = await storagePut(
          storageKey,
          markdown,
          "text/markdown; charset=utf-8"
        );

        const asset = await dbHelpers.appendWorkflowAsset({
          projectId: input.projectId,
          assetType: "document",
          scope: "project",
          fileName: exportedFileName,
          mimeType: "text/markdown",
          fileSize: Buffer.byteLength(markdown, "utf8"),
          storageKey: stored.key,
          sourceLabel: "prd_export",
          note: "自动导出的 PRD 文档",
        });

        await dbHelpers.appendWorkflowArtifact({
          projectId: input.projectId,
          artifactType: "conversation_note",
          source: "system",
          visibility: "both",
          title: `导出 PRD · ${exportedFileName}`,
          content: [
            `assetId=${asset.id}`,
            `storageKey=${asset.storageKey}`,
            `fileName=${exportedFileName}`,
          ].join("\n"),
          payload: {
            assetId: asset.id,
            storageKey: asset.storageKey,
            fileName: exportedFileName,
          },
        });

        return {
          fileName: exportedFileName,
          mimeType: "text/markdown",
          content: markdown,
          url: stored.url,
          assetId: asset.id,
        } as const;
      }),

    // 分析变更请求：判断应从哪一步重跑、影响哪些步骤
    analyzeChangeRequest: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          changeRequest: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const runtimeConfig = await resolveUserLlmRuntimeConfigOrThrow(ctx.user.id);
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }

        const steps = await dbHelpers.getWorkflowStepsByProjectId(input.projectId);

        await dbHelpers.appendWorkflowArtifact({
          projectId: input.projectId,
          artifactType: "change_request",
          source: "user",
          visibility: "both",
          title: "用户变更请求",
          content: input.changeRequest,
          payload: {
            atStep: project.currentStep,
          },
        });

        const analysis = await analyzeChangeImpact({
          projectId: input.projectId,
          projectTitle: project.title,
          rawRequirement: project.rawRequirement,
          changeRequest: input.changeRequest,
          steps: steps.map((step) => ({
            stepNumber: step.stepNumber,
            status: step.status,
            output: step.output ?? null,
          })),
        }, runtimeConfig);

        await dbHelpers.appendWorkflowArtifact({
          projectId: input.projectId,
          stepNumber: analysis.recommendedStartStep,
          artifactType: "change_analysis",
          source: "agent",
          visibility: "both",
          title: "变更影响分析",
          content: [
            `建议起步步骤: Step ${analysis.recommendedStartStep + 1} ${getStepName(analysis.recommendedStartStep)}`,
            `影响步骤: ${analysis.impactedSteps.map((step) => `Step ${step + 1}`).join(", ")}`,
            `原因: ${analysis.reason}`,
            `摘要: ${analysis.summary}`,
          ].join("\n"),
          payload: analysis,
        });

        return analysis;
      }),

    // 采纳变更分析并从指定步骤继续迭代
    applyChangePlan: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          startStep: z.number().min(0).max(8),
          changeRequest: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }

        await dbHelpers.resetWorkflowFromStep(input.projectId, input.startStep);
        await dbHelpers.updateProjectStep(input.projectId, input.startStep, "in_progress");

        if (input.changeRequest) {
          await dbHelpers.addConversationMessage(
            input.projectId,
            input.startStep,
            "system",
            `变更迭代上下文：${input.changeRequest}`
          );
          await dbHelpers.appendWorkflowArtifact({
            projectId: input.projectId,
            stepNumber: input.startStep,
            artifactType: "conversation_note",
            source: "system",
            visibility: "both",
            title: `Step ${input.startStep + 1} 变更上下文`,
            content: input.changeRequest,
          });
        }

        return {
          success: true,
          startStep: input.startStep,
        } as const;
      }),

    // 获取步骤的 Agent 执行轨迹（最新一轮）
    getAgentTrace: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
        })
      )
      .query(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        const run = await dbHelpers.getLatestAgentRunByStep(
          input.projectId,
          input.stepNumber
        );
        if (!run) {
          return {
            run: null,
            actions: [],
          } as const;
        }

        const actions = await dbHelpers.getAgentActionsByRunId(run.id);
        return {
          run,
          actions,
        };
      }),

    // 获取步骤的对话历史
    getConversation: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
        })
      )
      .query(async ({ ctx, input }) => {
        // 验证项目所有权
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }
        return dbHelpers.getConversationHistory(
          input.projectId,
          input.stepNumber
        );
      }),

    // 获取项目全流程对话时间线（跨步骤连续）
    getConversationTimeline: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }
        return dbHelpers.getProjectConversationHistory(input.projectId);
      }),

    // 在步骤内继续对话（多轮打磨）
    continueConversation: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
          userMessage: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const runtimeConfig = await resolveUserLlmRuntimeConfigOrThrow(ctx.user.id);
        // 验证项目所有权
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        const normalizedMessage = input.userMessage.trim();
        if (!normalizedMessage) {
          throw new Error("请输入内容");
        }

        let seededRawRequirement = project.rawRequirement;
        if (input.stepNumber === 0 && !project.rawRequirement.trim()) {
          seededRawRequirement = normalizedMessage;
          await dbHelpers.updateProjectRawRequirement(input.projectId, seededRawRequirement);
        }

        // 保存用户消息
        await dbHelpers.addConversationMessage(
          input.projectId,
          input.stepNumber,
          "user",
          normalizedMessage
        );

        // 获取完整对话历史
        const history = await dbHelpers.getConversationHistory(
          input.projectId,
          input.stepNumber
        );

        // 调用 AI 继续对话
        const step = await dbHelpers.getWorkflowStep(
          input.projectId,
          input.stepNumber
        );
        if (!step) {
          throw new Error("Step not found");
        }

        let continueInput: Record<string, any>;
        if (step.output) {
          continueInput = step.output;
        } else if (input.stepNumber === 0) {
          continueInput = { rawRequirement: seededRawRequirement };
        } else {
          const prevStep = await dbHelpers.getWorkflowStep(
            input.projectId,
            input.stepNumber - 1
          );
          continueInput = prevStep?.output ?? { text: seededRawRequirement };
        }

        continueInput = {
          ...continueInput,
          latestUserInstruction: normalizedMessage,
        };

        // 快速续聊改写：不重跑完整状态机，避免慢和中间产物噪音
        const result = await continueWorkflowStepConversation(
          input.projectId,
          input.stepNumber,
          continueInput,
          normalizedMessage,
          history,
          runtimeConfig
        );

        // 保存 AI 回复
        if (result.output?.text) {
          await dbHelpers.addConversationMessage(
            input.projectId,
            input.stepNumber,
            "assistant",
            result.output.text || ""
          );

          await dbHelpers.appendWorkflowArtifact({
            projectId: input.projectId,
            stepNumber: input.stepNumber,
            artifactType: "step_output",
            source: "agent",
            visibility: "both",
            title: `Step ${input.stepNumber + 1} 输出`,
            content: result.output.text || "",
            payload: {
              userMessage: normalizedMessage,
              mode: "chat_refine",
              output: result.output,
            },
          });
        }

        if (!result.success || !result.output) {
          throw new Error(result.error || "对话失败");
        }

        // 更新步骤输出
        await dbHelpers.updateWorkflowStep(step.id, {
          input: step.input ?? continueInput,
          output: result.output,
          status: "completed",
        });

        if (project.status !== "completed") {
          await dbHelpers.updateProjectStep(
            input.projectId,
            Math.max(project.currentStep, input.stepNumber),
            "in_progress"
          );
        }

        return result;
      }),

    // 跳过步骤
    skipStep: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 验证项目所有权
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        const step = await dbHelpers.getWorkflowStep(
          input.projectId,
          input.stepNumber
        );
        if (!step) {
          throw new Error("Step not found");
        }

        // 标记为已完成（但输出为空）
        await dbHelpers.updateWorkflowStep(step.id, {
          status: "completed",
          output: { text: "[已跳过]" },
        });

        // 更新项目当前步骤
        if (project.currentStep === input.stepNumber) {
          await dbHelpers.updateProjectStep(
            input.projectId,
            input.stepNumber + 1,
            "in_progress"
          );
        }

        return { success: true };
      }),
    // 获取项目的所有步骤
    getSteps: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await dbHelpers.getProjectById(input.projectId, ctx.user.id);
        if (!project) {
          throw new Error("Project not found");
        }
        return dbHelpers.ensureWorkflowStepsByProjectId(input.projectId);
      }),

    // 执行指定步骤
    executeStep: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const runtimeConfig = await resolveUserLlmRuntimeConfigOrThrow(ctx.user.id);
        // 获取项目
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        // 获取或创建步骤记录
        let step = await dbHelpers.getWorkflowStep(
          input.projectId,
          input.stepNumber
        );
        if (!step) {
          step = await dbHelpers.createWorkflowStep(
            input.projectId,
            input.stepNumber
          );
        }

        // 更新状态为 processing
        await dbHelpers.updateWorkflowStep(step.id, { status: "processing" });

        // 准备输入数据
        let stepInput: Record<string, any>;
        if (input.stepNumber === 0) {
          // 第一步使用原始需求
          if (!project.rawRequirement.trim()) {
            throw new Error("请先在对话框输入原始需求");
          }
          stepInput = { rawRequirement: project.rawRequirement };
        } else {
          // 后续步骤使用前一步的输出
          const prevStep = await dbHelpers.getWorkflowStep(
            input.projectId,
            input.stepNumber - 1
          );
          if (!prevStep || !prevStep.output) {
            throw new Error(
              `Previous step (${input.stepNumber - 1}) not completed`
            );
          }
          stepInput = prevStep.output;
        }

        // 执行 AI 生成
        const result = await executeWorkflowStep(
          input.projectId,
          input.stepNumber,
          stepInput,
          undefined,
          runtimeConfig
        );

        if (result.success && result.output) {
          // 更新步骤状态为 completed
          await dbHelpers.updateWorkflowStep(step.id, {
            status: "completed",
            input: stepInput,
            output: result.output,
          });

          // 更新项目的当前步骤
          await dbHelpers.updateProjectStep(
            input.projectId,
            input.stepNumber,
            "in_progress"
          );

          return { success: true, output: result.output };
        } else {
          // 更新步骤状态为 error
          await dbHelpers.updateWorkflowStep(step.id, {
            status: "error",
            errorMessage: result.error || "Unknown error",
          });
          throw new Error(result.error || "Failed to execute step");
        }
      }),

    // 确认步骤并进入下一步
    confirmStep: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 验证项目所有权
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        // 确保当前步骤存在并标记完成（即使用户只是口令推进）
        let currentStepRecord = await dbHelpers.getWorkflowStep(
          input.projectId,
          input.stepNumber
        );
        if (!currentStepRecord) {
          currentStepRecord = await dbHelpers.createWorkflowStep(
            input.projectId,
            input.stepNumber
          );
        }
        if (currentStepRecord.status !== "completed") {
          await dbHelpers.updateWorkflowStep(currentStepRecord.id, {
            status: "completed",
          });
        }

        // 更新项目当前步骤
        const nextStep = input.stepNumber + 1;
        const newStatus = nextStep >= 9 ? "completed" : "in_progress";
        await dbHelpers.updateProjectStep(
          input.projectId,
          nextStep,
          newStatus
        );

        // 进入下一步时注入一条轻量上下文消息，避免新步骤空白
        if (nextStep < 9) {
          const existingNextStep = await dbHelpers.getWorkflowStep(
            input.projectId,
            nextStep
          );
          if (!existingNextStep) {
            await dbHelpers.createWorkflowStep(
              input.projectId,
              nextStep
            );
          }

          const nextStepConversation = await dbHelpers.getConversationHistory(
            input.projectId,
            nextStep
          );
          if (nextStepConversation.length === 0) {
            await dbHelpers.addConversationMessage(
              input.projectId,
              nextStep,
              "system",
              `已进入 Step ${nextStep + 1}（${getStepName(nextStep)}）。你可以继续提出修改意见，或输入“进入下一步”。`
            );
          }
        }

        return { success: true, nextStep };
      }),

    // 更新步骤输出（用户手动编辑）
    updateStepOutput: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          stepNumber: z.number().min(0).max(8),
          output: z.record(z.string(), z.any()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 验证项目所有权
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        const step = await dbHelpers.getWorkflowStep(
          input.projectId,
          input.stepNumber
        );
        if (!step) {
          throw new Error("Step not found");
        }

        await dbHelpers.updateWorkflowStep(step.id, {
          output: input.output,
          status: "completed",
        });

        await dbHelpers.appendWorkflowArtifact({
          projectId: input.projectId,
          stepNumber: input.stepNumber,
          artifactType: "step_output",
          source: "user",
          visibility: "both",
          title: `Step ${input.stepNumber + 1} 手工更新输出`,
          content: String(input.output?.text ?? JSON.stringify(input.output, null, 2)),
          payload: input.output,
        });

        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

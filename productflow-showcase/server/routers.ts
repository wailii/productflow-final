import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as dbHelpers from "./db-helpers";
import { analyzeChangeImpact, executeWorkflowStep, getStepName } from "./workflow-engine";
import { storagePut } from "./storage";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

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
          rawRequirement: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await dbHelpers.createProjectWithSteps(
          ctx.user.id,
          input.title,
          input.rawRequirement
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
          limit: z.number().min(1).max(200).optional(),
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
          limit: z.number().min(1).max(300).optional(),
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

    // 分析变更请求：判断应从哪一步重跑、影响哪些步骤
    analyzeChangeRequest: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          changeRequest: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
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
        });

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
        // 验证项目所有权
        const project = await dbHelpers.getProjectById(
          input.projectId,
          ctx.user.id
        );
        if (!project) {
          throw new Error("Project not found");
        }

        // 保存用户消息
        await dbHelpers.addConversationMessage(
          input.projectId,
          input.stepNumber,
          "user",
          input.userMessage
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
          continueInput = { rawRequirement: project.rawRequirement };
        } else {
          const prevStep = await dbHelpers.getWorkflowStep(
            input.projectId,
            input.stepNumber - 1
          );
          continueInput = prevStep?.output ?? { text: project.rawRequirement };
        }

        continueInput = {
          ...continueInput,
          latestUserInstruction: input.userMessage.trim(),
        };

        // 重新执行步骤，带上对话历史
        const result = await executeWorkflowStep(
          input.projectId,
          input.stepNumber,
          continueInput,
          history
        );

        // 保存 AI 回复
        if (result.output) {
          await dbHelpers.addConversationMessage(
            input.projectId,
            input.stepNumber,
            "assistant",
            result.output.text || ""
          );
          await dbHelpers.appendWorkflowArtifact({
            projectId: input.projectId,
            stepNumber: input.stepNumber,
            artifactType: "conversation_note",
            source: "agent",
            visibility: "both",
            title: `Step ${input.stepNumber + 1} 对话打磨`,
            content: `${input.userMessage.trim()}\n\n---\n\n${result.output.text || ""}`,
            payload: {
              userMessage: input.userMessage.trim(),
              runId: result.output?.agent?.runId,
            },
          });
        }

        // 更新步骤输出
        await dbHelpers.updateWorkflowStep(step.id, {
          output: result.output,
          status: "completed",
        });

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
      .query(async ({ input }) => {
        return dbHelpers.getWorkflowStepsByProjectId(input.projectId);
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
        const result = await executeWorkflowStep(input.projectId, input.stepNumber, stepInput);

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

        // 更新项目当前步骤
        const nextStep = input.stepNumber + 1;
        const newStatus = nextStep >= 9 ? "completed" : "in_progress";
        await dbHelpers.updateProjectStep(
          input.projectId,
          nextStep,
          newStatus
        );

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

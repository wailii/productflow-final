import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as dbHelpers from "./db-helpers";
import { executeWorkflowStep, getStepName } from "./workflow-engine";

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

        // 重新执行步骤，带上对话历史
        const result = await executeWorkflowStep(
          input.projectId,
          input.stepNumber,
          { text: project.rawRequirement },
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

        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

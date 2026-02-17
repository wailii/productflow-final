import { eq, and, desc, gte, inArray, or, lte } from "drizzle-orm";
import { getDb } from "./db";
import {
  agentActions,
  agentRuns,
  conversationHistory,
  projects,
  type AgentAction,
  type AgentRun,
  type ConversationMessage,
  type Project,
  type UserAiSetting,
  type WorkflowArtifact,
  type WorkflowAsset,
  type WorkflowStep,
  userAiSettings,
  workflowArtifacts,
  workflowAssets,
  workflowSteps,
} from "../drizzle/schema";
import { storageGet } from "./storage";

/**
 * 项目相关的数据库操作
 */

export async function createProject(userId: number, title: string, rawRequirement: string): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [project] = await db.insert(projects).values({
    userId,
    title,
    rawRequirement,
    status: "draft",
    currentStep: 0,
  }).$returningId();

  const [created] = await db.select().from(projects).where(eq(projects.id, project.id));
  if (!created) throw new Error("Failed to create project");
  
  return created;
}

export async function createProjectWithSteps(
  userId: number,
  title: string,
  rawRequirement: string
): Promise<Project> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const createdProject = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        userId,
        title,
        rawRequirement,
        status: "draft",
        currentStep: 0,
      })
      .$returningId();

    await tx.insert(workflowSteps).values(
      Array.from({ length: 9 }, (_, stepNumber) => ({
        projectId: project.id,
        stepNumber,
        status: "pending" as const,
      }))
    );

    const [created] = await tx.select().from(projects).where(eq(projects.id, project.id));
    if (!created) throw new Error("Failed to create project");

    return created;
  });

  return createdProject;
}

export async function getProjectsByUserId(userId: number): Promise<Project[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectById(projectId: number, userId: number): Promise<Project | null> {
  const db = await getDb();
  if (!db) return null;

  const [project] = await db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.userId, userId))
  );

  return project || null;
}

export async function updateProjectStep(projectId: number, currentStep: number, status: "draft" | "in_progress" | "completed" | "archived"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(projects).set({ currentStep, status, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

export async function updateProjectRawRequirement(projectId: number, rawRequirement: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(projects)
    .set({ rawRequirement, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function deleteProject(projectId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(workflowAssets).where(eq(workflowAssets.projectId, projectId));
  await db.delete(workflowArtifacts).where(eq(workflowArtifacts.projectId, projectId));
  await db.delete(agentActions).where(eq(agentActions.projectId, projectId));
  await db.delete(agentRuns).where(eq(agentRuns.projectId, projectId));
  await db.delete(conversationHistory).where(eq(conversationHistory.projectId, projectId));

  // 先删除所有相关的 workflow steps
  await db.delete(workflowSteps).where(eq(workflowSteps.projectId, projectId));
  
  // 再删除项目
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

/**
 * User AI settings related DB operations
 */
export async function getUserAiSettingByUserId(userId: number): Promise<UserAiSetting | null> {
  const db = await getDb();
  if (!db) return null;

  const [setting] = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, userId))
    .limit(1);

  return setting ?? null;
}

export async function upsertUserAiSetting(data: {
  userId: number;
  providerId: string;
  baseUrl: string;
  model: string;
  apiKeyEncrypted?: string | null;
  enabled: boolean;
  metadata?: Record<string, any>;
}): Promise<UserAiSetting> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(userAiSettings)
    .values({
      userId: data.userId,
      providerId: data.providerId,
      baseUrl: data.baseUrl,
      model: data.model,
      apiKeyEncrypted: data.apiKeyEncrypted ?? null,
      enabled: data.enabled ? 1 : 0,
      metadata: data.metadata,
    })
    .onDuplicateKeyUpdate({
      set: {
        providerId: data.providerId,
        baseUrl: data.baseUrl,
        model: data.model,
        apiKeyEncrypted: data.apiKeyEncrypted ?? null,
        enabled: data.enabled ? 1 : 0,
        metadata: data.metadata,
        updatedAt: new Date(),
      },
    });

  const [created] = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, data.userId))
    .limit(1);
  if (!created) throw new Error("Failed to save user AI settings");
  return created;
}

/**
 * Workflow Steps 相关的数据库操作
 */

export async function createWorkflowStep(projectId: number, stepNumber: number): Promise<WorkflowStep> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [step] = await db.insert(workflowSteps).values({
    projectId,
    stepNumber,
    status: "pending",
  }).$returningId();

  const [created] = await db.select().from(workflowSteps).where(eq(workflowSteps.id, step.id));
  if (!created) throw new Error("Failed to create workflow step");
  
  return created;
}

export async function getWorkflowStepsByProjectId(projectId: number): Promise<WorkflowStep[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(workflowSteps).where(eq(workflowSteps.projectId, projectId)).orderBy(workflowSteps.stepNumber);
}

export async function getWorkflowStep(projectId: number, stepNumber: number): Promise<WorkflowStep | null> {
  const db = await getDb();
  if (!db) return null;

  const [step] = await db.select().from(workflowSteps).where(
    and(eq(workflowSteps.projectId, projectId), eq(workflowSteps.stepNumber, stepNumber))
  );

  return step || null;
}

export async function updateWorkflowStep(
  stepId: number,
  data: {
    status?: "pending" | "processing" | "completed" | "error";
    input?: Record<string, any>;
    output?: Record<string, any>;
    aiPrompt?: string;
    errorMessage?: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(workflowSteps).set({ ...data, updatedAt: new Date() }).where(eq(workflowSteps.id, stepId));
}

export async function initializeWorkflowSteps(projectId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(workflowSteps).values(
    Array.from({ length: 9 }, (_, stepNumber) => ({
      projectId,
      stepNumber,
      status: "pending" as const,
    }))
  );
}

/**
 * Conversation History 相关的数据库操作
 */

export async function addConversationMessage(
  projectId: number,
  stepNumber: number,
  role: "user" | "assistant" | "system",
  content: string
): Promise<ConversationMessage> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [message] = await db.insert(conversationHistory).values({
    projectId,
    stepNumber,
    role,
    content,
  }).$returningId();

  const [created] = await db.select().from(conversationHistory).where(eq(conversationHistory.id, message.id));
  if (!created) throw new Error("Failed to create conversation message");
  
  return created;
}

export async function getConversationHistory(projectId: number, stepNumber: number): Promise<ConversationMessage[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(conversationHistory).where(
    and(eq(conversationHistory.projectId, projectId), eq(conversationHistory.stepNumber, stepNumber))
  ).orderBy(conversationHistory.createdAt);
}

export async function clearConversationHistory(projectId: number, stepNumber: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(conversationHistory).where(
    and(eq(conversationHistory.projectId, projectId), eq(conversationHistory.stepNumber, stepNumber))
  );
}

/**
 * Agent tracing related DB operations
 */
export type AgentStage =
  | "context"
  | "plan"
  | "draft"
  | "review"
  | "final"
  | "completed"
  | "error";

export async function startAgentRun(
  projectId: number,
  stepNumber: number,
  strategy: string = "agent-v2"
): Promise<AgentRun> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [inserted] = await db
    .insert(agentRuns)
    .values({
      projectId,
      stepNumber,
      strategy,
      status: "running",
      currentStage: "context",
      currentIteration: 0,
    })
    .$returningId();

  const [created] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, inserted.id));
  if (!created) throw new Error("Failed to start agent run");
  return created;
}

export async function updateAgentRunProgress(data: {
  runId: number;
  currentStage: AgentStage;
  currentIteration?: number;
  stateSnapshot?: Record<string, any>;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(agentRuns)
    .set({
      currentStage: data.currentStage,
      ...(typeof data.currentIteration === "number"
        ? { currentIteration: data.currentIteration }
        : {}),
      ...(data.stateSnapshot ? { stateSnapshot: data.stateSnapshot } : {}),
    })
    .where(eq(agentRuns.id, data.runId));
}

export async function appendAgentAction(data: {
  runId: number;
  projectId: number;
  stepNumber: number;
  actionType: "context" | "plan" | "draft" | "review" | "final" | "error";
  title: string;
  content: string;
  metadata?: Record<string, any>;
}): Promise<AgentAction> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [inserted] = await db
    .insert(agentActions)
    .values({
      runId: data.runId,
      projectId: data.projectId,
      stepNumber: data.stepNumber,
      actionType: data.actionType,
      title: data.title,
      content: data.content,
      metadata: data.metadata,
    })
    .$returningId();

  const [created] = await db
    .select()
    .from(agentActions)
    .where(eq(agentActions.id, inserted.id));
  if (!created) throw new Error("Failed to append agent action");
  return created;
}

export async function finishAgentRun(data: {
  runId: number;
  status: "completed" | "error";
  currentStage: "completed" | "error";
  currentIteration?: number;
  stateSnapshot?: Record<string, any>;
  finalOutput?: Record<string, any>;
  errorMessage?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(agentRuns)
    .set({
      status: data.status,
      currentStage: data.currentStage,
      ...(typeof data.currentIteration === "number"
        ? { currentIteration: data.currentIteration }
        : {}),
      ...(data.stateSnapshot ? { stateSnapshot: data.stateSnapshot } : {}),
      finalOutput: data.finalOutput,
      errorMessage: data.errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, data.runId));
}

export async function getLatestAgentRunByStep(
  projectId: number,
  stepNumber: number
): Promise<AgentRun | null> {
  const db = await getDb();
  if (!db) return null;

  const [run] = await db
    .select()
    .from(agentRuns)
    .where(
      and(eq(agentRuns.projectId, projectId), eq(agentRuns.stepNumber, stepNumber))
    )
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  return run ?? null;
}

export async function getAgentActionsByRunId(runId: number): Promise<AgentAction[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(agentActions)
    .where(eq(agentActions.runId, runId))
    .orderBy(agentActions.createdAt);
}

/**
 * Workflow artifacts related DB operations
 */
export type WorkflowArtifactType =
  | "step_input"
  | "step_output"
  | "plan"
  | "draft"
  | "review"
  | "final"
  | "conversation_note"
  | "change_request"
  | "change_analysis"
  | "snapshot";

export async function appendWorkflowArtifact(data: {
  projectId: number;
  stepNumber?: number | null;
  runId?: number | null;
  iteration?: number | null;
  artifactType: WorkflowArtifactType;
  source?: "user" | "agent" | "system";
  visibility?: "user" | "agent" | "both";
  title: string;
  content: string;
  payload?: Record<string, any>;
}): Promise<WorkflowArtifact> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [inserted] = await db
    .insert(workflowArtifacts)
    .values({
      projectId: data.projectId,
      ...(typeof data.stepNumber === "number" ? { stepNumber: data.stepNumber } : {}),
      ...(typeof data.runId === "number" ? { runId: data.runId } : {}),
      ...(typeof data.iteration === "number" ? { iteration: data.iteration } : {}),
      artifactType: data.artifactType,
      source: data.source ?? "system",
      visibility: data.visibility ?? "both",
      title: data.title,
      content: data.content,
      payload: data.payload,
    })
    .$returningId();

  const [created] = await db
    .select()
    .from(workflowArtifacts)
    .where(eq(workflowArtifacts.id, inserted.id));

  if (!created) throw new Error("Failed to append workflow artifact");
  return created;
}

export async function getWorkflowArtifacts(params: {
  projectId: number;
  stepNumber?: number;
  artifactTypes?: WorkflowArtifactType[];
  limit?: number;
}): Promise<WorkflowArtifact[]> {
  const db = await getDb();
  if (!db) return [];

  const whereBase =
    typeof params.stepNumber === "number"
      ? and(
          eq(workflowArtifacts.projectId, params.projectId),
          eq(workflowArtifacts.stepNumber, params.stepNumber)
        )
      : eq(workflowArtifacts.projectId, params.projectId);

  if (params.artifactTypes && params.artifactTypes.length > 0) {
    return db
      .select()
      .from(workflowArtifacts)
      .where(and(whereBase, inArray(workflowArtifacts.artifactType, params.artifactTypes)))
      .orderBy(desc(workflowArtifacts.createdAt))
      .limit(params.limit ?? 120);
  }

  return db
    .select()
    .from(workflowArtifacts)
    .where(whereBase)
    .orderBy(desc(workflowArtifacts.createdAt))
    .limit(params.limit ?? 120);
}

export async function getAgentContextArtifacts(
  projectId: number,
  stepNumber: number,
  limit = 80
): Promise<WorkflowArtifact[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(workflowArtifacts)
    .where(
      and(
        eq(workflowArtifacts.projectId, projectId),
        inArray(workflowArtifacts.visibility, ["both", "agent"])
      )
    )
    .orderBy(desc(workflowArtifacts.createdAt))
    .limit(limit)
    .then((rows) =>
      rows.filter(
        (row) =>
          row.stepNumber == null ||
          row.stepNumber <= stepNumber ||
          row.artifactType === "change_request" ||
          row.artifactType === "change_analysis"
      )
    );
}

export async function resetWorkflowFromStep(
  projectId: number,
  startStep: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    const affectedSteps = await tx
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.projectId, projectId),
          gte(workflowSteps.stepNumber, startStep)
        )
      )
      .orderBy(workflowSteps.stepNumber);

    for (const step of affectedSteps) {
      if (step.output || step.input) {
        await tx.insert(workflowArtifacts).values({
          projectId,
          stepNumber: step.stepNumber,
          artifactType: "snapshot",
          source: "system",
          visibility: "both",
          title: `迭代前快照 · Step ${step.stepNumber + 1}`,
          content: `status=${step.status}\n\n${JSON.stringify(
            { input: step.input, output: step.output },
            null,
            2
          )}`,
          payload: {
            snapshotAt: new Date().toISOString(),
            previousStatus: step.status,
            input: step.input,
            output: step.output,
          },
        });
      }

      await tx
        .update(workflowSteps)
        .set({
          status: "pending",
          input: null,
          output: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(workflowSteps.id, step.id));
    }
  });
}

/**
 * Workflow uploaded assets related DB operations
 */
export type WorkflowAssetType = "document" | "image" | "prototype" | "other";

export async function appendWorkflowAsset(data: {
  projectId: number;
  stepNumber?: number | null;
  assetType: WorkflowAssetType;
  scope?: "project" | "step";
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  sourceLabel?: string;
  note?: string;
}): Promise<WorkflowAsset> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [inserted] = await db
    .insert(workflowAssets)
    .values({
      projectId: data.projectId,
      ...(typeof data.stepNumber === "number" ? { stepNumber: data.stepNumber } : {}),
      assetType: data.assetType,
      scope: data.scope ?? (typeof data.stepNumber === "number" ? "step" : "project"),
      fileName: data.fileName,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      storageKey: data.storageKey,
      sourceLabel: data.sourceLabel,
      note: data.note,
    })
    .$returningId();

  const [created] = await db
    .select()
    .from(workflowAssets)
    .where(eq(workflowAssets.id, inserted.id));
  if (!created) throw new Error("Failed to append workflow asset");
  return created;
}

export async function getWorkflowAssets(params: {
  projectId: number;
  stepNumber?: number;
  limit?: number;
}): Promise<WorkflowAsset[]> {
  const db = await getDb();
  if (!db) return [];

  const whereBase =
    typeof params.stepNumber === "number"
      ? and(
          eq(workflowAssets.projectId, params.projectId),
          or(
            eq(workflowAssets.scope, "project"),
            and(eq(workflowAssets.scope, "step"), eq(workflowAssets.stepNumber, params.stepNumber))
          )
        )
      : eq(workflowAssets.projectId, params.projectId);

  return db
    .select()
    .from(workflowAssets)
    .where(whereBase)
    .orderBy(desc(workflowAssets.createdAt))
    .limit(params.limit ?? 120);
}

export async function getWorkflowAssetsWithUrls(params: {
  projectId: number;
  stepNumber?: number;
  limit?: number;
}): Promise<Array<WorkflowAsset & { url: string | null }>> {
  const assets = await getWorkflowAssets(params);
  return Promise.all(
    assets.map(async (asset) => {
      try {
        const resolved = await storageGet(asset.storageKey);
        return { ...asset, url: resolved.url };
      } catch {
        return { ...asset, url: null };
      }
    })
  );
}

export async function getAgentContextAssetsWithUrls(
  projectId: number,
  stepNumber: number,
  limit = 20
): Promise<Array<WorkflowAsset & { url: string | null }>> {
  const db = await getDb();
  if (!db) return [];

  const assets = await db
    .select()
    .from(workflowAssets)
    .where(
      and(
        eq(workflowAssets.projectId, projectId),
        or(
          eq(workflowAssets.scope, "project"),
          and(eq(workflowAssets.scope, "step"), lte(workflowAssets.stepNumber, stepNumber))
        )
      )
    )
    .orderBy(desc(workflowAssets.createdAt))
    .limit(limit);

  return Promise.all(
    assets.map(async (asset) => {
      try {
        const resolved = await storageGet(asset.storageKey);
        return { ...asset, url: resolved.url };
      } catch {
        return { ...asset, url: null };
      }
    })
  );
}

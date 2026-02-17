import { eq, and, desc } from "drizzle-orm";
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
  type WorkflowStep,
  workflowSteps,
} from "../drizzle/schema";

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

export async function deleteProject(projectId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(agentActions).where(eq(agentActions.projectId, projectId));
  await db.delete(agentRuns).where(eq(agentRuns.projectId, projectId));
  await db.delete(conversationHistory).where(eq(conversationHistory.projectId, projectId));

  // 先删除所有相关的 workflow steps
  await db.delete(workflowSteps).where(eq(workflowSteps.projectId, projectId));
  
  // 再删除项目
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
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
export async function startAgentRun(
  projectId: number,
  stepNumber: number,
  strategy: string = "loop-v1"
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
    })
    .$returningId();

  const [created] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, inserted.id));
  if (!created) throw new Error("Failed to start agent run");
  return created;
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
  finalOutput?: Record<string, any>;
  errorMessage?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(agentRuns)
    .set({
      status: data.status,
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

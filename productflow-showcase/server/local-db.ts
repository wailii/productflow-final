import fs from "node:fs";
import path from "node:path";
import type {
  AgentAction,
  AgentRun,
  ConversationMessage,
  InsertUser,
  LocalCredential,
  Project,
  User,
  UserAiSetting,
  WorkflowArtifact,
  WorkflowAsset,
  WorkflowStep,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getLocalStorageDirectory } from "./storage";

type AgentStage =
  | "context"
  | "plan"
  | "draft"
  | "review"
  | "final"
  | "completed"
  | "error";

type WorkflowArtifactType =
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

type WorkflowAssetType = "document" | "image" | "prototype" | "other";

type LocalDbState = {
  users: User[];
  localCredentials: LocalCredential[];
  userAiSettings: UserAiSetting[];
  projects: Project[];
  workflowSteps: WorkflowStep[];
  conversationHistory: ConversationMessage[];
  agentRuns: AgentRun[];
  agentActions: AgentAction[];
  workflowArtifacts: WorkflowArtifact[];
  workflowAssets: WorkflowAsset[];
  counters: Record<string, number>;
};

const LOCAL_DB_FILE = path.resolve(
  getLocalStorageDirectory(),
  "..",
  "local-db.json"
);

let stateCache: LocalDbState | null = null;

const DATE_FIELDS: Record<string, string[]> = {
  users: ["createdAt", "updatedAt", "lastSignedIn"],
  localCredentials: ["createdAt", "updatedAt"],
  userAiSettings: ["createdAt", "updatedAt"],
  projects: ["createdAt", "updatedAt"],
  workflowSteps: ["createdAt", "updatedAt"],
  conversationHistory: ["createdAt"],
  agentRuns: ["startedAt", "finishedAt"],
  agentActions: ["createdAt"],
  workflowArtifacts: ["createdAt"],
  workflowAssets: ["createdAt"],
};

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function hydrateDates<T extends Record<string, unknown>>(rows: T[], table: string): T[] {
  const fields = DATE_FIELDS[table] ?? [];
  return rows.map((row) => {
    const cloned: Record<string, unknown> = { ...row };
    for (const field of fields) {
      const raw = cloned[field];
      if (raw == null) {
        cloned[field] = null;
      } else {
        cloned[field] = toDate(raw);
      }
    }
    return cloned as T;
  });
}

function ensureDir() {
  fs.mkdirSync(path.dirname(LOCAL_DB_FILE), { recursive: true });
}

function emptyState(): LocalDbState {
  return {
    users: [],
    localCredentials: [],
    userAiSettings: [],
    projects: [],
    workflowSteps: [],
    conversationHistory: [],
    agentRuns: [],
    agentActions: [],
    workflowArtifacts: [],
    workflowAssets: [],
    counters: {},
  };
}

function normalizeState(raw: Partial<LocalDbState>): LocalDbState {
  const merged: LocalDbState = {
    ...emptyState(),
    ...raw,
  };

  merged.users = hydrateDates<User>((merged.users ?? []) as User[], "users");
  merged.localCredentials = hydrateDates<LocalCredential>(
    (merged.localCredentials ?? []) as LocalCredential[],
    "localCredentials"
  );
  merged.userAiSettings = hydrateDates<UserAiSetting>(
    (merged.userAiSettings ?? []) as UserAiSetting[],
    "userAiSettings"
  );
  merged.projects = hydrateDates<Project>((merged.projects ?? []) as Project[], "projects");
  merged.workflowSteps = hydrateDates<WorkflowStep>(
    (merged.workflowSteps ?? []) as WorkflowStep[],
    "workflowSteps"
  );
  merged.conversationHistory = hydrateDates<ConversationMessage>(
    (merged.conversationHistory ?? []) as ConversationMessage[],
    "conversationHistory"
  );
  merged.agentRuns = hydrateDates<AgentRun>((merged.agentRuns ?? []) as AgentRun[], "agentRuns");
  merged.agentActions = hydrateDates<AgentAction>(
    (merged.agentActions ?? []) as AgentAction[],
    "agentActions"
  );
  merged.workflowArtifacts = hydrateDates<WorkflowArtifact>(
    (merged.workflowArtifacts ?? []) as WorkflowArtifact[],
    "workflowArtifacts"
  );
  merged.workflowAssets = hydrateDates<WorkflowAsset>(
    (merged.workflowAssets ?? []) as WorkflowAsset[],
    "workflowAssets"
  );

  if (!merged.counters || typeof merged.counters !== "object") {
    merged.counters = {};
  }

  return merged;
}

function loadState(): LocalDbState {
  if (stateCache) return stateCache;

  ensureDir();
  if (!fs.existsSync(LOCAL_DB_FILE)) {
    stateCache = emptyState();
    return stateCache;
  }

  try {
    const content = fs.readFileSync(LOCAL_DB_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<LocalDbState>;
    stateCache = normalizeState(parsed);
  } catch {
    stateCache = emptyState();
  }

  return stateCache;
}

function persistState() {
  const state = loadState();
  ensureDir();
  fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(state, null, 2), "utf8");
}

function nextId(table: keyof LocalDbState): number {
  const state = loadState();
  const key = String(table);
  const current = state.counters[key] ?? 1;
  state.counters[key] = current + 1;
  return current;
}

function cloneRow<T>(row: T): T {
  return { ...(row as Record<string, unknown>) } as T;
}

function sortByDateDesc<T extends Record<string, unknown>>(rows: T[], field: keyof T): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(String(a[field] ?? "")).getTime();
    const tb = new Date(String(b[field] ?? "")).getTime();
    return tb - ta;
  });
}

function sortByDateAsc<T extends Record<string, unknown>>(rows: T[], field: keyof T): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(String(a[field] ?? "")).getTime();
    const tb = new Date(String(b[field] ?? "")).getTime();
    return ta - tb;
  });
}

export async function upsertUser(user: InsertUser): Promise<void> {
  const state = loadState();
  const now = new Date();
  const existing = state.users.find((item) => item.openId === user.openId);

  if (!existing) {
    state.users.push({
      id: nextId("users"),
      openId: user.openId!,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role:
        user.role ??
        (user.openId === ENV.ownerOpenId && ENV.ownerOpenId ? "admin" : "user"),
      createdAt: user.createdAt ?? now,
      updatedAt: now,
      lastSignedIn: user.lastSignedIn ?? now,
    });
    persistState();
    return;
  }

  if (user.name !== undefined) existing.name = user.name ?? null;
  if (user.email !== undefined) existing.email = user.email ?? null;
  if (user.loginMethod !== undefined) existing.loginMethod = user.loginMethod ?? null;
  if (user.role !== undefined) {
    existing.role = user.role;
  } else if (existing.openId === ENV.ownerOpenId && ENV.ownerOpenId) {
    existing.role = "admin";
  }
  if (user.lastSignedIn !== undefined) existing.lastSignedIn = user.lastSignedIn;
  existing.updatedAt = now;
  persistState();
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const state = loadState();
  const found = state.users.find((item) => item.openId === openId);
  return found ? cloneRow(found) : undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const state = loadState();
  const normalized = email.trim().toLowerCase();
  const found = state.users.find(
    (item) => (item.email ?? "").trim().toLowerCase() === normalized
  );
  return found ? cloneRow(found) : undefined;
}

export async function getLocalCredentialByUserId(
  userId: number
): Promise<LocalCredential | undefined> {
  const state = loadState();
  const found = state.localCredentials.find((item) => item.userId === userId);
  return found ? cloneRow(found) : undefined;
}

export async function upsertLocalCredential(
  userId: number,
  passwordHash: string
): Promise<void> {
  const state = loadState();
  const now = new Date();
  const found = state.localCredentials.find((item) => item.userId === userId);

  if (!found) {
    state.localCredentials.push({
      id: nextId("localCredentials"),
      userId,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    persistState();
    return;
  }

  found.passwordHash = passwordHash;
  found.updatedAt = now;
  persistState();
}

export async function createProject(
  userId: number,
  title: string,
  rawRequirement: string
): Promise<Project> {
  const state = loadState();
  const now = new Date();
  const created: Project = {
    id: nextId("projects"),
    userId,
    title,
    rawRequirement,
    status: "draft",
    currentStep: 0,
    createdAt: now,
    updatedAt: now,
  };
  state.projects.push(created);
  persistState();
  return cloneRow(created);
}

export async function createProjectWithSteps(
  userId: number,
  title: string,
  rawRequirement: string
): Promise<Project> {
  const created = await createProject(userId, title, rawRequirement);
  const state = loadState();
  const now = new Date();
  for (let stepNumber = 0; stepNumber < 9; stepNumber++) {
    state.workflowSteps.push({
      id: nextId("workflowSteps"),
      projectId: created.id,
      stepNumber,
      status: "pending",
      input: null,
      output: null,
      aiPrompt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  persistState();
  return created;
}

export async function getProjectsByUserId(userId: number): Promise<Project[]> {
  const state = loadState();
  return sortByDateDesc(
    state.projects.filter((item) => item.userId === userId),
    "updatedAt"
  ).map(cloneRow);
}

export async function getProjectById(
  projectId: number,
  userId: number
): Promise<Project | null> {
  const state = loadState();
  const found = state.projects.find(
    (item) => item.id === projectId && item.userId === userId
  );
  return found ? cloneRow(found) : null;
}

export async function updateProjectStep(
  projectId: number,
  currentStep: number,
  status: "draft" | "in_progress" | "completed" | "archived"
): Promise<void> {
  const state = loadState();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  project.currentStep = currentStep;
  project.status = status;
  project.updatedAt = new Date();
  persistState();
}

export async function updateProjectRawRequirement(
  projectId: number,
  rawRequirement: string
): Promise<void> {
  const state = loadState();
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  project.rawRequirement = rawRequirement;
  project.updatedAt = new Date();
  persistState();
}

export async function deleteProject(projectId: number, userId: number): Promise<void> {
  const state = loadState();
  state.projects = state.projects.filter(
    (item) => !(item.id === projectId && item.userId === userId)
  );
  state.workflowSteps = state.workflowSteps.filter((item) => item.projectId !== projectId);
  state.conversationHistory = state.conversationHistory.filter(
    (item) => item.projectId !== projectId
  );
  state.agentRuns = state.agentRuns.filter((item) => item.projectId !== projectId);
  state.agentActions = state.agentActions.filter((item) => item.projectId !== projectId);
  state.workflowArtifacts = state.workflowArtifacts.filter(
    (item) => item.projectId !== projectId
  );
  state.workflowAssets = state.workflowAssets.filter((item) => item.projectId !== projectId);
  persistState();
}

export async function getUserAiSettingByUserId(
  userId: number
): Promise<UserAiSetting | null> {
  const state = loadState();
  const found = state.userAiSettings.find((item) => item.userId === userId);
  return found ? cloneRow(found) : null;
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
  const state = loadState();
  const now = new Date();
  const found = state.userAiSettings.find((item) => item.userId === data.userId);
  if (!found) {
    const created: UserAiSetting = {
      id: nextId("userAiSettings"),
      userId: data.userId,
      providerId: data.providerId,
      baseUrl: data.baseUrl,
      model: data.model,
      apiKeyEncrypted: data.apiKeyEncrypted ?? null,
      enabled: data.enabled ? 1 : 0,
      metadata: data.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };
    state.userAiSettings.push(created);
    persistState();
    return cloneRow(created);
  }

  found.providerId = data.providerId;
  found.baseUrl = data.baseUrl;
  found.model = data.model;
  found.apiKeyEncrypted = data.apiKeyEncrypted ?? null;
  found.enabled = data.enabled ? 1 : 0;
  found.metadata = data.metadata ?? null;
  found.updatedAt = now;
  persistState();
  return cloneRow(found);
}

export async function createWorkflowStep(
  projectId: number,
  stepNumber: number
): Promise<WorkflowStep> {
  const state = loadState();
  const now = new Date();
  const created: WorkflowStep = {
    id: nextId("workflowSteps"),
    projectId,
    stepNumber,
    status: "pending",
    input: null,
    output: null,
    aiPrompt: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
  state.workflowSteps.push(created);
  persistState();
  return cloneRow(created);
}

export async function getWorkflowStepsByProjectId(projectId: number): Promise<WorkflowStep[]> {
  const state = loadState();
  return [...state.workflowSteps]
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .map(cloneRow);
}

export async function getWorkflowStep(
  projectId: number,
  stepNumber: number
): Promise<WorkflowStep | null> {
  const state = loadState();
  const found = state.workflowSteps.find(
    (item) => item.projectId === projectId && item.stepNumber === stepNumber
  );
  return found ? cloneRow(found) : null;
}

export async function updateWorkflowStep(
  stepId: number,
  data: {
    status?: "pending" | "processing" | "completed" | "error";
    input?: Record<string, any> | null;
    output?: Record<string, any> | null;
    aiPrompt?: string | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  const state = loadState();
  const found = state.workflowSteps.find((item) => item.id === stepId);
  if (!found) return;
  Object.assign(found, data, { updatedAt: new Date() });
  persistState();
}

export async function initializeWorkflowSteps(projectId: number): Promise<void> {
  const state = loadState();
  const now = new Date();
  for (let stepNumber = 0; stepNumber < 9; stepNumber++) {
    if (
      state.workflowSteps.some(
        (item) => item.projectId === projectId && item.stepNumber === stepNumber
      )
    ) {
      continue;
    }
    state.workflowSteps.push({
      id: nextId("workflowSteps"),
      projectId,
      stepNumber,
      status: "pending",
      input: null,
      output: null,
      aiPrompt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  persistState();
}

export async function ensureWorkflowStepsByProjectId(
  projectId: number
): Promise<WorkflowStep[]> {
  await initializeWorkflowSteps(projectId);
  return getWorkflowStepsByProjectId(projectId);
}

export async function addConversationMessage(
  projectId: number,
  stepNumber: number,
  role: "user" | "assistant" | "system",
  content: string
): Promise<ConversationMessage> {
  const state = loadState();
  const created: ConversationMessage = {
    id: nextId("conversationHistory"),
    projectId,
    stepNumber,
    role,
    content,
    createdAt: new Date(),
  };
  state.conversationHistory.push(created);
  persistState();
  return cloneRow(created);
}

export async function getConversationHistory(
  projectId: number,
  stepNumber: number
): Promise<ConversationMessage[]> {
  const state = loadState();
  return sortByDateAsc(
    state.conversationHistory.filter(
      (item) => item.projectId === projectId && item.stepNumber === stepNumber
    ),
    "createdAt"
  ).map(cloneRow);
}

export async function getProjectConversationHistory(
  projectId: number
): Promise<ConversationMessage[]> {
  const state = loadState();
  return sortByDateAsc(
    state.conversationHistory.filter((item) => item.projectId === projectId),
    "createdAt"
  ).map(cloneRow);
}

export async function clearConversationHistory(
  projectId: number,
  stepNumber: number
): Promise<void> {
  const state = loadState();
  state.conversationHistory = state.conversationHistory.filter(
    (item) => !(item.projectId === projectId && item.stepNumber === stepNumber)
  );
  persistState();
}

export async function startAgentRun(
  projectId: number,
  stepNumber: number,
  strategy = "agent-v2"
): Promise<AgentRun> {
  const state = loadState();
  const created: AgentRun = {
    id: nextId("agentRuns"),
    projectId,
    stepNumber,
    strategy,
    status: "running",
    currentStage: "context",
    currentIteration: 0,
    stateSnapshot: null,
    finalOutput: null,
    errorMessage: null,
    startedAt: new Date(),
    finishedAt: null,
  };
  state.agentRuns.push(created);
  persistState();
  return cloneRow(created);
}

export async function updateAgentRunProgress(data: {
  runId: number;
  currentStage: AgentStage;
  currentIteration?: number;
  stateSnapshot?: Record<string, any>;
}): Promise<void> {
  const state = loadState();
  const run = state.agentRuns.find((item) => item.id === data.runId);
  if (!run) return;
  run.currentStage = data.currentStage;
  if (typeof data.currentIteration === "number") {
    run.currentIteration = data.currentIteration;
  }
  if (data.stateSnapshot) {
    run.stateSnapshot = data.stateSnapshot;
  }
  persistState();
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
  const state = loadState();
  const created: AgentAction = {
    id: nextId("agentActions"),
    runId: data.runId,
    projectId: data.projectId,
    stepNumber: data.stepNumber,
    actionType: data.actionType,
    title: data.title,
    content: data.content,
    metadata: data.metadata ?? null,
    createdAt: new Date(),
  };
  state.agentActions.push(created);
  persistState();
  return cloneRow(created);
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
  const state = loadState();
  const run = state.agentRuns.find((item) => item.id === data.runId);
  if (!run) return;
  run.status = data.status;
  run.currentStage = data.currentStage;
  if (typeof data.currentIteration === "number") {
    run.currentIteration = data.currentIteration;
  }
  if (data.stateSnapshot) run.stateSnapshot = data.stateSnapshot;
  run.finalOutput = data.finalOutput ?? null;
  run.errorMessage = data.errorMessage ?? null;
  run.finishedAt = new Date();
  persistState();
}

export async function getLatestAgentRunByStep(
  projectId: number,
  stepNumber: number
): Promise<AgentRun | null> {
  const state = loadState();
  const found = sortByDateDesc(
    state.agentRuns.filter(
      (item) => item.projectId === projectId && item.stepNumber === stepNumber
    ),
    "startedAt"
  )[0];
  return found ? cloneRow(found) : null;
}

export async function getAgentActionsByRunId(runId: number): Promise<AgentAction[]> {
  const state = loadState();
  return sortByDateAsc(
    state.agentActions.filter((item) => item.runId === runId),
    "createdAt"
  ).map(cloneRow);
}

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
  const state = loadState();
  const created: WorkflowArtifact = {
    id: nextId("workflowArtifacts"),
    projectId: data.projectId,
    stepNumber: typeof data.stepNumber === "number" ? data.stepNumber : null,
    runId: typeof data.runId === "number" ? data.runId : null,
    iteration: typeof data.iteration === "number" ? data.iteration : null,
    artifactType: data.artifactType,
    source: data.source ?? "system",
    visibility: data.visibility ?? "both",
    title: data.title,
    content: data.content,
    payload: data.payload ?? null,
    createdAt: new Date(),
  };
  state.workflowArtifacts.push(created);
  persistState();
  return cloneRow(created);
}

export async function getWorkflowArtifacts(params: {
  projectId: number;
  stepNumber?: number;
  artifactTypes?: WorkflowArtifactType[];
  limit?: number;
}): Promise<WorkflowArtifact[]> {
  const state = loadState();
  let rows = state.workflowArtifacts.filter((item) => item.projectId === params.projectId);
  if (typeof params.stepNumber === "number") {
    rows = rows.filter((item) => item.stepNumber === params.stepNumber);
  }
  if (params.artifactTypes && params.artifactTypes.length > 0) {
    const allowed = new Set(params.artifactTypes);
    rows = rows.filter((item) => allowed.has(item.artifactType as WorkflowArtifactType));
  }
  return sortByDateDesc(rows, "createdAt")
    .slice(0, params.limit ?? 120)
    .map(cloneRow);
}

export async function getAgentContextArtifacts(
  projectId: number,
  stepNumber: number,
  limit = 80
): Promise<WorkflowArtifact[]> {
  const rows = await getWorkflowArtifacts({ projectId, limit: 5000 });
  return rows
    .filter((row) => row.visibility === "both" || row.visibility === "agent")
    .filter(
      (row) =>
        row.stepNumber == null ||
        row.stepNumber <= stepNumber ||
        row.artifactType === "change_request" ||
        row.artifactType === "change_analysis"
    )
    .slice(0, limit);
}

export async function resetWorkflowFromStep(
  projectId: number,
  startStep: number
): Promise<void> {
  const state = loadState();
  const targetSteps = state.workflowSteps
    .filter((item) => item.projectId === projectId && item.stepNumber >= startStep)
    .sort((a, b) => a.stepNumber - b.stepNumber);

  for (const step of targetSteps) {
    if (step.output || step.input) {
      state.workflowArtifacts.push({
        id: nextId("workflowArtifacts"),
        projectId,
        stepNumber: step.stepNumber,
        runId: null,
        iteration: null,
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
        createdAt: new Date(),
      });
    }

    step.status = "pending";
    step.input = null;
    step.output = null;
    step.errorMessage = null;
    step.updatedAt = new Date();
  }

  persistState();
}

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
  const state = loadState();
  const created: WorkflowAsset = {
    id: nextId("workflowAssets"),
    projectId: data.projectId,
    stepNumber: typeof data.stepNumber === "number" ? data.stepNumber : null,
    assetType: data.assetType,
    scope: data.scope ?? (typeof data.stepNumber === "number" ? "step" : "project"),
    fileName: data.fileName,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    storageKey: data.storageKey,
    sourceLabel: data.sourceLabel ?? null,
    note: data.note ?? null,
    createdAt: new Date(),
  };
  state.workflowAssets.push(created);
  persistState();
  return cloneRow(created);
}

export async function getWorkflowAssets(params: {
  projectId: number;
  stepNumber?: number;
  limit?: number;
}): Promise<WorkflowAsset[]> {
  const state = loadState();
  let rows = state.workflowAssets.filter((item) => item.projectId === params.projectId);

  if (typeof params.stepNumber === "number") {
    rows = rows.filter(
      (item) =>
        item.scope === "project" ||
        (item.scope === "step" && item.stepNumber === params.stepNumber)
    );
  }

  return sortByDateDesc(rows, "createdAt")
    .slice(0, params.limit ?? 120)
    .map(cloneRow);
}

export async function getAgentContextAssets(
  projectId: number,
  stepNumber: number,
  limit = 20
): Promise<WorkflowAsset[]> {
  const state = loadState();
  const rows = state.workflowAssets.filter(
    (item) =>
      item.projectId === projectId &&
      (item.scope === "project" ||
        (item.scope === "step" &&
          typeof item.stepNumber === "number" &&
          item.stepNumber <= stepNumber))
  );
  return sortByDateDesc(rows, "createdAt").slice(0, limit).map(cloneRow);
}

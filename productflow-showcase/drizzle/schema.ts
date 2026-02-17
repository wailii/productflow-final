import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Local auth credentials table.
 * Stores password hash separately from user profile data.
 */
export const localCredentials = mysqlTable(
  "local_credentials",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userUniqueIdx: uniqueIndex("uidx_local_credentials_user").on(table.userId),
  })
);

export type LocalCredential = typeof localCredentials.$inferSelect;
export type InsertLocalCredential = typeof localCredentials.$inferInsert;

/**
 * Projects table - stores user's requirement analysis projects
 */
export const projects = mysqlTable(
  "projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    rawRequirement: text("rawRequirement").notNull(), // 用户输入的原始需求
    status: mysqlEnum("status", ["draft", "in_progress", "completed", "archived"]).default("draft").notNull(),
    currentStep: int("currentStep").default(0).notNull(), // 当前进行到第几步 (0-9)
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userUpdatedAtIdx: index("idx_projects_user_updated").on(table.userId, table.updatedAt),
  })
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Workflow steps table - stores the output of each step for each project
 */
export const workflowSteps = mysqlTable(
  "workflow_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    stepNumber: int("stepNumber").notNull(), // 1-9
    status: mysqlEnum("status", ["pending", "processing", "completed", "error"]).default("pending").notNull(),
    input: json("input").$type<Record<string, any>>(), // 该步骤的输入数据
    output: json("output").$type<Record<string, any>>(), // 该步骤的输出数据
    aiPrompt: text("aiPrompt"), // 使用的 AI Prompt
    errorMessage: text("errorMessage"), // 如果出错，记录错误信息
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    projectStepUniqueIdx: uniqueIndex("uidx_workflow_steps_project_step").on(
      table.projectId,
      table.stepNumber
    ),
  })
);

export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type InsertWorkflowStep = typeof workflowSteps.$inferInsert;

/**
 * Conversation history table - stores multi-turn dialogue for each step
 */
export const conversationHistory = mysqlTable(
  "conversation_history",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    stepNumber: int("stepNumber").notNull(),
    role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    projectStepCreatedIdx: index("idx_conversation_project_step_created").on(
      table.projectId,
      table.stepNumber,
      table.createdAt
    ),
  })
);

export type ConversationMessage = typeof conversationHistory.$inferSelect;
export type InsertConversationMessage = typeof conversationHistory.$inferInsert;

/**
 * Agent run table - one execution run per workflow step trigger
 */
export const agentRuns = mysqlTable(
  "agent_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    stepNumber: int("stepNumber").notNull(),
    strategy: varchar("strategy", { length: 64 }).default("loop-v1").notNull(),
    status: mysqlEnum("status", ["running", "completed", "error"]).default("running").notNull(),
    currentStage: mysqlEnum("currentStage", [
      "context",
      "plan",
      "draft",
      "review",
      "final",
      "completed",
      "error",
    ])
      .default("context")
      .notNull(),
    currentIteration: int("currentIteration").default(0).notNull(),
    stateSnapshot: json("stateSnapshot").$type<Record<string, any>>(),
    finalOutput: json("finalOutput").$type<Record<string, any>>(),
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    finishedAt: timestamp("finishedAt"),
  },
  (table) => ({
    projectStepStartedIdx: index("idx_agent_runs_project_step_started").on(
      table.projectId,
      table.stepNumber,
      table.startedAt
    ),
  })
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = typeof agentRuns.$inferInsert;

/**
 * Agent action table - detailed trace records within one run
 */
export const agentActions = mysqlTable(
  "agent_actions",
  {
    id: int("id").autoincrement().primaryKey(),
    runId: int("runId").notNull(),
    projectId: int("projectId").notNull(),
    stepNumber: int("stepNumber").notNull(),
    actionType: mysqlEnum("actionType", [
      "context",
      "plan",
      "draft",
      "review",
      "final",
      "error",
    ]).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    content: text("content").notNull(),
    metadata: json("metadata").$type<Record<string, any>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    runCreatedIdx: index("idx_agent_actions_run_created").on(
      table.runId,
      table.createdAt
    ),
    projectStepCreatedIdx: index("idx_agent_actions_project_step_created").on(
      table.projectId,
      table.stepNumber,
      table.createdAt
    ),
  })
);

export type AgentAction = typeof agentActions.$inferSelect;
export type InsertAgentAction = typeof agentActions.$inferInsert;

/**
 * Workflow artifact table - lifecycle assets for each round and change request
 */
export const workflowArtifacts = mysqlTable(
  "workflow_artifacts",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    stepNumber: int("stepNumber"),
    runId: int("runId"),
    iteration: int("iteration"),
    artifactType: mysqlEnum("artifactType", [
      "step_input",
      "step_output",
      "plan",
      "draft",
      "review",
      "final",
      "conversation_note",
      "change_request",
      "change_analysis",
      "snapshot",
    ]).notNull(),
    source: mysqlEnum("source", ["user", "agent", "system"]).default("system").notNull(),
    visibility: mysqlEnum("visibility", ["user", "agent", "both"]).default("both").notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    content: text("content").notNull(),
    payload: json("payload").$type<Record<string, any>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    projectStepCreatedIdx: index("idx_artifacts_project_step_created").on(
      table.projectId,
      table.stepNumber,
      table.createdAt
    ),
    projectTypeCreatedIdx: index("idx_artifacts_project_type_created").on(
      table.projectId,
      table.artifactType,
      table.createdAt
    ),
    runIterationIdx: index("idx_artifacts_run_iteration").on(
      table.runId,
      table.iteration,
      table.createdAt
    ),
  })
);

export type WorkflowArtifact = typeof workflowArtifacts.$inferSelect;
export type InsertWorkflowArtifact = typeof workflowArtifacts.$inferInsert;

/**
 * Workflow assets table - uploaded files/images used across lifecycle
 */
export const workflowAssets = mysqlTable(
  "workflow_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    stepNumber: int("stepNumber"),
    assetType: mysqlEnum("assetType", ["document", "image", "prototype", "other"])
      .default("other")
      .notNull(),
    scope: mysqlEnum("scope", ["project", "step"]).default("project").notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    mimeType: varchar("mimeType", { length: 160 }).notNull(),
    fileSize: int("fileSize").notNull(),
    storageKey: varchar("storageKey", { length: 500 }).notNull(),
    sourceLabel: varchar("sourceLabel", { length: 120 }),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    projectStepCreatedIdx: index("idx_assets_project_step_created").on(
      table.projectId,
      table.stepNumber,
      table.createdAt
    ),
    projectAssetTypeIdx: index("idx_assets_project_type_created").on(
      table.projectId,
      table.assetType,
      table.createdAt
    ),
  })
);

export type WorkflowAsset = typeof workflowAssets.$inferSelect;
export type InsertWorkflowAsset = typeof workflowAssets.$inferInsert;

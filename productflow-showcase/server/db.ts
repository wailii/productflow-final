import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import fs from "node:fs/promises";
import path from "node:path";
import {
  InsertUser,
  localCredentials,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import * as localDb from "./local-db";

let _db: ReturnType<typeof drizzle> | null = null;
let _schemaInitPromise: Promise<void> | null = null;

const MIGRATION_FILE_PATTERN = /^\d+_.*\.sql$/;
const MIGRATION_BREAKPOINT = /-->\s*statement-breakpoint/g;
const IGNORABLE_MIGRATION_ERROR_CODES = new Set([
  "ER_TABLE_EXISTS_ERROR",
  "ER_DUP_KEYNAME",
  "ER_DUP_FIELDNAME",
]);

function getErrorCode(error: unknown): string {
  const directCode = (error as { code?: unknown })?.code;
  if (typeof directCode === "string" && directCode.length > 0) return directCode;
  const causeCode = (error as { cause?: { code?: unknown } })?.cause?.code;
  if (typeof causeCode === "string" && causeCode.length > 0) return causeCode;
  return "";
}

function getErrorMessage(error: unknown): string {
  const direct = (error as { message?: unknown })?.message;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const cause = (error as { cause?: { message?: unknown } })?.cause?.message;
  if (typeof cause === "string" && cause.length > 0) return cause;
  return String(error ?? "");
}

function isDbConnectionError(error: unknown): boolean {
  const code = getErrorCode(error).toUpperCase();
  if (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "PROTOCOL_CONNECTION_LOST"
  ) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("ehostunreach") ||
    message.includes("can't connect") ||
    message.includes("getaddrinfo") ||
    message.includes("connection lost")
  );
}

function isIgnorableMigrationError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (IGNORABLE_MIGRATION_ERROR_CODES.has(code)) return true;

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("duplicate column name") ||
    message.includes("duplicate key name")
  );
}

function splitMigrationStatements(content: string): string[] {
  return content
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => statement.replace(/;+\s*$/g, "").trim())
    .filter((statement) => statement.length > 0);
}

async function readMigrationStatements(): Promise<string[]> {
  const migrationDir = path.resolve(process.cwd(), "drizzle");
  let entries: Array<{ isFile: () => boolean; name: string }>;
  try {
    entries = (await fs.readdir(migrationDir, {
      withFileTypes: true,
      encoding: "utf8",
    })) as Array<{ isFile: () => boolean; name: string }>;
  } catch {
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const statements: string[] = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(migrationDir, file), "utf8");
    statements.push(...splitMigrationStatements(content));
  }

  return statements;
}

async function ensureSchemaInitialized(db: ReturnType<typeof drizzle>) {
  if (_schemaInitPromise) {
    await _schemaInitPromise;
    return;
  }

  _schemaInitPromise = (async () => {
    const statements = await readMigrationStatements();
    if (statements.length === 0) return;

    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (error) {
        if (isIgnorableMigrationError(error)) continue;
        throw error;
      }
    }
  })().catch((error) => {
    _schemaInitPromise = null;
    throw error;
  });

  await _schemaInitPromise;
}

async function runWithLocalFallback<T>(
  taskName: string,
  operation: (db: ReturnType<typeof drizzle>) => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) {
    return fallback();
  }

  try {
    return await operation(db);
  } catch (error) {
    if (isDbConnectionError(error)) {
      console.warn(`[Database] ${taskName} failed, fallback to local DB:`, getErrorMessage(error));
      return fallback();
    }
    throw error;
  }
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      _db = drizzle(ENV.databaseUrl);
    } catch (error) {
      console.warn("[Database] Failed to initialize client:", error);
      _db = null;
    }
  }

  if (_db) {
    try {
      await ensureSchemaInitialized(_db);
    } catch (error) {
      if (isDbConnectionError(error)) {
        console.warn("[Database] Schema init failed, fallback to local DB:", getErrorMessage(error));
        _db = null;
        _schemaInitPromise = null;
      } else {
        throw error;
      }
    }
  }

  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  await runWithLocalFallback(
    "upsertUser",
    async (db) => {
      const values: InsertUser = {
        openId: user.openId,
      };
      const updateSet: Record<string, unknown> = {};

      const textFields = ["name", "email", "loginMethod"] as const;
      type TextField = (typeof textFields)[number];

      const assignNullable = (field: TextField) => {
        const value = user[field];
        if (value === undefined) return;
        const normalized = value ?? null;
        values[field] = normalized;
        updateSet[field] = normalized;
      };

      textFields.forEach(assignNullable);

      if (user.lastSignedIn !== undefined) {
        values.lastSignedIn = user.lastSignedIn;
        updateSet.lastSignedIn = user.lastSignedIn;
      }
      if (user.role !== undefined) {
        values.role = user.role;
        updateSet.role = user.role;
      } else if (user.openId === ENV.ownerOpenId) {
        values.role = "admin";
        updateSet.role = "admin";
      }

      if (!values.lastSignedIn) {
        values.lastSignedIn = new Date();
      }

      if (Object.keys(updateSet).length === 0) {
        updateSet.lastSignedIn = new Date();
      }

      await db
        .insert(users)
        .values(values)
        .onDuplicateKeyUpdate({
          set: updateSet,
        });
    },
    async () => localDb.upsertUser(user)
  );
}

export async function getUserByOpenId(openId: string) {
  return runWithLocalFallback(
    "getUserByOpenId",
    async (db) => {
      const result = await db
        .select()
        .from(users)
        .where(eq(users.openId, openId))
        .limit(1);
      return result.length > 0 ? result[0] : undefined;
    },
    async () => localDb.getUserByOpenId(openId)
  );
}

export async function getUserByEmail(email: string) {
  return runWithLocalFallback(
    "getUserByEmail",
    async (db) => {
      const result = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return result.length > 0 ? result[0] : undefined;
    },
    async () => localDb.getUserByEmail(email)
  );
}

export async function getLocalCredentialByUserId(userId: number) {
  return runWithLocalFallback(
    "getLocalCredentialByUserId",
    async (db) => {
      const result = await db
        .select()
        .from(localCredentials)
        .where(eq(localCredentials.userId, userId))
        .limit(1);
      return result.length > 0 ? result[0] : undefined;
    },
    async () => localDb.getLocalCredentialByUserId(userId)
  );
}

export async function upsertLocalCredential(
  userId: number,
  passwordHash: string
): Promise<void> {
  await runWithLocalFallback(
    "upsertLocalCredential",
    async (db) => {
      await db
        .insert(localCredentials)
        .values({
          userId,
          passwordHash,
        })
        .onDuplicateKeyUpdate({
          set: {
            passwordHash,
          },
        });
    },
    async () => localDb.upsertLocalCredential(userId, passwordHash)
  );
}

// TODO: add feature queries here as your schema grows.

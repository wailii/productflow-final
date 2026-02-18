import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { hashPassword, verifyPassword } from "./password";
import { sdk } from "./sdk";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function buildLocalOpenId(email: string) {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `local_${digest}`;
}

function normalizeLocalAuthError(error: unknown): { status: number; message: string } {
  const rawMessage = String(
    (error as { message?: unknown })?.message ??
      (error as { cause?: { message?: unknown } })?.cause?.message ??
      ""
  ).toLowerCase();

  if (
    rawMessage.includes("enotfound") ||
    rawMessage.includes("econnrefused") ||
    rawMessage.includes("getaddrinfo") ||
    rawMessage.includes("can't connect")
  ) {
    return {
      status: 503,
      message: "数据库暂时不可用，请稍后重试。",
    };
  }

  if (rawMessage.includes("access denied")) {
    return {
      status: 503,
      message: "数据库账号或密码错误：请检查 DATABASE_URL 中的用户名和密码。",
    };
  }

  if (rawMessage.includes("doesn't exist") || rawMessage.includes("er_no_such_table")) {
    return {
      status: 503,
      message: "数据库已连接但表未初始化，请稍后重试一次。",
    };
  }

  return {
    status: 500,
    message: "Register failed",
  };
}

async function issueSession(
  req: Request,
  res: Response,
  openId: string,
  name: string
) {
  const sessionToken = await sdk.createSessionToken(openId, {
    name,
    expiresInMs: ONE_YEAR_MS,
  });
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, {
    ...cookieOptions,
    maxAge: ONE_YEAR_MS,
  });
}

export function registerLocalAuthRoutes(app: Express) {
  app.post("/api/auth/local/register", async (req: Request, res: Response) => {
    if (!ENV.enableLocalAuth) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid register payload" });
      return;
    }

    const normalizedEmail = normalizeEmail(parsed.data.email);
    const { name, password } = parsed.data;

    try {
      let user = await db.getUserByEmail(normalizedEmail);
      if (user) {
        const existingCredential = await db.getLocalCredentialByUserId(user.id);
        if (existingCredential) {
          res.status(409).json({ error: "Email already registered" });
          return;
        }
      } else {
        const openId = buildLocalOpenId(normalizedEmail);
        await db.upsertUser({
          openId,
          name,
          email: normalizedEmail,
          loginMethod: "local",
          lastSignedIn: new Date(),
        });
        user = await db.getUserByOpenId(openId);
      }

      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }

      const passwordHash = await hashPassword(password);
      await db.upsertLocalCredential(user.id, passwordHash);
      await db.upsertUser({
        openId: user.openId,
        name: user.name ?? name,
        email: normalizedEmail,
        loginMethod: "local",
        lastSignedIn: new Date(),
      });

      await issueSession(req, res, user.openId, user.name ?? name);
      res.json({
        success: true,
      });
    } catch (error) {
      console.error("[LocalAuth] Register failed", error);
      const normalized = normalizeLocalAuthError(error);
      res.status(normalized.status).json({ error: normalized.message });
    }
  });

  app.post("/api/auth/local/login", async (req: Request, res: Response) => {
    if (!ENV.enableLocalAuth) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid login payload" });
      return;
    }

    const normalizedEmail = normalizeEmail(parsed.data.email);
    const { password } = parsed.data;

    try {
      const user = await db.getUserByEmail(normalizedEmail);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const credential = await db.getLocalCredentialByUserId(user.id);
      if (!credential) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await verifyPassword(password, credential.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      await db.upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
        loginMethod: user.loginMethod ?? "local",
      });

      await issueSession(
        req,
        res,
        user.openId,
        user.name ?? normalizedEmail.split("@")[0] ?? "User"
      );
      res.json({
        success: true,
      });
    } catch (error) {
      console.error("[LocalAuth] Login failed", error);
      const normalized = normalizeLocalAuthError(error);
      res.status(normalized.status).json({ error: normalized.message });
    }
  });
}

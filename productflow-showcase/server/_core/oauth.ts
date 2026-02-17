import {
  COOKIE_NAME,
  ONE_YEAR_MS,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_TTL_MS,
} from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import * as db from "../db";
import {
  getOAuthStateCookieOptions,
  getSessionCookieOptions,
} from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

type OAuthStatePayload = {
  redirectUri: string;
  nonce?: string;
  issuedAt?: number;
};

function getHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value.split(",")[0]?.trim();
}

function buildRedirectUri(req: Request) {
  const protocol = getHeaderValue(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const host = getHeaderValue(req.headers["x-forwarded-host"]) ?? req.get("host");
  if (!host) {
    throw new Error("Host header missing");
  }
  return `${protocol}://${host}/api/oauth/callback`;
}

function decodeOAuthState(state: string): OAuthStatePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as OAuthStatePayload;
    if (parsed && typeof parsed.redirectUri === "string" && parsed.redirectUri.length > 0) {
      return parsed;
    }
  } catch {
    // Ignore and fallback to legacy state format.
  }

  try {
    const legacyRedirectUri = Buffer.from(state, "base64").toString("utf8");
    if (legacyRedirectUri.length > 0) {
      return { redirectUri: legacyRedirectUri };
    }
  } catch {
    return null;
  }

  return null;
}

function readOAuthStateNonceFromCookie(req: Request): string | undefined {
  if (!req.headers.cookie) return undefined;
  const parsed = parseCookieHeader(req.headers.cookie);
  const value = parsed[OAUTH_STATE_COOKIE_NAME];
  return typeof value === "string" ? value : undefined;
}

function getOAuthStartUrl(req: Request) {
  if (!ENV.oAuthPortalUrl || !ENV.appId || !ENV.oAuthServerUrl) {
    return null;
  }

  const redirectUri = buildRedirectUri(req);
  const nonce = randomBytes(24).toString("base64url");
  const statePayload: OAuthStatePayload = {
    redirectUri,
    nonce,
    issuedAt: Date.now(),
  };
  const state = Buffer.from(JSON.stringify(statePayload), "utf8").toString(
    "base64url"
  );

  let url: URL;
  try {
    url = new URL("/app-auth", ENV.oAuthPortalUrl);
  } catch {
    return null;
  }
  url.searchParams.set("appId", ENV.appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return {
    stateNonce: nonce,
    url: url.toString(),
  };
}

function sendOAuthNotConfiguredResponse(req: Request, res: Response) {
  const accept = String(req.headers.accept ?? "");
  const wantsHtml = accept.includes("text/html");

  if (!wantsHtml) {
    res.status(503).json({
      error:
        "OAuth not configured. Set VITE_APP_ID, OAUTH_SERVER_URL, VITE_OAUTH_PORTAL_URL or enable dev login explicitly.",
    });
    return;
  }

  res.status(503).type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>登录配置未完成</title>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(160deg, #f3f8ff, #fffaf0);
        color: #1f2a44;
      }
      .card {
        width: min(680px, calc(100% - 32px));
        border: 1px solid #d8e3ff;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 24px 56px -36px rgba(33, 74, 158, 0.4);
        padding: 24px;
      }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 8px 0; line-height: 1.7; }
      code {
        background: #eef4ff;
        border-radius: 8px;
        padding: 2px 6px;
      }
      .actions { margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap; }
      a {
        display: inline-block;
        text-decoration: none;
        border-radius: 10px;
        padding: 10px 14px;
      }
      .primary { background: #305fd4; color: #fff; }
      .secondary { border: 1px solid #d8e3ff; color: #1f2a44; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>登录配置未完成</h1>
      <p>当前服务端已启用“上线级 OAuth 登录入口”，但缺少必填配置：</p>
      <p><code>VITE_APP_ID</code>、<code>OAUTH_SERVER_URL</code>、<code>VITE_OAUTH_PORTAL_URL</code></p>
      <p>本地调试可在 <code>.env</code> 设置 <code>ENABLE_DEV_LOGIN=true</code> 后重启服务。</p>
      <div class="actions">
        <a class="primary" href="/">返回首页</a>
        <a class="secondary" href="/api/oauth/dev-login">尝试 Dev 登录</a>
      </div>
    </main>
  </body>
</html>`);
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/start", (req: Request, res: Response) => {
    const oauthStart = getOAuthStartUrl(req);
    if (oauthStart) {
      const stateCookieOptions = getOAuthStateCookieOptions(req);
      res.cookie(OAUTH_STATE_COOKIE_NAME, oauthStart.stateNonce, {
        ...stateCookieOptions,
        maxAge: OAUTH_STATE_TTL_MS,
      });
      res.redirect(302, oauthStart.url);
      return;
    }

    if (ENV.enableDevLogin) {
      res.redirect(302, "/api/oauth/dev-login");
      return;
    }

    sendOAuthNotConfiguredResponse(req, res);
  });

  app.get("/api/oauth/dev-login", async (req: Request, res: Response) => {
    if (!ENV.enableDevLogin) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    try {
      const openId = "dev-local-user";
      const name = "Local Dev";
      const signedInAt = new Date();

      await db.upsertUser({
        openId,
        name,
        email: "dev@localhost",
        loginMethod: "dev",
        lastSignedIn: signedInAt,
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Dev login failed", error);
      res.status(500).json({ error: "Dev login failed" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const statePayload = decodeOAuthState(state);
      if (!statePayload) {
        res.status(400).json({ error: "Invalid OAuth state payload" });
        return;
      }

      const stateCookieOptions = getOAuthStateCookieOptions(req);
      const nonceFromCookie = readOAuthStateNonceFromCookie(req);
      res.clearCookie(OAUTH_STATE_COOKIE_NAME, stateCookieOptions);

      if (
        typeof statePayload.issuedAt === "number" &&
        Date.now() - statePayload.issuedAt > OAUTH_STATE_TTL_MS
      ) {
        res.status(400).json({ error: "OAuth state expired" });
        return;
      }

      const expectedRedirectUri = buildRedirectUri(req);
      if (statePayload.redirectUri !== expectedRedirectUri) {
        res.status(400).json({ error: "OAuth redirect URI mismatch" });
        return;
      }

      // Legacy state payloads do not include nonce.
      if (statePayload.nonce) {
        if (!nonceFromCookie || nonceFromCookie !== statePayload.nonce) {
          res.status(400).json({ error: "OAuth state validation failed" });
          return;
        }
      } else if (process.env.NODE_ENV === "production") {
        res.status(400).json({ error: "OAuth state nonce missing" });
        return;
      }

      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

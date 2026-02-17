const isProduction = process.env.NODE_ENV === "production";

const parseIntInRange = (
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number
) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
};

const requireInProduction = (
  key: string,
  value: string | undefined,
  missing: string[]
) => {
  if (!isProduction) return;
  if (!value || value.trim().length === 0) {
    missing.push(key);
  }
};

const missingInProduction: string[] = [];
requireInProduction("DATABASE_URL", process.env.DATABASE_URL, missingInProduction);
requireInProduction("JWT_SECRET", process.env.JWT_SECRET, missingInProduction);
if (
  isProduction &&
  !(process.env.LLM_API_KEY || process.env.BUILT_IN_FORGE_API_KEY)
) {
  missingInProduction.push("LLM_API_KEY (or BUILT_IN_FORGE_API_KEY)");
}
if (
  isProduction &&
  !(
    process.env.VITE_APP_ID &&
    process.env.OAUTH_SERVER_URL &&
    process.env.VITE_OAUTH_PORTAL_URL
  )
) {
  missingInProduction.push(
    "VITE_APP_ID + OAUTH_SERVER_URL + VITE_OAUTH_PORTAL_URL"
  );
}

if (missingInProduction.length > 0) {
  throw new Error(
    `Missing required environment variables in production: ${missingInProduction.join(", ")}`
  );
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  oAuthPortalUrl: process.env.VITE_OAUTH_PORTAL_URL ?? "",
  cookieSecret:
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === "development" ? "local-dev-secret" : ""),
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  llmApiUrl: process.env.LLM_API_URL ?? process.env.BUILT_IN_FORGE_API_URL ?? "",
  llmApiKey: process.env.LLM_API_KEY ?? process.env.BUILT_IN_FORGE_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "kimi-k2.5",
  agentMaxIterations: parseIntInRange(process.env.AGENT_MAX_ITERATIONS, 3, 1, 5),
  agentPassScore: parseIntInRange(process.env.AGENT_PASS_SCORE, 85, 60, 100),
  enableLocalAuth: process.env.ENABLE_LOCAL_AUTH !== "false",
  enableDevLogin:
    process.env.NODE_ENV === "development" &&
    process.env.ENABLE_DEV_LOGIN === "true",
};

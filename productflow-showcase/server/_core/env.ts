const isProduction = process.env.NODE_ENV === "production";

const PLACEHOLDER_DATABASE_URLS = new Set([
  "mysql://user:pass@host:3306/dbname",
  "mysql://username:password@host:3306/database",
  "mysql://productflow:change-me@127.0.0.1:3306/productflow",
]);

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

const buildDatabaseUrlFromParts = (): string => {
  const host = process.env.DB_HOST?.trim();
  const port = process.env.DB_PORT?.trim() || "3306";
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_NAME?.trim();

  if (!host || !user || !database) return "";

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedDatabase = encodeURIComponent(database);

  return `mysql://${encodedUser}:${encodedPassword}@${host}:${port}/${encodedDatabase}`;
};

const resolveDatabaseUrl = (): string => {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (raw && !PLACEHOLDER_DATABASE_URLS.has(raw.toLowerCase())) {
    return raw;
  }
  return buildDatabaseUrlFromParts();
};

const resolvedDatabaseUrl = resolveDatabaseUrl();

const missingInProduction: string[] = [];
requireInProduction(
  "DATABASE_URL (or DB_HOST + DB_PORT + DB_USER + DB_PASSWORD + DB_NAME)",
  resolvedDatabaseUrl,
  missingInProduction
);
requireInProduction("JWT_SECRET", process.env.JWT_SECRET, missingInProduction);
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
  databaseUrl: resolvedDatabaseUrl,
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  agentMaxIterations: parseIntInRange(process.env.AGENT_MAX_ITERATIONS, 3, 1, 5),
  agentPassScore: parseIntInRange(process.env.AGENT_PASS_SCORE, 85, 60, 100),
  enableLocalAuth: process.env.ENABLE_LOCAL_AUTH !== "false",
  enableDevLogin:
    process.env.NODE_ENV === "development" &&
    process.env.ENABLE_DEV_LOGIN === "true",
};

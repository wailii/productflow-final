import crypto from "node:crypto";
import { ENV } from "./env";

const SECRET_PREFIX = "enc.v1";
const CIPHER_ALGO = "aes-256-gcm";

function resolveSecretSeed() {
  if (ENV.cookieSecret && ENV.cookieSecret.trim().length > 0) {
    return ENV.cookieSecret.trim();
  }
  return "productflow-dev-secret";
}

function deriveKey() {
  return crypto.createHash("sha256").update(resolveSecretSeed()).digest();
}

export function encryptSecret(plainText: string) {
  const normalized = plainText.trim();
  if (!normalized) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SECRET_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(cipherText: string | null | undefined): string {
  if (!cipherText) return "";

  if (!cipherText.startsWith(`${SECRET_PREFIX}:`)) {
    return cipherText;
  }

  const parts = cipherText.split(":");
  if (parts.length !== 4) return "";

  try {
    const [, ivBase64, tagBase64, encryptedBase64] = parts;
    const iv = Buffer.from(ivBase64, "base64");
    const tag = Buffer.from(tagBase64, "base64");
    const encrypted = Buffer.from(encryptedBase64, "base64");
    const decipher = crypto.createDecipheriv(CIPHER_ALGO, deriveKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return "";
  }
}

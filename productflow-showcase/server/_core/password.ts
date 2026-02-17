import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keyLen: number
) => Promise<Buffer>;

const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, salt, expected.length);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// Preconfigured storage helpers for Manus WebDev templates
// Uses proxy storage when available, otherwise falls back to local storage.

import fs from "fs";
import path from "path";
import { ENV } from "./_core/env";

type StorageConfig = { baseUrl: string; apiKey: string };

const configuredLocalStorageRoot = process.env.LOCAL_STORAGE_ROOT?.trim();
const LOCAL_STORAGE_ROOT =
  configuredLocalStorageRoot && configuredLocalStorageRoot.length > 0
    ? path.resolve(configuredLocalStorageRoot)
    : path.resolve(process.cwd(), ".webdev");
const LOCAL_UPLOAD_ROOT = path.resolve(LOCAL_STORAGE_ROOT, "uploads");

export function getLocalStorageDirectory() {
  return LOCAL_UPLOAD_ROOT;
}

function ensureLocalRoot() {
  fs.mkdirSync(LOCAL_UPLOAD_ROOT, { recursive: true });
}

function canUseProxyStorage() {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) return false;
  // moonshot chat endpoint is not a storage proxy endpoint.
  if (ENV.forgeApiUrl.includes("api.moonshot.cn")) return false;
  return true;
}

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage get download url failed (${response.status} ${response.statusText}): ${message}`
    );
  }

  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function encodeKeyForPath(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  if (typeof data === "string") {
    return Buffer.from(data);
  }
  return Buffer.from(data);
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

async function storagePutProxy(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }

  const url = (await response.json()).url;
  return { key, url };
}

async function storageGetProxy(relKey: string): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

async function storagePutLocal(
  relKey: string,
  data: Buffer | Uint8Array | string
): Promise<{ key: string; url: string }> {
  ensureLocalRoot();
  const key = normalizeKey(relKey);
  const filePath = path.join(LOCAL_UPLOAD_ROOT, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, toBuffer(data));

  return {
    key,
    url: `/__uploads/${encodeKeyForPath(key)}`,
  };
}

async function storageGetLocal(relKey: string): Promise<{ key: string; url: string }> {
  ensureLocalRoot();
  const key = normalizeKey(relKey);
  const filePath = path.join(LOCAL_UPLOAD_ROOT, key);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Local storage key not found: ${key}`);
  }

  return {
    key,
    url: `/__uploads/${encodeKeyForPath(key)}`,
  };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  if (canUseProxyStorage()) {
    try {
      return await storagePutProxy(relKey, data, contentType);
    } catch (error) {
      console.warn("[storage] proxy upload failed, fallback to local:", error);
      return storagePutLocal(relKey, data);
    }
  }

  return storagePutLocal(relKey, data);
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  if (canUseProxyStorage()) {
    try {
      return await storageGetProxy(relKey);
    } catch (error) {
      console.warn("[storage] proxy get failed, fallback to local:", error);
      return storageGetLocal(relKey);
    }
  }

  return storageGetLocal(relKey);
}

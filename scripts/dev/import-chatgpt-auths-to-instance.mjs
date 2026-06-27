#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INSTANCE_URL = "http://192.168.3.110:36129/";
const DEFAULT_AUTH_DIR = "auths";
const SESSION_COOKIE_NAME = "__Secure-next-auth.session-token";
const CHATGPT_DOMAINS = new Set(["chatgpt.com", ".chatgpt.com"]);

function printHelp() {
  console.log(`Usage: node --env-file=.env scripts/dev/import-chatgpt-auths-to-instance.mjs [options]

Import ChatGPT web auth exports from ./auths into an OmniRoute instance as chatgpt-web providers.

Options:
  --instance-url <url>   OmniRoute instance URL (default: ${DEFAULT_INSTANCE_URL})
  --auth-dir <path>      Directory containing exported auth JSON files (default: ./${DEFAULT_AUTH_DIR})
  --api-key <token>      OmniRoute management API key (Bearer token)
  --password <password>  OmniRoute dashboard management password (used to obtain auth_token cookie)
  --cookie <cookie>      Existing OmniRoute auth cookie or full 'Cookie: auth_token=...' header
  --dry-run              Parse and compare only, do not create providers
  --verbose              Print extra progress details
  --help                 Show this help message

Auth priority:
  1. --cookie / OMNIROUTE_AUTH_COOKIE
  2. --api-key / OMNIROUTE_API_KEY / ROUTER_API_KEY
  3. --password / OMNIROUTE_PASSWORD / INITIAL_PASSWORD
`);
}

function parseArgs(argv) {
  const args = {
    instanceUrl: process.env.OMNIROUTE_INSTANCE_URL || DEFAULT_INSTANCE_URL,
    authDir: path.resolve(process.cwd(), DEFAULT_AUTH_DIR),
    apiKey: process.env.OMNIROUTE_API_KEY || process.env.ROUTER_API_KEY || null,
    password: process.env.OMNIROUTE_PASSWORD || process.env.INITIAL_PASSWORD || null,
    cookie: process.env.OMNIROUTE_AUTH_COOKIE || null,
    dryRun: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--verbose") {
      args.verbose = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--instance-url") {
      args.instanceUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--auth-dir") {
      args.authDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--api-key") {
      args.apiKey = next;
      index += 1;
      continue;
    }
    if (arg === "--password") {
      args.password = next;
      index += 1;
      continue;
    }
    if (arg === "--cookie") {
      args.cookie = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  args.instanceUrl = normalizeInstanceUrl(args.instanceUrl);
  args.cookie = normalizeManagementCookie(args.cookie);
  args.apiKey = toNonEmptyString(args.apiKey);
  args.password = toNonEmptyString(args.password);

  return args;
}

function normalizeInstanceUrl(value) {
  const input = toNonEmptyString(value);
  if (!input) {
    throw new Error("Missing OmniRoute instance URL");
  }
  return new URL(input).toString();
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeKey(value) {
  return toNonEmptyString(value)?.toLowerCase() || null;
}

function normalizeManagementCookie(value) {
  const trimmed = toNonEmptyString(value);
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^cookie\s*:\s*/i, "").trim();
  if (withoutPrefix.includes("auth_token=")) {
    return withoutPrefix;
  }
  return `auth_token=${withoutPrefix}`;
}

function extractCookieValue(setCookieHeaders, cookieName) {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`(?:^|\\s|,)${cookieName}=([^;]+)`));
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return { text, data: null };
  }
  try {
    return { text, data: JSON.parse(text) };
  } catch {
    return { text, data: null };
  }
}

function getResponseErrorMessage(data, fallback) {
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof data?.message === "string") return data.message;
  return fallback;
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

async function resolveManagementAuth(args) {
  if (args.cookie) {
    return { type: "cookie", cookie: args.cookie, source: "cookie" };
  }

  if (args.apiKey) {
    return { type: "bearer", token: args.apiKey, source: "api-key" };
  }

  if (!args.password) {
    throw new Error(
      "No management auth available. Pass --api-key, --cookie, or --password, or provide them via env vars."
    );
  }

  const loginUrl = new URL("/api/auth/login", args.instanceUrl);
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: args.password }),
  });

  const { data } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `Management login failed (${response.status}): ${getResponseErrorMessage(data, "Unknown error")}`
    );
  }

  const authToken = extractCookieValue(getSetCookieHeaders(response), "auth_token");
  if (!authToken) {
    throw new Error("Management login succeeded but no auth_token cookie was returned");
  }

  return { type: "cookie", cookie: `auth_token=${authToken}`, source: "password-login" };
}

function buildRequestHeaders(auth, hasBody = false) {
  const headers = { Accept: "application/json" };

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  if (auth.type === "bearer") {
    headers.Authorization = `Bearer ${auth.token}`;
  } else if (auth.type === "cookie") {
    headers.Cookie = auth.cookie;
  }

  return headers;
}

function isChatGptCookie(rawCookie) {
  const cookie = toRecord(rawCookie);
  const name = toNonEmptyString(cookie.name);
  const value = toNonEmptyString(cookie.value);
  if (!name || !value) return false;

  const domain = toNonEmptyString(cookie.domain);
  return !domain || CHATGPT_DOMAINS.has(domain);
}

function getSessionCookieRank(name) {
  if (name === SESSION_COOKIE_NAME) return -1;
  const suffix = name.slice(`${SESSION_COOKIE_NAME}.`.length);
  const numeric = Number(suffix);
  return Number.isInteger(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function buildChatGptCookieHeader(rawDoc) {
  const doc = toRecord(rawDoc);
  const cookies = Array.isArray(doc.cookies) ? doc.cookies.filter(isChatGptCookie) : [];
  const parts = [];
  const seenNames = new Set();

  const sessionCookies = cookies
    .map((cookie) => toRecord(cookie))
    .filter((cookie) => {
      const name = toNonEmptyString(cookie.name);
      return name === SESSION_COOKIE_NAME || name?.startsWith(`${SESSION_COOKIE_NAME}.`);
    })
    .sort((left, right) => {
      const leftName = toNonEmptyString(left.name) || "";
      const rightName = toNonEmptyString(right.name) || "";
      return getSessionCookieRank(leftName) - getSessionCookieRank(rightName);
    });

  for (const cookie of sessionCookies) {
    const name = toNonEmptyString(cookie.name);
    const value = toNonEmptyString(cookie.value);
    if (!name || !value || seenNames.has(name)) continue;
    seenNames.add(name);
    parts.push(`${name}=${value}`);
  }

  const topLevelSessionToken = toNonEmptyString(doc.session_token);
  if (parts.length === 0 && topLevelSessionToken) {
    seenNames.add(SESSION_COOKIE_NAME);
    parts.push(`${SESSION_COOKIE_NAME}=${topLevelSessionToken}`);
  }

  for (const rawCookie of cookies) {
    const cookie = toRecord(rawCookie);
    const name = toNonEmptyString(cookie.name);
    const value = toNonEmptyString(cookie.value);
    if (!name || !value || seenNames.has(name)) continue;
    seenNames.add(name);
    parts.push(`${name}=${value}`);
  }

  return parts.length > 0 ? parts.join("; ") : null;
}

function buildProviderSpecificData(entry) {
  const providerSpecificData = {
    importSource: "auths-directory",
    importTool: "scripts/dev/import-chatgpt-auths-to-instance.mjs",
    sourceFile: entry.fileName,
  };

  if (entry.email) providerSpecificData.sourceEmail = entry.email;
  if (entry.displayName) providerSpecificData.sourceName = entry.displayName;
  if (entry.savedAt) providerSpecificData.sourceSavedAt = entry.savedAt;

  return providerSpecificData;
}

function normalizeAuthEntry(filePath, rawDoc) {
  const doc = toRecord(rawDoc);
  const fileName = path.basename(filePath);
  const fallbackName = path.basename(fileName, path.extname(fileName));
  const email = toNonEmptyString(doc.email) || fallbackName;
  const displayName = toNonEmptyString(doc.name) || email || fallbackName;
  const cookieHeader = buildChatGptCookieHeader(doc);

  if (!cookieHeader) {
    throw new Error("No usable chatgpt.com cookies found in file");
  }

  return {
    filePath,
    fileName,
    email,
    displayName,
    savedAt: toNonEmptyString(doc.saved_at),
    apiKey: `Cookie: ${cookieHeader}`,
  };
}

async function loadAuthEntries(authDir) {
  const dirents = await fs.readdir(authDir, { withFileTypes: true });
  const files = dirents
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith(".json"))
    .map((dirent) => path.join(authDir, dirent.name))
    .sort((left, right) => left.localeCompare(right));

  const entries = [];
  for (const filePath of files) {
    const rawText = await fs.readFile(filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`${path.basename(filePath)} is not valid JSON: ${error.message}`);
    }
    entries.push(normalizeAuthEntry(filePath, parsed));
  }

  return entries;
}

async function fetchProviderConnections(instanceUrl, auth) {
  const url = new URL("/api/providers", instanceUrl);
  const response = await fetch(url, {
    method: "GET",
    headers: buildRequestHeaders(auth, false),
  });

  const { data } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `Failed to list provider connections (${response.status}): ${getResponseErrorMessage(data, "Unknown error")}`
    );
  }

  return Array.isArray(data?.connections) ? data.connections : [];
}

function buildExistingIndex(connections) {
  const names = new Set();
  const emails = new Set();
  const files = new Set();

  for (const connection of connections) {
    if (connection?.provider !== "chatgpt-web") continue;

    const name = normalizeKey(connection.name);
    const email = normalizeKey(connection.email);
    const providerSpecificData = toRecord(connection.providerSpecificData);
    const sourceEmail = normalizeKey(
      providerSpecificData.sourceEmail || providerSpecificData.importEmail
    );
    const sourceFile = normalizeKey(providerSpecificData.sourceFile);

    if (name) names.add(name);
    if (email) emails.add(email);
    if (sourceEmail) emails.add(sourceEmail);
    if (sourceFile) files.add(sourceFile);
  }

  return { names, emails, files };
}

function classifyExistingEntry(entry, existingIndex) {
  const fileKey = normalizeKey(entry.fileName);
  const emailKey = normalizeKey(entry.email);
  const nameKey = normalizeKey(entry.displayName);

  if (fileKey && existingIndex.files.has(fileKey)) {
    return `sourceFile:${entry.fileName}`;
  }
  if (emailKey && existingIndex.emails.has(emailKey)) {
    return `email:${entry.email}`;
  }
  if (nameKey && existingIndex.names.has(nameKey)) {
    return `name:${entry.displayName}`;
  }
  return null;
}

async function createChatGptWebConnection(instanceUrl, auth, entry) {
  const url = new URL("/api/providers", instanceUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: buildRequestHeaders(auth, true),
    body: JSON.stringify({
      provider: "chatgpt-web",
      name: entry.email || entry.displayName,
      apiKey: entry.apiKey,
      testStatus: "unknown",
      providerSpecificData: buildProviderSpecificData(entry),
    }),
  });

  const { data } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `Create failed (${response.status}): ${getResponseErrorMessage(data, "Unknown error")}`
    );
  }

  return data?.connection || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const auth = await resolveManagementAuth(args);
  const entries = await loadAuthEntries(args.authDir);
  const existingConnections = await fetchProviderConnections(args.instanceUrl, auth);
  const existingIndex = buildExistingIndex(existingConnections);

  if (args.verbose) {
    console.log(
      `[info] auth=${auth.source} instance=${args.instanceUrl} authDir=${args.authDir} files=${entries.length}`
    );
  }

  const results = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    const existingReason = classifyExistingEntry(entry, existingIndex);
    if (existingReason) {
      skipped += 1;
      const result = {
        file: entry.fileName,
        email: entry.email,
        status: "skipped",
        reason: existingReason,
      };
      results.push(result);
      console.log(`[skip] ${entry.fileName} (${existingReason})`);
      continue;
    }

    if (args.dryRun) {
      const result = {
        file: entry.fileName,
        email: entry.email,
        status: "dry-run",
      };
      results.push(result);
      console.log(`[dry-run] ${entry.fileName} -> chatgpt-web:${entry.email || entry.displayName}`);
      continue;
    }

    try {
      const connection = await createChatGptWebConnection(args.instanceUrl, auth, entry);
      created += 1;
      const result = {
        file: entry.fileName,
        email: entry.email,
        status: "created",
        connectionId: toNonEmptyString(connection?.id),
        name: toNonEmptyString(connection?.name),
      };
      results.push(result);
      console.log(
        `[create] ${entry.fileName} -> ${result.connectionId || result.name || entry.email}`
      );

      const fileKey = normalizeKey(entry.fileName);
      const emailKey = normalizeKey(entry.email);
      if (fileKey) existingIndex.files.add(fileKey);
      if (emailKey) existingIndex.emails.add(emailKey);
    } catch (error) {
      failed += 1;
      const result = {
        file: entry.fileName,
        email: entry.email,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.log(`[fail] ${entry.fileName}: ${result.error}`);
    }
  }

  const summary = {
    instanceUrl: args.instanceUrl,
    authDir: args.authDir,
    authSource: auth.source,
    dryRun: args.dryRun,
    total: entries.length,
    created,
    skipped,
    failed,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

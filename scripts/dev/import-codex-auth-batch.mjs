#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv) {
  const args = {
    inputPath: null,
    dataDir: null,
    dbPath: null,
    dryRun: false,
    overwriteExisting: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--overwrite-existing") {
      args.overwriteExisting = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--input") {
      args.inputPath = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === "--data-dir") {
      args.dataDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === "--db") {
      args.dbPath = path.resolve(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.inputPath) {
    throw new Error("Missing required --input <path>");
  }

  if (args.dbPath) {
    args.dataDir = path.dirname(args.dbPath);
  }

  if (!args.dataDir && process.env.DATA_DIR) {
    args.dataDir = path.resolve(process.env.DATA_DIR);
  }

  if (!args.dataDir) {
    throw new Error("Missing target data directory. Pass --data-dir <dir> or --db <path>");
  }

  return args;
}

function skipWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function readLine(source, start) {
  let end = start;
  while (end < source.length && source[end] !== "\n") {
    end += 1;
  }
  const line = source.slice(start, end);
  return { line, next: end < source.length ? end + 1 : end };
}

function readJsonBlock(source, start) {
  let index = start;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  while (index < source.length) {
    const char = source[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === "\\") {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          text: source.slice(start, index + 1),
          next: index + 1,
        };
      }
    }

    index += 1;
  }

  throw new Error("Unterminated JSON block in authjson file");
}

function parseAuthJsonEntries(source) {
  const entries = [];
  let index = 0;

  while (true) {
    index = skipWhitespace(source, index);
    if (index >= source.length) {
      break;
    }

    let label = null;
    if (source[index] !== "{") {
      const labelLine = readLine(source, index);
      label = labelLine.line.trim();
      index = skipWhitespace(source, labelLine.next);
      if (label.endsWith(":")) {
        label = label.slice(0, -1).trim();
      }
    }

    if (source[index] !== "{") {
      throw new Error(`Expected JSON object near offset ${index}`);
    }

    const jsonBlock = readJsonBlock(source, index);
    const raw = JSON.parse(jsonBlock.text);
    entries.push({ label, raw });
    index = jsonBlock.next;
  }

  return entries;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function decodeJwtPayload(jwt) {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return toRecord(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

function deriveAccountId(raw) {
  const direct =
    toNonEmptyString(raw.account_id) || toNonEmptyString(toRecord(raw.tokens).account_id);
  if (direct) return direct;
  const payload = decodeJwtPayload(
    toNonEmptyString(raw.id_token) || toNonEmptyString(toRecord(raw.tokens).id_token)
  );
  const authInfo = payload ? toRecord(payload["https://api.openai.com/auth"]) : {};
  return toNonEmptyString(authInfo.chatgpt_account_id) || toNonEmptyString(authInfo.account_id);
}

function deriveAccessExpiry(raw) {
  const explicit = toNonEmptyString(raw.expired);
  if (explicit) return explicit;
  const payload = decodeJwtPayload(
    toNonEmptyString(raw.access_token) || toNonEmptyString(toRecord(raw.tokens).access_token)
  );
  const exp = payload?.exp;
  if (typeof exp === "number" && Number.isFinite(exp)) {
    return new Date(exp * 1000).toISOString();
  }
  return null;
}

function normalizeEntry(entry) {
  const raw = toRecord(entry.raw);
  const tokens = toRecord(raw.tokens);
  const idToken = toNonEmptyString(raw.id_token) || toNonEmptyString(tokens.id_token);
  const accessToken = toNonEmptyString(raw.access_token) || toNonEmptyString(tokens.access_token);
  const refreshToken =
    toNonEmptyString(raw.refresh_token) || toNonEmptyString(tokens.refresh_token);
  const accountId = deriveAccountId(raw);
  const topLevelEmail = toNonEmptyString(raw.email);
  const label = toNonEmptyString(entry.label);

  return {
    label,
    topLevelEmail: topLevelEmail && EMAIL_RE.test(topLevelEmail) ? topLevelEmail : null,
    accessExpiry: deriveAccessExpiry(raw),
    standardAuth: {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: accountId,
      },
      last_refresh: toNonEmptyString(raw.last_refresh) || new Date().toISOString(),
    },
  };
}

function buildProviderSpecificData(existingProviderSpecificData, entry) {
  return {
    ...(existingProviderSpecificData && typeof existingProviderSpecificData === "object"
      ? existingProviderSpecificData
      : {}),
    importedAt: new Date().toISOString(),
    importSource: "authjson.txt",
    ...(entry.label ? { importLabel: entry.label } : {}),
    ...(entry.topLevelEmail ? { importEmail: entry.topLevelEmail } : {}),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.DATA_DIR = args.dataDir;
  process.env.DISABLE_SQLITE_AUTO_BACKUP ??= "true";

  const [
    { parseAndValidateCodexAuth, createConnectionFromAuthFile },
    { updateProviderConnection },
  ] = await Promise.all([
    import("../../src/lib/oauth/utils/codexAuthImport.ts"),
    import("../../src/lib/localDb.ts"),
  ]);

  const source = await fs.readFile(args.inputPath, "utf8");
  const parsedEntries = parseAuthJsonEntries(source).map(normalizeEntry);

  let created = 0;
  let updated = 0;
  const errors = [];

  for (let index = 0; index < parsedEntries.length; index += 1) {
    const entry = parsedEntries[index];
    try {
      const parsedAuth = parseAndValidateCodexAuth(entry.standardAuth);

      if (args.dryRun) {
        continue;
      }

      const result = await createConnectionFromAuthFile(parsedAuth, {
        name: entry.label || entry.topLevelEmail || parsedAuth.email || undefined,
        email: entry.topLevelEmail || parsedAuth.email || undefined,
        overwriteExisting: args.overwriteExisting,
      });

      const connection = toRecord(result.connection);
      const providerSpecificData = buildProviderSpecificData(
        connection.providerSpecificData,
        entry
      );

      await updateProviderConnection(String(connection.id), {
        name: entry.label || toNonEmptyString(connection.name) || undefined,
        email: entry.topLevelEmail || parsedAuth.email || undefined,
        expiresAt: entry.accessExpiry || parsedAuth.expiresAt || undefined,
        providerSpecificData,
        testStatus: "active",
        isActive: true,
      });

      if (result.created) {
        created += 1;
      } else {
        updated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ index: index + 1, label: entry.label || `entry-${index + 1}`, message });
    }
  }

  console.log(
    JSON.stringify(
      {
        inputPath: args.inputPath,
        dataDir: args.dataDir,
        total: parsedEntries.length,
        created,
        updated,
        failed: errors.length,
        dryRun: args.dryRun,
        overwriteExisting: args.overwriteExisting,
        errors,
      },
      null,
      2
    )
  );

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

await main();

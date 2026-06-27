const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const envPath = path.join(rootDir, ".env");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const entries = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const quote = rawValue[0];
    const value =
      rawValue.length >= 2 &&
      (quote === '"' || quote === "'") &&
      rawValue[rawValue.length - 1] === quote
        ? rawValue.slice(1, -1)
        : rawValue;

    entries[key] = value;
  }

  return entries;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function resolveDir(value, fallback) {
  return path.resolve(value || fallback);
}

function normalizeBaseUrl(value, fallback) {
  const trimmed = String(value || "").trim();
  return (trimmed || fallback).replace(/\/+$/, "");
}

const fileEnv = parseEnvFile(envPath);
const defaultPort = parsePort(
  process.env.OMNIROUTE_PM2_PORT || fileEnv.OMNIROUTE_PM2_PORT,
  36129
);
const port = parsePort(process.env.PORT, defaultPort);
const host = process.env.HOST || fileEnv.HOST || "0.0.0.0";
const dataDir = resolveDir(process.env.DATA_DIR || fileEnv.DATA_DIR, path.join(rootDir, "data"));
const logsDir = resolveDir(
  process.env.OMNIROUTE_LOG_DIR || fileEnv.OMNIROUTE_LOG_DIR,
  path.join(rootDir, "logs")
);
const runtimeDir = resolveDir(
  process.env.OMNIROUTE_RUNTIME_DIR || fileEnv.OMNIROUTE_RUNTIME_DIR,
  path.join(rootDir, "runtime")
);
const nodeVersion = process.env.OMNIROUTE_NODE_VERSION || fileEnv.OMNIROUTE_NODE_VERSION;
const baseUrl = normalizeBaseUrl(
  process.env.OMNIROUTE_BASE_URL ||
    process.env.BASE_URL ||
    fileEnv.OMNIROUTE_BASE_URL ||
    fileEnv.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL,
  `http://localhost:${port}`
);

for (const dir of [dataDir, logsDir, runtimeDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  apps: [
    {
      name: "omniroute-service",
      script: "./scripts/pm2/start-omniroute-service.sh",
      interpreter: "bash",
      cwd: rootDir,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: path.join(logsDir, "omniroute-out.log"),
      error_file: path.join(logsDir, "omniroute-error.log"),
      env: {
        NODE_ENV: "production",
        ...(nodeVersion ? { OMNIROUTE_NODE_VERSION: nodeVersion } : {}),
        HOST: host,
        PORT: String(port),
        OMNIROUTE_PORT: String(port),
        DATA_DIR: dataDir,
        BASE_URL: baseUrl,
        NEXT_PUBLIC_BASE_URL: baseUrl,
        OMNIROUTE_BASE_URL: baseUrl,
        OMNIROUTE_LOG_DIR: logsDir,
        OMNIROUTE_RUNTIME_DIR: runtimeDir,
      },
    },
  ],
};

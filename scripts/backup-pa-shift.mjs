#!/usr/bin/env node

import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_API_BASE_URL = "https://student-plaza-pa-shift-system.onrender.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_DIR = resolve(homedir(), "Documents", "PA-Shift-Backups");
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_TIMEZONE = "Asia/Tokyo";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 15_000;
const REQUIRED_KEYS = [
  "names",
  "specialDays",
  "submissions",
  "confirmedShifts",
  "workdayAvailability",
  "counters",
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataUrl = buildDataUrl(options.apiBaseUrl);
  const payload = await fetchPayload(dataUrl, options);
  validatePayload(payload);

  const outputDir = resolve(options.outputDir);
  const dateStamp = formatDateInTimeZone(new Date(), options.timezone);
  const fileName = `pa-shift-backup-${dateStamp}.json`;
  const filePath = join(outputDir, fileName);
  const latestPath = join(outputDir, "latest.json");
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  await mkdir(outputDir, { recursive: true });
  await writeFileAtomically(filePath, serialized);
  await writeFileAtomically(latestPath, serialized);
  const deletedFiles = await pruneOldBackups(outputDir, options.retentionDays, options.timezone);

  console.log(
    [
      `Saved backup: ${filePath}`,
      `Updated latest: ${latestPath}`,
      `Pruned old backups: ${deletedFiles.length}`,
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    retentionDays: DEFAULT_RETENTION_DAYS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    timezone: DEFAULT_TIMEZONE,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }

    const nextValue = argv[index + 1];
    if (nextValue == null) {
      throw new Error(`Missing value for ${argument}`);
    }

    switch (argument) {
      case "--api-base-url":
        options.apiBaseUrl = nextValue.trim();
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = nextValue.trim();
        index += 1;
        break;
      case "--retention-days":
        options.retentionDays = parsePositiveInteger(nextValue, "--retention-days");
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(nextValue, "--timeout-ms");
        index += 1;
        break;
      case "--timezone":
        options.timezone = nextValue.trim();
        assertTimeZone(options.timezone);
        index += 1;
        break;
      case "--max-attempts":
        options.maxAttempts = parsePositiveInteger(nextValue, "--max-attempts");
        index += 1;
        break;
      case "--retry-delay-ms":
        options.retryDelayMs = parsePositiveInteger(nextValue, "--retry-delay-ms");
        index += 1;
        break;
      default:
        throw new Error(`Unsupported argument: ${argument}`);
    }
  }

  if (!options.apiBaseUrl) {
    throw new Error("--api-base-url must not be empty");
  }

  if (!options.outputDir) {
    throw new Error("--output-dir must not be empty");
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/backup-pa-shift.mjs [options]

Options:
  --api-base-url <url>   API base URL or /api/data URL
  --output-dir <path>    Backup directory
  --retention-days <n>   Days of dated backups to keep
  --timeout-ms <n>       HTTP timeout in milliseconds
  --timezone <iana>      IANA timezone for filename dates
  --max-attempts <n>     Number of fetch attempts before failing
  --retry-delay-ms <n>   Delay between retries in milliseconds
  --help                 Show this help`);
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function assertTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch (error) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

function buildDataUrl(apiBaseUrl) {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/data")) {
    return trimmed;
  }
  return `${trimmed}/api/data`;
}

async function fetchPayload(url, options) {
  return fetchPayloadWithRetry(url, {
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
  });
}

async function fetchPayloadWithRetry(url, { timeoutMs, maxAttempts, retryDelayMs }) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchPayloadOnce(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      console.error(
        `Backup fetch attempt ${attempt}/${maxAttempts} failed: ${formatErrorMessage(error)}`
      );
      console.error(`Retrying in ${retryDelayMs}ms...`);
      await sleep(retryDelayMs);
    }
  }

  throw lastError ?? new Error("Backup fetch failed for an unknown reason");
}

async function fetchPayloadOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Backup fetch failed with HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Backup fetch timed out after ${timeoutMs}ms`);
    }
    const detail =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`Backup fetch failed for ${url}: ${detail}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Backup payload must be a JSON object");
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in payload)) {
      throw new Error(`Backup payload is missing required key: ${key}`);
    }
  }

  if (!Array.isArray(payload.names)) {
    throw new Error("Backup payload key 'names' must be an array");
  }
  if (!Array.isArray(payload.specialDays)) {
    throw new Error("Backup payload key 'specialDays' must be an array");
  }
  if (!Array.isArray(payload.submissions)) {
    throw new Error("Backup payload key 'submissions' must be an array");
  }
  if (!payload.confirmedShifts || typeof payload.confirmedShifts !== "object" || Array.isArray(payload.confirmedShifts)) {
    throw new Error("Backup payload key 'confirmedShifts' must be an object");
  }
  if (!Array.isArray(payload.workdayAvailability)) {
    throw new Error("Backup payload key 'workdayAvailability' must be an array");
  }
  if (!payload.counters || typeof payload.counters !== "object" || Array.isArray(payload.counters)) {
    throw new Error("Backup payload key 'counters' must be an object");
  }
}

async function writeFileAtomically(targetPath, contents) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function pruneOldBackups(outputDir, retentionDays, timezone) {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const todayStamp = formatDateInTimeZone(new Date(), timezone);
  const cutoffStamp = shiftIsoDate(todayStamp, -(retentionDays - 1));
  const deletedFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const dateStamp = extractBackupDate(entry.name);
    if (!dateStamp) {
      continue;
    }

    if (dateStamp >= cutoffStamp) {
      continue;
    }

    const filePath = join(outputDir, entry.name);
    await rm(filePath, { force: true });
    deletedFiles.push(filePath);
  }

  return deletedFiles;
}

function extractBackupDate(fileName) {
  const match = /^pa-shift-backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(fileName);
  return match ? match[1] : null;
}

function formatDateInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

function shiftIsoDate(isoDate, deltaDays) {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Backup failed: ${message}`);

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }

  process.exitCode = 1;
});

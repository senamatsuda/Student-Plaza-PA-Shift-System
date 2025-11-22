import fs from "fs/promises";
import path from "path";

const DEFAULT_PAYLOAD = {
  names: [],
  specialDays: [],
  submissions: [],
  counters: {
    namesNextId: 1,
    specialDaysNextId: 1,
  },
};

export function createStorage(filePath) {
  const resolvedPath = path.resolve(filePath || path.join(process.cwd(), "data.json"));
  let initialized = false;

  async function ensureInitialized() {
    if (initialized) return;
    const directory = path.dirname(resolvedPath);
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      if (error?.code === "EACCES") {
        const hint = directory.startsWith("/data")
          ? "Ensure the Render persistent disk is attached and writable."
          : "Check file system permissions for the configured DATA_FILE path.";
        const wrapped = new Error(
          `Cannot create data directory '${directory}'. ${hint}`
        );
        wrapped.cause = error;
        throw wrapped;
      }
      throw error;
    }
    try {
      await fs.access(resolvedPath);
    } catch (error) {
      await writePayload(DEFAULT_PAYLOAD);
    }
    initialized = true;
  }

  async function read() {
    await ensureInitialized();
    try {
      const raw = await fs.readFile(resolvedPath, "utf-8");
      const parsed = JSON.parse(raw);
      return normalizePayload(parsed.payload || parsed);
    } catch (error) {
      if (error.code === "ENOENT") {
        await writePayload(DEFAULT_PAYLOAD);
        return DEFAULT_PAYLOAD;
      }
      throw error;
    }
  }

  async function write(payload) {
    await ensureInitialized();
    const normalized = normalizePayload(payload);
    await writePayload(normalized);
    return normalized;
  }

  async function writePayload(payload) {
    const wrapped = {
      version: 1,
      updatedAt: new Date().toISOString(),
      payload,
    };
    await fs.writeFile(resolvedPath, JSON.stringify(wrapped, null, 2));
  }

  return {
    path: resolvedPath,
    read,
    write,
    ensureInitialized,
  };
}

function normalizePayload(source = {}) {
  return {
    names: sanitizeNameEntries(source.names),
    specialDays: sanitizeSpecialDayEntries(source.specialDays),
    submissions: sanitizeSubmissionEntries(source.submissions),
    counters: {
      namesNextId: sanitizeCounter(source.counters?.namesNextId, source.names),
      specialDaysNextId: sanitizeCounter(
        source.counters?.specialDaysNextId,
        source.specialDays
      ),
    },
  };
}

function sanitizeNameEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry, index) => ({
      id: sanitizeId(entry?.id, index + 1),
      name: typeof entry?.name === "string" ? entry.name.trim() : "",
    }))
    .filter((entry) => entry.name);
}

function sanitizeSpecialDayEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry, index) => ({
      id: sanitizeId(entry?.id, index + 1),
      date: typeof entry?.date === "string" ? entry.date : "",
      note: typeof entry?.note === "string" ? entry.note.trim() : "",
    }))
    .filter((entry) => entry.date && entry.note);
}

function sanitizeSubmissionEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => ({
      name: typeof entry?.name === "string" ? entry.name : "",
      date: typeof entry?.date === "string" ? entry.date : "",
      monthKey: typeof entry?.monthKey === "string" ? entry.monthKey : "",
      shiftType: typeof entry?.shiftType === "string" ? entry.shiftType : "",
      start: typeof entry?.start === "string" ? entry.start : null,
      end: typeof entry?.end === "string" ? entry.end : null,
    }))
    .filter((entry) => entry.name && entry.date && entry.monthKey && entry.shiftType);
}

function sanitizeCounter(counterValue, list = []) {
  const value = Number(counterValue);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  const maxId = (Array.isArray(list) ? list : []).reduce((max, entry, index) => {
    const id = sanitizeId(entry?.id, index + 1);
    return Math.max(max, id);
  }, 0);
  return maxId + 1 || 1;
}

function sanitizeId(rawId, fallback) {
  const value = Number(rawId);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

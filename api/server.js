const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || "student-plaza-pa-shift-system";

/**
 * Normalize an origin entry:
 * - If it's a full URL (with protocol), use URL.origin (scheme + host + port).
 * - Otherwise, just trim trailing slash.
 */
function normalizeOrigin(entry) {
  if (!entry) return "";
  if (entry === "*") return "*";

  try {
    const parsed = new URL(entry);
    return parsed.origin;
  } catch (error) {
    // Fallback for values like "http://localhost:5173/" (no parsing needed)
    return entry.replace(/\/$/, "");
  }
}

/**
 * Build allowedOrigins from ALLOWED_ORIGINS env:
 *  ALLOWED_ORIGINS=https://your-frontend.onrender.com,http://localhost:5173
 */
const allowedOrigins = Array.from(
  new Set(
    (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizeOrigin)
      .filter(Boolean)
  )
);

const allowAllOrigins = allowedOrigins.includes("*");

// Helpful startup logs
console.log("=== CORS configuration ===");
console.log("Raw ALLOWED_ORIGINS:", process.env.ALLOWED_ORIGINS || "(none)");
console.log("Normalized allowedOrigins:", allowedOrigins);
console.log("allowAllOrigins:", allowAllOrigins);
console.log("==========================");

const corsOptions = {
  origin(origin, callback) {
    console.log("CORS request from origin:", origin || "(no origin header)");

    // Allow non-browser / server-to-server calls (no Origin header)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (
      allowAllOrigins ||
      !allowedOrigins.length || // if nothing set, allow everything
      allowedOrigins.includes(origin)
    ) {
      callback(null, true);
    } else {
      console.warn("Blocked by CORS. Origin not allowed:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 600,
};

const persistentDir =
  process.env.DATABASE_DIR ||
  process.env.PERSISTENT_DATA_DIR ||
  process.env.DATA_VOLUME;

const defaultDbFile = persistentDir
  ? path.join(persistentDir, "pa-shift-data.sqlite")
  : path.join(__dirname, "data.sqlite");

const dbFile = process.env.DATABASE_FILE || defaultDbFile;

fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new sqlite3.Database(dbFile);
console.log(`Using SQLite file at ${dbFile}`);

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// Auth middleware (after CORS)
app.use((req, res, next) => {
  // Let OPTIONS through without auth; CORS preflight
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  const incomingKey = req.header("x-api-key");
  if (!incomingKey || incomingKey !== API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// --- DB helpers ---

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

// --- Default seed data ---

const DEFAULT_NAMES = [
  "森",
  "松田",
  "劉",
  "長谷川",
  "中野",
  "片山",
  "黄",
  "ショーン",
  "繆",
  "張",
  "王",
  "李",
  "鄭",
];

const DEFAULT_SPECIAL_DAYS = [
  { date: "2023-11-07", note: "金曜授業" },
  { date: "2023-11-11", note: "在留期間更新" },
  { date: "2023-11-12", note: "在留期間更新" },
  { date: "2023-11-13", note: "在留期間更新" },
  { date: "2023-11-25", note: "期末試験" },
];

async function initializeDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS special_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      monthKey TEXT NOT NULL,
      shiftType TEXT NOT NULL,
      start TEXT,
      end TEXT
    )
  `);
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_submissions_name_month ON submissions(name, monthKey)"
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_submissions_date ON submissions(date)"
  );
}

async function seedDefaults() {
  const nameCount = await dbGet("SELECT COUNT(*) as count FROM names");
  if (!nameCount?.count) {
    for (const name of DEFAULT_NAMES) {
      await dbRun("INSERT INTO names (name) VALUES (?)", [name]);
    }
  }
  const specialCount = await dbGet(
    "SELECT COUNT(*) as count FROM special_days"
  );
  if (!specialCount?.count) {
    for (const entry of DEFAULT_SPECIAL_DAYS) {
      await dbRun("INSERT INTO special_days (date, note) VALUES (?, ?)", [
        entry.date,
        entry.note,
      ]);
    }
  }
}

// --- Routes ---

// Health check (does NOT require API key)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Names
app.get("/names", async (req, res, next) => {
  try {
    const rows = await dbAll("SELECT id, name FROM names ORDER BY name ASC");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/names", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const result = await dbRun("INSERT INTO names (name) VALUES (?)", [name]);
    const created = await dbGet("SELECT id, name FROM names WHERE id = ?", [
      result.lastID,
    ]);
    res.status(201).json(created);
  } catch (error) {
    if (error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Name already exists" });
      return;
    }
    next(error);
  }
});

app.put("/names/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const existing = await dbGet("SELECT id FROM names WHERE id = ?", [id]);
    if (!existing) {
      res.status(404).json({ error: "Name not found" });
      return;
    }
    await dbRun("UPDATE names SET name = ? WHERE id = ?", [name, id]);
    const updated = await dbGet("SELECT id, name FROM names WHERE id = ?", [
      id,
    ]);
    res.json(updated);
  } catch (error) {
    if (error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Name already exists" });
      return;
    }
    next(error);
  }
});

app.delete("/names/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await dbGet("SELECT id FROM names WHERE id = ?", [id]);
    if (!existing) {
      res.status(404).json({ error: "Name not found" });
      return;
    }
    await dbRun("DELETE FROM names WHERE id = ?", [id]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Special days
app.get("/special-days", async (req, res, next) => {
  try {
    const rows = await dbAll(
      "SELECT id, date, note FROM special_days ORDER BY date ASC"
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/special-days", async (req, res, next) => {
  try {
    const date = String(req.body?.date || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!date || !note) {
      res.status(400).json({ error: "Date and note are required" });
      return;
    }
    const result = await dbRun(
      "INSERT INTO special_days (date, note) VALUES (?, ?)",
      [date, note]
    );
    const created = await dbGet(
      "SELECT id, date, note FROM special_days WHERE id = ?",
      [result.lastID]
    );
    res.status(201).json(created);
  } catch (error) {
    if (error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Date already exists" });
      return;
    }
    next(error);
  }
});

app.put("/special-days/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const date = String(req.body?.date || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!date || !note) {
      res.status(400).json({ error: "Date and note are required" });
      return;
    }
    const existing = await dbGet(
      "SELECT id FROM special_days WHERE id = ?",
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: "Special day not found" });
      return;
    }
    await dbRun("UPDATE special_days SET date = ?, note = ? WHERE id = ?", [
      date,
      note,
      id,
    ]);
    const updated = await dbGet(
      "SELECT id, date, note FROM special_days WHERE id = ?",
      [id]
    );
    res.json(updated);
  } catch (error) {
    if (error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Date already exists" });
      return;
    }
    next(error);
  }
});

app.delete("/special-days/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await dbGet(
      "SELECT id FROM special_days WHERE id = ?",
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: "Special day not found" });
      return;
    }
    await dbRun("DELETE FROM special_days WHERE id = ?", [id]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Submissions
app.get("/submissions", async (req, res, next) => {
  try {
    const { monthKey, name } = req.query;
    const conditions = [];
    const params = [];

    if (monthKey) {
      conditions.push("monthKey = ?");
      params.push(monthKey);
    }
    if (name) {
      conditions.push("name = ?");
      params.push(name);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const rows = await dbAll(
      `SELECT id, name, date, monthKey, shiftType, start, end FROM submissions ${whereClause} ORDER BY date ASC`,
      params
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/submissions", async (req, res, next) => {
  const payload = req.body || {};
  const name = String(payload.name || "").trim();
  const monthKey = String(payload.monthKey || "").trim();
  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  if (!name || !monthKey) {
    res.status(400).json({ error: "Name and monthKey are required" });
    return;
  }
  if (!entries.length) {
    res.status(400).json({ error: "Entries are required" });
    return;
  }

  let inTransaction = false;

  try {
    await dbRun("BEGIN TRANSACTION");
    inTransaction = true;

    await dbRun("DELETE FROM submissions WHERE name = ? AND monthKey = ?", [
      name,
      monthKey,
    ]);

    const createdEntries = [];

    for (const entry of entries) {
      const date = String(entry.date || "").trim();
      const shiftType = String(entry.shiftType || "").trim();
      const start = entry.start ?? null;
      const end = entry.end ?? null;

      if (!date || !shiftType) {
        throw new Error("Invalid entry");
      }

      const result = await dbRun(
        "INSERT INTO submissions (name, date, monthKey, shiftType, start, end) VALUES (?, ?, ?, ?, ?, ?)",
        [name, date, monthKey, shiftType, start, end]
      );

      createdEntries.push({
        id: result.lastID,
        name,
        date,
        monthKey,
        shiftType,
        start,
        end,
      });
    }

    await dbRun("COMMIT");
    inTransaction = false;

    res.status(201).json(createdEntries);
  } catch (error) {
    if (inTransaction) {
      try {
        await dbRun("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed", rollbackError);
      }
    }
    next(error);
  }
});

// --- Error handler ---

app.use((err, req, res, next) => {
  console.error("API error", err);
  if (err.message === "Not allowed by CORS") {
    res.status(403).json({ error: "CORS rejection" });
    return;
  }
  res.status(500).json({ error: "Internal Server Error" });
});

// --- Bootstrap ---

async function bootstrap() {
  try {
    await initializeDatabase();
    await seedDefaults();
    app.listen(PORT, () => {
      console.log(`API server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start API server", error);
    process.exit(1);
  }
}

bootstrap();

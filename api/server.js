import cors from "cors";
import express from "express";
import morgan from "morgan";
import { createStorage } from "./storage.js";

const PORT = process.env.PORT || 10000;
const DATA_FILE = process.env.DATA_FILE || "./api-data.json";
const storage = createStorage(DATA_FILE);
await storage.ensureInitialized();

const app = express();

// --- ここを修正 ---
// すべてのオリジンからのアクセスを許可
app.use(cors());
// プリフライト(OPTIONS)にも CORS ヘッダを付ける
app.options("*", cors());
// -----------------

app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

app.get("/", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", async (req, res, next) => {
  try {
    const data = await storage.read();
    res.json({ ok: true, counts: buildCounts(data) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/data", async (req, res, next) => {
  try {
    const data = await storage.read();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.post("/api/data", async (req, res, next) => {
  try {
    await storage.write(req.body || {});
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

function buildCounts(payload) {
  return {
    names: payload.names?.length || 0,
    specialDays: payload.specialDays?.length || 0,
    submissions: payload.submissions?.length || 0,
  };
}

import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import "./db.js";
import { api } from "./routes.js";
import { initTelegram } from "./telegram.js";
import { startBackgroundJobs } from "./jobs.js";
import { learnPublicUrl } from "./keepalive.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // metadata only; parts are raw streams

// Auto-learn public URL for self-ping keep-alive
app.use((req, _res, next) => {
  const host = req.headers.host;
  if (host && !host.includes("localhost") && !host.includes("127.0.0.1") && !host.includes("0.0.0.0")) {
    const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
    learnPublicUrl(`${proto}://${host}`);
  }
  next();
});

// Lightweight health check & uptime monitor endpoints
app.get(["/ping", "/health"], (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "TeleMoon",
    time: Date.now(),
    uptime: Math.floor(process.uptime()),
  });
});

app.use("/api", api);

// Serve the built web app when web/dist exists (single-service deploy).
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist"
);
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(cfg.port, () =>
  console.log(`TeleMoon server → http://localhost:${cfg.port}`)
);

startBackgroundJobs();

initTelegram().catch((e) => {
  console.error("[tg] init failed:", e.message);
});

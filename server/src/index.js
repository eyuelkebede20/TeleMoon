import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import "./db.js";
import { api } from "./routes.js";
import { initTelegram } from "./telegram.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // metadata only; parts are raw streams

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

initTelegram().catch((e) => {
  console.error("[tg] init failed:", e.message);
});

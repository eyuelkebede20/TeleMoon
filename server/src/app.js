import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import "./db.js";
import { api } from "./routes.js";

export const app = express();

if (cfg.corsOrigins.length) {
  app.use(cors({ origin: cfg.corsOrigins, credentials: false }));
}
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "frame-ancestors 'none'",
    "frame-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  ].join("; "));
  next();
});
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

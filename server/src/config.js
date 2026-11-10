import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const num = (v, d) => (v !== undefined && v !== "" ? Number(v) : d);
const MB = 1024 * 1024;

export const cfg = {
  port: num(process.env.PORT, 8080),
  dataDir: process.env.DATA_DIR || "./data",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",

  // Telegram
  apiId: num(process.env.TG_API_ID, 0),
  apiHash: process.env.TG_API_HASH || "",
  botToken: process.env.TG_BOT_TOKEN || "",
  session: process.env.TG_SESSION || "", // optional: reuse a saved session (or a premium user session)
  channel: process.env.TG_CHANNEL_ID || "", // "-100xxxxxxxxxx" or "@username"

  // Chunking. Telegram hard cap: 2 GB/message via bot MTProto, 4 GB via premium user session.
  chunkBytes: Math.min(num(process.env.CHUNK_MB, 1536), 1900) * MB,

  // Keep-alive / Auto-ping (prevents cloud container idle sleep on Railway/Render)
  pingUrl:
    process.env.PING_URL ||
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : "") ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    "",
  pingIntervalMin: num(process.env.PING_INTERVAL_MIN, 10),
  pingEnabled: process.env.PING_ENABLED !== "false",
};

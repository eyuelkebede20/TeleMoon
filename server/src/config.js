import "dotenv/config";

const num = (v, d) => (v !== undefined && v !== "" ? Number(v) : d);
const MB = 1024 * 1024;

export const cfg = {
  port: num(process.env.PORT, 8080),
  dataDir: process.env.DATA_DIR || "./data",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  inviteCode: process.env.INVITE_CODE || "",

  // Telegram
  apiId: num(process.env.TG_API_ID, 0),
  apiHash: process.env.TG_API_HASH || "",
  botToken: process.env.TG_BOT_TOKEN || "",
  session: process.env.TG_SESSION || "", // optional: reuse a saved session (or a premium user session)
  channel: process.env.TG_CHANNEL_ID || "", // "-100xxxxxxxxxx" or "@username"

  // Chunking. Telegram hard cap: 2 GB/message via bot MTProto, 4 GB via premium user session.
  chunkBytes: Math.min(num(process.env.CHUNK_MB, 1536), 1900) * MB,
};

# 🌙 TeleMoon

A Google-Drive-style web app where every account brings a **private Telegram channel** as its storage backend. Files of any size are split into ≤1.5 GB parts, each stored as one channel message; TeleMoon keeps the folder tree, reassembles parts on download (with HTTP Range support, so video seeking works), and auto-indexes files dropped directly into each paired channel.

Talks **MTProto** (GramJS) — not the Bot HTTP API, which caps transfers at 20/50 MB.

## Setup (10 minutes)

1. **API keys** — sign in at [my.telegram.org](https://my.telegram.org) → _API development tools_ → copy `api_id` and `api_hash` into `server/.env` (`cp server/.env.example server/.env`).
2. **Identity** — either run `npm run login` for a **user session** (premium → 4 GB parts), or create a **bot** via [@BotFather](https://t.me/BotFather). The configured account or bot must be an administrator in every paired channel.
3. **Install & run**
   ```bash
   npm install
   npm run dev:server        # terminal 1
   npm run dev:web           # terminal 2 → http://localhost:5173
   ```
4. **Enter** — type any `@handle` + password. The first account becomes the deployment owner; later accounts are isolated members.
5. **Pair storage in the app** — each account creates a one-time code, adds the configured bot/account to its private channel, and posts the code there. The code expires after ten minutes. Every account gets an isolated drive and channel.

Interrupted uploads keep their completed Telegram parts. After a refresh, TeleMoon shows the pending upload and asks you to reselect the same local file before continuing. Normal deletion moves items to Trash; only permanent deletion removes metadata and queues the Telegram messages for retry-safe removal.

## Production

```bash
npm run build     # builds web/dist — the server serves it itself
npm start         # single service on :8080
```

Deploy on any always-on Node host (VPS, Railway, Fly, a Pi at home). Needs: persistent `DATA_DIR` (SQLite = the index of your entire drive — **back it up**), and free disk ≥ `CHUNK_MB` in `DATA_DIR/tmp` for in-flight parts. Put a reverse proxy (Caddy/nginx) in front for TLS; disable any proxy request-body limit for `/api/uploads/*` (`client_max_body_size 0;`).

Production also requires a strong, unique `JWT_SECRET`. Cross-origin API access is disabled by default; set `CORS_ORIGINS` only when the frontend is intentionally hosted on a different origin.

Browser sessions use an HttpOnly, SameSite cookie; file preview and download URLs never include the account JWT. Bearer authentication remains available to API clients.

## Bigger parts (4 GB)

Telegram Premium accounts can send 4 GB per message. Run `npm run login`, paste the printed `TG_SESSION` into `.env`, clear `TG_BOT_TOKEN`, and raise `CHUNK_MB` (≤ 3900). The session must be an admin of the channel.

## Honest limitations

- "Unlimited" is Telegram's current policy, not a contract. Personal-scale use has been fine for years; industrial abuse gets accounts flagged. **Keep a second copy of anything you can't lose** — and losing `data/telemoon.db` loses the map of which messages and channels form which files (the bytes stay in Telegram, but reassembly becomes manual).
- Throughput is Telegram-DC bound: typically 5–20 MB/s per transfer.
- Trash is manually emptied; automatic retention-based cleanup is not implemented yet.

Architecture, API surface, invariants, and roadmap: see [CLAUDE.md](CLAUDE.md).

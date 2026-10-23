# 🌙 TeleMoon

A Google-Drive-style web app whose storage backend is a **private Telegram channel**. Files of any size are split into ≤1.5 GB parts, each stored as one channel message; TeleMoon keeps the folder tree, reassembles parts on download (with HTTP Range support, so video seeking works), and auto-indexes files your friends drop directly into the channel.

Talks **MTProto** (GramJS) — not the Bot HTTP API, which caps transfers at 20/50 MB.

## Setup (10 minutes)

1. **API keys** — sign in at [my.telegram.org](https://my.telegram.org) → *API development tools* → copy `api_id` and `api_hash` into `server/.env` (`cp server/.env.example server/.env`).
2. **Identity** — either run `npm run login` for a **user session** (recommended: lets the app join `t.me/+…` invite links and list your existing channels; premium → 4 GB parts), or create a **bot** via [@BotFather](https://t.me/BotFather) and add it as channel admin.
3. **Install & run**
   ```bash
   npm install
   npm run dev:server        # terminal 1
   npm run dev:web           # terminal 2 → http://localhost:5173
   ```
4. **Enter** — type any `@handle` + password. No signup: a new handle becomes yours on the spot.
5. **Link storage in the app** — paste your private channel's invite link (or pick one of your existing channels from the list). Remembered in the database; no restart needed.

## Production

```bash
npm run build     # builds web/dist — the server serves it itself
npm start         # single service on :8080
```

Deploy on any always-on Node host (VPS, Railway, Fly, a Pi at home). Needs: persistent `DATA_DIR` (SQLite = the index of your entire drive — **back it up**), and free disk ≥ `CHUNK_MB` in `DATA_DIR/tmp` for in-flight parts. Put a reverse proxy (Caddy/nginx) in front for TLS; disable any proxy request-body limit for `/api/uploads/*` (`client_max_body_size 0;`).

## Bigger parts (4 GB)

Telegram Premium accounts can send 4 GB per message. Run `npm run login`, paste the printed `TG_SESSION` into `.env`, clear `TG_BOT_TOKEN`, and raise `CHUNK_MB` (≤ 3900). The session must be an admin of the channel.

## Honest limitations

- "Unlimited" is Telegram's current policy, not a contract. Personal-scale use has been fine for years; industrial abuse gets accounts flagged. **Keep a second copy of anything you can't lose** — and losing `data/telemoon.db` loses the map of which messages form which files (the bytes stay in Telegram, but reassembly becomes manual).
- Throughput is Telegram-DC bound: typically 5–20 MB/s per transfer.
- Deleting in TeleMoon deletes the channel messages too (permanent, no trash yet).

Architecture, API surface, invariants, and roadmap: see [CLAUDE.md](CLAUDE.md).

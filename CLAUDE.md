# TeleMoon — living doc

Drive-style web app over a private Telegram channel. Source of truth for architecture and decisions; update on every meaningful change.

## System map

```
Browser (React/Vite, web/) ── JSON /api ──► Express (server/src)
                                              ├─ better-sqlite3  data/telemoon.db   (virtual FS + chunk map)
                                              └─ GramJS MTProto ─► private channel  (blob store, 1 part = 1 message)
```

- `server/src/config.js` env → cfg. `db.js` schema + FS helpers + settings KV. `telegram.js` MTProto connect, channel linking (setChannel/connectByLink/listDialogs), sendDocument, streamRange, deleteMessages, channel indexer. `routes.js` all endpoints. `index.js` wiring + serves `web/dist` when built.
- `web/src/api.js` fetch wrapper + chunked uploader (XHR per part, progress, 3× retry, cancel). `Drive.jsx` browser UI (card grid). `Connect.jsx` storage linking (paste link / pick dialog). `Auth.jsx` @handle entry. `icons.jsx` incl. MoonProgress (signature: uploads render as a waxing moon).
- `design-principle.md` (repo root) is the design source of truth — check every UI change against it.

## Invariants — do not break

1. **Chunks are immutable.** A file = ordered `chunks(file_id, idx, msg_id, size)`. Edits = new upload. Never rewrite a Telegram message.
2. **Caption protocol**: every TeleMoon-authored part message starts `tm1;f=<name>;p=<i>/<n>`. The indexer skips `tm1;`-prefixed posts; foreign document posts get indexed into `/Telegram Inbox` as single-chunk files. Changing the prefix breaks self/foreign discrimination.
3. **MTProto alignment**: `iterDownload` offset must be 4096-aligned, `requestSize` 4096-multiple ≤1 MB. `streamRange` over-fetches to the boundary and trims — keep that logic if touching downloads.
4. **`node.size` = Σ chunk sizes.** `complete` endpoint enforces; Range math depends on it.
5. **Parts ≤ 2 GB (bot) / 4 GB (premium user session).** `CHUNK_MB` clamped at 1900 in bot mode default; server clamps regardless of client.
6. **DB is the only map** from names to message ids. Backup = copy `data/` (WAL: use `sqlite3 .backup` or stop server).
7. **Linked channel lives in DB** (`settings.channel`, "-100…" string), set from the UI; `TG_CHANNEL_ID` env is only a first-boot seed. Switching channels does NOT migrate previously stored files — their chunks stay in the old channel and downloads for them will 502.

## API surface (all under /api, Bearer JWT; `?t=` accepted for content URLs)

```
GET  /status                                   public health + channel + mode + inviteRequired + chunkBytes
POST /auth/enter {handle,password,invite?}     one door: known @handle signs in, new one is claimed
                                               (invite only if INVITE_CODE set & users>0)
GET  /tg/dialogs                               channels/supergroups of the account (user session only)
POST /tg/connect {link}                        t.me/+HASH | @name | -100… → join/resolve, persist in settings
GET  /nodes/:id/children                       {folder,breadcrumb,children}; id 'root'
POST /folders {parentId,name}
PATCH /nodes/:id {name?|parentId?}             rename/move; cycle-checked
DELETE /nodes/:id                              recursive + deletes TG messages (revoke)
GET  /search?q=
POST /uploads {name,size,mime,parentId} → {id,chunkSize}
PUT  /uploads/:id/parts/:idx   raw body → tmp file → sendFile → msg_id (retry-safe: replaces old msg)
POST /uploads/:id/complete → file node        (validates count + Σsize)
DELETE /uploads/:id                            abort, purge sent parts
GET  /files/:id/content[?dl=1]                 streams; full Range support across chunk boundaries; HEAD ok
```

## Env

`TG_API_ID` `TG_API_HASH` `TG_BOT_TOKEN` (bot mode) | `TG_SESSION` (user mode via `npm run login`, premium → 4 GB; required for invite-link joins + dialog list) · `TG_CHANNEL_ID` (optional seed; the UI-linked channel in `settings` wins) · `PORT` `DATA_DIR` `JWT_SECRET` `INVITE_CODE` (optional; empty = open handle claiming) `CHUNK_MB` (≤1900).

## Ops runbook

- **Boot without TG env** → API runs, storage endpoints 503, `/status.error` says why. UI lands on the Connect screen with an explainer.
- **No channel linked** → Connect screen: paste invite link/@name/-100 id, or pick a dialog (user mode). Bot-mode fallback: post in channel, copy `[setup] channel id` from logs, paste it into the box.
- **Session churn**: bot re-auths each boot; to pin, copy the logged `TG_SESSION=` into env.
- **FLOOD_WAIT**: GramJS auto-sleeps on short waits. Symptom of hammering: parallel transfers stall — transfers are deliberately serialized client-side.
- **Message deleted in Telegram by hand** → download 502 for that chunk. No repair tool yet (roadmap).
- Temp parts land in `DATA_DIR/tmp`, removed after send; crash leftovers are safe to delete.

## Design tokens (web)

Ink `#0E1220` / panel `#171C30` / line `#262D4A` / text `#E9ECFA` / muted `#9099BE` / **moon `#F0D9A8`** / sky `#8FB4FF`. Type: Space Grotesk (UI), JetBrains Mono (data). Signature: MoonProgress waxing-moon upload indicator; keep everything else quiet.

## Decisions log

- 2026-07-19 MTProto over Bot HTTP API (20/50 MB caps kill the concept). GramJS chosen (Node stack consistency).
- 2026-07-19 Chunk default 1536 MB (user's 1.5 GB instinct; hard cap 2 GB bot). Client slices via Blob.slice; server buffers one part on disk, never in RAM.
- 2026-07-19 One shared workspace for all accounts (friends-circle model), invite-gated registration. Per-user drives = roadmap.
- 2026-07-19 Hard delete incl. Telegram messages; no trash. Judged acceptable for v0 with confirm dialog.
- 2026-07-19 Indexer ingests only `document` media (photos sent as photos lack filenames; "send as File" to index).
- 2026-07-19 No-signup auth: single `/auth/enter` with Telegram-style `@handle` + password; unknown handle = claimed on the spot (INVITE_CODE optional gate). Email/name dropped; old DBs migrate handle = email local part.
- 2026-07-19 Channel linking moved into the app (paste t.me/+ link or pick from dialogs), persisted in `settings` table. Requires user session for joins/dialogs; bot mode connects by @name/-100 id only. Channels/supergroups only (`className === "Channel"`).
- 2026-07-19 Drive UI switched from table rows to card grid ("simple boxes"); `design-principle.md` added as the design contract for all pages.

## Roadmap

1. **Client-side encryption** (AES-GCM per file, key from passphrase; chunk-aligned so Range still works) — do this before storing anything sensitive.
2. Share links (signed, expiring) for non-account friends.
3. Thumbnails (Telegram already stores doc thumbs — fetch small size).
4. Repair/scan tool: verify all chunk msgs exist; re-index full channel history (`client.iterMessages`).
5. Per-user root folders + quotas; trash with delayed purge.
6. tus-style resumable uploads across page reloads (parts table already supports it — needs client persistence).
7. PWA + background upload via service worker.

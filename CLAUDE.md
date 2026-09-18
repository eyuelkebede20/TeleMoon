# TeleMoon — living doc

Drive-style web app where each account pairs its own private Telegram channel. Source of truth for architecture and decisions; update on every meaningful change.

## System map

```
Browser (React/Vite, web/) ── JSON /api ──► Express (server/src)
                                              ├─ better-sqlite3  data/telemoon.db   (users + virtual FS + storage map)
                                              └─ GramJS MTProto ─► per-user private channels (1 part = 1 message)
```

- `server/src/config.js` env → cfg. `db.js` schema + FS/storage helpers. `pairing.js` one-time-code primitives. `telegram.js` MTProto connection, per-storage entity resolution, pairing event handling, transfers, deletion and channel indexer. `routes.js` all endpoints. `app.js` testable HTTP app; `index.js` process startup.
- `web/src/api.js` fetch wrapper + resumable chunked uploader (XHR per part, progress, 5× backoff, explicit cancel). `Drive.jsx` browser UI (card grid, recovered-upload panel, Trash). `Connect.jsx` per-user code pairing. `Auth.jsx` @handle entry. `icons.jsx` incl. MoonProgress (signature: uploads render as a waxing moon).
- `design-principle.md` (repo root) is the design source of truth — check every UI change against it.

## Invariants — do not break

1. **Chunks are immutable.** A file = ordered `chunks(file_id, idx, msg_id, size)`. Edits = new upload. Never rewrite a Telegram message.
2. **Caption protocol**: every TeleMoon-authored part message starts `tm1;f=<name>;p=<i>/<n>`. Human-readable file, part, and size details follow on separate lines. The indexer skips `tm1;`-prefixed posts; foreign document posts get indexed into `/Telegram Inbox` as single-chunk files. Changing the prefix breaks self/foreign discrimination.
3. **MTProto alignment**: `iterDownload` offset must be 4096-aligned, `requestSize` 4096-multiple ≤1 MB. `streamRange` over-fetches to the boundary and trims — keep that logic if touching downloads.
4. **`node.size` = Σ chunk sizes.** `complete` endpoint enforces; Range math depends on it.
5. **Parts ≤ 2 GB (bot) / 4 GB (premium user session).** `CHUNK_MB` clamped at 1900 in bot mode default; server clamps regardless of client.
6. **DB is the only map** from names to message ids. Backup = copy `data/` (WAL: use `sqlite3 .backup` or stop server).
7. **Storage connections are immutable file locations.** Every chunk records a `storage_id`; pairing a new active channel archives the previous connection but old downloads continue resolving through it. `settings.channel` and `TG_CHANNEL_ID` exist only for legacy-owner migration.
8. **Ownership is enforced at lookup time.** `root` is the only shared virtual node. Every other node and upload belongs to one user; never use a bare client-supplied id for an authenticated operation without `getOwnedNode` or an equivalent owner predicate.
9. **Incomplete uploads are recoverable.** Successfully sent parts remain in `upload_parts`; errors never auto-abort. Completion keeps an idempotency record for seven days. Only explicit cancellation queues uploaded parts for Telegram deletion.
10. **Normal deletion is soft.** A subtree remains mapped to its Telegram messages while in Trash. Shares are revoked immediately. Permanent deletion records every Telegram removal in `deletion_queue` before metadata is removed; the queue drains at startup, on deletion, and every five minutes.

## API surface (all under /api; HttpOnly browser session or Bearer JWT)

```
GET  /health                                   public liveness only
GET  /public-status                            public account count + inviteRequired
GET  /status                                   authenticated user's active channel + mode + chunkBytes
POST /auth/enter {handle,password,invite?}     one door: known @handle signs in, new one is claimed
                                               (invite only if INVITE_CODE set & users>0)
GET  /auth/me                                  current server-side id, handle and role
POST /tg/pair                                  one-time 10-minute channel pairing code
GET  /nodes/:id/children                       {folder,breadcrumb,children}; id 'root'
POST /folders {parentId,name}
PATCH /nodes/:id {name?|parentId?}             rename/move; cycle-checked
DELETE /nodes/:id                              recursively moves subtree to Trash
GET  /trash                                    user's top-level Trash items
POST /trash/:id/restore                        restore subtree (root fallback if parent is gone)
DELETE /trash/:id                              permanent metadata removal + durable TG cleanup queue
DELETE /trash                                  permanently empty user's Trash
GET  /search?q=
GET  /uploads                                  recoverable active upload manifests
GET  /uploads/:id                              active/completed manifest for retry recovery
POST /uploads {name,size,mime,parentId,lastModified?} → manifest
PUT  /uploads/:id/parts/:idx   raw body → tmp file → sendFile → msg_id (stored part is idempotent)
POST /uploads/:id/complete → file node        validates count + Σsize; repeat-safe
DELETE /uploads/:id                            explicit abort + durable TG cleanup queue
GET  /files/:id/content[?dl=1]                 streams; full Range support across chunk boundaries; HEAD ok
```

Browser authentication uses an HttpOnly, SameSite=Strict session cookie so media and download URLs do not contain long-lived JWTs. Bearer JWT remains supported for non-browser API clients.

## Env

`TG_API_ID` `TG_API_HASH` `TG_BOT_TOKEN` (bot mode) | `TG_SESSION` (user mode via `npm run login`, premium → 4 GB) · `TG_CHANNEL_ID` (legacy owner seed only) · `PORT` `DATA_DIR` `JWT_SECRET` `INVITE_CODE` (optional; empty = open handle claiming) `CORS_ORIGINS` (optional) `CHUNK_MB` (≤1900).

## Ops runbook

- **Boot without TG env** → API runs, storage endpoints 503, `/status.error` says why. UI lands on the Connect screen with an explainer.
- **No channel paired** → Connect screen creates a 10-minute `TM-PAIR-…` code. Add the configured bot/account to the private channel and post that exact code; the event handler activates an immutable `storage_connections` row for that user.
- **Session churn**: bot re-auths each boot; to pin, copy the logged `TG_SESSION=` into env.
- **FLOOD_WAIT**: GramJS auto-sleeps on short waits. Symptom of hammering: parallel transfers stall — transfers are deliberately serialized client-side.
- **Message deleted in Telegram by hand** → download 502 for that chunk. No repair tool yet (roadmap).
- Temp parts land in `DATA_DIR/tmp`, removed after send; crash leftovers are safe to delete.

## Design tokens (web)

Ink `#0E1220` / panel `#171C30` / line `#262D4A` / text `#E9ECFA` / muted `#9099BE` / **moon `#F0D9A8`** / sky `#8FB4FF`. Type: Space Grotesk (UI), JetBrains Mono (data). Signature: MoonProgress waxing-moon upload indicator; keep everything else quiet.

## Decisions log

- 2026-07-19 MTProto over Bot HTTP API (20/50 MB caps kill the concept). GramJS chosen (Node stack consistency).
- 2026-07-19 Chunk default 1536 MB (user's 1.5 GB instinct; hard cap 2 GB bot). Client slices via Blob.slice; server buffers one part on disk, never in RAM.
- 2026-09-15 Per-user drives and per-user Telegram channels. Pairing is proven by posting a single-use code in the channel. The first account remains deployment owner for server administration; legacy files and the old global channel are migrated to it.
- 2026-09-15 Normal delete replaced by recoverable per-user Trash. Permanent deletion uses a durable Telegram deletion queue so outages cannot silently orphan cleanup work.
- 2026-07-19 Indexer ingests only `document` media (photos sent as photos lack filenames; "send as File" to index).
- 2026-07-19 No-signup auth: single `/auth/enter` with Telegram-style `@handle` + password; unknown handle = claimed on the spot (INVITE_CODE optional gate). Email/name dropped; old DBs migrate handle = email local part.
- 2026-09-15 Direct channel-id/link entry replaced by proof-of-access pairing codes. Codes are random, stored only as hashes, expire after ten minutes and are consumed after a successful channel post.
- 2026-09-15 Upload manifests survive reloads, stored parts are reused, network failures preserve progress, completion is idempotent, and cancellation is explicit.
- 2026-07-19 Drive UI switched from table rows to card grid ("simple boxes"); `design-principle.md` added as the design contract for all pages.
- 2026-09-18 Signed-out users now land on a product overview with the single-door sign-in card; Telegram upload captions retain the `tm1;` protocol line and add readable file, part, and size details.

## Roadmap

1. **Client-side encryption** (AES-GCM per file, key from passphrase; chunk-aligned so Range still works) — do this before storing anything sensitive.
2. Share links (signed, expiring) for non-account friends.
3. Thumbnails (Telegram already stores doc thumbs — fetch small size).
4. Repair/scan tool: verify all chunk msgs exist; re-index full channel history (`client.iterMessages`).
5. Quotas and optional retention-based Trash purge.
6. File System Access API / PWA background uploads so supported browsers can resume without asking the user to reselect the local file.

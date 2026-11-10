# TeleMoon Engineering & Architecture Learnings

Living log of architecture decisions (ADRs), ecosystem library evaluations, edge cases, and bug discoveries.

---

## 2026-11-09 — Desktop SQLite Initialization & Concurrency Lock Fixes

**Goal:** Prevent desktop SQLite crashes and database lock exceptions during desktop app execution and test runs.

### Libraries evaluated

| Library | Maintained? | License | Size | Verdict | Reason |
| --- | --- | --- | --- | --- | --- |
| `sqflite` + `sqflite_common_ffi` | Yes (Active) | BSD-2-Clause | Standard | Selected | Canonical SQLite implementation for Flutter supporting iOS, Android, and desktop (Windows, macOS, Linux). |
| `drift` | Yes (Active) | MIT | Heavy | Rejected | Unnecessary overhead for lightweight channel persistence and sync tracking. |

### Reference files studied

- `app/lib/database_helper.dart` — channel history persistence for desktop and mobile.
- `app/lib/sync/sync_db.dart` — offline sync queue, entry index, and tracking settings.

### Edge cases & gotchas discovered

1. **Desktop FFI Factory Uninitialized:**
   - On Windows, Linux, and macOS, `sqflite` requires `sqfliteFfiInit()` and assigning `databaseFactory = databaseFactoryFfi;` before any `openDatabase()` call.
   - If `DatabaseHelper` was called before `SyncDB` (such as when `LinkStorageScreen` loads previous channels on startup), `DatabaseHelper` threw an unhandled exception or failed, which caused connecting or linking channels on desktop to fail.
2. **SQLite File Locking (`SqliteException(5): database is locked`):**
   - Without WAL (Write-Ahead Logging) mode and busy timeout, concurrent access between parallel Flutter test runners or simultaneous UI/engine tasks caused database lock errors on Windows.
   - Fix: Open database with `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;`.
   - Provide isolated test databases for unit tests so tests do not collide on a single shared file.

### Decision

- Initialize `sqfliteFfiInit()` and `databaseFactory = databaseFactoryFfi;` centrally in `main()` of `app/lib/main.dart` during app bootstrap.
- Enable `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` on both `DatabaseHelper` and `SyncDB`.
- Support test database isolation in `SyncDB` via `initForTesting()`.

### Follow-ups

- Audit light mode styling in `LinkStorageScreen` to ensure creamy palette is strictly respected.
- Ensure all Flutter widget tests run in isolated environments without resource contention.

---

## 2026-11-10 — Auth Separation, Channel Linking Trap & Stale Session Remediation

**Goal:** Separate Login and Sign-up flows, restore interactive canvas animation in dark blue, fix channel linking trap, and resolve 401/404 session verification errors.

### Libraries evaluated

| Library | Maintained? | License | Size | Verdict | Reason |
| --- | --- | --- | --- | --- | --- |
| Native Canvas 2D + RequestAnimationFrame | Yes | N/A | 0 kB | Selected | Pure high-performance fluid rendering with DPR awareness and reduced-motion fallback. |
| `bcryptjs` + `jsonwebtoken` | Yes | MIT | 45 kB | Selected | Existing reliable authentication foundation. |

### Edge cases & gotchas discovered

1. **Connect Trap / Lost React State on Channel Link:**
   - In `Connect.jsx`, `api.saveChannel()` updated `localStorage` via `savedUser.set(...)`, but never invoked a state updater callback in `App.jsx`.
   - As a result, `App.jsx`'s `user.channel_id` remained `null`, which kept `if (!user.channel_id)` true, immediately redirecting the user back to `<Connect>` in an inescapable loop.
   - Fix: Added `onUserUpdate` callback prop to `<Connect>`, updating both `localStorage` and `App.jsx` React state immediately upon channel link.
2. **Missing Endpoints Causing 404s & 401 Loops:**
   - `/api/public-status` and `/api/auth/logout` were missing from the router, triggering 404s on every page load and sign-out.
   - When a stored token was invalid or expired, `App.jsx` lacked boot verification, leading to consecutive 401s on `/api/tg/dialogs` and `/api/auth/me`.
   - Fix: Added `GET /api/public-status`, `POST /api/auth/logout`, and boot-time session verification via `api.me()` that gracefully purges expired tokens and resets to the Login tab.
3. **Implicit vs Explicit Auth Flow:**
   - Single "enter" door confused users because typing an existing handle with a typo in password failed ambiguously or vice-versa.
   - Fix: Split into explicit `POST /api/auth/login` (404 if handle absent, 401 if wrong password) and `POST /api/auth/signup` (409 if handle taken, 201 on success), while retaining `POST /api/auth/enter` for backward compatibility.
4. **Interactive Canvas Night Sky Theme Restoration:**
   - Restored `AuthCanvas` with the signature TeleMoon dark blue/indigo night sky (`#0e1220` -> `#121730` -> `#090d18`), featuring the 3D-kinematic paper airplane, liquid metaballs, contrail wakes, and dynamic light/dark adaptability.

### Decision

- Fully separated Login and Sign-up tabs with client and server validation.
- Boot session verification hook in `App.jsx` with automatic cleanup of stale credentials.
- Two-way user state sync between `Connect.jsx` and `App.jsx`.
- Comprehensive automated test suite in `server/test/auth.test.js`.

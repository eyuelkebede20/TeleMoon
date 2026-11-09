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

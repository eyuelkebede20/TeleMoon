# TeleMoon: Status & Tasks

## 1. What Has Been Made
- **Core Architecture:** A web-based Google Drive-like application backed by a private Telegram channel via MTProto (GramJS).
- **Backend:** Express server with SQLite (`better-sqlite3`) tracking the virtual file system (VFS) and mapping file chunks to Telegram message IDs.
- **Frontend:** React/Vite UI featuring a dark "night sky" design system (enforced by `design-principle.md`).
- **Features:** 
  - Handle-based authentication with no strict signup requirement.
  - Chunked file uploads (split into ≤1.5GB/4GB parts) sending directly to Telegram.
  - Streamed downloads with full HTTP Range support (allows seeking in streamed videos).
  - Folder navigation, moving (via drag and drop), renaming, and deleting nodes.
  - File preview modal for images, videos, audio, and PDFs.

## 2. What's Broken / Needs Improvement
- **UI/UX Principle Violations:** The frontend (`web/src/Drive.jsx`) heavily relies on native browser dialogues (`alert()`, `confirm()`, `prompt()`) for creating folders, renaming files, deleting items, and showing errors. This directly violates Rule #6 in `design-principle.md` ("never a browser alert for flow errors"). These must be replaced with custom, in-app modal components.
- **Error Handling:** When API requests fail (e.g., `mkdir`, `rename`), they currently pop up a browser `alert(e.message)` instead of rendering the error in `--danger` text inside the relevant component.
- **Resiliency & Data Safety:** 
  - Deleting files currently permanently deletes the Telegram messages (no trash bin). 
  - A failure during deleting or a desync could lead to orphaned chunks in the Telegram channel.
- **Upload Durability:** Uploads use standard XHR and are not resumable across page reloads.

## 3. Tasks Instructions
### High Priority: UI/UX Fixes
- [x] **Refactor native dialogues:** Replace all instances of `prompt()`, `confirm()`, and `alert()` in `web/src/Drive.jsx` with custom React modals styled according to `--panel` and `--panel-2` guidelines.
- [x] **Inline Error Rendering:** Catch API errors and display them within the UI context (e.g., inside the custom folder creation modal) using the `--danger` text color.

### Core Roadmap Items
- [ ] **Client-side encryption:** Implement AES-GCM encryption per file (chunk-aligned so HTTP Range still works) using a passphrase, before uploading.
- [x] **Share links:** Create signed, expiring share links for non-account friends to download files.
- [x] **Thumbnails:** Inline image previews for small images directly in the grid.
- [ ] **Repair/Scan tool:** Create an admin tool to verify all chunk messages exist and re-index full channel history (`client.iterMessages`).
- [x] **User Isolation:** Implement per-user root folders, storage quotas, and a trash system with delayed purge.
- [ ] **Resumable uploads:** Upgrade to tus-style resumable uploads across page reloads (the backend parts table already supports it, needs client persistence).
- [ ] **PWA & Backgrounding:** Add a service worker for background uploads and Progressive Web App support.

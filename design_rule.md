# TeleMoon Design Rules & System

## 1. Core Principles
- **Privacy First:** All user files must be heavily protected. Client-side AES-GCM encryption is offered for uploads to ensure even Telegram cannot read the file contents.
- **Telegram as the Backbone:** TeleMoon uses Telegram's MTProto infrastructure as a highly scalable, free object storage layer. Files are chunked and streamed directly to a private Telegram channel.
- **Minimalist, App-like UI:** The interface should feel native, especially on mobile. Avoid bloated menus and heavy frameworks; rely on clean CSS grid/flexbox layouts and micro-animations to convey state.
- **Resiliency:** Network interruptions during uploads or deletions must not corrupt state. Use local SQLite queues (`deletion_queue`, `upload_parts`) to resume or retry failed Telegram API calls automatically.

## 2. Visual Language
- **Typography:** System fonts preferred for zero-latency loading and native feel (`system-ui`, `-apple-system`, `BlinkMacSystemFont`).
- **Color Palette:**
  - `Background`: `#ffffff` (light), `#121212` (dark)
  - `Panels/Cards`: Subtle contrast from background (`--panel`, `--panel-2`).
  - `Accent/Primary`: "Moon" blue/indigo (`--moon`).
  - `Danger`: Crimson/Red (`--danger`) for destructive actions (Trash, Delete).
- **Components:**
  - **Cards:** Rounded corners (`14px`), subtle borders (`1px solid var(--line)`). Responsive grid that snaps to full-width lists on mobile.
  - **Buttons:** Pill-shaped (`border-radius: 999px`) or soft rectangles (`8px`). Hover and active states are strictly required for tactile feedback.
  - **Toggles:** Native checkboxes styled with custom CSS to look like modern sliding switches (e.g., the Encrypt toggle).

## 3. Architecture Rules
- **Backend (Node.js):** 
  - Strictly ECMAScript Modules (`type: "module"`).
  - SQLite (`better-sqlite3`) for metadata, structured into transactional functions.
  - GramJS for MTProto communication. Keep bot tokens in `.env` and avoid aggressive polling to prevent Telegram rate limits (`FloodWait`).
- **Frontend (React + Vite):**
  - Functional components with Hooks.
  - Centralized API fetching logic (`api.js`).
  - Chunked uploads must be streamed client-side to keep memory overhead low, supporting gigabyte-sized files.
- **PWA (Progressive Web App):**
  - Must include a `manifest.json` with theme colors and icons to support "Add to Home Screen".
  - A Service Worker to cache static assets and provide a seamless offline-loading shell.

## 4. User Experience (UX) Flow
- **Authentication:** Password-based entry that provisions an HttpOnly cookie.
- **Storage Connection:** If running as a Bot, simplify connection by allowing users to paste a private message link instead of hunting for raw `-100` IDs.
- **Uploads:** Show precise byte progress and part counts. Allow pausing/canceling/resuming chunks seamlessly.
- **Folders:** Support native browser folder selection (`webkitdirectory`). Maintain folder hierarchy visually using breadcrumbs.

# TeleMoon — Design Principles

The single source of truth for how TeleMoon looks and feels. Every page and every
new component is checked against this file before it ships. Tokens live in
`web/src/styles.css` `:root` and are referenced here by name.

## 1. The scene: a quiet night sky

The app is a dark indigo sky (`--ink`) with faint stars. Content never floats on
the sky directly — it lives in **boxes**. The sky is scenery, not surface.

## 2. Everything is a box

One container idiom everywhere: `--panel` (or `--panel-2`) background,
1px `--line` border, radius 12–18px. Auth is a box. A channel you can pick is a
box. A file is a box. A preview is a box. If a new feature needs a surface, it
gets this box — not a new style.

- Hover: border brightens to `--line-strong` / `--moon-deep`. No lifts, no shadows
  except overlays (upload panel, modal).
- Boxes align to a grid with 12–16px gaps. Padding steps: 8 / 12 / 16 / 24 / 32.

## 3. One accent, spent carefully

- **Moon gold (`--moon`)** = the one primary action per screen (`.btn-moon`),
  the brand crescent, folder icons, and signature moments (MoonProgress).
  If two things on a screen are gold-filled, one of them is wrong.
- **Sky blue (`--sky`)** = links only.
- Everything else: `--text` on panels, `--muted` for secondary, `--danger` only
  for destructive/error.

## 4. Type

- **Space Grotesk** for UI: names, buttons, headings. Headings 1.4–1.6rem,
  weight 700, tight letter-spacing (−0.02em). Body 0.9–0.95rem.
- **JetBrains Mono** for data: sizes, dates, ids, `@handles`, error details.
  Always 0.78–0.85rem, usually `--muted`.
- Never more than two sizes of heading on a screen.

## 5. Motion

- Transitions ≤ 150ms, opacity / color / border only. Nothing moves position.
- `prefers-reduced-motion` kills everything.
- The **MoonProgress waxing moon** is the only playful element in the app.
  It stays. Nothing else animates for fun.

## 6. States

- **Loading / empty**: centered, `--muted`, one quiet line ("Reading the sky…",
  "This folder is empty…"). No spinners.
- **Errors**: `--danger` text *inside the box they belong to*, never a browser
  alert for flow errors. Plain language, say what to do next.
- **Focus**: 2px `--moon` outline, always visible for keyboard users.

## 7. Words

Short, warm, lowercase-calm. "Enter", "Link storage", "stored ✓". No jargon on
screen (no "MTProto", no "session string") — jargon goes in tooltips or docs.
The moon/night metaphor is used sparingly, in microcopy only.

## 8. Per-page checklists

**Landing / Enter (Auth)** — a quiet product promise and three compact feature
boxes beside one sign-in box. On narrow screens the form comes before the
feature details, so it remains immediately visible: `@handle` + password, one
gold button. No tabs, no
second auth mode, no competing call to action.

**Link storage (Connect)** — one hero box with the paste-a-link input and one
gold Connect button. Below, the user's channels/groups as a grid of simple
boxes (title, `@name` or "private", channel/group tag); the current one is
gold-bordered. Guidance (bot mode, offline) replaces the grid as a quiet box,
never a wall of text.

**Drive** — sticky topbar (brand, search pill, New folder, gold Upload,
avatar). Breadcrumbs under it. Content is a responsive grid of file/folder
boxes: icon, name (one line, ellipsis), mono meta line, actions appear on
hover/focus in a reserved footer and remain visible on touch devices. On narrow
screens, search comes before creation and upload controls. Moving always has an explicit
folder picker; drag-and-drop is only a desktop shortcut. Statusbar pinned
bottom: connection dot, channel name, storage link. Uploads panel bottom-right
with MoonProgress rows.

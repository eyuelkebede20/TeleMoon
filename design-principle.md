# TeleMoon — Design Principles

The single source of truth for how TeleMoon looks and feels. Every page and every
new component is checked against this file before it ships. Tokens live in
`web/src/styles.css` `:root` and are referenced here by name.

## 1. Aesthetic: Dark Modernist Sharp Grid

Inspired by modern AI platform dark UI grids:
- **Unboxed Typography**: Content breathes directly on the canvas without wrapping every heading or bullet in nested container cards. Headings, descriptions, and feature lists sit directly on the background separated by clean hairline rules.
- **Zero Border Radius**: Every element has sharp 90-degree corners (`border-radius: 0 !important`). Buttons, cards, inputs, tags, modals, avatars, indicators, and dialogs are strict rectangles.
- **Clean Solid Canvas (No Grid)**: No grid lines or artificial mesh overlays. Deep, solid navy slate background.
- **ColorHunt Palette Theme** (`#dddddd`, `#516c8d`, `#28385e`, `#304163`):
  - Primary Base Background: `#28385e` (`--ch-base`) and `#1f2c4a` (`--ch-base-deep`).
  - Elevated Surfaces & Cards: `#304163` (`--ch-surface`) and `#384b72` (`--ch-surface-raised`).
  - Accent / Primary Action: `#516c8d` (`--ch-steel`) with `#5e7d9f` hover and `#455d7a` active.
  - Primary Typography & Highlights: `#dddddd` (`--ch-light`) and `#cfd8e3`.
  - Secondary Accent & Monospace Digits: `#7ea3cc`.
  - Functional Status: Green (`#5ec788`), Amber (`#e5ad58`), Red (`#e86b6b`).
- **Hairlines**: High-precision `1px solid rgba(221, 221, 221, 0.12)` borders with steel blue hover highlights.

## 2. Two-Sided Split Landing & Authentication

The entry screen uses a split architecture:
- **Ambient Flying Plane Canvas**: Clean solid slate canvas (`#28385e` to `#1c2742`) with floating fluid droplets and a prominent, 3D-faceted flying Telegram paper airplane gliding smoothly with glowing wingtip contrail particles. Bottom wave animation removed for a clean, minimal editorial backdrop. Respects `prefers-reduced-motion`.
- **Left Side (Editorial Canvas)**: Unboxed brand header, primary headline, plain prose overview, and a numbered feature list (`01`, `02`, `03`) directly over subtle translucent backdrop blur.
- **Right Side (Auth Panel)**: Sharp rectangular auth container with tabbed switching between **Sign In** and **Sign Up**, set against a frosted glass backdrop.
  - Sign In mode: Handle and password.
  - Sign Up mode: Handle, password, password confirmation, and optional invite code when enabled by the host.
- **Mobile Adaptability**: Single column layout below 860px viewport width.

## 3. Minimalist Controls (Button Discipline)

- **Remove Redundant Actions**: If a button is not strictly necessary, remove it.
  - No redundant "Sign in" nav link on the sign-in screen.
  - Simplified card action bars to keep only essential actions.
  - Unboxed setup steps with clean numbered list instead of nested alert boxes.

## 4. Voice: Stop Slop & Plain Technical Prose

All text adheres to the `stop-slop` standard:
- **No Filler & Throat Clearing**: Cut announcement phrases ("Here is what", "It turns out", "Let me be clear"). State points directly.
- **No Em Dashes**: No em dashes (—) anywhere in UI copy. Use periods or commas.
- **No Adverbs**: Cut empty -ly words ("safely", "directly", "simply", "genuinely", "actually").
- **No Marketing Puffery**: Cut buzzwords ("High-performance", "Zero cloud subscription fees", "Unleash", "Elevate"). Write plain, human sentences.
- **Active Voice & Human Subjects**: Every sentence names the actor or addresses the user directly ("You").

## 5. Typographic Hierarchy

- **Playfair Display & Cormorant Garamond**: High-contrast, luxurious editorial serifs with delicate ball terminals and dramatic italic accents for primary headlines (`h1`, `h2`) and feature titles.
- **Cinzel**: Chiseled luxury Roman display typography with uppercase tracking for the brand logotype (`TeleMoon`), section tags, tabs, and primary action buttons.
- **Geist Sans**: Clean sans-serif for interface descriptions, form inputs, and navigation.
- **Geist Mono / JetBrains Mono**: Monospace font for file sizes, dates, keystroke shortcuts, and technical identifiers.
- Keystrokes use sharp `<kbd>` tags with 0px radius.

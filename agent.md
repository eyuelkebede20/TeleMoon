# AGENT.md — Autonomous Engineering & Design Protocol

Follow these rules on every task. If a rule conflicts with a user instruction, say so and ask before proceeding.

---

## 1. Core Philosophy: Deliberate, Scalable, Production-Ready

- **Never rush to finish.** Priority order: correctness → tests → error handling → reusability → scalability → speed. Build one atomic module at a time.
- **Reusability first.** Every UI component, hook, utility, and service has strict separation of concerns, clean TypeScript interfaces, and zero hard-coded business logic.
- **Library-first discovery.** Before writing custom code for complex functionality (virtualized lists, toasts, command palettes, date pickers, form validation, state machines, data fetching), stop and evaluate established libraries. Document findings in `LEARNINGS.md` _before_ installing or coding.
- **Be honest about status.** Report what was run, what passed, what failed, and what remains. Never invent test results or claim something works without running it.
- **Don't expand scope silently.** Propose extra work as follow-up backlog items.
- **Ask when blocked.** If a requirement affecting architecture or data is ambiguous, ask one focused question instead of guessing.

---

## 2. Pre-Implementation Audit (Before Any Code)

1. **Restate the task** in 2–3 lines: goal, inputs, outputs, constraints.
2. **Search the existing codebase** for components, hooks, utilities, and patterns you can extend. Do not duplicate.
3. **Check installed dependencies** (`package.json`) for something that already solves the problem.
4. **Evaluate ecosystem libraries.** Compare at least 2 candidates on: maintenance activity, last release, license, bundle size, TypeScript support, accessibility, test coverage, adoption.
5. **Learn from reference code.** Read official examples or a similar open-source implementation. Save useful reference files under `docs/learnings/reference/` with source URL and license. Do not copy code with incompatible licenses.
6. **Read `LEARNINGS.md`** to avoid repeating past mistakes, then update it (see Section 3).
7. **Plan.** Write a short checklist of small, independently committable and testable steps.

---

## 3. LEARNINGS.md (Required Knowledge Base)

Maintain `LEARNINGS.md` at the repo root as the living log. Put larger reference material in `docs/learnings/reference/`. Record architectural decisions (ADRs) as short entries in the same file.

Entry format:

```md
## <yyyy-mm-dd> — <Topic / Backlog Item>

**Goal:** one line

### Libraries evaluated

| Library | Maintained? | License | Size | Verdict | Reason |

### Reference files studied

- <path or URL> — what was learned

### Edge cases & gotchas discovered

- ...

### Decision

What was chosen and why; what was rejected and why.

### Follow-ups

- ...
```

Update it whenever you hit a non-obvious bug, change a decision, or discover an edge case.

---

## 4. Design & UI/UX Standards

When building, styling, or reviewing any frontend interface, apply the standards below. (Names of external skill sets are used as reference points for the _approach_; if you cannot access them, apply the rules as written here.)

### 4.1 Domain-Driven Design Intent (ui-ux-pro-max)

- Match color mood, typography personality, and layout patterns to the product's domain **before** writing code.
- **Never** use raw emojis as UI icons. Use SVG icon libraries (`lucide-react`, Heroicons).
- **Never** default to generic "AI slop": harsh neon, random purple/pink gradients, jarring animations.
- Every clickable element has `cursor-pointer` and distinct `hover`, `focus-visible`, `active`, and `disabled` states.

### 4.2 Design Language (impeccable)

- Intentional typographic hierarchy, high-contrast readability, subtle borders, cohesive spacing tokens.
- No generic template visuals. Every view should look deliberate and human-crafted.

### 4.3 Motion & Mobile-Native Feel (emilkowalski/skills)

- **Motion ceiling:** standard UI transitions stay within **150–250ms** (hard ceiling 300ms) with proper easing (`cubic-bezier` or spring) and correct `transform-origin`.
- Respect `prefers-reduced-motion`: disable or reduce non-essential animation.
- Use `100dvh` (not `100vh`) for full-height layouts, handle `env(safe-area-inset-*)`, keep input `font-size >= 16px` (prevents iOS auto-zoom), and guard hover styles with `@media (hover: hover)` to avoid sticky hover on touch.
- Prefer opinionated accessible primitives: `sonner` (toasts), `vaul` (drawers), `cmdk` (command menu), Radix UI / Headless UI (dialogs, menus, popovers).
- **Stress-test layouts (break-ui)** against worst-case data: 120-character unbroken strings, empty arrays, `0` and negative numbers, very long names, RTL text, slow 3G, offline, and rapid double-clicks.

### 4.4 Concrete Direction & Subtraction (oil-ui)

- Translate vague words ("clean", "modern") into explicit tokens: typeface pairing, whitespace ratio, surface contrast, radius, shadow.
- **Round of Subtraction:** after a view renders, audit desktop and mobile and remove redundant boxes, dividers, decorative lines, and helper copy that don't aid comprehension. One clear focal point per screen.

### 4.5 DESIGN.md Token Architecture (awesome-design-md)

- Maintain a root `DESIGN.md` with exact tokens: background ladder, text hierarchy, accent rules, border radii, shadow elevations, spacing scale, type scale, motion constants.
- **No magic numbers** when a token exists. Add a token instead of hard-coding a one-off value.

### 4.6 Accessibility (Always)

- Semantic HTML first; ARIA only when needed. Every control has an accessible name and role.
- Full keyboard navigation, visible focus, logical focus order, focus trap and focus return for modals.
- WCAG AA contrast minimum; touch targets ≥ 44×44px; don't convey meaning by color alone.

---

## 5. Architecture: Scalability & Reusability

- **Layered separation:** UI → hooks/state → services/repositories → API client. Components never call raw APIs directly.
- **Single responsibility:** functions do one thing (aim < 40 lines); split files at ~300 lines.
- **DRY with judgment:** extract shared code on the second or third repetition, named by purpose; avoid premature abstraction.
- **Dependency injection:** pass clients, clocks, and storage in so they can be mocked.
- **Config over constants:** environment values live in validated config (`zod`-parsed env), never inline.
- **Composable, prop-driven components** with no hidden global dependencies; styling via tokens only.
- **Performance by measurement:** avoid N+1 calls, needless re-renders, and unbounded lists; paginate, virtualize, memoize, and lazy-load where justified.
- **Backward compatibility:** version or migrate changes to shared interfaces, schemas, and APIs, with tests covering the migration.
- **Document public interfaces:** doc comments on exported functions/components (purpose, params, returns, errors).
- **Follow existing folder conventions** and the project's established stack unless a documented reason says otherwise.

---

## 6. Production Error Handling & Resilience

Assume the network, API, and user input will fail.

- **Granular Error Boundaries:** wrap distinct regions (modals, widgets, routes, tables) in isolated boundaries with a **Retry / Reset** action. No single crash white-screens the app. Add a global handler as the last line of defense.
- **Typed error model:** central `AppError` (`code`, `message`, `userMessage`, `cause`, `retryable`). Map low-level errors (network, parse, auth, validation) into it at the boundary. Use typed result patterns where practical.
- **No silent catches.** Never write empty `catch {}` or a generic "Something went wrong" alone. Show actionable user feedback with a recovery step; log developer diagnostics (code, operation, correlation id, original cause).
- **Two audiences:** users never see stack traces, internals, or secrets; developers always get structured logs.
- **Async & network safety:**
  - `AbortController` cancellation on unmount and superseded requests
  - Timeouts; bounded exponential backoff with jitter for **idempotent** calls only
  - Lock triggers while promises are in flight; prevent duplicate submissions and race conditions
  - Guard against partial failures; roll back or report partial state clearly
  - Offline detection and graceful messaging
- **Runtime validation:** validate every external payload (API responses, URL params, env vars, files, user input) with `zod` before it reaches UI.
- **Four states for every async region:** loading, success, empty, error (with retry where sensible).
- **Graceful degradation:** one failing feature must not break unrelated ones.

---

## 7. Mandatory Testing & Every-Button Verification

No build or feature is complete without passing automated verification.

### 7.1 General Testing Rules

- Stack default: `vitest` + `@testing-library/react` + `@testing-library/user-event` (adapt to the project's existing tooling). Mock the network at the boundary (e.g., MSW).
- Co-locate tests: `*.test.ts` / `*.test.tsx`. Every utility, store, hook, and component ships with tests.
- **Test-first** for logic-heavy code. **Bug fix = failing test first**, then the fix.
- Deterministic tests only: fake timers, mocked network, no randomness, no order dependence.
- Arrange–Act–Assert, one behavior per test, names like `should <behavior> when <condition>`. Test behavior, not implementation.
- **Coverage:** new/changed code ≥ 80% line and branch; critical paths (auth, payments, mutations, permissions) ≥ 90%. Coverage never decreases, and never pad it with assertion-free tests.
- **Pyramid:** many unit tests, fewer integration/component tests, a small set of E2E tests (Playwright/Cypress) for critical journeys.

### 7.2 Interactive Element Audit (Test Every Button)

Every `<button>`, `<a>`, form submit, toggle, menu item, and keyboard shortcut has automated tests for:

| Case                  | Verify                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| **Idle**              | Renders with accessible role/name (`getByRole('button', { name })`); keyboard activation (Enter/Space) |
| **Loading / pending** | Blocks double-invocation; shows busy feedback (`aria-busy="true"` or `disabled`)                       |
| **Success**           | Fires the handler with correct args and updates UI state                                               |
| **Error / failure**   | Recovers gracefully and surfaces accessible messaging (`role="alert"`); user can retry                 |
| **Disabled**          | Does not fire; communicates why where useful                                                           |
| **Edge payloads**     | Empty, malformed, boundary, very long, and special-character input never throws unhandled exceptions   |

Also cover per element type:

- **Forms:** required fields, validation messages, invalid/boundary/valid input, submit success and failure, reset/cancel, input preserved on error.
- **Modals / menus / drawers:** open, close via button, Esc, and outside click; focus trap; focus return.
- **Lists / tables:** empty state, pagination, sort, filter, selection, very long lists.
- **Navigation:** correct destinations, back behavior, deep links, 404 handling.

Maintain `docs/qa/ui-checklist.md` listing each screen and its tested controls. A screen is not done while items are unchecked.

### 7.3 Build Gate (Before Every Commit)

```bash
install → lint → format:check → typecheck → test → build
```

Zero warnings. Zero failing tests. Zero new type errors. Report the actual result summary.

---

## 8. Strict Git Workflow

### Branching

- Never commit directly to `main` / `master` / `develop`.
- One scoped branch per backlog item, synced with base (`git pull --rebase`) before starting and before the PR:
  - `feat/<scope>-<short-description>`
  - `fix/<scope>-<short-description>`
  - `refactor/<scope>-<short-description>`
  - `test/<scope>-<short-description>`
  - `docs/<scope>-<short-description>` · `chore/<scope>-<short-description>`

### Commits

- **Conventional Commits:** `type(scope): imperative summary` (≤ 72 chars). Types: `feat`, `fix`, `test`, `refactor`, `docs`, `style`, `perf`, `build`, `ci`, `chore`.
- Each commit is atomic, builds, and passes all tests. Commit tests with the code they cover.
- Body explains _why_ for non-obvious changes.
- Never commit secrets, `.env`, build artifacts, `node_modules`, large binaries, or debug leftovers (`console.log`, commented-out code).
- Never rewrite shared history. `--force-with-lease` only on your own branch, and only when necessary.
- Update `LEARNINGS.md` before merging.

### Pull Requests

Include: what and why (link the task), screenshots/recordings for UI changes, how it was tested, risks and follow-ups, and the checklist in Section 10.

---

## 9. Security & Safety

- Never log or commit secrets, tokens, or personal data. Keep `.env.example` current.
- Validate and sanitize all input; escape output; use parameterized queries; avoid `dangerouslySetInnerHTML` unless sanitized.
- Least privilege for scopes, permissions, and API keys.
- Run dependency audits when adding or updating packages. Reject packages with critical vulnerabilities or unclear licenses. Commit the lockfile.

---

## 10. Definition of Done / Pre-PR Checklist

```md
- [ ] Existing code and libraries researched; LEARNINGS.md updated
- [ ] Branch name and commits follow conventions
- [ ] Unit + integration tests added and passing; coverage targets met
- [ ] Every new/changed button, input, and flow tested (docs/qa/ui-checklist.md updated)
- [ ] Loading, empty, error, and offline states implemented and tested
- [ ] Lint, format, typecheck, and build pass with zero warnings
- [ ] DESIGN.md tokens used (no magic numbers); motion ≤ 250ms; reduced-motion respected
- [ ] Round of Subtraction done on desktop and mobile
- [ ] Accessibility checked (keyboard, focus, labels, contrast)
- [ ] No secrets, debug code, or dead code
- [ ] Docs/README updated where behavior or setup changed
- [ ] Reusability reviewed; shared logic extracted
```

---

## 11. Active Execution Backlog

Work on **one item at a time**, in order. Do not start the next item until the current one meets Section 10.

### [x] Item 01 — `feat/core-design-and-error-foundation`

- Audit dependencies; log selections in `LEARNINGS.md` (`zod`, `lucide-react`, `sonner`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, and any alternatives considered).
- Create `DESIGN.md`: color tokens (background ladder, text hierarchy, accent, borders), type scale, spacing scale, radii, shadow elevations, and motion constants (≤ 250ms with defined easing curves).
- Create `docs/qa/ui-checklist.md` skeleton.
- Build a reusable, accessible `<Button />`: variants and sizes via tokens, loading lockout, double-click protection, keyboard accessibility, visible focus, `aria-busy`, and an icon slot.
- Build an `<ErrorBoundary />` wrapper with Retry/Reset, logging hook, and a friendly fallback.
- Build the typed `AppError` model and a `toUserMessage()` helper.
- Unit tests: Button (idle, loading, success, disabled, error recovery, keyboard) and ErrorBoundary (catch, fallback, retry/reset, isolation).

### [x] Item 02 — `feat/resilient-api-and-state-layer`

- Typed fetch/query wrapper with `AbortController`, timeout, exponential backoff with jitter (idempotent calls only), and `zod` runtime validation, mapping failures into `AppError`.
- Evaluate `TanStack Query` (or equivalent) before building custom caching; record the decision.
- Tests simulating network timeouts, 500 responses, 4xx responses, malformed JSON, schema mismatch, aborted requests, retry exhaustion, and offline.

### [x] Item 03 — `feat/ui-stress-test-harness`

- Apply break-ui stress tests and Round of Subtraction across core views.
- Add automated tests for every interactive control and edge-case payload (long strings, empty data, `0`/negative values, slow network, rapid double-click).
- Complete `docs/qa/ui-checklist.md` for all existing screens.

### [x] Item 04 — `chore/ci-quality-gates`

- CI pipeline running lint, typecheck, tests with coverage, and build on every PR; block merge on failure.
- Optional pre-commit hooks (`husky` + `lint-staged`) and a commit-message linter (`commitlint`).

---

## 12. Quick Task Loop

```
1. Restate task → ask if unclear
2. Audit: codebase → installed deps → ecosystem libraries → reference examples
3. Update LEARNINGS.md
4. Create scoped branch
5. Plan small steps
6. For each step: write test → implement → run build gate → commit
7. Test every button/flow + error states; update ui-checklist.md
8. Round of Subtraction + design-token check
9. Full build gate; update docs and LEARNINGS.md
10. Open PR with checklist; start next backlog item only after Done
```

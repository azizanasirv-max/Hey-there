# UI review — audit findings and what changed

Scope: every screen (`/prototype-1`, `/architecture`), every component, the
route handling in `src/App.tsx`, and the existing unit/integration/browser
tests. Behaviour that must not regress was treated as fixed contract: the audio
pipeline, immediate `ConversationText` rendering, settings validation and the
HTTP `202` success-in-progress contract.

| # | Finding | Where | Fix |
| --- | --- | --- | --- |
| 1 | An always-on banner claimed *"Standalone Browser Page Active … outside embedded preview iframe"*. That is a leftover from the embedded AI-Studio preview and is meaningless (and alarming) on a real deployment. | `App.tsx` | Removed. A warning banner now appears **only inside an iframe** (where the microphone can genuinely be blocked) with an *Open standalone* link. |
| 2 | A disabled **Start** button only explained itself via a `title` tooltip — invisible on touch, and the reason (no key / backend not ready / backend starting) was buried in a mono block further down. | `ConnectionPanel.tsx` | Visible `Start is disabled: …` line wired to the button with `aria-describedby`; the three distinct causes are named separately, and the 202 case explains that retrying is automatic. |
| 3 | During reconnect the only feedback was a badge inside the connection card, which scrolls out of view while watching the transcript on a phone. | new `StatusStrip.tsx` | Sticky, dismissible-free incident strip for *connecting / reconnecting / failed* with the attempt number, the reason, and Stop / Start-again actions. `role="status"`/`role="alert"`. |
| 4 | Transcript updates were invisible to screen readers; the log had no live-region semantics. | `ConversationPanel.tsx` | `role="log"`, `aria-live="polite"`, `aria-relevant="additions text"`, labelled region. |
| 5 | The live "user is speaking" badge hard-coded `nova-3`, contradicting the configured Flux model. | `ConversationPanel.tsx` | Renders the actual `listenModel` from the shared config. |
| 6 | Icon-only buttons (clear log, clear transcript, auto-scroll, mute, restart audio, health refresh) had `title` only — no accessible name, no pressed state. | `ConversationPanel`, `DiagnosticsPanel`, `MicrophonePanel`, `Header` | Every icon-only control has an `aria-label`; toggles expose `aria-pressed`; decorative icons are `aria-hidden`. |
| 7 | Protocol-event rows were clickable `<div>`s: unreachable by keyboard, no expanded state. | `DiagnosticsPanel.tsx` | Rows are real `<button>`s with `aria-expanded`; filters expose `aria-pressed`; the empty state explains what to do instead of "No events for selected filter". |
| 8 | The mic level meter was a decorative bar. | `MicrophonePanel.tsx` | `role="progressbar"` with `aria-valuenow/text`; the streaming state text is an `aria-live` region. |
| 9 | No visible keyboard focus on a dark theme; animations ignored `prefers-reduced-motion`. | `index.css` | Global `:focus-visible` ring, reduced-motion block that calms pulsing indicators, long JSON wraps instead of overflowing. |
| 10 | No skip link; `main` had no landmark id. | `App.tsx` | `.skip-link` (first tab stop) → `<main id="main-content" tabIndex={-1}>`. |
| 11 | Header overflowed at 375 px (brand + nav + two badges in a 64 px row). | `Header.tsx` | Wraps: navigation becomes a full-width second row on phones, badge labels shorten, `aria-current` on the active tab. |
| 12 | Footer's `wss://agent.deepgram.com/v1/agent/converse` string forced 3 px of horizontal page scroll at 375 px (verified by measuring `scrollWidth`). | `App.tsx` | Footer wraps and breaks the URL; no horizontal overflow at 320/375 px on either route. |
| 13 | Conversation and diagnostics panels were fixed at `520px`, unusable on a phone in landscape. | both panels | `h-[62vh] min-h-[380px] sm:h-[520px]`. |
| 14 | Errors/notices were plain divs (no announcement) and the same text could appear twice. | `ConnectionPanel.tsx` | `role="alert"` for errors, `role="status"` for notices; strip and panel carry different, complementary text. |
| 15 | The API-key banner told you to copy a `.env` line even when the app is deployed. | `ApiKeyWarningBanner.tsx` | Adds host-specific steps (Render dashboard → Environment → `DEEPGRAM_API_KEY`) next to the local `.env` instructions; copy action announces success. |
| 16 | No `theme-color`/`color-scheme`, and a blank page (not even a message) without JavaScript. | `index.html` | Added both meta tags and a `<noscript>` explanation that points at `/api/health`. |
| 17 | `Config Models` was disabled mid-session with no explanation. | `ConnectionPanel.tsx` | `aria-expanded`/`aria-controls` plus a title/`Start is disabled` style hint that settings are locked while live. |

## Screenshots (built app, production mode)

| | |
| --- | --- |
| Desktop, session live: `docs/screenshots/desktop-session.png` | Idle: `docs/screenshots/desktop-idle.png` |
| Phone (390 px) during a socket drop: `docs/screenshots/mobile-reconnecting.png` | Architecture tab: `docs/screenshots/architecture.png` |

Captured from `node server.js` (the Render command) with a mock Deepgram
upstream, so the screenshots show the real built bundle, not dev sources.

## Deliberately unchanged

* Audio capture/playback pipeline (`audioStreamer.ts`, `audioPlayer.ts`), the
  reconnect state machine (`voiceAgentSession.ts`), `ConversationTracker`, and
  `buildValidatedSettings` — covered by the existing 87 tests + 32 browser
  checks, all still green.
* `ConversationText` still renders on arrival with no dependency on audio; the
  measured p50 remained 4 ms in the production browser run.
* The `200` / `202` / `204` health contract and the `426` WebSocket contract.
* No new runtime dependencies were added.

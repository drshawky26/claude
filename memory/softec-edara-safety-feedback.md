---
name: feedback-readonly-automation-safety
description: User requires strictly read-only exploration of the live Softec app — no clicks/keystrokes/saves without explicit per-step permission
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f3ec7a0d-0117-4498-9160-128ab7a1a7eb
---

During live inspection/automation-building against the production Softec desktop app (see [[project-softec-edara-rpa]]), do not send any clicks, keystrokes, or saves to the running application without asking first, even for trivial tests in a blank/unsaved form.

**Why:** the user is worried about anything that could affect server/app stability or that IT staff (who don't understand agent-driven automation) might notice and flag as suspicious. This isn't about data risk alone — it's about staying invisible/inert to anyone watching the process or server.

**How to apply:** default to read-only techniques only: `EnumWindows`/`EnumChildWindows`, `GetWindowText`/`WM_GETTEXT`, `GetWindowRect`, screenshots via `Graphics.CopyFromScreen` (local file only, never uploaded). Before any action that writes to the app (click a button, type into a field, press Ctrl+S), state exactly what will happen and wait for explicit go-ahead. When testing whether a value can be read back, ask the user to type the test value themselves rather than typing it via automation. This constraint applies for the whole lifecycle of this project, not just the initial exploration phase — even once the real bot is built, it should stop and log "failed" rather than guess/retry silently (this maps to the project's own requirement for verify-before-save and hard-stop-on-error).

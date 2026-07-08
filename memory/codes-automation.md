---
name: codes-automation
description: "Codes-team automation — bot that moves new pharmacy customers from Edara (web) into Softec (desktop). Project overview + current build state. SANITIZED for public repo."
metadata:
  node_type: memory
  type: project
---

# Codes Automation (Softec ↔ Edara)

> ⚠️ **Public repo — no secrets here.** Real credentials (Softec app login, DB login,
> RDP usernames), internal IP addresses, the Edara URL, reviewer usernames, and any
> real customer data are kept **locally only** on the work machine, never in this repo.
> See the machine's local memory store for those.

## What it is

When the codes/review team marks a new customer ready in **إدارة (Edara)** — an
internal web app for customer-code management — this tool helps enter that customer
into **سوفتيك (Softec / SofTech Smart Business)**, a legacy PowerBuilder desktop app
used by a pharmacy chain. Neither system has an API, so both sides are UI automation:
Edara via Playwright (browser), Softec via pywinauto (Win32).

## Status pipeline (Edara)

`تم الإضافه` (added to Edara, **not yet reviewed**) → *human review: address/zone +
phone duplicate check* → `مطلوب إضافة سوفتك` (reviewed, ready) → *add to Softec, get
PIC code* → `تم الإضافة سوفتك` (done, code written back to Edara). We currently work
the `تم الإضافه` list (the review / duplicate-check phase).

## Architecture (all manual, button-driven — no auto-repeat)

1. **Edara reader** (Playwright, read-only) — user logs in themselves in a visible
   browser and filters the list; the tool reads the shown rows into a local queue.
2. **Local queue** (SQLite) — single source of truth: customer, status, stage,
   stop-reason, attempt count, resulting PIC, timestamps. Dedup by Edara serial (مسلسل).
3. **Softec worker** (pywinauto) — duplicate check (F6→F7→phone→F8) on the **main**
   Softec system; add customer on the **branch RDP** Softec. (Add stage not built yet.)
4. **Edara writer** (Playwright) — writes the Softec PIC back + advances status.
5. **Dashboard** (Flask, local) — a numbered stepper: open Edara → pull → run stage;
   shows live per-customer progress, a pipeline diagram, and an indirect load monitor.

**Safety model:** every real write is gated behind a master `ARM_WRITES` flag
(default OFF); while off, write components run dry-run (log intent, touch nothing).
Anything unexpected (duplicate found, unmapped branch, save error) stops the item to
`needs_manual` rather than guessing. Everything is manual/button-press; no polling.

## Build state (as of 2026-07-08)

- ✅ **Real read-only Edara read verified end-to-end** — pulled a real filtered list
  into the queue; parsed count matched Edara's own Total exactly on the first try.
- ✅ Flask dashboard (stepper, pipeline diagram, live log, load monitor, queue views).
- ✅ Duplicate-check worker in dry-run; plus a single supervised **live test** button
  that sends F6→F7→F8 (a search, non-destructive) and screenshots the Softec result
  for building the result reader.
- 🔒 Softec **add** stage and Edara **write-back** stage: coded scaffolding only,
  safety-gated, needing live element-mapping before real use.

## Stack / layout

Python 3.14 · Flask · Playwright · pywinauto · SQLite. Code lives locally under a
project folder on the work machine (`dashboard/` = Flask monitor, `live/` = real
automation modules + shared queue). Exact paths/creds/branch-IP map are local only.

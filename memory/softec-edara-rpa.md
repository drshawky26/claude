---
name: project-softec-edara-rpa
description: "RPA integration project between \"إدارة\" (Edara, customer web app) and \"سوفتيك\" (Softec/SSB9 desktop PowerBuilder app) for pharmacy customer data entry"
metadata: 
  node_type: memory
  type: project
  originSessionId: f3ec7a0d-0117-4498-9160-128ab7a1a7eb
---

Goal: when the codes team marks "تم الإضافة" (Added) for a new customer in **إدارة** (Edara, internal customer-code management web app), a bot should open **سوفتيك** (Softec / SofTech Smart Business, folder `c:\ssb9`) and enter that customer's data into its "add customer" screen — eventually via a pending→processing→done/failed queue, built incrementally. Business context: Softec is used by "صيدليات ال عبد اللطيف الطرشوبى" (a pharmacy chain), hence its customer screen has Medical fields (blood type, family doctor).

## Technical findings about Softec

- Built on **PowerBuilder** (not Delphi/VB6 as originally assumed) — evidenced by hundreds of `.pbd` files, `pb.ini`, `PBODB70.INI`, Appeon DB driver DLLs. Main exe: `softechsmartbusiness9.exe` (32-bit).
- The 516 `.pbd` files are compiled/opaque (no `.pbl` source, `strings` finds nothing, `file` reports "data") — static analysis of them is a dead end. Live UI inspection is the only viable path.
- **Correct target screen: "Individual Customers Pop-Up"** (win32 class `FNWNS3`), reachable from the POS screen — NOT the "Individual Customers Data" MDI sheet (that one is a huge tabbed record-browse screen with 888 `pbdw` DataWindow controls, too complex and not what users actually use to add a customer). The pop-up has two tabs: "إسـتعـلام" (query/search) and "إضـافة جـديد / تـعــديـل" (Add New/Edit) — id=1001 for the Add/Edit tab.
- Inside a PowerBuilder DataWindow, the field controls (`Edit`, `PBEDIT`, `pbdwst`, `Button`) are **real Win32 child HWNDs**, discoverable via plain `EnumChildWindows` — not MSAA-only phantoms as first suspected.
- **Reading field values works via plain `WM_GETTEXT`/`GetWindowText`** — verified live: typed `04HD114288` into the PIC field, then read it back correctly from hwnd via `SendMessage(WM_GETTEXT)`. No need for IAccessible/MSAA workarounds, and no need to switch to 32-bit Python despite pywinauto's cross-bitness warning (that warning appears but doesn't block basic text read/write).
- **Field labels/captions are NOT readable via window text** — PowerBuilder draws DataWindow captions directly on the canvas, not as real window text. Field identification requires taking a screenshot of just the popup window (`GetWindowRect` + `Graphics.CopyFromScreen`, fully local/read-only) and visually correlating labels to nearby Edit-control rects. Capture the window rect and run the accessibility/HWND scan in the *same* script execution — the popup's screen position can shift between separate runs, breaking coordinate correlation otherwise.
- The **PIC field acts as a search-by-code lookup**: typing an existing PIC code into it pulls up that full customer record (not purely a data-entry field).
- Save = **Ctrl+S** (button caption "تخزين"). Other buttons on the popup: "إضافة" (F2, add), "إستعلام جديد" (F7), "تنفيذ إستعلام" (F8), "إلغاء" (F4, cancel), "خروج" (Ctrl+E, exit).

## Field mapping: Edara → Softec (confirmed with user)

| Edara field | Softec field | Note |
|---|---|---|
| الإسـم | الإسـم | direct |
| اللقب | اللقب | direct |
| ذكر/أنثى | النوع (Male/Female) | direct |
| تاريخ الميلاد | تاريخ الميلاد | direct |
| فرع التوصيل | فرع الخدمة (dropdown) | direct |
| المنطقة + المدينة + المحافظة (3 Edara fields) | المنطقة (1 Softec dropdown) | Softec's المنطقة dropdown already contains city-level values nested under governorates (e.g. الزقازيق is filed under الشرقية) — map the city name directly into it |
| تفاصيل العنوان | الشارع (2-line field in Softec) | long address text can wrap/split across the two "الشارع" lines since each has a character limit |
| رقم الهاتف (Edara phone table, Mobile/Primary row) | new row in Softec's phone-numbers grid (type = تليفون موبايل) | Softec side is a grid/table, not a single field |
| الكود (usually empty on new Edara customers) | PIC / رمز in Softec | **Bidirectional**: Softec generates the real customer code; after the bot saves the new customer there, it must read back the generated PIC and write it back into Edara's "الكود" field |

## Real human workflow being automated (as described by user 2026-07-07)

Edara's customer list has a **"الحالة" filter** driving the whole pipeline; a "المراجعة" dropdown on the edit-customer page sets it to one of: "مطلوب إضافة سوفتيك", "مطلوب تعديل سوفتيك", "مكتمل على سوفتيك", "غير مكتملة", "بيانات مكررة". Reviewers filter the list by this status to find work.

**Phase 1 — مراجعة (review, human today):** after a customer is added in Edara and a branch (فرع) chosen, reviewer checks address/zone, then checks the phone number for duplicates **inside Softec** via **F6+F7**: type the phone number, Softec shows if it's already tied to a customer code/name. If nothing found, the record moves to "مطلوب إضافة سوفتك".

**Phase 2 — الإضافة (add, human today):** reviewer opens the **Softec "remote" for that customer's branch** (implies branches may be separate remote/RDP sessions — NOT yet confirmed whether it's literally per-branch RDP or a branch selector within one shared Softec instance; this is an open architecture question), lands on **"Individual Customers Data"** (System Administration > بيانات العملاء الأفراد in the Favorite Screens tree — this is the real production screen, reached via MDI, not the POS-triggered "Individual Customers Pop-Up" seen earlier — both may work but this is the one actually used), fills the **"Basic Data"** tab (name, address, etc. per the mapping table above), switches to the **"Contact Nos."** tab to add the mobile number (columns: إفتراضي, Block, ملاحظات, الرقم, نوع الرقم), then **Ctrl+S**.

**Hard constraint: do not strain Edara's server.** The review team is large and each reviewer may already have ~20 browser tabs open against Edara simultaneously; IT must not see added load/lag/traffic blamed on this automation. Implication: prefer hitting Edara's actual backend API/DB directly (lightweight) over scraping/polling its web UI repeatedly, and keep any polling interval conservative. Login used for exploring the Edara UI itself: `http://172.16.200.231/DbCustomers`, user `aya.ghonem` (not a service account — for reference only, do not reuse in the bot's own automated requests without asking).

**Confirmed 2026-07-07 (no longer open):**
- **Neither system has an API** — both Softec and Edara are UI-only integrations. Softec = win32/pywinauto automation (already proven feasible). Edara = will need browser automation (Selenium/Playwright) against the live web UI, kept deliberately light (reuse one session/tab, poll on the order of once a minute, not per-second) because the review team already runs ~20 browser tabs each against Edara and IT must not perceive added load from this bot.
- **Branch routing is per-branch RDP**: each branch has its own IP and a pinned `.rdp` shortcut file/taskbar icon on the machine; login inside every branch's Softec is the shared account `C.CARE` / `123456`. The bot will need a branch-name → RDP-file/IP mapping (not yet compiled as a list). Login screenshot confirmed IP 192.168.41.111 for "ميت غمر" branch as one example.
- **Duplicate-check flow (F6+F7+F8), confirmed live**: inside Softec's "In-Direct Point of Sale" screen, **F6** opens the "Individual Customers Pop-Up" panel embedded in POS, defaulting to the **"إستعلام" (query) tab** shown as a **grid/table** (columns: مسلسل, رمز, PIC, PPIC, الإسـم*, رقم التليفون*, نوع, اللغة, المنطقة, نوع الرقم, تاريخ, شارع, رقم, الحي, الدور — * = required for search). **F7** = "إستعلام جديد" (prep new query / clear grid). Type the phone number into "رقم التليفون" then **F8** = "تنفيذ إستعلام" (execute) — if a match exists, a full row populates (code, PIC, name, phone, gender, address, etc.); if not, the grid stays empty. This IS the duplicate-detection mechanism the review team uses today.
- **The Softec→Edara code round-trip is real and confirmed**, not just a hypothesis: verified live on an already-completed customer ("نوران", PIC `985HD11931`) — Edara's "الكود" field for her holds exactly that Softec PIC, and her Edara status is "تم الإضافة سوفتك". Today this copy-back is done manually by the reviewer; the bot must replicate it.
- Note: the phone number returned in a Softec query result for نوران (`0226718201`) differed from her Edara primary mobile (`01276675459`) — the customer may have multiple phone numbers on file in Softec (e.g. mobile + work landline); worth clarifying which number the duplicate-check should actually search on.

**Decided 2026-07-07: GUI automation only, not direct DB.** `SofTech\SOFTECH9.INI` (local machine) revealed Softec runs on **Sybase ASE**, DB name `SOFTECHDB9`, server `SERVER`, with plaintext creds (`DBLogID='SofTech9'`, `DBLogPass='5'`) sitting right there in the config file. This raised the option of bypassing GUI automation entirely via direct DB reads/writes (faster, more robust) — but user explicitly chose to **stick with GUI automation only**, since direct DB access would skip Softec's own validation/business logic (PIC generation, duplicate checks, triggers) and risks corrupting real data with no safety net. Do not pursue DB-level integration for this project unless the user reopens that decision.

Still open:
- Does "فرع الخدمة" on the "Individual Customers Data" Add form auto-match the branch you're RDP'd into, or must it be selected manually every time? (Screenshot from ميت غمر branch still showed "صيدلية الفيروز" as the default, unconfirmed whether that's stale/wrong or simply a shared default list.)
- Full branch name → IP/RDP-file mapping list (only one example captured so far: ميت غمر = 192.168.41.111).

## Architecture (agreed 2026-07-07)

Four components, kept deliberately decoupled:
1. **Edara Watcher** — polls Edara's customer list filtered to status "مطلوب إضافة سوفتك" using **one persistent browser session/tab** (Playwright), never many tabs — this is the load-sensitive piece given ~100+/day new customers and a review team that already runs ~20 tabs each against Edara. Recommended poll interval **~1-2 minutes** (frequent enough not to backlog at this volume, light enough to stay invisible to IT). Writes newly-seen customers into the local queue as `pending`.
2. **Local Queue** — SQLite (no server needed), single source of truth: customer data, status (pending/processing/done/failed), attempt count, error/failure reason, resulting Softec PIC once known, timestamps.
3. **Softec Worker** — pulls `pending` items, resolves branch via [[reference-softec-branch-rdp-map]] (unmapped branch → immediately `needs_manual`, never guessed), connects that branch's RDP + Softec login (`C.CARE`/`123456`), runs the F6→F7→F8 duplicate check, then either add-with-verification-and-save or fail-with-reason. This is the slow/bottleneck component (GUI automation per customer) — the queue absorbs bursts so the fast watcher doesn't need to wait on it.
4. **Edara Writer** — separate step, takes `done`/`failed` queue items and writes back to Edara (the "الكود" field = Softec PIC, and the "المراجعة" status dropdown), reusing the same lightweight browser session as the watcher rather than opening new ones.
5. **Dashboard** — a simple local Flask web page on the LAN, showing queue status and letting a human manually complete/override items (unmapped branches, failures, duplicates) — this is the "قابل يتعمل مانيوال" requirement, not a blocker to starting the build.

**Where it runs:** for now, off an external/portable hard drive (matches this user's existing habit — see [[reference-pharma-triage-github-mirror]]); will move onto whichever machines get tested later. Not yet installed as a persistent service — still a build-in-progress.

Every write step (Softec field entry, Softec save, Edara write-back) must read back and verify before proceeding, and any unexpected state (error dialog, duplicate found, field mismatch, unmapped branch) stops that item into `failed`/`needs_manual` rather than guessing or retrying blindly — this mirrors [[feedback-readonly-automation-safety]]'s "stop and log" principle, now extended from the exploration phase into the bot's own runtime behavior.

See also [[feedback-readonly-automation-safety]] for the safety constraints under which this exploration/automation is being built.

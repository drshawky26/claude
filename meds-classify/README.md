# meds-classify — structured extraction of `prescribedMeds` (LOCAL Ollama, $0)

Turns each **approved** consultation's free-text `prescribedMeds` into a clean,
categorized object and writes it back on the same Firestore document:

```jsonc
medsStructured: {
  medications: [
    { "name": "دوليبران", "canonical": "دوليبران",
      "dosage": "قرص", "frequency": "كل 8 ساعات", "raw_text": "دوليبران قرص كل 8 ساعات" }
  ],
  actions: [ { "type": "referral", "detail": "مراجعة طبيب" } ]   // referral | follow_up | general_advice | other
}
medsClassifiedAt:     <serverTimestamp>
medsClassifiedModel:  "qwen2.5:7b"
medsClassifiedEngine: "ollama-local"
```

Medications and actions are **never mixed** — so "مراجعة طبيب", "REFER", "متابعة الاعراض",
and time fragments like "ساعات" stop polluting the drug list, and spelling variants of the
same drug collapse into one `canonical` entry.

- **Zero cost, fully local, no API key, no billing** — runs on Ollama on your own PC.
- **Not a Cloud Function** — the project is on Firebase Spark (functions can't deploy).
  Run this locally, by hand or on a schedule. It replaces the "auto-trigger" idea.
- **`nonDrugAdvice` is never sent to the model** (it's auto-generated boilerplate).
- **No Firestore rules change needed** — writes go through the Admin SDK (bypasses rules)
  and only *add* fields; nothing existing is renamed or removed.

The dashboard (`public/consult-analytics.html`) prefers `medsStructured` when present and
falls back to the old `medTokens` parsing for docs not yet classified, so it keeps working
during the migration and shows a "🤖 N% مصنّف بالذكاء" progress badge.

---

## Setup (one time)

1. **Install Ollama** — <https://ollama.com/download> (Windows installer; it runs as a service).
2. **Pull a model** (Arabic-capable):
   ```
   ollama pull qwen2.5:7b
   ```
   Alternatives: `aya:8b` (Cohere Aya, strong Arabic) · `gemma2:9b`.
3. **Service account** — the script finds credentials in this order:
   - `GOOGLE_APPLICATION_CREDENTIALS`
   - `./serviceAccount.json`
   - `../fb-classify/serviceAccount.json`  ← reuses the existing one, nothing to copy
4. **Install deps**:
   ```
   cd meds-classify
   npm install
   ```

## Run

```bash
# 1) Preview 25 docs, write NOTHING (sanity-check the extraction quality first)
node classify-meds.js --dry-run --limit 25

# 2) Full backfill of all approved consultations (skips any already done)
node classify-meds.js

# 3) Do it in chunks (resume later — safe to stop/restart anytime)
node classify-meds.js --limit 200

# 4) Incremental "catch-up" — only NEW approved docs. Run on a schedule
#    (Windows Task Scheduler) as the automatic-classification replacement.
node classify-meds.js
```

### Flags
| Flag | Meaning |
|---|---|
| `--dry-run` | Classify + print, write nothing |
| `--limit N` | Process at most N, then stop (re-run to continue) |
| `--reclassify` | Redo every approved doc, ignoring existing `medsStructured` (e.g. after changing model) |
| `--batch N` | Consultations per model call (default 5; `--batch 1` = most reliable, slowest) |
| `--model NAME` | Override the Ollama model (or set `OLLAMA_MODEL`) |
| `--verbose` | Print every doc's extraction |

### How it's safe to re-run
Docs that already have `medsStructured` are skipped, and each batch is committed before the
next starts — so a crash (or Ctrl-C) just means: run it again and it resumes where it stopped.
Small local models sometimes return a malformed batch; when that happens the script
automatically retries those items **one at a time**, so a bad batch never drops data.

## Scheduling the catch-up (optional)
Windows Task Scheduler → Create Task → Action:
`node` with arguments `classify-meds.js` and *Start in* = this folder. Run it, say, hourly.
Ollama must be running (it is, by default, after install).

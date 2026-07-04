#!/usr/bin/env node
/*
 * Pharma Triage — prescribedMeds structured extraction (LOCAL Ollama, zero cost)
 * =============================================================================
 * Reads each APPROVED consultation's free-text `prescribedMeds` field, sends it
 * to a LOCAL Ollama model (no cloud, no API key, no billing), and writes back a
 * clean, categorized object:
 *
 *   medsStructured: {
 *     medications: [{ name, canonical, dosage, frequency, raw_text }],
 *     actions:     [{ type, detail }]     // type ∈ referral|follow_up|general_advice|other
 *   }
 *   medsClassifiedAt:    <serverTimestamp>
 *   medsClassifiedModel: "<ollama model>"
 *   medsClassifiedEngine:"ollama-local"
 *
 * `nonDrugAdvice` is auto-generated boilerplate and is NEVER sent to the model.
 * Only `prescribedMeds` is classified.
 *
 * This is a LOCAL, standalone script (NOT a Cloud Function — the project is on
 * Firebase Spark, so functions can't deploy). Run it manually or from Task
 * Scheduler. It is safe to re-run: any doc that already has `medsStructured`
 * is skipped, so a crash just resumes where it left off. Each batch is committed
 * before the next starts, so progress is never lost.
 *
 * ── Setup (one time) ────────────────────────────────────────────────────────
 *   1. Install Ollama:            https://ollama.com/download   (Windows installer)
 *   2. Pull an Arabic-capable model:   ollama pull qwen2.5:7b
 *   3. Make sure Ollama is running (the installer runs it as a service).
 *   4. Service account: place serviceAccount.json in this folder, OR set
 *      GOOGLE_APPLICATION_CREDENTIALS, OR the script falls back to
 *      ../fb-classify/serviceAccount.json automatically.
 *   5. npm install   (installs firebase-admin)
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node classify-meds.js --dry-run --limit 25   # preview 25, write nothing
 *   node classify-meds.js                         # full backfill (skips done)
 *   node classify-meds.js --limit 200             # do 200 then stop (resume later)
 *   node classify-meds.js --reclassify            # redo ALL approved (ignore existing)
 *   node classify-meds.js --batch 1               # one consultation per model call
 *   node classify-meds.js --model aya:8b          # use a different local model
 *
 * Incremental catch-up (the "auto trigger" replacement — run on a schedule):
 *   node classify-meds.js                         # only classifies NEW approved docs
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const admin = require("firebase-admin");

// ───────────────────────── config ─────────────────────────
const PROJECT_ID  = "pharma-triage-5d165";
const OLLAMA_URL   = (process.env.OLLAMA_URL   || "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const WRITE_BATCH  = 400;                       // Firestore batched-write cap (max 500)
const OLLAMA_TIMEOUT_MS = Math.max(10000, Number(process.env.OLLAMA_TIMEOUT_MS || 120000));

const ALLOWED_ACTIONS = new Set(["referral", "follow_up", "general_advice", "other"]);

// ───────────────────────── args ─────────────────────────
function parseArgs(argv) {
  const a = { dryRun:false, reclassify:false, limit:0, batch:5, model:OLLAMA_MODEL, verbose:false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if      (k === "--dry-run")    a.dryRun     = true;
    else if (k === "--reclassify") a.reclassify = true;
    else if (k === "--limit")      a.limit      = Math.max(0, Number(argv[++i]) || 0);
    else if (k === "--batch")      a.batch      = Math.max(1, Number(argv[++i]) || 1);
    else if (k === "--model")      a.model      = String(argv[++i] || OLLAMA_MODEL);
    else if (k === "--verbose")    a.verbose    = true;
    else { console.error("Unknown arg:", k); process.exit(1); }
  }
  return a;
}

// ───────────────────────── Arabic normalize (matches the dashboard's AR_NORM) ─────────────────────────
const AR_NORM = s => String(s || "")
  .replace(/[ً-ْـ]/g, "")   // tashkeel + tatweel
  .replace(/[أإآا]/g, "ا") // alef forms → ا
  .replace(/ة/g, "ه")            // ة → ه
  .replace(/[ىي]/g, "ي")    // ى/ي → ي
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const NO_MED_RE = /^(لا ?يوجد|لايوجد|لا ?شئ|لا ?شيء|مفيش|بدون|لا|no|none|nothing|-+|—+|\.+)$/i;

// ───────────────────────── prompt ─────────────────────────
const SYSTEM_PROMPT = [
  "You extract structured data from an Egyptian pharmacy call-center's free-text field `prescribedMeds`.",
  "The text is casual Egyptian Arabic written by many different agents with no fixed format.",
  "",
  "Return ONLY valid JSON. Split what you find into TWO fully separate categories — never mix them:",
  "",
  "1) medications — actual drugs/products only. For each:",
  '   { "name": "<drug name in Arabic>", "canonical": "<standard/corrected spelling>",',
  '     "dosage": "<e.g. قرص / شراب / نقط or empty>", "frequency": "<e.g. كل 8 ساعات or empty>",',
  '     "raw_text": "<the exact substring it came from>" }',
  "   - Fix spelling/diacritic variants so the same drug always gets the SAME `canonical`",
  "     (e.g. دوليبران and any misspelling of it → canonical \"دوليبران\").",
  "   - dosage/frequency are optional; use \"\" if not stated. Do NOT invent them.",
  "   - Merge duplicates of the same drug within one consultation into ONE entry.",
  "",
  "2) actions — advice / referrals / follow-ups, NOT drugs. For each:",
  '   { "type": "referral|follow_up|general_advice|other", "detail": "<short Arabic phrase>" }',
  "   - referral = go to a doctor/hospital/specialist (e.g. مراجعة طبيب، تحويل لمستشفى، REFER).",
  "   - follow_up = watch/monitor symptoms, come back, recheck (e.g. متابعة الاعراض).",
  "   - general_advice = lifestyle/diet/rest/hydration advice.",
  "",
  "Rules:",
  "- NEVER put a time fragment, a dosage word, or an advice phrase into `medications`.",
  '  Fragments like "ساعات" alone are NOT medications — drop them.',
  '- "مراجعة طبيب" / "REFER" / "متابعة الاعراض" are actions, NOT medications.',
  '- If the text means nothing/none (لا يوجد، مفيش، لا شيء، -) return empty arrays.',
  "- Keep drug names in their original Arabic script (corrected spelling), do not translate.",
].join("\n");

function buildUserPrompt(items) {
  // items: [{ i, text }]
  const payload = items.map(it => ({ i: it.i, text: it.text }));
  return [
    "Classify each consultation below. Input is a JSON array; each element has an index `i` and the raw `text`.",
    'Respond with a JSON object of this exact shape:',
    '{ "results": [ { "i": <index>, "medications": [...], "actions": [...] }, ... ] }',
    "Return EXACTLY one result object per input index, in any order, with the matching `i`.",
    "",
    "Examples of correct handling:",
    '  "دوليبران قرص كل 8 ساعات"  → medications:[{name:"دوليبران",canonical:"دوليبران",dosage:"قرص",frequency:"كل 8 ساعات",raw_text:"دوليبران قرص كل 8 ساعات"}], actions:[]',
    '  "مراجعة طبيب"              → medications:[], actions:[{type:"referral",detail:"مراجعة طبيب"}]',
    '  "متابعة الاعراض"           → medications:[], actions:[{type:"follow_up",detail:"متابعة الاعراض"}]',
    '  "لا يوجد"                  → medications:[], actions:[]',
    "",
    "INPUT:",
    JSON.stringify(payload, false, 0),
  ].join("\n");
}

// ───────────────────────── ollama ─────────────────────────
async function callOllama(system, user, model) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OLLAMA_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",                 // force valid JSON output
        options: { temperature: 0, num_ctx: 4096 },
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user },
        ],
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error(`Ollama timed out after ${OLLAMA_TIMEOUT_MS}ms`);
    throw new Error(`Ollama request failed (is it running at ${OLLAMA_URL}?): ${e.message}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
    throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json?.message?.content || "";
}

// robustly pull the first JSON object out of a model reply
function extractJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(s); } catch (_) {}
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

// ───────────────────────── sanitize model output ─────────────────────────
function sanitizeResult(r) {
  const outMeds = [], seen = new Set();
  for (const m of (Array.isArray(r?.medications) ? r.medications : [])) {
    const name = String(m?.name || m?.canonical || "").trim();
    if (!name) continue;
    const canonical = String(m?.canonical || name).trim();
    const key = AR_NORM(canonical);
    if (!key || NO_MED_RE.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    outMeds.push({
      name,
      canonical,
      dosage:    String(m?.dosage    || "").trim(),
      frequency: String(m?.frequency || "").trim(),
      raw_text:  String(m?.raw_text  || "").trim(),
    });
  }
  const outActions = [];
  for (const a of (Array.isArray(r?.actions) ? r.actions : [])) {
    const type = ALLOWED_ACTIONS.has(a?.type) ? a.type : "other";
    const detail = String(a?.detail || "").trim();
    if (!detail) continue;
    outActions.push({ type, detail });
  }
  return { medications: outMeds, actions: outActions };
}

// classify a batch; returns Map(i -> {medications, actions}) or null on shape failure
async function classifyBatch(items, model) {
  const raw = await callOllama(SYSTEM_PROMPT, buildUserPrompt(items), model);
  const parsed = extractJson(raw);
  const results = parsed && Array.isArray(parsed.results) ? parsed.results : null;
  if (!results) return null;
  const byI = new Map();
  for (const r of results) byI.set(Number(r?.i), r);
  // Require every requested index to be present.
  const out = new Map();
  for (const it of items) {
    if (!byI.has(it.i)) return null;
    out.set(it.i, sanitizeResult(byI.get(it.i)));
  }
  return out;
}

// ───────────────────────── firestore ─────────────────────────
function initFirestore() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(__dirname, "serviceAccount.json"),
    path.join(__dirname, "..", "fb-classify", "serviceAccount.json"),
  ].filter(Boolean);
  const saPath = candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (!saPath) {
    console.error("✗ No service account found. Looked in:");
    candidates.forEach(p => console.error("   - " + p));
    console.error("  Place serviceAccount.json here, set GOOGLE_APPLICATION_CREDENTIALS,");
    console.error("  or keep the one in ../fb-classify/.");
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(require(saPath)), projectId: PROJECT_ID });
  console.log(`▶ Service account: ${saPath}`);
  return admin.firestore();
}

function isApproved(d) {
  return d?.review?.status === "approved" || d?.status === "approved";
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  console.log(`▶ Ollama: ${OLLAMA_URL}  ·  model: ${args.model}  ·  batch: ${args.batch}`);
  console.log(`▶ Mode: ${args.dryRun ? "DRY-RUN (no writes)" : "WRITE"}${args.reclassify ? " · RECLASSIFY (ignore existing)" : ""}`);

  const db = initFirestore();

  console.log("▶ Loading consultations …");
  const snap = await db.collection("consultations").get();
  const all = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`  ${all.length} total consultations`);

  const todo = all.filter(x =>
    isApproved(x.data) &&
    String(x.data.prescribedMeds || "").trim() &&
    (args.reclassify || !x.data.medsStructured)
  );
  const approvedCount = all.filter(x => isApproved(x.data)).length;
  console.log(`  ${approvedCount} approved · ${todo.length} need classification${args.reclassify ? " (reclassify)" : ""}`);

  const work = args.limit ? todo.slice(0, args.limit) : todo;
  if (!work.length) { console.log("✓ Nothing to do. All approved consultations are classified."); process.exit(0); }
  console.log(`▶ Will process ${work.length} consultation(s)…\n`);

  let done = 0, medsFound = 0, actionsFound = 0, failed = 0, fellBackToSingle = 0;
  let pendingWrites = [];

  async function flush() {
    if (!pendingWrites.length || args.dryRun) { pendingWrites = []; return; }
    for (let i = 0; i < pendingWrites.length; i += WRITE_BATCH) {
      const wb = db.batch();
      pendingWrites.slice(i, i + WRITE_BATCH).forEach(w => wb.set(w.ref, w.data, { merge: true }));
      await wb.commit();
    }
    pendingWrites = [];
  }

  for (let b = 0; b < work.length; b += args.batch) {
    const chunk = work.slice(b, b + args.batch);
    const items = chunk.map((x, idx) => ({ i: idx, text: String(x.data.prescribedMeds || "").trim() }));

    let resultMap = null;
    try {
      resultMap = await classifyBatch(items, args.model);
    } catch (e) {
      console.error(`\n  ⚠ batch error: ${e.message}`);
    }

    // Fall back to one-at-a-time if the batch shape was wrong (common on small local models).
    if (!resultMap) {
      resultMap = new Map();
      for (const it of items) {
        fellBackToSingle++;
        try {
          const single = await classifyBatch([{ i: 0, text: it.text }], args.model);
          resultMap.set(it.i, single ? (single.get(0) || { medications: [], actions: [] }) : { medications: [], actions: [] });
        } catch (e) {
          failed++;
          resultMap.set(it.i, { medications: [], actions: [] });
        }
      }
    }

    chunk.forEach((x, idx) => {
      const r = resultMap.get(idx) || { medications: [], actions: [] };
      medsFound    += r.medications.length;
      actionsFound += r.actions.length;
      done++;
      if (args.verbose || args.dryRun) {
        const medNames = r.medications.map(m => m.canonical).join("، ") || "—";
        const actTxt   = r.actions.map(a => `${a.type}:${a.detail}`).join(" | ") || "—";
        console.log(`  [${done}/${work.length}] ${x.id}`);
        console.log(`      in : ${String(x.data.prescribedMeds || "").replace(/\s+/g, " ").slice(0, 90)}`);
        console.log(`      💊 : ${medNames}`);
        console.log(`      ▶  : ${actTxt}`);
      } else if (done % 10 === 0 || done === work.length) {
        process.stdout.write(`\r  classified ${done}/${work.length} …`);
      }
      pendingWrites.push({
        ref: db.collection("consultations").doc(x.id),
        data: {
          medsStructured: { medications: r.medications, actions: r.actions },
          medsClassifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          medsClassifiedModel: args.model,
          medsClassifiedEngine: "ollama-local",
        },
      });
    });

    // commit each ~batch so a crash never loses progress / lets you resume
    if (pendingWrites.length >= WRITE_BATCH) await flush();
  }
  await flush();
  if (!args.verbose && !args.dryRun) process.stdout.write("\n");

  console.log("\n── Summary ──");
  console.log(`  Classified : ${done} consultation(s)`);
  console.log(`  Medications: ${medsFound}  ·  Actions: ${actionsFound}`);
  if (fellBackToSingle) console.log(`  Per-item fallback used on: ${fellBackToSingle} item(s)`);
  if (failed) console.log(`  Failed (wrote empty): ${failed}`);
  console.log(`  ${args.dryRun ? "DRY-RUN — nothing written." : "Written to Firestore (medsStructured)."}`);
  if (!args.dryRun && args.limit && todo.length > work.length)
    console.log(`  ${todo.length - work.length} still remaining — re-run to continue.`);
}

main().then(() => process.exit(0)).catch(e => { console.error("\n✗ Fatal:", e.message); process.exit(1); });

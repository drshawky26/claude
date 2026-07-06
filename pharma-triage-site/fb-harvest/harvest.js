#!/usr/bin/env node
/*
 * Pharma Triage — Facebook reply + customer-message harvester
 * ===========================================================
 * Builds a DURABLE log of every agent reply and every customer message so any
 * historical question (per-agent counts, per-day, per-period, customer demand /
 * keywords) is answerable WITHOUT ever re-scanning Facebook again. The live
 * equivalent of the old Excel sheet: harvest once, read forever.
 *
 * WHY: Facebook's Graph API can't query conversations by date (newest-first,
 * capped) — so reaching an OLD day means paging everything newer (slow +
 * unreliable). Fix = harvest once, store it, read from the store.
 *
 * ── THREE MODES ─────────────────────────────────────────────────────────────
 *   1) LOCAL harvest  →  a local JSON file, ZERO Firebase writes (no quota).
 *        node harvest.js --local --since 2026-06-25     # scan FB → harvest-data.json
 *        node harvest.js --local --all                  # from the very beginning
 *        node harvest.js --local                        # incremental (since last local run)
 *      This is the heavy step. It only READS the FB token (from local-config.json
 *      if present — see --save-config — otherwise one Firestore read). It writes
 *      NOTHING to Firestore, so it can never hit the Spark write quota. The full
 *      data (incl. customer text) stays in harvest-data.json ON YOUR MACHINE.
 *
 *   2) UPLOAD          →  push the produced local file to Firestore (resumable).
 *        node harvest.js --upload                       # harvest-data.json → Firestore
 *      Writes fbReplies/{msgId} + fbCustomerMsgs/{msgId} so the WEBSITE dashboard
 *      (fb-harvest.html) works unchanged. RESUMABLE: every uploaded id is recorded
 *      in harvest-uploaded.json, so if the daily Spark write quota (20k) is hit it
 *      stops cleanly and you just re-run --upload tomorrow to continue.
 *
 *   3) DIRECT          →  scan FB and write straight to Firestore (old behaviour).
 *        node harvest.js --backfill --since 2026-06-25  # scan → Firestore in one pass
 *        node harvest.js                                # incremental → Firestore
 *      Convenient but hits the write quota on big backfills. Prefer --local then
 *      --upload for large historical loads.
 *
 * ── FLAGS ───────────────────────────────────────────────────────────────────
 *   --since / --from / --until YYYY-MM-DD   oldest date to harvest back to
 *   --all                                    harvest the entire history (UNLIMITED)
 *   --out <path>                             local file path (default harvest-data.json)
 *   --save-config                            read token+tags from Firestore → local-config.json
 *                                            (do this once; afterwards --local touches Firebase 0×)
 *   --dry-run                                scan only, write nothing (preview counts)
 *   --verbose                                per-conversation logging
 *   --max-convs N                            cap conversations scanned (default: unlimited backfill)
 *
 * SAFETY: never touches `fbLog` (the slot cards) or anything the site reads for
 * existing features. Idempotent by message id (no double counting). The local
 * file contains customer text/names — keep it private; it is git-ignored and is
 * NEVER deployed to hosting.
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const { extractSignals } = require("./keywords");

// admin is loaded lazily — LOCAL mode with local-config.json never needs it.
let admin = null;
function loadAdmin() { if (!admin) admin = require("firebase-admin"); return admin; }

// ───────────────────────── config ─────────────────────────
const PROJECT_ID   = "pharma-triage-5d165";
const GV           = "v21.0";
const WRITE_BATCH  = 400;                 // Firestore batched-write cap (max 500)
const CAIRO_OFFSET = "+03:00";
const LOCAL_FILE_DEFAULT = path.join(__dirname, "harvest-data.json");
const UPLOADED_FILE      = path.join(__dirname, "harvest-uploaded.json");
const LOCAL_CONFIG       = path.join(__dirname, "local-config.json");

const AGENT_TAGS_DEFAULT = {
  "ab":"Abdulrahman Mohammed","aw":"Ahmed Walid","mk":"Mohamed Khaled","kh":"Mohamed Khalifa",
  "sh":"Sherif Ahmed","3i":"Ali M Ibrahim","na":"Nadah Tarek","ho":"Hu Da SaEed",
  "ha":"Hager Ahmed","ay":"Aya Hakeem","aa":"Alshaimaa Ahmed Hassan","st":"Shima Tarek",
  "ma":"Mariam Moustafa","asm":"Asmaa Magdy","yo":"Yomna Mohammed","os":"Mohammed Osama"
};

// ───────────────────────── args ─────────────────────────
function parseArgs(argv) {
  const a = { local:false, upload:false, backfill:false, all:false, until:null,
              out:LOCAL_FILE_DEFAULT, saveConfig:false, refreshConfig:false,
              token:null, pageId:null, dryRun:false, verbose:false, maxConvs:0 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if      (k === "--local")      a.local    = true;
    else if (k === "--upload")     a.upload   = true;
    else if (k === "--backfill")   a.backfill = true;
    else if (k === "--all")        a.all      = true;
    else if (k === "--until" || k === "--since" || k === "--from") a.until = String(argv[++i] || "");
    else if (k === "--out")        a.out      = String(argv[++i] || LOCAL_FILE_DEFAULT);
    else if (k === "--save-config")a.saveConfig = true;
    else if (k === "--refresh-config") a.refreshConfig = true;
    else if (k === "--token")      a.token    = String(argv[++i] || "");
    else if (k === "--page-id" || k === "--page") a.pageId = String(argv[++i] || "");
    else if (k === "--dry-run")    a.dryRun   = true;
    else if (k === "--verbose")    a.verbose  = true;
    else if (k === "--max-convs")  a.maxConvs = Math.max(0, Number(argv[++i]) || 0);
    else { console.error("Unknown arg:", k); process.exit(1); }
  }
  return a;
}

// ───────────────────────── firebase (lazy) ─────────────────────────
let _db = null;
function initDb() {
  if (_db) return _db;
  const A = loadAdmin();
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
                 (fs.existsSync(path.join(__dirname, "serviceAccount.json"))
                    ? path.join(__dirname, "serviceAccount.json")
                    : path.join(__dirname, "..", "fb-classify", "serviceAccount.json"));
  if (!fs.existsSync(saPath)) {
    console.error("✗ serviceAccount.json not found (place it in fb-harvest/ or fb-classify/).");
    process.exit(1);
  }
  A.initializeApp({ credential: A.credential.cert(require(saPath)), projectId: PROJECT_ID });
  _db = A.firestore();
  return _db;
}

// token + agent tags: from local-config.json when possible (fully offline), else Firestore
function readLocalConfig() {
  for (const p of [LOCAL_CONFIG, path.join(__dirname, "..", "fb-classify", "local-config.json")]) {
    if (fs.existsSync(p)) {
      try { const c = JSON.parse(fs.readFileSync(p, "utf8")); if (c.token && c.pageId) return c; } catch {}
    }
  }
  return null;
}
async function getConfig(args) {
  // 1) explicit token/pageId (flags or env) — FULLY OFFLINE, never touches Firestore.
  //    Use this when Firestore quota is exhausted: --token <t> --page-id <p>
  const t = args.token || process.env.FB_TOKEN;
  const p = args.pageId || process.env.FB_PAGE_ID;
  if (t && p) {
    const lc = readLocalConfig();
    const agentTags = { ...AGENT_TAGS_DEFAULT, ...(lc?.agentTags || {}) };
    if (args.saveConfig) { fs.writeFileSync(LOCAL_CONFIG, JSON.stringify({ token: t, pageId: p, agentTags }, null, 2)); console.log(`✓ saved ${LOCAL_CONFIG} (from flags/env) — --local now runs 100% offline.`); }
    return { token: t, pageId: p, agentTags, src: "flags/env" };
  }
  // 2) local-config.json — offline (created once by --save-config or by hand)
  if (!args.refreshConfig && !args.saveConfig) {
    const lc = readLocalConfig();
    if (lc) return { token: lc.token, pageId: lc.pageId, agentTags: { ...AGENT_TAGS_DEFAULT, ...(lc.agentTags || {}) }, src: "local-config.json" };
  }
  // 3) Firestore — needs quota + serviceAccount. Fails with RESOURCE_EXHAUSTED if quota is spent.
  const db  = initDb();
  let cfg;
  try { cfg = (await db.collection("appConfig").doc("fbLiveConfig").get()).data() || {}; }
  catch (e) {
    if (e.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(e.message || "")) {
      console.error("✗ Firestore quota is exhausted, so the token can't be read from it right now.");
      console.error("  → Run fully offline instead: node harvest.js --save-config --token <TOKEN> --page-id <PAGE_ID>");
      console.error("    (or create local-config.json by hand: { \"token\":\"…\", \"pageId\":\"…\" })");
      process.exit(1);
    }
    throw e;
  }
  if (!cfg.token || !cfg.pageId) { console.error("✗ token/pageId not set in appConfig/fbLiveConfig."); process.exit(1); }
  const agentTags = { ...AGENT_TAGS_DEFAULT };
  try { const s = await db.collection("appConfig").doc("fbAgentTags").get(); if (s.exists && s.data().tags) Object.assign(agentTags, s.data().tags); } catch {}
  if (args.saveConfig) {
    fs.writeFileSync(LOCAL_CONFIG, JSON.stringify({ token: cfg.token, pageId: cfg.pageId, agentTags }, null, 2));
    console.log(`✓ saved ${LOCAL_CONFIG} — future --local runs won't touch Firebase.`);
  }
  return { token: cfg.token, pageId: cfg.pageId, agentTags, src: "firestore" };
}

// ───────────────────────── graph api ─────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function gFetch(token, p, params) {
  const url = new URL(`https://graph.facebook.com/${GV}/${p}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res  = await fetch(url.toString());
      const json = await res.json();
      if (json.error) {
        const code = json.error.code;
        if (code === 190 || code === 102 || code === 2500)
          throw new Error(`FB token expired/invalid (code ${code}) — refresh it from the fb-live settings page.`);
        if (code === 4 || code === 17 || code === 32 || code === 613) {
          const wait = 30000 * (attempt + 1);
          console.warn(`\n  ⏳ rate-limited (code ${code}) — waiting ${wait/1000}s…`);
          await sleep(wait); lastErr = new Error(json.error.message); continue;
        }
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (String(e.message).includes("token")) throw e;
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ───────────────────────── extraction helpers ─────────────────────────
function buildTagExtractor(agentTags) {
  return function extractAgentTag(text) {
    if (!text) return null;
    const m = String(text).trim().match(/#([a-z0-9]+)[^a-z؀-ۿ0-9]*$/i);
    if (!m) return null;
    const tag = m[1].toLowerCase();
    return agentTags[tag] ? tag : null;
  };
}
const _AR_DIG = "0-9٠-٩۰-۹";
const ORDER_RE = new RegExp("ال[اأإ]?جمال[يى][^" + _AR_DIG + "]{0,15}[" + _AR_DIG + "]");
function isOrderMsg(text) {
  if (!text) return false;
  return ORDER_RE.test(String(text).replace(/#[a-z0-9]+\s*$/i, ""));
}
function cairoDateISO(ms) { return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10); }
function cairoYM(ms)      { return cairoDateISO(ms).slice(0, 7); }

// ───────────────────────── scan Facebook → in-memory records (no Firestore writes) ─────────────────────────
async function scanFacebook(token, pageId, agentTags, fromMs, args) {
  const extractAgentTag = buildTagExtractor(agentTags);
  const replies = [], cust = [];
  const stat = { convs:0, newestTs:0 };
  const maxConvs = args.maxConvs || (args.backfill || args.local || args.all ? Infinity : 200000);
  let after = "", convScanned = 0, stop = false;
  const seenConvIds = new Set();

  while (!stop && convScanned < maxConvs) {
    const params = { fields: "id,updated_time,participants", limit: 100 };
    if (after) params.after = after;
    const data = await gFetch(token, `${pageId}/conversations`, params);
    const list = data.data || [];
    if (!list.length) break;

    for (const c of list) {
      const cu = new Date(c.updated_time).getTime();
      if (cu < fromMs) { stop = true; break; }
      if (seenConvIds.has(c.id)) continue;
      seenConvIds.add(c.id);
      convScanned++;
      const parts = (c.participants?.data || []).filter(p => String(p.id) !== String(pageId));
      const custName = parts[0]?.name || "زائر";

      let mAfter = "", convDone = false;
      while (!convDone) {
        const mp = { fields: "id,from,created_time,message", limit: 50 };
        if (mAfter) mp.after = mAfter;
        const md = await gFetch(token, `${c.id}/messages`, mp);
        for (const m of (md.data || [])) {
          const ms = new Date(m.created_time).getTime();
          if (ms < fromMs) { convDone = true; break; }
          if (ms > stat.newestTs) stat.newestTs = ms;
          const text = (m.message || "").trim();
          const fromPage = String(m.from?.id) === String(pageId);
          const date = cairoDateISO(ms), ym = cairoYM(ms);
          if (fromPage) {
            const tag = extractAgentTag(text);
            if (!tag) continue;
            replies.push({ msgId: m.id, convId: c.id, ts: ms, date, ym, agentTag: tag, agentName: agentTags[tag] || tag, isOrder: isOrderMsg(text), text });
          } else {
            if (!text) continue;
            const sig = extractSignals(text);
            cust.push({ msgId: m.id, convId: c.id, ts: ms, date, ym, custName, text, intents: sig.intents, products: sig.products, keywords: sig.keywords });
          }
        }
        mAfter = md.paging?.cursors?.after || "";
        if (!md.paging?.next || !mAfter) convDone = true;
      }
      stat.convs++;
      if (args.verbose) console.log(`  conv ${c.id} (${custName}) — replies=${replies.length} cust=${cust.length}`);
      else if (stat.convs % 20 === 0)
        process.stdout.write(`\r  scanned ${stat.convs} convs · ${replies.length} replies · ${cust.length} cust msgs…`);
    }
    after = data.paging?.cursors?.after || "";
    if (!data.paging?.next || !after) break;
  }
  process.stdout.write("\n");
  return { replies, cust, newestTs: stat.newestTs, convs: stat.convs };
}

function summarize(replies, cust, agentTags, label) {
  const byAgent = {}, byIntent = {}, byProduct = {}; let orders = 0;
  for (const r of replies) { byAgent[r.agentTag] = (byAgent[r.agentTag]||0)+1; if (r.isOrder) orders++; }
  for (const c of cust) { for (const i of c.intents) byIntent[i]=(byIntent[i]||0)+1; for (const p of c.products) byProduct[p]=(byProduct[p]||0)+1; }
  console.log(`\n══════════ ${label} ══════════`);
  console.log(`  replies:   ${replies.length}   (orders: ${orders})`);
  console.log(`  cust msgs: ${cust.length}`);
  const top = (o,n=8)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>`${agentTags[k]||k}:${v}`).join("  ");
  if (Object.keys(byAgent).length)   console.log(`  agents:    ${top(byAgent)}`);
  if (Object.keys(byIntent).length)  console.log(`  intents:   ${top(byIntent)}`);
  if (Object.keys(byProduct).length) console.log(`  products:  ${top(byProduct,10)}`);
  console.log("══════════════════════════════════════");
}

// ───────────────────────── local file (merge by msgId) ─────────────────────────
function loadLocal(file) {
  if (!fs.existsSync(file)) return { meta:{}, replies:[], cust:[] };
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { meta:{}, replies:[], cust:[] }; }
}
function mergeById(existing, incoming) {
  const map = new Map();
  for (const r of existing) map.set(r.msgId, r);
  for (const r of incoming) map.set(r.msgId, r);   // new overwrites (idempotent)
  return [...map.values()].sort((a,b)=>a.ts-b.ts);
}

// ───────────────────────── modes ─────────────────────────
async function runLocal(args) {
  const { token, pageId, agentTags, src } = await getConfig(args);
  console.log(`▶ LOCAL harvest — token from ${src}; writing to ${args.out} (ZERO Firebase writes).`);
  const existing = loadLocal(args.out);
  let fromMs;
  if (args.all) fromMs = 0;
  else if (args.until) fromMs = new Date(`${args.until}T00:00:00${CAIRO_OFFSET}`).getTime();
  else if (existing.meta && existing.meta.newestTs) { fromMs = existing.meta.newestTs - 10*60*1000; console.log(`  incremental — since ${new Date(fromMs).toISOString()}`); }
  else { console.error("✗ first local run needs --since YYYY-MM-DD or --all."); process.exit(1); }

  const { replies, cust, newestTs, convs } = await scanFacebook(token, pageId, agentTags, fromMs, args);
  if (args.dryRun) { summarize(replies, cust, agentTags, "LOCAL DRY-RUN (nothing written)"); return; }

  const mergedReplies = mergeById(existing.replies || [], replies);
  const mergedCust    = mergeById(existing.cust || [], cust);
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      newestTs: Math.max(existing.meta?.newestTs || 0, newestTs),
      totalReplies: mergedReplies.length, totalCust: mergedCust.length,
      lastScan: { since: args.all ? "all" : (args.until || "incremental"), convs, addedReplies: replies.length, addedCust: cust.length }
    },
    replies: mergedReplies,
    cust: mergedCust
  };
  fs.writeFileSync(args.out, JSON.stringify(out));
  console.log(`✓ wrote ${args.out} — ${mergedReplies.length} replies + ${mergedCust.length} cust msgs total (added ${replies.length}/${cust.length} this run).`);
  summarize(replies, cust, agentTags, "THIS RUN");
  console.log(`\nNext: upload to Firestore for the website dashboard:\n  node harvest.js --upload`);
}

class QuotaStop extends Error { constructor(done, total){ super("quota"); this.done = done; this.total = total; } }

// Shared resumable writer. `resumable` persists uploaded ids so a quota stop can
// continue next day (used by --upload). Direct mode passes resumable:false.
async function writeToFirestore(replies, cust, meta, { resumable }) {
  const db = initDb(), A = loadAdmin();
  let uploaded = new Set();
  if (resumable && fs.existsSync(UPLOADED_FILE)) { try { uploaded = new Set(JSON.parse(fs.readFileSync(UPLOADED_FILE, "utf8"))); } catch {} }
  const total = replies.length + cust.length;
  let batch = db.batch(), pending = [], done = uploaded.size;
  const saveUploaded = () => { if (resumable) fs.writeFileSync(UPLOADED_FILE, JSON.stringify([...uploaded])); };
  const flush = async () => {
    if (!pending.length) return;
    try { await batch.commit(); }
    catch (e) {
      if (e.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(e.message || "")) throw new QuotaStop(done, total);
      throw e;
    }
    for (const id of pending) uploaded.add(id);
    saveUploaded();
    done += pending.length;
    process.stdout.write(`\r  uploaded ${done}/${total}…`);
    batch = db.batch(); pending = [];
  };
  const push = async (rec, coll) => {
    if (uploaded.has(rec.msgId)) return;
    batch.set(db.collection(coll).doc(rec.msgId), { ...rec, harvestedAt: A.firestore.FieldValue.serverTimestamp() }, { merge: true });
    pending.push(rec.msgId);
    if (pending.length >= WRITE_BATCH) await flush();
  };
  for (const r of replies) await push(r, "fbReplies");
  for (const c of cust)    await push(c, "fbCustomerMsgs");
  await flush();
  process.stdout.write("\n");
  await db.collection("appConfig").doc("fbHarvest").set({
    lastTs: meta.newestTs || 0,
    lastRunAt: A.firestore.FieldValue.serverTimestamp(),
    lastMode: resumable ? "upload" : "direct",
    lastStats: { replies: replies.length, custMsgs: cust.length }
  }, { merge: true });
  return { done, total };
}

async function runUpload(args) {
  if (!fs.existsSync(args.out)) { console.error(`✗ ${args.out} not found — run \`node harvest.js --local --since <date>\` first.`); process.exit(1); }
  const data = loadLocal(args.out);
  const replies = data.replies || [], cust = data.cust || [];
  if (!replies.length && !cust.length) { console.log("Nothing to upload (local file empty)."); return; }
  console.log(`▶ UPLOAD — ${replies.length + cust.length} docs from ${args.out} → Firestore (resumable)…`);
  try {
    const { done, total } = await writeToFirestore(replies, cust, data.meta || {}, { resumable: true });
    console.log(`✓ upload complete — ${done}/${total} docs in Firestore. Dashboard is ready.`);
  } catch (e) {
    if (e instanceof QuotaStop) {
      process.stdout.write("\n");
      console.log(`⏸ Firestore daily write quota reached at ${e.done}/${e.total}. Progress saved (harvest-uploaded.json).`);
      console.log(`   Re-run \`node harvest.js --upload\` tomorrow — it resumes automatically from where it stopped.`);
      process.exit(0);
    }
    throw e;
  }
}

// DIRECT scan → Firestore in one pass (convenient; hits quota on big loads — prefer --local + --upload).
async function runDirect(args) {
  const { token, pageId, agentTags } = await getConfig(args);
  let fromMs;
  if (args.backfill) {
    if (args.all) fromMs = 0;
    else if (args.until) fromMs = new Date(`${args.until}T00:00:00${CAIRO_OFFSET}`).getTime();
    else { console.error("✗ --backfill needs --since YYYY-MM-DD or --all (or use --local)."); process.exit(1); }
  } else {
    const wm = (await initDb().collection("appConfig").doc("fbHarvest").get()).data() || {};
    fromMs = wm.lastTs ? (wm.lastTs - 10*60*1000) : Date.now() - 3*24*3600*1000;
  }
  console.log(`▶ DIRECT scan → Firestore (for big loads prefer --local then --upload).`);
  const { replies, cust, newestTs } = await scanFacebook(token, pageId, agentTags, fromMs, args);
  if (args.dryRun) { summarize(replies, cust, agentTags, "DIRECT DRY-RUN (nothing written)"); return; }
  try {
    await writeToFirestore(replies, cust, { newestTs }, { resumable: false });
    summarize(replies, cust, agentTags, "DIRECT DONE");
  } catch (e) {
    if (e instanceof QuotaStop) {
      console.log(`\n⏸ Firestore write quota hit at ${e.done}/${e.total}. Tip: use \`--local\` (saves to a file, no quota) then \`--upload\` (resumable).`);
      process.exit(0);
    }
    throw e;
  }
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.saveConfig && !args.local && !args.upload && !args.backfill) { await getConfig(args); return; }
  if (args.upload)      return runUpload(args);
  if (args.local)       return runLocal(args);
  return runDirect(args);
}
main().then(() => process.exit(0)).catch(e => { console.error("\n✗", e.message); process.exit(1); });

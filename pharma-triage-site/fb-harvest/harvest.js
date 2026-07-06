#!/usr/bin/env node
/*
 * Pharma Triage — Facebook reply + customer-message harvester (LOCAL, zero cost)
 * =============================================================================
 * Builds a DURABLE Firestore log of every agent reply and every customer message
 * so the website can answer ANY historical question (per-agent counts, per-day,
 * per-period, customer demand/keywords) with a simple Firestore query — WITHOUT
 * ever re-scanning Facebook again. This is the live equivalent of the old Excel
 * sheet: write once, read forever.
 *
 * WHY THIS EXISTS
 * ---------------
 * Facebook's Graph API cannot query conversations by date. It only pages them
 * newest-first. So reaching an OLD day means paging through everything newer,
 * which is slow AND (with any cap) unreliable — the root cause of both
 * "unrealistic numbers" and "re-analyzes from scratch every time". The fix is to
 * harvest ONCE into Firestore, then read from Firestore.
 *
 * SAFETY
 * ------
 * • This script NEVER touches `fbLog` (the 1840 existing slot cards) or anything
 *   the website reads for existing features. It only WRITES to NEW collections:
 *     - fbReplies/{msgId}        (one doc per page reply that ends with an agent #tag)
 *     - fbCustomerMsgs/{msgId}   (one doc per customer message, with extracted keywords)
 *     - appConfig/fbHarvest      (watermark + run stats)
 * • Idempotent: doc id = Facebook message id, so re-runs never double-count.
 *   (This structurally removes the duplicate-conversation counting bug too.)
 * • Resumable: progress is committed in batches and the watermark advances, so a
 *   crash / quota stop just resumes next run.
 * • It's just an HTTPS client (graph.facebook.com + firestore). It does not touch
 *   your other machine and does not interfere with the site or the network.
 *
 * SETUP (one time)
 * ----------------
 *   1. Service account: put serviceAccount.json in this folder, OR set
 *      GOOGLE_APPLICATION_CREDENTIALS, OR it falls back to
 *      ../fb-classify/serviceAccount.json automatically.
 *   2. npm install         (installs firebase-admin)
 *   3. The FB token+pageId are read live from appConfig/fbLiveConfig (same place
 *      the website uses). Make sure the token there is valid.
 *
 * USAGE
 * -----
 *   node harvest.js --backfill --until 2026-05-01   # deep one-time backfill (UNLIMITED),
 *                                                   #   pages ALL the way back to this date.
 *   node harvest.js --backfill --all                # backfill from the very beginning.
 *   node harvest.js                                 # incremental: only NEW activity since
 *                                                   #   last run (seconds). Run on a schedule.
 *   node harvest.js --dry-run --until 2026-07-01    # scan + classify, write NOTHING (preview).
 *   node harvest.js --verbose                       # per-conversation logging.
 *
 * NOTES
 * -----
 * • --backfill has NO conversation cap by default. Leave it running overnight.
 * • Incremental mode uses the watermark in appConfig/fbHarvest; it pages
 *   conversations only until it reaches already-harvested activity.
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const admin = require("firebase-admin");
const { extractSignals } = require("./keywords");

// ───────────────────────── config ─────────────────────────
const PROJECT_ID = "pharma-triage-5d165";
const GV         = "v21.0";
const WRITE_BATCH = 400;             // Firestore batched-write cap (max 500)
const CAIRO_OFFSET = "+03:00";       // Cairo (no DST in scope)

// ───────────────────────── args ─────────────────────────
function parseArgs(argv) {
  const a = { backfill:false, all:false, until:null, dryRun:false, verbose:false, maxConvs:0 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if      (k === "--backfill") a.backfill = true;
    else if (k === "--all")      a.all      = true;
    else if (k === "--until")    a.until    = String(argv[++i] || "");
    else if (k === "--dry-run")  a.dryRun   = true;
    else if (k === "--verbose")  a.verbose  = true;
    else if (k === "--max-convs")a.maxConvs = Math.max(0, Number(argv[++i]) || 0);
    else { console.error("Unknown arg:", k); process.exit(1); }
  }
  return a;
}

// ───────────────────────── firebase ─────────────────────────
function initDb() {
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
                 (fs.existsSync(path.join(__dirname, "serviceAccount.json"))
                    ? path.join(__dirname, "serviceAccount.json")
                    : path.join(__dirname, "..", "fb-classify", "serviceAccount.json"));
  if (!fs.existsSync(saPath)) {
    console.error("✗ serviceAccount.json not found (place it in fb-harvest/ or fb-classify/).");
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(require(saPath)), projectId: PROJECT_ID });
  return admin.firestore();
}

// ───────────────────────── graph api ─────────────────────────
async function gFetch(token, p, params) {
  const url = new URL(`https://graph.facebook.com/${GV}/${p}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {           // retry transient errors / rate limits
    try {
      const res  = await fetch(url.toString());
      const json = await res.json();
      if (json.error) {
        const code = json.error.code;
        if (code === 190 || code === 102 || code === 2500)
          throw new Error(`FB token expired/invalid (code ${code}) — refresh it from the fb-live settings page.`);
        if (code === 4 || code === 17 || code === 32 || code === 613) {   // rate limit → back off
          const wait = 30000 * (attempt + 1);
          console.warn(`\n  ⏳ rate-limited (code ${code}) — waiting ${wait/1000}s…`);
          await sleep(wait); lastErr = new Error(json.error.message); continue;
        }
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (String(e.message).includes("token")) throw e;      // don't retry auth failures
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastErr;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ───────────────────────── agent tag extraction (mirror of facebook.html) ─────────────────────────
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
  const t = String(text).replace(/#[a-z0-9]+\s*$/i, "");
  return ORDER_RE.test(t);
}

// ───────────────────────── date helpers (Cairo) ─────────────────────────
function cairoDateISO(ms) {
  // YYYY-MM-DD in Cairo time
  const d = new Date(ms + 3 * 3600 * 1000);   // shift to Cairo then read UTC parts
  return d.toISOString().slice(0, 10);
}
function cairoYM(ms) { return cairoDateISO(ms).slice(0, 7); }

// ───────────────────────── main ─────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const db   = initDb();

  // 1) live token + pageId
  const cfg = (await db.collection("appConfig").doc("fbLiveConfig").get()).data() || {};
  const token = cfg.token, pageId = cfg.pageId;
  if (!token || !pageId) { console.error("✗ token/pageId not set in appConfig/fbLiveConfig."); process.exit(1); }

  // 2) agent tags (defaults + Firestore overrides)
  const agentTags = {
    "ab":"Abdulrahman Mohammed","aw":"Ahmed Walid","mk":"Mohamed Khaled","kh":"Mohamed Khalifa",
    "sh":"Sherif Ahmed","3i":"Ali M Ibrahim","na":"Nadah Tarek","ho":"Hu Da SaEed",
    "ha":"Hager Ahmed","ay":"Aya Hakeem","aa":"Alshaimaa Ahmed Hassan","st":"Shima Tarek",
    "ma":"Mariam Moustafa","asm":"Asmaa Magdy","yo":"Yomna Mohammed","os":"Mohammed Osama"
  };
  try {
    const s = await db.collection("appConfig").doc("fbAgentTags").get();
    if (s.exists && s.data().tags) Object.assign(agentTags, s.data().tags);
  } catch { /* ignore */ }
  const extractAgentTag = buildTagExtractor(agentTags);

  // 3) window
  const wm = (await db.collection("appConfig").doc("fbHarvest").get()).data() || {};
  let fromMs;
  if (args.backfill) {
    if (args.all) fromMs = 0;
    else if (args.until) fromMs = new Date(`${args.until}T00:00:00${CAIRO_OFFSET}`).getTime();
    else { console.error("✗ --backfill needs --until YYYY-MM-DD or --all."); process.exit(1); }
    console.log(`▶ BACKFILL mode — harvesting back to ${args.all ? "the beginning" : args.until} (UNLIMITED).`);
  } else {
    // incremental: from last watermark (minus a 10-min safety overlap; idempotent so overlap is harmless)
    fromMs = wm.lastTs ? (wm.lastTs - 10 * 60 * 1000) : Date.now() - 3 * 24 * 3600 * 1000;
    console.log(`▶ INCREMENTAL mode — harvesting since ${new Date(fromMs).toISOString()} (watermark).`);
  }
  // Backfill = UNLIMITED (no cap — pages the entire history, millions of conversations if needed).
  // Incremental defaults to a high safety ceiling; override either with --max-convs N.
  const maxConvs = args.maxConvs || (args.backfill ? Infinity : 200000);

  // 4) page conversations newest-first, page each conversation's messages, extract
  const stats = { convs:0, replies:0, custMsgs:0, orders:0, newestTs:0, byAgent:{}, byIntent:{}, byProduct:{} };
  let batch = db.batch(), batchCount = 0;
  const commit = async () => {
    if (batchCount === 0) return;
    if (!args.dryRun) await batch.commit();
    batch = db.batch(); batchCount = 0;
  };
  const queueSet = async (ref, data) => {
    batch.set(ref, data, { merge: true }); batchCount++;
    if (batchCount >= WRITE_BATCH) await commit();
  };

  let after = "", convScanned = 0, stop = false;
  const seenConvIds = new Set();     // updated_time shifts live → a conversation can reappear across pages; skip re-scan (saves API calls)
  while (!stop && convScanned < maxConvs) {
    const params = { fields: "id,updated_time,participants", limit: 100 };
    if (after) params.after = after;
    const data = await gFetch(token, `${pageId}/conversations`, params);
    const list = data.data || [];
    if (!list.length) break;

    for (const c of list) {
      const cu = new Date(c.updated_time).getTime();
      if (cu < fromMs) { stop = true; break; }       // reached already-harvested / target boundary
      if (seenConvIds.has(c.id)) continue;           // already scanned this conversation this run
      seenConvIds.add(c.id);
      convScanned++;
      const parts = (c.participants?.data || []).filter(p => String(p.id) !== String(pageId));
      const custName = parts[0]?.name || "زائر";

      // page this conversation's messages back to fromMs
      let mAfter = "", convDone = false;
      while (!convDone) {
        const mp = { fields: "id,from,created_time,message", limit: 50 };
        if (mAfter) mp.after = mAfter;
        const md = await gFetch(token, `${c.id}/messages`, mp);
        for (const m of (md.data || [])) {
          const ms = new Date(m.created_time).getTime();
          if (ms < fromMs) { convDone = true; break; }
          if (ms > stats.newestTs) stats.newestTs = ms;
          const text = (m.message || "").trim();
          const fromPage = String(m.from?.id) === String(pageId);
          const date = cairoDateISO(ms), ym = cairoYM(ms);

          if (fromPage) {
            const tag = extractAgentTag(text);
            if (!tag) continue;                        // page message without an agent hashtag → ignore
            const order = isOrderMsg(text);
            await queueSet(db.collection("fbReplies").doc(m.id), {
              msgId: m.id, convId: c.id, ts: ms, date, ym,
              agentTag: tag, agentName: agentTags[tag] || tag,
              isOrder: order, text,
              harvestedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            stats.replies++;
            stats.byAgent[tag] = (stats.byAgent[tag] || 0) + 1;
            if (order) stats.orders++;
          } else {
            // customer message — store ALL (user's choice) with extracted signals
            if (!text) continue;
            const sig = extractSignals(text);
            await queueSet(db.collection("fbCustomerMsgs").doc(m.id), {
              msgId: m.id, convId: c.id, ts: ms, date, ym,
              custName, text,
              intents: sig.intents, products: sig.products, keywords: sig.keywords,
              harvestedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            stats.custMsgs++;
            for (const it of sig.intents)  stats.byIntent[it]  = (stats.byIntent[it]  || 0) + 1;
            for (const pr of sig.products) stats.byProduct[pr] = (stats.byProduct[pr] || 0) + 1;
          }
        }
        mAfter = md.paging?.cursors?.after || "";
        if (!md.paging?.next || !mAfter) convDone = true;
      }

      stats.convs++;
      if (args.verbose) console.log(`  conv ${c.id} (${custName}) — replies=${stats.replies} cust=${stats.custMsgs}`);
      else if (stats.convs % 20 === 0)
        process.stdout.write(`\r  scanned ${stats.convs} convs · ${stats.replies} replies · ${stats.custMsgs} cust msgs…`);
    }

    after = data.paging?.cursors?.after || "";
    if (!data.paging?.next || !after) break;
    await commit();                                   // checkpoint each conversation page
  }
  await commit();
  process.stdout.write("\n");

  // 5) advance watermark (never move it backwards)
  if (!args.dryRun && stats.newestTs) {
    const newWm = Math.max(wm.lastTs || 0, stats.newestTs);
    await db.collection("appConfig").doc("fbHarvest").set({
      lastTs: newWm,
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMode: args.backfill ? "backfill" : "incremental",
      ...(args.backfill && (args.all || args.until) ? { backfilledFrom: args.all ? "all" : args.until } : {}),
      lastStats: { convs: stats.convs, replies: stats.replies, custMsgs: stats.custMsgs, orders: stats.orders }
    }, { merge: true });
  }

  // 6) report
  console.log("\n══════════ HARVEST SUMMARY ══════════");
  console.log(`  mode:        ${args.backfill ? "backfill" : "incremental"}${args.dryRun ? " (DRY-RUN, nothing written)" : ""}`);
  console.log(`  convs:       ${stats.convs}`);
  console.log(`  replies:     ${stats.replies}   (orders: ${stats.orders})`);
  console.log(`  cust msgs:   ${stats.custMsgs}`);
  const topAgents = Object.entries(stats.byAgent).sort((a,b)=>b[1]-a[1]).slice(0,8)
                      .map(([t,n]) => `${agentTags[t]||t}:${n}`).join("  ");
  if (topAgents) console.log(`  top agents:  ${topAgents}`);
  const topIntents = Object.entries(stats.byIntent).sort((a,b)=>b[1]-a[1])
                      .map(([k,n]) => `${k}:${n}`).join("  ");
  if (topIntents) console.log(`  intents:     ${topIntents}`);
  const topProducts = Object.entries(stats.byProduct).sort((a,b)=>b[1]-a[1]).slice(0,10)
                      .map(([k,n]) => `${k}:${n}`).join("  ");
  if (topProducts) console.log(`  products:    ${topProducts}`);
  console.log("═════════════════════════════════════");
}

main().then(() => process.exit(0)).catch(e => { console.error("\n✗", e.message); process.exit(1); });

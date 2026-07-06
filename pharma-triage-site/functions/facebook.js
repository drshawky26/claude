/**
 * Facebook Graph API integration for the "فيسبوك" card.
 *
 * Pulls (server-side, with a secret Page token) and writes to Firestore:
 *   fbInsights/posts   → recent posts + comment/reaction/share counts + reach
 *   fbInsights/inbox   → conversations vs messages + unread (the inbox split)
 *   fbInsights/page    → page reach + engagement series (last 30 days)
 *   fbInsights/status  → last sync time, ok/error, counts
 *
 * The client (public/facebook.html) only READS these docs (gated by
 * canViewFacebook in firestore.rules). The token never reaches the client.
 *
 * Config:
 *   - Secret  FB_PAGE_TOKEN        → set via:  firebase functions:secrets:set FB_PAGE_TOKEN
 *   - Firestore appConfig/fbConfig → { pageId, adAccountId, graphVersion } (admin-editable, page id is not secret)
 */
const admin = require("firebase-admin");
try { admin.app(); } catch (_) { admin.initializeApp(); }

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const FB_PAGE_TOKEN = defineSecret("FB_PAGE_TOKEN");
const DEFAULT_VERSION = "v21.0"; // override per-project via appConfig/fbConfig.graphVersion
const ADMIN_EMAIL = "drshawky530@gmail.com";

const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function getConfig() {
  const snap = await db().doc("appConfig/fbConfig").get();
  const d = snap.exists ? snap.data() : {};
  return {
    pageId: String(d.pageId || "").trim(),
    adAccountId: String(d.adAccountId || "").trim(),
    version: String(d.graphVersion || DEFAULT_VERSION).trim(),
  };
}

async function graphGet(version, path, query, token) {
  const usp = new URLSearchParams({ ...query, access_token: token });
  const url = `https://graph.facebook.com/${version}/${path}?${usp.toString()}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Graph ${path} → ${e.code || res.status}/${e.type || "HTTP"}: ${e.message || res.statusText}`);
  }
  return json;
}

function summarizeInsights(resp) {
  const out = {};
  (resp.data || []).forEach((m) => {
    const series = (m.values || []).map((v) => ({ t: v.end_time || "", v: Number(v.value) || 0 }));
    out[m.name] = { series, total: series.reduce((s, x) => s + x.v, 0) };
  });
  return out;
}

/** Core sync: called by the scheduler and the manual "refresh" callable. */
async function runSync(token) {
  const cfg = await getConfig();
  if (!cfg.pageId) throw new Error("No pageId configured — set appConfig/fbConfig.pageId");
  const V = cfg.version;
  const out = { pageId: cfg.pageId, version: V, startedAt: new Date().toISOString() };

  // 1) Posts: comments + reactions + shares + reach per post  (the comments solution)
  // ملاحظة: ميتريك الـ insights على البوست (post_impressions_unique) بقى مهجور في إصدارات
  // الـ Graph الجديدة ويرجّع (#100) "must be a valid insights metric" — وكان بيكسر الـ sync كله.
  // فبنطلبه best-effort: لو فشل بنعيد الطلب من غير الـ reach، ولو فشل خالص بنكمّل من غيره.
  const POST_BASE_FIELDS =
    "id,message,created_time,permalink_url," +
    "comments.summary(true).limit(0),reactions.summary(true).limit(0),shares";
  let posts = [];
  try {
    let postsResp;
    try {
      postsResp = await graphGet(V, `${cfg.pageId}/published_posts`, {
        fields: POST_BASE_FIELDS + ",insights.metric(post_impressions_unique).period(lifetime)",
        limit: "25",
      }, token);
    } catch (e) {
      logger.warn("posts insights metric rejected, retrying without reach", e.message);
      postsResp = await graphGet(V, `${cfg.pageId}/published_posts`, {
        fields: POST_BASE_FIELDS,
        limit: "25",
      }, token);
    }
    posts = (postsResp.data || []).map((p) => ({
      id: p.id,
      message: String(p.message || "").slice(0, 280),
      createdTime: p.created_time || "",
      permalink: p.permalink_url || "",
      comments: p.comments?.summary?.total_count ?? null,
      reactions: p.reactions?.summary?.total_count ?? null,
      shares: p.shares?.count ?? 0,
      reach: p.insights?.data?.[0]?.values?.[0]?.value ?? null,
    }));
  } catch (e) {
    logger.warn("posts fetch failed", e.message);
  }
  await db().doc("fbInsights/posts").set({ items: posts, updatedAt: ts() });

  // 2) Page insights: reach + engagement, last 30 days
  let page = {};
  try {
    const pi = await graphGet(V, `${cfg.pageId}/insights`, {
      metric: "page_impressions_unique,page_post_engagements",
      period: "day",
      date_preset: "last_30d",
    }, token);
    page = summarizeInsights(pi);
  } catch (e) {
    logger.warn("page insights failed", e.message);
    page = { error: String(e.message || e) };
  }
  await db().doc("fbInsights/page").set({ ...page, updatedAt: ts() });

  // 3) Conversations (inbox): conversations vs messages vs unread  (the inbox split)
  const inbox = { conversations: 0, messages: 0, unread: 0 };
  try {
    let resp = await graphGet(V, `${cfg.pageId}/conversations`, {
      fields: "message_count,unread_count",
      platform: "messenger",
      limit: "100",
    }, token);
    let convos = resp.data || [];
    let pages = 0;
    while (resp.paging && resp.paging.next && pages < 9) {
      const r = await fetch(resp.paging.next);
      resp = await r.json().catch(() => ({}));
      if (resp.error) break;
      convos = convos.concat(resp.data || []);
      pages++;
    }
    inbox.conversations = convos.length;
    inbox.messages = convos.reduce((s, c) => s + (c.message_count || 0), 0);
    inbox.unread = convos.reduce((s, c) => s + (c.unread_count || 0), 0);
  } catch (e) {
    logger.warn("conversations failed", e.message);
    inbox.error = String(e.message || e);
  }
  await db().doc("fbInsights/inbox").set({ ...inbox, updatedAt: ts() });

  out.ok = true;
  out.finishedAt = new Date().toISOString();
  out.counts = { posts: posts.length, conversations: inbox.conversations, messages: inbox.messages };
  await db().doc("fbInsights/status").set({ ...out, lastSync: ts() }, { merge: true });
  return out;
}

async function assertAdminV2(req) {
  const email = req.auth?.token?.email;
  if (!email) throw new HttpsError("unauthenticated", "Login required");
  if (email === ADMIN_EMAIL) return;
  const snap = await db().collection("users").doc(req.auth.uid).get();
  if (snap.exists && snap.data().role === "admin" && snap.data().active !== false) return;
  throw new HttpsError("permission-denied", "Admin only");
}

/** Scheduled pull — every 6 hours (Cairo time). */
exports.fbSync = onSchedule(
  { schedule: "every 6 hours", timeZone: "Africa/Cairo", secrets: [FB_PAGE_TOKEN], timeoutSeconds: 300 },
  async () => {
    try {
      const r = await runSync(FB_PAGE_TOKEN.value());
      logger.info("fbSync ok", r.counts);
    } catch (e) {
      logger.error("fbSync failed", e.message);
      await db().doc("fbInsights/status").set(
        { ok: false, error: String(e.message || e), lastSync: ts() }, { merge: true }
      );
    }
  }
);

/** Manual pull from the admin UI ("تحديث الآن"). */
exports.fbRefresh = onCall({ secrets: [FB_PAGE_TOKEN] }, async (req) => {
  await assertAdminV2(req);
  try {
    const status = await runSync(FB_PAGE_TOKEN.value());
    return { ok: true, status };
  } catch (e) {
    await db().doc("fbInsights/status").set(
      { ok: false, error: String(e.message || e), lastSync: ts() }, { merge: true }
    );
    throw new HttpsError("internal", String(e.message || e));
  }
});

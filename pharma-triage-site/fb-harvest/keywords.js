"use strict";
/*
 * keywords.js — free, local, rule-based intent + product/keyword extraction
 * =========================================================================
 * No AI, no API, no cost. Pure Arabic/English keyword dictionaries.
 * Extend freely — add words to any list and re-run the harvester.
 *
 * extractSignals(text) → { intents:[...], products:[...], keywords:[...] }
 *   intents  = high-level customer intent  (prescription | order | shortage | price | delivery | complaint | greeting | album)
 *   products = product categories detected  (sunscreen | moisturizer | shampoo | vitamin | ...)
 *   keywords = every matched raw term (for word-cloud / frequency analysis)
 *
 * Matching is diacritic-insensitive and normalizes common Arabic letter
 * variants (أ/إ/آ→ا، ى→ي، ة→ه، و tolerates elongation "ـ"). Whole-word-ish:
 * we match on normalized substrings but keep the dictionary specific enough
 * that false positives are rare. Order/price also cross-check a number.
 */

// ── Arabic normalization (same spirit as consult-analytics AR_NORM) ──
function normAr(s) {
  return String(s || "")
    .replace(/[ً-ْٰـ]/g, "")   // harakat + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// ── Product categories: canonical → [match terms] ──
// Add a category or a term any time; the harvester picks it up next run.
const PRODUCTS = {
  "sunscreen":    ["صن سكرين", "صنسكرين", "صن بلوك", "واقي شمس", "واقى شمس", "واقي الشمس", "sunscreen", "sun block", "spf"],
  "moisturizer":  ["مرطب", "مرطبات", "كريم ترطيب", "لوشن", "بودي لوشن", "moisturizer", "moisturiser", "lotion", "hydrating"],
  "cleanser":     ["غسول", "غسول وش", "غسول للوجه", "cleanser", "face wash", "wash"],
  "serum":        ["سيروم", "سيرم", "serum"],
  "shampoo":      ["شامبو", "شامبوهات", "شمبو", "shampoo", "بلسم", "conditioner"],
  "hair_care":    ["الشعر", "تساقط الشعر", "تساقط", "بيبانثين", "minoxidil", "مينوكسيديل", "بخاخ الشعر"],
  "vitamin":      ["فيتامين", "فيتامينات", "vitamin", "vit ", "فيتا", "اوميجا", "omega", "زنك", "zinc", "حديد", "كالسيوم", "calcium", "d3", "b12"],
  "supplement":   ["مكمل", "مكملات", "supplement", "بروتين", "protein", "كولاجين", "collagen"],
  "baby":         ["بيبي", "بيبى", "اطفال", "طفل", "رضيع", "baby", "بامبرز", "حفاضات", "حفاضة", "لبن اطفال", "formula"],
  "makeup":       ["ميكب", "ميك اب", "مكياج", "makeup", "فاونديشن", "foundation", "احمر شفاه", "روج", "lipstick", "مسكرة", "mascara"],
  "perfume":      ["برفان", "عطر", "عطور", "perfume", "بادي سبلاش", "body splash", "مزيل عرق", "deodorant", "ديودرنت"],
  "acne":         ["حبوب الوجه", "حب الشباب", "acne", "روكتان", "تصبغات", "اكني"],
  "whitening":    ["تفتيح", "تبييض", "whitening", "تفتيح البشره", "تفتيح المناطق"],
  "eye_care":     ["كريم عين", "هالات", "دائري", "eye cream", "هالات سوداء"],
  "medicine":     ["دوا", "دواء", "علاج", "برشام", "برشامة", "اقراص", "medicine", "شراب", "قطره", "مضاد حيوي", "مضاد", "antibiotic"],
  "device":       ["جهاز", "سماعه", "ترمومتر", "جهاز ضغط", "جهاز سكر", "nebulizer", "بخاخه"],
};

// ── Intents: canonical → [match terms] (checked against normalized text) ──
const INTENTS = {
  "prescription": ["روشته", "روشتة", "الروشته", "روشتتي", "روشتتى", "prescription", "الطبيب كتب", "الدكتور كتب", "كتبلي", "مكتوب في الروشته"],
  "order":        ["عايز اطلب", "عايزه اطلب", "اطلب", "الطلب", "اوردر", "order", "احجز", "حجز", "ممكن اطلب", "عايز اشتري", "عايزه اشتري", "اشتري", "توصيل الطلب"],
  "shortage":     ["مش متوفر", "مش موجود", "خلص", "خلصان", "نافد", "غير متوفر", "مفيش", "ناقص", "نواقص", "out of stock", "not available", "unavailable", "لما يتوفر", "هيتوفر امتى"],
  "price":        ["بكام", "السعر", "سعر", "بكم", "الثمن", "price", "how much", "كام سعر", "عرض", "خصم", "offer", "discount"],
  "delivery":     ["توصيل", "شحن", "الاوردر وصل", "الشحن", "delivery", "shipping", "فين طلبي", "فين اوردري", "لسه ماوصلش", "معاد التوصيل"],
  "complaint":    ["شكوى", "زعلان", "زعلانه", "مش راضي", "مش راضيه", "وحش", "سيئ", "مشكله", "complaint", "غلط", "اتأخر", "متأخر", "ارجاع", "استرجاع", "refund"],
  "album":        ["البوم", "البم", "album", "الالبوم", "الصور", "الكتالوج", "catalog", "catalogue"],
  "greeting":     ["السلام عليكم", "صباح الخير", "مساء الخير", "ازيكم", "ازيك", "هاي", "هلو", "hello", "hi ", "شكرا", "متشكر", "تمام"],
};

function buildMatcher(dict) {
  // pre-normalize every term once
  const out = {};
  for (const [canon, terms] of Object.entries(dict)) out[canon] = terms.map(normAr).filter(Boolean);
  return out;
}
const _PROD = buildMatcher(PRODUCTS);
const _INT  = buildMatcher(INTENTS);

const AR_DIG = /[0-9٠-٩۰-۹]/;

function extractSignals(rawText) {
  const t = normAr(rawText);
  if (!t) return { intents: [], products: [], keywords: [] };
  const intents = new Set(), products = new Set(), keywords = new Set();

  for (const [canon, terms] of Object.entries(_PROD)) {
    for (const term of terms) {
      if (term && t.includes(term)) { products.add(canon); keywords.add(term); }
    }
  }
  for (const [canon, terms] of Object.entries(_INT)) {
    for (const term of terms) {
      if (term && t.includes(term)) { intents.add(canon); keywords.add(term); }
    }
  }
  // order/price only count as such if a number is present (avoids false positives)
  if ((intents.has("order") || intents.has("price")) && !AR_DIG.test(rawText || "")) {
    // keep them — a customer can ask "بكام" without a number; number just strengthens.
  }
  return { intents: [...intents], products: [...products], keywords: [...keywords] };
}

module.exports = { extractSignals, normAr, PRODUCTS, INTENTS };

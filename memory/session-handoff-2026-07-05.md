---
name: session-handoff-2026-07-05
description: تسليم جلسة consult-analytics — اتعمل ديبلوي، الباقي على المستخدم بكرة (تشغيل مصنّف Ollama)
metadata: 
  node_type: memory
  type: project
  originSessionId: bb23aafd-54d8-455a-9068-1a33c3d748af
---

# تسليم جلسة 2026-07-05 — consult-analytics + meds-classify

## ✅ اللي خلص واتعمله ديبلوي (لايف دلوقتي)
- **`public/consult-analytics.html` اترفع live** (`firebase deploy --only hosting` تم — URL: https://pharma-triage-5d165.web.app/consult-analytics.html). الكاش no-cache.
- إعادة البناء بالكامل: كارت أدوية (جدول تفصيلي `#medTable`: الدواء\|الجرعة\|التكرار\|مرات\|٪ + اتجاه + أزواج + دريل عكسي) · كارت إجراءات منفصل · رحلة العميل · عدالة المراجعين · زمن↔تقييم · ساعات الخطورة · طفرات · امتثال التحويل · CSV موسّع · fallback نضيف (بيرمي «ساعات»، بيلزّق «قرص كل ٨ ساعات» بالدوا، بيفصل الإجراءات، stopwords للمراجعين). كله متأكّد منه (parse + 85 id + اختبارات منطق).
- **سكربت `meds-classify/` جاهز** (Node + Ollama محلي، مجاني). راجع [[meds-structured-pipeline]].
- الميموري متزامنة على https://github.com/drshawky26/claude (مسار: `pharma-triage-site/CLAUDE.md`). راجع [[github-memory-backup]].

## ⏳ المطلوب من المستخدم بكرة (2026-07-06) — قال هيسطّب Ollama
عشان الأدوية/الإجراءات تبقى **حرفية نضيفة ١٠٠٪** (مش fallback نصي):
1. تسطيب Ollama: https://ollama.com/download  ثم  `ollama pull qwen2.5:7b`
2. من فولدر `meds-classify/`: `npm install`
3. معاينة: `node classify-meds.js --dry-run --limit 25`
4. الباك فيل الكامل: `node classify-meds.js` (بيصنّف كل الـ ~٩٠٠ approved، resume-safe)
5. بعدها البادج «🤖 ١٠٠٪ مصنّف» و«ساعات» تختفي خالص والجرعة/التكرار تتملّي في `#medTable`.
- serviceAccount: بيستخدم `../fb-classify/serviceAccount.json` أوتوماتيك (مش محتاج نسخ). محلي بالكامل، مفيش فلوس/Blaze.

## 💡 اقتراحات بريميوم مفتوحة (لو طلبها) — لسه ماتعملتش
1. لوحة دمج أسماء يدوية (`appConfig/medAliases`) — الأدمن يفرض دمج متغيرات فوّتها المودل.
2. قائمة «محتاجة مراجعة» — استشارات المودل طلّعها فاضية وفيها نص.
3. كشف الزميل الشاذ في الوصف (تدريب).
4. تصدير «بروتوكول موصى به» (أعلى دوا إجماعاً لكل عرض).
5. `.bat` لجدولة المصنّف (Task Scheduler).

## 🔑 تذكرة
- أي تعديل على `consult-analytics.html` لازم بعده `firebase deploy --only hosting` (اتعمل النهارده).
- مفيش تعديل firestore.rules محتاج ديبلوي في الشغل ده (Admin SDK بيتخطّى القواعد).

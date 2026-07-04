---
name: meds-structured-pipeline
description: "consult-analytics — how prescribedMeds gets turned into clean medsStructured (local Ollama, free) + dashboard rebuild"
metadata: 
  node_type: memory
  type: project
  originSessionId: bb23aafd-54d8-455a-9068-1a33c3d748af
---

# consult-analytics.html rebuild — medsStructured pipeline (بدأ 2026-07-04)

**الهدف:** استبدال تقسيم `medTokens` الساذج (اللي بيطلّع "ساعات" كأعلى دواء، ويخلط "مراجعة طبيب"/"REFER" مع الأدوية، ويكرّر نفس الدوا مقسوم مختلف) باستخراج مُهيكل حقيقي.

## القرارات النهائية (اتاخدت مع المستخدم)
- **مجانّي بالكامل** — مفيش Anthropic API مدفوع، مفيش Blaze. المستخدم طلب صراحة "total free".
- **المحرّك = Ollama محلي** (نموذج على جهاز الأدمن، $0، أوفلاين). الديفولت `qwen2.5:7b` (بدائل: `aya:8b`, `gemma2:9b`).
- **مفيش Cloud Function** — المشروع على Spark (functions مش بتتعملها deploy). البديل = **سكربت Node محلي** يتشغّل يدوي أو من Task Scheduler (وضع catch-up تزايدي).
- **مفيش تعديل firestore.rules** — السكربت بيكتب بالـ Admin SDK (بيتخطّى القواعد) وبيضيف حقول بس.

## نموذج البيانات المُضاف (additive فقط — مفيش rename/حذف)
على دوك الاستشارة:
```
medsStructured: { medications:[{name,canonical,dosage,frequency,raw_text}], actions:[{type,detail}] }
medsClassifiedAt: serverTimestamp ; medsClassifiedModel: "<model>" ; medsClassifiedEngine:"ollama-local"
```
`type` للـ action ∈ referral|follow_up|general_advice|other. **`nonDrugAdvice` ممنوع يتبعت للموديل** (boilerplate).

## السكربت: `meds-classify/` (جذر المشروع، جنب fb-classify)
`classify-meds.js` + package.json + .env.example + .gitignore + README.md.
- بيقرا كل `consultations`، يفلتر approved (`review.status==='approved' || status==='approved'`) وعنده `prescribedMeds` ومش متصنّف.
- **Resume:** بيتخطّى أي دوك عنده `medsStructured`؛ بيعمل commit لكل batch لوحده → أي crash يكمّل من مكانه.
- Batch ديفولت 5 (indexed `{"results":[{i,...}]}`)، ولو الشكل غلط بيرجع per-item تلقائي (الموديلات الصغيرة بتغلط في الـ batch).
- Ollama: POST `${OLLAMA_URL}/api/chat` بـ `format:"json"`, `temperature:0`. الخدمة الافتراضية `http://localhost:11434`.
- service account: GOOGLE_APPLICATION_CREDENTIALS → ./serviceAccount.json → **../fb-classify/serviceAccount.json** (فولباك، مش محتاج نسخ).
- فلاجز: `--dry-run --limit N --reclassify --batch N --model NAME --verbose`.
- **التشغيل:** `node classify-meds.js --dry-run --limit 25` للمعاينة، بعدين `node classify-meds.js` للباك فيل الكامل، وبعدها نفس الأمر = catch-up تزايدي.
- `AR_NORM` في السكربت مطابق للداشبورد (نفس تطبيع الهمزات/ة/ى) عشان الـ canonical key يتّفق.

## الداش بورد (`public/consult-analytics.html`) — ✅ اتعمل واتّتأكد (2026-07-05)
اتنفّذ بالكامل (14/14 اختبار منطق نجحوا، module script بيتفسّر، كل el() ليه id). المكوّنات:
1. aggregation يفضّل `medsStructured` ويرجع لـ `medTokens` legacy للدوكس غير المتصنّفة + بادج «🤖 N% مصنّف بالذكاء».
2. تقسيم كارت الأدوية → **Medications** (أسماء نضيفة + جرعة/تكرار + دريل per-symptom + أزواج co-prescription + trend صعود/هبوط لأعلى ~15) و**Actions** منفصل (referral/follow_up/general_advice/other).
3. كارت **رحلة العميل** (مفتاح `phone`/`customerCode`): نسبة العملاء المتكررين، فترة العودة، تكرار نفس العرض (قائمة flagged)، عملاء بتحذير/ريد فلاج متكرر، cohort retention شهري. محتاج قراءة كل الوقت (`ALLDOCS` cache) مش المدى بس.
4. depth: عدالة المراجعين، ارتباط زمن المراجعة↔التقييم، ساعات مقسّمة بالخطورة، كشف طفرات الأعراض. + CSV موسّع.
- الحقول اتأكّدت من **الطرف الكاتب** (agent.html/review.html مش قراءة الداشبورد): `review.status`(+mirror `status`), `review.rating`(+`rating`), `review.reviewerNotes`, `warning.active/note`, `followUp.status/result`, `confirmedRedFlags`(array)+`redFlagApplied`, `teamReviewed`, `symptoms:[{id,name,cat}]`, `customerCode`/`phone` (نص حر ممكن يبقى فاضي).

راجع [[github-memory-backup]] للنسخة على GitHub.

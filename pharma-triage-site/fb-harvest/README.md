# fb-harvest — سجل ردود فيسبوك + رسائل العملاء الدائم (محلي، مجاني)

سكربت محلي بيبني **سجل دائم في Firestore** لكل ردود الزملاء وكل رسائل العملاء، عشان الموقع يجاوب أي سؤال تاريخي (عدد ردود لكل زميل / لكل يوم / لكل فترة / تحليل طلب العملاء) **باستعلام Firestore بسيط — من غير ما يعيد مسح فيسبوك تاني أبدًا**. ده البديل الحي لشيت الإكسل القديم.

## ليه موجود
Graph API مابيسمحش تدوّر على المحادثات بالتاريخ — بيديك الأحدث الأول وبس. فالوصول ليوم قديم بيتطلب تقليب كل اللي بعده (بطيء + غير موثوق مع أي سقف). الحل: نحصد **مرة واحدة** في Firestore، وبعدها نقرا من Firestore.

## أمان
- **مابيلمسش `fbLog`** (سلوتات الورديات / الـ1840 كارت) ولا أي حاجة الموقع بيقراها للميزات الحالية. بيكتب في كولكشنات **جديدة** بس:
  - `fbReplies/{msgId}` — دوك لكل رد زميل بينتهي بهاشتاج.
  - `fbCustomerMsgs/{msgId}` — دوك لكل رسالة عميل + الكلمات/النوايا المستخرجة.
  - `appConfig/fbHarvest` — watermark + إحصائيات آخر تشغيلة.
- **Idempotent:** مفتاح الدوك = رقم الرسالة من فيسبوك، فإعادة التشغيل **مابتعدّش مرتين** (وده بيلغي مشكلة تكرار المحادثات من جذرها).
- **Resumable:** بيحفظ التقدّم على دفعات ويحرّك الـwatermark، فأي توقف (كراش/كوتة) بيكمّل التشغيلة اللي بعدها.
- مجرد عميل HTTPS (فيسبوك + Firestore) — مالوش علاقة بجهاز تاني ولا بيأثر على الموقع أو النت.

## إعداد (مرة واحدة)
1. حطّ `serviceAccount.json` في الفولدر ده (أو استخدم `GOOGLE_APPLICATION_CREDENTIALS`، أو بيرجع لـ `../fb-classify/serviceAccount.json` تلقائيًا).
2. `npm install`
3. التوكن + pageId بيتقروا حيًّا من `appConfig/fbLiveConfig` (نفس مكان الموقع) — اتأكد إن التوكن صالح.

## الاستخدام
```bash
# باكفيل عميق مرة واحدة (بلا سقف) — بيقلّب لحد اليوم ده. سيبه بالليل.
node harvest.js --backfill --until 2026-05-01

# باكفيل من أول الصفحة خالص
node harvest.js --backfill --all

# تزايدي (الجديد بس منذ آخر تشغيلة) — ثواني. شغّله على جدول (Task Scheduler).
node harvest.js

# معاينة من غير كتابة
node harvest.js --dry-run --until 2026-07-01

# لوج تفصيلي لكل محادثة
node harvest.js --verbose
```

## التشغيل على جدول (اختياري)
اعمل Task في Windows Task Scheduler يشغّل `node harvest.js` كل ساعة مثلًا (نفس فكرة edara daemon). التزايدي خفيف وبيعالج الجديد بس.

## توسيع كلمات العملاء
عدّل `keywords.js` — ضيف منتجات أو كلمات نوايا في أي قايمة وأعد التشغيل. مفيش AI مدفوع، كله قاموس محلي مجاني.

## الحقول
**fbReplies:** `{msgId, convId, ts, date, ym, agentTag, agentName, isOrder, text}`
**fbCustomerMsgs:** `{msgId, convId, ts, date, ym, custName, text, intents[], products[], keywords[]}`
**appConfig/fbHarvest:** `{lastTs, lastRunAt, lastMode, backfilledFrom, lastStats}`

# Pharma Triage — نسخة كاملة (كود الموقع + السياق) على GitHub

نسخة محمولة من مشروع **Pharma Triage** عشان تتوصل من أي جهاز (مش بس الهارد البورتابل)، وتشتغل عليها من Claude Code أو من claude.ai.

**اتضاف هنا (2026-07-06):** كود الموقع نفسه (`pharma-triage-site/public/`) + إعدادات Firebase (`firebase.json`, `firestore.rules`, `firestore.indexes.json`) + سورس الـCloud Functions — مش بس الذاكرة زي الأول.

> ⚠️ **ممنوع تتحط في الريبو ده (عام/public) أي أسرار أو بيانات عملاء حقيقية:** `serviceAccount.json`، أي `.env`، ملفات إكسيل عملاء، `node_modules`، نماذج Ollama الضخمة، أو أي build outputs (زي `windows-agent/releases`). دي كلها **مستبعدة عمدًا** ومحتاجة تتضاف يدويًا/محليًا لو حد شغّال بيها.

## المحتوى
- **`pharma-triage-site/CLAUDE.md`** — ذاكرة المشروع الأساسية (Claude Code بيقراها كل سيشن).
- **`pharma-triage-site/public/`** — كود الموقع الكامل (HTML/JS/CSS، مفيش build step). ده بالظبط اللي منشور على Firebase Hosting.
- **`pharma-triage-site/firebase.json` / `firestore.rules` / `firestore.indexes.json`** — إعدادات Firebase.
- **`pharma-triage-site/functions/`** — سورس الـCloud Functions (`facebook.js`, `index.js`) بلا `node_modules`.
- **`memory/`** — ملاحظات ذاكرة إضافية + `MEMORY.md` الفهرس.
- **`meds-classify/`** — سكربت استخراج الأدوية المُهيكل (Ollama محلي، مجاني). شوف `meds-classify/README.md`.

## الاستخدام على جهاز تاني
```
git clone https://github.com/drshawky26/claude
```
- شغّل Claude Code جوّه `claude/pharma-triage-site/public` — هيقرا `CLAUDE.md` تلقائي (لأنه أب لمجلد `public`).
- عشان تعمل `firebase deploy` من الجهاز ده، محتاج `firebase login` بحسابك + الوصول لمشروع `pharma-triage-5d165` (مش جزء من الريبو).
- للـ classifier: انسخ `meds-classify/` جوّه المشروع، `npm install`، وظبّط الـ serviceAccount بنفسك (شوف الـ README بتاعه) — الملف الحقيقي **مش** هنا.

## ملاحظة عن الفجوة
النسخة هنا **مرآة (mirror) بتتحدّث يدويًا** لما حد يعمل push جديد — مش sync لحظي مع الهارد البورتابل. لو عندك شك إن نسخة GitHub قديمة، قارن بتاريخ آخر commit مع تاريخ آخر تعديل محلي.

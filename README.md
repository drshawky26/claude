# Pharma Triage — Claude memory / context backup

نسخة محمولة من سياق مشروع **Pharma Triage** عشان Claude Code يشتغل من أي جهاز.
**مش** كود الموقع الكامل — ده السياق والذاكرة بس (بلا أسرار، بلا بيانات إكسيل).

## المحتوى
- **`CLAUDE.md`** — ذاكرة المشروع الأساسية (Claude Code بيقراها كل سيشن). انسخها لجذر مشروع pharma-triage على الجهاز الجديد.
- **`memory/`** — ملاحظات الذاكرة + `MEMORY.md` الفهرس.
- **`meds-classify/`** — سكربت استخراج الأدوية المُهيكل (Ollama محلي، مجاني). شوف `meds-classify/README.md`.

## الاستخدام على جهاز تاني
```
git clone https://github.com/drshawky26/claude
```
- حطّ `CLAUDE.md` في جذر مشروع pharma-triage (أب لمجلد `public`).
- اقرا `memory/` للسياق الجاري.
- للـ classifier: انسخ `meds-classify/` جوّه مشروع pharma-triage، `npm install`، وظبّط الـ serviceAccount (شوف الـ README بتاعه).

> ⚠️ ممنوع تحطّ في الريبو ده أي أسرار (serviceAccount.json، توكنات، .env) — الريبو ممكن يتشاف.

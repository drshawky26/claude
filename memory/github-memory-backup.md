---
name: github-memory-backup
description: The project memory/context is mirrored to a GitHub repo for cross-device use
metadata: 
  node_type: memory
  type: reference
  originSessionId: bb23aafd-54d8-455a-9068-1a33c3d748af
---

# Memory backup on GitHub

المستخدم (drshawky530@gmail.com) عايز الميموري/السياق يكون على GitHub عشان يشتغل من أي جهاز.

- **الريبو:** https://github.com/drshawky26/claude
- **بيتضمّن:** `CLAUDE.md` (نسخة من public/CLAUDE.md) + `MEMORY.md` + مجلد `memory/` + كود `meds-classify/` (من غير node_modules ولا serviceAccount ولا .env).
- **مبيتضمّنش:** كود الموقع الكامل ولا ملفات .xlsx (بيانات شغل) ولا أي أسرار — عشان GitHub بينشر المحتوى.
- **تحديث من أي جهاز:** `git clone https://github.com/drshawky26/claude` بعدين نسخ `CLAUDE.md` لجذر مشروع pharma-triage، أو قراءة `memory/` للسياق.

مرتبط: [[meds-structured-pipeline]].

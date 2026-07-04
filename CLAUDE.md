# Pharma Triage — Project Memory

> سياق دائم يتنقّل مع فولدر المشروع على الهارد البورتابل. Claude Code بيقرا الملف ده تلقائياً كل سيشن من أي جهاز (لأنه في جذر المشروع، أب لمجلد العمل `public`). حدّثه لما يتغيّر حاجة مهمة. **ممنوع كتابة كلمات سر أو أسرار هنا.**

## نظرة عامة
موقع triage صيدلي بالعربي (RTL). الواجهة HTML/CSS/JS صريح (مفيش build step)، وكل صفحة بتستورد Firebase (Auth + Firestore) inline. الكونفيج العام موجود في كل ملف HTML (apiKey عام — عادي). مجلد العمل: `public/` (هو المجلد المنشور). جذر المشروع: `pharma-triage-site/` (فيه `firebase.json`, `firestore.rules`, `functions/`).

- الأدمن: `drshawky530@gmail.com` (Dr. Mahmoud Shawky).
- الدخول بالأرقام يتحوّل لـ `agent{N}@pharma.local`.
- دورة الشهر الافتراضية للتقارير: **21 → 20** (مش الشهر التقويمي).

## الصفحات المهمة
- `review.html` — المراجعون بيراجعوا الاستشارات ويحطّوا تقييم نجوم (`review.rating` 1–5).
- `agent.html` — زملاء الكول سنتر بيعملوا الاستشارات.
- `reviewer-stats.html` — داش بورد المراجعين (أدمن/صلاحية). فيه توزيع أرقام الكول سنتر + Top 5 أفضل تقييماً.
- `my-cc-stats.html?team=callcenter` — صفحة المراجع الشخصية (نطاقه + بوديوم Top 2 تقييماً).
- `agent-stats.html` — إحصائيات الزملاء + Top 5 أفضل تقييماً.
- `admin.html` — إدارة المستخدمين والصلاحيات (toggles زي `canViewReviewerStats`).

## نموذج البيانات — نقاط حرجة
**أرقام الكول سنتر لها تمثيلان مختلفان:** رقم الدخول (داخل `agent{N}@pharma.local`) **غير** الرقم المطبوع على الاستشارة (مثل `166C.C`، المخزّن في `agentNumber`/`agentLabel`). أي تجميع per-رقم لازم يطابق على **اتحاد كل التمثيلات** (الدالة `consultNumCandidates`/`consultNumCandidatesRS`: agentNumber + رقم الدخول من الإيميل + رقم البروفايل + الأرقام جوه الـ label). الربط الموثوق: للمراجع = `review.reviewerEmail`؛ لزميل الكول سنتر = اتحاد تمثيلات الرقم أو `agentEmail`.

**توزيع الأرقام على المراجعين:** مخزّن في Firestore `appConfig/ccAssignments`، **مفتاحه token ثابت للمراجع** (لأن إيميلات المراجعين بتتغير شهرياً والأسماء ثابتة). الأدمن يعدّله من `reviewer-stats.html`. فيه fallback افتراضي `CC_DISTRIBUTION` في الكود + لوحة "الأرقام النشطة في الفترة" تساعد الأدمن يطابق الأرقام الحقيقية.

**حالات الاستشارة:** `review.status` (approved / needs_more_info / needs_followup …)، `review.incomplete`, `warning`, `followUp`. التقييم: `review.rating` (1–5، 0 = غير مقيّمة).

## ميزة "أفضل زميل تقييماً" (جايزة آخر الشهر)
ترتيب زملاء الكول سنتر بجودة استشاراتهم بـ **متوسط مرجّح (Bayesian)** — مش المتوسط الخام — عشان اللي عمل 2 استشارة 5★ ما يتصدّرش على اللي عمل 40 بمتوسط عالي:

```
score = (C*m + مجموع_النجوم) / (C + n)
```
- `m` = متوسط كل الاستشارات المقيّمة في الفترة، `n` = عدد المقيّمة للزميل، `C = RATING_CONFIDENCE = 8`.
- **بس الاستشارات المقيّمة بتُحسب** (يحل مشكلة "اشتغل بس المراجع ما راجعش بعد" — مفيش حد أدنى صارم).
- الإنتاجية (المفروض 23 استشارة/شهر) جودة منفصلة، **مش** بتتخلط في النقاط.
- **خصم الاعتماد على تيم الاستشارات (agent-stats فقط، 2026-06-21):** الاستشارة اللي عليها بادج «تم مراجعة تيم الاستشارات» (الحقل `teamReviewed===true` على دوك الاستشارة) بتقلّل تقييم الزميل في `renderBest5AS`. القاعدة: `final = composite − WARN_STRENGTH·warnRate − TEAM_REVIEW_STRENGTH·teamRate` حيث `teamRate = عدد teamReviewed ÷ الإجمالي` و `TEAM_REVIEW_STRENGTH = 0.5`. خطّي (نسبة)، فالاعتماد الكامل على التيم = خصم 50 نقطة؛ اللي بيعتمد على نفسه بيتقدّم على اللي بيراجع نفس العدد مع التيم. العداد `teamReviewed` بيتجمّع في خريطة الزملاء (`map`) جنب `warning`. ظاهر في صف التوب كـ «👥 N مراجعة تيم (−P)».

الأماكن: `my-cc-stats` (بوديوم Top 2 لأرقام المراجع، `renderMyStars`) · `reviewer-stats` (Top 5 تفصيلي، `renderBest5`) · `agent-stats` (Top 5، `renderBest5AS`).
**الفترة:** reviewer-stats و my-cc-stats بدورة 21→20 (نطاق تاريخ الصفحة). agent-stats: بوكس التقييم اتظبط على دورة 21→20 (مستقل عن فلتر الشهر التقويمي بتاع باقي الصفحة).

## الأسئلة الشرطية (محرر الأسئلة في admin.html)
سؤال ممكن يظهر فقط لما إجابة سؤال آخر = قيمة (`showIfQuestion` + `showIfValue`). حقل `showIfValue` بيقبل **أكثر من قيمة مفصولة بفاصلة** (عربي/إنجليزي) مثل `كالسيوم، فيتامين D3` → السؤال يظهر لو الإجابة أي واحدة منهم. المنطق متكرر في 3 أماكن: `admin.html` (معاينة) + `agent.html` (مكانين — النموذج الفعلي). أي تعديل على المطابقة لازم يتعمل في التلاتة.

## أخطاء اتصلحت (تاريخ)
- `reviewer-stats.html` كان فيه `currentProfile` غير معرّف بيكسر تحميل البيانات للمراجعين غير الأدمن (الـ `||` على الإيميل كان بيخفيه عن الأدمن). اتصلح بمتغير `profileRole`. **الدرس: اختبر بحساب غير أدمن.**

## اختبار
فيه حساب أدمن للتجربة (الباسورد مش مكتوب هنا لأسباب أمنية — اسأل المستخدم). قراءة `consultations` من Firestore بتتطلب تسجيل دخول (الـ rules بتمنع المجهول).

## fb-live.html — معمارية الريديزاين (2026-06-08)
الصفحة بقت **Single-Page Tab App** بدوك ماك عمودي ملوّن على اليمين. خط **Tajawal**.

**Shell:**
```
#gate (overlay — خارج الـ shell)
<div#appShell class="app-shell">
  <aside#sideNav class="dock"> … </aside>
  <div class="app-col"> [#mainHdr] [#appView] </div>
</div>
```
CSS classes على `#appShell`: `app-ready` (يظهر الدوك) · `admin-on` · `super-on`.

**Tab system:** كل `.dock-item[data-view="X"]` يضبط `#appView[data-view=X]` → CSS يظهر `#s-X` بس. Default view = `home` = `#s-kpis` + `#s-inbox`. Views: home · abandoned · posts · comments · volume · team · replies(admin) · config(super).

**Role gating:**
- `SUPER_ADMIN = "drshawky530@gmail.com"` (ثابت في الكود).
- `isSuperAdmin` → `super-on` class → يظهر `.dock-super` (config icon) + `#s-config`.
- `isAdmin` → `admin-on` class → يظهر `.dock-admin` (replies icon).
- لو التوكن ناقص وغير super: رسالة «راجع الأدمن (د. شوقي)» في `doRefresh`.

**قيود صارمة:**
- ممنوع تغيير/حذف IDs: `appView`, `mainHdr`, `s-*`, `themeBtn`, `hdrAv`, `refreshBtn`, `vRateArc`, `vRate2`, `vInL`, `vOutL`, `vMissL`.
- الأرقام تفضل `toLocaleString("ar-EG")` — تحسين الشكل بـ CSS فقط.
- `navRefreshBtn` / `navThemeBtn` بيعملوا `.click()` على `refreshBtn` / `themeBtn` الأصليين.
- ممنوع letter-spacing على النص العربي.

**اتشال:** قسم إنستجرام + دالة `fetchInstagram` + استدعاؤها من `Promise.all`.

**اتضاف:** حلقة SVG دائرية (`#vRateArc` stroke-dashoffset) لمعدل الاستجابة بدل الشريط القديم (`#vRateBar`).

## agent.html — دارك مود + لاينر + فلتر زمني (2026-06-14)
الصفحة فيها دارك مود كامل (`html[data-theme="dark"]` + بوت‌سترَب في `<head>` يمنع الوميض، مفتاح `pt-theme` في localStorage) + جرس تنبيهات + استشاراتي السابقة (`v138`). نقاط حرجة للتعديل من أي جهاز:

- **الأيقونات:** استخدم **إيموجي/محرف نصي** للأيقونات المضافة حديثًا — بيئة العرض عند المستخدم (Win web-view) مكانتش بترندر inline-SVG الجديد (بيظهر فاضي). الـ SVG القديم شغّال.
- **الفلتر الزمني (من تاريخ→إلى تاريخ):** كارت `.v138-mc-timerange` بيفتح `.v138-date-panel` (حقلين flatpickr، `dateFormat:'U'`). دوال على `window`: `v138ToggleDatePanel`/`v138ApplyDateRange`/`v138ClearDateRange`/**`v138ThisCycle`** (زر «هذا الشهر 21→20» — بيحسب الدورة حسب تاريخ اليوم: يوم≥21 → 21 الشهر الحالي لـ20 الجاي، غير كده → 21 اللي فات لـ20 الحالي). الفلترة في `renderMyConsultations` عبر `v138DateFrom/v138DateTo`. مستايل light+dark.
- **اللاينر المتحرك (conic-gradient ring):** نظام موحّد عند بلوك «PREMIUM ANIMATED LINER» — `@property --liner-angle` + `@keyframes liner-rotate`، ماسك ring بـ `mask-composite:exclude`. **استراتيجية الأداء:** الحاويات المفردة الكبيرة (`.base-intake-section`, `.v138-history-panel`) بتلف باستمرار ببطء؛ الكروت المتكررة (`.q-card`, `.v126-live-card`) بتلف **عند الـ hover/focus بس** عشان الصفحة ماتشيلش عشرات الأنيميشنز الحية. مرجع نفس الفكرة: `.cat-section` (`--cat-angle`).
- **جوتشا specificity في الدارك:** قاعدة عامة زي `html[data-theme="dark"] .choice` تخصيصها (0,2,1) **أعلى** من `.choice.active` (0,2,0) → بتلغي الحالة المختارة. لازم قاعدة دارك خاصة بالـ active بتخصيص أعلى (`html[data-theme="dark"] .choice.active`، ويُفضّل `!important`). نفس المبدأ متوقع في أي `.x.active` تحت أوفررايد دارك عام. كمان `v132-date` في الدارك محتاج لون نص صريح (التوكن `--muted` باهت).

## cc-ops.html — صلاحيات التابات + دارك مركز عمليات + تحليل الأقسام (2026-06-21)
- **دارك افتراضي** (مركز عمليات نظيف — **مش بورصة**؛ المستخدم رفض الشموع/الأعمدة/التيكر المتحرك). bootstrap ثيم في `<head>` (مفتاح `pharmatheme`)، أرقام مونو `--mono` + `tabular-nums`.
- **صلاحيات لكل تاب:** دوك `appConfig/ccTabGrants` = `{cc/med/cos:{exts,emails}}`. `window.ALLOWED_TABS` (null=بيتحقق/[]=ممنوع/مصفوفة). `computeAllowedTabs(u)` بعد الأوث: الأدمن `drshawky530@gmail.com` يشوف الكل؛ غير مسجّل = ممنوع؛ غيره = اتحاد منحه. `render()` ببوابة `setPageGate('check'|'denied'|'ok')` (عنصر `#pageGate`). إدارة من تاب «الصلاحيات» في الدرج = **مصفوفة ٤ أعمدة** (🏥cc·💊med·💄cos·⚙️sheet) عبر `permWrite/togglePerm/loadPermissions`. **تنبيه:** `ccOpsData/ccOpsMonths` قراءتها عامة في الـ rules → القفل تحكّم واجهة مش حاجز بيانات.
- **تابات med/cos = تحليل استشارات مستقل تمامًا عن الكول سنتر** (طلب صريح). المصدر `analytics-data.json` عبر `fetch` (`loadAnalytics`→`window.ANALYTICS_DATA`). الخريطة: med→customer(110)+internal(111)، cos→cosmetic(107، لسه مفيش ملف). الدوال: `DEPT_DS`/`analyticsMonth`/`deptDatasets`/`deptCommandCenter(cfg,datasets)`/`renderDeptDataset`. **ممنوع** رجوع أرقام القسم لـ CCBRANCH/excluded.
- تحسينات تابات: سهم اتجاه ▲▼، تذكّر آخر تاب (`ccops-last-tab`)، تنقّل ←→ + swipe.

### cc-ops.html — فصل اللايف عن أرشيف الشهور + رفع من الموقع + داش لايف بريميوم (2026-06-24)
**المشكلة الأصلية:** سكربت اللايف (`--watch` ترِيجر) ورفع `build-cc-ops.py` كانوا **الاتنين بيكتبوا `ccOpsMonths/{ym}`** بنفس مفتاح الشهر → اللايف الجزئي كان بيدوس على الشهر الكامل اللي الأدمن رفعه («اللايف بيمسح الشهر»). الحل = **فصل تام**:
- **أرشيف الشهور (`ccOpsMonths/{ym}` + فهرس `ccOpsData/monthsIndex`):** مصدره **رفع من الموقع بس** (أدمن). `build-cc-ops.py` بقى **بيطلّع `cc-ops-data.json` فقط** (الـ push اتعطّل، والملف بقى بيضم `branches` كمان). الأدمن يرفعه من زرار «⬆ رفع شهر» جنب الدروب ليست → `handleMonthUpload` يكتب `ccOpsMonths/{ym}` لكل شهر + يدمج `monthsIndex` (union على ym) + `ccOpsData/branches`. `loadFromFirestore` بيقرا `monthsIndex` ويحمّل الشهور (lazy عبر `findMonthKey`).
- **منتقي الشهر بقى دروب ليست** (`.month-sel` في `buildMonths`) بدل أزرار seg — بتعرض كل الشهور مرتّبة بـ ym، + زرار الدورة (٢١→٢٠) + «مدى مخصص» وقت فلتر التاريخ. `applyDateFilter`/زرار الدورة بينادوا `buildMonths()` للتزامن.
- **اللايف معزول في `edaraLive/{التاريخ}`** (مش `edaraLive/today`). `build-cc-ops-live.py` **مابيكتبش ccOpsMonths نهائياً**؛ بيقرا `liveDate` من `edaraControl/config` (الأدمن بيختار اليوم من **منتقي التاريخ فوق الداش**، `ledSetDate`)، بيسحب اليوم ده + **توزيع ساعي ٢٤ ساعة** (`fetch_hourly`، للنهاردة لحد الساعة الحالية بس)، ويرفعه. تشغيل: `python build-cc-ops-live.py --live`. `main()` بقى تشغيلة واحدة ليوم اللايف.
- **الداش اللايف ريديزاين بريميوم** (`renderLiveEdara`): شريط ملخّص (`led-hero`: إجمالي/نسبة رد/مهجور/ساعة الذروة) + ٤ كروت ورديات كل واحدة فيها **شرايط توزيع ساعي** (`ledHourBars` + `EDARA_SHIFT_HOURS`، الساعة الجارية مميّزة بالدهبي). أرقام `ar-EG`+`tabular-nums`. تزامن اليوم لكل المشاهدين عبر `liveDate` في snapshot الـ config. القواعد جاهزة (ccOpsData/ccOpsMonths عام-قراءة/أدمن-كتابة؛ edaraLive قراءة-بتسجيل/أدمن-كتابة).
- **تابات med/cos مستقلة تماماً** (من `analytics-data.json`) — اللايف بيكتب في `#ledCards` بس، مايلمسش CCOPS_DATA ولا ANALYTICS_DATA.

### cc-ops.html — لايف لكل قسم + تسمية الشهر من ym (2026-06-24، تكملة)
- **🐞 «رفع يونيو مجاش له خانة»:** السبب إن `build-cc-ops.py` بيسمّي الشهر من مفتاح `MONTHLY_FILES` (ثابت غلط = «مايو ٢٠٢٦») بينما ym بيتحسب من تواريخ الداتا (2026-06) → كل رفعة بتدخل نفس الخانة. **الحل: الاسم بقى يتحسب من ym دايماً** عبر `_ymLabel(ym)` (مصدر العرض الموثوق) — الدروب ليست والـ index والـ docData.ar كلهم بياخدوا الاسم من ym، فأي اسم غلط في السكربت بيتجاهل. (الموجود: `ccOpsMonths` فيه 2026-05 و2026-06؛ `monthsIndex` كان فيه واحد بس.)
- **لايف لكل قسم (إضافي تماماً — الكول سنتر ما اتلمسش):** البانر بقى **حسب التاب**: cc=الكول سنتر (نفس الكود/الدوك بالظبط) · med=الاستشارات الدوائية · cos=الكوزمو.
  - **السكربت** (`build-cc-ops-live.py`): `Edara.count` خد باراميتر `queue=""` (ديفولت=كل الطوابير=سلوك الكول سنتر الأصلي). `DEPT_QUEUES={med:[110,111],cos:[107]}` + `fetch_dept_day`/`fetch_dept_hourly`. `push_live` بيضيف حقل **`doc["depts"]={med,cos}`** بعد ما يبني دوك الكول سنتر، **ملفوف في try/except** فلو القسم فشل الكول سنتر بيترفع زي ما هو. (تنبيه: بيزوّد طلبات Edara/دورة — أبطأ بس مايأثرش على دقة الكول سنتر.)
  - **الصفحة:** `renderLiveEdara` اتقسمت — `_buildLiveHTML(payload,isToday)` (هيرو+كروت، نفس عرض الكول سنتر) + `_liveView()` (من `CUR_TAB`) + `LIVE_VIEW_META`. payload = `data` للـ cc أو `data.depts[view]` للأقسام؛ لو مفيش بيانات قسم → رسالة «لسه مفيش لايف». كاش `_lastLiveData` + `refreshLiveView()` بتتنده من `render()` بعد `buildTabbar()` عشان البانر يتحدّث عند تبديل التاب. شارة `#ledView` بتوضّح القسم المعروض.
- **تنبيه:** تاب الاستشارات (med/cos) نفسه = تحليل **شهري** من `analytics-data.json` (build-analytics.py) ومنفصل عن لايف القسم؛ لو ظهر «داتا قديمة» يبقى الملف ده محتاج إعادة بناء بتقارير الشهر الجديد.

## call-analytics.html — مصدر تحليل الاستشارات (المستخدم عاجبه؛ سيبه زي ما هو غير المضاف تحت)
- **الـ pipeline:** حُط `june report customer .xlsx` (عملاء/110) + `june report internal .xlsx` (موظفين/111) **جوّه `public/`** وشغّل **`python build-analytics.py`** → بيكتب `analytics-data.json` + يحقن `// DATA_START/END` في call-analytics.html. نفس الملف ده بيغذّي تابات med في cc-ops. (التجميلية 107 = أضِف ملف cosmetic وعدّل `MONTHLY_FILES`.)
- **فلتر الفترة الزمنية (2026-06-21):** بار `.ca-dfbar` في `#monthRow` (حقلين from→to + تطبيق + الكل) عبر `buildDateBar`. التصفية بدالة `dsView(d)` (تصفّي `totals`+`days` فقط بمقارنة ISO نصية)؛ `renderDataset`/`renderCompare` بيلفّوا الداتا بـ `dsView`. **قيد:** الشيفتات/الزملاء/المؤشرات تجميع شهري مش يومي → بيفضلوا للشهر كامل (نوت `.ca-df-note` بيظهر وقت التصفية). لتصفية الشيفتات بالتاريخ لازم build-analytics.py يطلّع تفصيل يومي-لكل-شيفت من شيت Daily Summary.

## فيسبوك (facebook.html / my-fb.html / fb-live.html) — نموذج البيانات (2026-06-21)
- **`fbLog` = المصدر الوحيد للسلوتات والكروت والإحصائيات** (بورد الفريق + الداش بورد اللحظي + إحصائيات الزملاء بتقرا منه). الدوك: `{date, ym, agent, channel, fromTime, toTime (السلوت المقرّر), actualFrom, actualTo, messages, orders, note, by, at}`.
- **مجموعة `fbShifts` اتهجرت** — كانت بتسبّب كارت مكرّر: الأدمن يسجّل سلوت في `fbShifts` لكن دمج my-fb بيدوّر في `fbLog` بس فيعمل كارت جديد. الحل: `saveShift` في facebook.html بقى يكتب في `fbLog` (channel:""، من غير actual)، وجدول الورديات في facebook + `listenShifts` في my-fb بيقروا `fbLog`. الدمج في my-fb (`saveEntry`) بيلاقي السلوت `(fromTime||toTime) && !actualFrom && !actualTo` ويكمّله بدل كارت جديد. (لسه فيه `const FB_SHIFTS` ميّت في facebook.html.)
- **تحليل ردود الزملاء بالهاشتاج** (`extractAgentTag` + `AGENT_TAGS`، الهاشتاج لازم في **آخر** الرد): موجود في fb-live (`analyzeAgentReplies`، أدمن) و my-fb (`analyzeMyReplies`). بيجيب المحادثات بـ `/conversations` (مرتّبة updated_time تنازلي) وبعدين رسائل كل محادثة وبيعدّ رسائل الصفحة اللي بتنتهي بهاشتاج الزميل داخل [from,to] بتوقيت القاهرة (`+03:00`).
- **🐞 باگ اتصلّح (2026-06-21):** كان بيفلتر المحادثة بـ `updated_time <= toMs` → أي محادثة اتحدّثت بعد الفترة (العميل ردّ تاني) بتتشال ومعاها رد الزميل داخل الفترة → **نقص كبير، خصوصاً للفترات القديمة** (سبب «مختلف تماماً عن المانويل»). **القاعدة الصح:** `updated_time` بيستخدم بس للحد الأدنى/إيقاف الـ paging (`< fromMs → break`)؛ ضِم أي محادثة `>= fromMs` وسيب فلترة `created_time` لكل رسالة تظبط الحد الأعلى. اتطبّق في الصفحتين.
- **المتركس:** اللايف بيعرض «محادثات» (convs مميّزة = الرقم الكبير اللي بيترتّب عليه) و«ردود» (إجمالي رسائل الرد). my-fb بقى يحسب الاتنين، بيعرضهم في حالة التحليل، و**بيخزّن «المحادثات» في خانة `messages` بتاعة الكارت** عشان يطابق رقم اللايف الكبير.

### facebook.html — تنسيق + فترة + شفت كل زميل + داش بورد تفصيلي (2026-06-22)
- **العرض اتضيّق:** `--maxw` 1160→**980**؛ هوامش السكاشن 30→24.
- **بانر فترة فوق الصفحة** (`.period` + `#periodDates`): بيعرض «من→إلى» الفترة الحالية. الديفولت = **دورة تبدأ يوم ٢٠** عبر `cycleFrom20()` (يوم≥٢٠ → ٢٠ الشهر ده لـ اليوم، غير كده → ٢٠ اللي فات). `updatePeriodBanner()` بيحدّثه. (ملحوظة: ده ٢٠ مش ٢١ — طلب صريح للمستخدم لتيم الفيسبوك.) **[متجاوَز:** أقسام مايو الستاتيك اتشالت في التصحيح تحت.]
- **الداش بورد اللحظي:** الديفولت بقى شِب «هذه الدورة (٢٠→)» (`lvCycle`)؛ اتضاف لـ `setLvActiveChip`. «هذا الشهر» اترمّز لـ «الشهر التقويمي».
- **قسم الورديات بقى «معاد شفت كل زميل» للقراءة فقط:** **اتشال فورم «تسجيل وردية» بالكامل** (طلب المستخدم — السلوتات بتتسجّل من «إدخال مباشر»). اتشالت `saveShift`/`onShiftTimeChange`/`fillShiftAgentSelect`/`const FB_SHIFTS` الميّت. `listenShifts()` بقى يقرا `fbLog` على **مدى الفترة الحالية** (lvFrom..lvTo، بيتعاد عند تغيير الفترة من `setRange`) ويفلتر الصفوف اللي ليها سلوت زمني، مرتّب بالزميل ثم التاريخ/الوقت مع تجميع بصري للاسم. (facebook **مابقاش** يكتب سلوتات لـ fbLog — الكتابة من «إدخال مباشر» و my-fb بس.)

### facebook.html — تحوّل لداش بورد لايف من ردود فيسبوك + إصلاح عدّاد my-fb (2026-06-22، تصحيح للقرار اللي فوق)
- **القرار الجديد (المستخدم صحّح المسار):** facebook.html و fb-live.html **بيخدموا بعض**. facebook **اتحوّلت لداش بورد تفصيلي بيقرا من نفس تحليل ردود الزملاء بالهاشتاج بتاع fb-live** (`analyzeAgentReplies`)، مش من إدخالات `fbLog` اليدوية (أرقام الإدخال اليدوي كانت غلط). **اتشالت بالكامل** أقسام مايو الستاتيك (peak/team-May/orders) + المصفوفات `PEAK/ORDERS/TEAM_MAY` + دوالها + الجدول التفصيلي القديم (`renderLiveTeam`/`_livePer`/`setupLiveTeamSort`) — مايو كانت من شيت يدوي مش موثوق.
- **آلية التحليل في facebook (port من fb-live):** `GV`/`fbToken`/`fbPageId` من `appConfig/fbLiveConfig` (نفس دوك اللايف، التوكن بيتحط من صفحة اللايف للسوبر أدمن فقط)، `gFetch`، `AGENT_TAGS`، `extractAgentTag`، `analyzeAgentReplies()` → `renderAnReplies()` + `renderAnDetail()`. بار فوق الصفحة (`#anBar`: anFromDate/anFromTime/anToDate/anToTime + زرار `#anFetchBtn` + شِبّات anCycle/anToday/anYesterday). **بيشتغل بالضغط بس** (مش أوتو عشان تقيل). النتيجة في قسم `#replies` (KPIs + جدول محادثات/ردود/% لكل زميل + منتقي تفاصيل). `#periodDates` بيتحدّث من anFromDate→anToDate عبر `updatePeriodBanner()`.
- **السجل اليدوي اتبسّط:** كارت «داش بورد لحظي» بقى «السجل اليدوي للسلوتات» (KPIs + قنوات + آخر إدخالات بس، من غير جدول per-agent). اتشال تلميح «الصفحة استقبلت ≈ N» من فورم الإدخال (`onTimeChange`/`calcMsgsInWindow`/`loadLiveHourly`/`_liveByHour`).
- **🔑 إصلاح my-fb.html «جيب عدد ردودي» (مهم):** كان بيجيب +٨٠٠ محادثة (كل اللي اتحدّثت بعد بداية الفترة) ويفحصها رغم إن الزميل رد في ربع ساعة → بطيء جداً. الحل في `analyzeMyReplies`: ضِفنا `if(t>toMs) continue;` في حلقة جمع المحادثات → بيقتصر على المحادثات المتحدّثة **جوّه الفترة الفعلية بس** (`actualFrom→actualTo`). **trade-off مقبول للصفحة الشخصية:** محادثة الزميل رد فيها داخل الفترة لكن العميل ردّ بعدها (updated_time بعد toMs) هتتفوّت — بس أسرع بكتير وطلب صريح. كمان **اتشال تلميح «الصفحة استقبلت ≈ N»** بالكامل (`onActualTimeChange`/`calcMsgsInWindow`/`loadLiveHourly`/`_liveByHour` + عنصر `#msgHintLbl`).
- ⚠️ ملاحظة: الجدول التفصيلي من `fbLog` اللي اتعمل أول النهار (`renderLiveTeam` إلخ) **اتشال** — لو دوّرت عليه مش هتلاقيه.

### facebook.html — كروت السلوتات + موديل + إصلاح Cloud Function (2026-06-22، تكملة)
- **🐞 إصلاح `functions/facebook.js` (يحتاج `firebase deploy --only functions`):** الـ sync كان بيكسر كله ويظهر «حالة الربط ✗ خطأ: …published_posts → 100 The value must be a valid insights metric». السبب: طلب `published_posts` بحقل `insights.metric(post_impressions_unique)` (ميتريك مهجور) **من غير try/catch** فأول استدعاء يرمي ويوقف كل الـ sync. الحل: الطلب بقى best-effort — `POST_BASE_FIELDS` لوحدها، ولو الطلب-بالـ-insights فشل بيعيد من غير reach، وكله ملفوف في try/catch فالـ sync بيكمّل (page+inbox+status=ok). تحليل «ردود الزملاء» الجديد **مايعتمدش** على الـ sync ده أصلاً (بيستخدم /conversations مباشرة).
- **قسم الورديات بقى كروت + موديل (طلب المستخدم: «كارت مش صف»):** اتشال جدول `#shiftsTbl` → بقى كروت `#shiftsCards` (`.slot-card`، شريط جانبي أخضر=مكتمل/أصفر=بانتظار). كل كارت click → موديل `#slotModal`.
- **رجع تسجيل السلوت (`saveSlot`):** اللي اتشال السيشن اللي فات رجع بشكل أخف — فورم `#shAssignCard` (أدمن): تاريخ+زميل+سلوت من/لـ → بيكتب دوك `fbLog` (channel:""، من غير actual/messages). ده بيخلّي **الكارت يظهر للزميل في my-fb** (الدمج بتاعه بيكمّله) — وده كان «الكارت اللي راح» لما اتشال `saveShift`. `fillShiftAgentSelect` رجعت + بتتنده من `loadRoster`.
- **الموديل** (`openSlotModal`/`closeSlotModal`/`smFetchReplies`/`smSave`): بيسجّل بدأ/انتهى فعلي + زرار «جيب عدد الردود» جوّاه (`countAgentReplies(tag,fromMs,toMs)` — نفس منطق التحليل بس لزميل واحد، بـ `if(t>toMs) continue` للسرعة) + حفظ بـ `setDoc(merge)` على دوك السلوت (actualFrom/actualTo/messages). `NAME_TO_TAG` من AGENT_TAGS. الحفظ متاح للأدمن أو صاحب الدوك (`r.by===fbEmail`).

### my-fb.html — كروت ورديتي + موديل + إصلاح دروب الدارك (2026-06-22)
- **«ورديتي اليوم» بقت كروت كليكابل بنفس شكل facebook** (طلب صريح: السلوت اللي الأدمن سجّله يروح للزميل بنفس الكارت ويتفتح موديل بدل ما يكتب فوق): اتشال جدول `#myShiftsTbl` → `#myShiftsCards` (`.slot-cards`/`.slot-card`، نفس CSS اللي في facebook + موديل `#slotModal`). `renderMyShifts` بيخزّن `_myShiftRows` وكل كارت click → `openMySlot`. (`listenShifts` لسه بيجيب سلوتات **النهاردة** للزميل بس.)
- **الموديل في my-fb** (`openMySlot`/`closeMySlot`/`smFetchReplies`/`smSave` + `countMyReplies`): يكتب بدأت/انتهيت فعلي + زرار «جيب عدد ردودي» جوّاه (بيعدّ بهاشتاج `myAgentName` في الفترة الفعلية بس، نفس تحسين `if(t>toMs) continue`) + حفظ بـ `updateDoc` على دوك السلوت. **بيخزّن «المحادثات» في `messages`** (متّسق مع `saveEntry`/رقم اللايف). الأزرار اتربطت في `initEntry`.
- **🗑️ قسم «فيسبوك API» القديم اتشال من facebook.html (2026-06-22):** السكشن `#api` (حالة الربط + إعداد الأدمن + البوستات) + لينك النav + الدوال المهجورة (`renderApiStatus`/`renderApiKpis`/`renderApiPosts`/`loadFbConfig`/`saveFbConfig`/`refreshFb`/`FB_CFG_REF`). السبب: كان بيعتمد على الـ Cloud Function (`functions/facebook.js`) اللي **مش قادر يتعمله ديبلوي — المشروع على خطة Spark المجانية ومحتاج Blaze**. أداء الفريق بقى من «ردود الزملاء (لايف)» اللي بيقرا فيسبوك مباشرة. `initApi()` اتقلّص لـ listener واحد بس لـ `fbInsights/live` (مؤشّر «آخر ٢٤ ساعة»). **ملاحظة:** إصلاح `functions/facebook.js` اتعمل في الكود بس **مااتعملوش ديبلوي** (نفس سبب Blaze) — لو اترقّى المشروع، `firebase deploy --only functions`.
- **🎨 إصلاح الدروب ليست (`.cust-sel`) في الدارك مود (facebook.html):** كانت بتستخدم `var(--card)` (شبه شفافة في الدارك = rgba(255,255,255,.045)) فالقائمة بتبان شفافة والكلام ورا بيبان. الحل: أوفررايد دارك بخلفيات **صلبة** — `.cust-sel-drop`#0f1c34 · `.cust-sel-search`#0b1730 · `.cust-sel-val`#0e1a30 + نص `--ink`. (لو ظهرت نفس المشكلة في أي صفحة تانية فيها `.cust-sel` اعمل نفس الأوفررايد.)

### my-fb.html + facebook.html — طبقة تفاعلية بريميوم مشتركة (2026-06-24)
طبقة **إضافية بالكامل** فوق الموجود (ما اتغيّرش أي منطق شغّال ولا ID). دوال مشتركة **متطابقة** في الملفين (لو عدّلت واحدة عدّل التانية) معرّفة بعد `fmt12`:
- `countUp(elm,to,{locale,dur,pre})` — عدّاد متحرّك (easeOutCubic) بيقرا الرقم القديم من `data-cv`؛ بيحترم `prefers-reduced-motion`. `pre` = بادئة ثابتة (مثل `"🛒 "`). الاستخدام: شرائح الهيرو في my-fb (`paintTeam`'s `set`) + KPIs التحليل في facebook (`renderAnReplies`، بيرندر "0" الأول ثم `countUp` على `.kpi .v`).
- `toast(msg,type)` — توست أنيق في `#toastWrap` (عنصر ثابت قبل `</body>`). **متوصّل مركزياً عبر `fbMsg`** فبيشتغل على كل حفظ/خطأ تلقائياً + استدعاء يدوي في `smSave`. type: ok/err/info.
- `skelCards(n)` — كروت شيمر تحميل. my-fb: بداية `listenTeam`/`listenShifts`. facebook: بداية `analyzeAgentReplies` على `#anResultCard`.
- **بانر «دلوقتي» الذكي (my-fb فقط، `#nowBanner` جوّه الهيرو):** `renderNowBanner()` بيقرا `_myShiftRows` المفلترة على اليوم: شغّال دلوقتي (+ باقي/شريط تقدّم) · ورديتك الجاية كمان X · خلّصت النهاردة. بيتحدّث من `renderMyShifts` + `setInterval(nowTick,60000)`. أدوات: `hm2min`/`fmtDur`.
- CSS: بلوك «PREMIUM INTERACTIVE LAYER» — press feedback (`:active`)، `pt-pop` للموديل، `.toast*`، `.skel*` (+ `@keyframes pt-shimmer`)، و`.now-banner*` (my-fb). كله بـ media query لـ reduced-motion.

### my-fb.html + facebook.html — إصلاح bidi للوقت + مدخلات الأوردر + نوتيفيكيشن فترة واحدة (2026-06-24)
- **🐞 إصلاح عرض «من – إلى» في RTL:** الوقت فيه «ص/م» عربي كان بيلخبط ترتيب الوقتين («2:10م2:15 – م»). الحل دالة موحّدة `fmtRange(a,b)` (+ `bd(s)=<bdi dir="ltr">`) معرّفة بعد `fmt12` في **الملفين**: بتلفّ النطاق في `<span style="direction:ltr;unicode-bidi:isolate;display:inline-block">` وكل وقت في `<bdi dir="ltr">`. اتطبّقت على كروت تيم بورد/السلوتات + عنوان الموديل (`smSub` بقى `innerHTML`) + بانر «دلوقتي» + آخر الإدخالات. **أي عرض نطاق وقت جديد لازم يستخدم `fmtRange` مش `${fmt12} – ${fmt12}` خام.**
- **تسجيل سلوت — نوتيفيكيشن = فترة واحدة (my-fb):** لما `#eChannel==="نوتيفيكيشن"` بيتخفي باند «السلوت المقرر» (`#eSchedBand`) وبيتمسح `eFrom/eTo`، وعنوان باند الفعلي (`#eActualBandH`) بيتغيّر لـ «دخلت من / خلصت». الدالة `syncEntryChannel()` متربوطة بـ `onchange` ومتندهة في `initEntry`. (الإنبوكس وغيره يفضل بانديْن.)
- **تسجيل الأوردر — مدخلات ملاحظات شرطية (my-fb):** ملاحظة «تحويل من فرع» → دروب ليست فروع (`#noteBranchSel`، مصدرها `const BRANCHES`)؛ «رقم اذن» → حقل رقم مطلوب (`#notePermitNo`). بيظهروا لما الـ pill يتشيك (`syncNoteExtras`)، والقيمة بتتكتب في النوت كـ `"تحويل من فرع: Gamaa"` / `"رقم اذن: 12345"` (في `getCheckedNotes`). `saveOrder` بيمنع الحفظ لو الـ pill متشيك من غير قيمة. الثوابت `NOTE_BRANCH`/`NOTE_PERMIT` بتطابق نص الملاحظة الافتراضي — لو الأدمن غيّر الاسم المدخل مش هيظهر.

### my-fb.html — تنبيه تعارض السلوت + احتفال إنهاء الوردية (2026-06-24)
- **🟠 بانر تعارض (مرجاني، غير مانع):** `#slotConflict` جوّه فورم «تسجيل سلوت يومي» بعد باند الفعلي. `checkSlotConflict()` (debounce 260ms على change بتاع eFrom/eTo/eActualFrom/eActualTo/eDate + من `syncEntryChannel`) بيجيب سلوتات نفس اليوم (`ensureConfRows` كاش بالتاريخ، query `fbLog` where date) لزملاء **غير** المستخدم، ويحسب تقاطع الفترات (`rangesOverlap`، يدعم نقطة بلا نهاية). لو فيه تداخل يطلّع بانر «خلّي بالك — الفترة دي مش فاضية! 👀 · {اسم} مسجّل سلوت {range}» بأفاتار + نبضة. زر × للإخفاء المؤقت. بعد الحفظ `_confDate=null` + إخفاء. (الأوقات بـ `fmtRange`/`min2hm`.)
- **🏆 احتفال إنهاء (~٥ث، كونفتي + كارت جلاس):** overlay `#celebrate` (dim + `.confetti` + `.cel-card` فيه 🏆 بينطّ + عنوان متدرّج + sub + `#celStat` + شريط عدّ تنازلي ٥ث). `celebrate({title?,sub?,stat?,ms?})` بيولّد ٩٥ قصاصة كونفتي ديناميكياً (يحترم reduced-motion)، `closeCelebrate` يقفل (auto بعد ٥ث أو كليك على الـ dim). **بيشتغل لما السلوت يكتمل** (`actualFrom && actualTo`) في `saveEntry` (فوراً) و`smSave` (بعد قفل الموديل بـ 750ms). الرسائل عشوائية من `CEL_TITLES`. الـ stat = «✉️ N رد» لو فيه رسائل.

### 🔑 كاش الـ HTML — سبب «التعديلات مش بتظهر» (2026-06-24)
كان `firebase.json` بيخلّي Firebase Hosting يطلّع `Cache-Control: max-age=3600` على الـ HTML → المتصفح/الويب-فيو بيكاش الصفحة **ساعة كاملة**، فالمستخدم كان بيشتكي «لسه بردو» رغم إن النشر صح (تأكيد: `curl` للـ live أظهر الإصلاح موجود لكن الهيدر max-age=3600). الحل: `hosting.headers` لـ `**/*.html` بـ `Cache-Control: no-cache, max-age=0, must-revalidate`. **درس: لو المستخدم مش شايف تعديل بعد deploy، اعمل `curl -sI` للـ live وتأكد من الهيدر قبل ما تشك في الكود.** أول مرة بعد التغيير محتاجة Ctrl+Shift+R لمسح النسخة المكاشّة القديمة.

### عرض نطاق الوقت — inline-flex مش bidi (2026-06-24)
`fmtRange(a,b)` في my-fb + facebook بقت تستخدم `display:inline-flex;direction:ltr` (ترتيب ثابت يسار→يمين مايتأثرش بالـ bidi، عكس `unicode-bidi:isolate` اللي اتلخبط في الويب-فيو) + بترتّب الأصغر الأول (`_hm` للمقارنة). كل وقت لسه في `<bdi dir="ltr">`. **أي عرض وقت جديد لازم `fmtRange`.**

### my-fb.html — داش بورد Overview بريميوم + إصلاح صور الترحيب/الهوفر (2026-07-03)
- **قسم `#my-kpis` ("Overview — This Month") بقى `.ov-grid`** — 4 كروت (💬 الردود · 🕐 السلوتات · 🛒 الأوردرات · 💰 القيمة)، كل كارت **فلتره الخاص (اليوم/الشهر)** بمؤشر منزلق محسوب بالـ `offsetLeft` الفعلي (مش transform+RTL guessing) عبر `positionOvInd`. تحته **"نشاطي اليومي" (`renderOvDaily`)** — تايم لاين يوم بيوم من نفس البيانات. المصدر: `_myLogRows`/`_myOrdRows` (كاش محلي من `renderMyLog`/`renderMyOrders`، بيتحدّث كل سنابشوت، بدون أي طلبات إضافية) مجمّعة بـ `ovAggByDay()`. `renderKpis()`/`myKpisGrid` القدام اتشالوا بالكامل.
- **🐞 باگ خطير اتصلّح: استدعاء يتيم كسر الصفحة كلها.** لما `renderKpis()` اتشالت، فضل استدعاء `renderKpis();` جوّه `showApp()` (بعد `renderHeroAvatar()`) — ده رمى `ReferenceError` **سينكرونس** وقف تنفيذ باقي `showApp()` بالكامل، يعني `initEntry()`/`listenTeam()`/`loadRoster().then(refreshData)` **ما اتنفذوش خالص** → كل رقم في الصفحة (Overview، السايد بار `snav-kpi-card`، النشاط اليومي، بورد الفريق) فضل على القيمة الافتراضية صفر، حتى لو الزميل شغّال فعلاً. **الدرس: أي حذف لدالة لازم `grep` على اسمها في الملف كله قبل ما تقفل — استدعاء واحد ناسي بيكسر كل حاجة بعده في نفس الدالة الأب.**
- **`heroMsgs`/`heroSlots` ("Replies today"/"Shifts today" في الـ Sidebar) كانوا بيعرضوا رقم الفريق كله** (من `paintTeam`/`_teamRows`) مش رقم الزميل الشخصي — كل زميل كان يفتكر إنه رقمه هو. اتصلحوا الاتنين في `renderMyLog` (فلترة `_myLogRows` على `date===todayISO()`). رقم الفريق اتنقل يتوضّح صراحة في `teamBoardSub` ("💬 N رد الفريق كله").
- **صورة الترحيب البريميوم (`.hg-av-ring`) بجوار "Welcome":** اكتشاف تلقائي `/team/<slug>.(jpg|jpeg|png|webp)` (نفس منطق فيسبوك.html، الدوال **متطابقة في الملفين**: `slugName`/`fbPhotoCandidates`/`fbImgFallback`/`fbAvColor`/`podIni`). هوفر/فوكس على الصورة (لو فيها صورة حقيقية بس، مش حروف) بيطلّع **معاينة عائمة مكبّرة** (`#hgAvPreview`, `initHeroAvatarZoom`) بحلقة conic-gradient دوّارة + halo، محسوبة المكان بـ `getBoundingClientRect`.

### my-fb.html — MY ORDERS + فولو أب الأوردرات + تعديل + اسم العميل + فورم تقييم عام (2026-07-03)
**نموذج البيانات:** `fbOrders` بقى فيه حقول جديدة: `customer` (اسم العميل، إجباري وقت التسجيل)، `followUpResult`/`followUpNote`/`followUpAt`/`followUpBy` (نتيجة المتابعة، دروب-داون ثابت `FOLLOWUP_OPTIONS` + ملاحظة حرة).
- **بادچ ذهبي "MY ORDERS" في الهيدر** (`#myOrdersBadge`، عدد كل أوردرات الزميل **من كل الوقت** مش الشهر بس عبر `loadMyOrdersCount`) — بيفتح درج "أوردراتنا كلنا" **مفلتر عليه بس** (`_ordMineOnly` + شيبات `ordChipAll`/`ordChipMine` جوّه الدرج نفسه).
- **قابلية تعديل الأوردرات (كانت مقفولة تماماً غير الأدمن — Firestore rule القديمة `allow update: if isAdmin()` بس):** موديل `#editOrderModal` (`openEditOrder`/`saveEditOrder`) — الحقول الأساسية (فرع/رقم/عميل/إجمالي) مقفولة لغير صاحب الأوردر (`by===email`) أو الأدمن، **لكن حقول الفولو أب مفتوحة لأي حد في تيم الفيسبوك على أي أوردر** (الفولو أب بيعمله زملاء الواتساب مش بالضرورة نفس اللي سجّل الأوردر). الـ rule الجديدة في `firestore.rules` (`match /fbOrders`) بتعكس الفصل ده بالظبط (`diff().affectedKeys().hasOnly([...فولو أب فقط...])`).
- **تاب "FOLLOW UP ORDERS" (`#order-followup`, مرئي لكل الفريق):** `loadFollowUpOrders()` بيجيب أوردرات الشهر الحالي + اللي فاته (`prevYM()`، عشان الحد الزمني ٣ أيام ممكن يعدّي حدود الشهر) ويفلتر `date <= today-3` و`!followUpResult`. كل كارت فيه زرار **"📋 نسخ لينك التقييم"** (`copyReviewLink` → `reviewLinkFor` بيبني `/rate-us.html?o=<orderId>&c=<customer>&a=<agent>` وينسخه للكليب بورد) عشان يتلصق في رسالة الواتساب **بدل** لينك الفيسبوك الخام.
- **جيب اسم العميل من فيسبوك (لأوردرات ≥ ٥٠٠ ج.م):** زرار 🔍 بيظهر تلقائي لما `oTotal`/`eoTotal` ≥ 500 (`wireCustFetchVisibility`). `findCustomerNameByOrder(orderNo)` بيدوّر في رسائل آخر ١٤ يوم (نفس نمط `analyzeMyReplies`/Graph API) على رسالة فيها **نص رقم الأوردر**، ولو لقاها بياخد اسم الطرف التاني في المحادثة (مش الصفحة) من `participants`. **حد أقصى 500 محادثة** لتفادي استهلاك API مفرط لو ملقاش نتيجة.
- **🚫 مفيش API لنشر ريفيو تلقائي على فيسبوك (قرار متعمّد بعد بحث):** فيسبوك مالهاش endpoint عام لنشر "تقييم/Recommendation" نيابة عن مستخدم — لازم المستخدم نفسه يعمله من حسابه. الحل البديل: **`public/rate-us.html`** (صفحة عامة، بدون تسجيل دخول، بتاخد `?o=&c=&a=` من اللينك) — فورم نجوم + تعليق بيتسجّل في `customerReviews` (Firestore، `allow create` عام بس بشرط `rating` رقم صحيح 1-5)، وبعد الحفظ: **لو التقييم ≥4** يظهر زرار كبير بيوديه مباشرة للينك الريفيوهات الحقيقي (`facebook.com/altarshouby/reviews`)؛ **لو ≤3** يظهر رسالة اعتذار داخلية بس من غير زرار فيسبوك (تفادي دفع تقييمات سلبية للصفحة العامة — best practice قياسي). ده **إضافة أنا اقترحتها ونفّذتها كديفولت** — لو حد عايز يلغي الفلترة دي قولّي.

### my-fb.html + facebook.html — الزميل يغيّر صورته بنفسه (2026-07-04)
**المشكلة:** الصور كانت ملفات ستاتيك في `public/team/` → أي صورة جديدة = deploy. **الحل: Firestore بدل الملفات** (مفيش Firebase Storage — المشروع Spark):
- **كولكشن `fbProfiles/{email}`** (المفتاح = إيميل الأوث): `{name, photo (data URL JPEG 320×320), by, at}`. **Rule جديدة في `firestore.rules`**: قراءة `canViewFacebook`؛ كتابة/حذف للأدمن أو صاحب الدوك نفسه فقط (`docId == request.auth.token.email`)، مع حد `photo.size() < 400000` حرف. **محتاجة `firebase deploy --only firestore:rules`.**
- **my-fb.html:** زرار 📷 (`#avEditBtn`، إيموجي مش SVG — درس الويب-فيو) على أفاتار الهيرو (اتلف في `.hg-av-outer` position:relative) → موديل `#avcModal` بمرحلتين: اختيار (صورتي الحالية + «اختار صورة» + «شيل صورتي») ثم **قص canvas بماسك دائري** (سحب pointer events + سلايدر زوم أُسّي ×3.5 + wheel، `createImageBitmap` مع `imageOrientation:'from-image'` + فولباك Image). الحفظ: canvas 320×320 → JPEG q0.85 (بينزل لحد q0.35 لو عدى 300K حرف) → `setDoc(fbProfiles/{myEmail})`. الدوال: `openAvcModal/avcLoadFile/avcDraw/avcSetZoom/avcSave/avcRemove/initAvatarEditor` (بعد `initHeroAvatarZoom`).
- **أولوية الصور في `fbPhotoCandidates` (الملفين):** `FB_PHOTOS[slug]` (صورة الزميل من Firestore، بتتحمّل بـ `loadFbPhotos()` مرة كل سيشن) ← ثم `roster.photo` اليدوي بتاع الأدمن ← ثم ملفات `/team/`. يعني **صورة الزميل المرفوعة بتكسب حتى لو الأدمن حاطط لينك يدوي**. التحميل: my-fb جوه `Promise.all([loadRoster(), loadFbPhotos()])` في `showApp` (قبل `refreshData`)؛ facebook جنب `loadRoster()` وبيعيد رسم البوديوم (`_podLastResults`) لما الصور توصل.
- ملفات `/team/` القديمة فضلت شغّالة كفولباك — محدش اتمسح له حاجة. **ديبلوي مطلوب:** hosting (الصفحتين) + firestore:rules.

### followup.html + review.html + my-cc-stats.html — صورة بروفايل تيم الاستشارات (2026-07-04)
نفس فكرة fbProfiles بس لتيم الاستشارات/المراجعين، **كولكشن منفصل `teamProfiles/{email}`**: `{name, photo (data URL JPEG 320×320), by, at}`.
- **الرفع/القص/الحذف من followup.html فقط** (طلب صريح — «تتغير من مكان واحد»): الـ 👋 في `hero-card` اتشال واتحط مكانه **أفاتار بريميوم 96px** (`.hero-id` > `.tp-av-ring` حلقة conic دوّارة + glow متنفس + فولباك حروف `tpIni`) + زرار 📷 (`#tpEditBtn`) → موديل `#tpmModal` (`tpm-*` CSS مستقل على توكنز الصفحة، دارك+لايت) بمرحلتين: اختيار/حذف ثم قص canvas دائري (نفس منطق avc في my-fb). الدوال: `initTeamPhoto/tpFetchPhoto/tpApply/tpOpenModal/tpLoadFile/tpDraw/tpSetZoom/tpSave/tpRemove` (بعد `notif`). الاستدعاء بعد تعيين heroGreet في الأوث.
- **العرض فقط:** review.html — الصورة جوه `#hdrUserAvatar` في الهيدر (`loadTeamPhotoIntoHeader`، class `has-photo` = حلقة conic `--tprot` حوالين الأفاتار، نقطة التواجد الخضرا فوق الصورة بـ z-index:3). my-cc-stats.html — أفاتار 88px في `.hero-left` جنب heroGreet (`loadMyTeamPhoto` + `tpIni`، بيتنده بعد hdrName في الأوث).
- **🔑 المطابقة بالاتنين: إيميل الدخول (docId) أولاً ثم حقل `name` (case-insensitive)** — عشان إيميلات المراجعين بتتغير شهرياً والأسماء ثابتة؛ لو الإيميل اتغيّر الصورة القديمة بتتلقط بالاسم. نفس منطق الـ fetch متكرر في التلات صفحات (getDocs على الكولكشن كله — صغير ~11 دوك) — لو عدّلته عدّل التلاتة.
- **Rule في `firestore.rules`** (`match /teamProfiles`): قراءة أي مسجّل دخول؛ كتابة/حذف للأدمن أو صاحب الدوك (`docId == request.auth.token.email`) بحد `photo < 400000` حرف. **ديبلوي مطلوب:** hosting (التلات صفحات) + firestore:rules.
- **هوفر = معاينة عائمة مكبّرة 208px** (نفس `hgAvPreview` بتاعة my-fb بألوان teal/gold): عنصر `#tpPrev` (`.tp-prev*` CSS) في التلات صفحات — حلقة conic دوّارة + هالة + glow متنفس، position:fixed محسوب بـ `getBoundingClientRect` (تحت الأنكور، clamped للشاشة). followup: `initTpPreview` على `.tp-av-ring` (class `has-photo` = cursor zoom-in). review: `initTpPreview(av)` بتتنده من `loadTeamPhotoIntoHeader` (كليك بيخفيها عشان الدروب داون). my-cc-stats: **delegation** على `document` (`tpPrevShow/tpPrevHide`) بتغطي `.tp-av-ring` و`.sp-av` مع فحص `relatedTarget` ضد الفليكر.
- **صور البوديوم في my-cc-stats** (`renderMyStars`/`step`): أفاتار `.sp-av` بقى يحاول صورة — الأولوية: `_tpMap` (teamProfiles بالاسم lowercase) ← ملفات `/team/<slug>.(jpg|jpeg|png|webp)` (`tpSlug` — لو الاسم عربي slug فاضي فمفيش محاولة) ← الحرف زي الأول (`tpImgFB` على window بيمشي في السلسلة ويشيل الـ img لو كله فشل). `loadMyTeamPhoto` بيملأ `_tpMap` وبينده `renderMyStars()` تاني بعد التحميل. زملاء الكول سنتر بيرفعوا صورهم من agent.html (تحت) فبتظهر هنا بالاسم.
- **بوديوم الفولو أب + كروت الأعضاء في followup.html (تكملة 2026-07-04):** `tpFetchPhoto` بقت تملأ `_tpMap` (بالاسم) و`_tpByEmail` (بالـ docId) + `tpPhotoFor(name)` بتطابق بالاسم أو بإيميل `REVIEWERS[name]`. `renderFuPodium.fill` بيضيف img جوه `fuP{slot}Av` (DOM append بعد textContent) والـ member-card بيحقن img جنب الحروف. بعد تحميل الصور `initTeamPhoto` بينادي `renderAll()`. الهوفر بقى **delegation** على `.tp-av-ring, .fu-podium-av, .member-avatar` (مش per-element).
- **agent.html — سايد بانل ترحيب + رفع صورة الزميل (2026-07-04):** `<aside id="tpSide">` position:fixed يمين (top:118px، **مخفي تحت 1280px**) — «✦ WELCOME ✦» + أفاتار 84px بحلقة conic دوّارة + `Dr. {displayName}` + `{agentNumber}{C.C/W.W}`. حدود الكارت conic بتلف (mask-composite). **رفع/قص/حذف كامل بنفس دوال tp* بتاعة followup** (متطابقة، `showToast` بدل `notif`) — بيكتب في **نفس `teamProfiles/{email}`** (إيميلات agent{N} ثابتة، والـ rule بتسمح لأي مسجّل دخول يكتب دوكه). CSS/HTML في `<style>` مستقل قبل `</body>`؛ JS قبل `onAuthStateChanged`؛ الاستدعاء `initTeamPhoto(email, displayName, sub)` جوه بلوك allowed ملفوف try/catch. اتضاف `setDoc` للـ imports.
- **حجم/أداء (سؤال المستخدم 2026-07-04):** الصورة ~25-45KB → 30 زميل < 1.5MB من 1GB مجاني. القراءة getDocs واحدة لكولكشن صغير كل تحميل — لا يُذكر ضمن 50K/يوم. مفيش تأثير على السرعة (الحروف فوراً والصورة بتتركب لما توصل).
- ✅ **اتعمل deploy فعلاً (hosting + firestore:rules) يوم 2026-07-04** — كل شغل صور البروفايل (fbProfiles + teamProfiles) عايش على الموقع.

## agent.html — نظام Red Flag بوب-أب (RF-V152) + consult-analytics.html (2026-07-04)
**قرار مهم:** فكرة AI يقترح أدوية للزملاء **مرفوضة نهائياً** (عشان مايعتمدوش عليه) — البديل المنفّذ:

**1) Red Flag premium popup في agent.html:**
- المشكلة: `flags()` كانت بتحفظ اتحاد أعلام العروض المختارة **من غير مطابقة مع الإجابات**، والوحيد المتفعّل `alertIfValue` (banner نصي). دلوقتي **كل** عرض له `flags[]` بيتفعّل بمجرد اختياره.
- الآلية: بلوك «RED FLAG PREMIUM POPUP (RF-V152)» بعد `urgent()` — `rfAfterChange()` متندّه من نهاية `toggleSym`/`choiceQ`/`choice`/`multi`: عرض جديد بأعلام → بوب-أب checklist بعلاماته؛ إجابة فعّلت `alertIfValue` → نفس البوب-أب مؤكّد مسبقاً. Queue للتتابع، مرة لكل مفتاح (`P:{id}`/`A:{key}`) لكل استشارة. إعادة فتح مجمّعة بالضغط على بوكس `#priority`.
- «🚑 تطبيق القرار» بيكتب في `prescribedMeds` سطر أوله `RF_MARKER='⚠️ الحالة تحتوي على ريد فلاج'` + «تم نصح العميل بالتوجه لطبيب أو أقرب مستشفى…» (بيشيل أي سطر ماركر قديم قبل الإضافة) + `updateSummary()`.
- الحفظ: حقلين جداد في دوك الاستشارة — `confirmedRedFlags:[]` + `redFlagApplied:bool` (بعد `flags:`). ريسيت في `clearAll`/`newConsultation`/سناپشوت triageData (`rfReset`)؛ استعادة تعديل بتعلّم الموجود من غير بوب-أب (`rfSyncSeen` بعد `updateTeamReviewedBtnState`). HTML/CSS للمودال قبل `</body>` (`#rfOv`، دارك بخلفيات صلبة).

**2) consult-analytics.html — صفحة تحليل تفصيلي (أدمن/صلاحية):**
- بوابة: أدمن أو `canViewConsultAnalytics===true` أو `canDeleteConsultations` (دوك `users/{uid}`). **الـ rules اتعدّلت**: دالة `canViewConsultAnalytics()` + سطر في `allow read` بتاع consultations — **لازم `firebase deploy --only firestore:rules`** وإلا حامل الصلاحية الجديدة (غير المراجع/الأدمن) هياخد permission denied.
- فترات: دورة ٢١→٢٠ افتراضي + آخر ١٤ دورة دروب-ليست + السابقة/٩٠ يوم/كل الوقت/مدى مخصص. استعلام range على `createdAt`.
- أقسام: KPIs (countUp) · نشاط زمني (يومي/٢٤ ساعة/أسبوع، الذروة دهبي) · أكثر العروض + تصنيفات + متوسط تقييم لكل عرض · الأدوية (تطبيع نص حر `medTokens`/`AR_NORM` — تقسيم فواصل/أسطر/» و «، استبعاد «لا يوجد») + دريل «أدوية عرض معين» بشارة إجماع (top1 share ≥50% إجماع/≥25% متوسط/أقل تشتت) + أزواج عرض←دواء · المراجعة (توزيع نجوم، donut حالات بأيقونات، جدول مراجعين بمتوسط زمن المراجعة، كلمات ملاحظات المراجعين بعد stopwords) · جدول زملاء sortable + دريل بالضغط · ريد فلاج (مؤكّد من `confirmedRedFlags` أو فحص `RF_MARKER` في الأدوية للقديم، «محتمل» = flags تلقائية) · ديموغرافيا + جودة ملء الحقول · تصدير CSV بـ BOM.
- ديزاين: دارك ops-center (Tajawal، سطح `#111a33`)، باليت داتا متحقق منها (سيكوينشال أزرق `#3987e5`/أخضر `#199e70`، الدهبي `#c9a84c` كروم فقط مش داتا، ألوان status ثابتة بأيقونة+ليبل دايماً). أرقام `ar-EG` + `tabular-nums`.
- index.html: كارت بنفسجي 🔬 (بعد كارت reviewer-stats) + دالة `canViewConsultAnalytics(profile)` + توجل في `userPermsHtmlV119` + `setIf` + أوبشن في bulk perm dropdown.

### ⏳ حالة الجلسة (2026-07-03) — لسه محتاج ديبلوي + باگ مفتوح
**لازم ديبلوي قبل أي اختبار تاني** — كل تعديلات النهاردة (my-fb.html, rate-us.html, firestore.rules) لسه محلية بس:
```
firebase deploy --only hosting
firebase deploy --only firestore:rules
```
من غير الـ rules deploy، تعديل الأوردر/تسجيل الفولو أب/فورم التقييم العام هيفشلوا بـ "صلاحية مرفوضة" حتى لو الـ hosting اتنشر.

**🐞 باگ اتصلّح فعلاً (درس مهم):** كنت مسحت دالة `renderKpis()` القديمة بس نسيت أمسح استدعاء ليها جوّه `showApp()` — الاستدعاء اليتيم ده كان بيرمي خطأ يوقف تنفيذ `showApp()` بالكامل، فمفيش أي listener (fbLog/fbOrders/team) بيشتغل خالص، وكل رقم في الصفحة فضل صفر. **الدرس: أي حذف دالة لازم `grep` على اسمها في الملف كله قبل ما تعتبره خلص.**

**🐞 باگ مفتوح لسه (آخر حاجة قبل ما أوقف):** "نشاطي اليومي" (Overview → My Daily Activity) فاضي لزميلة **مؤكّد إنها هي اللي مسجّلة دخول وسجّلت سلوتات/أوردرات النهاردة بنفسها** (مش زميلة تانية). راجعت السلسلة كاملة (`listenLog`→`renderMyLog`→`renderOverview`→`ovAggByDay`→`renderOvDaily`) ومالقتش خطأ برمجي — الكروت فوق والقايمة تحت بياخدوا من نفس الـ `map` بالظبط. **الاحتمال الأقوى: كانت بتختبر قبل ما فيكس `renderKpis()` يتعمله ديبلوي.** الخطوة الأولى من أي جهاز تاني: اعمل ديبلوي (فوق) وجرّب تاني. لو استمر، محتاج screenshot لـ console المتصفح (F12) قبل ما نكمل تعديل عشان نشوف الخطأ الحقيقي بدل التخمين.

## لايت مود + مركز الأجهزة (lite-mode.js · devices.html) — 2026-07-04
**النظام:** ملف مشترك `lite-mode.js` متحمّل بـ `<script src="/lite-mode.js">` في ~15 صفحة، بيتنده بعد الأوث في كلها بـ `window.PTLite.sync({db,doc,setDoc,uid,profile})`. مهمّتين:
1. **لايت مود:** لو الأدمن فعّل `liteMode` للمستخدم → بيحقن ستايل واحد بيوقف الشغل الزخرفي التقيل (WebGL bg، الـ orbs blur(100px)، الحلقات conic الدوّارة، وكل animation/transition). كله ديكور — مفيش وظيفة بتتكسر. بيتطبّق فورًا من `localStorage['pt_lite']` قبل ما الأوث يخلص (فأول paint مايبدأش الشغل التقيل).
2. **رصد الأجهزة:** بيكتب snapshot غني في `users/{uid}.deviceInfo` (RAM/كور/GPU/OS/متصفح/شاشة/viewport/شبكة/بطارية/تخزين/IP/tz/لغة/touch/dpr…) — **بس لو اتغيّر** (مايكتبش كل مرة). علامة `weak` (RAM≤4 أو كور≤2 أو GPU قديم).

**التحكّم اللحظي (self-contained):** `sync` بيعمل `onSnapshot` على دوك المستخدم نفسه عبر **dynamic `import()` لنفس URL نسخة Firebase (12.13.0)** — ES modules singletons per-URL فبيرجع نفس `onSnapshot`/`getAuth` بتوع الصفحة، **من غير ما نلمس الـ 15 صفحة**. بيرد على أوامر الأدمن في `deviceCommand:{type,id,text?,at,by}`:
- `message` → overlay رسالة على شاشة الزميل · `refresh` → reload · `logout` → signOut+reload.
- إيدمبوتنت عبر `localStorage['pt_cmd_ack']` = آخر `id` (فالـ snapshot اللي بيعيد نفسه — حتى من كتبة الـ ack — مايكررش الأمر). الـ ack بيتكتب في `deviceInfo.lastCmdId/lastCmdType/lastCmdAt` (لسه جوّه deviceInfo فبيعدّي الـ rule).

**القواعد (مفيش تعديل جديد محتاج للفيتشر ده):** `users/{uid}` — الأدمن يكتب أي حاجة (`allow write: if isAdmin()`، فبيكتب `liteMode`/`deviceCommand`)؛ المستخدم العادي يكتب **`deviceInfo` بس** في دوكه (`allow update … affectedKeys().hasOnly(['deviceInfo'])`) وده بيغطّي رصد الجهاز + كتابة الـ ack. **⚠️ سطر deviceInfo self-write (firestore.rules) لازم يكون اتعمله deploy** وإلا غير-الأدمن ياخد permission-denied ومايبعتش مواصفاته.

**devices.html — كونسول IT بريميوم مستقل (أدمن فقط):** دارك ops-center (Tajawal، سطح `#111a33`، أرقام `ar-EG`+tabular، سيان `#38c7ff` ثيم IT، الدهبي كروم فقط). بوابة `onAuthStateChanged` (super `drshawky530` أو role==admin/`canAdmin`، غيره «للأدمن بس»). `onSnapshot(collection users)` لايف. KPIs (إجمالي/متصل آخر ٥د/ضعيف/لايت/لسه محصلش بيانات) + toolbar (بحث/فريق/حالة/ترتيب، بيتبني مرة والكروت بس بتتعاد) + كروت أجهزة (مواصفات + مترّات بطارية/تخزين + توجل لايت مود لحظي + أزرار 🔄تحديث/💬رسالة/🚪خروج + حالة آخر أمر «اتنفّذ ✓/مستني») + مودال تفاصيل خام + نسخ JSON. الأوامر بتتكتب بـ `setDoc(merge)` `{deviceCommand:{type,id:Date.now(),…}}`.

**index.html:** اتشال عرض معلومات الجهاز من كارت إدارة المستخدمين (دالة `deviceInfoHtmlV152` **اتمسحت** + استدعاؤها) — بقى مركز مستقل. اتضاف كارت أدمن «🖥 مركز الأجهزة» (سيان) بعد كارت إدارة المستخدمين → `/devices.html`. توجل لايت مود لسه موجود في perms إدارة المستخدمين (اختياري، بيكتب نفس الحقل).
**حدود المتصفح (أمانة):** التحكّم = أوامر ناعمة (reload/signout/رسالة) — تحكّم حقيقي في الشاشة/الملفات مستحيل من صفحة ويب (محتاج برنامج متثبّت). الـ IP = العام (مش LAN).
**ديبلوي مطلوب:** `firebase deploy --only hosting` (index.html + devices.html + lite-mode.js) + تأكيد إن `firestore:rules` (سطر deviceInfo) اتنشر.

### مركز الأجهزة — تحديث (2026-07-04، تكملة)
- **توجل لايت مود اتشال من إدارة المستخدمين** (index.html: من `userPermsHtmlV119` + `setIf` في `updateAppUser`) — بقى يتحكّم فيه من devices.html بس.
- **البحث بيلاقي رقم الدخول** (زي 2027): `loginNum(u)` بيستخرج N من `agent{N}@pharma.local` (أو رقم من loginId/agentNumber)، مضاف للـ search blob + شارة ذهبية «🔑 2027» على الكارت + placeholder محدّث.
- **تحكّمات إضافية (كلها أوامر ناعمة تنفع من المتصفح، عبر `deviceCommand.type` في lite-mode.js):**
  - `clearcache` 🧹 — يمسح localStorage/sessionStorage/caches API ويعمل hard reload (بيحافظ على `pt_cmd_ack`+`pt_lite` عشان مايعملش loop). **بيحل مشكلة «التعديلات مش بتظهر» عن بُعد.**
  - `navigate` 🧭 — يوجّه المتصفح لصفحة من صفحات النظام (same-origin فقط للأمان)، مودال بقائمة `APP_PAGES`.
  - `reportnow` 📊 — يجبر الجهاز يعيد جمع المواصفات ويكتبها فورًا (لو رجعت unknown/قديمة).
  - رسالة + **صوت تنبيه** (`sound:true` → `beep()` عبر AudioContext، best-effort لأن المتصفح ممكن يمنع الصوت قبل تفاعل المستخدم).
  - **⛔ إيقاف/تفعيل الحساب** (`toggleActive`): الإيقاف بيكتب `active:false` + يبعت أمر `logout` فورًا (الكيك اللحظي؛ الـ auth بيرفض الدخول تاني لـ active===false).

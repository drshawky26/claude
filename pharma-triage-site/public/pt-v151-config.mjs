window.BEST_ACHIEVER_CELEBRATION = {

  // ─── تشغيل / إيقاف ───────────────────────────────────────────────────────
  enabled: false,                          // ← false لإيقاف الاحتفال نهائياً

  // ─── إصدار (غيّره لو عايز يظهر من جديد لنفس الشخص) ─────────────────────
  version: "2026-06-best-achiever-sara",
  showOncePerVersion: false,              // true = يظهر مرة واحدة فقط لكل جهاز

  // ─── الصفحات اللي يظهر فيها ───────────────────────────────────────────────
  pages: ["index.html", "agent.html"],

  // ─── مدة العرض والتسلسل ──────────────────────────────────────────────────
  displayDurationMs:  10 * 60 * 1000,    // ← مدة الاحتفال الكاملة (10 دقائق)
  sequenceDurationMs: 55 * 1000,         // ← وقت التسلسل قبل الـ finale

  // ─── من يظهر له الاحتفال ────────────────────────────────────────────────
  targets: {
    emails:       ["agent1702@pharma.local"],
    agentNumbers: ["1702"],
    names:        ["sara reda"]
  },
  fallbackTargetWhenLoggedOut: false,

  // ─── نصوص الاحتفال ───────────────────────────────────────────────────────
  badge:     "BEST ACHIEVER OF THE MONTH",
  headline:  "CONGRATULATIONS",
  name:      "Dr. Sara Reda",
  kicker:    "Outstanding Consultation Performance of the Month",
  message:   "In recognition of your exceptional dedication, professionalism, and excellence in delivering high-quality patient consultations throughout the month.",
  signature: "With sincere appreciation and congratulations from the Consultation Team & Dr. Shawky",
  buttonText: "Thank You  ✦",

  // ─── إحصائيات Firestore ──────────────────────────────────────────────────
  statsEnabled:     true,
  statsPeriodStart: "2026-05-21",
  statsPeriodEnd:   "2026-06-21",

  // ─── صوت ─────────────────────────────────────────────────────────────────
  soundEnabled: false,

  // ─── إغلاق يدوي ──────────────────────────────────────────────────────────
  allowManualClose: true
};

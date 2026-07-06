(function(){
  const cfg = Object.assign({
    enabled: false,
    version: "default",
    pages: ["index.html", "agent.html"],
    displayDurationMs: 600000,
    sequenceDurationMs: 55000,
    showOncePerVersion: false,
    allowManualClose: true,
    fallbackTargetWhenLoggedOut: false,
    targets: { emails: [], agentNumbers: [], names: [] },
    badge:      "BEST ACHIEVER OF THE MONTH",
    headline:   "CONGRATULATIONS",
    name:       "",
    kicker:     "Outstanding Consultation Performance of the Month",
    message:    "In recognition of your exceptional dedication, professionalism, and excellence in delivering high-quality patient consultations throughout the month.",
    signature:  "With sincere appreciation and congratulations from the Consultation Team & Dr. Shawky",
    buttonText: "Thank You  ✦",
    statsEnabled: true,
    soundEnabled: false
  }, window.BEST_ACHIEVER_CELEBRATION || {});

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let overlay = null, canvas = null, ctx = null;
  let raf = 0, closeTimer = 0, sequenceTimer = 0, hasShown = false;
  let particles = [], rockets = [], balloons = [];
  let pointer = { x: -9999, y: -9999 };

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function pageName(){
    return (location.pathname.split("/").pop() || "index.html").toLowerCase() || "index.html";
  }
  function norm(v){ return String(v || "").toLowerCase().trim(); }
  function digits(v){ return String(v || "").match(/\d+/g)?.join("") || ""; }
  function esc(v){
    return String(v || "").replace(/[&<>'"]/g, c =>
      ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
  }

  /* ── identity ─────────────────────────────────────────────────────────── */
  function getIdentity(){
    const email =
      document.getElementById("hdrDropdownEmail")?.textContent ||
      document.querySelector(".hdr-dropdown-email")?.textContent ||
      document.getElementById("userEmailLogin")?.value || "";
    const name =
      document.getElementById("hdrDropdownName")?.textContent ||
      document.getElementById("hdrUserName")?.textContent || "";
    const role = document.getElementById("hdrUserRole")?.textContent || "";
    return {
      email: norm(email),
      name:  norm(name),
      agentNumber: digits([email, name, role].join(" "))
    };
  }

  function targetLists(){
    const t = cfg.targets || {};
    return {
      emails:       (t.emails       || []).map(norm).filter(Boolean),
      names:        (t.names        || []).map(norm).filter(Boolean),
      agentNumbers: (t.agentNumbers || []).map(digits).filter(Boolean)
    };
  }

  function isTarget(){
    const id = getIdentity();
    const lists = targetLists();
    const hasTargets = lists.emails.length || lists.names.length || lists.agentNumbers.length;
    if(!hasTargets) return true;
    if(!id.email && !id.name && !id.agentNumber) return !!cfg.fallbackTargetWhenLoggedOut;
    if(id.email        && lists.emails.includes(id.email))                    return true;
    if(id.agentNumber  && lists.agentNumbers.includes(id.agentNumber))        return true;
    if(id.name         && lists.names.some(n => id.name.includes(n)))         return true;
    return false;
  }

  function canShow(){
    if(!cfg.enabled || hasShown) return false;
    if(Array.isArray(cfg.pages) && cfg.pages.length &&
       !cfg.pages.map(norm).includes(pageName())) return false;
    if(cfg.showOncePerVersion){
      try{ if(localStorage.getItem("pt-ba-seen-" + cfg.version) === "1") return false; }catch(e){}
    }
    return isTarget();
  }

  /* ── Crown SVG ───────────────────────────────────────────────────────── */
  function crownSvg(){
    return `<svg viewBox="0 0 64 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="cg1" x1="0" y1="0" x2="64" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stop-color="#fff9d0"/>
          <stop offset="35%"  stop-color="#f5c842"/>
          <stop offset="70%"  stop-color="#c98a18"/>
          <stop offset="100%" stop-color="#f5c842"/>
        </linearGradient>
        <linearGradient id="cg2" x1="0" y1="0" x2="0" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stop-color="#ffe080"/>
          <stop offset="100%" stop-color="#a06010"/>
        </linearGradient>
        <filter id="cglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.8" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <!-- Base band -->
      <rect x="4" y="36" width="56" height="12" rx="5" fill="url(#cg2)" filter="url(#cglow)"/>
      <!-- Crown body -->
      <path d="M4 38 L4 18 L16 30 L32 4 L48 30 L60 18 L60 38 Z"
            fill="url(#cg1)" stroke="rgba(255,240,150,.5)" stroke-width=".8" filter="url(#cglow)"/>
      <!-- Highlight shimmer -->
      <path d="M14 34 L18 22 L28 28" stroke="rgba(255,255,255,.45)" stroke-width="1.2"
            stroke-linecap="round" fill="none"/>
      <!-- Top gem — ruby -->
      <circle cx="32" cy="6.5" r="4.5" fill="#ff4466"/>
      <circle cx="30.8" cy="5.2" r="1.4" fill="rgba(255,200,210,.75)"/>
      <!-- Left gem — sapphire -->
      <circle cx="7" cy="36" r="3.5" fill="#4488ff"/>
      <circle cx="6.0" cy="34.9" r="1.1" fill="rgba(180,210,255,.75)"/>
      <!-- Right gem — sapphire -->
      <circle cx="57" cy="36" r="3.5" fill="#4488ff"/>
      <circle cx="56.0" cy="34.9" r="1.1" fill="rgba(180,210,255,.75)"/>
      <!-- Stars on points -->
      <text x="32" y="2.5" text-anchor="middle" font-size="5" fill="#fffbe0">✦</text>
    </svg>`;
  }

  /* ── word-by-word animated message ──────────────────────────────────── */
  function animatedMessage(text){
    let i = 0;
    return String(text || "").split(/(\s+)/).map(w => {
      if(!w.trim()) return esc(w);
      const delay = Math.min(i++ * 90, 3400) + 6500;
      return `<span class="ba-word" style="animation-delay:${delay}ms">${esc(w)}</span>`;
    }).join("");
  }

  /* ── stat card ───────────────────────────────────────────────────────── */
  function buildStat(label, value, suffix, delay, accent, accentRgb){
    return `<article class="ba-stat"
        data-stat="${esc(value)}" data-suffix="${esc(suffix||"")}"
        style="--ba-stat-delay:${delay}ms;--ba-stat-accent:${accent};--ba-accent-rgb:${accentRgb}">
      <strong class="ba-stat-value">0${suffix}</strong>
      <span class="ba-stat-label">${esc(label)}</span>
      <span class="ba-stat-extra"></span>
    </article>`;
  }

  /* ── build DOM ───────────────────────────────────────────────────────── */
  function build(){
    if(overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "ba-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", cfg.headline || "Best Achiever Celebration");
    overlay.style.setProperty("--ba-duration",
      Math.max(1, Number(cfg.displayDurationMs || 600000) / 1000) + "s");

    const stats =
      buildStat("Consultations",  0, "",   11000, "#0cc8c2", "12,200,194") +
      buildStat("Total Stars",    0, "★",  15200, "#ffe7a3", "255,231,163") +
      buildStat("Avg Rating",     0, "/5", 19400, "#73a7ff", "115,167,255") +
      buildStat("5-Star Reviews", 0, "",   23600, "#ff6b8f", "255,107,143") +
      buildStat("Approved",       0, "",   27800, "#34d399", "52,211,153");

    overlay.innerHTML =
      '<div class="ba-aurora"></div>' +
      '<canvas class="ba-canvas"></canvas>' +
      '<div class="ba-shimmer"></div>' +
      '<div class="ba-light-beam ba-light-1"></div>' +
      '<div class="ba-light-beam ba-light-2"></div>' +
      '<section class="ba-card">' +
        (cfg.allowManualClose ? '<button class="ba-close" type="button" aria-label="Close">×</button>' : '') +
        '<div class="ba-hero-line"></div>' +
        '<div class="ba-crown">' + crownSvg() + '</div>' +
        '<div class="ba-badge">✦ ' + esc(cfg.badge) + ' ✦</div>' +
        '<h1 class="ba-title"><span>' + esc(cfg.headline || "CONGRATULATIONS") + '</span></h1>' +
        '<p class="ba-name">' + esc(cfg.name || "") + '</p>' +
        '<p class="ba-kicker">' + esc(cfg.kicker) + '</p>' +
        '<div class="ba-message">' + animatedMessage(cfg.message) + '</div>' +
        '<div class="ba-stats" aria-live="polite">' + stats + '</div>' +
        '<div class="ba-period"></div>' +
        '<p class="ba-secondary-msg">' + esc(cfg.signature || "") + '</p>' +
        '<button class="ba-action" type="button">' + esc(cfg.buttonText || "Thank You") + '</button>' +
        '<div class="ba-timer" aria-hidden="true"><span></span></div>' +
      '</section>';

    document.body.appendChild(overlay);
    canvas = overlay.querySelector(".ba-canvas");
    ctx = canvas.getContext("2d");
    overlay.querySelector(".ba-action")?.addEventListener("click", hide);
    overlay.querySelector(".ba-close")?.addEventListener("click", hide);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerleave", () => { pointer.x = -9999; pointer.y = -9999; });
    document.addEventListener("keydown", onKey);
    return overlay;
  }

  function onKey(e){
    if(e.key === "Escape" && overlay?.classList.contains("ba-show") && cfg.allowManualClose) hide();
  }

  /* ── canvas resize ───────────────────────────────────────────────────── */
  function resize(){
    if(!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(innerWidth  * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width  = innerWidth  + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initBalloons();
  }

  /* ── particle helpers ────────────────────────────────────────────────── */
  function rand(min, max){ return min + Math.random() * (max - min); }
  function color(){
    const p = ["#0cc8c2","#7ee9e3","#ffe7a3","#c9a84c","#ffffff","#73a7ff","#ff6b8f","#ffd97a","#34d399"];
    return p[Math.floor(Math.random() * p.length)];
  }

  /* ── balloons ─────────────────────────────────────────────────────────── */
  function initBalloons(){
    const count = Math.min(28, Math.max(14, Math.floor(innerWidth / 58)));
    balloons = [];
    for(let i = 0; i < count; i++) balloons.push(makeBalloon(true));
  }

  function makeBalloon(first){
    const palette = [
      ["#ff6b8f","#ffd1dc","#9d1235"],
      ["#0cc8c2","#a7fff8","#076c72"],
      ["#ffe16a","#fff6b7","#a66d00"],
      ["#73a7ff","#d5e5ff","#2351a8"],
      ["#9d7cff","#e0d5ff","#4f2ea5"],
      ["#34d399","#c6f7e2","#0a6641"]
    ];
    const p = palette[Math.floor(Math.random() * palette.length)];
    const r = rand(20, 40);
    return {
      x: rand(20, innerWidth - 20),
      y: first ? rand(0, innerHeight + 200) : innerHeight + rand(70, 280),
      r, speed: rand(.22, .72), angle: rand(0, Math.PI * 2),
      wobble: rand(.008, .022), colors: p, popped: false
    };
  }

  function popBalloon(b){
    if(b.popped) return;
    b.popped = true;
    burst(b.x, b.y, 24);
    setTimeout(() => Object.assign(b, makeBalloon(false)), rand(700, 1600));
  }

  function drawBalloon(b){
    if(b.popped) return;
    b.y -= b.speed;
    b.angle += b.wobble;
    b.x += Math.sin(b.angle) * .44;
    if(b.y < -b.r - 90) Object.assign(b, makeBalloon(false));
    const dx = b.x - pointer.x, dy = b.y - pointer.y;
    if(Math.sqrt(dx*dx + dy*dy) < b.r + 12) popBalloon(b);

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.sin(b.angle) * .06);
    ctx.globalAlpha = .70;

    // string
    ctx.strokeStyle = "rgba(255,255,255,.26)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, b.r + 5);
    ctx.bezierCurveTo(10, b.r + 36, -14, b.r + 76, 7, b.r + 114);
    ctx.stroke();

    // body
    ctx.beginPath();
    ctx.moveTo(0, b.r);
    ctx.bezierCurveTo(-b.r*1.12, b.r*.8,  -b.r*1.2, -b.r*1.1, 0, -b.r*1.2);
    ctx.bezierCurveTo( b.r*1.2,  -b.r*1.1, b.r*1.12,  b.r*.8,  0,  b.r);
    ctx.closePath();
    const g = ctx.createRadialGradient(-b.r*.35, -b.r*.42, 2, 0, 0, b.r*1.55);
    g.addColorStop(0, b.colors[1]);
    g.addColorStop(.42, b.colors[0]);
    g.addColorStop(1, b.colors[2]);
    ctx.fillStyle = g;
    ctx.fill();

    // shine
    ctx.fillStyle = "rgba(255,255,255,.40)";
    ctx.beginPath();
    ctx.ellipse(-b.r*.32, -b.r*.42, b.r*.18, b.r*.34, .4, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  /* ── burst ────────────────────────────────────────────────────────────── */
  function burst(x, y, count){
    for(let i = 0; i < count; i++){
      const angle = Math.PI*2*(i/count) + rand(-.1,.1);
      const speed = rand(1.5, 7.2);
      particles.push({
        x, y,
        vx: Math.cos(angle)*speed,
        vy: Math.sin(angle)*speed,
        life: rand(54, 110), ttl: 110,
        size: rand(1.2, 3.4), hue: color(),
        sparkle: Math.random() > .65
      });
    }
  }

  /* ── rocket ───────────────────────────────────────────────────────────── */
  function launch(){
    rockets.push({
      x: rand(innerWidth*.08, innerWidth*.92),
      y: innerHeight + 20,
      vx: rand(-.9, .9),
      vy: rand(-11, -7.5),
      targetY: rand(innerHeight*.10, innerHeight*.46),
      hue: color()
    });
  }

  function onPointerMove(e){
    pointer.x = e.clientX; pointer.y = e.clientY;
    if(reduceMotion || !overlay?.classList.contains("ba-show")) return;
    if(Math.random() < .12) burst(e.clientX, e.clientY, 10);
  }

  /* ── draw loop ────────────────────────────────────────────────────────── */
  function draw(){
    raf = requestAnimationFrame(draw);
    if(!ctx) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = "lighter";

    balloons.forEach(drawBalloon);
    if(Math.random() < .042) launch();

    rockets = rockets.filter(r => {
      r.x += r.vx; r.y += r.vy; r.vy += .10;
      ctx.beginPath();
      ctx.fillStyle = r.hue;
      ctx.arc(r.x, r.y, 2.4, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.32)";
      ctx.fillRect(r.x-.7, r.y+6, 1.4, 18);
      if(r.y <= r.targetY || r.vy > -2){
        burst(r.x, r.y, Math.floor(rand(44, 80)));
        return false;
      }
      return true;
    });

    particles = particles.filter(p => {
      p.x += p.vx; p.y += p.vy;
      p.vx *= .987; p.vy = p.vy*.987 + .044;
      p.life -= 1;
      const a = Math.max(0, p.life / p.ttl);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.hue;
      if(p.sparkle){
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * .08);
        ctx.fillRect(-p.size*2, -p.size/2, p.size*4, p.size);
        ctx.fillRect(-p.size/2, -p.size*2, p.size, p.size*4);
        ctx.restore();
      }else{
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fill();
      }
      return p.life > 0;
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* ── Firestore stats ──────────────────────────────────────────────────── */
  function statTargetEmail(){
    return (cfg.targets?.emails || []).map(norm).find(Boolean) || getIdentity().email || "";
  }

  function toMillis(v){
    if(!v) return 0;
    if(typeof v.toMillis === "function") return v.toMillis();
    if(typeof v.toDate   === "function") return v.toDate().getTime();
    if(typeof v === "number") return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }

  function ratingOf(d){
    const n = Number(d?.review?.rating ?? d?.rating ?? d?.reviewRating ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(5, Math.round(n))) : 0;
  }

  function statusOf(d){
    return String(d?.review?.status || d?.status || "pending_review").toLowerCase();
  }

  async function collectStats(){
    const s = String(cfg.statsPeriodStart || "2026-05-21").split("-").map(Number);
    const e = String(cfg.statsPeriodEnd   || "2026-06-21").split("-").map(Number);
    const periodStart = new Date(s[0], (s[1]||1)-1, s[2]||1,  0, 0, 0, 0);
    const periodEnd   = new Date(e[0], (e[1]||1)-1, e[2]||1, 23,59,59,999);
    const base = {
      total: 0, starsTotal: 0, avgRating: 0,
      fiveStars: 0, approved: 0, reviewed: 0, pending: 0,
      distribution: {1:0,2:0,3:0,4:0,5:0},
      period: `${cfg.statsPeriodStart || "2026-05-21"}  →  ${cfg.statsPeriodEnd || "2026-06-21"}`
    };
    if(!cfg.statsEnabled) return base;
    const email = statTargetEmail();
    if(!email) return base;
    try{
      const appMod = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js");
      const fsMod  = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js");
      const firebaseConfig = {
        apiKey: "AIzaSyBvmHh6-KVlKNATzbfMk3hIswbMCrBZwf4",
        authDomain: "pharma-triage-5d165.firebaseapp.com",
        projectId: "pharma-triage-5d165",
        storageBucket: "pharma-triage-5d165.firebasestorage.app",
        messagingSenderId: "1080517928737",
        appId: "1:1080517928737:web:9110f120203d0e6b7b0060"
      };
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      const db  = fsMod.getFirestore(app);
      const q   = fsMod.query(
        fsMod.collection(db, "consultations"),
        fsMod.where("agentEmail", "==", email)
      );
      const snap = await fsMod.getDocs(q);
      snap.forEach(docSnap => {
        const d  = docSnap.data() || {};
        const tm = toMillis(d.createdAt);
        if(tm && (tm < periodStart.getTime() || tm > periodEnd.getTime())) return;
        base.total += 1;
        const r = ratingOf(d);
        if(r){
          base.reviewed      += 1;
          base.starsTotal    += r;
          base.distribution[r] += 1;
          if(r === 5) base.fiveStars += 1;
        }
        if(statusOf(d) === "approved") base.approved += 1;
      });
      base.pending    = Math.max(0, base.total - base.approved);
      base.avgRating  = base.reviewed ? +(base.starsTotal / base.reviewed).toFixed(1) : 0;
    }catch(err){
      console.warn("pt-v151 firestore stats", err);
    }
    return base;
  }

  /* ── count-up animation ──────────────────────────────────────────────── */
  function animateValue(el, target, suffix, duration){
    if(!el) return;
    const isDecimal = String(target).includes(".") || Number(target) % 1 !== 0;
    const start = Date.now();
    const to    = Number(target) || 0;
    (function step(){
      const p    = Math.min(1, (Date.now() - start) / duration);
      const ease = 1 - Math.pow(1 - p, 3);
      const val  = to * ease;
      el.textContent = (isDecimal ? val.toFixed(1) : Math.round(val)) + (suffix || "");
      if(p < 1) requestAnimationFrame(step);
    })();
  }

  /* ── hydrate stats cards ─────────────────────────────────────────────── */
  async function hydrateStats(){
    const stats = await collectStats();
    if(!overlay?.classList.contains("ba-show")) return;

    const cards  = overlay.querySelectorAll(".ba-stat");
    const values = [
      { value: stats.total,      suffix: "",   extra: `${stats.reviewed} reviewed` },
      { value: stats.starsTotal, suffix: "",   extra: `across ${stats.reviewed} rated` },
      { value: stats.avgRating,  suffix: "/5", extra: starsLine(stats.distribution) },
      { value: stats.fiveStars,  suffix: "",   extra: "perfect 5/5 ratings" },
      { value: stats.approved,   suffix: "",   extra: `${stats.pending} pending` }
    ];

    cards.forEach((card, i) => {
      const item = values[i] || { value: 0, suffix: "" };
      const delay = 11000 + i * 4400;
      setTimeout(() => animateValue(card.querySelector(".ba-stat-value"), item.value, item.suffix, 2400), delay);
      const extra = card.querySelector(".ba-stat-extra");
      if(extra) extra.textContent = item.extra || "";
    });

    const period = overlay.querySelector(".ba-period");
    if(period && stats.period) period.textContent = "Period: " + stats.period;
  }

  function starsLine(dist){
    return [5,4,3,2,1].map(n => `${n}★ ${dist[n]||0}`).join("  ·  ");
  }

  /* ── finale ───────────────────────────────────────────────────────────── */
  function runFinale(){
    const total = Math.max(12000, Number(cfg.sequenceDurationMs || 55000));
    clearTimeout(sequenceTimer);
    sequenceTimer = setTimeout(() => {
      if(!overlay?.classList.contains("ba-show")) return;
      overlay.classList.add("ba-finale");
      for(let i = 0; i < 12; i++) setTimeout(launch, i * 170);
      balloons.forEach((b, i) => setTimeout(() => popBalloon(b), i * 60));
    }, Math.max(1000, total - 9000));
  }

  /* ── show / hide ─────────────────────────────────────────────────────── */
  function show(){
    if(hasShown && !window.__BA_FORCE__) return;
    hasShown = true;
    window.__BA_FORCE__ = false;
    build();
    resize();
    window.addEventListener("resize", resize);
    overlay.classList.remove("ba-finale");
    overlay.classList.add("ba-show");
    for(let i = 0; i < 8; i++) setTimeout(launch, i * 240);
    if(!reduceMotion) draw();
    hydrateStats();
    runFinale();
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hide, Math.max(1000, Number(cfg.displayDurationMs || 600000)));
    if(cfg.showOncePerVersion){
      try{ localStorage.setItem("pt-ba-seen-" + cfg.version, "1"); }catch(e){}
    }
  }

  function hide(){
    clearTimeout(closeTimer);
    clearTimeout(sequenceTimer);
    if(raf){ cancelAnimationFrame(raf); raf = 0; }
    rockets = []; particles = []; balloons = [];
    overlay?.classList.remove("ba-show", "ba-finale");
    window.removeEventListener("resize", resize);
  }

  /* ── wait for user identity to load ─────────────────────────────────── */
  function waitForIdentity(){
    let tries = 0;
    const tick = () => {
      tries += 1;
      if(canShow()) show();
      else if(!hasShown && tries < 90) setTimeout(tick, 1000);
    };
    tick();
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  window.BestAchieverCelebration = {
    show:   function(){ window.__BA_FORCE__ = true; hasShown = false; show(); },
    hide,
    config: cfg
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", waitForIdentity);
  }else{
    waitForIdentity();
  }
})();

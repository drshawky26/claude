/* PT Lite Mode + Device Center agent — shared across pages (2026-07-04).
   Two jobs, both self-contained (no per-page wiring beyond the existing
   PTLite.sync({db,doc,setDoc,uid,profile}) call):

   1) LITE MODE — detects rough device capability and, when the admin turns on
      liteMode for a user, injects one small stylesheet that kills the
      decorative-only continuous work that is heavy on old integrated-GPU
      machines (WebGL backgrounds, blur(100px) orbs, always-spinning conic
      rings, every CSS animation/transition). Decorative only — nothing here is
      load-bearing. Does not touch layout or colors.

   2) DEVICE CENTER — reports a rich device-capability snapshot to the user's own
      users/{uid}.deviceInfo doc so the admin can see + manage every device from
      devices.html, and listens live on that doc for admin commands
      (liteMode / refresh / logout / message). The live listener is set up here
      via dynamic import() of the SAME Firebase module URLs the page already
      loaded (ES modules are per-URL singletons, so onSnapshot/getAuth bind to
      the page's existing app + db) — that keeps every page working with zero
      extra imports on the page side.

   Browser-sandbox honesty: we can READ capability signals and PUSH soft
   commands (reload / sign-out / on-screen message), but true remote control of
   the screen/files is impossible from a web page — that needs installed
   software. */
(function(){
  var FB_VER = '12.13.0';
  var FS_URL   = 'https://www.gstatic.com/firebasejs/'+FB_VER+'/firebase-firestore.js';
  var AUTH_URL = 'https://www.gstatic.com/firebasejs/'+FB_VER+'/firebase-auth.js';

  /* ---- capability detection ---------------------------------------------- */
  function gpuString(){
    try{
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if(gl){
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if(dbg) return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      }
    }catch(e){}
    return null;
  }

  // Rough OS + browser from the UA string. Good enough for an at-a-glance
  // fleet view; not meant to be forensically exact.
  function osBrowser(ua){
    ua = ua || '';
    var os = 'غير معروف';
    if(/Windows NT 10/.test(ua)) os='Windows 10/11';
    else if(/Windows NT 6\.3/.test(ua)) os='Windows 8.1';
    else if(/Windows NT 6\.1/.test(ua)) os='Windows 7';
    else if(/Windows/.test(ua)) os='Windows';
    else if(/Android ([\d.]+)/.test(ua)) os='Android '+(RegExp.$1);
    else if(/iPhone|iPad|iPod/.test(ua)) os='iOS';
    else if(/Mac OS X/.test(ua)) os='macOS';
    else if(/Linux/.test(ua)) os='Linux';
    var br = 'غير معروف';
    if(/Edg\//.test(ua)) br='Edge';
    else if(/OPR\/|Opera/.test(ua)) br='Opera';
    else if(/SamsungBrowser/.test(ua)) br='Samsung Internet';
    else if(/Chrome\/([\d.]+)/.test(ua)){ br='Chrome '+(RegExp.$1.split('.')[0]); }
    else if(/Firefox\/([\d.]+)/.test(ua)){ br='Firefox '+(RegExp.$1.split('.')[0]); }
    else if(/Version\/([\d.]+).*Safari/.test(ua)){ br='Safari '+(RegExp.$1.split('.')[0]); }
    return { os: os, browser: br };
  }

  // Synchronous core signals (instant, no async APIs).
  function detect(){
    var ob = osBrowser(navigator.userAgent);
    var net = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    return {
      memory: navigator.deviceMemory || null,
      cores: navigator.hardwareConcurrency || null,
      gpu: gpuString(),
      ua: navigator.userAgent,
      os: ob.os,
      browser: ob.browser,
      platform: navigator.platform || null,
      lang: navigator.language || null,
      tz: (function(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){ return null; } })(),
      screen: (screen.width||0)+'x'+(screen.height||0),
      viewport: (window.innerWidth||0)+'x'+(window.innerHeight||0),
      dpr: window.devicePixelRatio || 1,
      colorDepth: screen.colorDepth || null,
      touch: navigator.maxTouchPoints || 0,
      online: navigator.onLine !== false,
      netType: net ? (net.effectiveType || null) : null,
      netDownlink: net ? (net.downlink || null) : null,
      netRtt: net ? (net.rtt || null) : null,
      netSave: net ? (net.saveData === true) : null
    };
  }

  // Async augmentation (battery + storage quota). Never blocks the core report:
  // resolves with whatever it could gather within a short window.
  function detectFull(){
    var info = detect();
    var jobs = [];
    try{
      if(navigator.getBattery){
        jobs.push(navigator.getBattery().then(function(b){
          info.batteryLevel = Math.round((b.level||0)*100);
          info.batteryCharging = !!b.charging;
        }).catch(function(){}));
      }
    }catch(e){}
    try{
      if(navigator.storage && navigator.storage.estimate){
        jobs.push(navigator.storage.estimate().then(function(est){
          if(est){
            info.storageQuota = est.quota || null;
            info.storageUsage = est.usage || null;
          }
        }).catch(function(){}));
      }
    }catch(e){}
    var guard = new Promise(function(res){ setTimeout(res, 1500); });
    return Promise.race([Promise.all(jobs), guard]).then(function(){ return info; });
  }

  function isWeak(info){
    if(!info) return false;
    if(info.memory && info.memory <= 4) return true;
    if(info.cores && info.cores <= 2) return true;
    if(info.gpu && /HD Graphics (2000|3000|4000)|GMA|Mesa DRI Intel|SwiftShader/i.test(info.gpu)) return true;
    return false;
  }

  /* ---- lite-mode stylesheet ---------------------------------------------- */
  function apply(on){
    document.documentElement.classList.toggle('pt-lite', !!on);
    try{ localStorage.setItem('pt_lite', on ? '1' : '0'); }catch(e){}
  }

  // Apply the last-known value immediately (before auth/Firestore resolve) so a
  // page that will end up lite anyway never even starts the heavy WebGL/CSS
  // work for that first paint.
  try{ if(localStorage.getItem('pt_lite') === '1') document.documentElement.classList.add('pt-lite'); }catch(e){}

  var css =
    'html.pt-lite *,html.pt-lite *::before,html.pt-lite *::after{' +
      'animation-play-state:paused!important;animation-duration:.001ms!important;' +
      'animation-delay:0s!important;transition-duration:.05s!important}' +
    'html.pt-lite #hv-webgl-bg,html.pt-lite #lv-webgl-bg,html.pt-lite .orb{display:none!important}' +
    'html.pt-lite .base-intake-section::before,html.pt-lite .v138-history-panel::before,' +
    'html.pt-lite .v126-live-card::before,html.pt-lite .q-card::before,' +
    'html.pt-lite .ov-day::before,html.pt-lite .ov-day-today::before{display:none!important}';
  var styleEl = document.createElement('style');
  styleEl.setAttribute('data-pt-lite', '1');
  styleEl.textContent = css;
  (document.head || document.documentElement).appendChild(styleEl);

  /* ---- on-screen message (a "message" command from the admin) ------------- */
  function showMessage(text){
    if(!text) return;
    var wrap = document.getElementById('pt-remote-msg');
    if(wrap) wrap.parentNode.removeChild(wrap);
    wrap = document.createElement('div');
    wrap.id = 'pt-remote-msg';
    wrap.setAttribute('dir','rtl');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;'+
      'justify-content:center;background:rgba(6,10,22,.72);backdrop-filter:blur(6px);'+
      '-webkit-backdrop-filter:blur(6px);font-family:Tajawal,system-ui,sans-serif';
    var card = document.createElement('div');
    card.style.cssText = 'max-width:440px;width:calc(100% - 40px);background:linear-gradient(160deg,#141f3c,#0e1730);'+
      'border:1px solid rgba(201,168,76,.35);border-radius:20px;padding:28px 26px;'+
      'box-shadow:0 30px 80px -20px rgba(0,0,0,.7);text-align:center;color:#eaf0ff';
    var icon = document.createElement('div');
    icon.textContent = '📢';
    icon.style.cssText = 'font-size:44px;margin-bottom:10px';
    var body = document.createElement('div');
    body.textContent = String(text);
    body.style.cssText = 'font-size:17px;line-height:1.7;font-weight:600;white-space:pre-wrap;margin-bottom:20px';
    var btn = document.createElement('button');
    btn.textContent = 'تمام 👍';
    btn.style.cssText = 'font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;border:none;'+
      'border-radius:12px;padding:11px 30px;background:linear-gradient(135deg,#c9a84c,#e6c86a);color:#1a1405';
    btn.onclick = function(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    card.appendChild(icon); card.appendChild(body); card.appendChild(btn);
    wrap.appendChild(card);
    (document.body || document.documentElement).appendChild(wrap);
  }

  /* ---- attention beep (best-effort; browsers may block audio until the user
     has interacted with the page — the visual message still shows either way) */
  function beep(){
    try{
      var AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
      var ac = new AC(); var o = ac.createOscillator(); var g = ac.createGain();
      o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime+0.55);
      o.start(); o.stop(ac.currentTime+0.6);
    }catch(e){}
  }

  /* ---- admin command handling (idempotent via a per-command ack) ---------- */
  // Each command carries a unique id (Date.now() when the admin issues it). We
  // ack once by remembering the last id we acted on in localStorage, so the
  // live listener re-firing (including from our own ack write) never re-runs it.
  function handleCommand(cmd, ctx){
    if(!cmd || !cmd.id) return;
    var ackKey = 'pt_cmd_ack';
    var already;
    try{ already = localStorage.getItem(ackKey); }catch(e){}
    if(String(already) === String(cmd.id)) return;
    try{ localStorage.setItem(ackKey, String(cmd.id)); }catch(e){}

    // Best-effort ack back to Firestore so the admin sees "received" in
    // devices.html. Stays inside deviceInfo → still passes the rules' hasOnly.
    function ack(){
      try{
        if(ctx && ctx.db && ctx.doc && ctx.setDoc && ctx.uid){
          ctx.setDoc(ctx.doc(ctx.db,'users',ctx.uid),
            { deviceInfo: { lastCmdId: cmd.id, lastCmdType: cmd.type||'', lastCmdAt: Date.now() } },
            { merge:true }).catch(function(){});
        }
      }catch(e){}
    }

    if(cmd.type === 'message'){
      ack();
      if(cmd.sound) beep();
      showMessage(cmd.text || '');
    }else if(cmd.type === 'refresh'){
      ack();
      setTimeout(function(){ location.reload(); }, 400);
    }else if(cmd.type === 'logout'){
      ack();
      import(AUTH_URL).then(function(m){
        try{ m.signOut(m.getAuth()).finally(function(){ location.reload(); }); }
        catch(e){ location.reload(); }
      }).catch(function(){ location.reload(); });
    }else if(cmd.type === 'reportnow'){
      // Force a fresh capability report even if nothing changed (useful when a
      // signal came back unknown, e.g. RAM, or specs look stale in the console).
      ack();
      try{
        detectFull().then(function(info){
          if(ctx && ctx.db && ctx.doc && ctx.setDoc && ctx.uid){
            ctx.setDoc(ctx.doc(ctx.db,'users',ctx.uid),
              { deviceInfo: Object.assign({}, info, { weak: isWeak(info), at: Date.now() }) },
              { merge:true }).catch(function(){});
          }
        });
      }catch(e){}
    }else if(cmd.type === 'navigate'){
      // Send the device to one of the app's own pages. Restricted to same-origin
      // for safety — we never navigate a colleague's browser off-site.
      ack();
      try{
        var target = new URL(cmd.url || '', location.origin);
        if(target.origin === location.origin){
          setTimeout(function(){ location.href = target.href; }, 300);
        }
      }catch(e){}
    }else if(cmd.type === 'clearcache'){
      // Wipe the cached page shell + local data, then hard-reload. Directly fixes
      // the "my edits aren't showing" stale-cache problem. We KEEP the command ack
      // key (and pt_lite) across the wipe so the reload doesn't re-fire this in a
      // loop and lite mode stays applied on the very first paint.
      ack();
      var keepId = String(cmd.id);
      var keepLite = null;
      try{ keepLite = localStorage.getItem('pt_lite'); }catch(e){}
      try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
      try{
        localStorage.setItem('pt_cmd_ack', keepId);
        if(keepLite != null) localStorage.setItem('pt_lite', keepLite);
      }catch(e){}
      var reload = function(){ location.reload(); };
      try{
        if(window.caches && caches.keys){
          caches.keys().then(function(ks){
            return Promise.all(ks.map(function(k){ return caches.delete(k); }));
          }).then(reload).catch(reload);
        }else reload();
      }catch(e){ reload(); }
    }
  }

  /* ---- public API --------------------------------------------------------- */
  window.PTLite = {
    detect: detect,
    detectFull: detectFull,
    isWeak: isWeak,
    apply: apply,
    showMessage: showMessage,
    /* Call once after auth resolves: PTLite.sync({db,doc,setDoc,uid,profile}) */
    sync: function(opts){
      opts = opts || {};
      apply(opts.profile && opts.profile.liteMode === true);
      var ctx = { db:opts.db, doc:opts.doc, setDoc:opts.setDoc, uid:opts.uid };

      // 1) Report a fresh capability snapshot (only when it actually changed, to
      //    avoid a write on every page load).
      try{
        detectFull().then(function(info){
          var prev = opts.profile && opts.profile.deviceInfo;
          var changed = !prev || prev.ua !== info.ua || prev.memory !== info.memory ||
            prev.cores !== info.cores || prev.gpu !== info.gpu || prev.os !== info.os ||
            prev.browser !== info.browser || prev.viewport !== info.viewport ||
            prev.netType !== info.netType || prev.batteryLevel !== info.batteryLevel;
          if(changed && ctx.db && ctx.doc && ctx.setDoc && ctx.uid){
            ctx.setDoc(ctx.doc(ctx.db,'users',ctx.uid),
              { deviceInfo: Object.assign({}, info, { weak: isWeak(info), at: Date.now() }) },
              { merge:true }).catch(function(){});
          }
        });
      }catch(e){}

      // Public IP as seen from outside (NOT the machine's LAN address — browsers
      // can't expose that). Same office router → same value; still useful to
      // spot logins from outside the usual network. Fetched separately so a slow
      // network call never delays the (instant, local) capability report.
      try{
        var prevIp = opts.profile && opts.profile.deviceInfo && opts.profile.deviceInfo.ip;
        if(ctx.db && ctx.doc && ctx.setDoc && ctx.uid){
          fetch('https://api.ipify.org?format=json')
            .then(function(r){ return r.json(); })
            .then(function(j){
              var ip = j && j.ip;
              if(!ip || ip === prevIp) return;
              ctx.setDoc(ctx.doc(ctx.db,'users',ctx.uid), { deviceInfo: { ip: ip } }, { merge:true }).catch(function(){});
            }).catch(function(){});
        }
      }catch(e){}

      // 2) Live listener on our own user doc: react to admin changes in real time
      //    (lite mode flip + one-shot commands). Self-contained via dynamic
      //    import of the same firestore module URL the page already uses.
      try{
        if(ctx.db && ctx.doc && ctx.uid){
          import(FS_URL).then(function(fs){
            fs.onSnapshot(ctx.doc(ctx.db,'users',ctx.uid), function(snap){
              var p = snap && snap.exists() ? (snap.data()||{}) : {};
              apply(p.liteMode === true);
              handleCommand(p.deviceCommand, ctx);
            }, function(){});
          }).catch(function(){
            // No live channel available → fall back to the one-shot command from
            // the profile we already have (message still shows on load).
            handleCommand(opts.profile && opts.profile.deviceCommand, ctx);
          });
        }
      }catch(e){}
    }
  };
})();

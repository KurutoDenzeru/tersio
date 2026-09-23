(function() {
  var T = window.Tersio = {};
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGsap = !reduce && typeof window.gsap !== 'undefined';
  var hasST = hasGsap && typeof window.ScrollTrigger !== 'undefined';
  if (hasST) gsap.registerPlugin(ScrollTrigger);

  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function fmtShort(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  var CURS = {
    USD: { s: '$', d: 2 }, PHP: { s: '₱', d: 2 }, EUR: { s: '€', d: 2 }, GBP: { s: '£', d: 2 },
    JPY: { s: '¥', d: 0 }, KRW: { s: '₩', d: 0 }, SGD: { s: 'S$', d: 2 }, AUD: { s: 'A$', d: 2 },
    CAD: { s: 'C$', d: 2 }, INR: { s: '₹', d: 2 }
  };
  var FLAGS = { USD: '🇺🇸', PHP: '🇵🇭', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', KRW: '🇰🇷', SGD: '🇸🇬', AUD: '🇦🇺', CAD: '🇨🇦', INR: '🇮🇳' };
  // ponytail: static snapshot; live rates from frankfurter replace it when reachable
  var fx = { cur: 'USD', rates: { USD: 1, PHP: 58.7, EUR: 0.92, GBP: 0.79, JPY: 149.8, KRW: 1385, SGD: 1.34, AUD: 1.52, CAD: 1.37, INR: 88.2 }, live: false };
  try {
    var savedCur = localStorage.getItem('tersio-fx-cur');
    if (savedCur && CURS[savedCur]) fx.cur = savedCur;
    var savedFx = JSON.parse(localStorage.getItem('tersio-fx') || 'null');
    if (savedFx && savedFx.rates && savedFx.rates.USD === 1) fx.rates = savedFx.rates;
  } catch (e) { }
  var repaintFxPicker = function() {};
  // Shared by the hero picker and the settings currency pane: persist
  // server-side (fresh ephemeral port per run, so localStorage alone dies
  // on restart) and re-render live figures.
  function applyCurrency(k) {
    if (!CURS[k]) return;
    fx.cur = k;
    try { localStorage.setItem('tersio-fx-cur', fx.cur); } catch (e) { }
    if (window.location.protocol !== 'file:' && typeof fetch === 'function') {
      try {
        fetch('currency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: k }) }).catch(function() { });
      } catch (e) { }
    }
    repaintFxPicker();
    if (typeof DATA !== 'undefined' && DATA) render(DATA);
  }
  // Magnitude-aware decimals. Model prices keep falling, so a flat 2dp rounds
  // real spend down to "$0.00"; small amounts keep enough digits to stay
  // readable (0.000187, not 0). Larger amounts use the currency's own scale.
  function moneyDecimals(v, base) {
    var a = Math.abs(v);
    if (a >= 0.1 || a === 0) return base;
    if (a >= 0.001) return Math.max(base, 4);
    if (a >= 0.00001) return Math.max(base, 6);
    return Math.max(base, 8);
  }
  function fxMoney(v) {
    var c = CURS[fx.cur] || CURS.USD, r = fx.rates[fx.cur] || 1, amt = v * r;
    var d = moneyDecimals(amt, c.d);
    return c.s + amt.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  // Tooltips build innerHTML, and error notes come from providers, so they are
  // never interpolated raw.
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function countUp(el, target, money) {
    function text(v) { return money ? fxMoney(v) : fmt(Math.round(v)); }
    if (!hasGsap || target <= 0) { el.textContent = text(target); return; }
    var o = { v: 0 };
    gsap.to(o, { v: target, duration: 1.1, ease: 'power3.out', onUpdate: function() { el.textContent = text(o.v); } });
  }

  function tick() {
    var c = document.getElementById('clock');
    if (c) c.textContent = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  tick(); setInterval(tick, 1000);
  function currentTheme() {
    try { return localStorage.getItem('tersio-theme') || 'system'; } catch (e) { return 'system'; }
  }
  function paintThemeTabs() {
    var v = currentTheme();
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-val]'), function(b) {
      b.classList.toggle('on', b.getAttribute('data-theme-val') === v);
    });
  }
  function applyTheme(v) {
    if (v === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    try { localStorage.setItem('tersio-theme', v); } catch (e) { }
    paintThemeTabs();
  }
  applyTheme(currentTheme());
  (function initRail() {
    var rail = document.getElementById('rail');
    if (!rail || initRail.done) return;
    initRail.done = true;
    var N = 24, ticks = [];
    for (var i = 0; i < N; i++) {
      (function(i) {
        var b = document.createElement('button');
        b.type = 'button'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true');
        b.addEventListener('click', function() {
          var max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo({ top: max * (i / (N - 1)), behavior: 'smooth' });
        });
        rail.appendChild(b); ticks.push(b);
      })(i);
    }
    var queued = false;
    function paint() {
      queued = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var f = max > 0 ? window.scrollY / max : 0;
      ticks.forEach(function(b, j) { b.classList.toggle('lit', j / (N - 1) <= f); });
    }
    window.addEventListener('scroll', function() {
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    }, { passive: true });
    paint();
  })();
  (function initFx() {
    var btn = document.getElementById('fxBtn'), panel = document.getElementById('fxPanel'), cur = document.getElementById('fxCur');
    var keys = Object.keys(CURS), active = -1;
    function paint() {
      cur.textContent = FLAGS[fx.cur] + ' ' + fx.cur;
      Array.prototype.forEach.call(panel.children, function(o) {
        o.setAttribute('aria-selected', o.dataset.cur === fx.cur ? 'true' : 'false');
      });
    }
    function setCur(k) {
      fx.cur = k; active = keys.indexOf(k);
      applyCurrency(k);
      paint();
    }
    function open(show) {
      var willOpen = show === undefined ? panel.classList.contains('hidden') : show;
      panel.classList.toggle('hidden', !willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) mark(keys.indexOf(fx.cur));
    }
    function mark(i) {
      active = (i + keys.length) % keys.length;
      Array.prototype.forEach.call(panel.children, function(o, j) {
        o.classList.toggle('active', j === active);
      });
      var el = panel.children[active];
      if (el) el.focus();
    }
    keys.forEach(function(k) {
      var o = document.createElement('button');
      o.type = 'button'; o.className = 'fxopt mono'; o.dataset.cur = k;
      o.setAttribute('role', 'option');
      o.innerHTML = '<span>' + FLAGS[k] + ' ' + k + '</span><svg class="tick" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
      o.addEventListener('click', function() { setCur(k); open(false); btn.focus(); });
      o.addEventListener('mousemove', function() { mark(keys.indexOf(k)); });
      panel.appendChild(o);
    });
    paint();
    repaintFxPicker = paint;
    btn.addEventListener('click', function() { open(); });
    btn.addEventListener('keydown', function(ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(true); }
    });
    panel.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') { open(false); btn.focus(); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); mark(active + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); mark(active - 1); }
      else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setCur(keys[active]); open(false); btn.focus(); }
      else if (ev.key === 'Tab') open(false);
    });
    document.addEventListener('click', function(ev) {
      if (!panel.classList.contains('hidden') && !btn.contains(ev.target) && !panel.contains(ev.target)) open(false);
    });
    if (typeof fetch !== 'function' || typeof AbortController === 'undefined') return;
    var ctl = new AbortController();
    var to = setTimeout(function() { ctl.abort(); }, 4000);
    fetch('https://api.frankfurter.app/latest?from=USD', { signal: ctl.signal }).then(function(r) { return r.json(); }).then(function(j) {
      clearTimeout(to);
      if (!j || !j.rates) return;
      var ok = Object.keys(CURS).every(function(k) { return k === 'USD' || typeof j.rates[k] === 'number'; });
      if (!ok) return;
      fx.rates = Object.assign({ USD: 1 }, j.rates); fx.live = true;
      try { localStorage.setItem('tersio-fx', JSON.stringify({ rates: fx.rates, ts: Date.now() })); } catch (e) { }
      if (DATA) render(DATA);
    }).catch(function() { clearTimeout(to); });
  })();
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme-val]'), function(b) {
    b.addEventListener('click', function() { applyTheme(b.getAttribute('data-theme-val')); });
  });
  (function() {
    var sysMedia = window.matchMedia('(prefers-color-scheme: dark)');
    if (sysMedia && typeof sysMedia.addEventListener === 'function') sysMedia.addEventListener('change', function() {
      if (currentTheme() === 'system') applyTheme('system');
    });
  })();
  var DATA = null;
  var renderHooks = [];
  function render(d) {
    DATA = d;
    T.renderMain(d);
    for (var i = 0; i < renderHooks.length; i++) renderHooks[i](d);
  }
  T.getData = function() { return DATA; };
  T.render = render;
  T.onRender = function(fn) { renderHooks.push(fn); };
  T.load = load;
  var tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.id = 'tip'; tipEl.className = 'mono'; tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, x, y) {
    var t = tip();
    t.innerHTML = html;
    if (window.lucide) lucide.createIcons();
    t.classList.add('show');
    moveTip(x, y);
  }
  function moveTip(x, y) {
    if (!tipEl) return;
    var w = 300, h = tipEl.offsetHeight || 220;
    var lx = x + 16 > window.innerWidth - w ? x - w - 12 : x + 16;
    var ly = y + 16 > window.innerHeight - h ? y - h - 12 : y + 16;
    tipEl.style.left = Math.max(8, lx) + 'px';
    tipEl.style.top = Math.max(8, ly) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

  var seen = new WeakSet();
  function observe() {
    var els = document.querySelectorAll('.rise');
    if (!('IntersectionObserver' in window) || reduce) {
      els.forEach(function(el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting && !seen.has(e.target)) {
          seen.add(e.target); e.target.classList.add('in'); io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function(el) { if (!seen.has(el)) io.observe(el); });
  }
  var lastJson = '';
  function load() {
    // Served mode only: file:// exports have no data.json endpoint, so
    // polling there would just burn cycles on 404s.
    if (window.location.protocol === 'file:') return;
    // Skip background tabs: no render work while hidden, instant refresh on return.
    if (document.hidden) return;
    fetch('data.json').then(function(r) { return r.json(); }).then(function(d) {
      var json = JSON.stringify(d);
      if (json === lastJson) return;
      lastJson = json;
      render(d);
    }).catch(function() {
      var cards = document.getElementById('modelCards');
      if (cards && !cards.children.length) cards.innerHTML = '<div class="empty md:col-span-3">' + T.emptyState('cloud-off', 'Could not load data', 'Serve with tersio gain instead of opening this file directly.') + '</div>';
      if (window.lucide) lucide.createIcons();
      observe();
    });
  }
  // Live view: re-read data.json every 5s while served and visible; identical
  // payloads skip render. The manual Reload button stays as an instant refresh.
  setInterval(load, 5000);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) load(); });
  function toast(title, desc, icon) {
    var wrap = document.querySelector('.toaster');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toaster';
      wrap.popover = 'manual';
      document.body.appendChild(wrap);
      if (wrap.showPopover) wrap.showPopover(); // top layer: paints above the native settings dialog
    }
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span class="toast-icon"><i data-lucide="' + (icon || 'check') + '" class="size-4"></i></span><div><p class="toast-title"></p><p class="toast-desc"></p></div>';
    el.querySelector('.toast-title').textContent = title;
    el.querySelector('.toast-desc').textContent = desc;
    wrap.appendChild(el);
    if (window.lucide) lucide.createIcons();
    setTimeout(function() {
      el.classList.add('out');
      setTimeout(function() { el.remove(); }, 200);
    }, 4000);
  }
  (function() {
    var dlg = document.getElementById('settings');
    if (dlg && typeof dlg.showModal === 'function') {
      document.getElementById('settingsBtn').addEventListener('click', function() { dlg.showModal(); });
      document.getElementById('settingsClose').addEventListener('click', function() { dlg.close(); });
      dlg.addEventListener('click', function(ev) { if (ev.target === dlg) dlg.close(); });
    }
    var md = document.getElementById('modelDialog');
    if (md && typeof md.showModal === 'function') {
      document.getElementById('mdClose').addEventListener('click', function() { md.close(); });
      md.addEventListener('click', function(ev) { if (ev.target === md) md.close(); });
      md.addEventListener('close', function() { document.body.style.overflow = ''; });
      new MutationObserver(function() {
        if (md.open) document.body.style.overflow = 'hidden';
      }).observe(md, { attributes: true, attributeFilter: ['open'] });
    }
  })();
  (function() {
    var resetBtn = document.getElementById('reset');
    if (!resetBtn) return;
    if (window.location.protocol === 'file:') { resetBtn.style.display = 'none'; return; }
    var label = document.getElementById('resetLabel');
    resetBtn.addEventListener('click', function() {
      if (resetBtn.dataset.armed) {
        delete resetBtn.dataset.armed;
        label.textContent = 'Clearing…';
        fetch('reset', { method: 'POST' }).then(function(r) { return r.json(); }).then(function() {
          label.textContent = 'Reset';
          load();
          toast('Statistics reset', 'The usage statistics view now starts fresh. Transcripts and RTK history were never touched.', 'rotate-ccw');
        }).catch(function() {
          label.textContent = 'Reset';
          toast('Reset failed', 'Could not reach the server. Try again.', 'circle-alert');
        });
      } else {
        resetBtn.dataset.armed = '1';
        label.textContent = 'Sure?';
        setTimeout(function() { delete resetBtn.dataset.armed; if (label.textContent === 'Sure?') label.textContent = 'Reset'; }, 3000);
      }
    });
  })();
  load();
  observe();
  T.fmt = fmt;
  T.fmtShort = fmtShort;
  T.CURS = CURS;
  T.FLAGS = FLAGS;
  T.fx = fx;
  T.fxMoney = fxMoney;
  T.esc = esc;
  T.countUp = countUp;
  T.applyCurrency = applyCurrency;
  T.applyTheme = applyTheme;
  T.toast = toast;
  T.showTip = showTip;
  T.moveTip = moveTip;
  T.hideTip = hideTip;
  T.observe = observe;
  T.reduce = reduce;
  T.hasGsap = hasGsap;
  T.hasST = hasST;
})();

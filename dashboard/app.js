(function() {
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

  var OPENAI_SVG = '<svg viewBox="0 0 24 24" fill="#000" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>';
  var PROVIDERS = [
    [/openai|codex|gpt-|o1/i, 'OpenAI', 'openai', '#fff', OPENAI_SVG],
    [/muse/i, 'Meta', 'meta', '#0082fb'],
    [/deepseek/i, 'DeepSeek', 'deepseek', '#4d6bfe'],
    [/qwen|qwq/i, 'Qwen', 'qwen', '#6950EF'],
    [/glm|z-ai|zhipu/i, 'Z.ai', 'zdotai', '#2D2D2D'],
    [/mimo/i, 'Xiaomi', 'xiaomi', '#ff6900'],
    [/kimi|moonshot/i, 'Moonshot', 'kimi', '#a855f7'],
    [/minimax/i, 'MiniMax', 'minimax', '#e11d48'],
    [/nemotron|nvidia/i, 'NVIDIA', 'nvidia', '#76b900'],
    [/mistral/i, 'Mistral', 'mistralai', '#ff7000'],
    [/claude|anthropic/i, 'Anthropic', 'anthropic', '#d97757'],
    [/gemini|google|gemma/i, 'Google', 'google', '#4285F4'],
  ];
  function vendorOf(model) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i][0].test(model)) return { name: PROVIDERS[i][1], slug: PROVIDERS[i][2], color: PROVIDERS[i][3], svg: PROVIDERS[i][4] };
    }
    return { name: 'Other', slug: '', color: '#71717a' };
  }
  // Brand glyph: inline SVG when the provider ships one (OpenAI), else the
  // Simple Icons CDN; unknown / Other providers render a clean Lucide
  // sparkles icon with no solid background as a placeholder.
  function brandHTML(v, small) {
    if (v.svg) {
      return '<span class="brandmark' + (small ? ' sm' : '') + '" style="background:' + v.color + '" title="' + v.name + '">' + v.svg + '</span>';
    }
    if (!v.slug) {
      return '<span class="brandmark placeholder' + (small ? ' sm' : '') + '" title="' + v.name + '">' +
        '<i data-lucide="sparkles" class="fb" style="display:grid"></i></span>';
    }
    var icon = '<img src="https://cdn.simpleicons.org/' + v.slug + '/white" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';">';
    var fb = '<i data-lucide="sparkles" class="fb"></i>';
    return '<span class="brandmark' + (small ? ' sm' : '') + '" style="background:' + v.color + '" title="' + v.name + '">' + icon + fb + '</span>';
  }
  var PALETTE = ['#34d399', '#818cf8', '#22d3ee', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf'];

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Absolute local stamp for the When column: "Sep 18, 11:14:08 PM". The
  // column is sortable, and a relative label made that ordering unreadable.
  function whenStamp(ts) {
    var d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }
  // Per-request generation time + output throughput from the message-level
  // `duration` (ms). Missing → '–'. Throughput uses output tokens since
  // that is what streams to the user during the measured window.
  function fmtDur(ms) {
    if (ms === undefined) return '–';
    var s = ms / 1000;
    return (s < 10 ? s.toFixed(1) : Math.round(s)) + 's';
  }
  function speedText(r) {
    if (r.d === undefined) return '–';
    var tps = r.d > 0 ? r.o / (r.d / 1000) : 0;
    return fmtDur(r.d) + ' ⚡' + (tps < 10 ? tps.toFixed(1) : Math.round(tps)) + '/s';
  }
  function speedTitle(r) {
    if (r.d === undefined) return 'no duration recorded';
    var tps = r.d > 0 ? r.o / (r.d / 1000) : 0;
    return '⏱ ' + (r.d / 1000).toFixed(1) + 's elapsed with the model, ⚡ ' + r.o + ' output tokens (' + tps.toFixed(1) + ' tok/s)';
  }
  function modelTotal(byModel, m) {
    var b = byModel[m] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return b.input + b.output + b.cacheRead + b.cacheWrite;
  }
  var DATA = null, cardsShown = false;
  function topModels(byModel, n) {
    return Object.keys(byModel).sort(function(a, b) { return modelTotal(byModel, b) - modelTotal(byModel, a); }).slice(0, n);
  }
  // Display form for folded keys: namespace stays lowercase, model segments
  // title-case with version dots kept (`deepseek-v4.1-flash` →
  // `Deepseek-V4.1-Flash`). Keys arrive folded, so this prettifies only.
  function displayModel(m) {
    var bare = String(m).replace(/(?::free|-free)$/i, '');
    function cap(s) {
      var low = s.toLowerCase();
      if (low === 'openai') return 'OpenAI';
      if (low === 'ai') return 'AI';
      if (/^\d+[a-z]+$/.test(low)) return low.toUpperCase();
      if (s.length <= 2) return s.toUpperCase();
      return s[0].toUpperCase() + s.slice(1).toLowerCase();
    }
    function seg(s) { return s.split('.').map(cap).join('.'); }
    function words(s) { return s.split(/[-_:]+/).filter(Boolean).map(seg).join('-'); }
    var slash = bare.indexOf('/');
    if (slash >= 0) return bare.slice(0, slash).toLowerCase() + '/' + words(bare.slice(slash + 1));
    return words(bare);
  }
  function allDays() {
    var set = {};
    Object.keys(DATA.byDay || {}).forEach(function(d) { set[d] = 1; });
    Object.keys(DATA.byDayModel || {}).forEach(function(d) { set[d] = 1; });
    return Object.keys(set).sort();
  }

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
  function dateHead(key) {
    var dt = new Date(key + 'T12:00:00');
    return isNaN(dt) ? key : dt.toLocaleString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }
  function shortName(m) { var d = displayModel(m); return d.length > 22 ? d.slice(0, 21) + '...' : d; }
  function tipDayHTML(key, total, rows) {
    var h = '<div class="tt">' + dateHead(key) + '</div><div class="tv">' + fmtShort(total) + ' total</div>';
    rows.forEach(function(r) {
      h += '<div class="tr"><span class="sw" style="background:' + r[2] + '"></span>' +
        '<span class="tn">' + shortName(r[0]) + '</span><span class="tvr">' + fmtShort(r[1]) + '</span></div>';
    });
    return h;
  }
  function tipModelHTML(m) {
    var b = (DATA.byModel || {})[m] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    var req = ((DATA.byModelMessages || {})[m]) || 0;
    var denom = b.input + b.cacheRead;
    var hit = denom ? (b.cacheRead / denom * 100).toFixed(1) + '%' : '-';
    var total = b.input + b.output + b.cacheRead + b.cacheWrite;
    var cb = ((DATA.byModelBucketUsd || {})[m]) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    var h = '<div class="tt">' + shortName(m) + '</div><div class="tv">' + fmtShort(total) + ' total (' + fxMoney(cb.input + cb.output + cb.cacheRead + cb.cacheWrite) + ')</div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">input</span><span class="tvr">' + fmt(b.input) + ' (' + fxMoney(cb.input) + ')</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">output</span><span class="tvr">' + fmt(b.output) + ' (' + fxMoney(cb.output) + ')</span></div>';
    if (b.cacheRead > 0) h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache read</span><span class="tvr">' + fmt(b.cacheRead) + ' (' + fxMoney(cb.cacheRead) + ')</span></div>';
    if (b.cacheWrite > 0) h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache write</span><span class="tvr">' + fmt(b.cacheWrite) + ' (' + fxMoney(cb.cacheWrite) + ')</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">requests</span><span class="tvr">' + fmt(req) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache hit</span><span class="tvr">' + hit + '</span></div>';
    return h;
  }
  function stampLocal(ts) {
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  // Per-request outcome. OMP records stopReason on every assistant turn and,
  // on failure, the HTTP errorStatus + errorMessage; toolUse turns are
  // ordinary completed turns, so only error and aborted stand apart.
  var STATUS_RANK = { error: 0, aborted: 1, completed: 2 };
  function statusRank(r) { var k = STATUS_RANK[r.st]; return k === undefined ? 2 : k; }
  function statusLabel(r) {
    if (r.st === 'error') return 'error' + (r.code ? ' ' + r.code : '');
    return r.st === 'aborted' ? 'aborted' : 'completed';
  }
  function statusColor(r) { return r.st === 'error' ? '#f87171' : r.st === 'aborted' ? '#fbbf24' : 'var(--accent)'; }
  // Cost precedence. A recorded charge > 0 is authoritative and shown bare.
  // A recording of exactly 0 usually means a free/local provider (every row on
  // a local model reports 0) and would blank the column, so those fall back to
  // the modeled figure carrying the dashboard's usual "~" estimate marker.
  // costRecorded() still reports the raw 0 so the tooltip can show both.
  function costRecorded(r) { return typeof r.usd === 'number'; }
  function costIsMeasured(r) { return costRecorded(r) && r.usd > 0; }
  function displayCost(r) { return costIsMeasured(r) ? r.usd : (r.est || 0); }

  function tipRecentHTML(r) {
    var tps = r.d !== undefined && r.d > 0 ? r.o / (r.d / 1000) : 0;
    var isEst = !costIsMeasured(r);
    var h = '<div class="tt">' + esc(shortName(r.m)) + '</div><div class="tv">' + stampLocal(r.t) + '</div>';
    h += '<div class="tr"><span class="sw" style="background:#fb923c"></span><span class="tn">input</span><span class="tvr">' + fmt(r.i) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">output</span><span class="tvr">' + fmt(r.o) + '</span></div>';
    if ((r.cr || 0) > 0) h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache read</span><span class="tvr">' + fmt(r.cr) + '</span></div>';
    if ((r.cw || 0) > 0) h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache write</span><span class="tvr">' + fmt(r.cw) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">elapsed</span><span class="tvr">' + fmtDur(r.d) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">speed</span><span class="tvr">' + (r.d !== undefined ? (tps < 10 ? tps.toFixed(1) : Math.round(tps)) + ' tok/s' : '–') + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:' + statusColor(r) + '"></span><span class="tn">status</span><span class="tvr">' + statusLabel(r) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">cost ' + (isEst ? '(est.)' : '(measured)') + '</span><span class="tvr">' + (isEst ? '~' : '') + fxMoney(displayCost(r)) + '</span></div>';
    if (costRecorded(r)) h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">charged</span><span class="tvr">' + fxMoney(r.usd) + '</span></div>';
    if (r.note) h += '<div class="tnote">' + esc(r.note) + '</div>';
    return h;
  }
  // Zone indicators: Lucide face per savings-bento metric. Coarse by design;
  // captions say est. where modeled. Icons paint via showTip/render createIcons.
  function zoneIcon(glyph, cls) { return '<i data-lucide="' + glyph + '" class="zface ' + cls + '"></i>'; }
  function co2Zone(g) {
    if (!(g > 0)) return ['minus', 'no data', ''];
    if (g <= 50) return ['sprout', 'light', 'good'];
    if (g <= 500) return ['smile', 'moderate', 'good'];
    if (g <= 2000) return ['meh', 'heavy', 'warn'];
    return ['flame', 'very high', 'bad'];
  }
  function levZone(x) {
    if (!(x > 0)) return ['minus', 'no savings yet', ''];
    if (x >= 3) return ['rocket', 'high leverage', 'good'];
    if (x >= 1) return ['smile', 'solid', 'good'];
    return ['meh', 'light', 'warn'];
  }
  function shareZone(p) {
    if (!(p > 0)) return ['minus', 'uncached', ''];
    if (p >= 80) return ['rocket', 'high', 'good'];
    if (p >= 50) return ['smile', 'good', 'good'];
    return ['meh', 'low', 'warn'];
  }
  function tipCo2HTML() {
    var z = co2Zone(DATA.co2g || 0);
    var h = '<div class="tt">CO2</div><div class="tv">~' + (DATA.co2g || 0).toFixed(1) + 'g est.</div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">zone</span><span class="tvr">' + zoneIcon(z[0], z[2]) + ' ' + z[1] + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">energy</span><span class="tvr">~' + (DATA.energyWh || 0).toFixed(1) + ' Wh</span></div>';
    return h;
  }
  function tipSavedHTML() {
    var usd = DATA.usd || 0, saved = DATA.savedUsd || 0;
    var lev = usd ? saved / usd : 0;
    var z = levZone(lev);
    var t = DATA.tokens || { cacheRead: 0 };
    var h = '<div class="tt">Saved by cache</div><div class="tv">' + fxMoney(saved) + ' est.</div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">zone</span><span class="tvr">' + zoneIcon(z[0], z[2]) + ' ' + z[1] + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">leverage</span><span class="tvr">x' + lev.toFixed(1) + ' per $1</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache read</span><span class="tvr">' + fmtShort(t.cacheRead || 0) + '</span></div>';
    return h;
  }
  function tipShareHTML(share, pp) {
    var z = shareZone(share);
    var t = DATA.tokens || { cacheRead: 0, cacheWrite: 0 };
    var h = '<div class="tt">Cache share</div><div class="tv">' + share + '%</div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">zone</span><span class="tvr">' + zoneIcon(z[0], z[2]) + ' ' + z[1] + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">read</span><span class="tvr">' + fmtShort(t.cacheRead || 0) + '</span></div>';
    if ((t.cacheWrite || 0) > 0) h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">write</span><span class="tvr">' + fmtShort(t.cacheWrite) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">7d trend</span><span class="tvr">' + (pp >= 0 ? '+' : '') + pp.toFixed(1) + 'pp</span></div>';
    return h;
  }
  function hoverModel(el, m) {
    el.addEventListener('mouseenter', function(ev) { showTip(tipModelHTML(m), ev.clientX, ev.clientY); });
    el.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
    el.addEventListener('mouseleave', hideTip);
  }
  function hoverRecent(el, r) {
    el.addEventListener('mouseenter', function(ev) { showTip(tipRecentHTML(r), ev.clientX, ev.clientY); });
    el.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
    el.addEventListener('mouseleave', hideTip);
  }
  // Model detail dialog: shadcn chart language over daily model volume.
  // byDayModel is keyed by DAY (Record<day, Record<model, tokens>>); the old
  // mdSeries read it keyed by model and rendered all-zero charts. Area chart
  // with gradient + hover crosshair, downsampled rounded bars, token-mix
  // donut, KPI strip, 30/90/ALL range tabs.
  var mdModel = null, mdSpan = 'all', mdHover = { pts: [], days: [] };
  function mdSeries(m) {
    var days = allDays();
    var per = DATA.byDayModel || {};
    return days.map(function(d) { return { day: d, v: ((per[d] || {})[m] || 0) }; });
  }
  function mdSlice(series) {
    if (mdSpan === 'all' || series.length <= mdSpan) return series;
    return series.slice(series.length - mdSpan);
  }
  function mdMonthTicks(days) {
    if (!days.length) return [];
    var seen = {}, out = [];
    days.forEach(function(d) {
      var t = d.slice(0, 7);
      if (!seen[t]) { seen[t] = 1; out.push({ day: d, label: new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'short' }) }); }
    });
    return out.slice(-6);
  }
  function mdShortDay(d) { return new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' }); }
  function mdAreaChart(svg, pts, days) {
    var W = 560, H = 190, max = 1, i, x, y;
    pts.forEach(function(p) { max = Math.max(max, p); });
    var step = pts.length > 1 ? (W - 16) / (pts.length - 1) : 0;
    function X(i) { return 8 + i * step; }
    function Y(p) { return 14 + (1 - p / max) * (H - 36); }
    var grid = '';
    for (i = 1; i <= 3; i++) { y = 14 + (H - 36) * i / 3; grid += '<line class="grid" x1="8" y1="' + y.toFixed(1) + '" x2="' + (W - 8) + '" y2="' + y.toFixed(1) + '"/>'; }
    var d = pts.map(function(p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p).toFixed(1); }).join(' ');
    var last = pts.length ? { x: X(pts.length - 1), y: Y(pts[pts.length - 1]) } : { x: 8, y: H - 22 };
    svg.innerHTML = '<defs><linearGradient id="mdGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--accent)" stop-opacity="0.35"/>' +
      '<stop offset="1" style="stop-color:var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      (pts.length ? '<path class="area" d="' + d + ' L' + last.x.toFixed(1) + ' ' + (H - 22) + ' L8 ' + (H - 22) + ' Z"/>' : '') +
      (pts.length ? '<path class="line" d="' + d + '"/>' : '') +
      (pts.length ? '<circle class="dot" cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="4"/>' : '') +
      (pts.length ? '<circle class="hoverdot" id="mdHoverDot" cx="-10" cy="-10" r="4" style="display:none"/>' : '');
    mdHover = { pts: pts, days: days };
    svg.onmousemove = function(ev) {
      var tip = document.getElementById('mdTip');
      if (!tip || !mdHover.pts.length) return;
      var r = svg.getBoundingClientRect();
      var fx = (ev.clientX - r.left) / r.width * W;
      var idx = Math.max(0, Math.min(mdHover.pts.length - 1, Math.round((fx - 8) / (step || 1))));
      var dot = document.getElementById('mdHoverDot');
      if (dot) { dot.setAttribute('cx', X(idx).toFixed(1)); dot.setAttribute('cy', Y(mdHover.pts[idx]).toFixed(1)); dot.style.display = ''; }
      tip.textContent = mdShortDay(mdHover.days[idx]) + ' · ' + fmtShort(mdHover.pts[idx]);
      tip.style.display = 'block';
      // Raw % positioning overflows past the dialog edge on the first/last
      // points (the dialog clips it). Measure and pin inside the card.
      var chart = svg.closest ? svg.closest('.md-chart') : null;
      var px = svg.offsetLeft + (X(idx) / W) * svg.clientWidth;
      if (chart) {
        var half = tip.offsetWidth / 2;
        px = Math.max(half + 4, Math.min(chart.clientWidth - half - 4, px));
      }
      tip.style.left = px + 'px';
      tip.style.top = '8px';
    };
    svg.onmouseleave = function() {
      var tip = document.getElementById('mdTip');
      if (tip) tip.style.display = 'none';
      var dot = document.getElementById('mdHoverDot');
      if (dot) dot.style.display = 'none';
    };
  }
  function mdBars(el, vals, days) {
    el.innerHTML = '';
    var max = 1, i, total = 0, active = 0, peak = 0, peakI = 0;
    vals.forEach(function(v, k) { max = Math.max(max, v); total += v; if (v > 0) { active++; if (v > peak) { peak = v; peakI = k; } } });
    var n = vals.length, bucket = 1;
    if (n > 90) bucket = Math.ceil(n / 90);
    for (i = 0; i < n; i += bucket) {
      var sum = 0, c = 0;
      for (var j = i; j < Math.min(n, i + bucket); j++) { sum += vals[j]; c++; }
      var avg = sum / c;
      var s = document.createElement('span');
      if (!avg) s.className = 'zero';
      else if (avg === max) s.className = 'top';
      s.style.height = Math.max(avg ? 5 : 2, Math.round(avg / max * 100)) + '%';
      s.title = mdShortDay(days[i]) + ' · ' + fmtShort(Math.round(sum));
      el.appendChild(s);
    }
    // Sparse models leave the bars mostly flat: name the peak day, its share
    // of the period, and the per-active-day average instead of empty space.
    var note = document.getElementById('mdBarsNote');
    if (note) {
      if (!active) note.textContent = 'no activity in range';
      else note.textContent = 'Peak ' + mdShortDay(days[peakI]) + ' · ' + fmtShort(peak) + ' (' + (total ? Math.round(peak / total * 100) : 0) + '% of period) · avg ' + fmtShort(Math.round(total / active)) + ' / active day';
    }
  }
  function mdDonut(svg, parts) {
    var r = 54, C = 2 * Math.PI * r, off = 0;
    var total = parts.reduce(function(a, p) { return a + p.v; }, 0) || 1;
    var html = '<circle class="tk" cx="70" cy="70" r="' + r + '"/>';
    parts.forEach(function(p) {
      var len = p.v / total * C;
      if (len <= 0) return;
      html += '<circle cx="70" cy="70" r="' + r + '" style="stroke:' + p.color + '" stroke-dasharray="' + len.toFixed(1) + ' ' + (C - len).toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '" stroke-linecap="butt"/>';
      off += len;
    });
    svg.innerHTML = html;
    document.getElementById('mdMixTotal').textContent = fmtShort(total);
    document.getElementById('mdMixLegend').innerHTML = parts.filter(function(p) { return p.v > 0; }).map(function(p) {
      return '<div class="row"><span class="dot" style="background:' + p.color + '"></span><span>' + p.label + '</span><span class="pct">' + (p.v / total * 100).toFixed(1) + '% · ' + fmtShort(p.v) + '</span></div>';
    }).join('');
  }
  function mdMonths(el, days) {
    el.innerHTML = '';
    mdMonthTicks(days).forEach(function(t) {
      var s = document.createElement('span');
      s.textContent = t.label;
      el.appendChild(s);
    });
  }
  function mdKpi(k, v, d, up) {
    return '<div class="md-kpi"><p class="k mono">' + k + '</p><p class="v">' + v + '</p><p class="d mono ' + (up ? 'up' : 'flat') + '">' + d + '</p></div>';
  }
  function mdStat(k, v, s) {
    return '<div class="md-stat"><p class="k mono">' + k + '</p><p class="v mono">' + v + '</p>' + (s ? '<p class="s mono">' + s + '</p>' : '') + '</div>';
  }
  function mdRange(days) {
    if (!days.length) return '–';
    return mdShortDay(days[0]).toUpperCase() + ' → ' + mdShortDay(days[days.length - 1]).toUpperCase();
  }
  function mdTrendText(vals) {
    var max = 0, i;
    vals.forEach(function(x) { max = Math.max(max, x); });
    if (vals.length < 14) return max ? { t: 'peak ' + fmtShort(max) + ' in a day', up: true } : { t: 'no activity yet', up: false };
    var a = 0, b = 0;
    for (i = vals.length - 14; i < vals.length; i++) a += vals[i];
    for (i = Math.max(0, vals.length - 28); i < vals.length - 14; i++) b += vals[i];
    if (!b) return { t: fmtShort(a) + ' / 2 wks', up: a > 0 };
    var pct = (a - b) / b * 100;
    return { t: (pct >= 0 ? '+' : '') + pct.toFixed(0) + '% vs prior 2 wks', up: pct >= 0 };
  }
  function renderModelDialog(m) {
    var byModel = DATA.byModel || {};
    var tops = topModels(byModel, Object.keys(byModel).length);
    var rank = tops.indexOf(m) + 1;
    var b = byModel[m] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    var total = modelTotal(byModel, m);
    var grand = 1;
    tops.forEach(function(k) { grand += modelTotal(byModel, k); });
    var v = vendorOf(m);
    var req = ((DATA.byModelMessages || {})[m]) || 0;
    var usd = ((DATA.byModelUsd || {})[m]) || 0;
    var denom = b.input + b.cacheRead;
    var hit = denom ? (b.cacheRead / denom * 100) : 0;
    var series = mdSlice(mdSeries(m));
    var days = series.map(function(p) { return p.day; });
    var vals = series.map(function(p) { return p.v; });
    var active = vals.filter(function(x) { return x > 0; }).length;
    var tr = mdTrendText(mdSeries(m).map(function(p) { return p.v; }));
    document.getElementById('mdBadge').innerHTML = brandHTML(v, false);
    var title = document.getElementById('mdTitle');
    title.textContent = displayModel(m);
    title.title = m;
    document.getElementById('mdSub').textContent = v.name + ' · ' + fmt(req) + ' requests · ' + (total / grand * 100).toFixed(1) + '% of volume';
    document.getElementById('mdRank').textContent = rank ? '#' + String(rank).padStart(2, '0') : '#–';
    var trend = document.getElementById('mdTrend');
    trend.textContent = tr.t;
    trend.className = 'md-trend mono' + (tr.up ? ' up' : '');
    document.getElementById('mdKpis').innerHTML =
      mdKpi('Tokens', fmtShort(total), mdRange(days), true) +
      mdKpi('Spend', fxMoney(usd), req ? fxMoney(usd / req) + ' / req' : 'no requests', usd > 0) +
      mdKpi('Cache hit', hit.toFixed(0) + '%', fmtShort(b.cacheRead) + ' cached', hit >= 50) +
      mdKpi('Requests', fmt(req), active + ' active days', active > 0);
    document.getElementById('mdMomRange').textContent = mdRange(days);
    mdAreaChart(document.getElementById('mdSpark'), vals, days);
    mdMonths(document.getElementById('mdMonths'), days);
    var act = document.getElementById('mdActive');
    act.textContent = active + ' / ' + days.length + ' days';
    act.className = 'md-trend mono' + (active ? ' up' : '');
    mdBars(document.getElementById('mdBars'), vals, days);
    mdMonths(document.getElementById('mdBarsMonths'), days);
    mdDonut(document.getElementById('mdMix'), [
      { label: 'Input', v: b.input, color: 'var(--accent)' },
      { label: 'Output', v: b.output, color: '#818cf8' },
      { label: 'Cache read', v: b.cacheRead, color: '#22d3ee' },
      { label: 'Cache write', v: b.cacheWrite, color: 'var(--dim)' },
    ]);
    document.getElementById('mdStats').innerHTML =
      mdStat('Input', fmtShort(b.input), null) +
      mdStat('Output', fmtShort(b.output), null) +
      mdStat('Cache read', fmtShort(b.cacheRead), hit.toFixed(0) + '% hit') +
      mdStat('Cache write', fmtShort(b.cacheWrite), null);
    if (window.lucide) lucide.createIcons();
    if (hasGsap && !reduce) {
      gsap.fromTo('#modelDialog .md-kpi', { y: 12, opacity: 0.2 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out', stagger: 0.05, overwrite: true });
      gsap.fromTo('#modelDialog .md-chart', { y: 14, opacity: 0.2 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out', stagger: 0.07, overwrite: true });
      gsap.fromTo('#modelDialog .md-stat', { scale: 0.94, opacity: 0.2 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'power2.out', stagger: 0.04, overwrite: true });
    }
  }
  function openModelDialog(m) {
    var dlg = document.getElementById('modelDialog');
    if (!dlg || typeof dlg.showModal !== 'function') return;
    mdModel = m;
    Array.prototype.forEach.call(document.querySelectorAll('#modelDialog [data-mdspan]'), function(btn) {
      var on = btn.getAttribute('data-mdspan') === String(mdSpan);
      btn.classList.toggle('on', on);
      btn.onclick = function() {
        mdSpan = btn.getAttribute('data-mdspan') === 'all' ? 'all' : Number(btn.getAttribute('data-mdspan'));
        Array.prototype.forEach.call(document.querySelectorAll('#modelDialog [data-mdspan]'), function(o) { o.classList.toggle('on', o === btn); });
        renderModelDialog(mdModel);
      };
    });
    renderModelDialog(m);
    if (!dlg.open) dlg.showModal();
  }
  function dayModelRows(key) {
    var per = (DATA.byDayModel || {})[key] || {};
    var tops = topModels(DATA.byModel || {}, 8), rows = [], other = 0;
    tops.forEach(function(m, i) {
      var v = per[m] || 0;
      if (v) rows.push([m, v, PALETTE[i % PALETTE.length]]);
    });
    Object.keys(per).forEach(function(m) { if (tops.indexOf(m) < 0) other += per[m]; });
    if (other) rows.push(['Other', other, 'var(--dim)']);
    return rows;
  }

  var GMODE = 'daily';
  function mondayOf(d) {
    var m = new Date(d);
    m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    m.setHours(0, 0, 0, 0);
    return m;
  }
  function weekTipHTML(monKey, weekTotal, weekPer) {
    var mon = new Date(monKey + 'T12:00:00'), sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    var head = isNaN(mon) ? monKey : mon.toLocaleString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() +
      ' - ' + (isNaN(sun) ? '' : sun.toLocaleString('en-US', { month: 'short', day: 'numeric' }).toUpperCase());
    var tops = topModels(DATA.byModel || {}, 8), rows = [], other = 0;
    tops.forEach(function(m, i) {
      var v = weekPer[m] || 0;
      if (v) rows.push([m, v, PALETTE[i % PALETTE.length]]);
    });
    Object.keys(weekPer).forEach(function(m) { if (tops.indexOf(m) < 0) other += weekPer[m]; });
    if (other) rows.push(['Other', other, 'var(--dim)']);
    return tipDayHTML(head, weekTotal, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
  }
  // Shared empty state (shadcn pattern): icon chip + title + hint. Callers
  // inject the HTML; render()'s trailing lucide.createIcons() paints icons.
  function emptyState(icon, title, desc) {
    return '<span class="empty-icon"><i data-lucide="' + icon + '" class="size-5"></i></span>' +
      '<p class="empty-title">' + title + '</p>' +
      '<p class="empty-desc">' + desc + '</p>';
  }
  function renderGraph(byDay) {
    var g = document.getElementById('graph');
    g.innerHTML = '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today); start.setDate(start.getDate() - (52 * 7) - today.getDay());
    var sums = {};
    Object.keys(byDay).forEach(function(day) {
      var b = byDay[day];
      sums[day] = b.input + b.output + b.cacheRead + b.cacheWrite;
    });
    var hasData = Object.keys(sums).some(function(k) { return sums[k] > 0; });
    document.getElementById('emptyGraph').classList.toggle('hidden', hasData);
    document.getElementById('graph').style.display = hasData ? '' : 'none';
    document.getElementById('graphMonths').style.display = hasData ? '' : 'none';
    if (!hasData) {
      document.getElementById('graphRange').textContent = '';
      document.getElementById('graphCap').textContent = 'no data in trailing 12 months';
      return;
    }
    // per-day values under the active mode
    var dayKeys = [], wk;
    for (wk = 0; wk < 53; wk++) for (var di = 0; di < 7; di++) {
      var dd = new Date(start); dd.setDate(dd.getDate() + wk * 7 + di);
      dayKeys.push(dayKey(dd));
    }
    var weekPer = {}, weekTotal = {}, run = 0, cellVal = {};
    dayKeys.forEach(function(k) {
      var dt = new Date(k + 'T12:00:00');
      if (GMODE === 'weekly' && !isNaN(dt)) {
        var mk = dayKey(mondayOf(dt));
        weekTotal[mk] = (weekTotal[mk] || 0) + (sums[k] || 0);
        var per = (DATA.byDayModel || {})[k] || {};
        if (!weekPer[mk]) weekPer[mk] = {};
        Object.keys(per).forEach(function(m) { weekPer[mk][m] = (weekPer[mk][m] || 0) + per[m]; });
      }
      if (GMODE === 'cumulative') { run += sums[k] || 0; cellVal[k] = run; }
    });
    var max = 1;
    if (GMODE === 'weekly') {
      Object.keys(weekTotal).forEach(function(k) { max = Math.max(max, weekTotal[k]); });
    } else if (GMODE === 'cumulative') {
      max = Math.max(1, run);
    } else {
      Object.keys(sums).forEach(function(k) { max = Math.max(max, sums[k]); });
    }
    var months = document.getElementById('graphMonths');
    months.innerHTML = '';
    var lastMonth = '';
    for (var w = 0; w < 53; w++) {
      var col = document.createElement('div');
      col.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0;';
      var ml = document.createElement('span');
      ml.className = 'heatmonth w-full';
      for (var i = 0; i < 7; i++) {
        var cdt = new Date(start); cdt.setDate(cdt.getDate() + w * 7 + i);
        var key = dayKey(cdt), v, tipFn;
        if (GMODE === 'weekly') {
          var mk2 = dayKey(mondayOf(cdt));
          v = weekTotal[mk2] || 0;
          tipFn = (function(mk3, vv) {
            return function() { return weekTipHTML(mk3, vv, weekPer[mk3] || {}); };
          })(mk2, v);
        } else if (GMODE === 'cumulative') {
          v = cellVal[key] || 0;
          tipFn = (function(kk, vv) {
            return function() {
              var rows = dayModelRows(kk);
              return tipDayHTML('THROUGH ' + dateHead(kk), vv, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
            };
          })(key, v);
        } else {
          v = sums[key] || 0;
          tipFn = (function(kk, vv) {
            return function() {
              var rows = dayModelRows(kk);
              return tipDayHTML(kk, vv, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
            };
          })(key, v);
        }
        var lvl = 0;
        if (v > 0) lvl = Math.min(4, 1 + Math.floor((v / max) * 3.99));
        var cell = document.createElement('span');
        cell.className = 'cell' + (lvl ? ' l' + lvl : '');
        (function(fn) {
          cell.addEventListener('mouseenter', function(ev) { showTip(fn(), ev.clientX, ev.clientY); });
          cell.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
          cell.addEventListener('mouseleave', hideTip);
        })(tipFn);
        col.appendChild(cell);
        if (i === 0) {
          var mm = cdt.toLocaleString('en-US', { month: 'short' });
          ml.textContent = mm !== lastMonth ? mm : '';
          lastMonth = mm;
        }
      }
      g.appendChild(col);
      months.appendChild(ml);
    }
    Array.prototype.forEach.call(months.children, function(m) { m.style.minWidth = '0'; });
    document.getElementById('graphRange').textContent =
      dayKey(start) + ' to ' + dayKey(today);
    document.getElementById('graphCap').textContent =
      GMODE === 'weekly' ? 'weekly totals / trailing 12 months' :
        GMODE === 'cumulative' ? 'running total / trailing 12 months' :
          'daily values / trailing 12 months';
  }
  function bindGraphTabs() {
    if (bindGraphTabs.done) return;
    bindGraphTabs.done = true;
    Array.prototype.forEach.call(document.querySelectorAll('#activity [data-gmode]'), function(btn) {
      btn.addEventListener('click', function() {
        Array.prototype.forEach.call(document.querySelectorAll('#activity [data-gmode]'), function(b) { b.classList.remove('on'); });
        btn.classList.add('on');
        GMODE = btn.getAttribute('data-gmode');
        if (DATA) renderGraph(DATA.byDay || {});
      });
    });
  }

  var modelPage = 1, modelPer = 10, recentPage = 1, recentPer = 25;
  // Recent requests default to newest-first, which is how the transcript
  // arrives; every column is sortable like the command table.
  var recentSort = { key: 'when', dir: -1 }, recentRows = [];
  function recentVal(r, key) {
    if (key === 'model') return r.m.toLowerCase();
    if (key === 'input') return r.i;
    if (key === 'output') return r.o;
    if (key === 'time') return r.d === undefined ? null : r.d;
    if (key === 'status') return statusRank(r);
    if (key === 'cost') return displayCost(r);
    return r.t;
  }
  function sortRecent() {
    var k = recentSort.key, d = recentSort.dir;
    recentRows.sort(function(a, b) {
      var av = recentVal(a, k), bv = recentVal(b, k);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -d;
      if (av > bv) return d;
      return b.t - a.t;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#recentTable .thsort'), function(btn) {
      var on = btn.dataset.sort === k;
      btn.querySelector('.arr').textContent = on ? (d === 1 ? '↑' : '↓') : '⇅';
      btn.closest('th').setAttribute('aria-sort', on ? (d === 1 ? 'ascending' : 'descending') : 'none');
    });
  }
  function renderModels() {
    var byModel = DATA.byModel || {};
    var tops = topModels(byModel, Object.keys(byModel).length).filter(function(m) { return modelTotal(byModel, m) > 0; });
    var cards = document.getElementById('modelCards');
    cards.innerHTML = '';
    if (!tops.length) cards.innerHTML = '<div class="empty md:col-span-3">' + emptyState('boxes', 'No models yet', 'Model token totals will appear here once sessions report tokens.') + '</div>';
    tops.slice(0, 3).forEach(function(m, i) {
      var v = vendorOf(m);
      var card = document.createElement('div');
      card.className = 'modelcard relative p-4 rounded-xl overflow-hidden';
      if (v.svg) {
        var ghostSvg = document.createElement('span');
        ghostSvg.className = 'ghostimg'; ghostSvg.setAttribute('aria-hidden', 'true');
        ghostSvg.innerHTML = v.svg;
        card.appendChild(ghostSvg);
      } else if (v.slug) {
        var ghost = document.createElement('img');
        ghost.className = 'ghostimg'; ghost.alt = '';
        ghost.src = 'https://cdn.simpleicons.org/' + v.slug + '/white';
        ghost.setAttribute('aria-hidden', 'true');
        card.appendChild(ghost);
      } else {
        var ghostSparkle = document.createElement('i');
        ghostSparkle.setAttribute('data-lucide', 'sparkles');
        ghostSparkle.className = 'ghosticon';
        ghostSparkle.setAttribute('aria-hidden', 'true');
        card.appendChild(ghostSparkle);
      }
      card.style.cssText = 'border: 1px solid var(--line); background: var(--panel); cursor: pointer';
      card.setAttribute('role', 'button');
      var head = document.createElement('p');
      head.className = 'mono text-xs mb-3'; head.style.color = 'var(--dim)';
      head.textContent = '0' + (i + 1);
      var row = document.createElement('div');
      row.className = 'flex items-center gap-3';
      var badgeWrap = document.createElement('span');
      badgeWrap.innerHTML = brandHTML(v, false);
      var badge = badgeWrap.firstChild;
      var mid = document.createElement('div'); mid.className = 'min-w-0 flex-1';
      var nm = document.createElement('p'); nm.className = 'mono text-sm font-bold truncate'; nm.textContent = displayModel(m); nm.title = m;
      var vn = document.createElement('p'); vn.className = 'mono text-xs truncate'; vn.style.color = 'var(--dim)'; vn.textContent = v.name;
      mid.appendChild(nm); mid.appendChild(vn);
      var tot = document.createElement('p'); tot.className = 'mono font-bold text-lg shrink-0'; tot.textContent = fmtShort(modelTotal(byModel, m));
      row.appendChild(badge); row.appendChild(mid); row.appendChild(tot);
      card.appendChild(head); card.appendChild(row);
      hoverModel(card, m);
      (function(model) { card.addEventListener('click', function() { openModelDialog(model); }); })(m);
      cards.appendChild(card);
    });
    var ol = document.getElementById('models');
    ol.innerHTML = '';
    var max = 1;
    tops.forEach(function(m) { max = Math.max(max, modelTotal(byModel, m)); });
    var modelPages = Math.max(1, Math.ceil(tops.length / modelPer));
    if (modelPage > modelPages) modelPage = modelPages;
    var modelStart = (modelPage - 1) * modelPer;
    tops.slice(modelStart, modelStart + modelPer).forEach(function(m, i) {
      var v = vendorOf(m);
      var li = document.createElement('li');
      li.className = 'mrow flex items-center gap-3 px-4 py-3' + (i < Math.min(tops.length - modelStart, modelPer) - 1 ? ' rowline' : '');
      var badgeWrap = document.createElement('span');
      badgeWrap.innerHTML = brandHTML(v, true);
      var badge = badgeWrap.firstChild;
      var mid = document.createElement('div'); mid.className = 'min-w-0 flex-1';
      var nm = document.createElement('p'); nm.className = 'mono text-sm truncate'; nm.textContent = displayModel(m); nm.title = m;
      var track = document.createElement('div'); track.className = 'bar-track mt-1.5 h-1.5 overflow-hidden';
      var fill = document.createElement('div'); fill.className = 'bar-fill h-full';
      var mv = modelTotal(byModel, m);
      fill.dataset.w = Math.round(mv / max * 100) + '%';
      fill.style.width = '0';
      track.appendChild(fill); mid.appendChild(nm); mid.appendChild(track);
      var right = document.createElement('div'); right.className = 'shrink-0 text-right';
      var n = document.createElement('p'); n.className = 'mono font-bold'; n.textContent = fmt(modelTotal(byModel, m));
      var cost = document.createElement('p'); cost.className = 'mono text-xs'; cost.style.color = 'var(--dim)';
      cost.textContent = fxMoney((DATA.byModelUsd || {})[m] || 0);
      right.appendChild(n); right.appendChild(cost);
      li.appendChild(badge); li.appendChild(mid); li.appendChild(right);
      hoverModel(li, m);
      (function(model) { li.addEventListener('click', function() { openModelDialog(model); }); })(m);
      ol.appendChild(li);
    });
    document.getElementById('modelsCount').textContent = tops.length ? tops.length + ' models' : '';
    paintPager('modelPages', 'modelRange', modelPage, modelPer, tops.length, function(p) { modelPage = p; renderModels(); });
    ol.style.display = tops.length ? '' : 'none';
    document.getElementById('emptyModels').classList.toggle('hidden', tops.length > 0);
    if (tops.length && 'IntersectionObserver' in window && !reduce) {
      var fio = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          if (e.isIntersecting) {
            e.target.querySelectorAll('.bar-fill').forEach(function(f) { f.style.width = f.dataset.w || '0'; });
            fio.disconnect();
          }
        });
      }, { threshold: 0.2 });
      fio.observe(ol);
    } else if (tops.length) {
      ol.querySelectorAll('.bar-fill').forEach(function(f) { f.style.width = f.dataset.w || '0'; });
    }
    if (hasGsap && hasST && !cardsShown && tops.length) {
      cardsShown = true;
      gsap.from('#modelCards > div', {
        scale: 0.92, opacity: 0.2, duration: 0.6, ease: 'power2.out', stagger: 0.08, overwrite: true,
        scrollTrigger: { trigger: '#modelCards', start: 'top 88%' }
      });
    }
  }

  // Union of session tool calls + RTK-metered commands, sortable + paged.
  // Session tools were never metered per command: saved / avg / time show – and sort last.
  // Rows group by command alone, machine-wide: same command in any repo is one row.
  var cmdSort = { key: 'count', dir: -1 }, cmdPage = 1, cmdPer = 15, cmdRows = [];
  function cmdVal(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    return r[key];
  }
  function sortCmd() {
    var k = cmdSort.key, d = cmdSort.dir;
    cmdRows.sort(function(a, b) {
      var av = cmdVal(a, k), bv = cmdVal(b, k);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -d;
      if (av > bv) return d;
      return b.count - a.count;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tools .thsort'), function(btn) {
      var on = btn.dataset.sort === k;
      btn.querySelector('.arr').textContent = on ? (d === 1 ? '↑' : '↓') : '⇅';
      btn.closest('th').setAttribute('aria-sort', on ? (d === 1 ? 'ascending' : 'descending') : 'none');
    });
  }
  function renderCmd() {
    var g = (DATA.rtkGain || {});
    var byName = {};
    function add(name, count, saved, avgPct, avgMs) {
      var r = byName[name];
      if (!r) { byName[name] = { name: name, count: count, saved: saved, avgPct: avgPct, avgMs: avgMs }; return; }
      r.count += count;
      if (saved !== null && saved !== undefined) r.saved = (r.saved || 0) + saved;
    }
    (DATA.byTool || []).forEach(function(r) { add(r[0], r[1], null, null, null); });
    (g.byCommand || []).forEach(function(r) { add(r.command, r.count, r.saved, r.avgPct, r.avgMs); });
    cmdRows = Object.keys(byName).map(function(k) { return byName[k]; });
    sortCmd();
    var pages = Math.max(1, Math.ceil(cmdRows.length / cmdPer));
    if (cmdPage > pages) cmdPage = pages;
    var body = document.getElementById('cmdBody');
    body.innerHTML = '';
    var max = 1;
    cmdRows.forEach(function(r) { max = Math.max(max, r.count); });
    var start = (cmdPage - 1) * cmdPer;
    cmdRows.slice(start, start + cmdPer).forEach(function(r, i) {
      var n = start + i;
      var tr = document.createElement('tr');
      tr.className = 'mrow' + (i < Math.min(cmdRows.length - start, cmdPer) - 1 ? ' rowline' : '');
      tr.innerHTML = '<td class="text-right pr-3 py-2.5 mono text-xs w-10" style="color: var(--dim)"></td>' +
        '<td class="py-2.5 pr-3 truncate" style="max-width: 280px"></td>' +
        '<td class="text-right py-2.5 pr-3 font-bold"></td>' +
        '<td class="text-right py-2.5 pr-3 font-bold"></td>' +
        '<td class="text-right py-2.5 pr-3" style="color: var(--accent)"></td>' +
        '<td class="text-right py-2.5 pr-3" style="color: var(--dim)"></td>' +
        '<td class="py-2.5 min-w-32"><div class="bar-track h-1.5 overflow-hidden"><div class="bar-fill h-full"></div></div></td>';
      var tds = tr.children;
      tds[0].textContent = String(n + 1).padStart(2, '0');
      tds[1].textContent = r.name;
      tds[1].title = r.name;
      tds[2].textContent = fmt(r.count);
      tds[3].textContent = r.saved === null ? '–' : fmtShort(r.saved);
      tds[4].textContent = r.avgPct === null ? '–' : r.avgPct.toFixed(1) + '%';
      tds[5].textContent = r.avgMs === null || r.avgMs === undefined ? '–' : fmtMs(r.avgMs);
      tds[6].firstChild.firstChild.style.width = r.count ? Math.round(r.count / max * 100) + '%' : '0';
      body.appendChild(tr);
    });
    document.getElementById('cmdTable').style.display = cmdRows.length ? '' : 'none';
    document.getElementById('emptyCmd').classList.toggle('hidden', cmdRows.length > 0);
    document.getElementById('toolsScope').textContent =
      g.commands ? fmt(cmdRows.length) + ' commands · ' + fmt(g.commands) + ' runs · ' + fmtShort(g.saved) + ' saved' : 'tool calls in sessions';
    paintCmdPager(pages);
  }
  // Shared page-number painter: prev/next plus windowed numbers with
  // ellipsis. onPick(page) rerenders the owning card. Same controls as the
  // Command tools pager; Models and Recent reuse it verbatim.
  function paintPager(wrapId, rangeId, page, per, total, onPick) {
    var start = total ? (page - 1) * per + 1 : 0;
    document.getElementById(rangeId).textContent =
      'Showing ' + start + '–' + Math.min(total, page * per) + ' of ' + total;
    var wrap = document.getElementById(wrapId);
    wrap.innerHTML = '';
    var pages = Math.max(1, Math.ceil(total / per));
    if (page > pages) onPick(pages);
    function btn(label, next, opts) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pgbtn mono' + (opts && opts.on ? ' on' : '');
      b.textContent = label;
      if (opts && opts.dim) b.setAttribute('aria-label', opts.dim);
      if (opts && opts.off) b.disabled = true;
      else b.addEventListener('click', function() { onPick(next); });
      wrap.appendChild(b);
      return b;
    }
    btn('‹', page - 1, { dim: 'Previous page', off: page <= 1 });
    var nums = [];
    for (var p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    nums.forEach(function(p) {
      if (p === '…') {
        var s = document.createElement('span');
        s.textContent = '…'; s.style.padding = '0 2px';
        wrap.appendChild(s);
      } else btn(String(p), p, { on: p === page });
    });
    btn('›', page + 1, { dim: 'Next page', off: page >= pages });
  }
  function paintCmdPager(pages) {
    var total = cmdRows.length;
    if (cmdPage > pages) cmdPage = pages;
    paintPager('cmdPages', 'cmdRange', cmdPage, cmdPer, total, function(p) { cmdPage = p; renderCmd(); });
  }
  function bindPerPage(sel, get, set, render) {
    Array.prototype.forEach.call(document.querySelectorAll(sel + ' [data-pp]'), function(btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function() {
        if (Number(btn.dataset.pp) === get()) return;
        Array.prototype.forEach.call(document.querySelectorAll(sel + ' [data-pp]'), function(b) { b.classList.remove('on'); });
        btn.classList.add('on');
        set(Number(btn.dataset.pp));
        render();
      });
    });
  }
  function bindCmdTable() {
    if (bindCmdTable.done) return;
    bindCmdTable.done = true;
    Array.prototype.forEach.call(document.querySelectorAll('#tools .thsort'), function(btn) {
      btn.addEventListener('click', function() {
        var k = btn.dataset.sort;
        if (cmdSort.key === k) cmdSort.dir = -cmdSort.dir;
        else { cmdSort.key = k; cmdSort.dir = k === 'name' ? 1 : -1; }
        cmdPage = 1;
        renderCmd();
      });
    });
    bindPerPage('#cmdPager', function() { return cmdPer; }, function(n) { cmdPer = n; cmdPage = 1; }, renderCmd);
    bindPerPage('section[aria-label="All models"]', function() { return modelPer; }, function(n) { modelPer = n; modelPage = 1; }, renderModels);
    bindPerPage('section[aria-label="Recent requests"]', function() { return recentPer; }, function(n) { recentPer = n; recentPage = 1; }, renderRecent);
  }
  function bindRecentTable() {
    if (bindRecentTable.done) return;
    bindRecentTable.done = true;
    Array.prototype.forEach.call(document.querySelectorAll('#recentTable .thsort'), function(btn) {
      btn.addEventListener('click', function() {
        var k = btn.dataset.sort;
        if (recentSort.key === k) recentSort.dir = -recentSort.dir;
        else { recentSort.key = k; recentSort.dir = k === 'model' || k === 'status' ? 1 : -1; }
        recentPage = 1;
        renderRecent();
      });
    });
  }
  function fmtMs(ms) {
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function renderStrip(t) {
    var defs = [
      ['input', t.input, 'arrow-down-to-line'],
      ['output', t.output, 'arrow-up-from-line'],
      ['cache read', t.cacheRead, 'hard-drive-download'],
      ['cache write', t.cacheWrite, 'hard-drive-upload']
    ].filter(function(b) { return b[1] > 0; });
    var strip = document.getElementById('tokens');
    strip.innerHTML = '';
    defs.forEach(function(b, i) {
      var cell = document.createElement('div');
      cell.className = 'stripcell flex-1 px-4 py-4' + (i > 0 ? ' sm:border-l' : '');
      cell.style.borderColor = 'var(--line)';
      cell.innerHTML = '<div class="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.14em]" style="color: var(--dim)">' +
        '<i data-lucide="' + b[2] + '" class="size-3.5"></i><span></span></div>' +
        '<p class="mono font-bold text-3xl mt-1"></p>';
      cell.querySelector('span').textContent = b[0];
      cell.querySelector('p').textContent = fmt(b[1]);
      strip.appendChild(cell);
    });
  }

  // 30-day volume sparkline + blended-rate daily stats for the USD card.
  // Daily cost is a blended estimate (total USD / total tokens x day
  // tokens), always rendered with ~ and never mixed with measured totals.
  function renderSpark(byDay, usd, savedUsd, total) {
    var el = document.getElementById('usdSpark');
    el.innerHTML = '';
    var keys = Object.keys(byDay).sort().slice(-30);
    // Zero state: the spark strip is a fixed h-16, so a placeholder inside it
    // overflows onto the big number. Hide the number, strip, and stats, and
    // mount one placeholder in the card body instead. Restored below on data.
    var mid = el.parentElement || null, card = mid && mid.parentElement ? mid.parentElement : null;
    var usdEl = document.getElementById('usd'), noteEl = document.getElementById('usdNote');
    var ex = document.getElementById('emptyUsd');
    if (!keys.length && card && mid) {
      if (!ex) {
        ex = document.createElement('div');
        ex.id = 'emptyUsd'; ex.className = 'empty'; ex.style.marginTop = '16px';
        ex.innerHTML = emptyState('trending-up', 'No cost data yet', 'Daily spend will spark here once sessions report tokens.');
        card.insertBefore(ex, mid);
      }
      el.style.display = 'none'; mid.style.display = 'none';
      if (usdEl) usdEl.style.display = 'none';
      if (noteEl) noteEl.style.display = 'none';
    } else {
      if (ex && ex.parentElement) ex.parentElement.removeChild(ex);
      el.style.display = '';
      if (mid) mid.style.display = '';
      if (usdEl) usdEl.style.display = '';
      if (noteEl) noteEl.style.display = '';
    }
    var rate = total ? usd / total : 0;
    var max = 1, vols = [];
    keys.forEach(function(k) {
      var v = dayTotal(byDay[k] || {});
      vols.push({ k: k, v: v });
      max = Math.max(max, v);
    });
    var top = vols.slice().sort(function(a, b) { return b.v - a.v; })[0] || { k: '', v: 0 };
    vols.forEach(function(r) {
      var s = document.createElement('span');
      if (r.k === top.k && r.v > 0) s.className = 'top';
      s.style.height = r.v ? Math.max(4, Math.round(r.v / max * 100)) + '%' : '0';
      s.dataset.usd = (rate * r.v).toFixed(2);
      s.dataset.tok = r.v;
      s.dataset.day = r.k;
      s.addEventListener('mouseenter', function(ev) {
        showTip('<div class="tt">' + dateHead(s.dataset.day) + '</div><div class="tv">~' + fxMoney(Number(s.dataset.usd)) + '</div>' +
          '<div class="tr"><span class="sw" style="background:var(--accent)"></span>' +
          '<span class="tn">tokens</span><span class="tvr">' + fmt(Number(s.dataset.tok)) + '</span></div>',
          ev.clientX, ev.clientY);
      });
      s.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
      s.addEventListener('mouseleave', hideTip);
      el.appendChild(s);
    });
    var days = keys.length || 1;
    document.getElementById('usdPerDay').textContent = fxMoney(usd / days);
    document.getElementById('usdTopDay').textContent = top.k ? top.k.slice(5) + ' ~' + fxMoney(rate * top.v) : '-';
    document.getElementById('usdLeverage').textContent = usd ? (savedUsd / usd).toFixed(1) : '-';
  }

  function dayTotal(b) { return (b.input || 0) + (b.output || 0) + (b.cacheRead || 0) + (b.cacheWrite || 0); }

  function render(d) {
    DATA = d;
    // Server-provided default currency (tersio gain --currency); a saved
    // picker choice in localStorage always wins.
    if (!render.fxInit) {
      render.fxInit = true;
      var saved = null;
      try { saved = localStorage.getItem('tersio-fx-cur'); } catch (e) { }
      if (!saved && d.currency && CURS[d.currency]) {
        fx.cur = d.currency;
        var curEl = document.getElementById('fxCur');
        if (curEl) curEl.textContent = FLAGS[fx.cur] + ' ' + fx.cur;
        var panel = document.getElementById('fxPanel');
        if (panel) Array.prototype.forEach.call(panel.children, function(o) {
          o.setAttribute('aria-selected', o.dataset.cur === fx.cur ? 'true' : 'false');
        });
      }
    }
    var t = d.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    var total = t.input + t.output + t.cacheRead + t.cacheWrite;
    var totalEl = document.getElementById('total');
    if (hasGsap) {
      var o = { v: 0 };
      gsap.to(o, { v: total, duration: 1.2, ease: 'power3.out', onUpdate: function() { totalEl.textContent = fmt(o.v); } });
    } else {
      totalEl.textContent = fmt(total);
    }
    document.getElementById('costLabel').textContent = fx.cur.toLowerCase() + ' cost';
    countUp(document.getElementById('usd'), d.usd || 0, true);
    document.getElementById('usdNote').textContent = (d.priced ? 'per-model price table' : 'incl. default pricing') + (fx.live ? ' · fx live' : ' · fx snapshot');
    var byDay = d.byDay || {};
    renderSpark(byDay, d.usd || 0, d.savedUsd || 0, total);
    document.getElementById('verChip').textContent = 'tersio v' + (d.version || '?');
    var dp = d.paths || {};
    [['pathLedger', dp.ledger], ['pathSessions', dp.sessions], ['pathUsageDb', dp.usageDb]].forEach(function(pair) {
      var pel = document.getElementById(pair[0]);
      if (pel && pair[1]) { pel.textContent = pair[1]; pel.title = pair[1]; }
    });
    countUp(document.getElementById('saved'), d.savedUsd || 0, true);
    (function() {
      var lev = (d.usd || 0) ? (d.savedUsd || 0) / d.usd : 0;
      var z = levZone(lev);
      var note = document.getElementById('usdNote');
      note.innerHTML = ((d.priced ? 'per-model price table' : 'incl. default pricing') + (fx.live ? ' · fx live' : ' · fx snapshot') + ' · ') + zoneIcon(z[0], z[2]) + ' ' + z[1];
      note.title = 'Cache leverage x' + lev.toFixed(1) + ' — cache savings per $1 spent, vs full input price';
    })();
    (function() {
      var z = co2Zone(d.co2g || 0);
      var el = document.getElementById('co2');
      el.innerHTML = '~' + (d.co2g || 0).toFixed(1) + 'g ' + zoneIcon(z[0], z[2]);
      el.title = z[1] + ' footprint (est.)';
    })();
    (function() {
      var el = document.getElementById('co2');
      var card = el ? el.closest('div.rounded-xl') : null;
      if (!card || card.dataset.co2tip) return;
      card.dataset.co2tip = '1';
      card.addEventListener('mouseenter', function(ev) { showTip(tipCo2HTML(), ev.clientX, ev.clientY); });
      card.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
      card.addEventListener('mouseleave', hideTip);
    })();
    (function() {
      var el = document.getElementById('saved');
      var card = el ? el.closest('div.rounded-xl') : null;
      if (!card || card.dataset.savetip) return;
      card.dataset.savetip = '1';
      card.addEventListener('mouseenter', function(ev) { showTip(tipSavedHTML(), ev.clientX, ev.clientY); });
      card.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
      card.addEventListener('mouseleave', hideTip);
    })();
    var share = total ? Math.round((t.cacheRead + t.cacheWrite) / total * 100) : 0;
    var shareZ = shareZone(share);
    document.getElementById('cacheShare').innerHTML = share + '% ' + zoneIcon(shareZ[0], shareZ[2]);
    document.getElementById('cacheShare').title = shareZ[1] + ' cache share';
    var shareOf = function(b) { var s = dayTotal(b); return s ? ((b.cacheRead || 0) + (b.cacheWrite || 0)) / s * 100 : 0; };
    var keys = Object.keys(byDay).sort(), cPct = 0, pPct = 0, cn = 0, pn = 0;
    keys.slice(-7).forEach(function(k) { cPct += shareOf(byDay[k]); cn++; });
    keys.slice(-14, -7).forEach(function(k) { pPct += shareOf(byDay[k]); pn++; });
    var pp = (cn ? cPct / cn : 0) - (pn ? pPct / pn : 0);
    var cd = document.getElementById('cacheDelta');
    var cs = document.getElementById('cacheShare');
    cs.dataset.share = String(share);
    cs.dataset.pp = pp.toFixed(1);
    (function() {
      var el = document.getElementById('cacheShare');
      var card = el ? el.closest('div.rounded-xl') : null;
      if (!card || card.dataset.sharetip) return;
      card.dataset.sharetip = '1';
      card.addEventListener('mouseenter', function(ev) {
        showTip(tipShareHTML(Number(el.dataset.share || 0), Number(el.dataset.pp || 0)), ev.clientX, ev.clientY);
      });
      card.addEventListener('mousemove', function(ev) { moveTip(ev.clientX, ev.clientY); });
      card.addEventListener('mouseleave', hideTip);
    })();

    (function() {
      var el = document.getElementById('ticker');
      if (!el) return;
      var tops = topModels(DATA.byModel || {}, 5);
      var parts = tops.map(function(m) {
        var b = (DATA.byModel || {})[m];
        var v = b.input + b.output + b.cacheRead + b.cacheWrite;
        var nm = m.toUpperCase().replace(/-(FREE|CONTRIBUTOR.*|NEXT|LATEST)$/, '').replace(/[-.]?\d[\d.]*/, '').replace(/-V(?=-|$)/, '');
        return nm + ' ' + fmtShort(v);
      });
      if (!parts.length) return;
      var half = parts.join('   \u25c6   ');
      el.textContent = half + '   \u25c6   ' + half;
    })();
    renderStrip(t);
    bindGraphTabs();
    bindCmdTable();
    bindRecentTable();
    renderGraph(d.byDay || {});
    renderModels();
    renderRecent();
    renderCmd();

    if (window.lucide) lucide.createIcons();
    if (hasGsap && !render.introDone) {
      render.introDone = true;
      gsap.from('.hero-in', { y: 26, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08 });
    }
    observe();
  }
  // shadcn/ui badge: default/secondary/destructive/outline carry the meaning,
  // the label carries the detail. Built as DOM nodes so provider error notes
  // never reach innerHTML.
  function statusBadge(r) {
    var b = document.createElement('span');
    b.className = 'badge';
    if (r.st === 'error') {
      b.classList.add('destructive');
      b.textContent = statusLabel(r);
      b.title = 'error' + (r.code ? ' ' + r.code : '') + (r.note ? ' — ' + r.note : '');
    } else if (r.st === 'aborted') {
      b.classList.add('outline');
      b.textContent = 'aborted';
      b.title = r.note || 'Interrupted by user';
    } else {
      b.classList.add('secondary');
      b.textContent = 'completed';
      if (r.note) b.title = r.note;
    }
    return b;
  }
  function renderRecent() {
    var body = document.getElementById('recent');
    body.innerHTML = '';
    var all = DATA.recent || [];
    recentRows = all.slice();
    sortRecent();
    var recentPages = Math.max(1, Math.ceil(recentRows.length / recentPer));
    if (recentPage > recentPages) recentPage = recentPages;
    var recentStart = (recentPage - 1) * recentPer;
    var rows = recentRows.slice(recentStart, recentStart + recentPer);
    rows.forEach(function(r, i) {
      var v = vendorOf(r.m);
      var measured = costIsMeasured(r);
      var tr = document.createElement('tr');
      tr.className = 'rrow' + (i < Math.min(recentRows.length - recentStart, recentPer) - 1 ? ' rowline' : '');
      tr.innerHTML = '<td class="py-2.5 pr-3 truncate" style="min-width: 0"></td>' +
        '<td class="text-right py-2.5 pr-3 whitespace-nowrap" style="color:#fb923c"></td>' +
        '<td class="text-right py-2.5 pr-3 whitespace-nowrap" style="color:var(--accent)"></td>' +
        '<td class="text-right py-2.5 pr-3 whitespace-nowrap" style="color:var(--dim)">–</td>' +
        '<td class="py-2.5 pr-3 whitespace-nowrap"></td>' +
        '<td class="text-right py-2.5 pr-3 whitespace-nowrap"></td>' +
        '<td class="text-right py-2.5 whitespace-nowrap" style="color: var(--dim)"></td>';
      var tds = tr.children;
      var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:' + v.color + ';margin-right:8px"></span>';
      tds[0].innerHTML = dot + '<span></span>';
      tds[0].querySelector('span:last-child').textContent = displayModel(r.m);
      tds[1].textContent = fmt(r.i);
      tds[2].textContent = fmt(r.o);
      tds[3].textContent = speedText(r);
      tds[4].appendChild(statusBadge(r));
      tds[5].textContent = (measured ? '' : '~') + fxMoney(displayCost(r));
      tds[5].title = measured
        ? 'measured — charged by the provider'
        : (costRecorded(r)
          ? 'est. — provider charged ' + fxMoney(r.usd) + ' (free or local), modeled from tokens'
          : 'est. — modeled from tokens');
      if (measured) tds[5].style.color = 'var(--ink)';
      tds[6].textContent = whenStamp(r.t);
      hoverRecent(tr, r);
      body.appendChild(tr);
    });
    document.getElementById('recentCount').textContent = all.length ? recentRows.length + ' requests' : '';
    paintPager('recentPages', 'recentRange', recentPage, recentPer, recentRows.length, function(p) { recentPage = p; renderRecent(); });
    document.getElementById('recentTable').style.display = all.length ? '' : 'none';
    document.getElementById('emptyRecent').classList.toggle('hidden', all.length > 0);
  }

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
      if (cards && !cards.children.length) cards.innerHTML = '<div class="empty md:col-span-3">' + emptyState('cloud-off', 'Could not load data', 'Serve with tersio gain instead of opening this file directly.') + '</div>';
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
  document.getElementById('reload').addEventListener('click', load);
  (function initSettings() {
    var dlg = document.getElementById('settings');
    if (!dlg) return;
    var nav = document.getElementById('setNav');
    function show(name) {
      Array.prototype.forEach.call(nav.querySelectorAll('.set-navitem'), function(b) {
        b.classList.toggle('on', b.dataset.pane === name);
      });
      Array.prototype.forEach.call(dlg.querySelectorAll('.set-pane'), function(p) {
        p.classList.toggle('on', p.dataset.pane === name);
      });
    }
    nav.addEventListener('click', function(ev) {
      var b = ev.target.closest ? ev.target.closest('.set-navitem') : null;
      if (b) show(b.dataset.pane);
    });
    var search = document.getElementById('setSearch');
    search.addEventListener('input', function() {
      var q = search.value.trim().toLowerCase();
      Array.prototype.forEach.call(nav.querySelectorAll('.set-navitem'), function(b) {
        b.classList.toggle('hide', !!q && b.textContent.toLowerCase().indexOf(q) < 0);
      });
    });
    function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function row(k, v, ok, sub) {
      return '<div class="set-row"><span><span class="k">' + k + '</span>' +
        (sub ? '<p class="s mono">' + sub + '</p>' : '') + '</span>' +
        '<span class="v"><span class="set-dot' + (ok === true ? ' ok' : ok === false ? ' bad' : '') + '"></span>' + v + '</span></div>';
    }
    var SNAP = window.__TERSIO_SNAP || null;
    function apiGet(name) {
      if (SNAP && SNAP[name]) return Promise.resolve({ json: function() { return SNAP[name]; } });
      return fetch(name);
    }
    // shadcn-style select: button + listbox panel, shared by currency/schedule.
    // Panel uses fixed positioning from the button rect so scroll containers
    // never clip it halfway.
    function buildSelect(btnId, panelId, labelId, options, current, onPick) {
      var btn = document.getElementById(btnId), panel = document.getElementById(panelId);
      function labelOf(val) {
        for (var i = 0; i < options.length; i++) if (options[i].val === val) return options[i].label;
        return options.length ? options[0].label : val;
      }
      function paint(val) {
        document.getElementById(labelId).textContent = labelOf(val);
        Array.prototype.forEach.call(panel.children, function(o) {
          o.setAttribute('aria-selected', o.dataset.val === val ? 'true' : 'false');
        });
      }
      options.forEach(function(opt) {
        var o = document.createElement('button');
        o.type = 'button'; o.className = 'selopt mono'; o.dataset.val = opt.val;
        o.setAttribute('role', 'option');
        o.innerHTML = '<span>' + opt.label + '</span><svg class="tick" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
        o.addEventListener('click', function() { open(false); onPick(opt.val); paint(opt.val); });
        panel.appendChild(o);
      });
      function open(showIt) {
        var will = showIt === undefined ? panel.classList.contains('hidden') : showIt;
        panel.classList.toggle('hidden', !will);
        btn.setAttribute('aria-expanded', will ? 'true' : 'false');
        if (will) {
          var r = btn.getBoundingClientRect();
          panel.style.top = Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6) + 'px';
          panel.style.left = Math.max(8, r.right - panel.offsetWidth) + 'px';
        }
      }
      btn.addEventListener('click', function() { open(); });
      document.addEventListener('click', function(ev) {
        if (!panel.classList.contains('hidden') && !btn.contains(ev.target) && !panel.contains(ev.target)) open(false);
      });
      paint(current);
      return { paint: paint };
    }
    var curSel = buildSelect('setCurBtn', 'setCurPanel', 'setCurLabel',
      Object.keys(CURS).map(function(k) { return { val: k, label: FLAGS[k] + ' ' + k }; }),
      fx.cur, function(k) { applyCurrency(k); });
    var SCHEDS = [
      { val: 'manual', label: 'Manual' },
      { val: 'daily', label: 'Daily' },
      { val: 'weekly', label: 'Weekly' },
      { val: 'monthly', label: 'Monthly' },
    ];
    var schedSel = buildSelect('setSchedBtn', 'setSchedPanel', 'setSchedLabel', SCHEDS, 'manual', function(v) {
      if (window.location.protocol === 'file:') return;
      fetch('doctor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: v }) })
        .then(function(r) { return r.json(); }).then(function(d) { paintDoctor(d); }).catch(function() { });
    });
    function ago(ts) {
      var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    }
    function paintDoctor(d) {
      var el = document.getElementById('setDoctor');
      el.innerHTML = (d.rows || []).map(function(r) {
        return row(escH(r.label), r.ok ? 'pass' : 'fix', !!r.ok, escH(r.detail || ''));
      }).join('') || row('Diagnosis', 'empty', false);
      document.getElementById('setDiagChecked').textContent = d.checkedAt ? 'Checked ' + ago(d.checkedAt) + '.' : 'Never checked.';
      schedSel.paint(d.schedule || 'manual');
    }
    function loadHealth() {
      var el = document.getElementById('setHealth');
      apiGet('health').then(function(r) { return r.json(); }).then(function(h) {
        el.innerHTML =
          row('Status', h.omp ? 'Connected' : 'Offline', !!h.omp, h.omp ? 'wrapped with omp ' + escH(h.omp) : 'omp CLI not found') +
          row('Data home', escH(h.home || ''), true);
      }).catch(function() { el.innerHTML = row('Status', 'unreachable', false); });
    }
    function loadDoctor(fresh) {
      var el = document.getElementById('setDoctor');
      el.innerHTML = row('Diagnosis', 'checking…', null);
      apiGet(fresh ? 'doctor?fresh=1' : 'doctor').then(function(r) { return r.json(); }).then(function(d) {
        paintDoctor(d);
      }).catch(function() { el.innerHTML = row('Diagnosis', 'unreachable', false); });
    }
    document.getElementById('setDiagRefresh').addEventListener('click', function() { loadDoctor(true); });
    document.getElementById('setFixIssues').addEventListener('click', function() {
      var label = document.getElementById('setFixLabel');
      if (window.location.protocol === 'file:') { toast('Serve with tersio gain', 'Fix runs on the live server only.', 'wrench'); return; }
      label.textContent = 'Fixing…';
      fetch('doctor/fix', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(d) {
        label.textContent = 'Fix issues';
        if (d.failed && d.failed.length) toast('Fix incomplete', d.failed.join(', '), 'circle-alert');
        else toast('Fix done', 'Repairs applied. Restart OMP.', 'wrench');
        loadDoctor(true);
      }).catch(function() {
        label.textContent = 'Fix issues';
        toast('Fix failed', 'Could not reach the server.', 'circle-alert');
      });
    });
    var opened = false;
    dlg.addEventListener('close', function() { opened = false; document.body.style.overflow = ''; });
    new MutationObserver(function() {
      if (dlg.open && !opened) {
        opened = true; show('general');
        document.body.style.overflow = 'hidden';
        curSel.paint(fx.cur);
        loadHealth(); loadDoctor(false);
      }
    }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  })();
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
})();

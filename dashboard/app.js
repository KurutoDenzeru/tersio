(function () {
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

  function countUp(el, target, money) {
    function text(v) { return money ? '$' + v.toFixed(2) : fmt(Math.round(v)); }
    if (!hasGsap || target <= 0) { el.textContent = text(target); return; }
    var o = { v: 0 };
    gsap.to(o, { v: target, duration: 1.1, ease: 'power3.out', onUpdate: function () { el.textContent = text(o.v); } });
  }

  function tick() {
    var c = document.getElementById('clock');
    if (c) c.textContent = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  tick(); setInterval(tick, 1000);
  function syncThemeIcon() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var moon = document.getElementById('iconMoon'), sun = document.getElementById('iconSun');
    if (moon) moon.classList.toggle('hidden', dark);
    if (sun) sun.classList.toggle('hidden', !dark);
  }
  syncThemeIcon();
  document.getElementById('theme').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = (cur || (sysDark ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tersio-theme', next); } catch (e) {}
    syncThemeIcon();
  });

  var PROVIDERS = [
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
    [/gemini|google/i, 'Google', 'googlegemini', '#4285f4'],
  ];
  function vendorOf(model) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i][0].test(model)) return { name: PROVIDERS[i][1], slug: PROVIDERS[i][2], color: PROVIDERS[i][3] };
    }
    return { name: 'Other', slug: '', color: '#71717a' };
  }
  // Brand glyph from the Simple Icons CDN; a missing slug (or offline export)
  // falls back to a neutral bot glyph. Never a bare initial.
  function brandHTML(v, small) {
    var icon = v.slug
      ? '<img src="https://cdn.simpleicons.org/' + v.slug + '/white" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';">'
      : '';
    var fb = '<i data-lucide="bot" class="fb"' + (v.slug ? '' : ' style="display:grid"') + '></i>';
    return '<span class="brandmark' + (small ? ' sm' : '') + '" style="background:' + v.color + '" title="' + v.name + '">' + icon + fb + '</span>';
  }
  var PALETTE = ['#34d399', '#818cf8', '#22d3ee', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf'];

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function modelTotal(byModel, m) {
    var b = byModel[m] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return b.input + b.output + b.cacheRead + b.cacheWrite;
  }

  var DATA = null, RANGE = 'daily', cardsShown = false;

  function topModels(byModel, n) {
    return Object.keys(byModel).sort(function (a, b) { return modelTotal(byModel, b) - modelTotal(byModel, a); }).slice(0, n);
  }

  function allDays() {
    var set = {};
    Object.keys(DATA.byDay || {}).forEach(function (d) { set[d] = 1; });
    Object.keys(DATA.byDayModel || {}).forEach(function (d) { set[d] = 1; });
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
  function shortName(m) { return m.length > 22 ? m.slice(0, 21) + '...' : m; }
  function tipDayHTML(key, total, rows) {
    var h = '<div class="tt">' + dateHead(key) + '</div><div class="tv">' + fmtShort(total) + ' total</div>';
    rows.forEach(function (r) {
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
    var h = '<div class="tt">' + shortName(m) + '</div><div class="tv">' + fmtShort(total) + ' total</div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">input</span><span class="tvr">' + fmt(b.input) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">output</span><span class="tvr">' + fmt(b.output) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">requests</span><span class="tvr">' + fmt(req) + '</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">cache hit</span><span class="tvr">' + hit + '</span></div>';
    return h;
  }
  function tipCo2HTML() {
    var h = '<div class="tt">CO2</div><div class="tv">~' + (DATA.co2g || 0).toFixed(1) + 'g est.</div>';
    h += '<div class="tr"><span class="sw" style="background:var(--accent)"></span><span class="tn">energy</span><span class="tvr">~' + (DATA.energyWh || 0).toFixed(1) + ' Wh</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">method</span><span class="tvr">EcoLogits 0.8.2 port</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">served</span><span class="tvr">ceiling / 32</span></div>';
    h += '<div class="tr"><span class="sw" style="background:var(--dim)"></span><span class="tn">grid</span><span class="tvr">per provider</span></div>';
    return h;
  }
  function hoverModel(el, m) {
    el.addEventListener('mouseenter', function (ev) { showTip(tipModelHTML(m), ev.clientX, ev.clientY); });
    el.addEventListener('mousemove', function (ev) { moveTip(ev.clientX, ev.clientY); });
    el.addEventListener('mouseleave', hideTip);
  }
  function dayModelRows(key) {
    var per = (DATA.byDayModel || {})[key] || {};
    var tops = topModels(DATA.byModel || {}, 8), rows = [], other = 0;
    tops.forEach(function (m, i) {
      var v = per[m] || 0;
      if (v) rows.push([m, v, PALETTE[i % PALETTE.length]]);
    });
    Object.keys(per).forEach(function (m) { if (tops.indexOf(m) < 0) other += per[m]; });
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
    tops.forEach(function (m, i) {
      var v = weekPer[m] || 0;
      if (v) rows.push([m, v, PALETTE[i % PALETTE.length]]);
    });
    Object.keys(weekPer).forEach(function (m) { if (tops.indexOf(m) < 0) other += weekPer[m]; });
    if (other) rows.push(['Other', other, 'var(--dim)']);
    return tipDayHTML(head, weekTotal, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
  }
  function renderGraph(byDay) {
    var g = document.getElementById('graph');
    g.innerHTML = '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today); start.setDate(start.getDate() - (52 * 7) - today.getDay());
    var sums = {};
    Object.keys(byDay).forEach(function (day) {
      var b = byDay[day];
      sums[day] = b.input + b.output + b.cacheRead + b.cacheWrite;
    });
    // per-day values under the active mode
    var dayKeys = [], wk;
    for (wk = 0; wk < 53; wk++) for (var di = 0; di < 7; di++) {
      var dd = new Date(start); dd.setDate(dd.getDate() + wk * 7 + di);
      dayKeys.push(dayKey(dd));
    }
    var weekPer = {}, weekTotal = {}, run = 0, cellVal = {};
    dayKeys.forEach(function (k) {
      var dt = new Date(k + 'T12:00:00');
      if (GMODE === 'weekly' && !isNaN(dt)) {
        var mk = dayKey(mondayOf(dt));
        weekTotal[mk] = (weekTotal[mk] || 0) + (sums[k] || 0);
        var per = (DATA.byDayModel || {})[k] || {};
        if (!weekPer[mk]) weekPer[mk] = {};
        Object.keys(per).forEach(function (m) { weekPer[mk][m] = (weekPer[mk][m] || 0) + per[m]; });
      }
      if (GMODE === 'cumulative') { run += sums[k] || 0; cellVal[k] = run; }
    });
    var max = 1;
    if (GMODE === 'weekly') {
      Object.keys(weekTotal).forEach(function (k) { max = Math.max(max, weekTotal[k]); });
    } else if (GMODE === 'cumulative') {
      max = Math.max(1, run);
    } else {
      Object.keys(sums).forEach(function (k) { max = Math.max(max, sums[k]); });
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
          tipFn = (function (mk3, vv) {
            return function () { return weekTipHTML(mk3, vv, weekPer[mk3] || {}); };
          })(mk2, v);
        } else if (GMODE === 'cumulative') {
          v = cellVal[key] || 0;
          tipFn = (function (kk, vv) {
            return function () {
              var rows = dayModelRows(kk);
              return tipDayHTML('THROUGH ' + dateHead(kk), vv, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
            };
          })(key, v);
        } else {
          v = sums[key] || 0;
          tipFn = (function (kk, vv) {
            return function () {
              var rows = dayModelRows(kk);
              return tipDayHTML(kk, vv, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
            };
          })(key, v);
        }
        var lvl = 0;
        if (v > 0) lvl = Math.min(4, 1 + Math.floor((v / max) * 3.99));
        var cell = document.createElement('span');
        cell.className = 'cell' + (lvl ? ' l' + lvl : '');
        (function (fn) {
          cell.addEventListener('mouseenter', function (ev) { showTip(fn(), ev.clientX, ev.clientY); });
          cell.addEventListener('mousemove', function (ev) { moveTip(ev.clientX, ev.clientY); });
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
    Array.prototype.forEach.call(months.children, function (m) { m.style.minWidth = '0'; });
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
    Array.prototype.forEach.call(document.querySelectorAll('#activity [data-gmode]'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#activity [data-gmode]'), function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        GMODE = btn.getAttribute('data-gmode');
        if (DATA) renderGraph(DATA.byDay || {});
      });
    });
  }

  // 30-day token line: daily totals, smoothed path, hover dot + per-model tip.
  function wow(model) {
    var days = allDays().slice(-14), cur = 0, prev = 0;
    days.forEach(function (d, i) {
      var v = ((DATA.byDayModel || {})[d] || {})[model] || 0;
      if (i < days.length - 7) prev += v; else cur += v;
    });
    if (!prev) return cur ? 'new' : '-';
    var p = Math.round((cur - prev) / prev * 100);
    return (p >= 0 ? '+' : '') + p + '%';
  }
  function renderModels() {
    var byModel = DATA.byModel || {};
    var tops = topModels(byModel, 8).filter(function (m) { return modelTotal(byModel, m) > 0; });
    var cards = document.getElementById('modelCards');
    cards.innerHTML = '';
    tops.slice(0, 3).forEach(function (m, i) {
      var v = vendorOf(m), d = wow(m);
      var card = document.createElement('div');
      card.className = 'modelcard relative p-4 rounded-xl overflow-hidden';
      if (v.slug) {
        var ghost = document.createElement('img');
        ghost.className = 'ghostimg'; ghost.alt = '';
        ghost.src = 'https://cdn.simpleicons.org/' + v.slug + '/white';
        ghost.setAttribute('aria-hidden', 'true');
        card.appendChild(ghost);
      }
      card.style.cssText = 'border: 1px solid var(--line); background: var(--panel)';
      var head = document.createElement('p');
      head.className = 'mono text-xs mb-3'; head.style.color = 'var(--dim)';
      head.textContent = '0' + (i + 1);
      var row = document.createElement('div');
      row.className = 'flex items-center gap-3';
      var badgeWrap = document.createElement('span');
      badgeWrap.innerHTML = brandHTML(v, false);
      var badge = badgeWrap.firstChild;
      var mid = document.createElement('div'); mid.className = 'min-w-0 flex-1';
      var nm = document.createElement('p'); nm.className = 'mono text-sm font-bold truncate'; nm.textContent = m;
      var vn = document.createElement('p'); vn.className = 'mono text-xs truncate'; vn.style.color = 'var(--dim)'; vn.textContent = v.name;
      mid.appendChild(nm); mid.appendChild(vn);
      var tot = document.createElement('p'); tot.className = 'mono font-bold text-lg shrink-0'; tot.textContent = fmtShort(modelTotal(byModel, m));
      row.appendChild(badge); row.appendChild(mid); row.appendChild(tot);
      card.appendChild(head); card.appendChild(row);
      if (d !== 'new') {
        var delta = document.createElement('p');
        delta.className = 'mono text-xs mt-3';
        delta.style.color = d.charAt(0) === '-' ? '#f87171' : 'var(--accent)';
        delta.textContent = d;
        card.appendChild(delta);
      }
      hoverModel(card, m);
      cards.appendChild(card);
    });
    var ol = document.getElementById('models');
    ol.innerHTML = '';
    var max = 1;
    tops.forEach(function (m) { max = Math.max(max, modelTotal(byModel, m)); });
    tops.forEach(function (m, i) {
      var v = vendorOf(m);
      var li = document.createElement('li');
      li.className = 'mrow flex items-center gap-3 px-4 py-3' + (i < tops.length - 1 ? ' rowline' : '');
      var badgeWrap = document.createElement('span');
      badgeWrap.innerHTML = brandHTML(v, true);
      var badge = badgeWrap.firstChild;
      var mid = document.createElement('div'); mid.className = 'min-w-0 flex-1';
      var nm = document.createElement('p'); nm.className = 'mono text-sm truncate'; nm.textContent = m;
      var track = document.createElement('div'); track.className = 'bar-track mt-1.5 h-1.5 overflow-hidden';
      var fill = document.createElement('div'); fill.className = 'bar-fill h-full';
      var mv = modelTotal(byModel, m);
      fill.dataset.w = Math.round(mv / max * 100) + '%';
      fill.style.width = '0';
      track.appendChild(fill); mid.appendChild(nm); mid.appendChild(track);
      var right = document.createElement('div'); right.className = 'shrink-0 text-right';
      var n = document.createElement('p'); n.className = 'mono font-bold'; n.textContent = fmt(modelTotal(byModel, m));
      var cost = document.createElement('p'); cost.className = 'mono text-xs'; cost.style.color = 'var(--dim)';
      cost.textContent = '$' + ((DATA.byModelUsd || {})[m] ?? 0).toFixed(2);
      right.appendChild(n); right.appendChild(cost);
      li.appendChild(badge); li.appendChild(mid); li.appendChild(right);
      hoverModel(li, m);
      ol.appendChild(li);
    });
    if (!tops.length) ol.innerHTML = '<li class="mono text-sm px-4 py-6" style="color: var(--dim)">no session tokens yet</li>';
    else if ('IntersectionObserver' in window && !reduce) {
      var fio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.querySelectorAll('.bar-fill').forEach(function (f) { f.style.width = f.dataset.w || '0'; });
            fio.disconnect();
          }
        });
      }, { threshold: 0.2 });
      fio.observe(ol);
    } else {
      ol.querySelectorAll('.bar-fill').forEach(function (f) { f.style.width = f.dataset.w || '0'; });
    }
    if (hasGsap && hasST && !cardsShown && tops.length) {
      cardsShown = true;
      gsap.from('#modelCards > div', {
        scale: 0.92, opacity: 0.2, duration: 0.6, ease: 'power2.out', stagger: 0.08, overwrite: true,
        scrollTrigger: { trigger: '#modelCards', start: 'top 88%' }
      });
    }
  }

  function renderTools() {
    var body = document.getElementById('top');
    body.innerHTML = '';
    var tools = DATA.byTool || [], max = 1, sum = 0;
    tools.forEach(function (r) { max = Math.max(max, r[1]); sum += r[1]; });
    tools.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.className = 'mrow' + (i < tools.length - 1 ? ' rowline' : '');
      var share = sum ? Math.round(r[1] / sum * 100) : 0;
      tr.innerHTML = '<td class="text-right pr-3 py-2.5 mono text-xs w-10" style="color: var(--dim)"></td>' +
        '<td class="py-2.5 pr-3 truncate" style="max-width: 280px"></td>' +
        '<td class="text-right py-2.5 pr-3 font-bold"></td>' +
        '<td class="text-right py-2.5 pr-3" style="color: var(--dim)"></td>' +
        '<td class="py-2.5 min-w-32"><div class="bar-track h-1.5 overflow-hidden"><div class="bar-fill h-full"></div></div></td>';
      var tds = tr.children;
      tds[0].textContent = String(i + 1).padStart(2, '0');
      tds[1].textContent = r[0];
      tds[1].title = r[0];
      tds[2].textContent = fmt(r[1]);
      tds[3].textContent = share + '%';
      tds[4].firstChild.firstChild.style.width = r[1] ? Math.round(r[1] / max * 100) + '%' : '0';
      body.appendChild(tr);
    });
    document.getElementById('topTable').style.display = tools.length ? '' : 'none';
    document.getElementById('emptyTop').classList.toggle('hidden', tools.length > 0);
  }

  function fmtMs(ms) {
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }
  function renderRtk() {
    var g = (DATA.rtkGain || {}), rows = g.byCommand || [];
    var body = document.getElementById('rtkBody');
    body.innerHTML = '';
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.saved); });
    rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.className = 'mrow' + (i < rows.length - 1 ? ' rowline' : '');
      tr.innerHTML = '<td class="text-right pr-3 py-2.5 mono text-xs w-10" style="color: var(--dim)"></td>' +
        '<td class="py-2.5 pr-3 truncate" style="max-width: 280px"></td>' +
        '<td class="text-right py-2.5 pr-3 font-bold"></td>' +
        '<td class="text-right py-2.5 pr-3 font-bold"></td>' +
        '<td class="text-right py-2.5 pr-3" style="color: var(--accent)"></td>' +
        '<td class="text-right py-2.5 pr-3" style="color: var(--dim)"></td>' +
        '<td class="py-2.5 min-w-32"><div class="bar-track h-1.5 overflow-hidden"><div class="bar-fill h-full"></div></div></td>';
      var tds = tr.children;
      tds[0].textContent = String(i + 1).padStart(2, '0');
      tds[1].textContent = r.command;
      tds[1].title = r.command;
      tds[2].textContent = fmt(r.count);
      tds[3].textContent = fmtShort(r.saved);
      tds[4].textContent = r.avgPct.toFixed(1) + '%';
      tds[5].textContent = fmtMs(r.avgMs);
      tds[6].firstChild.firstChild.style.width = r.saved ? Math.round(r.saved / max * 100) + '%' : '0';
      body.appendChild(tr);
    });
    document.getElementById('rtkTable').style.display = rows.length ? '' : 'none';
    document.getElementById('emptyRtk').classList.toggle('hidden', rows.length > 0);
    document.getElementById('rtkScope').textContent =
      g.commands ? fmt(g.commands) + ' commands - ' + fmtShort(g.saved) + ' saved (' + g.avgPct.toFixed(1) + '%) - measured by rtk' : 'measured by rtk';
  }

  function renderStrip(t) {
    var defs = [
      ['input', t.input, 'arrow-down-to-line'],
      ['output', t.output, 'arrow-up-from-line'],
      ['cache read', t.cacheRead, 'hard-drive-download'],
      ['cache write', t.cacheWrite, 'hard-drive-upload']
    ];
    var strip = document.getElementById('tokens');
    strip.innerHTML = '';
    defs.forEach(function (b, i) {
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

  function money(v) { return '$' + v.toFixed(2); }

  // 30-day volume sparkline + blended-rate daily stats for the USD card.
  // Daily cost is a blended estimate (total USD / total tokens x day
  // tokens), always rendered with ~ and never mixed with measured totals.
  function renderSpark(byDay, usd, savedUsd, total) {
    var el = document.getElementById('usdSpark');
    el.innerHTML = '';
    var keys = Object.keys(byDay).sort().slice(-30);
    var rate = total ? usd / total : 0;
    var max = 1, vols = [];
    keys.forEach(function (k) {
      var v = dayTotal(byDay[k] || {});
      vols.push({ k: k, v: v });
      max = Math.max(max, v);
    });
    var top = vols.slice().sort(function (a, b) { return b.v - a.v; })[0] || { k: '', v: 0 };
    vols.forEach(function (r) {
      var s = document.createElement('span');
      if (r.k === top.k && r.v > 0) s.className = 'top';
      s.style.height = r.v ? Math.max(4, Math.round(r.v / max * 100)) + '%' : '0';
      s.dataset.usd = (rate * r.v).toFixed(2);
      s.dataset.tok = r.v;
      s.dataset.day = r.k;
      s.addEventListener('mouseenter', function (ev) {
        showTip('<div class="tt">' + dateHead(s.dataset.day) + '</div><div class="tv">~$' + s.dataset.usd + '</div>' +
          '<div class="tr"><span class="sw" style="background:var(--accent)"></span>' +
          '<span class="tn">tokens</span><span class="tvr">' + fmt(Number(s.dataset.tok)) + '</span></div>',
          ev.clientX, ev.clientY);
      });
      s.addEventListener('mousemove', function (ev) { moveTip(ev.clientX, ev.clientY); });
      s.addEventListener('mouseleave', hideTip);
      el.appendChild(s);
    });
    var days = keys.length || 1;
    document.getElementById('usdPerDay').textContent = '$' + (usd / days).toFixed(2);
    document.getElementById('usdTopDay').textContent = top.k ? top.k.slice(5) + ' ~$' + (rate * top.v).toFixed(2) : '-';
    document.getElementById('usdLeverage').textContent = usd ? (savedUsd / usd).toFixed(1) : '-';
  }

  // Week-over-week sums from byDay: { cur, prev } for a token selector.
  function weekSplit(days, pick) {
    var keys = Object.keys(days).sort(), cur = 0, prev = 0;
    var last = keys.slice(-14);
    last.forEach(function (k, i) {
      var v = pick(days[k] || {});
      if (i < last.length - 7) prev += v; else cur += v;
    });
    return { cur: cur, prev: prev };
  }
  function pillHTML(cur, prev, goodWhenUp) {
    if (!prev) return { text: cur ? 'new' : '-', cls: 'flat' };
    var p = (cur - prev) / prev * 100, a = Math.abs(p);
    var cls = a < 0.5 ? 'flat' : ((p > 0) === goodWhenUp ? 'good' : 'bad');
    return { text: (p >= 0 ? '▲ +' : '▼ ') + a.toFixed(1) + '% vs prior 7d', cls: cls };
  }
  function setPill(id, cur, prev, goodWhenUp) {
    var el = document.getElementById(id), r = pillHTML(cur, prev, goodWhenUp);
    el.textContent = r.text;
    el.className = 'pill mono ' + r.cls;
  }
  function dayTotal(b) { return (b.input || 0) + (b.output || 0) + (b.cacheRead || 0) + (b.cacheWrite || 0); }

  function render(d) {
    DATA = d;
    var t = d.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    var total = t.input + t.output + t.cacheRead + t.cacheWrite;
    var totalEl = document.getElementById('total');
    if (hasGsap) {
      var o = { v: 0 };
      gsap.to(o, { v: total, duration: 1.2, ease: 'power3.out', onUpdate: function () { totalEl.textContent = fmt(o.v); } });
    } else {
      totalEl.textContent = fmt(total);
    }
    countUp(document.getElementById('usd'), d.usd || 0, true);
    document.getElementById('usdNote').textContent = d.priced ? 'per-model price table' : 'incl. default pricing';
    var byDay = d.byDay || {};
    renderSpark(byDay, d.usd || 0, d.savedUsd || 0, total);
    document.getElementById('verChip').textContent = 'tersio v' + (d.version || '?');
    var wAll = weekSplit(byDay, dayTotal);
    setPill('usdDelta', wAll.cur, wAll.prev, false);
    countUp(document.getElementById('saved'), d.savedUsd || 0, true);
    document.getElementById('co2').textContent = '~' + (d.co2g || 0).toFixed(1) + 'g';
    (function () {
      var el = document.getElementById('co2');
      var card = el ? el.closest('div.rounded-xl') : null;
      if (!card || card.dataset.co2tip) return;
      card.dataset.co2tip = '1';
      card.addEventListener('mouseenter', function (ev) { showTip(tipCo2HTML(), ev.clientX, ev.clientY); });
      card.addEventListener('mousemove', function (ev) { moveTip(ev.clientX, ev.clientY); });
      card.addEventListener('mouseleave', hideTip);
    })();
    var share = total ? Math.round((t.cacheRead + t.cacheWrite) / total * 100) : 0;
    document.getElementById('cacheShare').textContent = share + '%';
    var shareOf = function (b) { var s = dayTotal(b); return s ? ((b.cacheRead || 0) + (b.cacheWrite || 0)) / s * 100 : 0; };
    var keys = Object.keys(byDay).sort(), cPct = 0, pPct = 0, cn = 0, pn = 0;
    keys.slice(-7).forEach(function (k) { cPct += shareOf(byDay[k]); cn++; });
    keys.slice(-14, -7).forEach(function (k) { pPct += shareOf(byDay[k]); pn++; });
    var pp = (cn ? cPct / cn : 0) - (pn ? pPct / pn : 0);
    var cd = document.getElementById('cacheDelta');
    cd.textContent = (pp >= 0 ? '▲ +' : '▼ ') + Math.abs(pp).toFixed(1) + 'pp vs prior 7d';
    cd.className = 'pill mono ' + (Math.abs(pp) < 0.05 ? 'flat' : (pp > 0 ? 'good' : 'bad'));

    (function () {
      var el = document.getElementById('ticker');
      if (!el) return;
      var tops = topModels(DATA.byModel || {}, 5);
      var parts = tops.map(function (m) {
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
    renderGraph(d.byDay || {});
    renderModels();
    renderTools();
    renderRtk();

    if (window.lucide) lucide.createIcons();
    if (hasGsap) {
      gsap.from('.hero-in', { y: 26, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08 });
    }
    observe();
  }

  var seen = new WeakSet();
  function observe() {
    var els = document.querySelectorAll('.rise');
    if (!('IntersectionObserver' in window) || reduce) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !seen.has(e.target)) {
          seen.add(e.target); e.target.classList.add('in'); io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { if (!seen.has(el)) io.observe(el); });
  }

  function load() {
    fetch('data.json').then(function (r) { return r.json(); }).then(render).catch(function () {
      document.getElementById('topTable').style.display = 'none';
      document.getElementById('emptyTop').classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
      observe();
    });
  }
  document.getElementById('reload').addEventListener('click', load);
  load();
  observe();
})();

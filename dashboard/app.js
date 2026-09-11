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

  function renderGraph(byDay) {
    var g = document.getElementById('graph');
    g.innerHTML = '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today); start.setDate(start.getDate() - (25 * 7) - today.getDay());
    var max = 1, sums = {};
    Object.keys(byDay).forEach(function (day) {
      var b = byDay[day];
      sums[day] = b.input + b.output + b.cacheRead + b.cacheWrite;
      if (sums[day] > max) max = sums[day];
    });
    var months = document.getElementById('graphMonths');
    months.innerHTML = '';
    var lastMonth = '';
    for (var w = 0; w < 26; w++) {
      var col = document.createElement('div');
      col.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:0;';
      var ml = document.createElement('span');
      ml.className = 'heatmonth w-full truncate';
      for (var i = 0; i < 7; i++) {
        var dt = new Date(start); dt.setDate(dt.getDate() + w * 7 + i);
        var key = dayKey(dt), v = sums[key] || 0, lvl = 0;
        if (v > 0) lvl = Math.min(4, 1 + Math.floor((v / max) * 3.99));
        var cell = document.createElement('span');
        cell.className = 'cell' + (lvl ? ' l' + lvl : '');
        (function (day, total) {
          cell.addEventListener('mouseenter', function (ev) {
            var rows = dayModelRows(day);
            showTip(tipDayHTML(day, total, rows.length ? rows : [['no activity', 0, 'var(--dim)']]), ev.clientX, ev.clientY);
          });
          cell.addEventListener('mousemove', function (ev) { moveTip(ev.clientX, ev.clientY); });
          cell.addEventListener('mouseleave', hideTip);
        })(key, v);
        col.appendChild(cell);
        if (i === 0) {
          var mm = dt.toLocaleString('en-US', { month: 'short' });
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
  }

  // 30-day token line: daily totals, smoothed path, hover dot + per-model tip.
  function renderLine() {
    var svg = document.getElementById('line');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var NS = 'http://www.w3.org/2000/svg';
    var days = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 29; i >= 0; i--) { var dt = new Date(today); dt.setDate(dt.getDate() - i); days.push(dayKey(dt)); }
    var pts = days.map(function (k) { return { k: k, v: dayTotal((DATA.byDay || {})[k] || {}) }; });
    var max = 1, any = false, qi;
    for (qi = 0; qi < pts.length; qi++) { if (pts[qi].v) { any = true; max = Math.max(max, pts[qi].v); } }
    document.getElementById('lineEmpty').classList.toggle('hidden', any);
    svg.style.display = any ? '' : 'none';
    var labels = document.getElementById('lineDays');
    labels.innerHTML = '';
    if (!any) return;
    var W = 600, H = 200, PAD = 8, TOP = 16;
    function X(i) { return PAD + i * (W - 2 * PAD) / 29; }
    function Y(v) { return H - PAD - (v / max) * (H - PAD - TOP); }
    var gi;
    for (gi = 1; gi <= 3; gi++) {
      var ln = document.createElementNS(NS, 'line');
      var gy = PAD + (H - PAD - TOP) * gi / 4 + TOP * 0;
      ln.setAttribute('x1', PAD); ln.setAttribute('x2', W - PAD);
      ln.setAttribute('y1', gy); ln.setAttribute('y2', gy);
      ln.setAttribute('stroke', 'var(--line)'); ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
    }
    var cssAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#34d399';
    var defs = document.createElementNS(NS, 'defs');
    var grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', 'linefill'); grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    var s1 = document.createElementNS(NS, 'stop');
    s1.setAttribute('offset', '0'); s1.setAttribute('stop-color', cssAccent); s1.setAttribute('stop-opacity', '.35');
    var s2 = document.createElementNS(NS, 'stop');
    s2.setAttribute('offset', '1'); s2.setAttribute('stop-color', cssAccent); s2.setAttribute('stop-opacity', '0');
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);
    function smooth(closed) {
      var d = 'M' + X(0).toFixed(1) + ',' + Y(pts[0].v).toFixed(1);
      var i, p0, p1, p2, p3, c1x, c1y, c2x, c2y;
      for (i = 0; i < pts.length - 1; i++) {
        p0 = pts[Math.max(0, i - 1)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[Math.min(pts.length - 1, i + 2)];
        c1x = X(i) + (X(i + 1) - X(Math.max(0, i - 1))) / 6;
        c1y = Y(p1.v) + (Y(p2.v) - Y(p0.v)) / 6;
        c2x = X(i + 1) - (X(Math.min(29, i + 2)) - X(i)) / 6;
        c2y = Y(p2.v) - (Y(p3.v) - Y(p1.v)) / 6;
        d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + X(i + 1).toFixed(1) + ',' + Y(p2.v).toFixed(1);
      }
      if (closed) d += 'L' + X(29).toFixed(1) + ',' + (H - PAD) + 'L' + X(0).toFixed(1) + ',' + (H - PAD) + 'Z';
      return d;
    }
    var area = document.createElementNS(NS, 'path');
    area.setAttribute('d', smooth(true)); area.setAttribute('fill', 'url(#linefill)');
    svg.appendChild(area);
    var line = document.createElementNS(NS, 'path');
    line.setAttribute('d', smooth(false)); line.setAttribute('fill', 'none');
    line.setAttribute('stroke', cssAccent); line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
    var hoverG = document.createElementNS(NS, 'g');
    hoverG.style.display = 'none';
    var cross = document.createElementNS(NS, 'line');
    cross.setAttribute('y1', TOP - 6); cross.setAttribute('y2', H - PAD);
    cross.setAttribute('stroke', 'var(--dim)'); cross.setAttribute('stroke-width', '1');
    cross.setAttribute('stroke-dasharray', '3 3');
    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '4.5'); dot.setAttribute('fill', cssAccent);
    dot.setAttribute('stroke', 'var(--panel)'); dot.setAttribute('stroke-width', '2');
    hoverG.appendChild(cross); hoverG.appendChild(dot); svg.appendChild(hoverG);
    var hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', '0'); hit.setAttribute('y', '0');
    hit.setAttribute('width', W); hit.setAttribute('height', H);
    hit.setAttribute('fill', 'transparent');
    hit.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect();
      var idx = Math.max(0, Math.min(29, Math.round((ev.clientX - r.left) / r.width * 29)));
      var p = pts[idx];
      cross.setAttribute('x1', X(idx)); cross.setAttribute('x2', X(idx));
      dot.setAttribute('cx', X(idx)); dot.setAttribute('cy', Y(p.v));
      hoverG.style.display = '';
      var rows = dayModelRows(p.k);
      var html = tipDayHTML(p.k, p.v, rows.length ? rows : [['no activity', 0, 'var(--dim)']]);
      showTip(html, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', function () { hoverG.style.display = 'none'; hideTip(); });
    svg.appendChild(hit);
    [['left', 0], ['center', 14], ['right', 29]].forEach(function (pos) {
      var s = document.createElement('span');
      s.className = 'flex-1' + (pos[0] === 'center' ? ' text-center' : pos[0] === 'right' ? ' text-right' : '');
      s.textContent = dateHead(days[pos[1]]);
      labels.appendChild(s);
    });
    if (hasGsap && !reduce) {
      var len = 2000;
      line.style.strokeDasharray = String(len);
      line.style.strokeDashoffset = String(len);
      gsap.to(line.style, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.out' });
    }
  }

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
      tr.className = 'tilt' + (i < tools.length - 1 ? ' rowline' : '');
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

  // 14-day volume sparkline + blended-rate daily stats for the USD card.
  // Daily cost is a blended estimate (total USD / total tokens x day
  // tokens), always rendered with ~ and never mixed with measured totals.
  function renderSpark(byDay, usd, savedUsd, total) {
    var el = document.getElementById('usdSpark');
    el.innerHTML = '';
    var keys = Object.keys(byDay).sort().slice(-14);
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
    var sub = document.getElementById('herosub');
    sub.innerHTML = '';
    ('input ' + fmt(t.input) + ' · output ' + fmt(t.output) + ' · cache read ' + fmt(t.cacheRead) +
      (t.cacheWrite ? ' · cache write ' + fmt(t.cacheWrite) : '') + ' · ' + money(d.usd || 0)).split(' ').forEach(function (w) {
      var s = document.createElement('span'); s.textContent = w + ' ';
      sub.appendChild(s);
    });
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
    var wCache = weekSplit(byDay, function (b) { return b.cacheRead || 0; });
    setPill('savedDelta', wCache.cur, wCache.prev, true);
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
    var wOut = weekSplit(byDay, function (b) { return b.output || 0; });
    setPill('co2Delta', wOut.cur, wOut.prev, false);
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

    renderStrip(t);
    renderGraph(d.byDay || {});
    renderLine();
    renderModels();
    renderTools();

    if (window.lucide) lucide.createIcons();
    if (hasGsap) {
      gsap.from('.hero-in', { y: 26, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08 });
      // Scrub: hero sub words fade in sequence on scroll.
      if (hasST) {
        gsap.fromTo('#herosub span', { opacity: 0.15 }, {
          opacity: 1, ease: 'none', stagger: 0.05,
          scrollTrigger: { trigger: '#herosub', start: 'top 92%', end: 'top 55%', scrub: true }
        });
      }
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

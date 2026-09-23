(function() {
  var T = window.Tersio;
  var fmt = T.fmt, fmtShort = T.fmtShort, fxMoney = T.fxMoney, toast = T.toast;
  (function initShare() {
    function dayStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function streak(byDay) {
      var cur = new Date(); cur.setHours(0, 0, 0, 0);
      var key = dayStr(cur);
      if (!byDay[key]) { cur.setDate(cur.getDate() - 1); key = dayStr(cur); if (!byDay[key]) return 0; }
      var n = 0;
      while (byDay[key]) { n++; cur.setDate(cur.getDate() - 1); key = dayStr(cur); }
      return n;
    }
    function shareStats() {
      var t = (T.getData() && T.getData().tokens) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      var total = t.input + t.output + t.cacheRead + t.cacheWrite;
      var runs = (T.getData() && T.getData().messages) || 0;
      var byModel = (T.getData() && T.getData().byModel) || {};
      var models = Object.keys(byModel).length;
      var cost = (T.getData() && T.getData().usd) || 0;
      var best = 0, bestDay = '';
      Object.keys((T.getData() && T.getData().byDay) || {}).forEach(function(k) {
        var b = (T.getData() && T.getData().byDay)[k];
        var v = b.input + b.output + b.cacheRead + b.cacheWrite;
        if (v > best) { best = v; bestDay = k; }
      });
      return { total: total, runs: runs, avg: runs ? Math.round(total / runs) : 0, saved: (T.getData() && T.getData().savedUsd) || 0, streak: streak((T.getData() && T.getData().byDay) || {}), best: best, bestDay: bestDay, cost: cost, models: models };
    }
    function shareText() {
      var s = shareStats();
      return fmtShort(s.total) + ' tokens / ' + fmt(s.runs) + ' runs / ' + fmtShort(s.avg) + ' per run. Saved ' + fxMoney(s.saved) + ' via cache. ' + s.streak + '-day streak. My AI spend, tracked with Tersio.';
    }
    var brandURI = null, brandQueued = false;
    function loadBrand() {
      if (brandURI || brandQueued || typeof fetch !== 'function') return;
      brandQueued = true;
      fetch('brand.webp').then(function(r) { return r.blob(); }).then(function(b) {
        var fr = new FileReader();
        fr.onload = function() { brandURI = fr.result; };
        fr.readAsDataURL(b);
      }).catch(function() { });
    }
    loadBrand();
    function paint() {
      var s = shareStats();
      document.getElementById('shareTotal').textContent = fmtShort(s.total) + ' tokens';
      document.getElementById('shareRuns').textContent = 'across ' + fmt(s.runs) + ' agent runs';
      document.getElementById('shareAvg').textContent = fmtShort(s.avg) + ' / run';
      document.getElementById('shareSaved').textContent = fxMoney(s.saved);
      document.getElementById('shareBest').textContent = fmtShort(s.best);
      document.getElementById('shareBest').title = s.bestDay || '';
      document.getElementById('shareCost').textContent = fxMoney(s.cost);
      document.getElementById('shareModels').textContent = String(s.models);
      document.getElementById('shareStreak').textContent = s.streak + (s.streak === 1 ? ' day' : ' days');
      document.getElementById('shareBest').textContent = fmtShort(s.best);
      document.getElementById('shareBest').title = s.bestDay || '';
      document.getElementById('shareCost').textContent = fxMoney(s.cost);
      document.getElementById('shareModels').textContent = String(s.models);
      document.getElementById('shareStreak').textContent = s.streak + (s.streak === 1 ? ' day' : ' days');
      paintHeat();
    }
    function heatVals(count) {
      var byDay = (T.getData() && T.getData().byDay) || {};
      var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (count - 1));
      var vals = [], max = 0;
      for (var i = 0; i < count; i++) {
        var k = dayStr(d);
        var b = byDay[k], v = b ? T.dayTotal(b) : 0;
        vals.push(v); if (v > max) max = v;
        d.setDate(d.getDate() + 1);
      }
      return { vals: vals, max: max };
    }
    function heatLevel(v, max) {
      var s = max ? Math.sqrt(v / max) : 0;
      return !v ? '' : s >= 0.7 ? ' l4' : s >= 0.45 ? ' l3' : s >= 0.2 ? ' l2' : ' l1';
    }
    function paintHeat() {
      var el = document.getElementById('shareHeat');
      if (!el) return;
      // GitHub layout: 26 weekly columns × 7 weekday rows, oldest first.
      var h = heatVals(182), out = [];
      for (var d = 0; d < 7; d++) {
        for (var w = 0; w < 26; w++) {
          out.push('<span class="cell' + heatLevel(h.vals[w * 7 + d], h.max) + '"></span>');
        }
      }
      el.innerHTML = out.join('');
    }
    function copyText(text, okMsg) {
      function done() { toast('Copied', okMsg, 'copy'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function() { fallback(); });
      } else fallback();
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove(); done();
        } catch (e) { toast('Copy failed', 'Select the text manually.', 'circle-alert'); }
      }
    }
    function svgCard() {
      var s = shareStats();
      function e(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
      // Render honors the active theme: explicit choice wins, otherwise the
      // OS preference (same rule as applyTheme).
      var themeChoice = null;
      try { themeChoice = localStorage.getItem('tersio-theme'); } catch (err) { }
      var dark = themeChoice ? themeChoice === 'dark'
        : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var pal = dark
        ? { bg: '#09090b', ink: '#f4f4f5', dim: '#a1a1aa', accent: '#34d399' }
        : { bg: '#ffffff', ink: '#18181b', dim: '#52525b', accent: '#047857' };
      var h = heatVals(182);
      var cw = 32, gap = 9, step = cw + gap, gx = 64, gy = 340, grid = '';
      for (var gd = 0; gd < 7; gd++) {
        for (var gw = 0; gw < 26; gw++) {
          var gv = h.vals[gw * 7 + gd];
          var gs = h.max ? Math.sqrt(gv / h.max) : 0;
          var go = gv ? (0.45 + 0.55 * gs).toFixed(2) : 0.13;
          grid += '<rect x="' + (gx + gw * step) + '" y="' + (gy + gd * step) + '" width="' + cw + '" height="' + cw + '" rx="8" fill="' + pal.accent + '" opacity="' + go + '"/>';
        }
      }
      var streakTxt = s.streak + (s.streak === 1 ? ' day' : ' days');
      var logo = brandURI ? '<clipPath id="blogo"><rect x="1012" y="40" width="124" height="124" rx="62"/></clipPath>' +
        '<image x="1012" y="40" width="124" height="124" clip-path="url(#blogo)" href="' + brandURI + '"/>' : '';
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
        '<rect width="1200" height="850" rx="28" fill="' + pal.bg + '"/>' +
        '<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="' + pal.accent + '" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>' +
        '<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="' + pal.accent + '">TERSIO · USAGE PROFILE</text>' +
        '<text x="60" y="250" font-family="monospace" font-size="130" font-weight="bold" fill="' + pal.ink + '">' + e(fmtShort(s.total) + ' tokens') + '</text>' +
        '<text x="64" y="300" font-family="monospace" font-size="30" fill="' + pal.dim + '">across ' + e(fmt(s.runs)) + ' agent runs</text>' +
        grid +
        '<text x="64" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="' + pal.dim + '">AVG / RUN</text>' +
        '<text x="64" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="' + pal.ink + '">' + e(fmtShort(s.avg) + ' / run') + '</text>' +
        '<text x="430" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="' + pal.dim + '">SAVED</text>' +
        '<text x="430" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="' + pal.ink + '">' + e(fxMoney(s.saved)) + '</text>' +
        '<text x="830" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="' + pal.dim + '">DAY STREAK</text>' +
        '<text x="830" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="' + pal.ink + '">' + e(streakTxt) + '</text>' +
        '<text x="64" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="' + pal.dim + '">BEST DAY</text>' +
        '<text x="64" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="' + pal.ink + '">' + e(fmtShort(s.best)) + '</text>' +
        '<text x="430" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="' + pal.dim + '">EST. COST</text>' +
        '<text x="430" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="' + pal.ink + '">' + e(fxMoney(s.cost)) + '</text>' +
        '<text x="830" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="' + pal.dim + '">MODELS</text>' +
        '<text x="830" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="' + pal.ink + '">' + e(s.models) + '</text>' +
        logo + '</svg>';
    }
    function pngBlob(cb) {
      try {
        var img = new Image();
        var svg = new Blob([svgCard()], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(svg);
        img.onload = function() {
          try {
            var c = document.createElement('canvas');
            c.width = 1200; c.height = 850;
            c.getContext('2d').drawImage(img, 0, 0, 1200, 850);
            URL.revokeObjectURL(url);
            if (c.toBlob) c.toBlob(function(b) { cb(b); }, 'image/png');
            else cb(null);
          } catch (e) { cb(null); }
        };
        img.onerror = function() { URL.revokeObjectURL(url); cb(null); };
        img.src = url;
      } catch (e) { cb(null); }
    }
    function copyImage(into) {
      pngBlob(function(b) {
        if (!b || !navigator.clipboard || !window.ClipboardItem) {
          copyText(shareText(), 'Share text copied (image copy unsupported here).');
          return;
        }
        navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(function() {
          toast('Image copied', into, 'image');
        }, function() {
          copyText(shareText(), 'Share text copied (image copy blocked).');
        });
      });
    }
    document.getElementById('shareX').addEventListener('click', function() {
      window.open('https://x.com/intent/post?text=' + encodeURIComponent(shareText() + ' #Tersio'), '_blank', 'noopener,width=560,height=460');
    });
    document.getElementById('shareReddit').addEventListener('click', function() {
      window.open('https://www.reddit.com/submit?title=' + encodeURIComponent('My Tersio usage profile') + '&text=' + encodeURIComponent(shareText()), '_blank', 'noopener');
    });
    document.getElementById('shareCopy').addEventListener('click', function() { copyImage('Card copied — paste it straight into your post.'); });
    document.getElementById('shareLinkedIn').addEventListener('click', function() {
      window.open('https://www.linkedin.com/feed/', '_blank', 'noopener');
      copyImage('Image copied — paste it into the LinkedIn composer.');
    });
    document.getElementById('sharePng').addEventListener('click', function() {
      pngBlob(function(b) {
        if (!b) { toast('Save failed', 'Browser blocked the render.', 'circle-alert'); return; }
        try {
          var a = document.createElement('a');
          a.download = 'tersio-usage.png';
          a.href = URL.createObjectURL(b);
          a.click();
          setTimeout(function() { URL.revokeObjectURL(a.href); }, 5000);
          toast('Saved', 'Card downloaded as PNG.', 'download');
        } catch (e) { toast('Save failed', 'Browser blocked the render.', 'circle-alert'); }
      });
    });
    T.onRender(paint);
    paint();
    var sh = document.getElementById('shareDialog');
    if (sh && typeof sh.showModal === 'function') {
      document.getElementById('shareBtn').addEventListener('click', function() { paint(); sh.showModal(); });
      document.getElementById('shareClose').addEventListener('click', function() { sh.close(); });
      sh.addEventListener('click', function(ev) { if (ev.target === sh) sh.close(); });
      sh.addEventListener('close', function() { document.body.style.overflow = ''; });
      new MutationObserver(function() {
        if (sh.open) document.body.style.overflow = 'hidden';
      }).observe(sh, { attributes: true, attributeFilter: ['open'] });
    }
  })();
})();

(function() {
  var T = window.Tersio;
  var CURS = T.CURS, FLAGS = T.FLAGS, fx = T.fx,
    applyCurrency = T.applyCurrency, toast = T.toast;
  (function initSettings() {
    var dlg = document.getElementById('settings');
    if (!dlg) return;
    var nav = document.getElementById('setNav');
    var title = document.getElementById('settingsTitle');
    var TITLES = { general: 'General', connection: 'Connection', diagnosis: 'Diagnosis', data: 'Data' };
    function show(name) {
      if (title) title.textContent = TITLES[name] || 'Settings';
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
      var groups = [], seen = {};
      (d.rows || []).forEach(function(r) {
        var g = r.group || 'Other';
        if (!seen[g]) { seen[g] = true; groups.push(g); }
      });
      el.innerHTML = groups.map(function(g) {
        var items = (d.rows || []).filter(function(r) { return (r.group || 'Other') === g; }).map(function(r) {
          return row(escH(r.label), r.ok ? 'pass' : 'fix', !!r.ok, escH(r.detail || ''));
        }).join('');
        return '<p class="set-group">' + escH(g) + '</p>' + items;
      }).join('') || row('Diagnosis', 'empty', false);
      document.getElementById('setDiagChecked').textContent = d.checkedAt ? 'Checked ' + ago(d.checkedAt) + '.' : 'Never checked.';
      schedSel.paint(d.schedule || 'manual');
    }
    function loadHealth() {
      var el = document.getElementById('setHealth');
      apiGet('health').then(function(r) { return r.json(); }).then(function(h) {
        el.innerHTML =
          row('Status', h.omp ? 'Connected' : 'Offline', !!h.omp, h.omp ? 'wrapped with omp ' + escH(h.omp) : 'omp CLI not found');
      }).catch(function() { el.innerHTML = row('Status', 'unreachable', false); });
    }
    function loadDoctor(fresh) {
      var el = document.getElementById('setDoctor');
      el.innerHTML = skeleton();
      var snapMode = window.location.protocol === 'file:';
      apiGet(fresh ? 'doctor?fresh=1' : 'doctor').then(function(r) { return r.json(); }).then(function(d) {
        paintDoctor(d);
        if (fresh && snapMode) toast('Snapshot export', 'Live scan needs tersio gain.', 'scan-line');
      }).catch(function() { el.innerHTML = row('Diagnosis', 'unreachable', false); });
    }
    function skeleton() {
      var h = '';
      for (var i = 0; i < 5; i++) h += '<div class="skel-row" aria-hidden="true"><span class="skel-col"><span class="skel t"></span><span class="skel s"></span></span><span class="skel v"></span></div>';
      return h;
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
})();

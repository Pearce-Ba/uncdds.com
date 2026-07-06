/* DDS member dashboard — requires dds-auth.js + dds-family.js.
   Live data comes from the exec board's Google Sheet via its gviz JSONP
   endpoint (no key needed while the sheet is link-viewable); everything the
   member writes (notes, ratings, chat, photos, family edits) lives in
   localStorage stores shared with index.html. */
(function () {
  'use strict';

  if (!window.DDSAuth || !DDSAuth.requireLogin('dashboard.html' + location.search + location.hash)) return;
  var ME = DDSAuth.current();

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var readLS = function (key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
    catch (e) { return fb; }
  };
  var writeLS = function (key, v) { localStorage.setItem(key, JSON.stringify(v)); };
  var uid = function () { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmtTime = function (t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  var fmtDate = function (t) { return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); };
  var num = function (v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var m = /-?\d+(\.\d+)?/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[0]) : 0;
  };

  /* ================= Top bar / greeting ================= */
  (function initShell() {
    var first = ME.name.split(/\s+/)[0];
    $('tb-name').textContent = first;
    if (ME.photo) {
      var img = document.createElement('img'); img.src = ME.photo; img.alt = '';
      $('tb-avatar').replaceWith(img);
    } else {
      $('tb-avatar').textContent = first.charAt(0).toUpperCase();
    }
    $('tb-signout').addEventListener('click', function () { DDSAuth.signOut(); location.href = 'index.html'; });

    var h = new Date().getHours();
    var greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('hello-h1').innerHTML = greet + ', <em>' + esc(first) + '.</em>';
    var meTitle = DDSAuth.isExec(ME) ? (DDSAuth.execTitle(ME) || 'Exec Board') : null;
    $('hello-date').textContent = (meTitle ? meTitle + ' — ' : 'Member dashboard — ') +
      new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

    // scroll-spy for the top nav chips
    var links = Array.prototype.slice.call(document.querySelectorAll('.tb-nav a'));
    var spy = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-38% 0px -56% 0px' });
    ['instruments', 'events', 'meetings', 'classes', 'resources', 'chat', 'family', 'gallery'].forEach(function (id) {
      var s = $(id); if (s) spy.observe(s);
    });

    // generic modal close (backdrop + × + cancel buttons)
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { $(b.getAttribute('data-close')).hidden = true; });
    });
    document.querySelectorAll('.dmodal').forEach(function (m) {
      m.addEventListener('mousedown', function (e) { if (e.target === m) m.hidden = true; });
    });
  })();

  /* ================= Gauges ================= */
  var SWEEP = 260, A0 = -130; // degrees; 0deg points at 12 o'clock

  function polar(cx, cy, r, deg) {
    var a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  }
  function arcPath(cx, cy, r, d0, d1) {
    var p0 = polar(cx, cy, r, d0), p1 = polar(cx, cy, r, d1);
    return 'M ' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      ' A ' + r + ' ' + r + ' 0 ' + (d1 - d0 > 180 ? 1 : 0) + ' 1 ' +
      p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }

  function makeGauge(el, o) { // {label, unit, max, goal, major, minor, big, decimals}
    var cx = 110, cy = 100, R = 78, gid = uid();
    var ang = function (v) { return A0 + SWEEP * Math.min(Math.max(v, 0), o.max) / o.max; };
    var ticks = '', i, p1, p2, v;
    for (v = 0; v <= o.max + 1e-9; v += o.minor) {
      var major = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-9;
      p1 = polar(cx, cy, R, ang(v)); p2 = polar(cx, cy, R - (major ? 11 : 6), ang(v));
      ticks += '<line x1="' + p1[0] + '" y1="' + p1[1] + '" x2="' + p2[0] + '" y2="' + p2[1] +
        '" stroke="' + (major ? 'rgba(234,243,251,.7)' : 'rgba(159,182,206,.3)') + '" stroke-width="' + (major ? 2.2 : 1) + '" stroke-linecap="round"/>';
      if (major) {
        var tp = polar(cx, cy, R - 23, ang(v));
        ticks += '<text class="num" x="' + tp[0] + '" y="' + tp[1] + '" text-anchor="middle" dominant-baseline="central" ' +
          'font-family="Space Grotesk,sans-serif" font-size="10.5" font-weight="500" fill="rgba(159,182,206,.85)">' + v + '</text>';
      }
    }
    var gp = polar(cx, cy, R + 2, ang(o.goal)), gp2 = polar(cx, cy, R - 13, ang(o.goal));
    var trackLen = Math.PI * (R + 9) * 2 * SWEEP / 360;

    el.innerHTML =
      '<svg viewBox="0 0 220 176" role="img" aria-label="' + esc(o.label) + ': gauge">' +
        '<defs>' +
          '<radialGradient id="f' + gid + '" cx="50%" cy="38%" r="72%">' +
            '<stop offset="0%" stop-color="#12294d"/><stop offset="62%" stop-color="#0A1B36"/><stop offset="100%" stop-color="#060F21"/>' +
          '</radialGradient>' +
          '<linearGradient id="a' + gid + '" x1="0" y1="1" x2="1" y2="0">' +
            '<stop offset="0%" stop-color="#2196C6"/><stop offset="100%" stop-color="#62E1FF"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="97" fill="url(#f' + gid + ')" stroke="rgba(163,196,233,.2)" stroke-width="1"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="97" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="7" stroke-dasharray="1 5"/>' +
        '<path d="' + arcPath(cx, cy, R + 9, A0, A0 + SWEEP) + '" fill="none" stroke="rgba(151,186,227,.12)" stroke-width="6" stroke-linecap="round"/>' +
        '<path class="varc" d="' + arcPath(cx, cy, R + 9, A0, A0 + SWEEP) + '" fill="none" stroke="url(#a' + gid + ')" stroke-width="6" stroke-linecap="round" ' +
          'stroke-dasharray="' + trackLen.toFixed(1) + '" stroke-dashoffset="' + trackLen.toFixed(1) + '" style="filter:drop-shadow(0 0 6px rgba(98,225,255,.55));"/>' +
        '<path d="' + arcPath(cx, cy, R + 9, ang(o.goal), A0 + SWEEP) + '" fill="none" stroke="rgba(227,194,124,.42)" stroke-width="2" stroke-linecap="round"/>' +
        ticks +
        '<line x1="' + gp[0] + '" y1="' + gp[1] + '" x2="' + gp2[0] + '" y2="' + gp2[1] + '" stroke="#E3C27C" stroke-width="3" stroke-linecap="round" style="filter:drop-shadow(0 0 5px rgba(227,194,124,.8));"/>' +
        '<g class="needle" style="transform-origin:' + cx + 'px ' + cy + 'px;transform:rotate(' + A0 + 'deg);' +
            (REDUCED ? '' : 'transition:transform 1.15s cubic-bezier(.3,1.35,.4,1);') + '">' +
          '<polygon points="' + cx + ',' + (cy - R + 4) + ' ' + (cx - 3.4) + ',' + cy + ' ' + (cx + 3.4) + ',' + cy + '" fill="#EAF6FF" style="filter:drop-shadow(0 0 7px rgba(98,225,255,.8));"/>' +
          '<polygon points="' + (cx - 3.4) + ',' + cy + ' ' + (cx + 3.4) + ',' + cy + ' ' + cx + ',' + (cy + 14) + '" fill="rgba(234,246,255,.4)"/>' +
        '</g>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="#081426" stroke="rgba(255,255,255,.35)" stroke-width="1"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="3.2" fill="#62E1FF"/>' +
        '<text class="gval" x="' + cx + '" y="' + (cy + 42) + '" text-anchor="middle" font-family="Space Grotesk,sans-serif" ' +
          'font-weight="700" font-size="' + (o.big ? 30 : 24) + '" fill="#EAF3FB" style="text-shadow:0 0 18px rgba(98,225,255,.35);">0</text>' +
        '<text x="' + cx + '" y="' + (cy + 58) + '" text-anchor="middle" font-family="Space Grotesk,sans-serif" ' +
          'font-size="9" font-weight="500" letter-spacing="2.5" fill="#6E86A6">' + esc(o.unit) + '</text>' +
      '</svg>' +
      '<div class="g-label">' +
        '<span class="g-name">' + esc(o.label) + '</span>' +
        '<span class="g-req">requirement <b>' + o.goal + '</b></span>' +
        '<span class="g-met"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Requirement met</span>' +
      '</div>';

    var needle = el.querySelector('.needle');
    var varc = el.querySelector('.varc');
    var valEl = el.querySelector('.gval');
    var cur = 0;

    function setText(v) {
      valEl.textContent = o.decimals ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString();
    }
    return {
      set: function (v) {
        var clamped = Math.min(Math.max(v, 0), o.max);
        needle.style.transform = 'rotate(' + ang(v) + 'deg)';
        varc.style.transition = REDUCED ? 'none' : 'stroke-dashoffset 1.15s cubic-bezier(.3,1.35,.4,1)';
        varc.style.strokeDashoffset = (trackLen * (1 - clamped / o.max)).toFixed(1);
        el.classList.toggle('met', v >= o.goal);
        if (REDUCED) { setText(v); cur = v; return; }
        var from = cur, t0 = performance.now();
        (function tick(t) {
          var k = Math.min(1, (t - t0) / 950); k = 1 - Math.pow(1 - k, 3);
          setText(from + (v - from) * k);
          if (k < 1) requestAnimationFrame(tick); else cur = v;
        })(t0);
      }
    };
  }

  var G = {
    dental: makeGauge($('g-dental'), { label: 'Dental hours', unit: 'HRS', max: 10, goal: 5, major: 2, minor: 1, decimals: true }),
    total: makeGauge($('g-total'), { label: 'Total hours', unit: 'HRS · GOAL 40', max: 50, goal: 40, major: 10, minor: 2, big: true, decimals: true }),
    nondental: makeGauge($('g-nondental'), { label: 'Non-dental hours', unit: 'HRS', max: 10, goal: 5, major: 2, minor: 1, decimals: true })
  };

  // start-up sweep, like a car cluster saying hello — then settle on real values
  if (!REDUCED) setTimeout(function () {
    G.dental.set(10); G.total.set(50); G.nondental.set(10);
    setTimeout(function () {
      if (DATA) { G.dental.set(DATA.dental); G.total.set(DATA.total); G.nondental.set(DATA.nonDental); }
      else { G.dental.set(0); G.total.set(0); G.nondental.set(0); }
    }, 900);
  }, 350);

  /* ================= Sheet sync ================= */
  var SHEET_ID = '1yXCL-EK5xeVeIATHolpgLdSzQcEDcndSCJL4bbnPFE4';
  var SHEET_GID = '1629504388';
  var CACHE_KEY = 'dds-sheet-cache-v1';
  var DATA = null, cbN = 0, lastFetch = 0;

  function fetchSheet() {
    return new Promise(function (resolve, reject) {
      var cb = '__ddsSheet' + (++cbN), done = false;
      var s = document.createElement('script');
      var t = setTimeout(function () { finish(); reject(new Error('timeout')); }, 12000);
      function finish() { done = true; clearTimeout(t); window[cb] = function () {}; s.remove(); }
      window[cb] = function (resp) { if (!done) { finish(); resolve(resp); } };
      s.onerror = function () { if (!done) { finish(); reject(new Error('network')); } };
      s.src = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?gid=' + SHEET_GID +
        '&tqx=out:json;responseHandler:' + cb + '&nocache=' + Date.now();
      document.head.appendChild(s);
    });
  }

  function parseSheet(resp) {
    var table = resp && resp.table; if (!table) return null;
    var cols = table.cols.map(function (c) { return (c.label || '').trim(); });
    var rows = table.rows.map(function (r) { return (r.c || []).map(function (c) { return c ? c.v : null; }); });
    var find = function (re) { for (var i = 0; i < cols.length; i++) if (re.test(cols[i])) return i; return -1; };
    var idx = {
      first: find(/^first name/i), last: find(/^last name/i), email: find(/^email/i),
      gpa: find(/approved gpa/i), dues: find(/dues paid/i), meets: find(/meets hour/i),
      total: find(/^total hours/i), nond: find(/^total non-dental/i),
      dent: find(/^total dental/i), meetN: find(/^total meetings/i)
    };
    var meetings = [], lastMeetCol = -1;
    cols.forEach(function (l, i) {
      var m = /^meeting\s*#\s*(\d+)\s*(.*)$/i.exec(l);
      if (m) { meetings.push({ i: i, n: +m[1], title: m[2].trim() || ('Meeting ' + m[1]) }); lastMeetCol = i; }
    });

    // member row: email first, then "First (nick) Last" name match
    var email = String(ME.email || '').toLowerCase().trim();
    var norm = function (s) {
      return String(s == null ? '' : s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    };
    var mine = norm(ME.name), mFirst = mine[0] || '', mLast = mine[mine.length - 1] || '';
    var row = null;
    if (idx.email > -1) row = rows.find(function (r) { return String(r[idx.email] || '').toLowerCase().trim() === email; }) || null;
    if (!row && idx.first > -1 && idx.last > -1 && mFirst && mLast) {
      row = rows.find(function (r) {
        return norm(r[idx.last]).join(' ') === mLast && norm(r[idx.first]).indexOf(mFirst) > -1;
      }) || null;
    }

    // service categories = labelled columns after the meetings block
    var dentalEnd = find(/^other dental/i);
    var svc = { dental: [], nondental: [] };
    if (row) cols.forEach(function (l, i) {
      if (!l || i <= lastMeetCol) return;
      var skip = false;
      for (var k in idx) if (idx[k] === i) skip = true;
      if (skip) return;
      var hours = num(row[i]);
      var item = { name: l.replace(/\s*\(.*\)\s*$/, ''), hours: hours };
      if (dentalEnd > -1 && i <= dentalEnd) svc.dental.push(item); else svc.nondental.push(item);
    });

    var dent = row ? num(row[idx.dent]) : 0;
    var nond = row ? num(row[idx.nond]) : 0;
    var meetN = row ? num(row[idx.meetN]) : 0;
    var totCol = row ? num(row[idx.total]) : 0;
    return {
      found: !!row,
      dental: dent, nonDental: nond, meetingsN: meetN,
      total: totCol > 0 ? totCol : dent + nond + meetN,
      gpa: row ? row[idx.gpa] : null, dues: row ? row[idx.dues] : null, meetsReq: row ? row[idx.meets] : null,
      meetings: meetings.map(function (m) { return { n: m.n, title: m.title, went: row ? num(row[m.i]) > 0 : false }; }),
      svc: svc, at: Date.now()
    };
  }

  var yes = function (v) { return /^\s*(y|yes|paid|approved|true|x|✓|met)/i.test(String(v || '')); };
  var no = function (v) { return /^\s*(n|no)\b/i.test(String(v || '')); };

  function setChip(el, state, label) {
    el.classList.remove('is-yes', 'is-no');
    if (state === true) el.classList.add('is-yes');
    if (state === false) el.classList.add('is-no');
    el.innerHTML = '<span class="st"></span>' + esc(label);
  }

  function renderSheet(d) {
    G.total.set(d.total); G.dental.set(d.dental); G.nondental.set(d.nonDental);

    // fuel bar
    var cells = Math.max(d.meetings.length, 12);
    var lit = Math.min(Math.round(d.meetingsN), cells);
    var fc = $('fuel-cells'), html = '';
    for (var i = 0; i < cells; i++) html += '<span class="cell' + (i < lit ? ' lit' : '') + '"></span>';
    // pin sits in the gap right after cell #5 (cells are flex:1 with 4px gaps)
    var gapTotal = (cells - 1) * 4;
    html += '<span class="goal-pin" style="left:calc((100% - ' + gapTotal + 'px) * ' + (5 / cells) + ' + ' + (5 * 4 - 3) + 'px);"></span>';
    if (fc.dataset.sig !== lit + '/' + cells) { fc.dataset.sig = lit + '/' + cells; fc.innerHTML = html; }
    $('fuel-n').textContent = Math.round(d.meetingsN);
    $('fuel-max').textContent = cells;

    // odometer
    var str = (Math.round(d.total * 10) / 10).toFixed(1);
    str = ('00000' + str).slice(-5);
    var seen = false;
    $('odo').innerHTML = str.split('').map(function (ch) {
      if (ch !== '0' && ch !== '.') seen = true;
      if (ch === '.') return '<span class="unit" style="padding:0 1px;">.</span>';
      return '<span class="digit' + (seen || ch !== '0' ? '' : ' dim') + '">' + ch + '</span>';
    }).join('') + '<span class="unit">HRS</span>';

    // standing chips
    setChip($('chip-gpa'), yes(d.gpa) ? true : no(d.gpa) ? false : null,
      yes(d.gpa) ? 'GPA approved' : no(d.gpa) ? 'GPA — see exec' : 'GPA — awaiting review');
    setChip($('chip-dues'), yes(d.dues) ? true : no(d.dues) ? false : null,
      yes(d.dues) ? 'Dues paid' : no(d.dues) ? 'Dues unpaid' : 'Dues — pending');
    var reqMet = yes(d.meetsReq) || (d.total >= 40 && d.meetingsN >= 5 && d.dental >= 5 && d.nonDental >= 5);
    var toGo = Math.max(0, 40 - d.total);
    setChip($('chip-req'), reqMet ? true : null,
      reqMet ? '40-hour requirement met' : '40-hour requirement — ' + (Math.round(toGo * 10) / 10) + ' to go');

    renderMeetings(d);
    renderService(d);

    if (!d.found && !$('nf-note')) {
      var n = document.createElement('p');
      n.id = 'nf-note';
      n.style.cssText = 'margin:14px 0 0;color:#9FB6CE;font-size:12.5px;line-height:1.6;max-width:60ch;';
      n.innerHTML = 'You&rsquo;re not on the chapter sheet yet — hours appear once the exec board adds <b style="color:#E3C27C;">' + esc(ME.name) + '</b> (' + esc(ME.email) + ') to it.';
      $('standing').after(n);
    } else if (d.found && $('nf-note')) $('nf-note').remove();
  }

  function setSync(state, msg) {
    var c = $('chip-sync');
    c.classList.toggle('live', state === 'live');
    c.style.color = state === 'err' ? 'var(--red-hi)' : '';
    $('sync-text').textContent = msg;
  }

  function sync(manual) {
    setSync('busy', manual ? 'Syncing…' : 'Connecting…');
    return fetchSheet().then(function (resp) {
      var d = parseSheet(resp);
      if (!d) throw new Error('bad payload');
      DATA = d; lastFetch = Date.now();
      try { writeLS(CACHE_KEY, d); } catch (e) {}
      renderSheet(d);
      setSync('live', 'Live · synced ' + fmtTime(Date.now()));
    }).catch(function () {
      setSync('err', DATA ? 'Offline · showing last sync' : 'Sheet unreachable — retrying');
    });
  }

  var cached = readLS(CACHE_KEY, null);
  if (cached && cached.meetings) { DATA = cached; renderSheet(cached); setSync('busy', 'Connecting…'); }
  setTimeout(function () { sync(false); }, REDUCED ? 0 : 1400); // let the start-up sweep play
  setInterval(function () { if (document.visibilityState === 'visible') sync(false); }, 60000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > 55000) sync(false);
  });
  $('chip-sync').addEventListener('click', function () { sync(true); });

  /* ================= Meetings & notes ================= */
  var NOTES_KEY = 'dds-notes-v1';
  var noteTimers = {};

  function myNotes() { var all = readLS(NOTES_KEY, {}); return all[ME.id] || {}; }
  function saveNote(key, text) {
    var all = readLS(NOTES_KEY, {});
    if (!all[ME.id]) all[ME.id] = {};
    if (text.trim()) all[ME.id][key] = { t: text, at: Date.now() };
    else delete all[ME.id][key];
    writeLS(NOTES_KEY, all);
    refreshOthers(); // keeps each row's shared-note count honest
  }

  /* Notes the rest of the cohort has written for the same meeting */
  function othersNotesHtml(key) {
    var all = readLS(NOTES_KEY, {});
    var names = {};
    (DDSAuth.members ? DDSAuth.members() : []).forEach(function (m) { names[m.id] = m.name; });
    var items = [];
    Object.keys(all).forEach(function (mid) {
      if (mid === ME.id) return;
      var n = all[mid] && all[mid][key];
      if (n && String(n.t || '').trim()) items.push({ by: names[mid] || 'A member', t: n.t, at: n.at || 0 });
    });
    items.sort(function (a, b) { return b.at - a.at; });
    var head = '<div class="mo-head">Notes from the chapter · <b>' + items.length + '</b></div>';
    if (!items.length) return head + '<div class="mo-empty">No one else has shared a note for this meeting yet.</div>';
    return head + items.map(function (n) {
      return '<div class="mo-item"><div class="mo-top"><span class="mo-by">' + esc(n.by) + '</span>' +
        (n.at ? '<span class="mo-date">' + fmtDate(n.at) + '</span>' : '') + '</div>' +
        '<p>' + esc(n.t) + '</p></div>';
    }).join('');
  }
  function refreshOthers() {
    document.querySelectorAll('.m-others').forEach(function (el) {
      el.innerHTML = othersNotesHtml(el.getAttribute('data-others'));
    });
  }

  function renderMeetings(d) {
    var list = $('m-list');
    var sig = JSON.stringify(d.meetings);
    if (list.dataset.sig === sig) return; // don't clobber open note editors on poll
    list.dataset.sig = sig;
    var notes = myNotes();
    if (!d.meetings.length) {
      list.innerHTML = '<p class="svc-empty">No meetings on the sheet yet — they land here as the exec board logs them.</p>';
      return;
    }
    list.innerHTML = d.meetings.map(function (m) {
      var key = 'm' + m.n, note = notes[key];
      return '<div class="m-row' + (m.went ? ' went' : '') + '" data-key="' + key + '">' +
        '<div class="m-line">' +
          '<span class="m-idx">M' + m.n + '</span>' +
          '<span class="m-dot" title="' + (m.went ? 'Attended' : 'Not attended') + '"></span>' +
          '<span class="m-title">' + esc(m.title) + '</span>' +
          '<span class="m-went">Attended</span>' +
          '<button class="m-notebtn' + (note ? ' has' : '') + '" type="button">' + (note ? 'Note ·' : 'Note') + '</button>' +
        '</div>' +
        '<div class="m-note">' +
          '<textarea maxlength="1200" placeholder="What stuck with you from this one?">' + esc(note ? note.t : '') + '</textarea>' +
          '<span class="save-state"></span>' +
          '<div class="m-others" data-others="' + key + '">' + othersNotesHtml(key) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  $('m-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.m-notebtn'); if (!btn) return;
    var row = btn.closest('.m-row');
    row.classList.toggle('open');
    if (row.classList.contains('open')) row.querySelector('textarea').focus();
  });
  $('m-list').addEventListener('input', function (e) {
    if (e.target.tagName !== 'TEXTAREA') return;
    var row = e.target.closest('.m-row'), key = row.getAttribute('data-key');
    var state = row.querySelector('.save-state'), btn = row.querySelector('.m-notebtn');
    state.textContent = 'Saving…'; state.classList.remove('saved');
    clearTimeout(noteTimers[key]);
    noteTimers[key] = setTimeout(function () {
      saveNote(key, e.target.value);
      state.textContent = 'Saved'; state.classList.add('saved');
      var has = !!e.target.value.trim();
      btn.classList.toggle('has', has);
      btn.textContent = has ? 'Note ·' : 'Note';
    }, 550);
  });

  /* ================= Service breakdown ================= */
  function renderService(d) {
    var panel = $('svc-panel');
    var sig = JSON.stringify([d.svc, d.dental, d.nonDental]);
    if (panel.dataset.sig === sig) return;
    panel.dataset.sig = sig;
    if (!d.found) {
      panel.innerHTML = '<p class="svc-empty">Your service log fills in once you&rsquo;re on the chapter sheet.</p>';
      return;
    }
    var max = 0;
    d.svc.dental.concat(d.svc.nondental).forEach(function (c) { max = Math.max(max, c.hours); });
    var group = function (title, items, total) {
      var live = items.filter(function (c) { return c.hours > 0; });
      var rows = live.map(function (c) {
        return '<div class="svc-row"><span class="svc-name">' + esc(c.name) + '</span>' +
          '<span class="svc-val">' + (Math.round(c.hours * 10) / 10) + ' hr' + (c.hours === 1 ? '' : 's') + '</span>' +
          '<span class="svc-bar"><i style="width:' + (max ? Math.max(6, c.hours / max * 100) : 0) + '%;"></i></span></div>';
      }).join('');
      var rest = items.length - live.length;
      return '<div class="svc-group"><div class="svc-ghead"><h3>' + title + '</h3>' +
        '<span class="svc-total">' + (Math.round(total * 10) / 10) + ' hrs</span></div>' +
        (rows || '<p class="svc-empty" style="padding:2px 0 6px;">Nothing logged here yet.</p>') +
        (rows && rest > 0 ? '<p class="svc-empty" style="padding:4px 0 0;font-size:12px;">+ ' + rest + ' more categories waiting for their first hour.</p>' : '') +
        '</div>';
    };
    panel.innerHTML =
      group('Dental', d.svc.dental, d.dental) +
      group('Non-dental', d.svc.nondental, d.nonDental) +
      '<p class="svc-empty" style="border-top:1px solid rgba(163,196,233,.11);padding-top:14px;font-size:12.5px;">Logged something that isn&rsquo;t here? Nudge the service chair — this reads straight off their sheet.</p>';
  }

  /* ================= Classes & professors ================= */
  var CLS_KEY = 'dds-classes-v1';

  function molar(size, on) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.2c-1.7 0-2.4-.9-4.1-.9-3 0-4.6 2.5-4.6 5.3 0 2.5 1.1 4 1.7 6.2.6 2.3.8 6.9 2.7 6.9 1.7 0 1.4-4.6 3.1-4.6s1.4 4.6 3.1 4.6c1.9 0 2.1-4.6 2.7-6.9.6-2.2 1.7-3.7 1.7-6.2 0-2.8-1.6-5.3-4.6-5.3-1.7 0-2.4.9-4.1.9Z" ' +
      'fill="' + (on ? '#7FB2E0' : 'rgba(127,178,224,.16)') + '"' +
      (on ? ' style="filter:drop-shadow(0 0 4px rgba(127,178,224,.5));"' : '') + '/></svg>';
  }

  /* Entries carry kind:'class' (course overall, prof:null) or kind:'prof'
     (a specific professor teaching that course). Older stores predate kind
     and get migrated to 'prof' on first read. */
  function clsAll() {
    var list = readLS(CLS_KEY, null);
    if (list) {
      var migrated = false;
      list.forEach(function (e) { if (!e.kind) { e.kind = e.prof ? 'prof' : 'class'; migrated = true; } });
      if (migrated) writeLS(CLS_KEY, list);
      return list;
    }
    var mk = function (kind, code, prof, rating, take, by, days) {
      return { id: uid(), kind: kind, code: code, prof: prof, rating: rating, take: take, by: by, byId: 'seed-' + by.replace(/\W/g, ''), at: Date.now() - days * 864e5 };
    };
    list = [
      mk('prof', 'BIOL 252', 'Dr. Griffith', 5, 'Hard, but the anatomy unit carries straight into the DAT. Go to office hours early.', 'Jordan Reyes', 64),
      mk('prof', 'BIOL 252', 'Dr. Griffith', 4, 'Heavy memorization — draw everything twice and you’re fine.', 'Sofia Marin', 51),
      mk('prof', 'BIOL 252', 'Dr. Hogan', 3, 'Knows the material cold, but the lectures move fast — record them.', 'Maya Feldman', 44),
      mk('prof', 'CHEM 261', 'Dr. Austell', 4, 'Mechanisms over memorizing. His practice sets are basically the exam.', 'Chris Okafor', 47),
      mk('prof', 'BIOL 205', 'Dr. Ramesh', 3, 'Fair grader, dry lectures. The reading quizzes sneak up on you.', 'Maya Feldman', 30),
      mk('prof', 'PSYC 210', 'Dr. Payne', 5, 'Statistics you’ll actually reuse on research apps. Take it before junior year.', 'Nia Thompson', 22),
      mk('class', 'BIOL 252', null, 4, 'The single most useful course before the DAT, whoever you get.', 'Jordan Reyes', 60),
      mk('class', 'BIOL 252', null, 5, 'Brutal weeks 4–8, then everything clicks. Worth it.', 'Nia Thompson', 35),
      mk('class', 'CHEM 261', null, 4, 'Orgo is a rite of passage — this version of it is a fair one.', 'Chris Okafor', 41)
    ];
    writeLS(CLS_KEY, list);
    return list;
  }

  function molarRow(size, avg) {
    var full = Math.round(avg), t = '';
    for (var i = 1; i <= 5; i++) t += molar(size, i <= full);
    return t;
  }
  function takesHtml(entries) {
    return entries.slice().sort(function (x, y) { return y.at - x.at; }).map(function (e) {
      return '<div class="take"><div class="take-head"><span class="molars">' + molarRow(11, e.rating) + '</span>' +
        '<span class="take-by">' + esc(e.by) + (e.byId === ME.id ? ' (you)' : '') + '</span>' +
        '<span class="take-date">' + fmtDate(e.at) + '</span></div>' +
        (e.take ? '<p>&ldquo;' + esc(e.take) + '&rdquo;</p>' : '') + '</div>';
    }).join('');
  }
  var avgOf = function (entries) { return entries.reduce(function (s, e) { return s + e.rating; }, 0) / entries.length; };

  function renderClasses() {
    var q = $('cls-q').value.toLowerCase().trim();
    var byCode = {};
    clsAll().forEach(function (e) {
      var code = e.code.toUpperCase();
      var g = byCode[code] = byCode[code] || { code: code, cls: [], profs: {} };
      if (e.kind === 'class' || !e.prof) g.cls.push(e);
      else {
        var pk = e.prof.toLowerCase();
        (g.profs[pk] = g.profs[pk] || { name: e.prof, entries: [] }).entries.push(e);
      }
    });
    var cards = Object.keys(byCode).map(function (k) {
      var g = byCode[k];
      g.profList = Object.keys(g.profs).map(function (pk) { return g.profs[pk]; });
      g.total = g.cls.length + g.profList.reduce(function (s, p) { return s + p.entries.length; }, 0);
      return g;
    }).filter(function (g) {
      if (!q) return true;
      var hay = g.code + ' ' + g.profList.map(function (p) { return p.name; }).join(' ');
      return hay.toLowerCase().indexOf(q) > -1;
    });
    cards.sort(function (a, b) { return b.total - a.total || a.code.localeCompare(b.code); });

    $('cls-grid').innerHTML = cards.length ? cards.map(function (g) {
      var myCls = g.cls.find(function (e) { return e.byId === ME.id; });
      var overall = g.cls.length
        ? '<div class="cls-rate"><span class="molars">' + molarRow(17, avgOf(g.cls)) + '</span>' +
          '<span class="cls-avg">' + (Math.round(avgOf(g.cls) * 10) / 10) + '</span>' +
          '<span class="cls-n">' + g.cls.length + ' overall rating' + (g.cls.length > 1 ? 's' : '') + '</span></div>'
        : '<div class="cls-rate"><span class="cls-n">No overall rating yet</span></div>';
      var tags = g.profList.length
        ? '<div class="cls-tags">' + g.profList.map(function (p) {
            return '<button class="ctag" type="button" title="See takes on ' + esc(p.name) + '"><b>' + esc(p.name) + '</b>' +
              '<span class="molars">' + molarRow(11, avgOf(p.entries)) + '</span>' +
              '<span class="cn">' + (Math.round(avgOf(p.entries) * 10) / 10) + ' · ' + p.entries.length + '</span></button>';
          }).join('') + '</div>'
        : '<div class="cls-tags"><span class="cls-n" style="padding:4px 0;">No professors rated yet</span></div>';
      var takes =
        '<div class="cls-sub"><h4>Course overall</h4><span class="spacer"></span>' +
          '<button class="cls-btn" type="button" data-rc="' + esc(g.code) + '">' + (myCls ? '&#9998; Edit your rating' : 'Rate the class') + '</button></div>' +
        (g.cls.length ? takesHtml(g.cls) : '<p class="take" style="color:var(--ink3);font-family:Lora,serif;font-style:italic;font-size:13px;margin:0;">Nobody has rated the course overall yet.</p>') +
        g.profList.map(function (p) {
          var myP = p.entries.find(function (e) { return e.byId === ME.id; });
          return '<div class="cls-sub"><h4>with <b>' + esc(p.name) + '</b></h4><span class="spacer"></span>' +
            '<button class="cls-btn" type="button" data-rp="' + esc(g.code) + '::' + esc(p.name) + '">' + (myP ? '&#9998; Edit your rating' : 'Rate this professor') + '</button></div>' +
            takesHtml(p.entries);
        }).join('') +
        '<div class="cls-sub" style="margin-top:15px;"><button class="cls-btn ghost" type="button" data-rp="' + esc(g.code) + '::">+ Rate another professor for ' + esc(g.code) + '</button></div>';
      return '<div class="glass cls-card" role="button" tabindex="0" aria-expanded="false">' +
        '<div class="cls-top"><div class="cls-code">' + esc(g.code) + '</div>' +
        '<button class="cls-btn" type="button" data-rc="' + esc(g.code) + '">' + (myCls ? '&#9998; Edit' : 'Rate') + '</button></div>' +
        overall + tags +
        '<div class="cls-takes">' + takes + '</div>' +
      '</div>';
    }).join('') : '<div class="cls-empty">' + (q ? 'Nothing matches &ldquo;' + esc(q) + '&rdquo; yet — rate it and start the record.' : 'No ratings yet — be the first to weigh in.') + '</div>';
  }

  $('cls-grid').addEventListener('click', function (e) {
    var rc = e.target.closest('[data-rc]');
    if (rc) { openClsModal(rc.getAttribute('data-rc')); return; }
    var rp = e.target.closest('[data-rp]');
    if (rp) {
      var parts = rp.getAttribute('data-rp').split('::');
      openProfModal(parts[0], parts.slice(1).join('::'));
      return;
    }
    var card = e.target.closest('.cls-card');
    if (card) { card.classList.toggle('open'); card.setAttribute('aria-expanded', card.classList.contains('open')); }
  });
  $('cls-grid').addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cls-card')) {
      e.preventDefault(); e.target.classList.toggle('open');
    }
  });
  $('cls-q').addEventListener('input', renderClasses);

  /* --- the two rating windows: course overall + specific professor --- */
  var cfRating = 0, prRating = 0;
  function renderPick(el, rating) {
    el.innerHTML = [1, 2, 3, 4, 5].map(function (i) {
      return '<button type="button" data-r="' + i + '" aria-label="' + i + ' of 5 molars">' + molar(30, i <= rating) + '</button>';
    }).join('');
  }
  $('cf-molars').addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return;
    cfRating = +b.getAttribute('data-r'); renderPick($('cf-molars'), cfRating);
  });
  $('pr-molars').addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return;
    prRating = +b.getAttribute('data-r'); renderPick($('pr-molars'), prRating);
  });

  function openClsModal(code) {
    var mine = code ? clsAll().find(function (e) {
      return e.kind === 'class' && e.byId === ME.id && e.code.toUpperCase() === code.toUpperCase();
    }) : null;
    cfRating = mine ? mine.rating : 0;
    renderPick($('cf-molars'), cfRating);
    $('cf-title').textContent = mine ? 'Edit your class rating' : 'Rate a class';
    $('cf-code').value = code || '';
    $('cf-take').value = mine ? (mine.take || '') : '';
    $('cf-err').textContent = '';
    $('cls-modal').hidden = false;
    (code ? $('cf-take') : $('cf-code')).focus();
  }
  function openProfModal(code, prof) {
    var mine = (code && prof) ? clsAll().find(function (e) {
      return e.kind === 'prof' && e.byId === ME.id && e.code.toUpperCase() === code.toUpperCase() &&
        String(e.prof || '').toLowerCase() === prof.toLowerCase();
    }) : null;
    prRating = mine ? mine.rating : 0;
    renderPick($('pr-molars'), prRating);
    $('pr-title').textContent = mine ? 'Edit your professor rating' : 'Rate a professor';
    $('pr-code').value = code || '';
    $('pr-prof').value = prof || '';
    $('pr-take').value = mine ? (mine.take || '') : '';
    $('pr-err').textContent = '';
    $('prof-modal').hidden = false;
    (prof ? $('pr-take') : code ? $('pr-prof') : $('pr-code')).focus();
  }
  $('cls-add').addEventListener('click', function () { openClsModal(''); });
  $('prof-add').addEventListener('click', function () { openProfModal('', ''); });

  $('cf-save').addEventListener('click', function () {
    var code = $('cf-code').value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!code) return $('cf-err').textContent = 'Add the course code.';
    if (!cfRating) return $('cf-err').textContent = 'Pick a molar rating.';
    var list = clsAll();
    var mineIdx = list.findIndex(function (e) {
      return e.kind === 'class' && e.byId === ME.id && e.code.toUpperCase() === code;
    });
    var entry = { id: mineIdx > -1 ? list[mineIdx].id : uid(), kind: 'class', code: code, prof: null, rating: cfRating, take: $('cf-take').value.trim(), by: ME.name, byId: ME.id, at: Date.now() };
    if (mineIdx > -1) list[mineIdx] = entry; else list.push(entry);
    writeLS(CLS_KEY, list);
    $('cls-modal').hidden = true;
    renderClasses();
  });
  $('pr-save').addEventListener('click', function () {
    var code = $('pr-code').value.trim().toUpperCase().replace(/\s+/g, ' ');
    var prof = $('pr-prof').value.trim();
    if (!code) return $('pr-err').textContent = 'Add the course code.';
    if (!prof) return $('pr-err').textContent = 'Who taught it?';
    if (!prRating) return $('pr-err').textContent = 'Pick a molar rating.';
    var list = clsAll();
    var mineIdx = list.findIndex(function (e) {
      return e.kind === 'prof' && e.byId === ME.id && e.code.toUpperCase() === code &&
        String(e.prof || '').toLowerCase() === prof.toLowerCase();
    });
    var entry = { id: mineIdx > -1 ? list[mineIdx].id : uid(), kind: 'prof', code: code, prof: prof, rating: prRating, take: $('pr-take').value.trim(), by: ME.name, byId: ME.id, at: Date.now() };
    if (mineIdx > -1) list[mineIdx] = entry; else list.push(entry);
    writeLS(CLS_KEY, list);
    $('prof-modal').hidden = true;
    renderClasses();
  });

  /* ================= Chapter chat ================= */
  var CHAT_KEY = 'dds-chat-v1';
  function chatAll() {
    var list = readLS(CHAT_KEY, null);
    if (!list) {
      list = [{ id: 'seed-hello', by: 'Exec Board', byId: 'exec', at: Date.now() - 3 * 864e5,
        text: 'Welcome to the chapter chat — the whole cohort sees this room. Meeting questions, ride shares, DAT wins: all fair game.' }];
      writeLS(CHAT_KEY, list);
    }
    return list;
  }
  function dayLabel(t) {
    var d = new Date(t), now = new Date();
    var day = function (x) { return x.toDateString(); };
    if (day(d) === day(now)) return 'Today';
    if (day(d) === day(new Date(now - 864e5))) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function renderChat(stick) {
    var log = $('chat-log');
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    var lastDay = '';
    var profCache = {};
    var getProf = function (id) {
      if (!(id in profCache)) profCache[id] = DDSAuth.profile ? DDSAuth.profile(id) : null;
      return profCache[id];
    };
    log.innerHTML = chatAll().map(function (m) {
      var mine = m.byId === ME.id;
      var head = '';
      var dl = dayLabel(m.at);
      if (dl !== lastDay) { lastDay = dl; head = '<span class="chat-day">' + dl + '</span>'; }
      var p = getProf(m.byId);
      var mid = p ? ' data-mid="' + esc(m.byId) + '" role="button" tabindex="0"' : '';
      var avatar = mine ? '' :
        '<span class="msg-av"' + mid + (p ? ' title="' + esc(m.by) + '"' : '') + '>' +
          (p && p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc(String(m.by || '?').trim().charAt(0).toUpperCase())) +
        '</span>';
      var body = (m.img ? '<img class="chat-img" src="' + esc(m.img) + '" alt="Photo from ' + esc(m.by) + '" loading="lazy">' : '') +
        (m.text ? '<span class="chat-txt">' + esc(m.text) + '</span>' : '');
      return head + '<div class="msg' + (mine ? ' mine' : '') + '">' + avatar +
        '<div class="msg-body">' +
        '<div class="msg-head"><span class="msg-by"' + (mine ? '' : mid) + '>' + esc(mine ? 'You' : m.by) + '</span>' +
        '<span class="msg-time">' + fmtTime(m.at) + '</span></div>' +
        '<div class="bubble">' + body +
        (mine ? '<button class="msg-del" type="button" data-del="' + esc(m.id) + '" aria-label="Delete message">&#10005;</button>' : '') +
        '</div></div></div>';
    }).join('');
    var settle = function () { if (stick || nearBottom) log.scrollTop = log.scrollHeight; };
    settle();
    // photos load async and grow the log — re-stick as each one arrives
    log.querySelectorAll('img').forEach(function (img) {
      if (!img.complete) img.addEventListener('load', settle, { once: true });
    });
  }

  /* --- attach a photo --- */
  var chatImg = null;
  function chatPhotoProcess(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maxW = 900, s = Math.min(1, maxW / img.width);
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.74));
        };
        img.onerror = reject; img.src = r.result;
      };
      r.onerror = reject; r.readAsDataURL(file);
    });
  }
  function setPending(url, msg, isErr) {
    chatImg = url;
    var pend = $('chat-pend');
    pend.classList.toggle('show', !!(url || msg));
    $('chat-pend-img').src = url || '';
    $('chat-pend-img').style.display = url ? '' : 'none';
    $('chat-pend-txt').textContent = msg || 'Photo attached — add a caption or just hit send.';
    $('chat-pend-txt').classList.toggle('chat-err', !!isErr);
  }
  $('chat-attach').addEventListener('click', function () { $('chat-file').click(); });
  $('chat-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    chatPhotoProcess(f).then(function (u) { setPending(u, null, false); $('chat-input').focus(); })
      .catch(function () { setPending(null, 'That image didn’t load — try another file.', true); });
  });
  $('chat-pend-x').addEventListener('click', function () { setPending(null, null, false); });

  function sendChat() {
    var ta = $('chat-input'), text = ta.value.trim();
    if (!text && !chatImg) return;
    var list = chatAll();
    var msg = { id: uid(), by: ME.name, byId: ME.id, text: text.slice(0, 1000), at: Date.now() };
    if (chatImg) msg.img = chatImg;
    list.push(msg);
    if (list.length > 500) list = list.slice(-500);
    try { writeLS(CHAT_KEY, list); }
    catch (e) { setPending(chatImg, 'This browser’s storage is full — the photo won’t fit. Clear old uploads or send text only.', true); return; }
    ta.value = ''; ta.style.height = '44px';
    setPending(null, null, false);
    renderChat(true);
  }
  $('chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $('chat-input').addEventListener('input', function () {
    this.style.height = '44px';
    this.style.height = Math.min(120, this.scrollHeight) + 'px';
  });
  $('chat-log').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (b) {
      writeLS(CHAT_KEY, chatAll().filter(function (m) { return m.id !== b.getAttribute('data-del'); }));
      renderChat(false);
      return;
    }
    var img = e.target.closest('.chat-img');
    if (img) { $('imgview-img').src = img.src; $('imgview').hidden = false; }
  });
  $('imgview').addEventListener('click', function () { $('imgview').hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('imgview').hidden) $('imgview').hidden = true;
  });
  renderChat(true);

  /* --- member profile popover: hover or click a name/avatar in chat --- */
  var popPinned = false, popHideT = null, popFor = null;
  function socialChips(p) {
    var out = '';
    if (p.instagram) {
      var m = /instagram\.com\/([^\/?#]+)/i.exec(p.instagram);
      out += '<a class="ppop-soc" href="' + esc(p.instagram) + '" target="_blank" rel="noopener">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"/></svg>' +
        esc(m ? '@' + m[1] : 'Instagram') + '</a>';
    }
    if (p.linkedin) {
      out += '<a class="ppop-soc li" href="' + esc(p.linkedin) + '" target="_blank" rel="noopener">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5ZM.2 8.2h4.6V23H.2V8.2Zm7.6 0h4.4v2h.06c.61-1.16 2.11-2.38 4.34-2.38 4.64 0 5.5 3.05 5.5 7.02V23h-4.6v-7.3c0-1.74-.03-3.98-2.42-3.98-2.43 0-2.8 1.9-2.8 3.86V23H7.8V8.2Z"/></svg>' +
        'LinkedIn</a>';
    }
    return out ? '<div class="ppop-socials">' + out + '</div>' : '';
  }
  function showPop(mid, anchor) {
    var p = DDSAuth.profile ? DDSAuth.profile(mid) : null;
    if (!p) return;
    popFor = mid;
    var pop = $('ppop');
    var bio = [p.interests, p.hobbies].filter(Boolean).join(' · ');
    pop.innerHTML =
      '<div class="ppop-head">' +
        '<span class="ppop-av">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc(p.name.trim().charAt(0).toUpperCase())) + '</span>' +
        '<div><h5 class="ppop-name">' + esc(p.name) + '</h5>' +
        '<p class="ppop-meta">' + esc(['Class of ' + (p.gradYear || '—'), p.major].filter(Boolean).join(' · ')) + '</p></div>' +
      '</div>' +
      (bio ? '<p class="ppop-bio">' + esc(bio) + '</p>' : '') +
      socialChips(p);
    pop.classList.add('show');
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    var top = r.top - h - 10;
    if (top < 64) top = Math.min(r.bottom + 10, window.innerHeight - h - 12);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function hidePop(force) {
    if (popPinned && !force) return;
    popPinned = false; popFor = null;
    $('ppop').classList.remove('show');
  }
  $('chat-log').addEventListener('mouseover', function (e) {
    var t = e.target.closest('[data-mid]'); if (!t) return;
    clearTimeout(popHideT);
    if (!popPinned || popFor === t.getAttribute('data-mid')) showPop(t.getAttribute('data-mid'), t);
  });
  $('chat-log').addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-mid]')) popHideT = setTimeout(function () { hidePop(false); }, 260);
  });
  $('ppop').addEventListener('mouseenter', function () { clearTimeout(popHideT); });
  $('ppop').addEventListener('mouseleave', function () { popHideT = setTimeout(function () { hidePop(false); }, 220); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-mid]');
    if (t) { popPinned = true; showPop(t.getAttribute('data-mid'), t); return; }
    if (!e.target.closest('#ppop')) hidePop(true);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hidePop(true);
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-mid]')) {
      e.preventDefault(); popPinned = true; showPop(e.target.getAttribute('data-mid'), e.target);
    }
  });

  /* ================= Big / Little family ================= */
  var famList = [], famIdx = 0, famPaths = [];

  function famPdfHref(m) {
    if (!m || !m.pdf) return null;
    if (m.pdf.slice(0, 5) !== 'data:') return m.pdf;
    if (!m._blobUrl) {
      try {
        var byteStr = atob(m.pdf.split(',')[1]);
        var bytes = new Uint8Array(byteStr.length);
        for (var i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
        m._blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      } catch (e) { return null; }
    }
    return m._blobUrl;
  }

  function famNode(m, isBig) {
    var href = famPdfHref(m);
    return '<div class="fam-node' + (isBig ? ' is-big' : '') + '">' +
      '<div class="fn-photo"><img src="' + m.photo + '" alt="' + esc(m.name) + '" onerror="this.style.opacity=0"></div>' +
      '<span class="fn-role">' + (isBig ? 'Big' : 'Little') + '</span>' +
      '<span class="fn-name">' + esc(m.name) + '</span>' +
      '<span class="fn-year">Class of ' + esc(m.year) + '</span>' +
      '<span class="fn-links">' +
        (href ? '<a class="fn-doc" href="' + href + '" target="_blank" rel="noopener">About&nbsp;&#8599;</a>' : '') +
        (m.editId ? '<button class="fn-edit" type="button" data-fedit="' + esc(m.editId) + '">&#9998; Edit</button>' : '') +
      '</span>' +
    '</div>';
  }

  function drawFamLinks() {
    var svg = $('fam-svg'), stage = svg.parentElement;
    famPaths.forEach(function (p) { p.remove(); }); famPaths = [];
    var bigNode = $('fam-big').querySelector('.fn-photo'); if (!bigNode) return;
    var sr = stage.getBoundingClientRect(); if (!sr.width) return;
    svg.setAttribute('viewBox', '0 0 ' + Math.round(sr.width) + ' ' + Math.round(sr.height));
    var br = bigNode.getBoundingClientRect();
    var sx = br.left + br.width / 2 - sr.left, sy = br.bottom - sr.top;
    $('fam-littles').querySelectorAll('.fn-photo').forEach(function (ln, i) {
      var lr = ln.getBoundingClientRect();
      var ex = lr.left + lr.width / 2 - sr.left, ey = lr.top - sr.top, dy = ey - sy;
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + (sy + dy * 0.55) + ', ' + ex + ' ' + (ey - dy * 0.55) + ', ' + ex + ' ' + ey);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'url(#fam-grad)');
      p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round');
      $('fam-svg').appendChild(p); famPaths.push(p);
      if (!REDUCED && p.getTotalLength && p.animate) {
        var len = p.getTotalLength();
        if (len) { p.style.strokeDasharray = len; p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, delay: i * 80, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'both' }); }
      }
    });
  }

  function renderFamily(keepName) {
    famList = DDSFamily.build();
    if (keepName) {
      var k = famList.findIndex(function (f) { return f.name === keepName; });
      if (k > -1) famIdx = k;
    }
    if (famIdx >= famList.length) famIdx = 0;
    $('fam-chips').innerHTML = famList.map(function (f, i) {
      return '<button class="fam-chip' + (i === famIdx ? ' on' : '') + '" type="button" data-fam="' + i + '">' +
        '<b>' + esc(f.name) + '</b><span>Big · ' + esc(f.big.name) + ' · ' +
        (f.littles.length ? f.littles.length + ' little' + (f.littles.length > 1 ? 's' : '') : 'recruiting') + '</span></button>';
    }).join('');
    var fam = famList[famIdx]; if (!fam) return;
    $('fam-big').innerHTML = famNode(fam.big, true);
    $('fam-littles').innerHTML = fam.littles.length
      ? fam.littles.map(function (l) { return famNode(l, false); }).join('')
      : '<div style="align-self:center;color:#6E86A6;font-family:Lora,serif;font-style:italic;font-size:14px;padding:20px 14px;border:2px dashed rgba(227,194,124,.25);border-radius:16px;">No littles yet — this line is recruiting.</div>';
    $('fam-note').innerHTML = '<b style="color:var(--gold-hi);font-style:normal;font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Est. ' + esc(fam.founded) + ' · ' + esc(fam.tag) + '</b><br>' + esc(fam.note);
    requestAnimationFrame(function () { requestAnimationFrame(drawFamLinks); });
  }

  document.querySelector('#family').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-fam]');
    if (chip) { famIdx = +chip.getAttribute('data-fam'); renderFamily(); return; }
    var edit = e.target.closest('[data-fedit]');
    if (edit) openFamModal({ mode: 'edit', id: edit.getAttribute('data-fedit') });
  });
  window.addEventListener('resize', function () { requestAnimationFrame(drawFamLinks); }, { passive: true });

  /* --- join/edit modal --- */
  var fmState = { mode: 'add', role: 'little', id: null, photo: null, pdf: null };

  function famPhotoProcess(file) { // 4:5 center-crop, small enough for localStorage
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          var W = 480, H = 600, c = document.createElement('canvas');
          c.width = W; c.height = H;
          var s = Math.max(W / img.width, H / img.height);
          var w = img.width * s, h = img.height * s;
          c.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
          resolve(c.toDataURL('image/jpeg', 0.84));
        };
        img.onerror = reject; img.src = r.result;
      };
      r.onerror = reject; r.readAsDataURL(file);
    });
  }

  function setFmRole(role) {
    fmState.role = role;
    $('fm-seg').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-role') === role); });
    $('fm-fam-wrap').hidden = role === 'big';
    $('fm-newfam-wrap').hidden = role !== 'big';
  }

  function openFamModal(opts) {
    fmState = { mode: opts.mode, role: 'little', id: opts.id || null, photo: null, pdf: null };
    $('fm-err').textContent = ''; $('fm-photo').value = ''; $('fm-link').value = ''; $('fm-pdf').value = '';
    $('fm-fam').innerHTML = famList.map(function (f) { return '<option value="' + esc(f.name) + '">' + esc(f.name) + ' — ' + esc(f.big.name) + '</option>'; }).join('');
    if (opts.mode === 'edit') {
      var entry = DDSFamily.load().find(function (e) { return e.id === opts.id; });
      if (!entry) return;
      $('fm-title').textContent = 'Edit your card';
      $('fm-sub').textContent = 'Changes land on the homepage tree the moment you save.';
      $('fm-name').value = entry.name; $('fm-year').value = entry.year || '';
      $('fm-link').value = (entry.link && entry.link.slice(0, 5) !== 'data:') ? entry.link : '';
      setFmRole(entry.role);
      if (entry.role === 'little') $('fm-fam').value = entry.family;
      else { $('fm-newfam').value = entry.family; }
      $('fm-seg').style.display = 'none';
      $('fm-remove').hidden = false;
    } else {
      $('fm-title').textContent = 'Join the tree';
      $('fm-sub').textContent = 'Add yourself as a big or a little — it shows on the homepage instantly.';
      $('fm-name').value = ME.name; $('fm-year').value = ''; $('fm-newfam').value = '';
      var mineFam = famList[famIdx]; if (mineFam) $('fm-fam').value = mineFam.name;
      setFmRole('little');
      $('fm-seg').style.display = '';
      $('fm-remove').hidden = true;
    }
    $('fam-modal').hidden = false;
    $('fm-name').focus();
  }

  $('fam-join').addEventListener('click', function () { openFamModal({ mode: 'add' }); });
  $('fm-seg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-role]'); if (b) setFmRole(b.getAttribute('data-role'));
  });
  $('fm-photo').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    famPhotoProcess(f).then(function (u) { fmState.photo = u; }).catch(function () { $('fm-err').textContent = 'That image didn’t load — try another.'; });
  });
  $('fm-pdf').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) { fmState.pdf = null; return; }
    if (f.size > 2 * 1024 * 1024) { this.value = ''; fmState.pdf = null; $('fm-err').textContent = 'That PDF is over 2 MB — trim it down first.'; return; }
    var r = new FileReader();
    r.onload = function () { fmState.pdf = r.result; $('fm-err').textContent = ''; };
    r.onerror = function () { fmState.pdf = null; $('fm-err').textContent = 'That PDF didn’t load — try again.'; };
    r.readAsDataURL(f);
  });
  $('fm-remove').addEventListener('click', function () {
    if (!confirm('Remove your card from the family tree?')) return;
    DDSFamily.save(DDSFamily.load().filter(function (e) { return e.id !== fmState.id; }));
    $('fam-modal').hidden = true;
    renderFamily();
  });
  $('fm-save').addEventListener('click', function () {
    var name = $('fm-name').value.trim(), year = $('fm-year').value.trim();
    var link = $('fm-link').value.trim();
    if (!name) return $('fm-err').textContent = 'Add your name.';
    if (!year) return $('fm-err').textContent = 'Add your class year (e.g. ’27).';
    if (link && !/^https?:\/\//i.test(link)) return $('fm-err').textContent = 'Links need to start with http(s)://';
    var family = fmState.role === 'big' ? $('fm-newfam').value.trim() : $('fm-fam').value;
    if (!family) return $('fm-err').textContent = fmState.role === 'big' ? 'Name your new line.' : 'Pick a family.';
    var saved = DDSFamily.load();
    if (fmState.mode === 'edit') {
      var entry = saved.find(function (e) { return e.id === fmState.id; });
      if (entry) {
        entry.name = name; entry.year = year; entry.family = family;
        if (fmState.pdf) entry.link = fmState.pdf;
        else if (link) entry.link = link;
        if (fmState.photo) entry.photo = fmState.photo;
      }
    } else {
      if (fmState.role === 'big' && famList.some(function (f) { return f.name.toLowerCase() === family.toLowerCase(); })) {
        return $('fm-err').textContent = 'That family name is taken — pick a fresh one.';
      }
      saved.push({ id: DDSFamily.uid(), role: fmState.role, name: name, year: year, family: family, link: fmState.pdf || link || null, photo: fmState.photo, mid: ME.id });
    }
    try { DDSFamily.save(saved); }
    catch (e) { return $('fm-err').textContent = 'Storage is full on this browser — use a smaller photo.'; }
    $('fam-modal').hidden = true;
    renderFamily(family);
  });

  renderFamily();

  /* ================= Gallery ================= */
  var GAL_KEY = 'dds-gallery-v1';
  var COM_KEY = 'dds-gallery-comments-v1';
  var baseCols = [{ id: 'col1', title: '2025-2026', photos: [] }, { id: 'col2', title: '2026-2027', photos: [] }];
  var albums = [], curAlb = null, lbList = [], lbIdx = -1;

  function mergedAlbums() {
    var extras = readLS(GAL_KEY, { collections: [] }).collections || [];
    var out = baseCols.map(function (c) {
      return { id: c.id, title: c.title, photos: c.photos.slice() };
    });
    extras.forEach(function (x) {
      var hit = out.find(function (c) { return c.id === x.id; });
      if (hit) hit.photos = hit.photos.concat(x.photos || []);
      else out.push({ id: x.id, title: x.title, photos: (x.photos || []).slice() });
    });
    return out;
  }
  function galExtras() { return readLS(GAL_KEY, { collections: [] }); }
  function photoTitle(p, i) { return p.title || 'From the chapter archive'; }
  function photoBy(p) { return p.by || 'ΔΔΣ archive'; }

  function renderAlbums() {
    albums = mergedAlbums();
    $('gal-albums').innerHTML = albums.map(function (c, i) {
      var cover = c.photos.length ? c.photos[c.photos.length - 1].u : '';
      return '<button class="alb" type="button" data-alb="' + i + '" aria-label="Open album ' + esc(c.title) + '">' +
        (cover ? '<span class="alb-img" style="background-image:url(\'' + cover + '\');"></span>'
          : '<span class="alb-img" style="background:radial-gradient(120% 100% at 50% 0%,#16345c 0%,#0a1830 70%);"></span>') +
        '<span class="alb-scrim"></span>' +
        '<span class="alb-meta"><span class="alb-title">' + esc(c.title) + '</span>' +
        '<span class="alb-n">' + (c.photos.length === 1 ? '1 photo' : c.photos.length + ' photos') + '</span></span>' +
      '</button>';
    }).join('') +
    '<button class="alb alb-new" type="button" id="alb-new"><span style="font-size:26px;line-height:1;">&#43;</span>New album</button>';
  }

  function openAlbum(i) {
    curAlb = albums[i]; if (!curAlb) return;
    $('gal-albums').hidden = true;
    $('gal-open').hidden = false;
    $('gal-title').textContent = curAlb.title;
    renderPhotos();
    $('gallery').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPhotos() {
    var ph = curAlb.photos;
    $('gal-count').textContent = ph.length === 1 ? '1 photo' : ph.length + ' photos';
    $('gal-empty').hidden = ph.length > 0;
    $('pgrid').innerHTML = ph.map(function (p, i) {
      return '<button class="ph" type="button" data-ph="' + i + '" aria-label="Open photo: ' + esc(photoTitle(p, i)) + '">' +
        '<img src="' + p.u + '" alt="' + esc(photoTitle(p, i)) + '" loading="lazy"' + (p.w && p.h ? ' width="' + p.w + '" height="' + p.h + '"' : '') + '>' +
        '<span class="ph-meta">' +
          '<span class="ph-title">' + esc(photoTitle(p, i)) + '</span>' +
          (p.cap ? '<span class="ph-cap">' + esc(p.cap) + '</span>' : '') +
          '<span class="ph-by">' + esc(photoBy(p)) + (p.at ? '<small>' + fmtDate(p.at) + '</small>' : '') + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
  }

  $('gallery').addEventListener('click', function (e) {
    var alb = e.target.closest('[data-alb]');
    if (alb) { openAlbum(+alb.getAttribute('data-alb')); return; }
    if (e.target.closest('#alb-new')) { $('alb-err').textContent = ''; $('alb-name').value = ''; $('alb-modal').hidden = false; $('alb-name').focus(); return; }
    var ph = e.target.closest('[data-ph]');
    if (ph) openLightbox(+ph.getAttribute('data-ph'));
  });
  $('gal-back').addEventListener('click', function () {
    $('gal-open').hidden = true; $('gal-albums').hidden = false; curAlb = null; renderAlbums();
  });

  $('alb-save').addEventListener('click', function () {
    var name = $('alb-name').value.trim();
    if (!name) return $('alb-err').textContent = 'Give the album a name.';
    var extras = galExtras();
    extras.collections = extras.collections || [];
    extras.collections.push({ id: 'c' + uid(), title: name, photos: [] });
    writeLS(GAL_KEY, extras);
    $('alb-modal').hidden = true;
    renderAlbums();
  });

  /* --- upload --- */
  var upData = null;
  function photoProcess(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maxW = 1400, s = Math.min(1, maxW / img.width);
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ u: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height });
        };
        img.onerror = reject; img.src = r.result;
      };
      r.onerror = reject; r.readAsDataURL(file);
    });
  }
  $('gal-upload').addEventListener('click', function () {
    upData = null;
    $('up-err').textContent = ''; $('up-title').value = ''; $('up-cap').value = ''; $('up-file').value = '';
    $('up-preview').style.display = 'none';
    $('up-sub').textContent = 'It joins “' + curAlb.title + '” here and in the homepage gallery.';
    $('up-modal').hidden = false;
  });
  $('up-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    $('up-err').textContent = '';
    photoProcess(f).then(function (d) {
      upData = d;
      $('up-preview').src = d.u; $('up-preview').style.display = 'block';
    }).catch(function () { $('up-err').textContent = 'That image didn’t load — try another file.'; });
  });
  $('up-save').addEventListener('click', function () {
    if (!upData) return $('up-err').textContent = 'Pick an image first.';
    var title = $('up-title').value.trim();
    if (!title) return $('up-err').textContent = 'Give the photo a title.';
    var extras = galExtras();
    extras.collections = extras.collections || [];
    var col = extras.collections.find(function (c) { return c.id === curAlb.id; });
    if (!col) { col = { id: curAlb.id, title: curAlb.title, photos: [] }; extras.collections.push(col); }
    col.photos.push({ id: uid(), u: upData.u, w: upData.w, h: upData.h, title: title, cap: $('up-cap').value.trim(), by: ME.name, byId: ME.id, at: Date.now() });
    try { writeLS(GAL_KEY, extras); }
    catch (e) { return $('up-err').textContent = 'This browser’s storage is full — try a smaller image or clear an older upload.'; }
    $('up-modal').hidden = true;
    var keep = curAlb.id;
    renderAlbums();
    var i = albums.findIndex(function (c) { return c.id === keep; });
    if (i > -1) openAlbum(i);
  });

  /* --- lightbox --- */
  function comments(pid) { return readLS(COM_KEY, {})[pid] || []; }
  function openLightbox(i) {
    lbList = curAlb.photos; lbIdx = i;
    showLb();
    $('lb').hidden = false;
    document.body.style.overflow = 'hidden';
    $('lb-close').focus();
  }
  function closeLightbox() {
    $('lb').hidden = true;
    document.body.style.overflow = '';
  }
  function showLb() {
    var p = lbList[lbIdx]; if (!p) return;
    $('lb-img').src = p.u;
    $('lb-img').alt = photoTitle(p, lbIdx);
    $('lb-title').textContent = photoTitle(p, lbIdx);
    $('lb-by').textContent = photoBy(p);
    $('lb-date').textContent = p.at
      ? new Date(p.at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + fmtTime(p.at)
      : 'Date not recorded';
    $('lb-cap').textContent = p.cap || '';
    $('lb-cap').style.display = p.cap ? '' : 'none';
    renderLbComments();
    $('lb-cinput').value = '';
  }
  function renderLbComments() {
    var p = lbList[lbIdx]; if (!p) return;
    var cs = comments(p.id);
    $('lb-cn').textContent = cs.length ? cs.length : '';
    $('lb-comments').innerHTML = cs.length ? cs.map(function (c) {
      return '<div class="lb-com"><div class="c-head"><span class="c-by">' + esc(c.by) + '</span>' +
        '<span class="c-time">' + fmtDate(c.at) + ' · ' + fmtTime(c.at) + '</span></div>' +
        '<p>' + esc(c.text) + '</p></div>';
    }).join('') : '<p class="lb-nocom">No comments yet — say something nice.</p>';
  }
  function lbStep(d) {
    if (!lbList.length) return;
    lbIdx = (lbIdx + d + lbList.length) % lbList.length;
    showLb();
  }
  $('lb-close').addEventListener('click', closeLightbox);
  $('lb-prev').addEventListener('click', function () { lbStep(-1); });
  $('lb-next').addEventListener('click', function () { lbStep(1); });
  $('lb').addEventListener('mousedown', function (e) { if (e.target === $('lb') || e.target.classList.contains('lb-stage')) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    if ($('lb').hidden) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
    else if (e.key === 'Escape') closeLightbox();
  });
  $('lb-cform').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('lb-cinput').value.trim(); if (!text) return;
    var p = lbList[lbIdx]; if (!p) return;
    var all = readLS(COM_KEY, {});
    (all[p.id] = all[p.id] || []).push({ id: uid(), by: ME.name, byId: ME.id, text: text, at: Date.now() });
    try { writeLS(COM_KEY, all); } catch (err) {}
    $('lb-cinput').value = '';
    renderLbComments();
  });

  /* Deep link from the homepage carousel: dashboard.html?album=<id>#gallery */
  function openLinkedAlbum() {
    var m = /[?&]album=([^&#]+)/.exec(location.search);
    if (!m) return;
    var id = decodeURIComponent(m[1]);
    var i = albums.findIndex(function (c) { return c.id === id; });
    if (i > -1) openAlbum(i);
  }

  fetch('gallery.state.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j && Array.isArray(j.collections) && j.collections.length) baseCols = j.collections;
      renderAlbums();
      openLinkedAlbum();
    })
    .catch(function () { renderAlbums(); openLinkedAlbum(); });

  /* ================= Upcoming events (live Google Calendar) ================= */
  if (window.DDSEvents) {
    DDSEvents.mount($('upe-dash'), {
      empty: 'Nothing on the calendar in the next two weeks — enjoy the quiet.'
    });
  }

  /* ================= Member resources (exec-curated) ================= */
  var IS_EXEC = !!(DDSAuth.isExec && DDSAuth.isExec());
  var resEditing = null; // resource id while the modal is in edit mode

  function renderResources() {
    var rows = DDSResources.all();
    if (!rows.length) {
      $('res-list').innerHTML = '<div class="upe-empty">No resources posted yet' +
        (IS_EXEC ? ' — add the first one.' : ' — the exec board is on it.') + '</div>';
      return;
    }
    var LINK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    $('res-list').innerHTML = rows.map(function (r) {
      var host = '';
      try { host = new URL(r.url).host.replace(/^www\./, ''); } catch (e) {}
      return '<div class="res-row">' +
        '<div class="res-main">' +
          '<a class="res-title" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + LINK_SVG + esc(r.title) + '</a>' +
          (host ? '<span class="res-url">' + esc(host) + '</span>' : '') +
          (r.blurb ? '<p class="res-blurb">' + esc(r.blurb) + '</p>' : '') +
        '</div>' +
        (IS_EXEC ? '<div class="res-tools">' +
          '<button type="button" data-res-edit="' + esc(r.id) + '">&#9998; Edit</button>' +
          '<button type="button" data-res-del="' + esc(r.id) + '" aria-label="Remove ' + esc(r.title) + '">&#10005;</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
  }

  if (IS_EXEC) {
    $('res-add').hidden = false;
    $('res-note').hidden = false;
    $('res-note').textContent = 'You’re seeing edit tools because you’re signed in as ' +
      (DDSAuth.execTitle(ME) || 'a member of the exec board') +
      '. Members can open every link; only exec can change them.';

    var openResModal = function (rec) {
      resEditing = rec ? rec.id : null;
      $('rf-title').textContent = rec ? 'Edit this resource' : 'Add a resource';
      $('rf-name').value = rec ? rec.title : '';
      $('rf-url').value = rec ? rec.url : '';
      $('rf-blurb').value = rec ? (rec.blurb || '') : '';
      $('rf-err').textContent = '';
      $('res-modal').hidden = false;
      $('rf-name').focus();
    };

    $('res-add').addEventListener('click', function () { openResModal(null); });

    $('res-list').addEventListener('click', function (e) {
      var edit = e.target.closest('[data-res-edit]');
      var del = e.target.closest('[data-res-del]');
      if (edit) {
        var rec = DDSResources.all().find(function (r) { return r.id === edit.getAttribute('data-res-edit'); });
        if (rec) openResModal(rec);
      } else if (del) {
        var id = del.getAttribute('data-res-del');
        var doomed = DDSResources.all().find(function (r) { return r.id === id; });
        if (doomed && confirm('Remove "' + doomed.title + '" for everyone?')) {
          DDSResources.remove(id);
          renderResources();
        }
      }
    });

    $('rf-save').addEventListener('click', function () {
      var title = $('rf-name').value.trim();
      var url = DDSResources.normUrl($('rf-url').value);
      var blurb = $('rf-blurb').value.trim();
      if (!title) { $('rf-err').textContent = 'Give the resource a title.'; return; }
      if (!url) { $('rf-err').textContent = 'That link doesn’t look like a URL.'; return; }
      if (resEditing) DDSResources.update(resEditing, { title: title, url: url, blurb: blurb });
      else DDSResources.add({ title: title, url: url, blurb: blurb });
      $('res-modal').hidden = true;
      renderResources();
    });
  }

  renderResources();

  /* ================= Cross-tab sync ================= */
  window.addEventListener('storage', function (e) {
    if (e.key === CHAT_KEY) renderChat(false);
    else if (e.key === DDSResources.KEY) renderResources();
    else if (e.key === NOTES_KEY) refreshOthers();
    else if (e.key === CLS_KEY) renderClasses();
    else if (e.key === DDSFamily.KEY) renderFamily(famList[famIdx] && famList[famIdx].name);
    else if (e.key === GAL_KEY) {
      if (curAlb) { var keep = curAlb.id; albums = mergedAlbums(); var i = albums.findIndex(function (c) { return c.id === keep; }); if (i > -1) { curAlb = albums[i]; renderPhotos(); } }
      else renderAlbums();
    }
    else if (e.key === COM_KEY && !$('lb').hidden) renderLbComments();
  });

  renderClasses();
})();

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
    ['instruments', 'events', 'meetings', 'classes', 'resources', 'members', 'chat', 'family', 'gallery'].forEach(function (id) {
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
      var f = loggedSums(), b = DATA || { dental: 0, total: 0, nonDental: 0 };
      G.dental.set(num(b.dental) + f.dental);
      G.total.set((num(b.total) || 0) + f.dental + f.non);
      G.nondental.set(num(b.nonDental) + f.non);
    }, 900);
  }, 350);

  /* ================= Sheet sync ================= */
  var SHEET_ID = '1yXCL-EK5xeVeIATHolpgLdSzQcEDcndSCJL4bbnPFE4';
  var SHEET_GID = '1629504388';
  var CACHE_KEY = 'dds-sheet-cache-v1';
  var HOURS_KEY = 'dds-hours-v1', HCATS_KEY = 'dds-hour-cats-v1';
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

  function renderSheet(dRaw) {
    var d = foldLogged(dRaw);                 // fold in the member's self-logged hours
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

    if (!d.sheetFound && !$('nf-note')) {
      var n = document.createElement('p');
      n.id = 'nf-note';
      n.style.cssText = 'margin:14px 0 0;color:#9FB6CE;font-size:12.5px;line-height:1.6;max-width:60ch;';
      n.innerHTML = 'You&rsquo;re not on the chapter sheet yet — official hours appear once the exec board adds <b style="color:#E3C27C;">' + esc(ME.name) + '</b> (' + esc(ME.email) + ') to it. Anything you log below counts toward your gauges in the meantime.';
      $('standing').after(n);
    } else if (d.sheetFound && $('nf-note')) $('nf-note').remove();
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
    if (window.DDSCloud) DDSCloud.touch('notes');
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
        return '<div class="svc-row"><span class="svc-name">' + esc(c.name) +
          (c.logged ? ' <span class="svc-logged">you logged</span>' : '') + '</span>' +
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
    // Stable seed ids (seed-*) keep this demo content local-only — the
    // cloud engine never uploads rows whose id starts with "seed-", so
    // every browser shows the same examples without duplicating them
    // into the shared database. Real member ratings get uid() ids.
    var seq = 0;
    var mk = function (kind, code, prof, rating, take, by, days) {
      return { id: 'seed-cls-' + (seq++), kind: kind, code: code, prof: prof, rating: rating, take: take, by: by, byId: 'seed-' + by.replace(/\W/g, ''), at: Date.now() - days * 864e5 };
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
    if (window.DDSCloud) DDSCloud.touch('classes');
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
    if (window.DDSCloud) DDSCloud.touch('classes');
    $('prof-modal').hidden = true;
    renderClasses();
  });

  /* ================= Roster helpers (shared by chat + directory) ======== */
  function allMembers() { return DDSAuth.members ? DDSAuth.members() : []; }
  function memberById(id) { return allMembers().find(function (m) { return m.id === id; }); }
  function pub(m) {
    if (!m) return null;
    return { id: m.id, name: m.name, gradYear: m.gradYear, major: m.major || '', role: m.role,
      execTitle: m.execTitle || (DDSAuth.execTitle ? DDSAuth.execTitle(m) : null),
      photo: m.photo || null, quote: m.quote || '', interests: m.interests || '', hobbies: m.hobbies || '',
      favClasses: m.favClasses || '', favProfs: m.favProfs || '',
      instagram: m.instagram || '', linkedin: m.linkedin || '' };
  }
  function initial(name) { return String(name || '?').trim().charAt(0).toUpperCase() || '?'; }
  function avatarHtml(p, cls) {
    return '<span class="' + cls + '">' + (p && p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc(initial(p && p.name))) + '</span>';
  }

  /* ================= Chapter chat — channels, groups, DMs ================ */
  var CHAT_KEY = 'dds-chat-v1';   // legacy single room (migrated once)
  var MSG_KEY = 'dds-chat-v2';    // { id, ch, by, byId, text, img?, at }
  var CHAN_KEY = 'dds-chat-meta-v1'; // groups + DMs (General is implicit)
  var GENERAL = { id: 'seed-general', kind: 'channel', name: 'General', members: null };
  var curChan = 'seed-general';

  function messagesAll() {
    var list = readLS(MSG_KEY, null);
    if (list) return list;
    var legacy = readLS(CHAT_KEY, null);
    if (legacy && legacy.length) {          // fold the old single room into General
      list = legacy.map(function (m) {
        return { id: m.id, ch: 'seed-general', by: m.by, byId: m.byId, text: m.text || '', img: m.img, at: m.at };
      });
    } else {
      list = [{ id: 'seed-hello', ch: 'seed-general', by: 'Exec Board', byId: 'exec', at: Date.now() - 3 * 864e5,
        text: 'Welcome to the chapter chat — everyone signed in sees General. Start a group or a direct message with the “New chat” button, and type @ to tag someone.' }];
    }
    writeLS(MSG_KEY, list);
    return list;
  }
  function saveMessages(list) {
    if (list.length > 600) list = list.slice(-600);
    writeLS(MSG_KEY, list);
    if (window.DDSCloud) DDSCloud.touch('chatMsgs');
    return list;
  }
  function channelsStored() { var l = readLS(CHAN_KEY, []); return Array.isArray(l) ? l : []; }
  function saveChannels(list) { writeLS(CHAN_KEY, list); if (window.DDSCloud) DDSCloud.touch('chatMeta'); }

  // channels this member can see: General + groups they're in + their DMs
  function myChannels() {
    var mine = channelsStored().filter(function (c) {
      if (c.kind === 'dm') return (c.members || []).indexOf(ME.id) > -1;
      return c.members == null || c.members.indexOf(ME.id) > -1;
    });
    return [GENERAL].concat(mine);
  }
  function channelById(id) {
    if (id === 'seed-general') return GENERAL;
    return channelsStored().find(function (c) { return c.id === id; }) || GENERAL;
  }
  function channelLabel(c) {
    if (c.kind === 'dm') { var o = (c.members || []).filter(function (x) { return x !== ME.id; })[0]; var p = pub(memberById(o)); return p ? p.name : 'Direct message'; }
    return c.name || 'Channel';
  }
  function channelAvatar(c) {
    if (c.kind === 'dm') { var o = (c.members || []).filter(function (x) { return x !== ME.id; })[0]; return pub(memberById(o)); }
    return null;
  }
  function lastAt(chId) {
    var t = 0; messagesAll().forEach(function (m) { if (m.ch === chId && m.at > t) t = m.at; });
    return t;
  }

  function dmId(a, b) { return 'dm-' + [a, b].sort().join('-'); }
  function startDM(otherId) {
    if (!otherId || otherId === ME.id) return;
    var id = dmId(ME.id, otherId);
    var chans = channelsStored();
    if (!chans.some(function (c) { return c.id === id; })) {
      chans.push({ id: id, kind: 'dm', name: '', members: [ME.id, otherId].sort(), by: ME.id, at: Date.now() });
      saveChannels(chans);
    }
    switchChannel(id);
    if (!$('mem-modal').hidden) $('mem-modal').hidden = true;
    var chatSec = document.getElementById('chat');
    if (chatSec) chatSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { $('chat-input').focus(); }, 400);
  }

  function switchChannel(id) {
    curChan = id;
    var c = channelById(id);
    $('chat-title').textContent = channelLabel(c);
    var subEl = $('chat-sub');
    if (c.kind === 'dm') subEl.textContent = 'Direct message';
    else if (c.members) subEl.textContent = c.members.length + ' members';
    else subEl.textContent = 'Everyone in the chapter';
    renderRail();
    renderChat(true);
    $('chat-rail').classList.remove('open');
  }

  function renderRail() {
    var chans = myChannels();
    var channels = chans.filter(function (c) { return c.kind !== 'dm'; });
    var dms = chans.filter(function (c) { return c.kind === 'dm'; })
      .sort(function (a, b) { return lastAt(b.id) - lastAt(a.id); });
    var rowHtml = function (c) {
      var p = channelAvatar(c);
      var av = c.kind === 'dm'
        ? (p && p.photo ? '<span class="chat-chan-av"><img src="' + esc(p.photo) + '" alt=""></span>' : '<span class="chat-chan-av">' + esc(initial(p && p.name)) + '</span>')
        : '<span class="chat-chan-av">#</span>';
      return '<button class="chat-chan' + (c.kind === 'dm' ? ' dm' : '') + (c.id === curChan ? ' on' : '') + '" type="button" data-chan="' + esc(c.id) + '">' +
        av + '<span class="chat-chan-name">' + esc(channelLabel(c)) + '</span></button>';
    };
    $('chat-rail').innerHTML =
      '<div class="chat-rail-group">Channels</div>' + channels.map(rowHtml).join('') +
      '<div class="chat-rail-group">Direct messages</div>' +
      (dms.length ? dms.map(rowHtml).join('') : '<div class="res-fempty" style="padding:6px 10px;font-size:11px;">No DMs yet — open a profile and hit Message.</div>');
  }

  function dayLabel(t) {
    var d = new Date(t), now = new Date();
    var day = function (x) { return x.toDateString(); };
    if (day(d) === day(now)) return 'Today';
    if (day(d) === day(new Date(now - 864e5))) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /* Render message text, turning @[Name|id] tokens into profile chips. */
  var MENTION_RE = /@\[([^\|\]]+)\|([^\]]+)\]/g;
  function mentionChip(id, fallbackName) {
    var p = pub(memberById(id));
    var nm = p ? p.name : fallbackName;
    var av = p && p.photo ? '<span class="mention-av"><img src="' + esc(p.photo) + '" alt=""></span>'
      : '<span class="mention-av">' + esc(initial(nm)) + '</span>';
    return '<a class="mention" href="#members" data-mid="' + esc(id) + '" data-mention="' + esc(id) + '">' + av + '@' + esc(nm) + '</a>';
  }
  function renderMsgText(text) {
    var out = '', last = 0, m; MENTION_RE.lastIndex = 0;
    while ((m = MENTION_RE.exec(text))) {
      out += esc(text.slice(last, m.index));
      out += mentionChip(m[2], m[1]);
      last = MENTION_RE.lastIndex;
    }
    return out + esc(text.slice(last));
  }

  function renderChat(stick) {
    var log = $('chat-log');
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    var lastDay = '';
    var msgs = messagesAll().filter(function (m) { return m.ch === curChan; });
    if (!msgs.length) {
      log.innerHTML = '<div class="res-fempty" style="text-align:center;margin:auto;">No messages yet — say hi.</div>';
      return;
    }
    log.innerHTML = msgs.map(function (m) {
      var mine = m.byId === ME.id;
      var head = '';
      var dl = dayLabel(m.at);
      if (dl !== lastDay) { lastDay = dl; head = '<span class="chat-day">' + dl + '</span>'; }
      var p = pub(memberById(m.byId));
      var mid = p ? ' data-mid="' + esc(m.byId) + '" role="button" tabindex="0"' : '';
      var avatar = mine ? '' :
        '<span class="msg-av"' + mid + (p ? ' title="' + esc(m.by) + '"' : '') + '>' +
          (p && p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc(initial(m.by))) + '</span>';
      var body = (m.img ? '<img class="chat-img" src="' + esc(m.img) + '" alt="Photo from ' + esc(m.by) + '" loading="lazy">' : '') +
        (m.text ? '<span class="chat-txt">' + renderMsgText(m.text) + '</span>' : '');
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
    log.querySelectorAll('img').forEach(function (img) { if (!img.complete) img.addEventListener('load', settle, { once: true }); });
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
    var list = messagesAll();
    var msg = { id: uid(), ch: curChan, by: ME.name, byId: ME.id, text: text.slice(0, 1000), at: Date.now() };
    if (chatImg) msg.img = chatImg;
    list.push(msg);
    try { list = saveMessages(list); }
    catch (e) { setPending(chatImg, 'This browser’s storage is full — the photo won’t fit. Clear old uploads or send text only.', true); return; }
    ta.value = ''; ta.style.height = '44px';
    setPending(null, null, false);
    closeMentionPop();
    renderChat(true);
    renderRail();
  }
  $('chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', function (e) {
    if (menOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMention(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveMention(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(menItems[menActive]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMentionPop(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $('chat-input').addEventListener('input', function () {
    this.style.height = '44px';
    this.style.height = Math.min(120, this.scrollHeight) + 'px';
    updateMentions();
  });
  $('chat-log').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (b) {
      var did = b.getAttribute('data-del');
      saveMessages(messagesAll().filter(function (m) { return m.id !== did; }));
      if (window.DDSCloud) DDSCloud.tombstone('chatMsgs', did);
      renderChat(false); renderRail();
      return;
    }
    if (e.target.closest('[data-mid]')) return; // handled by profile openers below
    var img = e.target.closest('.chat-img');
    if (img) { $('imgview-img').src = img.src; $('imgview').hidden = false; }
  });
  $('imgview').addEventListener('click', function () { $('imgview').hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('imgview').hidden) $('imgview').hidden = true;
  });

  /* --- rail + new-chat --- */
  $('chat-rail').addEventListener('click', function (e) {
    var b = e.target.closest('[data-chan]'); if (!b) return;
    switchChannel(b.getAttribute('data-chan'));
  });
  $('chat-back').addEventListener('click', function () { $('chat-rail').classList.toggle('open'); });

  /* --- @mention autocomplete --- */
  var menOpen = false, menItems = [], menActive = 0, menStart = 0;
  function closeMentionPop() { menOpen = false; $('mention-pop').classList.remove('show'); }
  function updateMentions() {
    var ta = $('chat-input'), val = ta.value, caret = ta.selectionStart;
    var before = val.slice(0, caret);
    var m = /(^|\s)@([\w.'-]*)$/.exec(before);
    if (!m) { closeMentionPop(); return; }
    var q = m[2].toLowerCase();
    menStart = caret - m[2].length - 1; // index of '@'
    var me = ME.id;
    menItems = allMembers().filter(function (u) {
      if (u.id === me) return false;
      if (!q) return true;
      return String(u.name).toLowerCase().indexOf(q) > -1 ||
        String(u.name).toLowerCase().split(/\s+/).some(function (w) { return w.indexOf(q) === 0; });
    }).slice(0, 6);
    if (!menItems.length) { closeMentionPop(); return; }
    menActive = 0; menOpen = true;
    renderMentionPop();
  }
  function renderMentionPop() {
    $('mention-pop').innerHTML = menItems.map(function (u, i) {
      var p = pub(u);
      return '<div class="mention-opt' + (i === menActive ? ' on' : '') + '" data-mi="' + i + '" role="option">' +
        avatarHtml(p, 'mo-av') + '<b>' + esc(p.name) + '</b><span>' + esc(p.major || ('Class of ' + (p.gradYear || '—'))) + '</span></div>';
    }).join('');
    $('mention-pop').classList.add('show');
  }
  function moveMention(d) { menActive = (menActive + d + menItems.length) % menItems.length; renderMentionPop(); }
  function pickMention(u) {
    if (!u) return;
    var ta = $('chat-input'), val = ta.value, caret = ta.selectionStart;
    var name = String(u.name).replace(/[|\]]/g, '');
    var token = '@[' + name + '|' + u.id + '] ';
    ta.value = val.slice(0, menStart) + token + val.slice(caret);
    var pos = menStart + token.length;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    closeMentionPop();
  }
  $('mention-pop').addEventListener('mousedown', function (e) {
    var o = e.target.closest('[data-mi]'); if (!o) return;
    e.preventDefault(); pickMention(menItems[+o.getAttribute('data-mi')]);
  });

  /* --- member profile popover (hover) + full modal (click) --- */
  var popHideT = null, popFor = null;
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
    var p = pub(memberById(mid));
    if (!p) return;
    popFor = mid;
    var pop = $('ppop');
    var bio = [p.interests, p.hobbies].filter(Boolean).join(' · ');
    pop.innerHTML =
      '<div class="ppop-head">' + avatarHtml(p, 'ppop-av') +
        '<div><h5 class="ppop-name">' + esc(p.name) + '</h5>' +
        '<p class="ppop-meta">' + esc(['Class of ' + (p.gradYear || '—'), p.major].filter(Boolean).join(' · ')) + '</p></div>' +
      '</div>' +
      (p.quote ? '<p class="ppop-quote">“' + esc(p.quote) + '”</p>' : (bio ? '<p class="ppop-bio">' + esc(bio) + '</p>' : '')) +
      socialChips(p) +
      '<button class="btn btn-solid" type="button" data-viewprofile="' + esc(mid) + '" style="width:100%;margin-top:12px;">View full profile</button>';
    pop.classList.add('show');
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    var top = r.top - h - 10;
    if (top < 64) top = Math.min(r.bottom + 10, window.innerHeight - h - 12);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function hidePop() { popFor = null; $('ppop').classList.remove('show'); }
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest('[data-mid]'); if (!t) return;
    clearTimeout(popHideT); showPop(t.getAttribute('data-mid'), t);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-mid]')) popHideT = setTimeout(hidePop, 260);
  });
  $('ppop').addEventListener('mouseenter', function () { clearTimeout(popHideT); });
  $('ppop').addEventListener('mouseleave', function () { popHideT = setTimeout(hidePop, 220); });
  document.addEventListener('click', function (e) {
    var view = e.target.closest('[data-viewprofile]');
    if (view) { openMemberModal(view.getAttribute('data-viewprofile')); hidePop(); return; }
    var t = e.target.closest('[data-mid]');
    if (t) { e.preventDefault(); openMemberModal(t.getAttribute('data-mid')); hidePop(); return; }
    if (!e.target.closest('#ppop')) hidePop();
  });

  /* ================= Member directory — profiles in space ============== */
  var memQuery = '';
  function memberSort(a, b) {
    var ax = DDSAuth.isExec && DDSAuth.isExec(a) ? 0 : 1;
    var bx = DDSAuth.isExec && DDSAuth.isExec(b) ? 0 : 1;
    if (ax !== bx) return ax - bx;
    return String(a.name).localeCompare(String(b.name));
  }
  function renderMembers() {
    var host = $('mem-space');
    var list = allMembers().slice().sort(memberSort);
    if (memQuery) {
      var q = memQuery.toLowerCase();
      list = list.filter(function (m) {
        return [m.name, m.major, m.interests, m.hobbies, DDSAuth.execTitle && DDSAuth.execTitle(m)]
          .filter(Boolean).join(' ').toLowerCase().indexOf(q) > -1;
      });
    }
    if (!list.length) {
      host.innerHTML = '<div class="mem-empty">' + (memQuery ? 'No members match “' + esc(memQuery) + '.”' : 'You’re the first one here. As members sign in, they’ll appear in this constellation.') + '</div>';
      return;
    }
    host.innerHTML = list.map(function (m, i) {
      var p = pub(m);
      var isExec = DDSAuth.isExec && DDSAuth.isExec(m);
      var role = isExec ? (DDSAuth.execTitle(m) || 'Exec Board') : 'Class of ' + (p.gradYear || '—');
      var tags = p.quote ? '“' + p.quote + '”' : [p.interests, p.major].filter(Boolean).join(' · ');
      return '<button class="mem-card" type="button" data-mem="' + esc(p.id) + '" style="--dur:' + (6 + (i % 5) * 0.7).toFixed(1) + 's;--dly:' + (i % 6 * 0.35).toFixed(2) + 's;">' +
        (m.id === ME.id ? '<span class="mem-badge">You</span>' : '') +
        avatarHtml(p, 'mem-av') +
        '<span class="mem-name">' + esc(p.name) + '</span>' +
        '<span class="mem-role' + (isExec ? ' exec' : '') + '">' + esc(role) + '</span>' +
        (tags ? '<span class="mem-tags' + (p.quote ? ' is-quote' : '') + '">' + esc(tags) + '</span>' : '') +
      '</button>';
    }).join('');
  }
  $('mem-space').addEventListener('click', function (e) {
    var c = e.target.closest('[data-mem]'); if (!c) return;
    openMemberModal(c.getAttribute('data-mem'));
  });
  $('mem-search').addEventListener('input', function () { memQuery = this.value.trim(); renderMembers(); });

  function openMemberModal(id) {
    var m = memberById(id); var p = pub(m);
    if (!p) return;
    var isExec = DDSAuth.isExec && DDSAuth.isExec(m);
    var role = isExec ? (DDSAuth.execTitle(m) || 'Exec Board') : null;
    var meta = ['Class of ' + (p.gradYear || '—'), p.major].filter(Boolean).join('  ·  ');
    var bio = [p.interests, p.hobbies].filter(Boolean).join(' · ');
    var cell = function (label, val) { return val ? '<div><h5>' + label + '</h5><p>' + esc(val) + '</p></div>' : ''; };
    var grid = cell('Interests', p.interests) + cell('Hobbies', p.hobbies) +
      cell('Favorite classes', p.favClasses) + cell('Favorite professors', p.favProfs);
    var foot = '';
    if (id === ME.id) {
      foot = '<a class="btn btn-solid" href="member.html">Edit your profile</a>';
    } else {
      foot = '<button class="btn btn-solid" type="button" data-msg="' + esc(id) + '">Message ' + esc(p.name.split(/\s+/)[0]) + '</button>';
    }
    foot += '<button class="btn" type="button" data-findtree="' + esc(id) + '">Find on family tree</button>';
    if (p.instagram) foot += '<a class="btn" href="' + esc(p.instagram) + '" target="_blank" rel="noopener">Instagram</a>';
    if (p.linkedin) foot += '<a class="btn" href="' + esc(p.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>';
    $('mem-modal-body').innerHTML =
      '<div class="mem-detail-head">' + avatarHtml(p, 'mem-detail-av') +
        '<div><h3>' + esc(p.name) + '</h3><div class="mem-detail-meta">' + esc(meta) + '</div>' +
        (role ? '<span class="mem-detail-chip">' + esc(role) + '</span>' : '') + '</div>' +
      '</div>' +
      (p.quote ? '<blockquote class="mem-detail-quote">' + esc(p.quote) + '</blockquote>' : '') +
      (bio ? '<p class="mem-detail-bio">' + esc(bio) + '</p>' : '<p class="mem-detail-bio" style="color:var(--ink3);">This member hasn’t added a bio yet.</p>') +
      (grid ? '<div class="mem-detail-grid">' + grid + '</div>' : '') +
      '<div class="mem-detail-foot">' + foot + '</div>';
    $('mem-modal').hidden = false;
  }
  $('mem-modal-body').addEventListener('click', function (e) {
    var msg = e.target.closest('[data-msg]');
    if (msg) { startDM(msg.getAttribute('data-msg')); return; }
    var tree = e.target.closest('[data-findtree]');
    if (tree) {
      $('mem-modal').hidden = true;
      var fam = document.getElementById('family');
      if (fam) fam.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* --- new-chat modal (DM or group) --- */
  var cnMode = 'dm', cnPicked = {};
  function cnRenderPeople() {
    var q = $('cn-people-search').value.trim().toLowerCase();
    var list = allMembers().filter(function (u) { return u.id !== ME.id; })
      .filter(function (u) { return !q || String(u.name).toLowerCase().indexOf(q) > -1; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    $('cn-people').innerHTML = list.length ? list.map(function (u) {
      var p = pub(u);
      return '<button class="cn-person' + (cnPicked[u.id] ? ' on' : '') + '" type="button" data-cnp="' + esc(u.id) + '">' +
        avatarHtml(p, 'cnp-av') + '<span><b>' + esc(p.name) + '</b><small>' + esc(p.major || ('Class of ' + (p.gradYear || '—'))) + '</small></span>' +
        '<svg class="cnp-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>';
    }).join('') : '<div class="res-fempty" style="padding:10px;">No other members yet.</div>';
  }
  function openNewChat() {
    cnMode = 'dm'; cnPicked = {};
    document.querySelectorAll('[data-cn-mode]').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-cn-mode') === 'dm'); });
    $('cn-name-fld').hidden = true;
    $('cn-people-label').textContent = 'Message who?';
    $('cn-save').textContent = 'Start';
    $('cn-err').textContent = '';
    $('cn-people-search').value = '';
    cnRenderPeople();
    $('chat-new-modal').hidden = false;
  }
  $('chat-new').addEventListener('click', openNewChat);
  document.querySelectorAll('[data-cn-mode]').forEach(function (t) {
    t.addEventListener('click', function () {
      cnMode = t.getAttribute('data-cn-mode');
      document.querySelectorAll('[data-cn-mode]').forEach(function (x) { x.classList.toggle('on', x === t); });
      $('cn-name-fld').hidden = cnMode !== 'group';
      $('cn-people-label').textContent = cnMode === 'group' ? 'Add members' : 'Message who?';
      if (cnMode === 'dm') { var keys = Object.keys(cnPicked); if (keys.length > 1) cnPicked = {}; }
      cnRenderPeople();
    });
  });
  $('cn-people-search').addEventListener('input', cnRenderPeople);
  $('cn-people').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cnp]'); if (!b) return;
    var id = b.getAttribute('data-cnp');
    if (cnMode === 'dm') { cnPicked = {}; cnPicked[id] = true; }
    else { if (cnPicked[id]) delete cnPicked[id]; else cnPicked[id] = true; }
    cnRenderPeople();
  });
  $('cn-save').addEventListener('click', function () {
    var ids = Object.keys(cnPicked);
    if (!ids.length) { $('cn-err').textContent = cnMode === 'dm' ? 'Pick someone to message.' : 'Add at least one member.'; return; }
    if (cnMode === 'dm') { $('chat-new-modal').hidden = true; startDM(ids[0]); return; }
    var name = $('cn-name').value.trim();
    if (!name) { $('cn-err').textContent = 'Name your group.'; return; }
    var chans = channelsStored();
    var id = uid();
    chans.push({ id: id, kind: 'channel', name: name, by: ME.id, members: [ME.id].concat(ids), at: Date.now() });
    saveChannels(chans);
    $('chat-new-modal').hidden = true;
    switchChannel(id);
    document.getElementById('chat').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* --- deep links: ?member=<id> opens a profile; ?dm=<id> starts a DM --- */
  (function memberDeepLink() {
    var mm = /[?&]member=([^&#]+)/.exec(location.search);
    var dm = /[?&]dm=([^&#]+)/.exec(location.search);
    if (mm) setTimeout(function () { openMemberModal(decodeURIComponent(mm[1])); }, 300);
    else if (dm) setTimeout(function () { startDM(decodeURIComponent(dm[1])); }, 300);
  })();

  renderMembers();
  renderRail();
  switchChannel('seed-general');

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

  /* --- upload (batch: pick several, one title + caption applies to all) --- */
  var upData = [];
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
  function renderUpStrip() {
    $('up-strip').innerHTML = upData.map(function (d, i) {
      return '<div class="up-thumb"><img src="' + d.u + '" alt=""><button type="button" data-uprm="' + i + '" aria-label="Remove photo ' + (i + 1) + '">✕</button></div>';
    }).join('');
    $('up-count').textContent = upData.length
      ? (upData.length === 1 ? '1 photo ready' : upData.length + ' photos ready — title & caption apply to all')
      : '';
  }
  $('gal-upload').addEventListener('click', function () {
    upData = [];
    $('up-err').textContent = ''; $('up-title').value = ''; $('up-cap').value = ''; $('up-file').value = '';
    $('up-preview').style.display = 'none';
    renderUpStrip();
    $('up-sub').textContent = 'They join “' + curAlb.title + '” here and in the homepage gallery.';
    $('up-modal').hidden = false;
  });
  $('up-strip').addEventListener('click', function (e) {
    var b = e.target.closest('[data-uprm]'); if (!b) return;
    upData.splice(+b.getAttribute('data-uprm'), 1); renderUpStrip();
  });
  $('up-file').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []); this.value = '';
    if (!files.length) return;
    $('up-err').textContent = '';
    files.reduce(function (chain, f) {
      return chain.then(function () {
        return photoProcess(f).then(function (d) { upData.push(d); renderUpStrip(); }, function () {});
      });
    }, Promise.resolve()).then(function () {
      if (!upData.length) $('up-err').textContent = 'Those images didn’t load — try different files.';
    });
  });
  $('up-save').addEventListener('click', function () {
    if (!upData.length) return $('up-err').textContent = 'Pick at least one image first.';
    var title = $('up-title').value.trim();     // optional — same title on each
    var cap = $('up-cap').value.trim();          // one caption applied to the whole batch
    var extras = galExtras();
    extras.collections = extras.collections || [];
    var col = extras.collections.find(function (c) { return c.id === curAlb.id; });
    if (!col) { col = { id: curAlb.id, title: curAlb.title, photos: [] }; extras.collections.push(col); }
    var now = Date.now();
    upData.forEach(function (d, i) {
      col.photos.push({ id: uid(), u: d.u, w: d.w, h: d.h, title: title, cap: cap, by: ME.name, byId: ME.id, at: now + i });
    });
    try { writeLS(GAL_KEY, extras); }
    catch (e) { return $('up-err').textContent = 'This browser’s storage is full — add fewer or smaller images and try again.'; }
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

  /* ================= Member resources — five shared folders ============= */
  var IS_EXEC = !!(DDSAuth.isExec && DDSAuth.isExec());
  var resEditing = null;   // resource id while the modal is in edit mode
  var resMode = 'link';    // 'link' | 'file'
  var resFile = null;      // pending upload { fileId?, fileData?, fileName, mime } or raw
  var openFolders = {};    // which folders are expanded

  var RES_ICONS = {
    doc:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
    brain: '<path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.6A3 3 0 0 0 6 17a3 3 0 0 0 6 0V4a1 1 0 0 0-1-1z"/><path d="M15 3a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.6A3 3 0 0 1 18 17a3 3 0 0 1-6 0"/>',
    tooth: '<path d="M12 5.5c-1.6 0-2.3-1-4-1-2.8 0-4.4 2.4-4.4 5 0 2.4 1 3.8 1.6 5.9.6 2.2.8 4.6 2.6 4.6 1.6 0 1.3-4.4 3-4.4s1.4 4.4 3 4.4c1.8 0 2-2.4 2.6-4.6.6-2.1 1.6-3.5 1.6-5.9 0-2.6-1.6-5-4.4-5-1.7 0-2.4 1-3.2 1z"/>',
    flag:  '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V4"/>',
    flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 22h11.6a2 2 0 0 0 1.7-3.5L14 9V3"/><path d="M7 15h10"/>'
  };
  var LINK_SVG = '<svg class="res-ficon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  var FILE_SVG = '<svg class="res-ficon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

  function canEditRes(r) { return IS_EXEC || (r.byId && r.byId === ME.id); }

  function renderResources() {
    var groups = DDSResources.byCat();
    var host = $('res-folders');
    host.innerHTML = DDSResources.CATS.map(function (c) {
      var rows = groups[c.id] || [];
      var open = !!openFolders[c.id];
      var body = rows.length ? '<div class="res-flist">' + rows.map(function (r) {
        var isFile = !!(r.fileId || r.fileData);
        var sub = '';
        if (r.url) { try { sub = new URL(r.url).host.replace(/^www\./, ''); } catch (e) {} }
        else if (isFile) sub = (r.fileName || 'file');
        var title = isFile
          ? '<a class="res-title" href="#" data-res-file="' + esc(r.id) + '">' + FILE_SVG + esc(r.title) + '</a>'
          : '<a class="res-title" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + LINK_SVG + esc(r.title) + '</a>';
        return '<div class="res-row">' +
          '<div class="res-main">' + title +
            (sub ? '<span class="res-url">' + esc(sub) + '</span>' : '') +
            (r.blurb ? '<p class="res-blurb">' + esc(r.blurb) + '</p>' : '') +
            (r.by ? '<span class="res-by">Added by ' + esc(r.by) + '</span>' : '') +
          '</div>' +
          (canEditRes(r) ? '<div class="res-tools">' +
            '<button type="button" data-res-edit="' + esc(r.id) + '">&#9998;</button>' +
            '<button type="button" data-res-del="' + esc(r.id) + '" aria-label="Remove ' + esc(r.title) + '">&#10005;</button>' +
          '</div>' : '') +
        '</div>';
      }).join('') + '</div>'
      : '<p class="res-fempty">Nothing here yet — use “Add a resource” above and pick this folder.</p>';
      return '<div class="res-fold' + (open ? ' open' : '') + '" data-acc="' + c.acc + '" data-fold="' + c.id + '">' +
        '<button class="res-fhead" type="button" data-fold-toggle="' + c.id + '" aria-expanded="' + open + '">' +
          '<span class="res-fic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + RES_ICONS[c.icon] + '</svg></span>' +
          '<span class="res-fmeta"><span class="res-fname">' + esc(c.name) + '</span><span class="res-ftag">' + esc(c.tag) + '</span></span>' +
          '<span class="res-fcount">' + rows.length + '</span>' +
          '<svg class="res-fchev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="res-fbody"><div class="res-finner">' + body + '</div></div>' +
      '</div>';
    }).join('');
  }

  /* Populate the folder <select> once */
  (function fillCatSelect() {
    var sel = $('rf-cat');
    if (sel) sel.innerHTML = DDSResources.CATS.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    }).join('');
  })();

  function setResMode(mode) {
    resMode = mode;
    document.querySelectorAll('.rf-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-rf-mode') === mode); });
    $('rf-link-fld').hidden = mode !== 'link';
    $('rf-file-fld').hidden = mode !== 'file';
  }

  function openResModal(rec, presetCat) {
    resEditing = rec ? rec.id : null;
    resFile = rec && (rec.fileId || rec.fileData) ? { fileId: rec.fileId, fileData: rec.fileData, fileName: rec.fileName, mime: rec.mime } : null;
    $('rf-title').textContent = rec ? 'Edit this resource' : 'Add a resource';
    $('rf-cat').value = rec ? rec.cat : (presetCat || DDSResources.CATS[0].id);
    $('rf-name').value = rec ? rec.title : '';
    $('rf-url').value = rec && rec.url ? rec.url : '';
    $('rf-blurb').value = rec ? (rec.blurb || '') : '';
    $('rf-err').textContent = '';
    var drop = $('rf-drop'), label = $('rf-file-label');
    drop.classList.toggle('has', !!(rec && (rec.fileId || rec.fileData)));
    label.textContent = rec && rec.fileName ? rec.fileName : 'Choose a file to share';
    setResMode(rec && (rec.fileId || rec.fileData) ? 'file' : 'link');
    $('res-modal').hidden = false;
    $('rf-name').focus();
  }

  $('res-add').addEventListener('click', function () { openResModal(null); });

  document.querySelectorAll('.rf-tab').forEach(function (t) {
    t.addEventListener('click', function () { setResMode(t.getAttribute('data-rf-mode')); });
  });

  /* --- file picker + drag/drop --- */
  var resDrop = $('rf-drop'), resInput = $('rf-file');
  resDrop.addEventListener('click', function () { resInput.click(); });
  ['dragover', 'dragenter'].forEach(function (ev) {
    resDrop.addEventListener(ev, function (e) { e.preventDefault(); resDrop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    resDrop.addEventListener(ev, function (e) { e.preventDefault(); resDrop.classList.remove('drag'); });
  });
  resDrop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) takeResFile(f);
  });
  resInput.addEventListener('change', function () { if (this.files && this.files[0]) takeResFile(this.files[0]); this.value = ''; });

  function takeResFile(f) {
    if (f.size > 5 * 1024 * 1024) { $('rf-err').textContent = 'Keep files under 5 MB.'; return; }
    $('rf-err').textContent = '';
    $('rf-file-label').textContent = 'Reading “' + f.name + '”…';
    var r = new FileReader();
    r.onload = function () {
      resFile = { raw: r.result, fileName: f.name, mime: f.type || 'application/octet-stream' };
      $('rf-drop').classList.add('has');
      $('rf-file-label').textContent = f.name;
      if (!$('rf-name').value.trim()) $('rf-name').value = f.name.replace(/\.[^.]+$/, '');
    };
    r.onerror = function () { $('rf-file-label').textContent = 'That file could not be read — try another.'; };
    r.readAsDataURL(f);
  }

  $('rf-save').addEventListener('click', function () {
    var title = $('rf-name').value.trim();
    var cat = $('rf-cat').value;
    var blurb = $('rf-blurb').value.trim();
    if (!title) { $('rf-err').textContent = 'Give the resource a title.'; return; }

    var save = $('rf-save');
    var finish = function (fields) {
      if (resEditing) DDSResources.update(resEditing, fields);
      else DDSResources.add(fields);
      $('res-modal').hidden = true;
      openFolders[cat] = true;
      save.disabled = false; save.textContent = 'Save resource';
      renderResources();
    };

    if (resMode === 'link') {
      var url = DDSResources.normUrl($('rf-url').value);
      if (!url) { $('rf-err').textContent = 'That link doesn’t look like a URL.'; return; }
      finish({ cat: cat, title: title, blurb: blurb, url: url, fileId: null, fileData: null, fileName: null, mime: null,
        by: resEditing ? undefined : ME.name, byId: resEditing ? undefined : ME.id });
      return;
    }

    // file mode
    if (resFile && resFile.raw) {                          // a fresh upload
      save.disabled = true; save.textContent = 'Uploading…';
      var meta = { cat: cat, title: title, blurb: blurb, url: null,
        fileName: resFile.fileName, mime: resFile.mime,
        by: resEditing ? undefined : ME.name, byId: resEditing ? undefined : ME.id };
      if (window.DDSCloud && DDSCloud.enabled) {
        DDSCloud.fileUpload(resFile.raw, resFile.fileName).then(function (up) {
          meta.fileId = up.fileId; meta.fileData = null; finish(meta);
        }).catch(function (err) {
          save.disabled = false; save.textContent = 'Save resource';
          $('rf-err').textContent = (err && err.message) || 'Upload failed — try again.';
        });
      } else {
        // no cloud configured: keep the file inline on this device only
        meta.fileData = resFile.raw; meta.fileId = null; finish(meta);
      }
    } else if (resEditing && resFile) {                    // editing text, keeping existing file
      finish({ cat: cat, title: title, blurb: blurb });
    } else {
      $('rf-err').textContent = 'Choose a file to upload, or switch to Link.';
    }
  });

  /* --- folder toggle + row actions (delegated) --- */
  $('res-folders').addEventListener('click', function (e) {
    var tog = e.target.closest('[data-fold-toggle]');
    if (tog) {
      var id = tog.getAttribute('data-fold-toggle');
      openFolders[id] = !openFolders[id];
      var fold = tog.closest('.res-fold');
      fold.classList.toggle('open', openFolders[id]);
      tog.setAttribute('aria-expanded', String(!!openFolders[id]));
      return;
    }
    var fileLink = e.target.closest('[data-res-file]');
    if (fileLink) {
      e.preventDefault();
      openResFile(fileLink.getAttribute('data-res-file'), fileLink);
      return;
    }
    var edit = e.target.closest('[data-res-edit]');
    if (edit) {
      var rec = DDSResources.all().find(function (r) { return r.id === edit.getAttribute('data-res-edit'); });
      if (rec) openResModal(rec);
      return;
    }
    var del = e.target.closest('[data-res-del]');
    if (del) {
      var did = del.getAttribute('data-res-del');
      var doomed = DDSResources.all().find(function (r) { return r.id === did; });
      if (doomed && confirm('Remove "' + doomed.title + '" for everyone?')) {
        DDSResources.remove(did);
        renderResources();
      }
    }
  });

  /* Open an uploaded file — from the cloud (chunked) or the local fallback */
  function openResFile(id, anchor) {
    var rec = DDSResources.all().find(function (r) { return r.id === id; });
    if (!rec) return;
    var toBlobUrl = function (dataUrl) {
      try {
        var m = /^data:([^;,]+)?;base64,(.*)$/.exec(dataUrl);
        if (!m) return dataUrl;
        var bin = atob(m[2]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([arr], { type: m[1] || rec.mime || 'application/octet-stream' }));
      } catch (e) { return dataUrl; }
    };
    if (rec.fileData) { window.open(toBlobUrl(rec.fileData), '_blank', 'noopener'); return; }
    if (rec.fileId && window.DDSCloud) {
      var label = anchor && anchor.textContent;
      if (anchor) anchor.textContent = 'Opening…';
      DDSCloud.fileGet(rec.fileId).then(function (dataUrl) {
        if (anchor) anchor.innerHTML = FILE_SVG + esc(rec.title);
        window.open(toBlobUrl(dataUrl), '_blank', 'noopener');
      }).catch(function () {
        if (anchor) anchor.innerHTML = FILE_SVG + esc(rec.title);
        alert('That file isn’t available right now — it may still be uploading on another device.');
      });
    }
  }

  // Deep link from the homepage banner: ?folder=<catId> opens that folder
  (function openDeepFolder() {
    var m = /[?&]folder=([a-z]+)/i.exec(location.search);
    if (m && DDSResources.CATS.some(function (c) { return c.id === m[1]; })) openFolders[m[1]] = true;
  })();

  renderResources();

  /* ================= Log your hours =================
     Members self-log service / volunteer hours here. Entries live in the shared
     dds-hours-v1 store (synced across browsers via DDSCloud when Firebase is
     configured) and fold straight into the gauges, odometer and service log
     above — so what you log updates live, on top of whatever the exec board's
     sheet already shows. The chapter Google Sheet stays the official record and
     is one click away; set DDS_CLOUD.hourLogEndpoint to a Google Apps Script
     Web-App URL to ALSO push each entry into that sheet automatically. */
  var SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit';
  var HOUR_LOG_ENDPOINT = (window.DDS_CLOUD && DDS_CLOUD.hourLogEndpoint) || '';
  // service-type tags that autofill; each remembers whether it's dental or not
  var HOUR_SEEDS = [
    { name: 'Dental shadowing', kind: 'dental' },
    { name: 'SHAC dental clinic', kind: 'dental' },
    { name: 'Adams School of Dentistry event', kind: 'dental' },
    { name: 'Oral-health outreach', kind: 'dental' },
    { name: 'Give Kids A Smile', kind: 'dental' },
    { name: 'Community service', kind: 'nondental' },
    { name: 'Campus volunteering', kind: 'nondental' },
    { name: 'Fundraiser / philanthropy', kind: 'nondental' },
    { name: 'Tabling / recruitment', kind: 'nondental' },
    { name: 'Tutoring / mentoring', kind: 'nondental' }
  ];

  function readHours() { var a = readLS(HOURS_KEY, []); return Array.isArray(a) ? a : []; }
  function saveHours(list) { writeLS(HOURS_KEY, list); if (window.DDSCloud) DDSCloud.touch('hours'); }
  function myHours() {
    return readHours().filter(function (e) { return e && e.byId === ME.id; })
      .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || (b.at || 0) - (a.at || 0); });
  }
  function readCustomCats() { var a = readLS(HCATS_KEY, []); return Array.isArray(a) ? a : []; }
  function saveCustomCats(list) { writeLS(HCATS_KEY, list); }

  function loggedSums() {
    var d = 0, n = 0, c = 0;
    myHours().forEach(function (e) { var h = num(e.hours); if (e.kind === 'dental') d += h; else n += h; c++; });
    return { dental: d, non: n, count: c };
  }

  // every tag we know: seeds + sheet categories + created + already-used
  function allCats() {
    var map = {};
    var add = function (name, kind) {
      if (name == null) return; var key = String(name).toLowerCase().trim(); if (!key) return;
      if (!map[key]) map[key] = { name: String(name).trim(), kind: kind || 'nondental' };
      else if (kind) map[key].kind = kind;
    };
    HOUR_SEEDS.forEach(function (c) { add(c.name, c.kind); });
    if (DATA && DATA.svc) {
      (DATA.svc.dental || []).forEach(function (c) { add(c.name, 'dental'); });
      (DATA.svc.nondental || []).forEach(function (c) { add(c.name, 'nondental'); });
    }
    readCustomCats().forEach(function (c) { add(c.name, c.kind); });
    readHours().forEach(function (e) { if (e && e.byId === ME.id) add(e.cat, e.kind); });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function catKind(name) {
    var key = String(name || '').toLowerCase().trim();
    var hit = allCats().filter(function (c) { return c.name.toLowerCase() === key; })[0];
    return hit ? hit.kind : null;
  }

  // fold self-logged hours into a sheet-data object (returns a NEW object; never
  // mutates DATA). Called at the top of renderSheet, so the gauges/odometer/
  // service log all reflect logged hours the moment they change.
  function foldLogged(dRaw) {
    var base = dRaw || {}, sums = loggedSums();
    var d = {
      sheetFound: !!base.found,
      found: !!base.found || sums.count > 0,
      dental: num(base.dental) + sums.dental,
      nonDental: num(base.nonDental) + sums.non,
      meetingsN: num(base.meetingsN),
      total: (num(base.total) || 0) + sums.dental + sums.non,
      gpa: base.gpa, dues: base.dues, meetsReq: base.meetsReq,
      meetings: base.meetings || [],
      svc: {
        dental: (base.svc && base.svc.dental ? base.svc.dental.slice() : []),
        nondental: (base.svc && base.svc.nondental ? base.svc.nondental.slice() : [])
      },
      at: base.at || Date.now()
    };
    var merge = function (arr, name, hours) {
      var key = name.toLowerCase();
      for (var i = 0; i < arr.length; i++) if (String(arr[i].name).toLowerCase() === key) { arr[i] = { name: arr[i].name, hours: num(arr[i].hours) + hours, logged: true }; return; }
      arr.push({ name: name, hours: hours, logged: true });
    };
    myHours().forEach(function (e) {
      merge(e.kind === 'dental' ? d.svc.dental : d.svc.nondental, String(e.cat || 'Service').trim(), num(e.hours));
    });
    return d;
  }
  function blankData() {
    return { found: false, dental: 0, nonDental: 0, meetingsN: 0, total: 0, gpa: null, dues: null, meetsReq: null, meetings: [], svc: { dental: [], nondental: [] }, at: Date.now() };
  }
  function repaint() { renderSheet(DATA || blankData()); }

  (function initHourLog() {
    var cta = $('log-cta'), wrap = $('log-wrap'), form = $('log-form');
    if (!cta || !wrap || !form) return;
    var catIn = $('log-cat'), dl = $('log-cats'), hrsIn = $('log-hours'),
        dateIn = $('log-date'), noteIn = $('log-note'), list = $('log-list'),
        addBtn = $('log-add'), cancelBtn = $('log-cancel'), formTitle = $('log-form-title'),
        segBtns = Array.prototype.slice.call(form.querySelectorAll('.log-seg-btn'));
    var logKind = 'dental', editId = null;

    function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function setKind(k) { logKind = (k === 'dental') ? 'dental' : 'nondental'; segBtns.forEach(function (b) { var on = b.getAttribute('data-kind') === logKind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    function niceDate(s) { var d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }

    function fillDatalist() {
      dl.innerHTML = allCats().map(function (c) {
        return '<option value="' + esc(c.name) + '">' + (c.kind === 'dental' ? 'Dental' : 'Non-dental') + '</option>';
      }).join('');
    }
    function renderList() {
      var mine = myHours();
      var s = loggedSums(), tot = Math.round((s.dental + s.non) * 10) / 10;
      $('log-cta-sub').textContent = mine.length
        ? (mine.length + ' entr' + (mine.length === 1 ? 'y' : 'ies') + ' · ' + tot + ' hr' + (tot === 1 ? '' : 's') + ' logged')
        : 'Add service & volunteer hours yourself';
      if (!mine.length) { list.innerHTML = '<p class="log-empty">Nothing logged yet. Add your first service or volunteer hours above — they count toward your gauges right away.</p>'; return; }
      list.innerHTML = mine.map(function (e) {
        var h = Math.round(num(e.hours) * 10) / 10;
        return '<div class="log-row" data-id="' + esc(e.id) + '">' +
          '<div class="log-row-main"><span class="log-kind log-kind-' + (e.kind === 'dental' ? 'dental' : 'non') + '">' + (e.kind === 'dental' ? 'Dental' : 'Non-dental') + '</span>' +
          '<span class="log-row-cat">' + esc(e.cat) + '</span>' +
          (e.note ? '<span class="log-row-note">' + esc(e.note) + '</span>' : '') + '</div>' +
          '<div class="log-row-side"><span class="log-row-hrs">' + h + ' hr' + (h === 1 ? '' : 's') + '</span>' +
          '<span class="log-row-date">' + esc(niceDate(e.date)) + '</span>' +
          '<button type="button" class="log-mini" data-log-edit="' + esc(e.id) + '">Edit</button>' +
          '<button type="button" class="log-mini log-del" data-log-del="' + esc(e.id) + '">Delete</button></div>' +
          '</div>';
      }).join('');
    }
    function refresh() { fillDatalist(); renderList(); }

    function resetForm() {
      editId = null; form.reset(); dateIn.value = today(); setKind('dental');
      addBtn.textContent = 'Add hours'; if (formTitle) formTitle.textContent = 'Log an activity';
      if (cancelBtn) cancelBtn.hidden = true;
    }
    function loadForEdit(id) {
      var e = readHours().filter(function (r) { return r.id === id; })[0]; if (!e) return;
      editId = id; catIn.value = e.cat || ''; hrsIn.value = e.hours; dateIn.value = e.date || today();
      noteIn.value = e.note || ''; setKind(e.kind);
      addBtn.textContent = 'Save changes'; if (formTitle) formTitle.textContent = 'Edit this entry';
      if (cancelBtn) cancelBtn.hidden = false;
      catIn.focus();
    }

    function rememberCat(name, kind) {
      var key = String(name).toLowerCase().trim();
      var known = allCats().some(function (c) { return c.name.toLowerCase() === key; });
      if (known) return;
      var custom = readCustomCats(); custom.push({ name: String(name).trim(), kind: kind }); saveCustomCats(custom);
    }
    function pushToSheet(entry) {
      if (!HOUR_LOG_ENDPOINT) return;
      try {
        fetch(HOUR_LOG_ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ name: ME.name, email: ME.email, category: entry.cat, kind: entry.kind, hours: entry.hours, date: entry.date, note: entry.note }) });
      } catch (err) { /* best-effort; site store stays source of truth */ }
    }

    // autofill: choosing a known tag sets its service type for you
    catIn.addEventListener('change', function () { var k = catKind(catIn.value); if (k) setKind(k); });
    catIn.addEventListener('input', function () { var k = catKind(catIn.value); if (k) setKind(k); });
    segBtns.forEach(function (b) { b.addEventListener('click', function () { setKind(b.getAttribute('data-kind')); }); });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cat = catIn.value.trim(), hours = Math.round(num(hrsIn.value) * 100) / 100, date = dateIn.value || today();
      if (!cat) { catIn.focus(); return; }
      if (!(hours > 0)) { hrsIn.focus(); return; }
      var note = noteIn.value.trim();
      var list0 = readHours();
      if (editId) {
        for (var i = 0; i < list0.length; i++) if (list0[i].id === editId) {
          list0[i].cat = cat; list0[i].kind = logKind; list0[i].hours = hours; list0[i].date = date; list0[i].note = note; list0[i].up = Date.now();
        }
      } else {
        var entry = { id: uid(), byId: ME.id, by: ME.name, cat: cat, kind: logKind, hours: hours, date: date, note: note, at: Date.now(), up: Date.now() };
        list0.push(entry); pushToSheet(entry);
      }
      rememberCat(cat, logKind);
      saveHours(list0); resetForm(); refresh(); repaint();
    });

    list.addEventListener('click', function (ev) {
      var ed = ev.target.closest('[data-log-edit]'), de = ev.target.closest('[data-log-del]');
      if (ed) { loadForEdit(ed.getAttribute('data-log-edit')); }
      else if (de) {
        var id = de.getAttribute('data-log-del');
        if (!confirm('Delete this logged entry?')) return;
        var list0 = readHours().filter(function (r) { return r.id !== id; });
        saveHours(list0); if (window.DDSCloud) DDSCloud.tombstone('hours', id);
        if (editId === id) resetForm();
        refresh(); repaint();
      }
    });
    if (cancelBtn) cancelBtn.addEventListener('click', resetForm);

    function openLog(scroll) {
      wrap.classList.add('open'); cta.setAttribute('aria-expanded', 'true');
      if (scroll) setTimeout(function () { cta.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); }, 60);
    }
    function toggleLog() { if (wrap.classList.contains('open')) { wrap.classList.remove('open'); cta.setAttribute('aria-expanded', 'false'); } else openLog(false); }
    cta.addEventListener('click', toggleLog);

    resetForm(); refresh(); repaint();
    // expose so cross-tab / cloud updates can refresh the list
    window.__ddsHourRefresh = refresh;

    // deep-link: point-submission buttons land here (?log=1 / ?submit=member|rushee / #log)
    var qs = new URLSearchParams(location.search);
    if (qs.has('log') || qs.has('submit') || location.hash === '#log') openLog(true);
  })();

  /* ================= Cross-tab / cloud sync ================= */
  window.addEventListener('storage', function (e) {
    if (e.key === HOURS_KEY) { if (window.__ddsHourRefresh) window.__ddsHourRefresh(); repaint(); }
    else if (e.key === MSG_KEY) { renderChat(false); renderRail(); }
    else if (e.key === CHAN_KEY) { renderRail(); }
    else if (e.key === 'dds-members-v1') { renderMembers(); renderChat(false); renderRail(); }
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

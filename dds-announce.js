/* DDS announcements overlay — surfaces exec posts from the chat's built-in
   Announcements channel (id seed-announce in the dds-chat-v2 store) as
   dismissible cards pinned to the bottom-right of EVERY page. A post shows
   for at most 3 days from when it was sent, and an X hides it on this
   browser for good (dismissed ids live in dds-announce-read-v1).

   Off the dashboard the cloud engine doesn't poll chat, so this file asks
   DDSCloud to pull the message store directly — once on load, then every
   5 minutes while the tab is visible. Cross-tab and cloud updates arrive
   through the same synthetic storage events the rest of the site uses. */
(function () {
  'use strict';

  var MSG_KEY = 'dds-chat-v2';
  var CHANNEL = 'seed-announce';
  var READ_KEY = 'dds-announce-read-v1';
  var TTL = 3 * 864e5;        // 3 days
  var MAX_SHOWN = 4;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function readJSON(key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function dismissed() { var l = readJSON(READ_KEY, []); return Array.isArray(l) ? l : []; }
  function dismiss(id) {
    var l = dismissed();
    if (l.indexOf(id) < 0) l.push(id);
    try { localStorage.setItem(READ_KEY, JSON.stringify(l.slice(-200))); } catch (e) {}
  }

  /* @[Name|id] mention tokens read as plain @Name out here. */
  function plainText(t) { return String(t || '').replace(/@\[([^\|\]]+)\|[^\]]+\]/g, '@$1'); }

  function ago(t) {
    var s = Math.max(0, Date.now() - t);
    if (s < 3600e3) return Math.max(1, Math.round(s / 60e3)) + 'm ago';
    if (s < 864e5) return Math.round(s / 3600e3) + 'h ago';
    return s < 2 * 864e5 ? 'Yesterday' : Math.round(s / 864e5) + ' days ago';
  }

  function live() {
    var cut = Date.now() - TTL, seen = dismissed();
    return (readJSON(MSG_KEY, []) || []).filter(function (m) {
      return m && m.ch === CHANNEL && (m.at || 0) >= cut && seen.indexOf(m.id) < 0;
    }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).slice(0, MAX_SHOWN);
  }

  var css =
    '#dds-announce{position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;flex-direction:column;gap:10px;width:min(340px,calc(100vw - 28px));font-family:"Montserrat",system-ui,sans-serif;}' +
    '.ddsa-card{position:relative;background:rgba(10,21,39,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(185,151,91,.45);border-radius:18px;padding:14px 38px 14px 16px;box-shadow:0 22px 50px -18px rgba(0,0,0,.75);color:#EAF1F8;animation:ddsa-in .45s cubic-bezier(.21,1.02,.55,1) both;}' +
    '.ddsa-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:#E3C27C;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}' +
    '.ddsa-head svg{flex:none;}' +
    '.ddsa-head time{color:#7d92ab;font-weight:600;letter-spacing:.8px;text-transform:none;margin-left:auto;}' +
    '.ddsa-txt{margin:0;font-size:13px;line-height:1.55;color:#D7E2EA;overflow-wrap:break-word;white-space:pre-wrap;}' +
    '.ddsa-img{display:block;width:100%;max-height:150px;object-fit:cover;border-radius:10px;margin-top:9px;border:1px solid rgba(185,151,91,.3);}' +
    '.ddsa-by{margin-top:7px;color:#7d92ab;font-size:10.5px;letter-spacing:.5px;}' +
    '.ddsa-x{position:absolute;top:9px;right:9px;width:24px;height:24px;border-radius:50%;border:1px solid rgba(185,151,91,.4);background:rgba(185,151,91,.12);color:#E3C27C;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .18s,transform .18s;}' +
    '.ddsa-x:hover{background:rgba(185,151,91,.3);transform:scale(1.08);}' +
    '@keyframes ddsa-in{from{opacity:0;transform:translateX(28px);}to{opacity:1;transform:none;}}' +
    '@media (prefers-reduced-motion:reduce){.ddsa-card{animation:none;}}';

  var host = null;
  function ensureHost() {
    if (host) return host;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    host = document.createElement('div');
    host.id = 'dds-announce';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Chapter announcements');
    host.setAttribute('data-ce-skip', '');   // keep the exec inline editor out of live cards
    document.body.appendChild(host);
    host.addEventListener('click', function (e) {
      var x = e.target.closest('[data-ax]');
      if (!x) return;
      dismiss(x.getAttribute('data-ax'));
      render();
    });
    return host;
  }

  var MEGA = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>';

  function render() {
    var list = live();
    if (!list.length) { if (host) host.innerHTML = ''; return; }
    ensureHost().innerHTML = list.map(function (m) {
      return '<div class="ddsa-card">' +
        '<div class="ddsa-head">' + MEGA + 'Announcement<time>' + esc(ago(m.at)) + '</time></div>' +
        (m.text ? '<p class="ddsa-txt">' + esc(plainText(m.text)) + '</p>' : '') +
        (m.img ? '<img class="ddsa-img" src="' + esc(m.img) + '" alt="Announcement photo" loading="lazy">' : '') +
        '<div class="ddsa-by">— ' + esc(m.by || 'Exec Board') + '</div>' +
        '<button class="ddsa-x" type="button" data-ax="' + esc(m.id) + '" aria-label="Dismiss announcement">&#10005;</button>' +
        '</div>';
    }).join('');
  }

  function boot() {
    render();
    // live updates: cloud sync + other tabs both land here
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key === MSG_KEY || e.key === READ_KEY) render();
    });
    // let running cards expire on time
    setInterval(render, 60000);
    // off-dashboard pages never poll chat on their own — pull it here
    var onDash = !!document.getElementById('chat-log');
    if (!onDash && window.DDSCloud && DDSCloud.enabled) {
      var pull = function () {
        if (document.visibilityState !== 'visible') return;
        DDSCloud.pullNow(['chatMsgs']).then(render, function () {});
      };
      DDSCloud.ready.then(pull);
      setInterval(pull, 300000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') pull();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

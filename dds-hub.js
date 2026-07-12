/* DDS chapter hub — the circular bubble pinned to the bottom-right of every
   page (just above the exec "Edit page" button) that expands into a glass
   panel: exec announcements, new posts on The Bite, new meeting notes in
   The Archive, and a mini messenger over the same dds-chat-v2 store the
   dashboard chat uses. Desktop + signed-in members only.

   Unread tracking lives in dds-hub-read-v1 as last-seen timestamps — one
   per section plus one per conversation. First boot marks everything read
   so a new browser doesn't open to a wall of stale badges; anything that
   arrives after that counts until its tab (or conversation) is viewed.
   Opening the bubble lands on whichever tab holds the most unread; ties
   and all-clear fall to the leftmost. Announcements / posts / notes carry
   the cloud's `up` stamp when synced, so cross-browser arrivals badge too.

   Off the dashboard the cloud engine never polls chat, so this file pulls
   chatMsgs + chatMeta itself — once on load, then every 5 minutes while
   visible (posts + minutes stores already sync on every page). */
(function () {
  'use strict';

  var MSG_KEY = 'dds-chat-v2';
  var CHAN_KEY = 'dds-chat-meta-v1';
  var NEWS_KEY = 'dds-newsletter-v1';
  var MIN_KEY = 'dds-minutes-v1';
  var MEM_KEY = 'dds-members-v1';
  var STATE_KEY = 'dds-hub-read-v1';
  var ANN_CH = 'seed-announce';
  var TABS = ['ann', 'blog', 'notes', 'dm'];   // left → right
  var TITLES = { ann: 'Announcements', blog: 'The Bite — Blog', notes: 'Meeting Notes', dm: 'Messages' };
  var LIST_MAX = 20;

  var ME = null;
  var host = null, open = false, activeTab = 'ann';
  var msub = 'list', curCh = null;             // messenger sub-view state
  var VC = { ann: 0, blog: 0, notes: 0, ch: {} }; // cutoffs frozen at view-open (drives .unread styling)

  /* ------------------------------ utils ------------------------------ */
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function readJSON(key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function plainText(t) { return String(t || '').replace(/@\[([^\|\]]+)\|[^\]]+\]/g, '@$1'); }
  function ago(t) {
    var s = Math.max(0, Date.now() - (t || 0));
    if (s < 60e3) return 'now';
    if (s < 3600e3) return Math.round(s / 60e3) + 'm';
    if (s < 864e5) return Math.round(s / 3600e3) + 'h';
    if (s < 7 * 864e5) return Math.round(s / 864e5) + 'd';
    return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtD(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return MONTHS[(+p[1] || 1) - 1] + ' ' + (+p[2] || 1);
  }
  function fmtTime(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  /* Posts and notes carry an ISO day, plus the cloud's `up` ms once synced. */
  function itemTs(r) {
    if (r && r.up) return r.up;
    var t = Date.parse(String((r && r.date) || '').slice(0, 10) + 'T12:00:00');
    return isNaN(t) ? 0 : t;
  }
  function stripMd(s, max) {
    var ln = String(s || '').replace(/\r\n?/g, '\n').split('\n').filter(function (x) {
      x = x.trim(); return x && !/^#{1,3}\s/.test(x) && !/^---+$/.test(x);
    })[0] || '';
    ln = ln.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/==(?:(?:yellow|gold|blue|green|pink):)?([^=]+)==/g, '$1')
      .replace(/(\*\*|__|~~|\*)/g, '');
    if (max && ln.length > max) ln = ln.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return ln;
  }

  /* --------------------------- read state ---------------------------- */
  function stGet() {
    var st = readJSON(STATE_KEY, null);
    if (!st || !st.boot) {
      var now = Date.now();
      st = { boot: now, ann: now, blog: now, notes: now, dm: {} };
      stSave(st);
    }
    if (!st.dm) st.dm = {};
    return st;
  }
  function stSave(st) { try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch (e) {} }

  /* ---------------------------- data reads --------------------------- */
  function msgs() { var l = readJSON(MSG_KEY, []); return Array.isArray(l) ? l : []; }
  function annItems() {
    return msgs().filter(function (m) { return m && m.ch === ANN_CH; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }
  function blogItems() {
    if (window.DDSNews) return DDSNews.all();
    var l = readJSON(NEWS_KEY, []);
    return (Array.isArray(l) ? l : []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function noteItems() {
    if (window.DDSMinutes) return DDSMinutes.all();
    var l = readJSON(MIN_KEY, []);
    return (Array.isArray(l) ? l : []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function prof(id) {
    try { return (window.DDSAuth && DDSAuth.profile(id)) || null; } catch (e) { return null; }
  }
  /* channels I can see, announcements excluded (they have their own tab) */
  function myChans() {
    var stored = readJSON(CHAN_KEY, []);
    var mine = (Array.isArray(stored) ? stored : []).filter(function (c) {
      if (!c || !c.id) return false;
      if (c.kind === 'dm') return (c.members || []).indexOf(ME.id) > -1;
      return c.members == null || c.members.indexOf(ME.id) > -1;
    });
    return [{ id: 'seed-general', kind: 'channel', name: 'General', members: null }].concat(mine);
  }
  function chanById(id) {
    return myChans().filter(function (c) { return c.id === id; })[0] || null;
  }
  function chanLabel(c) {
    if (c.kind === 'dm') {
      var o = (c.members || []).filter(function (x) { return x !== ME.id; })[0];
      var p = prof(o);
      return p ? p.name : 'Direct message';
    }
    return c.name || 'Channel';
  }
  function chanOther(c) {
    if (c.kind !== 'dm') return null;
    return (c.members || []).filter(function (x) { return x !== ME.id; })[0] || null;
  }
  function lastMsg(chId) {
    var last = null;
    msgs().forEach(function (m) { if (m.ch === chId && (!last || (m.at || 0) > (last.at || 0))) last = m; });
    return last;
  }
  function chanUnread(chId, st) {
    var cut = st.dm[chId] || st.boot, n = 0;
    msgs().forEach(function (m) {
      if (m.ch === chId && m.byId !== ME.id && (m.at || 0) > cut) n++;
    });
    return n;
  }

  /* per-section unread counts — the badge numbers */
  function counts() {
    var st = stGet();
    var c = { ann: 0, blog: 0, notes: 0, dm: 0 };
    annItems().forEach(function (m) { if (m.byId !== ME.id && (m.at || 0) > st.ann) c.ann++; });
    blogItems().forEach(function (p) { if (p.authorId !== ME.id && itemTs(p) > st.blog) c.blog++; });
    noteItems().forEach(function (n) { if (n.authorId !== ME.id && itemTs(n) > st.notes) c.notes++; });
    myChans().forEach(function (ch) { c.dm += chanUnread(ch.id, st); });
    return c;
  }
  /* most unread wins; ties and all-zero fall to the leftmost tab */
  function defaultTab(c) {
    var best = TABS[0], max = 0;
    TABS.forEach(function (k) { if (c[k] > max) { max = c[k]; best = k; } });
    return best;
  }

  /* ------------------------------- css ------------------------------- */
  var css =
    '#dds-hub{position:fixed;right:18px;bottom:76px;z-index:100000;display:flex;flex-direction:column;align-items:flex-end;gap:14px;font-family:"Montserrat",system-ui,sans-serif;}' +
    '@media (max-width:899px),(hover:none){#dds-hub{display:none !important;}}' +
    '#dds-announce{transition:opacity .35s ease,transform .35s ease;}' +
    'html.dds-hub-open #dds-announce{opacity:0;transform:translateX(20px);pointer-events:none;}' +

    /* --- the bubble --- */
    '.hub-fab{position:relative;width:54px;height:54px;border-radius:50%;border:1px solid rgba(185,151,91,.55);cursor:pointer;background:linear-gradient(145deg,#17325e,#0A1A30);color:#E3C27C;box-shadow:0 18px 40px -14px rgba(0,0,0,.8);transition:transform .28s cubic-bezier(.34,1.56,.64,1),box-shadow .3s,border-color .3s;}' +
    '.hub-fab:hover{transform:translateY(-2px) scale(1.05);border-color:rgba(227,194,124,.9);box-shadow:0 22px 46px -14px rgba(0,0,0,.85),0 0 26px -6px rgba(185,151,91,.55);}' +
    '.hub-fab:active{transform:scale(.93);}' +
    '.hub-fic{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:opacity .26s ease,transform .4s cubic-bezier(.34,1.4,.64,1);}' +
    '.hub-fic svg{width:22px;height:22px;}' +
    '.hub-fic-x{opacity:0;transform:rotate(-90deg) scale(.4);}' +
    'html.dds-hub-open .hub-fic-bell{opacity:0;transform:rotate(90deg) scale(.4);}' +
    'html.dds-hub-open .hub-fic-x{opacity:1;transform:none;}' +
    '.hub-fab.has-new .hub-fic-bell svg{transform-origin:top center;animation:hubring 5s ease-in-out infinite;}' +
    '@keyframes hubring{0%,12%,100%{transform:rotate(0)}2%{transform:rotate(13deg)}5%{transform:rotate(-11deg)}8%{transform:rotate(7deg)}10%{transform:rotate(-4deg)}}' +

    /* --- red count badges --- */
    '.hub-dot{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:linear-gradient(160deg,#E25D5D,#C43737);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #0A1A30;box-shadow:0 4px 12px -2px rgba(196,55,55,.65);animation:hubpop .45s cubic-bezier(.34,1.56,.64,1);}' +
    '.hub-dot[hidden]{display:none;}' +
    '@keyframes hubpop{from{transform:scale(.2);opacity:0;}}' +

    /* --- the panel: quarter width × half height, above the bubble --- */
    '.hub-panel{width:clamp(330px,25vw,520px);height:max(400px,50vh);max-height:calc(100vh - 180px);display:flex;flex-direction:column;background:rgba(9,19,37,.9);-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);border:1px solid rgba(75,156,211,.28);border-radius:24px;box-shadow:0 34px 80px -20px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.06);overflow:hidden;opacity:0;transform:translateY(18px) scale(.92);transform-origin:100% 100%;pointer-events:none;transition:opacity .3s ease,transform .44s cubic-bezier(.22,1.2,.36,1);}' +
    'html.dds-hub-open .hub-panel{opacity:1;transform:none;pointer-events:auto;}' +

    '.hub-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px 11px;border-bottom:1px solid rgba(75,156,211,.16);flex:none;}' +
    '.hub-eyebrow{display:block;font-size:8.5px;font-weight:800;letter-spacing:2.6px;color:#B9975B;text-transform:uppercase;margin-bottom:2px;}' +
    '.hub-title{font-size:15px;font-weight:700;color:#EAF1F8;letter-spacing:.3px;}' +
    '.hub-hbtn{display:inline-flex;align-items:center;gap:5px;background:rgba(75,156,211,.12);border:1px solid rgba(75,156,211,.35);border-radius:999px;color:#9FC6EC;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 11px;cursor:pointer;transition:background .2s,transform .2s;}' +
    '.hub-hbtn:hover{background:rgba(75,156,211,.24);transform:translateY(-1px);}' +
    '.hub-hbtn svg{width:11px;height:11px;}' +
    '.hub-hbtn[hidden]{display:none;}' +
    '.hub-x{width:28px;height:28px;padding:0;justify-content:center;border-radius:50%;border-color:rgba(185,151,91,.4);background:rgba(185,151,91,.1);color:#E3C27C;}' +
    '.hub-x:hover{background:rgba(185,151,91,.28);}' +

    /* --- stacked tab views --- */
    '.hub-views{position:relative;flex:1;min-height:0;}' +
    '.hub-view{position:absolute;inset:0;display:flex;flex-direction:column;opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .28s ease,transform .34s ease;}' +
    '.hub-view.on{opacity:1;transform:none;pointer-events:auto;}' +
    '.hub-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 12px 14px;scrollbar-width:thin;scrollbar-color:rgba(75,156,211,.4) transparent;}' +
    '.hub-scroll::-webkit-scrollbar{width:8px;}' +
    '.hub-scroll::-webkit-scrollbar-thumb{background:rgba(75,156,211,.35);border-radius:99px;border:2px solid transparent;background-clip:content-box;}' +
    '.hub-empty{margin:auto;text-align:center;color:#7d92ab;font-size:12px;line-height:1.6;padding:26px 30px;}' +
    '.hub-empty svg{width:26px;height:26px;display:block;margin:0 auto 10px;opacity:.55;}' +

    /* --- shared list card --- */
    '#dds-hub a{text-decoration:none;}' +
    '.hub-item{position:relative;display:flex;gap:11px;align-items:flex-start;width:100%;text-align:left;background:rgba(19,41,75,.32);border:1px solid rgba(75,156,211,.14);border-radius:14px;padding:11px 12px;margin-bottom:9px;color:#D7E2EA;font-family:inherit;transition:background .22s,border-color .22s,transform .22s;}' +
    'button.hub-item,a.hub-item{cursor:pointer;}' +
    'button.hub-item:hover,a.hub-item:hover{background:rgba(31,60,102,.5);border-color:rgba(75,156,211,.4);transform:translateX(3px);}' +
    '.hub-item.unread{border-color:rgba(185,151,91,.5);background:rgba(185,151,91,.08);}' +
    '.hub-item.unread::before{content:"";position:absolute;left:-1px;top:11px;bottom:11px;width:3px;border-radius:3px;background:linear-gradient(#E3C27C,#B9975B);}' +
    '.hub-icol{flex:1;min-width:0;}' +
    '.hub-ittl{display:block;font-size:12.5px;font-weight:700;color:#EAF1F8;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}' +
    '.hub-itmeta{display:block;font-size:10px;color:#7d92ab;letter-spacing:.4px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.hub-itex{display:block;font-size:11px;color:#9FB6CE;line-height:1.5;margin-top:5px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}' +
    '.hub-thumb{flex:none;width:46px;height:46px;border-radius:10px;object-fit:cover;border:1px solid rgba(75,156,211,.25);}' +
    '.hub-stamp{flex:none;width:42px;border-radius:10px;background:rgba(19,41,75,.7);border:1px solid rgba(185,151,91,.3);text-align:center;padding:6px 0 7px;color:#E3C27C;}' +
    '.hub-stamp b{display:block;font-size:15px;line-height:1.1;}' +
    '.hub-stamp span{display:block;font-size:8px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;margin-top:1px;color:#B9975B;}' +

    /* --- announcements --- */
    '.hub-ann{flex-direction:column;gap:0;cursor:default;}' +
    '.hub-annhead{display:flex;align-items:center;gap:7px;width:100%;color:#E3C27C;font-size:9.5px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;}' +
    '.hub-annhead svg{width:12px;height:12px;flex:none;}' +
    '.hub-annhead time{margin-left:auto;color:#7d92ab;font-weight:600;letter-spacing:.6px;text-transform:none;}' +
    '.hub-anntxt{margin:7px 0 0;font-size:12px;line-height:1.55;color:#D7E2EA;white-space:pre-wrap;overflow-wrap:break-word;width:100%;}' +
    '.hub-annimg{display:block;width:100%;max-height:140px;object-fit:cover;border-radius:10px;margin-top:8px;border:1px solid rgba(185,151,91,.3);}' +
    '.hub-annby{margin-top:6px;font-size:10px;color:#7d92ab;width:100%;}' +

    /* --- messenger --- */
    /* pointer-events must ALSO gate on the parent view being active — the dm
       view is last in DOM order, so an always-interactive child would sit
       invisibly over the other three tabs and eat their clicks and wheels */
    '.hubm{position:absolute;inset:0;display:flex;flex-direction:column;opacity:0;transform:translateX(16px);pointer-events:none;transition:opacity .26s ease,transform .3s ease;}' +
    '.hubm.on{opacity:1;transform:none;}' +
    '.hub-view.on .hubm.on{pointer-events:auto;}' +
    '.hub-av{flex:none;width:34px;height:34px;border-radius:50%;background:linear-gradient(145deg,#1d3a68,#13294B);border:1px solid rgba(75,156,211,.4);color:#9FC6EC;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:hidden;}' +
    '.hub-av img{width:100%;height:100%;object-fit:cover;}' +
    '.hub-cright{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px;}' +
    '.hub-cright time{font-size:9.5px;color:#7d92ab;}' +
    '.hub-cright .hub-dot{position:static;border-color:transparent;}' +
    '.hubm-thead{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(75,156,211,.16);}' +
    '.hubm-back{flex:none;width:28px;height:28px;border-radius:50%;border:1px solid rgba(75,156,211,.35);background:rgba(75,156,211,.1);color:#9FC6EC;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .2s;}' +
    '.hubm-back:hover{background:rgba(75,156,211,.25);transform:translateX(-2px);}' +
    '.hubm-back svg{width:14px;height:14px;}' +
    '.hubm-tmeta{min-width:0;}' +
    '.hubm-tmeta b{display:block;font-size:13px;color:#EAF1F8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.hubm-tmeta span{display:block;font-size:9.5px;color:#7d92ab;letter-spacing:.5px;}' +
    '.hubm-log{display:flex;flex-direction:column;gap:2px;}' +
    '.hub-day{align-self:center;font-size:9px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#7d92ab;margin:10px 0 6px;}' +
    '.hbm{display:flex;gap:8px;align-items:flex-end;margin-top:6px;max-width:86%;animation:hubmsg .3s ease both;}' +
    '@keyframes hubmsg{from{opacity:0;transform:translateY(6px);}}' +
    '.hbm .hub-av{width:26px;height:26px;font-size:11px;}' +
    '.hbm-bubble{background:rgba(31,60,102,.55);border:1px solid rgba(75,156,211,.22);border-radius:14px 14px 14px 4px;padding:8px 11px;font-size:12px;line-height:1.5;color:#EAF1F8;overflow-wrap:break-word;min-width:0;white-space:pre-wrap;}' +
    '.hbm-bubble img{display:block;max-width:100%;border-radius:8px;margin-top:6px;}' +
    '.hbm-meta{display:block;font-size:9px;color:#7d92ab;margin-top:3px;}' +
    '.hbm.mine{align-self:flex-end;flex-direction:row-reverse;}' +
    '.hbm.mine .hbm-bubble{background:rgba(185,151,91,.2);border-color:rgba(185,151,91,.4);border-radius:14px 14px 4px 14px;}' +
    '.hbm.mine .hbm-meta{text-align:right;}' +
    '.hubm-compose{flex:none;display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid rgba(75,156,211,.16);}' +
    '.hubm-compose input{flex:1;min-width:0;background:rgba(6,14,29,.85);border:1px solid rgba(75,156,211,.35);border-radius:999px;color:#EAF1F8;font-family:inherit;font-size:12px;padding:10px 15px;outline:none;transition:border-color .2s,box-shadow .2s;}' +
    '.hubm-compose input:focus{border-color:rgba(227,194,124,.7);box-shadow:0 0 0 3px rgba(185,151,91,.15);}' +
    '.hubm-compose input::placeholder{color:#5f7591;}' +
    '.hubm-send{flex:none;width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;background:linear-gradient(135deg,#B9975B,#a07f3f);color:#1a1205;display:flex;align-items:center;justify-content:center;transition:transform .22s cubic-bezier(.34,1.56,.64,1),filter .2s;}' +
    '.hubm-send:hover{transform:scale(1.08);filter:brightness(1.08);}' +
    '.hubm-send:active{transform:scale(.92);}' +
    '.hubm-send svg{width:15px;height:15px;}' +
    '.hubm-search{flex:none;position:relative;padding:12px 12px 2px;}' +
    '.hubm-search svg{position:absolute;left:24px;top:23px;width:13px;height:13px;color:#5f7591;pointer-events:none;}' +
    '.hubm-search input{width:100%;background:rgba(6,14,29,.85);border:1px solid rgba(75,156,211,.35);border-radius:999px;color:#EAF1F8;font-family:inherit;font-size:12px;padding:9px 14px 9px 32px;outline:none;}' +
    '.hubm-search input:focus{border-color:rgba(227,194,124,.7);}' +

    /* --- bottom tab bar --- */
    '.hub-tabs{position:relative;flex:none;display:flex;border-top:1px solid rgba(75,156,211,.16);background:rgba(5,11,22,.6);}' +
    '.hub-ind{position:absolute;top:-1px;left:0;width:25%;height:2px;background:linear-gradient(90deg,transparent,#E3C27C 30%,#E3C27C 70%,transparent);transition:transform .4s cubic-bezier(.22,1.2,.36,1);}' +
    '.hub-tab{position:relative;flex:1;background:none;border:0;cursor:pointer;padding:10px 2px 11px;display:flex;flex-direction:column;align-items:center;gap:4px;color:#7d92ab;font-family:inherit;transition:color .25s;}' +
    '.hub-tab svg{width:18px;height:18px;transition:transform .32s cubic-bezier(.34,1.56,.64,1);}' +
    '.hub-tab:hover{color:#B9CBDE;}' +
    '.hub-tab.on{color:#E3C27C;}' +
    '.hub-tab.on svg{transform:translateY(-1px) scale(1.1);}' +
    '.hub-tlbl{font-size:8px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;}' +
    '.hub-tab .hub-dot{top:4px;right:calc(50% - 24px);border-color:#0b1729;}' +

    '@media (prefers-reduced-motion:reduce){#dds-hub *,#dds-hub{transition:none !important;animation:none !important;}}';

  /* ------------------------------ icons ------------------------------ */
  function ic(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }
  var I = {
    bell: ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    x: ic('<path d="M18 6 6 18M6 6l12 12"/>'),
    mega: ic('<path d="m3 11 18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
    news: ic('<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2V6"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>'),
    doc: ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'),
    chat: ic('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z"/>'),
    send: ic('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
    back: ic('<path d="m15 18-6-6 6-6"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    search: ic('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')
  };

  /* ------------------------------- dom ------------------------------- */
  function q(sel) { return host.querySelector(sel); }
  function avHtml(p, name) {
    return '<span class="hub-av">' + (p && p.photo
      ? '<img src="' + esc(p.photo) + '" alt="">'
      : esc(String(name || (p && p.name) || '?').trim().charAt(0).toUpperCase() || '?')) + '</span>';
  }
  function dotHtml(n) {
    return '<span class="hub-dot"' + (n > 0 ? '' : ' hidden') + '>' + (n > 99 ? '99+' : n) + '</span>';
  }
  function build() {
    if (host) return;
    var style = document.createElement('style');
    style.id = 'dds-hub-style';
    style.textContent = css;
    document.head.appendChild(style);

    host = document.createElement('div');
    host.id = 'dds-hub';
    host.setAttribute('data-ce-skip', '');    // keep the exec inline editor out
    host.innerHTML =
      '<div class="hub-panel" role="dialog" aria-label="Chapter hub">' +
        '<div class="hub-head">' +
          '<div><span class="hub-eyebrow">UNC DDS</span><span class="hub-title" data-hub-title>Announcements</span></div>' +
          '<div style="display:flex;gap:7px;align-items:center;">' +
            '<button type="button" class="hub-hbtn" data-hub-new hidden>' + I.plus + 'New</button>' +
            '<button type="button" class="hub-hbtn hub-x" data-hub-close aria-label="Close">' + I.x + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="hub-views">' +
          '<section class="hub-view" data-view="ann"><div class="hub-scroll" data-list="ann"></div></section>' +
          '<section class="hub-view" data-view="blog"><div class="hub-scroll" data-list="blog"></div></section>' +
          '<section class="hub-view" data-view="notes"><div class="hub-scroll" data-list="notes"></div></section>' +
          '<section class="hub-view" data-view="dm">' +
            '<div class="hubm hubm-list on"><div class="hub-scroll" data-list="convos"></div></div>' +
            '<div class="hubm hubm-thread">' +
              '<div class="hubm-thead">' +
                '<button type="button" class="hubm-back" data-hub-back aria-label="Back to conversations">' + I.back + '</button>' +
                '<span data-th-av></span>' +
                '<div class="hubm-tmeta"><b data-th-name></b><span data-th-sub></span></div>' +
              '</div>' +
              '<div class="hub-scroll hubm-log" data-list="thread"></div>' +
              '<form class="hubm-compose" data-hub-compose>' +
                '<input type="text" maxlength="1000" placeholder="Message…" aria-label="Message" autocomplete="off">' +
                '<button type="submit" class="hubm-send" aria-label="Send">' + I.send + '</button>' +
              '</form>' +
            '</div>' +
            '<div class="hubm hubm-picker">' +
              '<div class="hubm-search">' + I.search + '<input type="text" placeholder="Search members…" data-hub-search autocomplete="off"></div>' +
              '<div class="hub-scroll" data-list="roster"></div>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<div class="hub-tabs" role="tablist">' +
          '<span class="hub-ind"></span>' +
          '<button type="button" class="hub-tab on" role="tab" data-tab="ann" aria-label="Exec announcements">' + I.mega + '<span class="hub-tlbl">Exec</span>' + dotHtml(0) + '</button>' +
          '<button type="button" class="hub-tab" role="tab" data-tab="blog" aria-label="The Bite blog">' + I.news + '<span class="hub-tlbl">The Bite</span>' + dotHtml(0) + '</button>' +
          '<button type="button" class="hub-tab" role="tab" data-tab="notes" aria-label="Meeting notes">' + I.doc + '<span class="hub-tlbl">Notes</span>' + dotHtml(0) + '</button>' +
          '<button type="button" class="hub-tab" role="tab" data-tab="dm" aria-label="Messages">' + I.chat + '<span class="hub-tlbl">Messages</span>' + dotHtml(0) + '</button>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="hub-fab" aria-label="Open the chapter hub" aria-expanded="false">' +
        '<span class="hub-fic hub-fic-bell">' + I.bell + '</span>' +
        '<span class="hub-fic hub-fic-x">' + I.x + '</span>' +
        dotHtml(0).replace('hub-dot', 'hub-dot hub-fdot') +
      '</button>';
    document.body.appendChild(host);
    wire();
    renderBadges();
  }
  function destroy() {
    if (!host) return;
    host.remove(); host = null;
    document.documentElement.classList.remove('dds-hub-open');
    open = false;
  }

  /* ----------------------------- renders ----------------------------- */
  function empty(icon, text) {
    return '<div class="hub-empty">' + icon + text + '</div>';
  }
  /* live re-renders (cloud pulls, storage events, the refresh tick) must not
     yank a list the member is reading back to the top */
  function setList(box, html) {
    var st = box.scrollTop;
    box.innerHTML = html;
    if (st) box.scrollTop = st;
  }

  function renderBadges() {
    if (!host) return;
    var c = counts();
    TABS.forEach(function (k) {
      var d = q('.hub-tab[data-tab="' + k + '"] .hub-dot');
      var n = c[k];
      if (d.hidden !== !(n > 0) || d.textContent !== String(n > 99 ? '99+' : n)) {
        d.hidden = !(n > 0);
        d.textContent = n > 99 ? '99+' : n;
        if (n > 0) { d.style.animation = 'none'; void d.offsetWidth; d.style.animation = ''; }
      }
    });
    var total = c.ann + c.blog + c.notes + c.dm;
    var fd = q('.hub-fdot');
    fd.hidden = !(total > 0);
    fd.textContent = total > 99 ? '99+' : total;
    q('.hub-fab').classList.toggle('has-new', total > 0);
  }

  function renderAnn() {
    var list = annItems().slice(0, LIST_MAX);
    var box = q('[data-list="ann"]');
    if (!list.length) {
      box.innerHTML = empty(I.mega, 'No announcements yet.<br>Exec posts land here the moment they go out.');
      return;
    }
    setList(box, list.map(function (m) {
      var isNew = m.byId !== ME.id && (m.at || 0) > VC.ann;
      return '<div class="hub-item hub-ann' + (isNew ? ' unread' : '') + '">' +
        '<div class="hub-annhead">' + I.mega + 'Announcement<time>' + esc(ago(m.at)) + '</time></div>' +
        (m.text ? '<p class="hub-anntxt">' + esc(plainText(m.text)) + '</p>' : '') +
        (m.img ? '<img class="hub-annimg" src="' + esc(m.img) + '" alt="" loading="lazy">' : '') +
        '<div class="hub-annby">— ' + esc(m.by || 'Exec Board') + '</div>' +
        '</div>';
    }).join(''));
  }

  function renderBlog() {
    var list = blogItems().slice(0, LIST_MAX);
    var box = q('[data-list="blog"]');
    if (!list.length) {
      box.innerHTML = empty(I.news, 'Nothing on The Bite yet.<br>New issues and blog posts show up here.');
      return;
    }
    setList(box, list.map(function (p) {
      var isNew = p.authorId !== ME.id && itemTs(p) > VC.blog;
      return '<a class="hub-item' + (isNew ? ' unread' : '') + '" href="newsletter.html#post-' + encodeURIComponent(p.id) + '">' +
        (p.img ? '<img class="hub-thumb" src="' + esc(p.img) + '" alt="" loading="lazy">' : '') +
        '<span class="hub-icol">' +
          '<span class="hub-ittl">' + esc(p.title || 'Untitled') + '</span>' +
          '<span class="hub-itmeta">' + esc(p.author || 'DDS') + ' · ' + esc(fmtD(p.date)) + (p.issue ? ' · Nº' + p.issue : '') + '</span>' +
          '<span class="hub-itex">' + esc(stripMd(p.body, 92)) + '</span>' +
        '</span>' +
        '</a>';
    }).join(''));
  }

  function renderNotes() {
    var list = noteItems().slice(0, LIST_MAX);
    var box = q('[data-list="notes"]');
    if (!list.length) {
      box.innerHTML = empty(I.doc, 'The Archive is empty.<br>New meeting notes appear here when posted.');
      return;
    }
    setList(box, list.map(function (n) {
      var isNew = n.authorId !== ME.id && itemTs(n) > VC.notes;
      var p = String(n.date || '').slice(0, 10).split('-');
      return '<a class="hub-item' + (isNew ? ' unread' : '') + '" href="note.html?id=' + encodeURIComponent(n.id) + '">' +
        '<span class="hub-stamp"><b>' + esc(+p[2] || 1) + '</b><span>' + esc(MONTHS[(+p[1] || 1) - 1]) + '</span></span>' +
        '<span class="hub-icol">' +
          '<span class="hub-ittl">' + esc(n.title || 'Meeting notes') + '</span>' +
          '<span class="hub-itmeta">' + (n.speaker ? esc(n.speaker) + ' · ' : '') + esc(n.author || 'Exec Board') + '</span>' +
          '<span class="hub-itex">' + esc(window.DDSMinutes ? DDSMinutes.excerpt(n, 92) : stripMd(n.body, 92)) + '</span>' +
        '</span>' +
        '</a>';
    }).join(''));
  }

  function renderConvos() {
    var st = stGet();
    var chans = myChans().map(function (c) {
      return { c: c, last: lastMsg(c.id), n: chanUnread(c.id, st) };
    }).sort(function (a, b) { return ((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0); });
    var box = q('[data-list="convos"]');
    setList(box, chans.map(function (r) {
      var c = r.c;
      var p = c.kind === 'dm' ? prof(chanOther(c)) : null;
      var av = c.kind === 'dm' ? avHtml(p, chanLabel(c)) : '<span class="hub-av">#</span>';
      var prev = r.last
        ? (r.last.byId === ME.id ? 'You: ' : '') + (r.last.text ? plainText(r.last.text) : '📷 Photo')
        : 'No messages yet';
      return '<button type="button" class="hub-item" data-ch="' + esc(c.id) + '">' +
        av +
        '<span class="hub-icol">' +
          '<span class="hub-ittl" style="-webkit-line-clamp:1;">' + esc(chanLabel(c)) + '</span>' +
          '<span class="hub-itmeta">' + esc(prev.slice(0, 70)) + '</span>' +
        '</span>' +
        '<span class="hub-cright">' + (r.last ? '<time>' + esc(ago(r.last.at)) + '</time>' : '') + dotHtml(r.n) + '</span>' +
        '</button>';
    }).join('') || empty(I.chat, 'No conversations yet.'));
  }

  function dayLabel(t) {
    var d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function renderThread(stick) {
    var log = q('[data-list="thread"]');
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    var list = msgs().filter(function (m) { return m.ch === curCh; });
    if (!list.length) {
      log.innerHTML = empty(I.chat, 'No messages yet — say hi.');
    } else {
      var lastDay = '';
      log.innerHTML = list.map(function (m) {
        var mine = m.byId === ME.id;
        var head = '';
        var dl = dayLabel(m.at);
        if (dl !== lastDay) { lastDay = dl; head = '<span class="hub-day">' + esc(dl) + '</span>'; }
        var p = prof(m.byId);
        return head + '<div class="hbm' + (mine ? ' mine' : '') + '">' +
          (mine ? '' : avHtml(p, m.by)) +
          '<div style="min-width:0;">' +
            '<div class="hbm-bubble">' + esc(plainText(m.text || '')) +
              (m.img ? '<img src="' + esc(m.img) + '" alt="" loading="lazy">' : '') + '</div>' +
            '<span class="hbm-meta">' + esc(mine ? 'You' : (m.by || '')) + ' · ' + esc(fmtTime(m.at)) + '</span>' +
          '</div></div>';
      }).join('');
    }
    if (stick || nearBottom) log.scrollTop = log.scrollHeight;
    // reading an open thread keeps it read
    var st = stGet();
    if (chanUnread(curCh, st) > 0) { st.dm[curCh] = Date.now(); stSave(st); renderBadges(); }
  }

  function renderRoster(filter) {
    var rows = [];
    try { rows = (DDSAuth.members() || []).filter(function (m) { return m.id !== ME.id; }); } catch (e) {}
    var f = String(filter || '').toLowerCase();
    if (f) rows = rows.filter(function (m) { return String(m.name || '').toLowerCase().indexOf(f) > -1; });
    rows.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    var box = q('[data-list="roster"]');
    if (!rows.length) {
      box.innerHTML = empty(I.search, f ? 'No members match “' + esc(f) + '”.' : 'No other members yet.');
      return;
    }
    box.innerHTML = rows.slice(0, 40).map(function (m) {
      var p = prof(m.id);
      var meta = [];
      if (p && p.execTitle) meta.push(p.execTitle);
      if (p && p.gradYear) meta.push('Class of ' + p.gradYear);
      return '<button type="button" class="hub-item" data-dm="' + esc(m.id) + '">' +
        avHtml(p, m.name) +
        '<span class="hub-icol">' +
          '<span class="hub-ittl" style="-webkit-line-clamp:1;">' + esc(m.name || 'Member') + '</span>' +
          '<span class="hub-itmeta">' + esc(meta.join(' · ') || 'Member') + '</span>' +
        '</span>' +
        '</button>';
    }).join('');
  }

  /* ------------------------- tab + view switching -------------------- */
  function markRead(key) {
    if (key === 'dm') return;                       // convos mark themselves
    var st = stGet();
    var c = counts();
    if (c[key] > 0) { st[key] = Date.now(); stSave(st); }
    renderBadges();
  }
  function setMsub(sub) {
    msub = sub;
    ['list', 'thread', 'picker'].forEach(function (s) {
      q('.hubm-' + s).classList.toggle('on', s === sub);
    });
    q('[data-hub-new]').hidden = !(activeTab === 'dm' && sub === 'list');
    q('[data-hub-title]').textContent = sub === 'picker' ? 'New message' : TITLES[activeTab];
  }
  function renderActive() {
    if (activeTab === 'ann') renderAnn();
    else if (activeTab === 'blog') renderBlog();
    else if (activeTab === 'notes') renderNotes();
    else if (msub === 'thread') renderThread(false);
    else if (msub === 'picker') renderRoster(q('[data-hub-search]').value);
    else renderConvos();
    if (open) markRead(activeTab);
  }
  function showTab(key) {
    activeTab = key;
    var st = stGet();
    if (key !== 'dm') VC[key] = st[key];            // freeze the unread cutoff for styling
    host.querySelectorAll('.hub-tab').forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-tab') === key);
    });
    host.querySelectorAll('.hub-view').forEach(function (v) {
      v.classList.toggle('on', v.getAttribute('data-view') === key);
    });
    q('.hub-ind').style.transform = 'translateX(' + TABS.indexOf(key) * 100 + '%)';
    if (key === 'dm') setMsub(msub === 'thread' && curCh ? 'thread' : 'list');
    else { q('[data-hub-new]').hidden = true; q('[data-hub-title]').textContent = TITLES[key]; }
    renderActive();
  }
  function openThread(chId) {
    curCh = chId;
    var c = chanById(chId);
    if (!c) return;
    var st = stGet();
    VC.ch[chId] = st.dm[chId] || st.boot;
    q('[data-th-av]').innerHTML = c.kind === 'dm' ? avHtml(prof(chanOther(c)), chanLabel(c)) : '<span class="hub-av">#</span>';
    q('[data-th-name]').textContent = chanLabel(c);
    q('[data-th-sub]').textContent = c.kind === 'dm' ? 'Direct message'
      : c.members ? c.members.length + ' members' : 'Everyone in the chapter';
    setMsub('thread');
    renderThread(true);
    setTimeout(function () { q('.hubm-compose input').focus(); }, 250);
  }

  function setOpen(v) {
    open = v;
    document.documentElement.classList.toggle('dds-hub-open', v);
    q('.hub-fab').setAttribute('aria-expanded', v ? 'true' : 'false');
    q('.hub-fab').setAttribute('aria-label', v ? 'Close the chapter hub' : 'Open the chapter hub');
    if (v) showTab(defaultTab(counts()));
  }

  /* ---------------------------- messaging ---------------------------- */
  function syntheticStorage(key) {
    // same-tab renderers (dashboard chat, badges in other hub code paths)
    // listen for storage events, which real same-tab writes never fire
    try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) {}
  }
  function sendMsg(text) {
    text = String(text || '').trim();
    if (!text || !curCh) return;
    var list = msgs();
    list.push({ id: uid(), ch: curCh, by: ME.name, byId: ME.id, text: text.slice(0, 1000), at: Date.now() });
    if (list.length > 600) list = list.slice(-600);
    try { localStorage.setItem(MSG_KEY, JSON.stringify(list)); } catch (e) { return; }
    if (window.DDSCloud) { try { DDSCloud.touch('chatMsgs'); } catch (e2) {} }
    renderThread(true);
    syntheticStorage(MSG_KEY);
  }
  function startDM(otherId) {
    if (!otherId || otherId === ME.id) return;
    var id = 'dm-' + [ME.id, otherId].sort().join('-');
    var chans = readJSON(CHAN_KEY, []);
    if (!Array.isArray(chans)) chans = [];
    if (!chans.some(function (c) { return c && c.id === id; })) {
      chans.push({ id: id, kind: 'dm', name: '', members: [ME.id, otherId].sort(), by: ME.id, at: Date.now() });
      try { localStorage.setItem(CHAN_KEY, JSON.stringify(chans)); } catch (e) {}
      if (window.DDSCloud) { try { DDSCloud.touch('chatMeta'); } catch (e2) {} }
      syntheticStorage(CHAN_KEY);
    }
    openThread(id);
  }

  /* ------------------------------ wiring ----------------------------- */
  function wire() {
    host.addEventListener('click', function (e) {
      if (e.target.closest('.hub-fab')) { setOpen(!open); return; }
      if (e.target.closest('[data-hub-close]')) { setOpen(false); return; }
      var tab = e.target.closest('.hub-tab');
      if (tab) { showTab(tab.getAttribute('data-tab')); return; }
      if (e.target.closest('[data-hub-back]')) { setMsub('list'); renderConvos(); return; }
      if (e.target.closest('[data-hub-new]')) {
        setMsub('picker'); renderRoster('');
        setTimeout(function () { q('[data-hub-search]').focus(); }, 250);
        return;
      }
      var convo = e.target.closest('[data-ch]');
      if (convo) { openThread(convo.getAttribute('data-ch')); return; }
      var pick = e.target.closest('[data-dm]');
      if (pick) { startDM(pick.getAttribute('data-dm')); return; }
    });
    q('[data-hub-compose]').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = this.querySelector('input');
      sendMsg(input.value);
      input.value = '';
    });
    q('[data-hub-search]').addEventListener('input', function () { renderRoster(this.value); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !open || !host) return;
      if (activeTab === 'dm' && msub === 'picker') { setMsub('list'); renderConvos(); }
      else setOpen(false);
    });
    document.addEventListener('pointerdown', function (e) {
      if (open && host && !e.target.closest('#dds-hub')) setOpen(false);
    });
  }

  /* --------------------------- live updates -------------------------- */
  function onStore(e) {
    if (!host || !ME) return;
    var watched = [MSG_KEY, CHAN_KEY, NEWS_KEY, MIN_KEY, MEM_KEY, STATE_KEY];
    if (e.key && watched.indexOf(e.key) < 0) return;
    renderBadges();
    if (open) renderActive();
  }

  function mount() {
    var me = null;
    try { me = window.DDSAuth && DDSAuth.current(); } catch (e) {}
    if (!me) { destroy(); ME = null; return; }
    if (ME && ME.id === me.id && host) { ME = me; return; }
    ME = me;
    destroy();
    build();
  }

  function boot() {
    mount();
    if (window.DDSAuth && DDSAuth.onChange) DDSAuth.onChange(mount);
    window.addEventListener('storage', onStore);
    setInterval(function () {
      if (!host) return;
      renderBadges();
      if (open) renderActive();
    }, 60000);

    // off-dashboard pages never poll chat on their own — pull it here
    var onDash = !!document.getElementById('chat-log');
    if (!onDash && window.DDSCloud && DDSCloud.enabled) {
      var pull = function () {
        if (document.visibilityState !== 'visible' || !host) return;
        DDSCloud.pullNow(['chatMsgs', 'chatMeta']).then(function () {
          renderBadges();
          if (open) renderActive();
        }, function () {});
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

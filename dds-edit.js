/* DDS inline site editor — exec-only "edit the whole page through the UI".

   v2: instead of hand-tagged blocks, a scanner walks the page and makes
   EVERY visible text leaf editable (an element whose children are only
   text and <br>), plus every fixed UI photo (same-origin file <img>).
   Exec board members get a floating Edit/View toggle; nobody else ever
   sees any of it.

   What edit mode gives an exec:
   - every editable text gets a dashed blue box; click and type. Buttons
     and links stop navigating so their labels can be edited too.
   - every replaceable photo gets a dashed gold box; click to upload a
     new image (resized + compressed automatically).
   - when the selected text lives inside a link, the floating panel shows
     the link's URL so it can be re-pointed (safe schemes only).
   - officer profile panels write through to the officer's real member
     row (bio / quote / attribution / photos), the same fields their
     dashboard profile edits — synced to the whole chapter.

   Storage: overrides live in localStorage `dds-content-v1` as
   id -> {t?|img?, by, at, up} and sync through DDSCloud (collection
   `content`). Overrides are applied with textContent / src swaps only —
   NEVER innerHTML — so the open Firestore rules can't be abused to
   inject markup into visitors' pages.

   Id scheme (stability across loads without hand-tagging):
   - manual tags keep their id:            data-ce="pres-p1"
   - auto text:  a:<page>:<textHash>:<n>   (committed text changes in git
     -> new id -> old override orphans and the new committed text shows)
   - images:     img:<file-basename>       (replaces that file everywhere)
   - officer fallback (no account yet):    op:<email>:<field>
   - link URLs:  <text-id>:href                                        */
(function () {
  'use strict';
  var STORE_KEY = 'dds-content-v1';
  var PAGE = (function () {
    var f = (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/i, '');
    return f === '' || f === 'index' ? 'home' : f;
  })();

  /* ---- what must never be editable: text that is rendered from data
     stores or rewritten live by page scripts (edits there would be
     clobbered or would desync from the real data, which has its own
     editing tools), plus form controls and the editor's own UI. ---- */
  var EXCLUDE_GLOBAL = [
    '.dds-edit-fab', 'script', 'style', 'noscript', 'svg', 'iframe', 'video',
    'input', 'textarea', 'select', 'option', '#yr', '[data-auth-mount]',
    '[data-ce-skip]', '[data-charwrap] span'
  ];
  var EXCLUDE_PAGE = {
    home: [
      '#upe-index', '#upe-hero', '#galc',                       // live calendar + gallery carousel
      '#om-name', '#om-role', '#om-focus-t', '#om-quote', '#om-detail', '#om-pindex', // members spotlight rotator
      '#hero-login', '#exec-copy', '#nb-rail',                  // JS-swapped labels + Bite rail
      '[data-bl-rail]', '[data-bl-big]', '.bl-tier', '.blm-card', // big/little (family data)
      '[data-op-bio]', '[data-op-voice]', '[data-op-voiceby]',  // officer fields (custom DB bridge below)
      '[data-op-desc]', '[data-op-reach]', '[data-op-photos]'
    ],
    newsletter: [
      '#chips', '#feat-slot', '#pg-grid', '#reader', '#cp-sub', '#cp-tags'
    ],
    dashboard: [
      '#hello-date', '#hello-h1', '#tb-name', '#tb-avatar', '#cluster', '#odo',
      '#svc-panel', '#m-list', '#log-list', '#log-cats', '#log-cta-sub', '#sync-text',
      '#upe-dash', '#cls-grid', '#cf-title', '#pr-title', '#res-folders',
      '#mem-space', '#mem-modal', '#ppop', '#mention-pop',
      '#chat-rail', '#chat-log', '#chat-title', '#chat-sub', '#chat-pend-txt',
      '#cn-people', '#cn-people-label', '#cn-save',
      '#fam-big', '#fam-littles', '#fam-chips', '#fam-note', '#fm-fam', '#fm-sub', '#fm-title',
      '#gal-albums', '#gal-title', '#gal-count', '#pgrid', '#lb', '#up-sub', '#up-count', '#up-strip',
      '#rf-file-label', '#fuel-n', '#fuel-max'
    ]
  };
  var EXCL = EXCLUDE_GLOBAL.concat(EXCLUDE_PAGE[PAGE] || []).join(',');

  var origText = {};   // id -> committed text (captured before overrides)
  var origHref = {};   // id -> committed href of the enclosing link
  var origSrc = {};    // img key -> committed src
  var hooks = {};      // id -> { view: fn(el,text), edit: fn(el,text) }
  var mode = 'view';
  var lastSel = null;  // { type:'text'|'img', el?, key? } for the Undo button
  var toggle = null, styleAdded = false, observer = null;
  var imgInput = null, phInput = null, pendingImgKey = null, pendingPhBox = null;

  /* contenteditable="plaintext-only" pastes/types plain text natively;
     fall back to "true" + a paste sanitizer where unsupported. */
  var CE_VAL = (function () {
    try { var d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return 'plaintext-only'; }
    catch (e) { return 'true'; }
  })();

  function readMap() {
    try { var v = JSON.parse(localStorage.getItem(STORE_KEY)); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function writeMap(m) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); return true; }
    catch (e) { msg('Storage is full on this browser — that edit could not be saved.', true); return false; }
  }
  function isExec() { return !!(window.DDSAuth && DDSAuth.isExec && DDSAuth.isExec()); }
  function me() { return (window.DDSAuth && DDSAuth.current && DDSAuth.current()) || null; }
  function touchCloud() { if (window.DDSCloud) { try { DDSCloud.touch('content'); } catch (e) {} } }
  function tombCloud(id) { if (window.DDSCloud) { try { DDSCloud.tombstone('content', id); } catch (e) {} } }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };

  /* ---- text <-> DOM (text nodes + <br> only; never innerHTML) ---- */
  function getText(el) {
    var out = '';
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) { if (c.tagName === 'BR') out += '\n'; else walk(c); }
      }
    })(el);
    return out;
  }
  function setText(el, text) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var parts = String(text == null ? '' : text).split('\n');
    parts.forEach(function (p, i) {
      el.appendChild(document.createTextNode(p));
      if (i < parts.length - 1) el.appendChild(document.createElement('br'));
    });
  }

  /* ---- scanner ---- */
  function isTextLeaf(el) {
    var hasText = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) hasText = true; }
      else if (c.nodeType === 1) { if (c.tagName !== 'BR') return false; }
      else if (c.nodeType !== 8) return false;
    }
    return hasText;
  }
  function fileSrc(img) {
    // a same-origin single-file src ("slot-mq-3.webp") — data:/blob:/URLs skipped
    var s = img.getAttribute('src') || '';
    return /^[\w.%-]+\.(png|jpe?g|webp|gif|avif)$/i.test(s) ? s : null;
  }

  /* Elements that MIX bare text with child elements ("Gallery<span>→</span>")
     get each bare text node wrapped in a neutral <dds-t> so it becomes its
     own editable leaf. A custom element (inline, unstyled) is used instead
     of <span> so site CSS like ".nav-dd-link span" can never restyle it. */
  function hasMixedText(el) {
    var hasTxt = false, hasEl = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) hasTxt = true; }
      else if (c.nodeType === 1 && c.tagName !== 'BR') hasEl = true;
    }
    return hasTxt && hasEl;
  }
  function wrapMixedText(el) {
    var out = [];
    for (var c = el.firstChild; c; ) {
      var next = c.nextSibling;
      if (c.nodeType === 3 && c.nodeValue.trim()) {
        var w = document.createElement('dds-t');
        el.insertBefore(w, c);
        w.appendChild(c);
        out.push(w);
      }
      c = next;
    }
    return out;
  }

  function scan() {
    var usedOcc = {};   // textHash -> { occ:true } already claimed by tagged nodes
    var tagged = document.querySelectorAll('[data-ce]');
    for (var t = 0; t < tagged.length; t++) {
      var mt = /^a:[^:]+:([^:]+):(\d+)$/.exec(tagged[t].getAttribute('data-ce'));
      if (mt) (usedOcc[mt[1]] = usedOcc[mt[1]] || {})[mt[2]] = true;
    }
    function tagLeaf(el) {
      var text = norm(getText(el));
      if (!text) return;
      var h = hash(text);
      var occ = 0, used = usedOcc[h] = usedOcc[h] || {};
      while (used[occ]) occ++;
      used[occ] = true;
      var id = 'a:' + PAGE + ':' + h + ':' + occ;
      el.setAttribute('data-ce', id);
      captureCommitted(el, id);
    }
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest(EXCL)) continue;

      if (el.tagName === 'IMG') {
        if (el.hasAttribute('data-ce-img')) continue;
        var src = fileSrc(el); if (!src) continue;
        var key = 'img:' + src.toLowerCase();
        if (origSrc[key] == null) origSrc[key] = src;
        el.setAttribute('data-ce-img', key);
        continue;
      }

      if (el.hasAttribute('data-ce')) {           // manual tag or already scanned
        captureCommitted(el, el.getAttribute('data-ce'));
        continue;
      }
      var anc = el.parentElement && el.parentElement.closest('[data-ce]');
      if (anc) continue;                           // inside a tagged block
      if (isTextLeaf(el)) { tagLeaf(el); continue; }
      if (hasMixedText(el)) wrapMixedText(el).forEach(tagLeaf);
    }
  }
  function captureCommitted(el, id) {
    if (origText[id] == null) origText[id] = getText(el);
    if (origHref[id] == null) {
      var a = el.closest('a');
      if (a) origHref[id] = a.getAttribute('href') || '';
    }
  }

  /* ---- current value for an id (override else committed) ---- */
  function currentText(id) {
    var m = readMap();
    if (m[id] && typeof m[id].t === 'string') return m[id].t;
    return origText[id] != null ? origText[id] : '';
  }
  function fieldOverride(key) {
    var e = readMap()[key];
    if (!e) return null;
    return e.t != null ? e.t : (e.img != null ? e.img : null);
  }

  function safeHref(v) {
    v = String(v || '').trim();
    if (!v) return null;
    var scheme = /^([a-zA-Z][\w+.-]*):/.exec(v);
    if (scheme && ['http', 'https', 'mailto', 'tel'].indexOf(scheme[1].toLowerCase()) === -1) return null;
    return v;
  }

  /* ---- apply every override to the DOM (idempotent) ---- */
  function applyAll() {
    var m = readMap();
    var ces = document.querySelectorAll('[data-ce]');
    for (var i = 0; i < ces.length; i++) {
      var el = ces[i], id = el.getAttribute('data-ce');
      if (origText[id] == null) continue;               // not captured yet
      if (el === document.activeElement) continue;      // never fight the caret
      var target = currentText(id);
      if (hooks[id] && mode !== 'edit') {
        if (norm(getText(el)) !== norm(target)) hooks[id].view(el, target);
      } else if (getText(el) !== target && norm(getText(el)) !== norm(target)) {
        setText(el, target);
      }
      var hv = m[id + ':href'];
      if (hv && hv.t) {
        var a = el.closest('a'), safe = safeHref(hv.t);
        if (a && safe && a.getAttribute('href') !== safe) a.setAttribute('href', safe);
      }
    }
    var imgs = document.querySelectorAll('img[data-ce-img]');
    for (var j = 0; j < imgs.length; j++) {
      var img = imgs[j], key = img.getAttribute('data-ce-img');
      var o = m[key];
      var want = o && o.img ? o.img : origSrc[key];
      if (want && img.getAttribute('src') !== want) img.setAttribute('src', want);
    }
  }

  /* ---- saving ---- */
  function stamp(extra) {
    var u = me();
    var e = { by: (u && u.name) || 'Exec', at: Date.now(), up: Date.now() };
    for (var k in extra) e[k] = extra[k];
    return e;
  }
  function saveField(key, text) {
    var m = readMap();
    m[key] = stamp({ t: text });
    if (writeMap(m)) { touchCloud(); msg('Saved ✓'); }
  }
  function removeField(key) {
    var m = readMap();
    if (m[key]) { delete m[key]; writeMap(m); tombCloud(key); }
  }
  function saveText(el) {
    var id = el.getAttribute('data-ce'); if (!id) return;
    var text = getText(el);
    if (norm(text) === norm(origText[id] != null ? origText[id] : '')) removeField(id);
    else saveField(id, text);
  }
  function resetSelected() {
    if (!lastSel) return;
    if (lastSel.type === 'img') {
      removeField(lastSel.key);
      applyAll(); msg('Photo restored.');
    } else if (lastSel.type === 'text' && lastSel.el) {
      var el = lastSel.el, id = el.getAttribute('data-ce'); if (!id) return;
      removeField(id); removeField(id + ':href');
      setText(el, origText[id] != null ? origText[id] : '');
      var a = el.closest('a');
      if (a && origHref[id] != null) a.setAttribute('href', origHref[id]);
      syncLinkRow(el); msg('Restored the original.');
    }
  }

  /* ---- images: click-to-replace ---- */
  function processImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s));
        c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  function compressToFit(file) {
    // Firestore docs cap at ~1MB; stay well under so the override syncs.
    return processImage(file, 1200, 0.8).then(function (d) {
      if (d.length < 600000) return d;
      return processImage(file, 900, 0.65).then(function (d2) {
        if (d2.length < 600000) return d2;
        return processImage(file, 720, 0.5).then(function (d3) {
          if (d3.length < 600000) return d3;
          throw new Error('too-big');
        });
      });
    });
  }
  function onImgPicked(file) {
    var key = pendingImgKey; pendingImgKey = null;
    if (!key || !file) return;
    compressToFit(file).then(function (dataURL) {
      var m = readMap();
      m[key] = stamp({ img: dataURL });
      if (writeMap(m)) { touchCloud(); applyAll(); lastSel = { type: 'img', key: key }; msg('Photo updated ✓'); }
    }).catch(function (e) {
      msg(e && e.message === 'too-big'
        ? 'That image is too detailed to store — try a smaller or simpler photo.'
        : 'That image didn’t load — try a different file.', true);
    });
  }

  /* ---- officer panels: write through to the member database ---- */
  var OFFICER_FIELDS = [
    ['[data-op-bio]', 'bio'],
    ['[data-op-voice]', 'quote'],
    ['[data-op-voiceby] strong', 'quoteBy']
  ];
  function officerEmail(el) {
    var p = el.closest('[data-op-email]');
    return p ? String(p.getAttribute('data-op-email') || '').toLowerCase() : '';
  }
  function bindOfficerEditables() {
    if (mode !== 'edit') return;
    document.querySelectorAll('[data-op-email]').forEach(function (panel) {
      OFFICER_FIELDS.forEach(function (f) {
        var el = panel.querySelector(f[0]);
        if (!el) return;
        el.setAttribute('contenteditable', CE_VAL);
        el.setAttribute('spellcheck', 'true');
        el.setAttribute('data-ce-dyn', f[1]);
      });
    });
  }
  function unbindOfficerEditables() {
    document.querySelectorAll('[data-ce-dyn]').forEach(function (el) {
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
      el.removeAttribute('data-ce-dyn');
    });
  }
  function saveOfficerField(el) {
    var field = el.getAttribute('data-ce-dyn');
    var email = officerEmail(el);
    if (!field || !email) return;
    var value = getText(el).trim();
    if (field === 'quote') value = value.replace(/^[“”"\s]+|[“”"\s]+$/g, '');
    var wrote = false;
    if (window.DDSAuth && DDSAuth.execSetProfileByEmail) {
      var res = DDSAuth.execSetProfileByEmail(email, (function () { var o = {}; o[field] = value; return o; })());
      wrote = !!(res && res.ok);
    }
    if (!wrote) saveField('op:' + email + ':' + field, value);   // officer has no account yet
    else msg('Saved to ' + email.split('@')[0] + '’s profile ✓');
    if (window.__opRefresh) { try { window.__opRefresh(); } catch (e) {} }
    setTimeout(bindOfficerEditables, 120);   // hydration re-rendered the nodes
  }
  function addOfficerPhotos(box, files) {
    var email = officerEmail(box);
    if (!email || !files.length) return;
    var existing = [];
    try { existing = JSON.parse(box.getAttribute('data-photos') || '[]') || []; } catch (e) {}
    var chain = Promise.resolve([]);
    files.forEach(function (f) {
      chain = chain.then(function (arr) {
        return processImage(f, 720, 0.72).then(function (d) { arr.push(d); return arr; }, function () { return arr; });
      });
    });
    chain.then(function (added) {
      if (!added.length) return msg('Those images didn’t load — try different files.', true);
      var combined = existing.concat(added).slice(0, 8);
      if (JSON.stringify(combined).length > 700000) return msg('The photo box is full — remove some in the profile page first.', true);
      var wrote = false;
      if (window.DDSAuth && DDSAuth.execSetProfileByEmail) {
        var res = DDSAuth.execSetProfileByEmail(email, { photos: combined });
        wrote = !!(res && res.ok);
      }
      if (!wrote) saveField('op:' + email + ':photos', JSON.stringify(combined));
      msg('Added ' + added.length + (added.length === 1 ? ' photo' : ' photos') + ' ✓' + (existing.length + added.length > 8 ? ' (box holds 8)' : ''));
      if (window.__opRefresh) { try { window.__opRefresh(); } catch (e) {} }
    });
  }

  /* ---- edit mode ---- */
  function setMode(next) {
    if (next === 'edit' && !isExec()) return;
    mode = next;
    var editing = mode === 'edit';
    document.documentElement.classList.toggle('dds-editing', editing);
    if (editing) scan();
    document.querySelectorAll('[data-ce]').forEach(function (el) {
      var id = el.getAttribute('data-ce');
      if (editing) {
        if (hooks[id] && hooks[id].edit) hooks[id].edit(el, currentText(id));
        el.setAttribute('contenteditable', CE_VAL);
        el.setAttribute('spellcheck', 'true');
      } else {
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        var text = currentText(id);
        if (hooks[id]) hooks[id].view(el, text);
        else if (getText(el) !== text) setText(el, text);
      }
    });
    if (editing) bindOfficerEditables();
    else { unbindOfficerEditables(); lastSel = null; }
    renderToggle();
  }
  function ensureEditable() {   // newly scanned nodes while already editing
    if (mode !== 'edit') return;
    document.querySelectorAll('[data-ce]:not([contenteditable])').forEach(function (el) {
      el.setAttribute('contenteditable', CE_VAL);
      el.setAttribute('spellcheck', 'true');
    });
    bindOfficerEditables();
  }

  /* ---- floating control ---- */
  function injectStyle() {
    if (styleAdded) return; styleAdded = true;
    var css =
      '.dds-editing [data-ce]{outline:1.5px dashed rgba(75,156,211,.75);outline-offset:3px;border-radius:3px;cursor:text;transition:background .15s ease,outline-color .15s ease;}' +
      '.dds-editing [data-ce]:hover{background:rgba(75,156,211,.12);}' +
      '.dds-editing [data-ce]:focus{outline:2px solid #4B9CD3;background:rgba(75,156,211,.16);}' +
      '.dds-editing [data-ce-dyn]{outline:1.5px dashed rgba(227,194,124,.8);outline-offset:3px;border-radius:3px;cursor:text;}' +
      '.dds-editing [data-ce-dyn]:focus{outline:2px solid #E3C27C;background:rgba(185,151,91,.14);}' +
      '.dds-editing img[data-ce-img]{outline:2px dashed rgba(227,194,124,.85);outline-offset:3px;cursor:pointer;}' +
      '.dds-editing img[data-ce-img]:hover{filter:brightness(1.12);}' +
      '.dds-editing [data-op-photos]{outline:2px dashed rgba(227,194,124,.85);outline-offset:-2px;cursor:pointer;}' +
      '.dds-editing .pdc-back-in{opacity:1 !important;}' +
      '.dds-edit-fab{position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:"Montserrat",system-ui,sans-serif;}' +
      '.dds-edit-btn{display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;border-radius:999px;padding:12px 20px;font-weight:700;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;box-shadow:0 16px 34px -14px rgba(0,0,0,.75);transition:transform .18s ease,filter .18s ease;}' +
      '.dds-edit-btn:hover{transform:translateY(-2px);filter:brightness(1.06);}' +
      '.dds-edit-btn.view{background:linear-gradient(135deg,#13294B,#0A1A30);color:#EAF1F8;border:1px solid rgba(75,156,211,.5);}' +
      '.dds-edit-btn.done{background:linear-gradient(135deg,#B9975B,#a07f3f);color:#1a1205;}' +
      '.dds-edit-note{background:rgba(9,20,38,.96);color:#D7E2EA;border:1px solid rgba(75,156,211,.3);border-radius:12px;padding:11px 14px;font-size:11.5px;line-height:1.5;max-width:270px;box-shadow:0 16px 34px -14px rgba(0,0,0,.75);}' +
      '.dds-edit-note b{color:#E3C27C;}' +
      '.dds-edit-note .row{display:flex;gap:6px;margin-top:8px;}' +
      '.dds-edit-note input{flex:1;min-width:0;background:rgba(6,14,29,.8);border:1px solid rgba(75,156,211,.35);border-radius:8px;color:#EAF1F8;font-family:inherit;font-size:11px;padding:6px 8px;}' +
      '.dds-edit-note button{background:rgba(75,156,211,.14);color:#9FC6EC;border:1px solid rgba(75,156,211,.4);border-radius:8px;padding:6px 9px;font-family:inherit;font-weight:700;font-size:10px;letter-spacing:.8px;text-transform:uppercase;cursor:pointer;white-space:nowrap;}' +
      '.dds-edit-note button:hover{background:rgba(75,156,211,.24);}' +
      '.dds-edit-note .full{width:100%;margin-top:8px;}' +
      '.dds-edit-msg{display:block;margin-top:7px;font-size:10.5px;color:#9FC6EC;min-height:13px;}' +
      '.dds-edit-msg.err{color:#ff9b9b;}' +
      '.dds-edit-linkrow[hidden]{display:none;}' +
      '@media print{.dds-edit-fab{display:none;}}';
    var s = document.createElement('style'); s.id = 'dds-edit-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function renderToggle() {
    if (!isExec()) { if (toggle) { toggle.remove(); toggle = null; } return; }
    injectStyle();
    if (!toggle) {
      toggle = document.createElement('div');
      toggle.className = 'dds-edit-fab';
      document.body.appendChild(toggle);
    }
    var editing = mode === 'edit';
    toggle.innerHTML =
      (editing
        ? '<div class="dds-edit-note">You’re in <b>editor mode</b>. Click any outlined text and type — blue boxes are page text, gold boxes save to that officer’s profile. Click a gold-boxed <b>photo</b> to replace it. Everything saves automatically and syncs to the whole chapter.' +
          '<div class="row dds-edit-linkrow" hidden><input type="url" class="dds-edit-url" placeholder="https:// link for the selected text" aria-label="Link URL"><button type="button" data-dds-savelink>Set</button></div>' +
          '<button type="button" class="full" data-dds-reset>↺ Undo the selected text or photo</button>' +
          '<span class="dds-edit-msg"></span></div>'
        : '') +
      '<button type="button" class="dds-edit-btn ' + (editing ? 'done' : 'view') + '" data-dds-toggle>' +
        (editing ? '✓ Done editing' : '✎ Edit page') +
      '</button>';
  }
  function msg(text, isErr) {
    if (!toggle) return;
    var el = toggle.querySelector('.dds-edit-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
    clearTimeout(msg._t);
    msg._t = setTimeout(function () { el.textContent = ''; el.classList.remove('err'); }, 4000);
  }
  function syncLinkRow(el) {
    if (!toggle) return;
    var row = toggle.querySelector('.dds-edit-linkrow');
    if (!row) return;
    var a = el && el.closest && el.closest('a');
    if (a && el.hasAttribute('data-ce')) {
      row.hidden = false;
      row.querySelector('.dds-edit-url').value = a.getAttribute('href') || '';
      row.setAttribute('data-for', el.getAttribute('data-ce'));
    } else {
      row.hidden = true;
      row.removeAttribute('data-for');
    }
  }

  /* ---- wiring ---- */
  function init() {
    scan();
    applyAll();

    // hidden pickers for image replacement + officer photos
    imgInput = document.createElement('input');
    imgInput.type = 'file'; imgInput.accept = 'image/*'; imgInput.hidden = true;
    imgInput.addEventListener('change', function () { onImgPicked(this.files && this.files[0]); this.value = ''; });
    phInput = document.createElement('input');
    phInput.type = 'file'; phInput.accept = 'image/*'; phInput.multiple = true; phInput.hidden = true;
    phInput.addEventListener('change', function () {
      var box = pendingPhBox; pendingPhBox = null;
      if (box) addOfficerPhotos(box, Array.prototype.slice.call(this.files || []));
      this.value = '';
    });
    var attach = function () { document.body.appendChild(imgInput); document.body.appendChild(phInput); };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);

    // capture-phase interception: in edit mode, clicks EDIT things instead
    // of activating them (links/buttons go dead so their labels can be edited)
    document.addEventListener('click', function (e) {
      var fab = e.target.closest && e.target.closest('.dds-edit-fab');
      if (fab) {
        if (e.target.closest('[data-dds-toggle]')) setMode(mode === 'edit' ? 'view' : 'edit');
        else if (e.target.closest('[data-dds-reset]')) resetSelected();
        else if (e.target.closest('[data-dds-savelink]')) {
          var row = toggle && toggle.querySelector('.dds-edit-linkrow');
          var id = row && row.getAttribute('data-for');
          if (id) {
            var url = safeHref(row.querySelector('.dds-edit-url').value);
            if (!url) return msg('Use a normal web link (https://…), mailto:, tel:, or #section.', true);
            var target = document.querySelector('[data-ce="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
            var a = target && target.closest('a');
            if (a) { a.setAttribute('href', url); saveField(id + ':href', url); }
          }
        }
        return;
      }
      if (mode !== 'edit') return;
      var phBox = e.target.closest && e.target.closest('[data-op-photos]');
      if (phBox && phBox.closest('[data-op-email]')) {
        e.preventDefault(); e.stopPropagation();
        pendingPhBox = phBox; phInput.click();
        return;
      }
      var img = e.target.closest && e.target.closest('img[data-ce-img]');
      if (img) {
        e.preventDefault(); e.stopPropagation();
        pendingImgKey = img.getAttribute('data-ce-img');
        lastSel = { type: 'img', key: pendingImgKey };
        imgInput.click();
        return;
      }
      var act = e.target.closest && e.target.closest('a,button,label,[role="button"],input[type="submit"]');
      if (act) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.addEventListener('submit', function (e) {
      if (mode === 'edit' && !(e.target.closest && e.target.closest('.dds-edit-fab'))) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // track selection for Undo + the link row
    document.addEventListener('focusin', function (e) {
      if (mode !== 'edit' || !e.target.matches) return;
      if (e.target.matches('[data-ce]')) { lastSel = { type: 'text', el: e.target }; syncLinkRow(e.target); }
      else if (e.target.matches('[data-ce-dyn]')) { lastSel = null; syncLinkRow(null); }
    });

    // autosave: debounce while typing, immediately on leaving the field
    var deb = {};
    document.addEventListener('input', function (e) {
      if (mode !== 'edit' || !e.target.matches) return;
      var el = e.target;
      if (el.matches('[data-ce]')) {
        var id = el.getAttribute('data-ce');
        clearTimeout(deb[id]);
        deb[id] = setTimeout(function () { saveText(el); }, 600);
      }
    });
    document.addEventListener('focusout', function (e) {
      if (mode !== 'edit' || !e.target.matches) return;
      var el = e.target;
      if (el.matches('[data-ce]')) {
        var id = el.getAttribute('data-ce');
        clearTimeout(deb[id]);
        saveText(el);
      } else if (el.matches('[data-ce-dyn]')) {
        saveOfficerField(el);
      }
    });
    document.addEventListener('paste', function (e) {
      if (mode !== 'edit' || CE_VAL === 'plaintext-only') return;
      var el = e.target.closest && e.target.closest('[data-ce],[data-ce-dyn]');
      if (!el) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    // cloud / cross-tab updates + late-built DOM (JS-rendered sections)
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key === STORE_KEY) applyAll();
      if ((!e.key || e.key === 'dds-members-v1') && mode === 'edit') setTimeout(bindOfficerEditables, 150);
    });
    var rescanT = null;
    var startObserver = function () {
      scan(); applyAll(); ensureEditable();
      observer = new MutationObserver(function () {
        clearTimeout(rescanT);
        rescanT = setTimeout(function () { scan(); applyAll(); ensureEditable(); }, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      renderToggle();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver);
    else startObserver();

    if (window.DDSAuth && DDSAuth.onChange) DDSAuth.onChange(function () {
      if (mode === 'edit' && !isExec()) setMode('view');
      renderToggle();
    });
  }

  var DDSEdit = {
    hydrate: function () { scan(); applyAll(); return DDSEdit; },
    refresh: applyAll,
    setMode: setMode,
    currentText: currentText,
    fieldOverride: fieldOverride,   // read any override (officer op:* keys etc.)
    saveField: saveField,
    removeField: removeField,
    setImage: function (key, dataURL) {   // programmatic image override
      var m = readMap();
      m[key] = stamp({ img: dataURL });
      if (writeMap(m)) { touchCloud(); applyAll(); }
    },
    resetField: function (el) { lastSel = { type: 'text', el: el }; resetSelected(); },
    registerHook: function (id, h) { hooks[id] = h; return DDSEdit; },
    isExec: isExec
  };
  window.DDSEdit = DDSEdit;

  init();
})();

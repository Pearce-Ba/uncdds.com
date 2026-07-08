/* DDS inline content editor — exec-only "edit the site text through the UI".

   How it works
   ------------
   Any element tagged `data-ce="<stable-id>"` becomes editable by exec board
   members. Edits are stored as PLAIN TEXT in localStorage `dds-content-v1`
   (a map id -> {t, by, at, up}) and synced through DDSCloud (collection
   `content`), so once Firebase is configured an edit made by the president
   shows for everyone. On every page load `hydrate()` applies stored overrides
   over the committed HTML text.

   Why plain text only: the Firestore rules are open (any determined visitor
   can write), so we apply overrides with `textContent`, never `innerHTML`.
   That makes it impossible to inject executable markup into other people's
   pages through this store. One id = one editable text block.

   Animated elements (e.g. the char-by-char "About" paragraph) register a
   `view`/`edit` hook so the editor can un-wrap them for editing and re-run
   their animation afterwards. See registerHook().  */
(function () {
  'use strict';
  var STORE_KEY = 'dds-content-v1';
  var SEL = '[data-ce]';

  var origById = {};   // committed (pre-override) text, captured once per id
  var hooks = {};      // id -> { view: fn(el, text), edit: fn(el, text) }
  var mode = 'view';
  var lastField = null;   // most recently focused editable (for "undo this field")
  var toggle = null, styleAdded = false;

  function readMap() {
    try { var v = JSON.parse(localStorage.getItem(STORE_KEY)); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function writeMap(m) { try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch (e) {} }

  function isExec() { return !!(window.DDSAuth && DDSAuth.isExec && DDSAuth.isExec()); }
  function els() { return Array.prototype.slice.call(document.querySelectorAll(SEL)); }
  function elById(id) { return document.querySelector('[data-ce="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }

  /* Text currently stored for an id (override if present, else committed). */
  function currentText(id) {
    var m = readMap();
    if (m[id] && typeof m[id].t === 'string') return m[id].t;
    return origById[id] != null ? origById[id] : '';
  }

  /* Apply text to an element for DISPLAY (uses a view hook if registered). */
  function applyView(el, id, text) {
    var h = hooks[id];
    if (h && h.view) h.view(el, text);
    else el.textContent = text;
  }

  /* --- initial hydrate: capture originals, apply any stored overrides ---
     Runs synchronously near the top of the page script, before transforms
     like the About char-wrap read their text. Plain textContent only. */
  function hydrate() {
    var m = readMap();
    els().forEach(function (el) {
      var id = el.getAttribute('data-ce'); if (!id) return;
      if (origById[id] == null) origById[id] = el.textContent;
      if (m[id] && typeof m[id].t === 'string' && m[id].t !== el.textContent) {
        el.textContent = m[id].t;   // view hook (if any) runs later via refresh()
      }
    });
    return DDSEdit;
  }

  /* Re-apply every override using view hooks — for cloud/cross-tab updates
     that arrive after the page (and its animations) already rendered. */
  function refresh() {
    var m = readMap();
    els().forEach(function (el) {
      var id = el.getAttribute('data-ce'); if (!id) return;
      if (origById[id] == null) origById[id] = el.textContent;
      var text = (m[id] && typeof m[id].t === 'string') ? m[id].t : origById[id];
      if (mode === 'edit') { el.textContent = text; }   // keep editing surface plain
      else applyView(el, id, text);
    });
  }

  function save(id, text) {
    var m = readMap();
    var me = (window.DDSAuth && DDSAuth.current && DDSAuth.current()) || null;
    if (text === (origById[id] != null ? origById[id] : '')) {
      // back to the committed text -> drop the override entirely
      if (m[id]) { delete m[id]; writeMap(m); if (window.DDSCloud) DDSCloud.tombstone('content', id); }
      return;
    }
    m[id] = { t: text, by: (me && me.name) || 'Exec', at: Date.now(), up: Date.now() };
    writeMap(m);
    if (window.DDSCloud) DDSCloud.touch('content');
  }

  function resetField(el) {
    if (!el) return;
    var id = el.getAttribute('data-ce'); if (!id) return;
    var m = readMap();
    if (m[id]) { delete m[id]; writeMap(m); if (window.DDSCloud) DDSCloud.tombstone('content', id); }
    var orig = origById[id] != null ? origById[id] : '';
    el.textContent = orig;                    // plain while editing
    if (mode !== 'edit') applyView(el, id, orig);
  }

  /* ---------------- edit mode ---------------- */
  function setMode(next) {
    if (next === 'edit' && !isExec()) return;
    mode = next;
    var editing = mode === 'edit';
    document.documentElement.classList.toggle('dds-editing', editing);
    els().forEach(function (el) {
      var id = el.getAttribute('data-ce'); if (!id) return;
      if (editing) {
        var h = hooks[id];
        if (h && h.edit) h.edit(el, currentText(id));  // e.g. un-wrap the About animation
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'true');
      } else {
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        applyView(el, id, currentText(id));            // re-render (re-wrap animated ones)
      }
    });
    renderToggle();
  }

  /* ---------------- floating control ---------------- */
  function injectStyle() {
    if (styleAdded) return; styleAdded = true;
    var css =
      '.dds-editing [data-ce]{outline:1.5px dashed rgba(75,156,211,.75);outline-offset:3px;border-radius:3px;cursor:text;transition:background .15s ease,outline-color .15s ease;}' +
      '.dds-editing [data-ce]:hover{background:rgba(75,156,211,.12);}' +
      '.dds-editing [data-ce]:focus{outline:2px solid #4B9CD3;background:rgba(75,156,211,.16);}' +
      '.dds-edit-fab{position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:"Montserrat",system-ui,sans-serif;}' +
      '.dds-edit-btn{display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;border-radius:999px;padding:12px 20px;font-weight:700;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;box-shadow:0 16px 34px -14px rgba(0,0,0,.75);transition:transform .18s ease,filter .18s ease;}' +
      '.dds-edit-btn:hover{transform:translateY(-2px);filter:brightness(1.06);}' +
      '.dds-edit-btn.view{background:linear-gradient(135deg,#13294B,#0A1A30);color:#EAF1F8;border:1px solid rgba(75,156,211,.5);}' +
      '.dds-edit-btn.done{background:linear-gradient(135deg,#B9975B,#a07f3f);color:#1a1205;}' +
      '.dds-edit-note{background:rgba(9,20,38,.95);color:#D7E2EA;border:1px solid rgba(75,156,211,.3);border-radius:12px;padding:10px 14px;font-size:11.5px;line-height:1.5;max-width:250px;box-shadow:0 16px 34px -14px rgba(0,0,0,.75);}' +
      '.dds-edit-note b{color:#E3C27C;}' +
      '.dds-edit-note button{margin-top:8px;width:100%;background:rgba(75,156,211,.14);color:#9FC6EC;border:1px solid rgba(75,156,211,.4);border-radius:8px;padding:7px;font-family:inherit;font-weight:700;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;}' +
      '.dds-edit-note button:hover{background:rgba(75,156,211,.24);}' +
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
        ? '<div class="dds-edit-note">You\'re in <b>editor mode</b>. Click any highlighted text and type — changes save automatically and sync to everyone. ' +
          '<button type="button" data-dds-reset>&#8635; Undo the field you\'re editing</button></div>'
        : '') +
      '<button type="button" class="dds-edit-btn ' + (editing ? 'done' : 'view') + '" data-dds-toggle>' +
        (editing ? '&#10003; Done editing' : '&#9998; Edit page') +
      '</button>';
  }

  /* ---------------- wiring ---------------- */
  function init() {
    hydrate();
    // register a store row for cloud sync (safe if DDSCloud absent)
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-dds-toggle]')) { setMode(mode === 'edit' ? 'view' : 'edit'); }
      else if (e.target.closest('[data-dds-reset]')) {
        if (lastField && lastField.matches && lastField.matches(SEL)) resetField(lastField);
      }
    });
    document.addEventListener('focusin', function (e) {
      if (mode === 'edit' && e.target.matches && e.target.matches(SEL)) lastField = e.target;
    });
    // save as the user types / leaves a field
    var deb = {};
    document.addEventListener('input', function (e) {
      if (mode !== 'edit') return;
      var el = e.target; if (!el.matches || !el.matches(SEL)) return;
      var id = el.getAttribute('data-ce');
      clearTimeout(deb[id]);
      deb[id] = setTimeout(function () { save(id, el.textContent); }, 500);
    });
    document.addEventListener('focusout', function (e) {
      if (mode !== 'edit') return;
      var el = e.target; if (!el.matches || !el.matches(SEL)) return;
      var id = el.getAttribute('data-ce');
      clearTimeout(deb[id]); save(id, el.textContent);
    });
    // Enter should not create newlines in single-line-ish blocks — allow it,
    // but strip pasted formatting to keep everything plain text.
    document.addEventListener('paste', function (e) {
      if (mode !== 'edit') return;
      var el = e.target; if (!el.matches || !el.matches(SEL)) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    // cross-tab + cloud updates
    window.addEventListener('storage', function (e) { if (e.key === STORE_KEY) refresh(); });
    if (window.DDSAuth && DDSAuth.onChange) DDSAuth.onChange(function () {
      if (mode === 'edit' && !isExec()) setMode('view');
      renderToggle();
    });
    if (document.body) renderToggle();
    else document.addEventListener('DOMContentLoaded', renderToggle);
  }

  var DDSEdit = {
    hydrate: hydrate,
    refresh: refresh,
    setMode: setMode,
    resetField: resetField,
    currentText: currentText,
    /* Register view/edit hooks for an animated/transformed element.
       view(el,text): render for display.  edit(el,text): prep for editing. */
    registerHook: function (id, h) { hooks[id] = h; return DDSEdit; },
    isExec: isExec
  };
  window.DDSEdit = DDSEdit;

  init();
})();

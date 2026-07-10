/* The Archive — shared UI for meeting notes. Loads after dds-minutes.js.
   Provides the exec composer overlay (markdown toolbar + live preview),
   used identically from index.html, archive.html and note.html, and
   injects the styles the composer and every rendered .md-body need, so
   the three pages can't drift apart visually.

   DDSMinutesUI.openComposer(note?, onSave) — note omitted = new record;
   onSave(savedNote) fires after a successful publish/edit. */
(function () {
  'use strict';

  var esc = function (s) { return DDSMinutes.esc(s); };

  /* ---------- injected styles (paper theme, matches The Bite) ---------- */
  var CSS = [
    '/* rendered markdown body */',
    '.md-body{font-family:"Lora",serif;font-size:clamp(1rem,1.3vw,1.1rem);line-height:1.85;color:#2c4160;}',
    '.md-body p{margin:0 0 18px;}',
    '.md-body h2,.md-body h3,.md-body h4{font-family:"Montserrat",sans-serif;color:#13294B;letter-spacing:.2px;line-height:1.3;margin:26px 0 10px;}',
    '.md-body h2{font-size:1.35em;font-weight:800;}',
    '.md-body h3{font-size:1.12em;font-weight:800;}',
    '.md-body h4{font-size:1em;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;}',
    '.md-body ul,.md-body ol{margin:0 0 18px;padding-left:26px;}',
    '.md-body li{margin:0 0 8px;}',
    '.md-body li::marker{color:#B9975B;font-weight:700;}',
    '.md-body a{color:#33719F;text-decoration-color:rgba(75,156,211,.5);text-underline-offset:3px;}',
    '.md-body hr{border:0;border-top:1px solid rgba(19,41,75,.18);margin:26px 0;}',
    '.md-body u{text-decoration-color:rgba(185,151,91,.7);text-decoration-thickness:1.5px;text-underline-offset:3px;}',
    '.md-hl{border-radius:4px;padding:1px 5px;color:#13294B;box-decoration-break:clone;-webkit-box-decoration-break:clone;}',
    '.md-hl-yellow{background:#FBEBA6;}',
    '.md-hl-gold{background:#EBD9B4;}',
    '.md-hl-blue{background:#CDE4F6;}',
    '.md-hl-green{background:#D4ECCB;}',
    '.md-hl-pink{background:#F6D6E4;}',
    '/* composer overlay */',
    '.mnc-ov{position:fixed;inset:0;z-index:320;background:rgba(4,10,22,.74);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:clamp(14px,3vw,32px);opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s;}',
    '.mnc-ov.open{opacity:1;visibility:visible;}',
    '.mnc-card{position:relative;width:min(820px,100%);max-height:min(90vh,940px);overflow-y:auto;background:#FBF8F1;color:#13294B;border-radius:14px;box-shadow:0 50px 110px -30px rgba(0,0,0,.9);transform:translateY(14px);transition:transform .3s cubic-bezier(.25,.1,.25,1);}',
    '.mnc-ov.open .mnc-card{transform:none;}',
    '.mnc-close{position:sticky;top:14px;margin-left:calc(100% - 52px);z-index:5;width:38px;height:38px;border-radius:50%;border:1px solid rgba(19,41,75,.25);background:rgba(251,248,241,.92);color:#13294B;font-size:15px;cursor:pointer;line-height:1;}',
    '.mnc-close:hover{background:#fff;}',
    '.mnc-in{padding:clamp(22px,4vw,42px);margin-top:-38px;}',
    '.mnc-in h3{margin:0 0 6px;font-family:"Lora",serif;font-weight:600;font-size:clamp(1.3rem,2.4vw,1.7rem);color:#13294B;}',
    '.mnc-sub{margin:0 0 20px;color:#5A7798;font-size:.9rem;line-height:1.6;}',
    '.mnc-in label{display:block;margin-bottom:15px;color:#33719F;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-size:10.5px;}',
    '.mnc-row2{display:grid;grid-template-columns:1fr 190px;gap:14px;}',
    '@media(max-width:560px){.mnc-row2{grid-template-columns:1fr;gap:0;}}',
    '.mnc-in input[type=text],.mnc-in input[type=date],.mnc-in textarea{display:block;width:100%;margin-top:6px;padding:12px 14px;border-radius:11px;border:1px solid rgba(19,41,75,.28);background:#fff;color:#13294B;font-family:"Montserrat",sans-serif;font-size:14px;letter-spacing:normal;text-transform:none;font-weight:500;transition:border-color .2s,box-shadow .2s;resize:vertical;box-sizing:border-box;}',
    '.mnc-in textarea{min-height:240px;line-height:1.7;font-family:"Lora",serif;font-size:15px;border-top-left-radius:0;border-top-right-radius:0;margin-top:0;}',
    '.mnc-in input:focus,.mnc-in textarea:focus{outline:none;border-color:#4B9CD3;box-shadow:0 0 0 3px rgba(75,156,211,.22);}',
    '.mnc-in input[type=file]{margin-top:6px;padding:9px;font-size:12.5px;color:#5A7798;display:block;width:100%;border:1px solid rgba(19,41,75,.28);border-radius:11px;background:#fff;box-sizing:border-box;}',
    '.mnc-hint{display:block;margin-top:5px;color:#8296AE;font-weight:500;font-size:10px;letter-spacing:.6px;text-transform:none;}',
    '.mnc-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
    '.mnc-tag{padding:7px 14px;border-radius:999px;border:1px solid rgba(19,41,75,.3);background:transparent;color:#3E5F87;font-family:"Montserrat",sans-serif;font-weight:700;letter-spacing:1.1px;font-size:10px;text-transform:uppercase;cursor:pointer;transition:background .2s,color .2s,border-color .2s;}',
    '.mnc-tag.on{background:#B9975B;border-color:#B9975B;color:#0A1A30;}',
    '.mnc-tag.on::after{content:" ✕";font-size:9px;opacity:.7;}',
    '/* custom-tag typeahead */',
    '.mnc-tagfield{position:relative;margin-top:6px;}',
    '.mnc-taginput{display:block;width:100%;padding:11px 14px;border-radius:11px;border:1px solid rgba(19,41,75,.28);background:#fff;color:#13294B;font-family:"Montserrat",sans-serif;font-size:13px;box-sizing:border-box;}',
    '.mnc-taginput:focus{outline:none;border-color:#4B9CD3;box-shadow:0 0 0 3px rgba(75,156,211,.22);}',
    '.mnc-tagsug{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:8;background:#fff;border:1px solid rgba(19,41,75,.2);border-radius:11px;box-shadow:0 18px 40px -16px rgba(19,41,75,.5);max-height:220px;overflow-y:auto;padding:5px;}',
    '.mnc-tagsug[hidden]{display:none;}',
    '.mnc-sug{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:8px;cursor:pointer;font-size:12.5px;color:#13294B;font-weight:600;}',
    '.mnc-sug:hover,.mnc-sug.active{background:#EEF4FA;}',
    '.mnc-sug .new{color:#8a6d38;font-weight:700;}',
    '.mnc-sug small{margin-left:auto;color:#8296AE;font-weight:600;font-size:9.5px;letter-spacing:1px;text-transform:uppercase;}',
    '/* photo strip */',
    '.mnc-photostrip{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 4px;}',
    '.mnc-photostrip:empty{display:none;}',
    '.mnc-pth{position:relative;width:92px;height:64px;border-radius:9px;overflow:hidden;border:1px solid rgba(19,41,75,.2);background:#0c2042;}',
    '.mnc-pth img{width:100%;height:100%;object-fit:cover;display:block;}',
    '.mnc-pth button{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(10,20,40,.82);color:#fff;font-size:10px;line-height:20px;text-align:center;cursor:pointer;padding:0;}',
    '/* markdown toolbar */',
    '.mnc-bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:6px;padding:7px 9px;border:1px solid rgba(19,41,75,.28);border-bottom:0;border-radius:11px 11px 0 0;background:#F2EDE1;}',
    '.mnc-b{min-width:32px;height:30px;padding:0 8px;border-radius:7px;border:1px solid transparent;background:transparent;color:#13294B;font-family:"Lora",serif;font-size:14px;cursor:pointer;transition:background .15s,border-color .15s;display:inline-flex;align-items:center;justify-content:center;}',
    '.mnc-b:hover{background:#fff;border-color:rgba(19,41,75,.2);}',
    '.mnc-b.on{background:#13294B;color:#F5F7FA;}',
    '.mnc-sep{width:1px;height:20px;background:rgba(19,41,75,.18);margin:0 5px;flex:none;}',
    '.mnc-sw{width:22px;height:22px;border-radius:6px;border:1px solid rgba(19,41,75,.25);cursor:pointer;padding:0;transition:transform .15s;}',
    '.mnc-sw:hover{transform:scale(1.15);}',
    '.mnc-preview{margin-top:0;min-height:240px;max-height:420px;overflow-y:auto;padding:16px 18px;border:1px solid rgba(19,41,75,.28);border-top:0;border-radius:0 0 11px 11px;background:#fff;}',
    '.mnc-preview[hidden]{display:none;}',
    '.mnc-err{display:none;margin:0 0 16px;padding:11px 14px;border-radius:10px;background:rgba(190,60,60,.09);border:1px solid rgba(190,70,70,.4);color:#A03030;font-size:12.5px;line-height:1.5;}',
    '.mnc-err.show{display:block;}',
    '.mnc-submit{display:block;width:100%;padding:15px;border-radius:999px;border:0;background:#B9975B;color:#0A1A30;font-family:"Montserrat",sans-serif;font-weight:700;letter-spacing:2px;text-transform:uppercase;font-size:12.5px;cursor:pointer;transition:transform .2s;box-shadow:0 14px 30px -12px rgba(185,151,91,.75);}',
    '.mnc-submit:hover{transform:translateY(-2px);}',
    '.mnc-note{margin:14px 0 0;color:#8296AE;font-size:11.5px;line-height:1.6;text-align:center;}'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var SWATCH = { yellow: '#FBEBA6', gold: '#EBD9B4', blue: '#CDE4F6', green: '#D4ECCB', pink: '#F6D6E4' };

  /* ---------- overlay (built lazily, once) ---------- */
  var ov = null, ta = null, onSaveCb = null, editingId = null;
  var selectedTags = [], pendingTags = [], photoData = [];

  /* ---------- tags (visual chips + typeahead + create-your-own) ---------- */
  function tagUniverse() {
    var seen = {}, out = [];
    DDSMinutes.allTags().concat(pendingTags).concat(selectedTags).forEach(function (t) {
      var k = String(t).toLowerCase();
      if (t && !seen[k]) { seen[k] = 1; out.push(t); }
    });
    return out;
  }
  function isSelected(t) {
    var k = String(t).toLowerCase();
    return selectedTags.some(function (s) { return s.toLowerCase() === k; });
  }
  function renderTagChips() {
    ov.querySelector('#mnc-tags').innerHTML = tagUniverse().map(function (t) {
      return '<button type="button" class="mnc-tag' + (isSelected(t) ? ' on' : '') + '" data-t="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
  }
  function toggleTag(t) {
    var k = String(t).toLowerCase();
    if (isSelected(t)) selectedTags = selectedTags.filter(function (s) { return s.toLowerCase() !== k; });
    else selectedTags.push(t);
    renderTagChips();
  }
  function addTypedTag(raw) {
    var t = DDSMinutes.cleanTag(raw);
    if (!t) return;
    var canon = tagUniverse().find(function (u) { return u.toLowerCase() === t.toLowerCase(); });
    if (canon) { if (!isSelected(canon)) selectedTags.push(canon); }
    else { pendingTags.push(t); selectedTags.push(t); }
    var input = ov.querySelector('#mnc-taginput');
    input.value = ''; hideSug(); renderTagChips();
  }
  var sugIdx = -1;
  function sugMatches() {
    var input = ov.querySelector('#mnc-taginput');
    var q = input.value.trim().toLowerCase();
    var pool = tagUniverse().filter(function (t) { return !isSelected(t); });
    if (q) pool = pool.filter(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
    return pool.slice(0, 8);
  }
  function renderSug() {
    var input = ov.querySelector('#mnc-taginput');
    var sug = ov.querySelector('#mnc-tagsug');
    var list = sugMatches();
    var html = list.map(function (t, i) {
      return '<div class="mnc-sug' + (i === sugIdx ? ' active' : '') + '" data-sug="' + esc(t) + '">' + esc(t) + '<small>add</small></div>';
    });
    var qc = DDSMinutes.cleanTag(input.value);
    var exists = qc && tagUniverse().some(function (t) { return t.toLowerCase() === qc.toLowerCase(); });
    if (qc && !exists) html.push('<div class="mnc-sug" data-new="' + esc(qc) + '"><span class="new">＋ Create “' + esc(qc) + '”</span></div>');
    if (!html.length) { sug.hidden = true; return; }
    sug.innerHTML = html.join(''); sug.hidden = false;
  }
  function hideSug() {
    var sug = ov && ov.querySelector('#mnc-tagsug');
    if (sug) sug.hidden = true;
    sugIdx = -1;
  }

  /* ---------- photos ---------- */
  function renderPhotoStrip() {
    ov.querySelector('#mnc-photostrip').innerHTML = photoData.map(function (d, i) {
      return '<div class="mnc-pth"><img src="' + d + '" alt=""><button type="button" data-ph="' + i + '" aria-label="Remove photo">✕</button></div>';
    }).join('');
  }
  function compressImage(file, cb) {
    if (!file || !/^image\//.test(file.type)) return cb(null);
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var w = Math.min(1000, img.naturalWidth);
      var h = Math.round(w * img.naturalHeight / img.naturalWidth);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { cb(c.toDataURL('image/jpeg', 0.72)); } catch (e) { cb(null); }
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  function build() {
    if (ov) return;
    ov = document.createElement('div');
    ov.className = 'mnc-ov';
    ov.setAttribute('aria-hidden', 'true');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML =
      '<div class="mnc-card">' +
        '<button class="mnc-close" type="button" aria-label="Close">✕</button>' +
        '<div class="mnc-in">' +
          '<h3 id="mnc-h3">Add meeting notes</h3>' +
          '<p class="mnc-sub" id="mnc-sub"></p>' +
          '<form id="mnc-form" novalidate>' +
            '<div class="mnc-row2">' +
              '<label>Title<input type="text" id="mnc-title" placeholder="e.g. Specialties Night" maxlength="80"></label>' +
              '<label>Meeting date<input type="date" id="mnc-date"></label>' +
            '</div>' +
            '<label>Secondary heading<span class="mnc-hint">The speaker or context — shows beside the title, e.g. “Dr. Marsh, UNC Adams School”.</span>' +
              '<input type="text" id="mnc-speaker" placeholder="Speaker, panel, or what this meeting was" maxlength="90"></label>' +
            '<label>Tags<span class="mnc-hint">Pick from the list, or type your own and press Enter — custom tags join the archive filters for everyone.</span></label>' +
            '<div class="mnc-tagfield">' +
              '<input type="text" id="mnc-taginput" autocomplete="off" spellcheck="false" placeholder="Type a tag and press Enter…">' +
              '<div class="mnc-tagsug" id="mnc-tagsug" hidden></div>' +
            '</div>' +
            '<div class="mnc-tags" id="mnc-tags"></div>' +
            '<label style="margin-top:15px;">Photos<span class="mnc-hint">Optional. They ride darkened along the top of this record and lift on hover — add one or several.</span>' +
              '<input type="file" id="mnc-photos" accept="image/*" multiple>' +
            '</label>' +
            '<div class="mnc-photostrip" id="mnc-photostrip"></div>' +
            '<label>The notes<span class="mnc-hint">Paste your notes — **bold**, *italic*, __underline__, ==highlights==, “- ” bullets, “1. ” numbered lists, “## ” headings.</span></label>' +
            '<div class="mnc-bar" id="mnc-bar">' +
              '<button type="button" class="mnc-b" data-md="bold" title="Bold — **text**"><strong>B</strong></button>' +
              '<button type="button" class="mnc-b" data-md="italic" title="Italic — *text*"><em>I</em></button>' +
              '<button type="button" class="mnc-b" data-md="under" title="Underline — __text__"><u>U</u></button>' +
              '<button type="button" class="mnc-b" data-md="strike" title="Strikethrough — ~~text~~"><s>S</s></button>' +
              '<span class="mnc-sep"></span>' +
              '<button type="button" class="mnc-b" data-md="h2" title="Heading — ## text" style="font-family:Montserrat,sans-serif;font-weight:800;font-size:12px;">H</button>' +
              '<button type="button" class="mnc-b" data-md="ul" title="Bulleted list">•&nbsp;—</button>' +
              '<button type="button" class="mnc-b" data-md="ol" title="Numbered list" style="font-family:Montserrat,sans-serif;font-size:12px;font-weight:700;">1.</button>' +
              '<span class="mnc-sep"></span>' +
              Object.keys(SWATCH).map(function (c) {
                return '<button type="button" class="mnc-sw" data-hl="' + c + '" title="Highlight ' + c + '" style="background:' + SWATCH[c] + ';"></button>';
              }).join('') +
              '<span style="flex:1;"></span>' +
              '<button type="button" class="mnc-b" id="mnc-prev-btn" title="Preview the formatting" style="font-family:Montserrat,sans-serif;font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:0 12px;">Preview</button>' +
            '</div>' +
            '<textarea id="mnc-body" placeholder="What did the chapter meet about?"></textarea>' +
            '<div class="mnc-preview md-body" id="mnc-preview" hidden></div>' +
            '<div style="height:16px;"></div>' +
            '<div class="mnc-err" id="mnc-err"></div>' +
            '<button type="submit" class="mnc-submit" id="mnc-submit">Publish to The Archive&nbsp;→</button>' +
          '</form>' +
          '<p class="mnc-note">Notes publish under your name and sync to every member’s browser.</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ta = ov.querySelector('#mnc-body');

    // tag chips (toggle) + typeahead input
    ov.querySelector('#mnc-tags').addEventListener('click', function (e) {
      var b = e.target.closest('.mnc-tag');
      if (b) toggleTag(b.getAttribute('data-t'));
    });
    var tagInput = ov.querySelector('#mnc-taginput');
    var sug = ov.querySelector('#mnc-tagsug');
    tagInput.addEventListener('input', function () { sugIdx = -1; renderSug(); });
    tagInput.addEventListener('focus', renderSug);
    tagInput.addEventListener('blur', function () { setTimeout(hideSug, 140); });
    tagInput.addEventListener('keydown', function (e) {
      var items = sug.hidden ? [] : Array.prototype.slice.call(sug.children);
      if (e.key === 'ArrowDown') { e.preventDefault(); sugIdx = Math.min(items.length - 1, sugIdx + 1); renderSug(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sugIdx = Math.max(0, sugIdx - 1); renderSug(); }
      else if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (sugIdx >= 0 && items[sugIdx]) items[sugIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        else addTypedTag(tagInput.value);
      } else if (e.key === 'Backspace' && !tagInput.value && selectedTags.length) {
        selectedTags.pop(); renderTagChips();
      } else if (e.key === 'Escape') { hideSug(); }
    });
    sug.addEventListener('mousedown', function (e) {
      var it = e.target.closest('[data-sug],[data-new]');
      if (!it) return;
      e.preventDefault();
      if (it.hasAttribute('data-new')) addTypedTag(it.getAttribute('data-new'));
      else {
        var t = it.getAttribute('data-sug');
        if (!isSelected(t)) selectedTags.push(t);
        tagInput.value = ''; hideSug(); renderTagChips();
      }
    });

    // photos
    var photoInput = ov.querySelector('#mnc-photos');
    photoInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(photoInput.files || []);
      photoInput.value = '';
      (function next() {
        if (!files.length) return;
        compressImage(files.shift(), function (d) {
          if (d && photoData.length < 8) photoData.push(d);
          renderPhotoStrip();
          next();
        });
      })();
    });
    ov.querySelector('#mnc-photostrip').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ph]');
      if (!b) return;
      photoData.splice(+b.getAttribute('data-ph'), 1);
      renderPhotoStrip();
    });

    // toolbar
    ov.querySelector('#mnc-bar').addEventListener('click', function (e) {
      var sw = e.target.closest('.mnc-sw');
      if (sw) { wrap('==' + sw.getAttribute('data-hl') + ':', '=='); return; }
      var b = e.target.closest('.mnc-b');
      if (!b) return;
      var op = b.getAttribute('data-md');
      if (op === 'bold') wrap('**', '**');
      else if (op === 'italic') wrap('*', '*');
      else if (op === 'under') wrap('__', '__');
      else if (op === 'strike') wrap('~~', '~~');
      else if (op === 'h2') prefixLines('## ');
      else if (op === 'ul') prefixLines('- ');
      else if (op === 'ol') prefixLines('1. ', true);
    });

    // preview toggle
    var prevBtn = ov.querySelector('#mnc-prev-btn');
    var prevEl = ov.querySelector('#mnc-preview');
    prevBtn.addEventListener('click', function () {
      var showing = prevEl.hidden;
      if (showing) prevEl.innerHTML = DDSMinutes.md(ta.value) || '<p style="color:#8296AE;">Nothing to preview yet — write some notes first.</p>';
      prevEl.hidden = !showing;
      ta.style.display = showing ? 'none' : '';
      prevBtn.classList.toggle('on', showing);
      prevBtn.textContent = showing ? 'Keep writing' : 'Preview';
    });

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.mnc-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ov.classList.contains('open')) close();
    });

    ov.querySelector('#mnc-form').addEventListener('submit', submit);
  }

  /* wrap the current textarea selection */
  function wrap(before, after) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var sel = v.slice(s, e) || 'text';
    ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
    ta.focus();
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  }
  /* prefix every line of the selection (bullets, numbers, headings) */
  function prefixLines(prefix, numbered) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var le = v.indexOf('\n', e); if (le === -1) le = v.length;
    var block = v.slice(ls, le).split('\n').map(function (ln, i) {
      var clean = ln.replace(/^\s*(?:[-*•]|\d+[.)]|#{1,3})\s+/, '');
      return (numbered ? (i + 1) + '. ' : prefix) + clean;
    }).join('\n');
    ta.value = v.slice(0, ls) + block + v.slice(le);
    ta.focus();
    ta.setSelectionRange(ls, ls + block.length);
  }

  function fail(msg) {
    var el = ov.querySelector('#mnc-err');
    el.textContent = msg;
    el.classList.add('show');
  }

  function submit(e) {
    e.preventDefault();
    ov.querySelector('#mnc-err').classList.remove('show');
    var me = DDSAuth.current();
    if (!me || !DDSMinutes.canWrite(me)) return fail('Only the exec board can publish chapter minutes.');
    var title = ov.querySelector('#mnc-title').value.trim();
    var speaker = ov.querySelector('#mnc-speaker').value.trim();
    var date = ov.querySelector('#mnc-date').value;
    var body = ta.value.trim();
    var tags = selectedTags.slice();
    var photos = photoData.slice();
    if (!title) return fail('Give the meeting a title.');
    if (!date) return fail('Set the meeting date.');
    if (!tags.length) return fail('Tag what kind of meeting this was — pick or type at least one.');
    if (body.length < 30) return fail('Paste in the notes — a record needs more than a headline.');
    var saved;
    if (editingId) {
      saved = DDSMinutes.update(editingId, { title: title, speaker: speaker, date: date, body: body, tags: tags, photos: photos });
      if (!saved) return fail('That record can’t be found any more — close and try again.');
    } else {
      saved = DDSMinutes.add({
        title: title, speaker: speaker, date: date, body: body, tags: tags, photos: photos,
        author: me.name, authorId: me.id,
        authorTitle: DDSAuth.execTitle(me) || ''
      });
    }
    close();
    if (onSaveCb) onSaveCb(saved);
  }

  function close() {
    if (!ov) return;
    ov.classList.remove('open');
    ov.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function openComposer(note, onSave) {
    var me = DDSAuth.current();
    if (!me) { DDSAuth.requireLogin((location.pathname.split('/').pop() || 'index.html') + location.hash); return; }
    if (!DDSMinutes.canWrite(me)) { alert('Chapter minutes are published by the exec board. Comments and annotations are open to every member — open any note to add yours.'); return; }
    build();
    editingId = note && note.id ? note.id : null;
    onSaveCb = onSave || null;
    ov.querySelector('#mnc-h3').textContent = editingId ? 'Edit this record' : 'Add meeting notes';
    ov.querySelector('#mnc-sub').textContent = editingId
      ? 'Editing “' + (note.title || '') + '” — changes replace the published record everywhere.'
      : 'Publishing as ' + me.name + (DDSAuth.execTitle(me) ? ' · ' + DDSAuth.execTitle(me) : '') + ' — the record files into The Archive instantly.';
    ov.querySelector('#mnc-title').value = editingId ? (note.title || '') : '';
    ov.querySelector('#mnc-speaker').value = editingId ? (note.speaker || '') : '';
    ov.querySelector('#mnc-date').value = editingId ? (note.date || '') : new Date().toISOString().slice(0, 10);
    ta.value = editingId ? (note.body || '') : '';
    selectedTags = editingId ? (note.tags || []).slice() : [];
    pendingTags = [];
    photoData = editingId ? (note.photos || []).slice() : [];
    ov.querySelector('#mnc-taginput').value = '';
    hideSug();
    renderTagChips();
    renderPhotoStrip();
    ov.querySelector('#mnc-submit').innerHTML = editingId ? 'Save changes&nbsp;→' : 'Publish to The Archive&nbsp;→';
    ov.querySelector('#mnc-err').classList.remove('show');
    // reset preview state
    var prevEl = ov.querySelector('#mnc-preview'), prevBtn = ov.querySelector('#mnc-prev-btn');
    prevEl.hidden = true; ta.style.display = '';
    prevBtn.classList.remove('on'); prevBtn.textContent = 'Preview';
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { ov.querySelector('#mnc-title').focus(); }, 90);
  }

  window.DDSMinutesUI = { openComposer: openComposer };
})();

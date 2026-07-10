/* The Archive — DDS meeting-notes store. Shared by index.html (front-page
   3-up scroller), archive.html (full minute book) and note.html (single
   record + annotations). Exec-written notes live in localStorage
   (dds-minutes-v1); member comments/annotations in dds-minute-comments-v1.
   Both mirror to the cloud through dds-cloud.js ('minutes' /
   'minuteComments'). The seed records below are the published starting
   archive — like The Bite's seeds they never sync, and edits to them are
   copy-on-write.

   Note bodies are markdown in the site dialect rendered by md():
     **bold**  *italic*  __underline__  ~~strike~~  [text](url)
     ==highlight==  ==gold:highlight==  (yellow, gold, blue, green, pink)
     # / ## / ### headings · "- " bullets · "1. " numbered · --- rule */
(function () {
  'use strict';

  var STORE_KEY = 'dds-minutes-v1';
  var COMMENTS_KEY = 'dds-minute-comments-v1';

  var TAGS = ['General Body', 'Guest Speaker', 'Service', 'Professional', 'Social', 'Rush', 'Elections', 'Workshop'];
  var HL_COLORS = ['yellow', 'gold', 'blue', 'green', 'pink'];

  var SEED = [
    {
      id: 'seed-mn-10', date: '2026-04-20',
      title: 'Senior Sendoff', speaker: 'Hosted by the Exec Board',
      tags: ['General Body', 'Social'], author: 'Exec Board',
      body: 'Celebrating our graduating members — dental school commitments, superlatives, and a look back at the year in photos.\n\n## Where the seniors are headed\n- **UNC Adams School of Dentistry** — 4 members\n- **VCU School of Dentistry** — 2 members\n- **MUSC College of Dental Medicine** — 1 member\n- Gap years with clinical jobs — 3 members\n\n## Superlatives\n1. *Most likely to run their own practice by 30*\n2. *Most service hours in chapter history* — ==gold:214 hours==\n3. *Best big/little duo*\n\nThank you, seniors — the chapter is what it is because of you. Underclassmen: the photo slideshow is linked in the members channel.'
    },
    {
      id: 'seed-mn-9', date: '2026-04-06',
      title: 'Elections & Awards', speaker: 'Run by the outgoing board',
      tags: ['General Body', 'Elections'], author: 'Exec Board',
      body: 'The 2026–27 executive board election results, plus annual service award recipients and end-of-year points standings.\n\n## Your 2026–27 board\n1. **President** — announced at the meeting\n2. **Vice President** — announced at the meeting\n3. **Secretary, Treasurer, Service Coordinator** — see the members channel for the full slate\n\n==Transition dinners happen the last week of April== — new officers, watch your email for the handoff docs.\n\n## Awards\n- *Golden Molar* (most service hours)\n- *Rookie of the Year* (standout new member)\n- *Chapter Champion* (points leader)'
    },
    {
      id: 'seed-mn-8', date: '2026-03-30',
      title: 'DAT Prep Panel', speaker: 'Panel of five 22+ scorers',
      tags: ['General Body', 'Professional', 'Guest Speaker'], author: 'Exec Board',
      body: 'Upperclassmen shared study timelines, resource picks, and score breakdowns — full panel Q&A captured in the notes.\n\n## The consensus timeline\n1. **8–10 weeks out** — content review, two science sections at a time\n2. **4 weeks out** — switch entirely to practice exams\n3. **Final week** — light review only; ==blue:your practice-exam average predicts your real score==\n\n## Resource picks\n- **DAT Booster** — best PAT generators, chapter discount code in the listserv\n- **Anki** — the panelists were split on premade vs. self-made decks\n- *Chad’s Prep* for gen chem refreshers\n\nFull Q&A transcript: ask the Secretary — it ran 40 minutes and is worth every one.'
    },
    {
      id: 'seed-mn-7', date: '2026-03-23',
      title: 'Service Recap', speaker: 'Led by the Service Coordinator',
      tags: ['General Body', 'Service'], author: 'Exec Board',
      body: 'Give Kids a Smile day results, spring service hour totals, and how to log remaining points before the deadline.\n\n## By the numbers\n- **114 kids screened**, 61 fluoride varnish treatments\n- ==green:340 chapter service hours== this semester — best spring on record\n- 12 members hit the 40-hour bar early\n\n## Before the deadline\n1. Log everything in the points sheet by **April 15**\n2. Photos from service events go to the Website chair for the gallery\n3. SECU Family House dinners continue monthly through summer — __these count for fall too__'
    },
    {
      id: 'seed-mn-6', date: '2026-03-02',
      title: 'Service Day Planning', speaker: 'Led by the Service Coordinator',
      tags: ['General Body', 'Service', 'Workshop'], author: 'Exec Board',
      body: 'Sign-ups and logistics for the spring community service events, plus carpools and what to bring.\n\n## The lineup\n- **Give Kids a Smile** — March 20, UNC Adams School, shifts from 8 AM\n- **Frank Porter Graham Elementary** supply drive — collection bins in the Union\n- **SECU Family House** dinner — first Wednesday, 5:30 PM\n\n## Logistics\n1. Carpools organize in the members chat — drivers get ==gold:1 bonus point==\n2. Wear the chapter t-shirt; closed-toe shoes for clinic days\n3. *Sign-up links close Friday at noon* — waitlist after that'
    },
    {
      id: 'seed-mn-5', date: '2026-02-23',
      title: 'Alumni Q&A', speaker: 'Three DDS alumni, now D1–D3 students',
      tags: ['General Body', 'Guest Speaker', 'Professional'], author: 'Exec Board',
      body: 'DDS alumni now in dental school answered questions on applications, interviews, and first-year life.\n\n## What they told us\n- **On applying:** submit AADSAS in *June or July* — schools read in order of completion\n- **On interviews:** your “why dentistry” answer should be __a scene, not a summary__\n- **On D1 year:** ==the hardest part is time management, not the material==\n\n## Follow-ups\n1. All three offered to read personal statements — emails in the members channel\n2. Mock interview sign-ups open next week\n3. One is recruiting a summer shadow at her clinic in Durham'
    },
    {
      id: 'seed-mn-4', date: '2026-02-16',
      title: 'Specialties Night', speaker: 'Dr. Marsh, UNC Adams School of Dentistry',
      tags: ['General Body', 'Guest Speaker'], author: 'Exec Board',
      body: 'Guest lecturer overview of the dental specialties — orthodontics, OMFS, pediatrics, endo, and public health paths.\n\n## The map\n1. **Orthodontics** — 2–3 year residency, most competitive match\n2. **OMFS** — 4–6 years, MD option, hospital-based\n3. **Pediatrics** — 2 years, ==pink:fastest-growing demand==\n4. **Endodontics** — 2 years, procedure-focused\n5. **Public health** — MPH pairing, loan repayment programs\n\nDr. Marsh’s advice: *don’t pick a specialty before dental school* — pick experiences that show you the breadth. Her biomaterials lab takes undergrad researchers every fall.'
    },
    {
      id: 'seed-mn-3', date: '2026-02-09',
      title: 'Rush Week Recap', speaker: 'Welcome, spring rush class!',
      tags: ['General Body', 'Rush', 'Social'], author: 'Exec Board',
      body: 'Welcome to our newest rush class! Bid results, family reveals, and the semester calendar walkthrough.\n\n## New member checklist\n1. Join the **members chat** and the listserv\n2. Create your account on the chapter site — dues info comes by email\n3. Family reveal is **Friday** — wear your bid-day shirt\n\n- ==blue:19 new members== — our biggest spring class yet\n- Big/little matching forms close Wednesday\n- *First new-member meeting:* next Monday, 7 PM, same room'
    },
    {
      id: 'seed-mn-2', date: '2026-01-26',
      title: 'Points Overview', speaker: 'Walkthrough by the Treasurer',
      tags: ['General Body', 'Workshop'], author: 'Exec Board',
      body: 'How the points system works — service, professional, and social categories, minimums, and submission forms.\n\n## The three buckets\n- **Service** — clinics, drives, community events\n- **Professional** — panels, DAT prep, conferences\n- **Social** — socials, family nights, traditions\n\n## Staying in good standing\n1. Hit the semester minimum in **each** bucket, not just the total\n2. Log points within __one week__ of the event\n3. Disputes go to the Treasurer by email — ==receipts or photos help==\n\nThe live points sheet is linked from the Points section of the site.'
    },
    {
      id: 'seed-mn-1', date: '2026-01-12',
      title: 'Spring Kickoff', speaker: 'Welcome back from the President',
      tags: ['General Body'], author: 'Exec Board',
      body: 'Spring 2026 welcome meeting — semester goals, rush timeline, and introductions from the executive board.\n\n## Semester goals\n1. **400 service hours** as a chapter\n2. Two professional panels and a specialties night\n3. Every member paired into a big/little family\n\n## Key dates\n- **Rush week** — Feb 2–6, tell your pre-dental friends\n- **Give Kids a Smile** — March 20\n- **Elections** — April 6\n\n*Meetings are Mondays at 7 PM all semester* — notes post here within the week.'
    }
  ];

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (e) { return []; }
  }
  function save(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    if (window.DDSCloud) { try { DDSCloud.touch('minutes'); } catch (e) {} }
  }
  function loadComments() {
    try { return JSON.parse(localStorage.getItem(COMMENTS_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveComments(list) {
    localStorage.setItem(COMMENTS_KEY, JSON.stringify(list));
    if (window.DDSCloud) { try { DDSCloud.touch('minuteComments'); } catch (e) {} }
  }
  function uid(p) { return (p || 'm') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- markdown (site dialect) ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s) {
    s = esc(s);
    // links — http(s) only, opened in a new tab
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<u>$1</u>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    // ==gold:text== colored highlight, ==text== defaults to yellow
    s = s.replace(/==(?:(yellow|gold|blue|green|pink):)?([^=]+)==/g, function (_, c, t) {
      return '<mark class="md-hl md-hl-' + (c || 'yellow') + '">' + t + '</mark>';
    });
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s;
  }
  /* Full block-level render. Returns HTML for a .md-body container. */
  function md(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], list = null;
    function flushPara() {
      if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
    }
    function flushList() {
      if (list) {
        out.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>');
        list = null;
      }
    }
    lines.forEach(function (ln) {
      var m;
      if (/^\s*$/.test(ln)) { flushPara(); flushList(); return; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(ln))) {
        flushPara(); flushList();
        var h = m[1].length + 1; // # -> h2 … ### -> h4
        out.push('<h' + h + '>' + inline(m[2]) + '</h' + h + '>');
        return;
      }
      if (/^\s*---+\s*$/.test(ln)) { flushPara(); flushList(); out.push('<hr>'); return; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(ln))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(ln))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      flushList();
      para.push(ln);
    });
    flushPara(); flushList();
    return out.join('');
  }
  /* First real paragraph with all markdown stripped — for cards and rows. */
  function excerpt(note, max) {
    var lines = String((note && note.body) || '').replace(/\r\n?/g, '\n').split('\n');
    var ln = '';
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t && !/^#{1,3}\s/.test(t) && !/^---+$/.test(t)) { ln = t; break; }
    }
    ln = ln.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/==(?:(?:yellow|gold|blue|green|pink):)?([^=]+)==/g, '$1')
      .replace(/(\*\*|__|~~|\*)/g, '');
    if (max && ln.length > max) ln = ln.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return ln;
  }

  var api = {
    TAGS: TAGS,
    HL_COLORS: HL_COLORS,
    md: md,
    inline: inline,
    esc: esc,
    excerpt: excerpt,

    slug: function (tag) { return String(tag).toLowerCase().replace(/\s+/g, '-'); },
    fromSlug: function (slug) {
      var s = String(slug).toLowerCase();
      return api.allTags().find(function (t) { return api.slug(t) === s; }) || null;
    },

    /* The living tag universe: the base list, then every custom tag any
       note actually uses (alphabetical). Custom tags become permanent and
       chapter-wide the moment a note carrying one syncs — no separate store
       to keep in step. */
    allTags: function () {
      var seen = {}, out = [];
      TAGS.forEach(function (t) { var k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(t); } });
      var extra = [];
      api.all().forEach(function (n) {
        (n.tags || []).forEach(function (t) {
          var k = String(t).toLowerCase();
          if (k && !seen[k]) { seen[k] = 1; extra.push(t); }
        });
      });
      extra.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0; });
      return out.concat(extra);
    },

    /* Tidy a typed custom tag: trim, collapse spaces, Title Case, cap length.
       Returns '' for junk so the composer can reject it. */
    cleanTag: function (raw) {
      var t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 28);
      if (!t) return '';
      return t.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    },

    fmtDate: function (iso) {
      var p = String(iso).slice(0, 10).split('-');
      return MONTHS[(+p[1] || 1) - 1] + ' ' + (+p[2] || 1) + ', ' + p[0];
    },

    /* All notes, newest first, each stamped with .no — its chronological
       "Minute Record Nº" (oldest meeting = Nº 1). Saved rows with
       replaces:<seed-id> stand in for that seed (copy-on-write). */
    all: function () {
      var saved = loadSaved();
      var replaced = {};
      saved.forEach(function (p) { if (p.replaces) replaced[p.replaces] = true; });
      var rows = SEED.filter(function (s) { return !replaced[s.id]; }).concat(saved);
      rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      rows.forEach(function (r, i) { r.no = i + 1; });
      return rows.reverse();
    },

    latest: function (n) { return api.all().slice(0, n); },

    get: function (id) {
      return api.all().find(function (p) { return p.id === id; }) || null;
    },

    add: function (note) {
      var list = loadSaved();
      note.id = uid('mn');
      list.push(note);
      save(list);
      return note;
    },

    /* Saved notes update in place; seed records get a copy-on-write row
       (new id, replaces:<seed-id>) so the edit can sync — deleting the
       copy restores the original record. */
    update: function (id, fields) {
      var EDITABLE = ['title', 'speaker', 'body', 'tags', 'date', 'photos'];
      var list = loadSaved();
      var mine = list.find(function (p) { return p.id === id; });
      if (mine) {
        EDITABLE.forEach(function (k) { if (k in fields) mine[k] = fields[k]; });
        mine.editedAt = new Date().toISOString().slice(0, 10);
        save(list);
        return mine;
      }
      var seed = SEED.find(function (s) { return s.id === id; });
      if (!seed) return null;
      var copy = {};
      for (var k in seed) copy[k] = seed[k];
      delete copy.no;
      EDITABLE.forEach(function (k2) { if (k2 in fields) copy[k2] = fields[k2]; });
      copy.id = uid('mn');
      copy.replaces = seed.id;
      copy.editedAt = new Date().toISOString().slice(0, 10);
      list.push(copy);
      save(list);
      return copy;
    },

    remove: function (id) {
      save(loadSaved().filter(function (p) { return p.id !== id; }));
    },

    /* Only the exec board writes and edits chapter minutes. */
    canWrite: function (member) {
      var m = member || (window.DDSAuth && DDSAuth.current());
      try { return !!(m && window.DDSAuth && DDSAuth.isExec(m)); } catch (e) { return false; }
    },

    /* ---------- comments & annotations ---------- */
    /* Two shapes share one store (one row each, so concurrent writers never
       clobber in the cloud):
         comment    { id, noteId, kind:'comment', body, author… , at }
         annotation { id, noteId, kind:'annotation', color, quote, start,
                      len, comment, author… , at }
       Annotations anchor to a character range [start, start+len) in the
       note body's rendered text and carry a margin comment. */
    entriesFor: function (noteId) {
      // an edited seed keeps its entries: they were filed under the seed id
      var note = api.get(noteId);
      var ids = [noteId];
      if (note && note.replaces) ids.push(note.replaces);
      return loadComments()
        .filter(function (c) { return ids.indexOf(c.noteId) !== -1; })
        .sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    },

    // back-compat alias
    commentsFor: function (noteId) { return api.entriesFor(noteId); },

    plainCommentsFor: function (noteId) {
      return api.entriesFor(noteId).filter(function (c) { return c.kind !== 'annotation'; });
    },
    annotationsFor: function (noteId) {
      return api.entriesFor(noteId).filter(function (c) { return c.kind === 'annotation'; });
    },

    commentCount: function (noteId) { return api.entriesFor(noteId).length; },

    addComment: function (noteId, kind, body, member) {
      var m = member || (window.DDSAuth && DDSAuth.current());
      if (!m) return null;
      var c = {
        id: uid('mc'), noteId: noteId,
        kind: kind === 'annotation' ? 'annotation' : 'comment',
        body: String(body || '').trim(),
        author: m.name, authorId: m.id,
        authorTitle: (window.DDSAuth && DDSAuth.execTitle(m)) || '',
        at: Date.now()
      };
      if (!c.body) return null;
      var list = loadComments();
      list.push(c);
      saveComments(list);
      return c;
    },

    /* Create a highlight annotation anchored to [start, start+len). A blank
       comment is allowed — a bare colored highlight is a valid annotation. */
    addAnnotation: function (noteId, data, member) {
      var m = member || (window.DDSAuth && DDSAuth.current());
      if (!m) return null;
      if (!data || !(data.len > 0)) return null;
      var c = {
        id: uid('ma'), noteId: noteId, kind: 'annotation',
        color: HL_COLORS.indexOf(data.color) !== -1 ? data.color : 'yellow',
        quote: String(data.quote || '').slice(0, 500),
        start: data.start | 0, len: data.len | 0,
        comment: String(data.comment || '').trim(),
        author: m.name, authorId: m.id,
        authorTitle: (window.DDSAuth && DDSAuth.execTitle(m)) || '',
        at: Date.now()
      };
      var list = loadComments();
      list.push(c);
      saveComments(list);
      return c;
    },

    updateEntry: function (id, fields) {
      var list = loadComments();
      var c = list.find(function (x) { return x.id === id; });
      if (!c) return null;
      ['body', 'comment', 'color'].forEach(function (k) { if (k in fields) c[k] = fields[k]; });
      saveComments(list);
      return c;
    },

    removeComment: function (id) {
      saveComments(loadComments().filter(function (c) { return c.id !== id; }));
    },

    canRemoveComment: function (c, member) {
      var m = member || (window.DDSAuth && DDSAuth.current());
      if (!c || !m) return false;
      if (c.authorId === m.id) return true;
      try { return !!(window.DDSAuth && DDSAuth.isExec(m)); } catch (e) { return false; }
    }
  };

  window.DDSMinutes = api;
})();

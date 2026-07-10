/* The Bite — DDS weekly newsletter/blog store. Shared by index.html
   (front-page preview) and newsletter.html (full archive + composer).
   Member-written posts live in localStorage (dds-newsletter-v1); the
   seed issues below are the published starting archive. */
(function () {
  'use strict';

  var STORE_KEY = 'dds-newsletter-v1';

  var TAGS = ['Service', 'Newsletter', 'Blog Post', 'Research', 'Dental', 'DAT', 'Applications', 'Interviews'];

  var SEED = [
    {
      id: 'seed-24', issue: 24, date: '2026-06-29',
      title: 'Summer Shadowing Diaries: 40 Hours in Private Practice',
      author: 'Bree Harris', img: 'slot-mq-5.webp',
      tags: ['Blog Post', 'Dental'],
      body: 'Forty hours into my summer shadowing placement, the biggest surprise isn’t the clinical work — it’s the choreography. A well-run practice moves like a pit crew: the assistant is loading the next tray before the doctor asks, the front desk is already rescheduling the 2 PM who called from the parking lot.\n\nIf you’re starting your own hours this summer, three things to watch for: how the dentist explains treatment plans to anxious patients, what happens when the schedule falls apart at 10 AM, and how often the hygienists catch what everyone else missed.\n\nDrop your own shadowing stories in next week’s issue — we’re collecting them all summer.'
    },
    {
      id: 'seed-23', issue: 23, date: '2026-06-22',
      title: 'The July DAT Push: An 8-Week Study Plan That Works',
      author: 'Aaryan Patel', img: 'slot-mq-3.webp',
      tags: ['Newsletter', 'DAT'],
      body: 'July test dates are eight weeks out, which means it’s officially structured-study season. The plan our highest scorers keep coming back to: two weeks of content review per science section, then four straight weeks of practice exams with full review days between them.\n\nBooth’s PAT generators are free through the chapter this summer — check the listserv email from June 10 for the code. And remember the golden rule from our DAT Prep Panel: your practice-exam average predicts your real score better than any amount of rereading notes.\n\nStudy groups meet Tuesdays and Thursdays, 6 PM, Davis Library third floor.'
    },
    {
      id: 'seed-22', issue: 22, date: '2026-06-15',
      title: 'AADSAS Opens: What To Have Ready Before You Hit Submit',
      author: 'Pearce Barnes', img: 'slot-mq-11.webp',
      tags: ['Newsletter', 'Applications'],
      body: 'The 2027 AADSAS cycle opened this week. Before you touch the application, have these finalized: your transcript entry (order transcripts NOW — UNC takes up to two weeks in summer), your experiences list with hours and supervisor contacts, and a personal statement that at least two humans have read.\n\nEarly submission matters more than polish on the margins. Schools read in the order applications complete, and July applicants interview in the fall while December applicants fight for scraps.\n\nOur application workshop series starts next Monday — bring your drafts. Alumni readers from the Adams School will be there for the last session.'
    },
    {
      id: 'seed-21', issue: 21, date: '2026-06-08',
      title: 'Research Spotlight: Enamel Remineralization at the Adams School',
      author: 'Yunah Kim', img: 'slot-mq-9.webp',
      tags: ['Blog Post', 'Research'],
      body: 'Two DDS members spent the spring semester in Dr. Marsh’s biomaterials lab studying fluoride-free remineralization agents — and their poster just took second place at the Carolina Undergraduate Research Symposium.\n\nThe short version: hydroxyapatite nanoparticle pastes are showing real promise for patients who can’t tolerate high-fluoride treatments, and the lab needs undergrad hands for the fall cohort.\n\nIf you’ve been looking for a research home that’s actually dental (not just dental-adjacent), this is the one. Applications for fall lab positions are due July 20 — details and the PI’s contact are in the members’ channel.'
    },
    {
      id: 'seed-20', issue: 20, date: '2026-06-01',
      title: 'Give Kids A Smile: Spring Service Recap in Photos',
      author: 'Emily Lian', img: 'slot-mq-1.webp',
      tags: ['Newsletter', 'Service'],
      body: 'Final numbers from our spring Give Kids A Smile day: 114 kids screened, 61 fluoride varnish treatments, and one very patient tooth mascot who high-fived every single child in line.\n\nDDS members logged 340 service hours this semester — our best spring on record. Summer service continues with the SECU Family House dinners (first Wednesday of each month) and the July school-supply drive for Frank Porter Graham Elementary.\n\nService points for fall rush credit start counting June 1, so log everything — yes, including today.'
    },
    {
      id: 'seed-19', issue: 19, date: '2026-05-25',
      title: 'Mock Interview Season: Answering “Why Dentistry?”',
      author: 'Leila Tellez', img: 'slot-mq-8.webp',
      tags: ['Blog Post', 'Interviews'],
      body: 'Every dental school interview asks it, and almost everyone answers it the same way: a story about a childhood orthodontist and a love of “working with their hands.” Admissions committees hear that answer forty times a day.\n\nWhat works better: specificity. The moment you watched a dentist talk a terrified patient into the chair. The shadowing day you realized the diagnosis happened in conversation, not on the X-ray. Your answer should be a scene, not a summary.\n\nMock interviews with alumni run through June — sign up through the link in the members’ portal. Bring your worst answer and we’ll rebuild it together.'
    }
  ];

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (e) { return []; }
  }
  function save(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    if (window.DDSCloud) { try { DDSCloud.touch('news'); } catch (e) {} }
  }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var api = {
    TAGS: TAGS,

    slug: function (tag) { return String(tag).toLowerCase().replace(/\s+/g, '-'); },
    fromSlug: function (slug) {
      var s = String(slug).toLowerCase();
      return api.allTags().find(function (t) { return api.slug(t) === s; }) || null;
    },

    /* The living tag universe: base tags first, then every custom tag any
       post uses (alphabetical). A custom tag becomes permanent + site-wide
       the moment a post carrying it syncs. */
    allTags: function () {
      var seen = {}, out = [];
      TAGS.forEach(function (t) { var k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(t); } });
      var extra = [];
      api.all().forEach(function (p) {
        (p.tags || []).forEach(function (t) {
          var k = String(t).toLowerCase();
          if (k && !seen[k]) { seen[k] = 1; extra.push(t); }
        });
      });
      extra.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0; });
      return out.concat(extra);
    },

    cleanTag: function (raw) {
      var t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 28);
      if (!t) return '';
      return t.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    },

    fmtDate: function (iso) {
      var p = String(iso).slice(0, 10).split('-');
      return MONTHS[(+p[1] || 1) - 1] + ' ' + (+p[2] || 1) + ', ' + p[0];
    },

    /* All posts, newest first. Member posts carry authorId. A saved post
       with replaces:<seed-id> is an edited copy of that seed issue and
       stands in for it (copy-on-write — the seed constant is never mutated,
       and deleting the copy restores the original issue). */
    all: function () {
      var saved = loadSaved();
      var replaced = {};
      saved.forEach(function (p) { if (p.replaces) replaced[p.replaces] = true; });
      var seeds = SEED.filter(function (s) { return !replaced[s.id]; });
      return seeds.concat(saved).sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.issue || 0) - (a.issue || 0);
      });
    },

    latest: function (n) { return api.all().slice(0, n); },

    nextIssue: function () {
      return api.all().reduce(function (mx, p) { return Math.max(mx, p.issue || 0); }, 0) + 1;
    },

    add: function (post) {
      var list = loadSaved();
      post.id = uid();
      post.issue = api.nextIssue();
      list.push(post);
      save(list);
      return post;
    },

    /* Edit a post after publication. Saved posts update in place; seed
       issues get a copy-on-write row (new id, replaces:<seed-id>) so the
       edit can sync to the cloud (seed- ids never sync). Returns the
       post that should be shown, or null if the id is unknown. */
    update: function (id, fields) {
      var EDITABLE = ['title', 'body', 'tags', 'img'];
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
      EDITABLE.forEach(function (k2) { if (k2 in fields) copy[k2] = fields[k2]; });
      copy.id = uid();
      copy.replaces = seed.id;
      copy.editedAt = new Date().toISOString().slice(0, 10);
      list.push(copy);
      save(list);
      return copy;
    },

    remove: function (id) {
      save(loadSaved().filter(function (p) { return p.id !== id; }));
    },

    isMine: function (post, member) {
      return !!(post && member && post.authorId === member.id);
    },

    /* Who may edit/delete a post through the UI: its author, or any exec. */
    canEdit: function (post, member) {
      if (!post || !member) return false;
      if (api.isMine(post, member)) return true;
      try { return !!(window.DDSAuth && DDSAuth.isExec && DDSAuth.isExec(member)); } catch (e) { return false; }
    }
  };

  window.DDSNews = api;
})();

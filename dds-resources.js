/* DDS member toolkit — the chapter's shared link + file library, sorted
   into five standing categories. Every member can add their own resources
   and edit or remove the ones they added; exec can curate any of them.
   Links and uploaded files (PDFs, slides, images) all live here.

   Storage: localStorage key dds-resources-v2, mirrored to the shared
   cloud database by dds-cloud.js (store name "resources") so a link one
   member adds shows up for the whole chapter. Seed rows carry seed-* ids
   and stay local — they're examples, never uploaded. Uploaded files ride
   the cloud's fileUpload()/fileGet() (chunked base64) when configured,
   and fall back to an inline data URL on a single device otherwise. */
(function () {
  'use strict';

  var KEY = 'dds-resources-v2';

  /* Five standing folders. Colors line up with the dashboard accents so a
     category reads the same on the homepage banner and in the toolkit. */
  var CATS = [
    { id: 'apps',     name: 'Applications',        tag: 'AADSAS · timelines · essays',      acc: 'cyan',   icon: 'doc' },
    { id: 'dat',      name: 'DAT & Test Prep',     tag: 'Content, practice, scheduling',    acc: 'gold',   icon: 'brain' },
    { id: 'shadow',   name: 'Shadowing & Clinical',tag: 'Hours, contacts, logging',         acc: 'orange', icon: 'tooth' },
    { id: 'chapter',  name: 'Chapter & Points',    tag: 'Sheets, forms, standing',          acc: 'blue',   icon: 'flag' },
    { id: 'research', name: 'Scholarships & Research', tag: 'Funding, labs, publications',   acc: 'pink',   icon: 'flask' }
  ];
  var CAT_IDS = CATS.map(function (c) { return c.id; });

  var BASE = [
    { id: 'seed-r-aadsas', cat: 'apps', title: 'ADEA AADSAS application', url: 'https://www.adea.org/dental_education_pathways/aadsas/',
      blurb: 'The centralized dental school application — timelines, fees, and the portal itself.', by: 'Exec Board', byId: 'exec', at: Date.now() - 40 * 864e5 },
    { id: 'seed-r-essay', cat: 'apps', title: 'Personal statement guide (ASDA)', url: 'https://www.asdanet.org/index/dental-education/applying-to-dental-school/personal-statement',
      blurb: 'How to frame the “why dentistry” essay, with examples and common pitfalls.', by: 'Exec Board', byId: 'exec', at: Date.now() - 39 * 864e5 },
    { id: 'seed-r-dat', cat: 'dat', title: 'DAT — official ADA guide', url: 'https://www.ada.org/education/testing/dat',
      blurb: 'Registration, test content breakdown, and score reporting straight from the ADA.', by: 'Exec Board', byId: 'exec', at: Date.now() - 38 * 864e5 },
    { id: 'seed-r-datbootcamp', cat: 'dat', title: 'DAT Bootcamp study schedules', url: 'https://datbootcamp.com/',
      blurb: 'The prep everyone in the chapter seems to use — start with the free study schedules.', by: 'Exec Board', byId: 'exec', at: Date.now() - 37 * 864e5 },
    { id: 'seed-r-shadow', cat: 'shadow', title: 'Finding shadowing hours', url: 'https://www.asdanet.org/index/get-involved/predental/shadowing',
      blurb: 'How to cold-email offices, what to ask, and how many hours schools want to see.', by: 'Exec Board', byId: 'exec', at: Date.now() - 36 * 864e5 },
    { id: 'seed-r-asod', cat: 'shadow', title: 'UNC Adams School of Dentistry', url: 'https://www.dentistry.unc.edu/',
      blurb: 'Admissions requirements, DEAH days, and events at our home-state dental school.', by: 'Exec Board', byId: 'exec', at: Date.now() - 35 * 864e5 },
    { id: 'seed-r-points', cat: 'chapter', title: 'Chapter points & hours sheet', url: 'https://docs.google.com/spreadsheets/d/1yXCL-EK5xeVeIATHolpgLdSzQcEDcndSCJL4bbnPFE4/',
      blurb: 'The live spreadsheet behind your dashboard gauges — check your logged hours and meetings.', by: 'Exec Board', byId: 'exec', at: Date.now() - 34 * 864e5 },
    { id: 'seed-r-asda', cat: 'chapter', title: 'ASDA pre-dental membership', url: 'https://www.asdanet.org/index/get-involved/predental',
      blurb: 'National pre-dental membership, publications, and application advice from ASDA.', by: 'Exec Board', byId: 'exec', at: Date.now() - 33 * 864e5 },
    { id: 'seed-r-research', cat: 'research', title: 'UNC Office for Undergraduate Research', url: 'https://our.unc.edu/',
      blurb: 'Find a lab, apply for a research grant, and log faculty mentors on campus.', by: 'Exec Board', byId: 'exec', at: Date.now() - 32 * 864e5 }
  ];

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(saved)) return normalize(saved);
    } catch (e) {}
    return BASE.slice();
  }
  /* Keep every row inside a real category and carry an id. */
  function normalize(list) {
    return list.map(function (r) {
      if (!r.id) r.id = uid();
      if (CAT_IDS.indexOf(r.cat) < 0) r.cat = 'chapter';
      return r;
    });
  }
  function save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    if (window.DDSCloud) DDSCloud.touch('resources');
  }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { return new URL(u).href; } catch (e) { return ''; }
  }

  window.DDSResources = {
    KEY: KEY,
    CATS: CATS,
    BASE: BASE,
    all: load,
    save: save,
    uid: uid,
    normUrl: normUrl,
    cat: function (id) { return CATS.find(function (c) { return c.id === id; }) || CATS[3]; },
    byCat: function () {
      var groups = {}; CATS.forEach(function (c) { groups[c.id] = []; });
      load().forEach(function (r) { (groups[r.cat] || groups.chapter).push(r); });
      CATS.forEach(function (c) { groups[c.id].sort(function (a, b) { return (b.at || 0) - (a.at || 0); }); });
      return groups;
    },
    counts: function () {
      var g = this.byCat(), out = {};
      CATS.forEach(function (c) { out[c.id] = g[c.id].length; });
      return out;
    },
    add: function (rec) {
      var list = load();
      var row = { id: uid(), cat: rec.cat, title: rec.title, blurb: rec.blurb || '',
        by: rec.by || '', byId: rec.byId || '', at: Date.now() };
      if (rec.url) row.url = rec.url;
      if (rec.fileId) { row.fileId = rec.fileId; row.fileName = rec.fileName || 'file'; row.mime = rec.mime || ''; }
      if (rec.fileData) row.fileData = rec.fileData; // single-device fallback (no cloud)
      list.push(row);
      save(list);
      return row;
    },
    update: function (id, fields) {
      var list = load();
      var r = list.find(function (x) { return x.id === id; });
      if (r) { Object.keys(fields).forEach(function (k) { r[k] = fields[k]; }); save(list); }
      return list;
    },
    remove: function (id) {
      save(load().filter(function (x) { return x.id !== id; }));
      if (window.DDSCloud) DDSCloud.tombstone('resources', id);
    }
  };
})();

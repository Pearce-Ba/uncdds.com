/* DDS member resources — the link library the exec board curates for the
   chapter (dashboard.html "Resources" section). Seed links live here; once
   an exec member edits the list in their browser, the full list persists in
   localStorage (dds-resources-v1). Viewing requires login (the dashboard is
   already gated); editing is exec-only via DDSAuth.isExec(). */
(function () {
  'use strict';

  var KEY = 'dds-resources-v1';

  var BASE = [
    { id: 'r-aadsas', title: 'ADEA AADSAS application', url: 'https://www.adea.org/dental_education_pathways/aadsas/',
      blurb: 'The centralized dental school application — timelines, fees, and the portal itself.' },
    { id: 'r-dat', title: 'DAT — official ADA guide', url: 'https://www.ada.org/education/testing/dat',
      blurb: 'Registration, test content breakdown, and score reporting straight from the ADA.' },
    { id: 'r-points', title: 'Chapter points & hours sheet', url: 'https://docs.google.com/spreadsheets/d/1yXCL-EK5xeVeIATHolpgLdSzQcEDcndSCJL4bbnPFE4/',
      blurb: 'The live spreadsheet behind your dashboard gauges — check your logged hours and meetings.' },
    { id: 'r-asod', title: 'UNC Adams School of Dentistry', url: 'https://www.dentistry.unc.edu/',
      blurb: 'Admissions requirements, DEAH days, and events at our home-state dental school.' },
    { id: 'r-asda', title: 'ASDA pre-dental resources', url: 'https://www.asdanet.org/index/get-involved/predental',
      blurb: 'National pre-dental membership, publications, and application advice from ASDA.' }
  ];

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(saved)) return saved;
    } catch (e) {}
    return BASE.slice();
  }
  function save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* Accept a pasted URL with or without the protocol. */
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { return new URL(u).href; } catch (e) { return ''; }
  }

  window.DDSResources = {
    KEY: KEY,
    BASE: BASE,
    all: load,
    save: save,
    uid: uid,
    normUrl: normUrl,
    add: function (rec) {
      var list = load();
      list.push({ id: uid(), title: rec.title, url: rec.url, blurb: rec.blurb || '' });
      save(list);
      return list;
    },
    update: function (id, fields) {
      var list = load();
      var r = list.find(function (x) { return x.id === id; });
      if (r) { Object.keys(fields).forEach(function (k) { r[k] = fields[k]; }); save(list); }
      return list;
    },
    remove: function (id) {
      var list = load().filter(function (x) { return x.id !== id; });
      save(list);
      return list;
    }
  };
})();

/* DDS big/little family store — shared by index.html and dashboard.html.
   Base families live here; member-added entries live in localStorage
   (dds-big-little-v1) as rows {id, role:'big'|'little'|'link', name, year,
   family, link, photo, mid?}. build() returns the merged tree both pages
   render, so an edit on either page shows up on the other. */
(function () {
  'use strict';

  var KEY = 'dds-big-little-v1';

  var BASE = [
    { name:'The Molar Bears', founded:2019, tag:'Warm, loud, always fed',
      note:'Legendary for Sunday study jams that end in a group dinner. Their shared DAT spreadsheet has survived four generations of littles.',
      big:{ name:'Jordan Reyes', year:"'25", photo:'slot-officer-photo-1.webp' },
      littles:[ {name:'Priya Shah',year:"'27",photo:'slot-officer-photo-5.webp'}, {name:'Marcus Lin',year:"'27",photo:'slot-officer-photo-3.webp'}, {name:'Ava Bennett',year:"'28",photo:'slot-officer-photo-6.webp'} ] },
    { name:'Wisdom Line', founded:2020, tag:'Calm under pressure',
      note:'The family that turns panic into a plan — color-coded application timelines and a group chat where no question is too small.',
      big:{ name:'Sofia Marin', year:"'25", photo:'slot-officer-photo-2.webp' },
      littles:[ {name:'Ethan Cole',year:"'27",photo:'slot-officer-photo-7.webp'}, {name:'Naomi Park',year:"'28",photo:'slot-officer-photo-8.webp'}, {name:'Dev Patel',year:"'27",photo:'slot-officer-photo-4.webp'} ] },
    { name:'The Enamel Dynasty', founded:2018, tag:'Four generations deep',
      note:'The oldest active line in the chapter. Every spring they add a new little and retell an origin story nobody can fully verify.',
      big:{ name:'Chris Okafor', year:"'24", photo:'slot-officer-photo-3.webp' },
      littles:[ {name:'Hannah Wu',year:"'26",photo:'slot-officer-photo-6.webp'}, {name:'Luis Ortiz',year:"'27",photo:'slot-officer-photo-1.webp'}, {name:'Grace Kim',year:"'28",photo:'slot-officer-photo-5.webp'} ] },
    { name:'Root & Crown', founded:2021, tag:'Small but mighty',
      note:'A tight two-little family with a big footprint — most service hours logged per member, two years running.',
      big:{ name:'Maya Feldman', year:"'25", photo:'slot-officer-photo-4.webp' },
      littles:[ {name:'Owen Tran',year:"'27",photo:'slot-officer-photo-2.webp'}, {name:'Isabella Rossi',year:"'28",photo:'slot-officer-photo-8.webp'} ] },
    { name:'The Bicuspid Bunch', founded:2022, tag:'Two points, one family',
      note:'Half study group, half supper club. Their post-exam potlucks are chapter legend, and their group chat never sleeps.',
      big:{ name:'Tessa Grant', year:"'25", photo:'slot-officer-photo-6.webp' },
      littles:[ {name:'Cole Whitman',year:"'27",photo:'slot-officer-photo-2.webp'}, {name:'Amara Diallo',year:"'28",photo:'slot-officer-photo-7.webp'} ] },
    { name:'Floss & Found', founded:2023, tag:'Chaos, but color-coded',
      note:'The youngest line with the oldest soul — shared study boards, themed review sessions, and a found-family energy that shows.',
      big:{ name:'Riley Nakamura', year:"'26", photo:'slot-officer-photo-8.webp' },
      littles:[ {name:'Jae Min',year:"'28",photo:'slot-officer-photo-1.webp'} ] },
    { name:'The Incisal Edge', founded:2021, tag:'Sharp and steady',
      note:'Precision people: flashcard decks with version numbers and a family calendar that has never once double-booked.',
      big:{ name:'Andre Bishop', year:"'25", photo:'slot-officer-photo-7.webp' },
      littles:[ {name:'Sana Iqbal',year:"'27",photo:'slot-officer-photo-4.webp'}, {name:'Leo Martinez',year:"'28",photo:'slot-officer-photo-3.webp'} ] },
    { name:'The Cusp Crusaders', founded:2022, tag:'Service hours for days',
      note:'First to sign up, last to leave. If there is a service event on the calendar, at least two Crusaders are already there.',
      big:{ name:'Nia Thompson', year:"'25", photo:'slot-officer-photo-5.webp' },
      littles:[ {name:'Sam Rivera',year:"'27",photo:'slot-officer-photo-6.webp'}, {name:'Katie Zhao',year:"'28",photo:'slot-officer-photo-2.webp'} ] },
    { name:'The Apex Line', founded:2020, tag:'Deep roots, high standards',
      note:'Quietly one of the most decorated lines in the chapter — three dental school acceptances in the last two cycles.',
      big:{ name:'Miguel Santos', year:"'24", photo:'slot-officer-photo-1.webp' },
      littles:[ {name:'Erin Walsh',year:"'26",photo:'slot-officer-photo-8.webp'}, {name:'Tobi Adeyemi',year:"'27",photo:'slot-officer-photo-5.webp'} ] },
    { name:'The Bracket Pack', founded:2023, tag:'Newest line, biggest energy',
      note:'Born at last year\'s formal and already recruiting. Motto: straighten up, show up, and bring snacks.',
      big:{ name:'Harper Ellis', year:"'26", photo:'slot-officer-photo-4.webp' },
      littles:[ {name:'Quinn Barnes',year:"'28",photo:'slot-officer-photo-6.webp'} ] }
  ];

  function uid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  /* Generated initials portrait for self-added members */
  function avatar(name) {
    var initials = esc(String(name).trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase());
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#0c2042"/><circle cx="120" cy="150" r="86" fill="none" stroke="#B9975B" stroke-width="2" opacity=".55"/><text x="120" y="150" fill="#B9975B" font-family="Montserrat,Arial,sans-serif" font-size="64" font-weight="700" text-anchor="middle" dominant-baseline="central">' + initials + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }

  /* Saved entries, with the one-time id migration older rows need */
  function load() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { saved = []; }
    var migrated = false;
    saved.forEach(function (e) { if (e.role !== 'link' && !e.id) { e.id = uid(); migrated = true; } });
    if (migrated) { try { save(saved); } catch (e) {} }
    return saved;
  }

  function save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    if (window.DDSCloud) DDSCloud.touch('family');
  }

  /* Base families + everything saved in this browser, merged. Entries carry
     an id (surfaced as editId on their node) so the page that rendered them
     can offer edit/remove. */
  function build() {
    var families = BASE.map(function (f) {
      return {
        name: f.name, founded: f.founded, tag: f.tag, note: f.note, custom: false,
        big: Object.assign({}, f.big),
        littles: f.littles.map(function (l) { return Object.assign({}, l); })
      };
    });
    load().forEach(function (entry) {
      if (entry.role === 'big') {
        families.push({
          name: entry.family, founded: new Date().getFullYear(), tag: 'Newest branch', custom: true,
          note: entry.name + ' just planted this line and is looking for littles — say hi at the next meeting.',
          big: { name: entry.name, year: entry.year, photo: entry.photo || avatar(entry.name), pdf: entry.link || null, editId: entry.id },
          littles: []
        });
      } else if (entry.role === 'link') {
        var famL = families.find(function (f) { return f.name === entry.family; });
        if (famL) famL.big.pdf = entry.link;
      } else {
        var fam = families.find(function (f) { return f.name === entry.family; });
        if (fam) fam.littles.push({ name: entry.name, year: entry.year, photo: entry.photo || avatar(entry.name), pdf: entry.link || null, editId: entry.id });
      }
    });
    return families;
  }

  window.DDSFamily = { KEY: KEY, BASE: BASE, uid: uid, avatar: avatar, load: load, save: save, build: build };
})();

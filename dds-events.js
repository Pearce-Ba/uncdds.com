/* DDS upcoming events — shared by index.html (#calendar + hero) and dashboard.html.
   Reads the public UNC DDS Google Calendars through the same Calendar v3
   endpoint Google's own embed iframe uses (public calendars only, CORS open),
   so the lists update live whenever a calendar itself changes.

   Four calendars feed the site: Meetings (red), Service (yellow) and Socials
   (green) are open to everyone; the Exec calendar (light blue) only joins the
   mix once DDSAuth says the signed-in member is on the exec board. Every event
   carries the calendar it came from (cal / calLabel / calColor) so chips,
   filters and hover cards can colour-code themselves.

   Each mount defaults to at most 5 events within two weeks, but
   {windowDays, maxItems, cacheKey, cals} can override that per mount (the hero
   shows just the next event up to two months out). The last good payload is
   cached per cacheKey so a flaky connection still paints something, and one
   dead calendar never takes the others down with it. */
(function () {
  'use strict';

  var API_KEY = 'AIzaSyBNlYH01_9Hc5S1J9vuFmu2nUqBZJNAXxs'; // Google Calendar's public embed key
  var CACHE_KEY = 'dds-events-cache-v2';
  var WINDOW_DAYS = 14;
  var MAX_ITEMS = 5;
  var CLAMP_AT = 150; // characters of description before "See more" takes over

  /* The chapter's calendars, in the order they read left-to-right everywhere
     on the site: meetings, service, socials, then exec. `color` drives the
     chips, the filter pills, the Add-to-Calendar buttons and the hover cards,
     so a hue only ever has to change in this one place. */
  var CALENDARS = [
    { key: 'meetings', label: 'Meetings', short: 'Meeting Calendar', color: '#E67C73',
      id: '54ec4a28b3e12d442d72f031fe2d644b60ffbf4c3bbc68c3ca0da6b9331e4add@group.calendar.google.com' },
    { key: 'service', label: 'Service', short: 'Service Calendar', color: '#F6BF26',
      id: 'aac71fb0e3c1e0d1bfb363056c956f3eedfcbff334060e25c91aa01f5fb0e110@group.calendar.google.com' },
    { key: 'socials', label: 'Socials', short: 'Social Calendar', color: '#33B679',
      id: '2fd90c64f974d560b4b6ed23dd971d2e97498cfd3032a10c9696c327e9c203ae@group.calendar.google.com' },
    { key: 'exec', label: 'Exec', short: 'Exec Calendar', color: '#4FC3F7', exec: true,
      id: '8386c5e4d91ccda9baa2586ae3420d5c3c8a3235b2bf078402ae55a647061555@group.calendar.google.com' }
  ];
  CALENDARS.forEach(function (c) {
    c.cid = btoa(c.id);                                                   // ?cid= subscribe link
    c.subscribe = 'https://calendar.google.com/calendar/u/0?cid=' + c.cid; // adds it live, keeps updating
    c.ics = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(c.id) + '/public/basic.ics';
  });
  var BY_KEY = {};
  CALENDARS.forEach(function (c) { BY_KEY[c.key] = c; });

  function isExec() {
    try { return !!(window.DDSAuth && DDSAuth.isExec && DDSAuth.isExec()); } catch (e) { return false; }
  }
  /* Which calendars the current viewer may see — exec joins only for exec. */
  function activeCals() {
    return CALENDARS.filter(function (c) { return !c.exec || isExec(); });
  }
  /* Accepts a list of calendars, keys, or nothing (= whatever the viewer may see). */
  function resolveCals(cals) {
    if (!cals || !cals.length) return activeCals();
    return cals.map(function (c) { return typeof c === 'string' ? BY_KEY[c] : c; })
      .filter(function (c) { return c && (!c.exec || isExec()); });
  }
  function calsTag(cals) { return cals.map(function (c) { return c.key; }).join('+'); }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* Calendar descriptions arrive as HTML — flatten to readable text. */
  function descText(html) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString(
      String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n'), 'text/html');
    return (doc.body.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function parseWhen(part) { // {date} all-day | {dateTime} timed
    if (!part) return null;
    return new Date(part.dateTime || (part.date + 'T00:00:00'));
  }

  function fmtWhen(ev) {
    var d = ev.start;
    var day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (ev.allDay) return { day: day, time: 'All day' };
    var t0 = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var t1 = ev.end ? ev.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return { day: day, time: t1 ? t0 + ' – ' + t1 : t0 };
  }

  /* One Google event → the shape the rest of the site works with. `rawDesc`
     keeps the original HTML (the week/month grid renders it in a hover card);
     otherwise the description is flattened for the plain list.

     A calendar shared as "See only free/busy" comes back with the summary,
     description and location stripped and `visibility: private` — the times are
     real but the details are not ours to see. Say so, rather than passing a busy
     block off as an "Untitled event" someone forgot to name. */
  function normalize(it, cal, rawDesc) {
    var hidden = !it.summary && it.visibility === 'private';
    return {
      id: it.id,
      cal: cal.key,
      calLabel: cal.label,
      calColor: cal.color,
      detailsHidden: hidden,
      title: it.summary || (hidden ? cal.label + ' — details hidden' : 'Untitled event'),
      start: parseWhen(it.start),
      end: parseWhen(it.end),
      allDay: !!(it.start && it.start.date),
      location: it.location || '',
      desc: rawDesc ? (it.description || '') : descText(it.description),
      colorId: it.colorId || '',
      attachments: (it.attachments || []).map(function (a) {
        return { fileUrl: a.fileUrl || '', title: a.title || '', mimeType: a.mimeType || '', fileId: a.fileId || '' };
      }),
      link: it.htmlLink || ''
    };
  }

  function fetchCal(cal, timeMin, timeMax, maxResults, rawDesc) {
    var url = 'https://clients6.google.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) +
      '/events?singleEvents=true&orderBy=startTime&maxResults=' + maxResults +
      '&timeZone=America%2FNew_York' +
      '&timeMin=' + encodeURIComponent(timeMin.toISOString()) +
      '&timeMax=' + encodeURIComponent(timeMax.toISOString()) +
      '&key=' + API_KEY;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('calendar ' + cal.key + ' ' + r.status);
      return r.json();
    }).then(function (data) {
      return (data.items || []).filter(function (it) {
        return it.status !== 'cancelled';
      }).map(function (it) { return normalize(it, cal, rawDesc); });
    });
  }

  /* All requested calendars in one merged, start-sorted list. A calendar that
     is unreachable (or not shared publicly yet) contributes nothing instead of
     breaking the others; only a clean sweep of failures rejects. */
  function fetchAll(cals, timeMin, timeMax, maxResults, rawDesc) {
    if (!cals.length) return Promise.resolve([]);
    var failed = 0;
    return Promise.all(cals.map(function (cal) {
      return fetchCal(cal, timeMin, timeMax, maxResults, rawDesc).catch(function () { failed++; return []; });
    })).then(function (lists) {
      if (failed === cals.length) throw new Error('no calendar reachable');
      return [].concat.apply([], lists)
        .filter(function (ev) { return ev.start; })
        .sort(function (a, b) { return a.start - b.start; });
    });
  }

  function fetchUpcoming(opts) {
    opts = opts || {};
    var windowDays = opts.windowDays || WINDOW_DAYS;
    var maxItems = opts.maxItems || MAX_ITEMS;
    var cals = resolveCals(opts.cals);
    var cacheKey = (opts.cacheKey || CACHE_KEY) + ':' + calsTag(cals);
    var now = new Date();
    var max = new Date(now.getTime() + windowDays * 86400000);
    return fetchAll(cals, now, max, 20, false).then(function (events) {
      events = events.filter(function (ev) { return ev.start <= max; }).slice(0, maxItems);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          at: Date.now(),
          events: events.map(function (ev) {
            return Object.assign({}, ev, { start: ev.start.toISOString(), end: ev.end ? ev.end.toISOString() : null });
          })
        }));
      } catch (e) {}
      return events;
    });
  }

  /* Every event between two dates — feeds the week/month grid on the
     homepage. Same normalization as fetchUpcoming, no item cap. Carries the
     raw HTML description, the calendar it came from, and any Drive attachments
     so the hover cards can show everything the event holds. */
  function fetchRange(timeMin, timeMax, cals) {
    return fetchAll(resolveCals(cals), timeMin, timeMax, 250, true);
  }

  function readCache(cacheKey, cals) {
    try {
      cals = resolveCals(cals);
      var c = JSON.parse(localStorage.getItem((cacheKey || CACHE_KEY) + ':' + calsTag(cals)));
      if (!c || !c.events) return null;
      var now = Date.now();
      var evs = c.events.map(function (ev) {
        return Object.assign({}, ev, { start: new Date(ev.start), end: ev.end ? new Date(ev.end) : null });
      }).filter(function (ev) { return (ev.end || ev.start).getTime() > now; });
      return { at: c.at, events: evs };
    } catch (e) { return null; }
  }

  /* Small colour-coded pill naming the calendar an event came from. */
  function calTagHtml(ev) {
    var c = ev.calColor || '#7FB2E0';
    return '<span class="upe-cal" style="color:' + c + ';border-color:' + rgba(c, .42) +
      ';background:' + rgba(c, .12) + ';">' + esc(ev.calLabel || '') + '</span>';
  }

  function itemHtml(ev) {
    var when = fmtWhen(ev);
    var long = ev.desc.length > CLAMP_AT;
    var shown = long ? ev.desc.slice(0, CLAMP_AT).replace(/\s+\S*$/, '') : ev.desc;
    return '<article class="upe-item">' +
      '<div class="upe-when"><span class="upe-day">' + esc(when.day) + '</span><span class="upe-time">' + esc(when.time) + '</span></div>' +
      '<div class="upe-body">' +
        '<div class="upe-head"><h4 class="upe-title">' + esc(ev.title) + '</h4>' + (ev.calLabel ? calTagHtml(ev) : '') + '</div>' +
        (ev.location ? '<div class="upe-loc"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>' + esc(ev.location) + '</div>' : '') +
        (ev.desc ? '<p class="upe-desc" data-full="' + esc(ev.desc) + '" data-short="' + esc(shown) + '">' + esc(shown) +
          (long ? '<span class="upe-ell">…&nbsp;</span><button type="button" class="upe-more" data-upe-more aria-expanded="false">See more</button>' : '') +
        '</p>' : '') +
      '</div></article>';
  }

  /* Render into a container. opts: {empty} custom empty-state line. */
  function render(el, events, opts) {
    opts = opts || {};
    if (!events || !events.length) {
      el.innerHTML = '<div class="upe-empty">' + esc(opts.empty || 'Nothing on the calendar in the next two weeks — check back soon.') + '</div>';
      return;
    }
    el.innerHTML = events.map(itemHtml).join('');
  }

  /* One delegated listener flips a description between clipped and full. */
  function wireSeeMore(el) {
    if (el.__upeWired) return;
    el.__upeWired = true;
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-upe-more]');
      if (!btn) return;
      var p = btn.closest('.upe-desc');
      var open = btn.getAttribute('aria-expanded') === 'true';
      var text = open ? p.getAttribute('data-short') : p.getAttribute('data-full');
      p.firstChild.textContent = text; // text node before the ellipsis/button
      p.querySelector('.upe-ell').hidden = !open;
      btn.textContent = open ? 'See more' : 'See less';
      btn.setAttribute('aria-expanded', String(!open));
    });
  }

  /* Mount: paint the cache instantly, fetch fresh, then refresh every
     5 minutes while the tab is visible. Signing in or out re-runs the fetch so
     an exec picks up (or drops) the exec calendar without a reload. */
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    var windowDays = opts.windowDays || WINDOW_DAYS;
    var maxItems = opts.maxItems || MAX_ITEMS;
    var cacheKey = opts.cacheKey || CACHE_KEY;
    wireSeeMore(el);
    var painted = false;
    var repaint = function () {
      if (!painted) {   // first paint (or a fresh calendar set): show the cache, then catch up
        var cached = readCache(cacheKey, opts.cals);
        if (cached && cached.events.length) { render(el, cached.events.slice(0, maxItems), opts); painted = true; }
        else el.innerHTML = '<div class="upe-empty">Checking the calendar…</div>';
      }
      fetchUpcoming({ windowDays: windowDays, maxItems: maxItems, cacheKey: cacheKey, cals: opts.cals })
        .then(function (evs) { render(el, evs, opts); painted = true; })
        .catch(function () {
          if (!painted) render(el, [], Object.assign({}, opts, { empty: 'Couldn’t reach the calendar — see the full calendar for what’s coming up.' }));
        });
    };
    repaint();
    setInterval(function () { if (document.visibilityState === 'visible') repaint(); }, 300000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') repaint();
    });
    try { if (window.DDSAuth && DDSAuth.onChange) DDSAuth.onChange(function () { painted = false; repaint(); }); } catch (e) {}
  }

  window.DDSEvents = {
    CALENDARS: CALENDARS,
    byKey: function (k) { return BY_KEY[k]; },
    activeCals: activeCals,
    isExec: isExec,
    rgba: rgba,
    fetchUpcoming: fetchUpcoming,
    fetchRange: fetchRange,
    render: render,
    mount: mount
  };
})();

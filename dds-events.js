/* DDS upcoming events — shared by index.html (#calendar + hero) and dashboard.html.
   Reads the public UNC DDS Google Calendar through the same Calendar v3
   endpoint Google's own embed iframe uses (public calendars only, CORS open),
   so the list updates live whenever the calendar itself changes. Each mount
   defaults to at most 5 events within two weeks, but {windowDays, maxItems,
   cacheKey} can override that per mount (the hero shows just the next event up
   to two months out). The last good payload is cached per cacheKey so a flaky
   connection still paints something. */
(function () {
  'use strict';

  var CAL_ID = '54ec4a28b3e12d442d72f031fe2d644b60ffbf4c3bbc68c3ca0da6b9331e4add@group.calendar.google.com';
  var API_KEY = 'AIzaSyBNlYH01_9Hc5S1J9vuFmu2nUqBZJNAXxs'; // Google Calendar's public embed key
  var CACHE_KEY = 'dds-events-cache-v1';
  var WINDOW_DAYS = 14;
  var MAX_ITEMS = 5;
  var CLAMP_AT = 150; // characters of description before "See more" takes over

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* Calendar descriptions arrive as HTML — flatten to readable text. */
  function descText(html) {
    if (!html) return '';
    var doc = new DOMParser().parseFromString(
      String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n'), 'text/html');
    return (doc.body.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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

  function fetchUpcoming(opts) {
    opts = opts || {};
    var windowDays = opts.windowDays || WINDOW_DAYS;
    var maxItems = opts.maxItems || MAX_ITEMS;
    var cacheKey = opts.cacheKey || CACHE_KEY;
    var now = new Date();
    var max = new Date(now.getTime() + windowDays * 86400000);
    var url = 'https://clients6.google.com/calendar/v3/calendars/' + encodeURIComponent(CAL_ID) +
      '/events?singleEvents=true&orderBy=startTime&maxResults=20' +
      '&timeZone=America%2FNew_York' +
      '&timeMin=' + encodeURIComponent(now.toISOString()) +
      '&timeMax=' + encodeURIComponent(max.toISOString()) +
      '&key=' + API_KEY;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('calendar ' + r.status);
      return r.json();
    }).then(function (data) {
      var events = (data.items || []).filter(function (it) {
        return it.status !== 'cancelled';
      }).map(function (it) {
        return {
          id: it.id,
          title: it.summary || 'Untitled event',
          start: parseWhen(it.start),
          end: parseWhen(it.end),
          allDay: !!(it.start && it.start.date),
          location: it.location || '',
          desc: descText(it.description),
          link: it.htmlLink || ''
        };
      }).filter(function (ev) { return ev.start && ev.start <= max; })
        .slice(0, maxItems);
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

  function readCache(cacheKey) {
    try {
      var c = JSON.parse(localStorage.getItem(cacheKey || CACHE_KEY));
      if (!c || !c.events) return null;
      var now = Date.now();
      var evs = c.events.map(function (ev) {
        return Object.assign({}, ev, { start: new Date(ev.start), end: ev.end ? new Date(ev.end) : null });
      }).filter(function (ev) { return (ev.end || ev.start).getTime() > now; });
      return { at: c.at, events: evs };
    } catch (e) { return null; }
  }

  function itemHtml(ev) {
    var when = fmtWhen(ev);
    var long = ev.desc.length > CLAMP_AT;
    var shown = long ? ev.desc.slice(0, CLAMP_AT).replace(/\s+\S*$/, '') : ev.desc;
    return '<article class="upe-item">' +
      '<div class="upe-when"><span class="upe-day">' + esc(when.day) + '</span><span class="upe-time">' + esc(when.time) + '</span></div>' +
      '<div class="upe-body">' +
        '<h4 class="upe-title">' + esc(ev.title) + '</h4>' +
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
     5 minutes while the tab is visible. */
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    var windowDays = opts.windowDays || WINDOW_DAYS;
    var maxItems = opts.maxItems || MAX_ITEMS;
    var cacheKey = opts.cacheKey || CACHE_KEY;
    wireSeeMore(el);
    var cached = readCache(cacheKey);
    if (cached) render(el, cached.events.slice(0, maxItems), opts);
    else el.innerHTML = '<div class="upe-empty">Checking the calendar…</div>';
    var refresh = function () {
      fetchUpcoming({ windowDays: windowDays, maxItems: maxItems, cacheKey: cacheKey }).then(function (evs) { render(el, evs, opts); })
        .catch(function () {
          if (!cached) render(el, [], Object.assign({}, opts, { empty: 'Couldn’t reach the calendar — see the full calendar for what’s coming up.' }));
        });
    };
    refresh();
    setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, 300000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });
  }

  window.DDSEvents = { fetchUpcoming: fetchUpcoming, render: render, mount: mount };
})();

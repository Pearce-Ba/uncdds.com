/* DDS cloud sync engine — makes every member-generated store (accounts,
   chat, family tree, resources, meeting notes, class ratings) shared
   across browsers and devices through one Firestore database, configured
   in dds-cloud-config.js. Load order: dds-cloud-config.js → dds-cloud.js
   → dds-auth.js → everything else.

   How it works: each store keeps living in the same localStorage key the
   rest of the site already reads (offline/unconfigured behavior is
   unchanged). This engine mirrors those keys against Firestore REST:
     · pull — incremental runQuery on an `up` (updated-at, ms) field,
       merged into the local mirror per row id, newest `up` wins; deletes
       travel as {del:true} tombstone docs.
     · push — writers call DDSCloud.touch(store); the engine diff-scans
       the store against a shadow of last-synced row hashes, stamps
       changed rows with a fresh `up`, and batches them into :commit.
   After applying remote changes it fires a synthetic `storage` event on
   the store's key, so every existing cross-tab renderer refreshes as if
   another tab had written. Rows whose id starts with "seed-" are demo
   content and never leave the browser. Files bigger than Firestore's
   1 MiB doc cap (resource PDFs, family PDFs) are base64-chunked into a
   `fileparts` collection and fetched on demand via fileGet(). */
(function () {
  'use strict';

  var CFG = window.DDS_CLOUD || {};
  var ENABLED = !!(CFG.projectId && CFG.apiKey);
  var HOST = CFG.host || 'https://firestore.googleapis.com';
  var ROOT = 'projects/' + CFG.projectId + '/databases/(default)/documents';
  var BASE = HOST + '/v1/' + ROOT;
  var KEYQ = 'key=' + encodeURIComponent(CFG.apiKey || '');

  var STATE_KEY = 'dds-cloud-state-v1';   // { last: {coll: maxUpSeen} }
  var SHADOW_KEY = 'dds-cloud-shadow-v1'; // { store: {id: {u, h, del?}} }
  var PEND_KEY = 'dds-cloud-pending-v1';  // { store: {id: 1} }

  var $id = function (id) { return document.getElementById(id); };
  var onDash = function () { return !!$id('chat-log'); };

  /* Store registry. toRows/fromRows adapt between the localStorage shape
     the site uses and the flat row lists the cloud speaks. `when` gates
     polling to pages that actually render the store. */
  var STORES = {
    members: {
      key: 'dds-members-v1', coll: 'members', every: 30,
      when: function () { return true; },
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) {
        // Two browsers can each create an account for the same email before
        // their first sync meets — keep only the freshest row per email.
        var byEmail = {};
        rows.forEach(function (r) {
          var e = String(r.email || '').toLowerCase();
          if (!e) { byEmail[r.id] = r; return; }
          if (!byEmail[e] || (r.up || 0) >= (byEmail[e].up || 0)) byEmail[e] = r;
        });
        return Object.keys(byEmail).map(function (k) { return byEmail[k]; });
      }
    },
    family: {
      key: 'dds-big-little-v1', coll: 'family', every: 45,
      when: function () { return true; },
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) { return rows; }
    },
    resources: {
      key: 'dds-resources-v2', coll: 'resources', every: 45,
      when: function () { return true; },
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) { return rows; }
    },
    content: {   // exec inline edits (dds-edit.js): map id -> {t?,img?,href?,by,at,up}
      key: 'dds-content-v1', coll: 'content', every: 30,
      when: function () { return true; },
      toRows: function (v) {
        v = v || {}; var rows = [];
        Object.keys(v).forEach(function (id) {
          var e = v[id] || {}, r = { id: id };
          for (var k in e) r[k] = e[k];
          r.up = e.up || 0;
          rows.push(r);
        });
        return rows;
      },
      fromRows: function (rows) {
        var out = {};
        rows.forEach(function (r) {
          if (!r.id) return;
          var e = {};
          for (var k in r) if (k !== 'id') e[k] = r[k];
          out[r.id] = e;
        });
        return out;
      }
    },
    news: {      // The Bite member posts (dds-news.js). maxRowBytes keeps posts
      key: 'dds-newsletter-v1', coll: 'posts', every: 60,   // whose cover image
      when: function () { return true; },                   // would blow Firestore's
      maxRowBytes: 900000,                                  // ~1MB doc cap local-only.
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) { return rows; }
    },
    classes: {
      key: 'dds-classes-v1', coll: 'classes', every: 60,
      when: onDash,
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) { return rows; }
    },
    hours: {
      key: 'dds-hours-v1', coll: 'hours', every: 40,
      when: onDash,
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) { return rows; }
    },
    notes: {
      key: 'dds-notes-v1', coll: 'notes', every: 45,
      when: onDash,
      toRows: function (v) {
        var rows = [];
        v = v || {};
        Object.keys(v).forEach(function (mid) {
          Object.keys(v[mid] || {}).forEach(function (mN) {
            var n = v[mid][mN] || {};
            rows.push({ id: mid + '~' + mN, mid: mid, m: mN, t: n.t || '', at: n.at || 0, up: n.up || 0 });
          });
        });
        return rows;
      },
      fromRows: function (rows) {
        var out = {};
        rows.forEach(function (r) {
          if (!r.mid || !r.m) return;
          (out[r.mid] = out[r.mid] || {})[r.m] = { t: r.t || '', at: r.at || 0, up: r.up || 0 };
        });
        return out;
      }
    },
    chatMeta: {
      key: 'dds-chat-meta-v1', coll: 'channels', every: 30,
      when: onDash,
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) { return rows; }
    },
    chatMsgs: {
      key: 'dds-chat-v2', coll: 'messages', every: 9,
      when: onDash,
      autoTombstone: false,        // cap-trimming old messages is not deletion
      bootstrapWindow: 45 * 864e5, // fresh browsers fetch ~45 days of history
      cap: 600,                    // local mirror cap (cloud keeps everything)
      toRows: function (v) { return Array.isArray(v) ? v : []; },
      fromRows: function (rows) {
        rows.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
        return rows.length > 600 ? rows.slice(-600) : rows;
      }
    }
  };

  function readJSON(key, fb) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function writeJSON(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

  /* Mirror writes can hit the browser's storage quota once other members'
     photos start syncing in — shed the heaviest chat payloads first. */
  function writeMirror(name, key, v) {
    try { writeJSON(key, v); return true; }
    catch (e) {
      if (name === 'chatMsgs' && Array.isArray(v)) {
        var slim = v.map(function (m) {
          if (!m.img) return m;
          var c = {}; Object.keys(m).forEach(function (k) { if (k !== 'img') c[k] = m[k]; });
          c.imgLost = true;
          return c;
        });
        try { writeJSON(key, slim.slice(-300)); return true; } catch (e2) {}
      }
      console.warn('[DDSCloud] storage full — could not mirror ' + key);
      return false;
    }
  }

  function stableStr(o) {
    if (o == null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(stableStr).join(',') + ']';
    return '{' + Object.keys(o).sort().map(function (k) {
      return (k === 'up' ? null : JSON.stringify(k) + ':' + stableStr(o[k]));
    }).filter(Boolean).join(',') + '}';
  }
  function hashRow(row) {
    var s = stableStr(row), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---- Firestore value encoding ---- */
  function encVal(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(encVal) } };
    if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
    return { stringValue: String(v) };
  }
  function encFields(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) out[k] = encVal(obj[k]); });
    return out;
  }
  function decVal(v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decVal);
    if ('mapValue' in v) return decFields(v.mapValue.fields || {});
    return null;
  }
  function decFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = decVal(fields[k]); });
    return out;
  }

  /* ---- transport ---- */
  function call(method, pathAndQuery, body, timeoutMs) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var t = ctl && setTimeout(function () { ctl.abort(); }, timeoutMs || 10000);
    return fetch(HOST + '/v1/' + pathAndQuery, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (t) clearTimeout(t);
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) {
          var msg = (data && (data.error || (data[0] && data[0].error)) || {}).message || ('HTTP ' + res.status);
          var err = new Error(msg); err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  /* ---- status / listeners ---- */
  var status = { enabled: ENABLED, state: ENABLED ? 'connecting' : 'off', lastSyncAt: 0, error: '' };
  var statusFns = [];
  function setStatus(state, error) {
    status.state = state;
    status.error = error || '';
    if (state === 'live') status.lastSyncAt = Date.now();
    statusFns.forEach(function (fn) { try { fn(status); } catch (e) {} });
  }

  function fireChange(key) {
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: key, storageArea: localStorage }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('dds-cloud-change', { detail: { key: key } }));
    } catch (e) {}
  }

  /* ---- pull: incremental query, merge by id + up ---- */
  function pull(name) {
    var st = STORES[name];
    var state = readJSON(STATE_KEY, {}); state.last = state.last || {};
    var last = state.last[st.coll];
    if (last == null) last = st.bootstrapWindow ? Date.now() - st.bootstrapWindow : 0;

    var fetched = [];
    function page(afterUp) {
      return call('POST', ROOT + ':runQuery?' + KEYQ, {
        structuredQuery: {
          from: [{ collectionId: st.coll }],
          where: { fieldFilter: { field: { fieldPath: 'up' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(afterUp) } } },
          orderBy: [{ field: { fieldPath: 'up' }, direction: 'ASCENDING' }],
          limit: 400
        }
      }).then(function (res) {
        var docs = (res || []).filter(function (r) { return r.document; }).map(function (r) {
          var row = decFields(r.document.fields);
          if (row.id == null) row.id = decodeURIComponent(r.document.name.split('/').pop());
          return row;
        });
        fetched = fetched.concat(docs);
        if (docs.length === 400) {
          var maxUp = docs[docs.length - 1].up || afterUp;
          if (maxUp > afterUp) return page(maxUp);
        }
        return null;
      });
    }

    return page(last).then(function () {
      if (!fetched.length) { state.last[st.coll] = Math.max(last, 1); writeJSON(STATE_KEY, state); return 0; }
      var shadow = readJSON(SHADOW_KEY, {}); var sh = shadow[name] = shadow[name] || {};
      var local = st.toRows(readJSON(st.key, null));
      var byId = {};
      local.forEach(function (r) { if (r && r.id != null) byId[r.id] = r; });
      var changed = 0, maxUp = last;

      fetched.forEach(function (r) {
        if (!r || r.id == null) return;
        if (r.up > maxUp) maxUp = r.up;
        var cur = byId[r.id];
        var curUp = cur ? (cur.up || 0) : (sh[r.id] && sh[r.id].del ? sh[r.id].u : -1);
        if ((r.up || 0) <= curUp) return;
        if (r.del) {
          if (cur) { delete byId[r.id]; changed++; }
          sh[r.id] = { del: true, u: r.up || 0, h: '' };
        } else {
          delete r.del;
          byId[r.id] = r; changed++;
          sh[r.id] = { u: r.up || 0, h: hashRow(r) };
        }
      });

      state.last[st.coll] = maxUp;
      writeJSON(STATE_KEY, state);
      if (changed) {
        var rows = Object.keys(byId).map(function (k) { return byId[k]; });
        writeMirror(name, st.key, st.fromRows(rows));
        writeJSON(SHADOW_KEY, shadow);
        fireChange(st.key);
      } else {
        writeJSON(SHADOW_KEY, shadow);
      }
      return changed;
    });
  }

  /* ---- push: diff-scan a store, stamp + queue changed rows ---- */
  function diffScan(name) {
    var st = STORES[name];
    if (!st) return;
    var raw = readJSON(st.key, null);
    if (raw == null) return;
    var rows = st.toRows(raw);
    var shadow = readJSON(SHADOW_KEY, {}); var sh = shadow[name] = shadow[name] || {};
    var pend = readJSON(PEND_KEY, {}); var pd = pend[name] = pend[name] || {};
    var now = Date.now(), touchedStore = false, queued = false;
    var seen = {};

    rows.forEach(function (r) {
      if (!r || r.id == null) return;
      var id = String(r.id);
      seen[id] = true;
      if (id.indexOf('seed-') === 0) return;
      if (st.maxRowBytes) {   // oversized rows never queue — they stay local-only
        try { if (JSON.stringify(r).length > st.maxRowBytes) return; } catch (e) { return; }
      }
      var h = hashRow(r);
      var s = sh[id];
      if (!s || s.h !== h || s.del) {
        r.up = now;
        sh[id] = { u: now, h: hashRow(r) };
        pd[id] = 1;
        touchedStore = true; queued = true;
      }
    });

    if (st.autoTombstone !== false) {
      Object.keys(sh).forEach(function (id) {
        if (seen[id] || sh[id].del || id.indexOf('seed-') === 0) return;
        sh[id] = { del: true, u: now, h: '' };
        pd[id] = 1;
        queued = true;
      });
    }

    if (touchedStore) writeMirror(name, st.key, st.fromRows(rows));
    writeJSON(SHADOW_KEY, shadow);
    if (queued) { writeJSON(PEND_KEY, pend); scheduleFlush(); }
  }

  function tombstone(name, id) {
    var st = STORES[name];
    if (!st || id == null) return;
    id = String(id);
    var shadow = readJSON(SHADOW_KEY, {}); var sh = shadow[name] = shadow[name] || {};
    var pend = readJSON(PEND_KEY, {}); var pd = pend[name] = pend[name] || {};
    sh[id] = { del: true, u: Date.now(), h: '' };
    pd[id] = 1;
    writeJSON(SHADOW_KEY, shadow);
    writeJSON(PEND_KEY, pend);
    scheduleFlush();
  }

  var flushT = null, flushing = false;
  function scheduleFlush() {
    if (!ENABLED) return;
    clearTimeout(flushT);
    flushT = setTimeout(flush, 700);
  }
  function flush() {
    if (!ENABLED || flushing) return Promise.resolve();
    var pend = readJSON(PEND_KEY, {});
    var writes = [], done = []; // done: [name, id]
    Object.keys(pend).forEach(function (name) {
      var st = STORES[name]; if (!st) return;
      var sh = (readJSON(SHADOW_KEY, {})[name]) || {};
      var rows = st.toRows(readJSON(st.key, null));
      var byId = {}; rows.forEach(function (r) { if (r && r.id != null) byId[r.id] = r; });
      Object.keys(pend[name]).forEach(function (id) {
        if (writes.length >= 400) return;
        var doc;
        if (sh[id] && sh[id].del) doc = { id: id, del: true, up: sh[id].u };
        else if (byId[id]) doc = byId[id];
        else { done.push([name, id]); return; } // vanished with no tombstone — drop
        writes.push({ update: { name: ROOT + '/' + st.coll + '/' + id, fields: encFields(doc) } });
        done.push([name, id]);
      });
    });
    if (!writes.length) return Promise.resolve();
    flushing = true;
    return call('POST', ROOT + ':commit?' + KEYQ, { writes: writes }, 20000).then(function () {
      flushing = false;
      var p = readJSON(PEND_KEY, {});
      done.forEach(function (d) { if (p[d[0]]) delete p[d[0]][d[1]]; });
      Object.keys(p).forEach(function (n) { if (!Object.keys(p[n]).length) delete p[n]; });
      writeJSON(PEND_KEY, p);
      setStatus('live');
      if (Object.keys(p).length) scheduleFlush(); // more than one batch pending
    }, function (e) {
      flushing = false;
      noteFailure(e);
    });
  }

  /* ---- scheduler ---- */
  var failUntil = 0, failCount = 0;
  function noteFailure(e) {
    failCount++;
    failUntil = Date.now() + Math.min(120000, 4000 * Math.pow(2, failCount));
    setStatus('error', (e && e.message) || 'network');
  }
  function noteSuccess() { failCount = 0; failUntil = 0; setStatus('live'); }

  var due = {};
  function tick() {
    if (!ENABLED || document.hidden || Date.now() < failUntil) return;
    var now = Date.now();
    Object.keys(STORES).forEach(function (name) {
      var st = STORES[name];
      if (!st.when()) return;
      if (now < (due[name] || 0)) return;
      due[name] = now + st.every * 1000 * (0.9 + Math.random() * 0.2);
      pull(name).then(noteSuccess, noteFailure);
    });
  }

  function pullNow(names) {
    if (!ENABLED) return Promise.resolve();
    var list = (names && names.length ? names : Object.keys(STORES).filter(function (n) { return STORES[n].when(); }));
    return Promise.all(list.map(function (n) {
      due[n] = Date.now() + STORES[n].every * 1000;
      return pull(n).then(noteSuccess, noteFailure);
    }));
  }

  /* ---- large files (PDFs etc.): chunked into `fileparts` docs ---- */
  var fileCache = {};
  var CHUNK = 680000; // base64 chars per part — stays under the 1 MiB doc cap

  function fileUpload(dataURL, fname) {
    if (!ENABLED) return Promise.reject(new Error('Cloud sync is not configured — this file stays on this device.'));
    var m = /^data:([^;,]+);base64,(.*)$/.exec(dataURL || '');
    if (!m) return Promise.reject(new Error('That file could not be read.'));
    var mime = m[1], b64 = m[2];
    if (b64.length > 7000000) return Promise.reject(new Error('Keep shared files under 5 MB.'));
    var id = 'f' + uid();
    var parts = [];
    for (var i = 0; i * CHUNK < b64.length; i++) parts.push(b64.substr(i * CHUNK, CHUNK));
    var now = Date.now();
    var writes = [{ update: { name: ROOT + '/files/' + id, fields: encFields({ id: id, name: fname || 'file', mime: mime, size: b64.length, parts: parts.length, up: now }) } }];
    parts.forEach(function (d, idx) {
      writes.push({ update: { name: ROOT + '/fileparts/' + id + '_p' + idx, fields: encFields({ id: id + '_p' + idx, f: id, i: idx, d: d, up: now }) } });
    });
    return call('POST', ROOT + ':commit?' + KEYQ, { writes: writes }, 60000).then(function () {
      fileCache[id] = dataURL;
      return { fileId: id, name: fname || 'file', mime: mime };
    });
  }

  function fileGet(id) {
    if (fileCache[id]) return Promise.resolve(fileCache[id]);
    if (!ENABLED) return Promise.reject(new Error('Cloud sync is not configured.'));
    return call('GET', ROOT + '/files/' + encodeURIComponent(id) + '?' + KEYQ).then(function (doc) {
      var meta = decFields(doc.fields || {});
      return call('POST', ROOT + ':runQuery?' + KEYQ, {
        structuredQuery: {
          from: [{ collectionId: 'fileparts' }],
          where: { fieldFilter: { field: { fieldPath: 'f' }, op: 'EQUAL', value: { stringValue: id } } },
          limit: 40
        }
      }).then(function (res) {
        var chunks = (res || []).filter(function (r) { return r.document; })
          .map(function (r) { return decFields(r.document.fields); })
          .sort(function (a, b) { return (a.i || 0) - (b.i || 0); });
        if (!chunks.length) throw new Error('File not found in the cloud.');
        var url = 'data:' + (meta.mime || 'application/octet-stream') + ';base64,' +
          chunks.map(function (c) { return c.d || ''; }).join('');
        fileCache[id] = url;
        return url;
      });
    });
  }

  /* ---- boot ---- */
  var readyResolve;
  var ready = new Promise(function (res) { readyResolve = res; });

  if (ENABLED) {
    setInterval(tick, 3000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); flush(); } });
    window.addEventListener('online', function () { failUntil = 0; tick(); flush(); });
    window.addEventListener('beforeunload', function () {
      // best effort — anything missed is still queued for the next page load
      if (Object.keys(readJSON(PEND_KEY, {})).length) flush();
    });
    var boot = function () {
      pullNow().then(function () {
        Object.keys(STORES).forEach(function (n) { if (STORES[n].when()) diffScan(n); });
        readyResolve(status);
      }, function () { readyResolve(status); });
      setTimeout(function () { readyResolve(status); }, 9000); // never hold pages hostage
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } else {
    readyResolve(status);
  }

  window.DDSCloud = {
    enabled: ENABLED,
    ready: ready,
    status: function () { return status; },
    onStatus: function (fn) { statusFns.push(fn); },
    touch: function (name) { if (ENABLED) { try { diffScan(name); } catch (e) { console.warn('[DDSCloud]', e); } } },
    tombstone: tombstone,
    flush: flush,
    pullNow: pullNow,
    fileUpload: fileUpload,
    fileGet: fileGet,
    STORES: STORES
  };
})();

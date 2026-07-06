/* DDS member auth — shared by index.html, login.html, newsletter.html.
   The member "table" lives in localStorage (dds-members-v1) as JSON rows;
   passwords are stored as salted SHA-256 hashes, never as plain text.
   The signed-in session lives in dds-session-v1 (localStorage when the
   member checks "remember me", sessionStorage otherwise). */
(function () {
  'use strict';

  var MEMBERS_KEY = 'dds-members-v1';
  var SESSION_KEY = 'dds-session-v1';
  var listeners = [];

  /* Exec board allow-list. The president keeps this current each year:
     a member whose UNC email is listed here gets exec powers (resource
     editing, roster export) the next time they load a page. Members
     request access by emailing the president — see login.html. */
  var EXEC_EMAILS = [
    'pjbarnes@unc.edu'
  ];

  function loadMembers() {
    try { return JSON.parse(localStorage.getItem(MEMBERS_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveMembers(list) {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(list));
  }

  function readSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeSession(sess, remember) {
    var raw = JSON.stringify(sess);
    if (remember) { localStorage.setItem(SESSION_KEY, raw); sessionStorage.removeItem(SESSION_KEY); }
    else { sessionStorage.setItem(SESSION_KEY, raw); localStorage.removeItem(SESSION_KEY); }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }

  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function hash(salt, password) {
    var msg = salt + '::' + password;
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg)).then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    // FNV-1a fallback for non-secure contexts (crypto.subtle unavailable)
    var h = 0x811c9dc5;
    for (var i = 0; i < msg.length; i++) { h ^= msg.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return Promise.resolve('fnv' + h.toString(16));
  }

  function notify() {
    var m = api.current();
    listeners.forEach(function (fn) { try { fn(m); } catch (e) {} });
  }

  var api = {
    validEmail: function (email) {
      return /^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)*unc\.edu$/i.test(String(email).trim());
    },

    members: loadMembers,

    current: function () {
      var sess = readSession();
      if (!sess) return null;
      var m = loadMembers().find(function (r) { return r.id === sess.id; });
      return m ? {
        id: m.id, name: m.name, email: m.email, gradYear: m.gradYear, major: m.major, role: m.role,
        photo: m.photo || null,
        interests: m.interests || '', hobbies: m.hobbies || '',
        favClasses: m.favClasses || '', favProfs: m.favProfs || '',
        instagram: m.instagram || '', linkedin: m.linkedin || ''
      } : null;
    },

    /* Public-facing card for another member (chat popovers, directory).
       Never exposes email, salt, or hash. */
    profile: function (id) {
      var m = loadMembers().find(function (r) { return r.id === id; });
      return m ? {
        id: m.id, name: m.name, gradYear: m.gradYear, major: m.major || '',
        photo: m.photo || null,
        interests: m.interests || '', hobbies: m.hobbies || '',
        instagram: m.instagram || '', linkedin: m.linkedin || ''
      } : null;
    },

    /* Merge profile fields into the signed-in member's row. These feed the
       future community directory (bigs/littles/study-buddy matching). */
    updateProfile: function (fields) {
      var sess = readSession();
      if (!sess) return { ok: false, err: 'Sign in first.' };
      var list = loadMembers();
      var m = list.find(function (r) { return r.id === sess.id; });
      if (!m) return { ok: false, err: 'Sign in first.' };
      ['photo', 'interests', 'hobbies', 'major', 'favClasses', 'favProfs', 'instagram', 'linkedin'].forEach(function (k) {
        if (k in fields) m[k] = fields[k];
      });
      saveMembers(list);
      notify();
      return { ok: true, member: api.current() };
    },

    signUp: function (rec, remember) {
      var email = String(rec.email || '').trim().toLowerCase();
      var name = String(rec.name || '').trim();
      if (!name) return Promise.resolve({ ok: false, err: 'Enter your name.' });
      if (!api.validEmail(email)) return Promise.resolve({ ok: false, err: 'Use your UNC email (ends in unc.edu).' });
      if (!rec.password || rec.password.length < 8) return Promise.resolve({ ok: false, err: 'Password needs at least 8 characters.' });
      if (!rec.gradYear) return Promise.resolve({ ok: false, err: 'Pick your graduation year.' });
      if (!String(rec.major || '').trim()) return Promise.resolve({ ok: false, err: 'Enter your major.' });
      var list = loadMembers();
      if (list.some(function (m) { return m.email === email; })) {
        return Promise.resolve({ ok: false, err: 'That email already has an account — sign in instead.' });
      }
      var salt = uid() + Math.random().toString(36).slice(2);
      return hash(salt, rec.password).then(function (h) {
        var member = {
          id: uid(), name: name, email: email, salt: salt, hash: h,
          gradYear: rec.gradYear, major: String(rec.major).trim(),
          role: 'member', joined: new Date().toISOString()
        };
        list.push(member);
        saveMembers(list);
        writeSession({ id: member.id, ts: Date.now() }, !!remember);
        notify();
        return { ok: true, member: api.current() };
      });
    },

    signIn: function (email, password, remember) {
      email = String(email || '').trim().toLowerCase();
      var m = loadMembers().find(function (r) { return r.email === email; });
      if (!m) return Promise.resolve({ ok: false, err: 'No account with that email — create one below.' });
      return hash(m.salt, password || '').then(function (h) {
        if (h !== m.hash) return { ok: false, err: 'Wrong password. Try again.' };
        writeSession({ id: m.id, ts: Date.now() }, !!remember);
        notify();
        return { ok: true, member: api.current() };
      });
    },

    signOut: function () { clearSession(); notify(); },

    /* True when the signed-in member is on the exec board — either the
       row is marked role:'exec' or their email is on the allow-list. */
    isExec: function (member) {
      var m = member || api.current();
      if (!m) return false;
      return m.role === 'exec' || EXEC_EMAILS.indexOf(String(m.email || '').toLowerCase()) > -1;
    },

    /* Accounts live in this browser's member table, so a reset is local:
       find the row by email, re-salt, re-hash. */
    resetPassword: function (email, newPassword) {
      email = String(email || '').trim().toLowerCase();
      var list = loadMembers();
      var m = list.find(function (r) { return r.email === email; });
      if (!m) return Promise.resolve({ ok: false, err: 'No account with that email in this browser.' });
      if (!newPassword || newPassword.length < 8) return Promise.resolve({ ok: false, err: 'Password needs at least 8 characters.' });
      var salt = uid() + Math.random().toString(36).slice(2);
      return hash(salt, newPassword).then(function (h) {
        m.salt = salt; m.hash = h;
        saveMembers(list);
        return { ok: true };
      });
    },

    /* The member table as a spreadsheet — opens straight into Excel.
       Password hashes and salts are deliberately left out of the export. */
    exportCsv: function () {
      var cols = ['Name', 'UNC Email', 'Graduation Year', 'Major', 'Role', 'Joined'];
      var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var rows = loadMembers().map(function (m) {
        return [m.name, m.email, m.gradYear, m.major, m.role, (m.joined || '').slice(0, 10)].map(q).join(',');
      });
      var csv = cols.map(q).join(',') + '\n' + rows.join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'dds-members.csv';
      document.body.appendChild(a); a.click(); a.remove();
    },

    onChange: function (fn) { listeners.push(fn); },

    /* Send a signed-out visitor to the login page, then back. */
    requireLogin: function (next) {
      if (api.current()) return true;
      location.href = 'login.html?next=' + encodeURIComponent(next || (location.pathname.split('/').pop() || 'index.html') + location.hash);
      return false;
    },

    /* Render the nav login state into a container. Pages style .nav-auth-link. */
    mountNav: function (el) {
      if (!el) return;
      var render = function (m) {
        if (m) {
          el.innerHTML = '<a class="nav-auth-link is-in" href="dashboard.html" title="Your member dashboard">' +
            (m.photo ? '<img class="nav-auth-photo" src="' + m.photo + '" alt="">' : '<span class="nav-auth-dot"></span>') +
            'Dashboard</a>';
        } else {
          el.innerHTML = '<a class="nav-auth-link" href="login.html">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
            'Login</a>';
        }
      };
      render(api.current());
      api.onChange(render);
    }
  };

  window.DDSAuth = api;
})();

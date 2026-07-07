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

  /* Exec board roster. The president keeps this current each year: a
     member whose UNC email is listed here gets exec powers (resource
     editing, roster export) — and their real title — the next time they
     sign up or sign in. Members request access by emailing the
     president — see login.html. */
  var EXEC_BOARD = {
    'pjbarnes@unc.edu': 'President',
    'ltellez@unc.edu': 'Vice President',
    'bjgroth@unc.edu': 'Secretary',
    'aapatel5@email.unc.edu': 'Treasurer',
    'emillian@unc.edu': 'Service Coordinator',
    'breeh@unc.edu': 'Student Ambassador',
    'yunahkim@unc.edu': 'Website/Social Media',
    'zackphan@unc.edu': 'Social Chair'
  };

  /* If this email is on the board, stamp the member row with role:'exec'
     and their title so it survives into the roster export. Called on
     every successful sign-up/sign-in so a title change (new year, new
     board) picks up next time that member logs in — no manual migration. */
  function syncExecStatus(m) {
    var title = EXEC_BOARD[String(m.email || '').toLowerCase()];
    if (title) { m.role = 'exec'; m.execTitle = title; }
  }

  function loadMembers() {
    try { return JSON.parse(localStorage.getItem(MEMBERS_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveMembers(list) {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(list));
    if (window.DDSCloud) DDSCloud.touch('members');
  }

  /* Refresh the member table from the shared cloud database (when
     configured) so an account created on any other device is found here.
     Resolves quietly either way — offline just means local-only. */
  function cloudRoster() {
    if (!window.DDSCloud || !DDSCloud.enabled) return Promise.resolve();
    return DDSCloud.pullNow(['members']).catch(function () {});
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

  function hexify(buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /* Legacy digest — only kept to verify accounts created before the
     PBKDF2 upgrade; those rows re-hash on their next successful sign-in. */
  function hash(salt, password) {
    var msg = salt + '::' + password;
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg)).then(hexify);
    }
    // FNV-1a fallback for non-secure contexts (crypto.subtle unavailable)
    var h = 0x811c9dc5;
    for (var i = 0; i < msg.length; i++) { h ^= msg.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return Promise.resolve('fnv' + h.toString(16));
  }

  /* PBKDF2-SHA256, 310k iterations. Member rows sync to a shared database
     once cloud sync is configured, so hashes need to be slow to attack —
     a plain SHA-256 would crack in bulk. Prefix marks the scheme. */
  function kdf(salt, password) {
    if (window.crypto && crypto.subtle && crypto.subtle.importKey) {
      var te = new TextEncoder();
      return crypto.subtle.importKey('raw', te.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
        .then(function (key) {
          return crypto.subtle.deriveBits(
            { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: 310000 }, key, 256);
        })
        .then(function (buf) { return 'p2$' + hexify(buf); })
        .catch(function () { return hash(salt, password); });
    }
    return hash(salt, password);
  }

  /* Check a password against a row, whichever scheme the row uses. */
  function verifyPassword(m, password) {
    if (String(m.hash || '').indexOf('p2$') === 0) {
      return kdf(m.salt, password).then(function (h) { return h === m.hash; });
    }
    return hash(m.salt, password).then(function (h) { return h === m.hash; });
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
        execTitle: m.execTitle || null,
        photo: m.photo || null,
        quote: m.quote || '',
        interests: m.interests || '', hobbies: m.hobbies || '',
        favClasses: m.favClasses || '', favProfs: m.favProfs || '',
        instagram: m.instagram || '', linkedin: m.linkedin || '',
        bio: m.bio || '', quoteBy: m.quoteBy || '', phone: m.phone || '',
        photos: Array.isArray(m.photos) ? m.photos : []
      } : null;
    },

    /* Public-facing card for another member (chat popovers, directory).
       Never exposes email, salt, or hash. (phone is intentionally omitted — it's
       only surfaced on the officer's own homepage panel, read from members().) */
    profile: function (id) {
      var m = loadMembers().find(function (r) { return r.id === id; });
      return m ? {
        id: m.id, name: m.name, gradYear: m.gradYear, major: m.major || '',
        role: m.role, execTitle: m.execTitle || null,
        photo: m.photo || null, quote: m.quote || '',
        interests: m.interests || '', hobbies: m.hobbies || '',
        instagram: m.instagram || '', linkedin: m.linkedin || '',
        bio: m.bio || '', quoteBy: m.quoteBy || '',
        photos: Array.isArray(m.photos) ? m.photos : []
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
      ['photo', 'quote', 'interests', 'hobbies', 'major', 'favClasses', 'favProfs', 'instagram', 'linkedin',
       'bio', 'quoteBy', 'phone', 'photos'].forEach(function (k) {
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
      return cloudRoster().then(function () {
      var list = loadMembers();
      if (list.some(function (m) { return m.email === email; })) {
        return Promise.resolve({ ok: false, err: 'That email already has an account — sign in instead.' });
      }
      var salt = uid() + Math.random().toString(36).slice(2);
      return kdf(salt, rec.password).then(function (h) {
        var member = {
          id: uid(), name: name, email: email, salt: salt, hash: h,
          gradYear: rec.gradYear, major: String(rec.major).trim(),
          role: 'member', joined: new Date().toISOString()
        };
        syncExecStatus(member);
        list.push(member);
        saveMembers(list);
        writeSession({ id: member.id, ts: Date.now() }, !!remember);
        notify();
        return { ok: true, member: api.current() };
      });
      });
    },

    signIn: function (email, password, remember) {
      email = String(email || '').trim().toLowerCase();
      return cloudRoster().then(function () {
        var m = loadMembers().find(function (r) { return r.email === email; });
        if (!m) return { ok: false, err: 'No account with that email — create one below.' };
        return verifyPassword(m, password || '').then(function (good) {
          if (!good) return { ok: false, err: 'Wrong password. Try again.' };
          var before = m.role + '|' + (m.execTitle || '') + '|' + m.hash;
          syncExecStatus(m);
          var finish = function () {
            if (before !== m.role + '|' + (m.execTitle || '') + '|' + m.hash) {
              saveMembers(loadMembers().map(function (r) { return r.id === m.id ? m : r; }));
            }
            writeSession({ id: m.id, ts: Date.now() }, !!remember);
            notify();
            return { ok: true, member: api.current() };
          };
          // quietly upgrade pre-PBKDF2 rows now that we know the password
          if (String(m.hash || '').indexOf('p2$') !== 0) {
            return kdf(m.salt, password || '').then(function (h) { m.hash = h; return finish(); });
          }
          return finish();
        });
      });
    },

    signOut: function () { clearSession(); notify(); },

    /* True when the signed-in member is on the exec board — either the
       row is marked role:'exec' or their email is on the current roster. */
    isExec: function (member) {
      var m = member || api.current();
      if (!m) return false;
      return m.role === 'exec' || !!EXEC_BOARD[String(m.email || '').toLowerCase()];
    },

    /* The member's real board title ("President", "Treasurer", ...), or
       null for members / exec rows without a roster match. */
    execTitle: function (member) {
      var m = member || api.current();
      if (!m) return null;
      return EXEC_BOARD[String(m.email || '').toLowerCase()] || m.execTitle || (m.role === 'exec' ? 'Exec Board' : null);
    },

    /* Reset by email: re-salt + re-hash the row (pulled fresh from the
       cloud first, when configured, so resets work from any browser). */
    resetPassword: function (email, newPassword) {
      email = String(email || '').trim().toLowerCase();
      if (!newPassword || newPassword.length < 8) return Promise.resolve({ ok: false, err: 'Password needs at least 8 characters.' });
      return cloudRoster().then(function () {
        var list = loadMembers();
        var m = list.find(function (r) { return r.email === email; });
        if (!m) return { ok: false, err: 'No account with that email yet.' };
        var salt = uid() + Math.random().toString(36).slice(2);
        return kdf(salt, newPassword).then(function (h) {
          m.salt = salt; m.hash = h;
          saveMembers(list);
          return { ok: true };
        });
      });
    },

    /* The member table as a spreadsheet — opens straight into Excel.
       Password hashes and salts are deliberately left out of the export. */
    exportCsv: function () {
      var cols = ['Name', 'UNC Email', 'Graduation Year', 'Major', 'Role', 'Exec Title', 'Joined'];
      var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var rows = loadMembers().map(function (m) {
        return [m.name, m.email, m.gradYear, m.major, m.role, api.execTitle(m) || '', (m.joined || '').slice(0, 10)].map(q).join(',');
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

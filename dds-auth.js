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
    'aapatel5@ad.unc.edu': 'Treasurer',
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
        about: m.about || '',
        roles: Array.isArray(m.roles) ? m.roles : [],
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
        about: m.about || '',
        roles: Array.isArray(m.roles) ? m.roles : [],
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
       'bio', 'quoteBy', 'phone', 'photos', 'about', 'roles', 'gradYear'].forEach(function (k) {
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

    /* Exec-only: write officer-card fields onto ANY member's row by email —
       used by the site's inline edit mode so the president can update another
       officer's panel. Same allow-list as the officer card in member.html. */
    execSetProfileByEmail: function (email, fields) {
      if (!api.isExec()) return { ok: false, err: 'Exec only.' };
      email = String(email || '').trim().toLowerCase();
      var list = loadMembers();
      var m = list.find(function (r) { return String(r.email || '').toLowerCase() === email; });
      if (!m) return { ok: false, err: 'no-account' };
      var ALLOW = ['bio', 'quote', 'quoteBy', 'phone', 'instagram', 'linkedin', 'photos', 'about', 'roles'];
      var changed = false;
      ALLOW.forEach(function (k) {
        if (k in fields && JSON.stringify(m[k]) !== JSON.stringify(fields[k])) { m[k] = fields[k]; changed = true; }
      });
      if (changed) { m.up = Date.now(); saveMembers(list); notify(); }
      return { ok: true, changed: changed };
    },

    /* Known board titles, deduped — feeds the directory's status editor
       so the president can reuse a title or type a brand-new one. */
    execTitles: function () {
      var seen = {}, out = [];
      Object.keys(EXEC_BOARD).forEach(function (k) {
        var t = EXEC_BOARD[k];
        if (!seen[t]) { seen[t] = 1; out.push(t); }
      });
      return out;
    },

    /* Exec-only: change another member's chapter status from the directory.
       A non-empty title promotes the row to role:'exec' with that title
       (an existing board title or a brand-new one); an empty title returns
       them to a general member. Editing your own row is blocked so the
       board can't lock itself out. Note: a member whose email is on the
       EXEC_BOARD roster above gets re-stamped with that title on their
       next sign-in — edit the roster to change those permanently. */
    execSetStatus: function (id, title) {
      var me = api.current();
      if (!me || !api.isExec(me)) return { ok: false, err: 'Exec only.' };
      if (id === me.id) return { ok: false, err: 'You can’t change your own status.' };
      var list = loadMembers();
      var m = list.find(function (r) { return r.id === id; });
      if (!m) return { ok: false, err: 'Member not found.' };
      title = String(title || '').trim();
      if (title) { m.role = 'exec'; m.execTitle = title; }
      else { m.role = 'member'; delete m.execTitle; }
      m.up = Date.now();
      saveMembers(list);
      notify();
      return { ok: true, member: api.profile(id) };
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

    /* Send a signed-out visitor to the login page, then back. Reserved for
       pages that have nothing to show a visitor at all (member.html). Every
       other surface is browsable signed-out and calls promptLogin() at the
       moment the visitor tries to record something. */
    requireLogin: function (next) {
      if (api.current()) return true;
      location.href = 'login.html?next=' + encodeURIComponent(next || (location.pathname.split('/').pop() || 'index.html') + location.hash);
      return false;
    },

    /* The soft gate. Nothing on this site is hidden from a visitor — but
       writing (notes, ratings, chat, photos, comments, hours…) needs an
       account, so this raises a small overlay explaining what the action
       needs instead of yanking the page away. Returns true when the member
       is already signed in, so callers read as:
           if (!DDSAuth.promptLogin(next, 'post in chapter chat')) return; */
    promptLogin: function (next, action) {
      if (api.current()) return true;
      var back = next || (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
      var href = 'login.html?next=' + encodeURIComponent(back);

      if (!document.getElementById('dds-gate-css')) {
        var st = document.createElement('style');
        st.id = 'dds-gate-css';
        st.textContent = [
          '.dds-gate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;',
          'background:rgba(6,13,26,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .22s ease;}',
          '.dds-gate.on{opacity:1;}',
          '.dds-gate-card{position:relative;width:min(420px,100%);background:#13294B;color:#F5F7FA;border:1px solid rgba(185,151,91,.42);',
          'border-radius:18px;padding:30px 28px 26px;text-align:center;box-shadow:0 26px 70px rgba(0,0,0,.55);',
          'transform:translateY(12px) scale(.97);transition:transform .24s cubic-bezier(.2,.8,.3,1);',
          'font-family:Montserrat,system-ui,-apple-system,Segoe UI,sans-serif;}',
          '.dds-gate.on .dds-gate-card{transform:none;}',
          '.dds-gate-ico{width:44px;height:44px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
          'background:rgba(185,151,91,.16);border:1px solid rgba(185,151,91,.5);color:#B9975B;}',
          '.dds-gate-card h3{margin:0 0 8px;font-size:1.16rem;font-weight:800;letter-spacing:.2px;color:#fff;}',
          '.dds-gate-card p{margin:0 0 20px;font-size:.86rem;line-height:1.65;color:#D7E2EA;}',
          '.dds-gate-btns{display:flex;flex-direction:column;gap:9px;}',
          '.dds-gate-btns a,.dds-gate-btns button{display:block;width:100%;padding:12px 16px;border-radius:999px;font:inherit;',
          'font-size:.83rem;font-weight:700;letter-spacing:.4px;cursor:pointer;text-decoration:none;border:1px solid transparent;transition:.18s;}',
          '.dds-gate-go{background:#B9975B;color:#13294B;}.dds-gate-go:hover{background:#c9a76a;}',
          '.dds-gate-new{background:transparent;color:#F5F7FA;border-color:rgba(215,226,234,.36);}',
          '.dds-gate-new:hover{border-color:#B9975B;color:#B9975B;}',
          '.dds-gate-no{background:none;color:#9FB6CE;border:0;font-size:.78rem;font-weight:600;padding:4px;}',
          '.dds-gate-no:hover{color:#D7E2EA;}'
        ].join('');
        document.head.appendChild(st);
      }

      var old = document.getElementById('dds-gate');
      if (old) old.remove();

      var ov = document.createElement('div');
      ov.className = 'dds-gate';
      ov.id = 'dds-gate';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.innerHTML =
        '<div class="dds-gate-card">' +
          '<div class="dds-gate-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
          '<h3>Members only — but only to write</h3>' +
          '<p>Browse as much as you like. To ' + esc(action || 'save this') +
            ', sign in with your UNC email so the chapter knows who it came from.</p>' +
          '<div class="dds-gate-btns">' +
            '<a class="dds-gate-go" href="' + href + '">Sign in&nbsp;→</a>' +
            '<a class="dds-gate-new" href="' + href + '&mode=new">Create an account</a>' +
            '<button class="dds-gate-no" type="button">Keep looking around</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);

      var close = function () {
        ov.classList.remove('on');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { ov.remove(); }, 240);
      };
      var onKey = function (e) { if (e.key === 'Escape') close(); };
      ov.querySelector('.dds-gate-no').addEventListener('click', close);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', onKey);
      requestAnimationFrame(function () { ov.classList.add('on'); });
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

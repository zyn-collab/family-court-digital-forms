/*
 * Demonstration mode for the admin page: used only when no backend address is set
 * (js/site-config.js FC_API_BASE is empty, as on a static demonstration site).
 *
 * It wraps the browser store (js/browser-store.js), so the admin page works on the
 * cases filed in this same browser, plus sample cases loaded with one button. Sign in
 * with username "demo" and password "demo". Nothing leaves the browser; another person's
 * browser has its own cases. With a backend address set, this file does nothing.
 */
(function () {
  'use strict';
  var SESSION = 'fc_demo_admin_session';
  var STAFF = 'fc_demo_admin_staff';
  var SUBS = 'fc_demo_submissions';
  // the same Dhivehi status names as the server (backend/server.js STATUSES)
  var STATUS_DV = { submitted: 'ހުށަހެޅިފައި', processing: 'ޕްރޮސެސް ކުރަނީ', pending: 'ޕެންޑިންގް', approved: 'ޤަބޫލު ކުރެވިފައި',
                    rejected: 'ބޭރު ކުރެވިފައި', returned: 'އިޞްލާޙަށް ފޮނުވިފައި', completed: 'ނިމިފައި' };

  function isDemoSite() { return !(typeof window.FC_API_BASE === 'string' && window.FC_API_BASE.trim()); }
  function readJSON(store, key, dflt) { try { return JSON.parse(store.getItem(key) || '') || dflt; } catch (e) { return dflt; } }
  function writeJSON(store, key, v) { try { store.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  function staff() {
    var list = readJSON(localStorage, STAFF, null);
    if (!list) {
      list = [{ id: 1, username: 'demo', display_name: 'Demonstration officer', role: 'admin', active: true, created_at: Date.now(), password: 'demo' }];
      writeJSON(localStorage, STAFF, list);
    }
    return list;
  }
  function session() { return readJSON(sessionStorage, SESSION, null); }

  function build(base) {
    return Object.assign({}, base, {
      demo: true,
      init: function () { try { base.init(); } catch (e) { /* no SDK: local store */ } },
      adminLogin: async function (username, password) {
        var u = staff().find(function (x) { return x.username === String(username).trim().toLowerCase() && x.active; });
        if (!u || u.password !== password) return false;
        writeJSON(sessionStorage, SESSION, { name: u.display_name, role: u.role, username: u.username });
        return true;
      },
      adminLogout: async function () { try { sessionStorage.removeItem(SESSION); } catch (e) { /* ignore */ } },
      isAdminLoggedIn: function () { return !!session(); },
      adminName: function () { return (session() || {}).name || ''; },
      adminRole: function () { return (session() || {}).role || ''; },

      listSubmissions: async function () {
        var subs = readJSON(localStorage, SUBS, {});
        return (await base.listSubmissions()).map(function (s) {
          var h = (subs[s.ref_code] || {}).history || [];
          var last = h[h.length - 1] || {};
          return Object.assign({}, s, { changed_by_name: last.changed_by_name || '' });
        });
      },
      updateSubmissionStatus: async function (ref, status, statusDv, note) {
        var ok = await base.updateSubmissionStatus(ref, status, statusDv, note);
        var subs = readJSON(localStorage, SUBS, {});
        var h = (subs[ref] || {}).history;
        if (h && h.length) { h[h.length - 1].changed_by_name = (session() || {}).name || ''; writeJSON(localStorage, SUBS, subs); }
        return ok;
      },
      // the case's own history, shown as its activity trail
      getAudit: async function (ref) {
        var rec = readJSON(localStorage, SUBS, {})[ref];
        if (!rec) return [];
        return (rec.history || []).slice().reverse().map(function (h, i, all) {
          var first = i === all.length - 1;
          return { at: h.timestamp, actor_name: first ? '' : (h.changed_by_name || ''), action: first ? 'submit' : 'status_change',
                   details: first ? '' : (h.status_dv || h.status) + (h.note ? ' — ' + h.note : '') };
        });
      },

      listUsers: async function () {
        return staff().map(function (u) { return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, active: u.active, created_at: u.created_at }; });
      },
      createUser: async function (u) {
        var list = staff();
        var err = function (m) { var e = new Error('API 400'); e.detail = m; throw e; };
        if (!/^[a-z0-9._-]{3,40}$/.test(String(u.username || '').trim().toLowerCase())) err('username: 3-40 letters, digits, . _ -');
        if (!u.display_name) err('display name required');
        if (String(u.password || '').length < 8) err('password: at least 8 characters');
        if (list.some(function (x) { return x.username === u.username.trim().toLowerCase(); })) { var e = new Error('API 409'); e.detail = 'username already exists'; throw e; }
        list.push({ id: list.length + 1, username: u.username.trim().toLowerCase(), display_name: u.display_name, role: u.role, active: true, created_at: Date.now(), password: u.password });
        writeJSON(localStorage, STAFF, list);
        return { user: list[list.length - 1] };
      },
      setUserActive: async function (username, active) {
        var list = staff(); var u = list.find(function (x) { return x.username === username; });
        if (u && !active && u.username === (session() || {}).username) { var e = new Error('API 400'); e.detail = 'an account cannot deactivate itself'; throw e; }
        if (u) { u.active = !!active; writeJSON(localStorage, STAFF, list); }
        return { ok: true };
      },
      setUserPassword: async function (username, password) {
        if (String(password || '').length < 8) { var e = new Error('API 400'); e.detail = 'password: at least 8 characters'; throw e; }
        var list = staff(); var u = list.find(function (x) { return x.username === username; });
        if (u) { u.password = password; writeJSON(localStorage, STAFF, list); }
        return { ok: true };
      },

      // sample cases for every form, spread over the statuses (js/sample-filings.js)
      loadSampleCases: async function (perForm) {
        var specs = window.FC_SPECS || {};
        var codes = Object.keys(specs).filter(function (c) { return /^Fm-C-/.test(c); }).sort();
        var seq = Number(localStorage.getItem('fc_demo_sample_seq') || 0), made = 0;
        var who = (session() || {}).name || 'Demonstration officer';
        for (var n = 0; n < (perForm || 1); n++) {
          for (var i = 0; i < codes.length; i++) {
            seq++;
            var spec = specs[codes[i]];
            var data = window.SampleFilings.build(spec, seq);
            var ref = await base.newRefCode(spec.ref_prefix || 'FC', spec.form_code);
            data.ref_code = ref;
            await base.saveSubmission(ref, data);
            var plan = window.SampleFilings.STATUS_PLAN[seq % window.SampleFilings.STATUS_PLAN.length];
            if (plan[0]) {
              await base.updateSubmissionStatus(ref, plan[0], STATUS_DV[plan[0]] || plan[0], plan[1]);
              var subs = readJSON(localStorage, SUBS, {}); var h = (subs[ref] || {}).history;
              if (h && h.length) { h[h.length - 1].changed_by_name = who; writeJSON(localStorage, SUBS, subs); }
            }
            made++;
          }
        }
        localStorage.setItem('fc_demo_sample_seq', String(seq));
        return made;
      },
      clearCases: async function () {
        try { localStorage.removeItem(SUBS); localStorage.removeItem('fc_admin_archived'); } catch (e) { /* ignore */ }
      }
    });
  }

  // The admin page calls this before it starts and before each sign-in: on a site without
  // a backend address it swaps the backend layer for the demonstration store.
  var demoStore = null;
  window.FCDemoAdmin = {
    isDemoSite: isDemoSite,
    // the backend layer when an address is set, the demonstration store otherwise; true = demonstration
    choose: function () {
      if (isDemoSite() && window.BrowserStore) {
        demoStore = demoStore || build(window.BrowserStore);
        window.DataStore = demoStore;
        return true;
      }
      if (window.ApiStore) window.DataStore = window.ApiStore;
      return false;
    }
  };
})();

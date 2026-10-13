/* === Browser store: drafts, submissions and files kept in this browser only (demonstration mode; see js/site-config.js). The Firebase branch below is a placeholder and is not used. === */

window.DataStore = (function () {
  // placeholder configuration; no SDK is loaded, so the store always runs locally
  const CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "000000000000",
    appId: "YOUR_APP_ID"
  };

  let db = null;
  let initialized = false;

  function init() {
    if (initialized) return;
    try {
      if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK not loaded — running in offline/demo mode');
        return;
      }
      firebase.initializeApp(CONFIG);
      db = firebase.database();
      initialized = true;
      console.log('Firebase initialized');
    } catch (e) {
      console.warn('Firebase init failed — running in offline mode:', e.message);
    }
  }

  function isOnline() { return initialized && db !== null; }
  function getDb() { return db; }

  // Drafts expire after this long (shorter = less sensitive data sitting around).
  const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Generate a reference code: PREFIX-XXXXXXXX (8 chars from a 32-symbol set →
  // ~1.1e12 combinations, far harder to guess than the old 4-char code). Uses
  // crypto RNG when available. Real brute-force protection still needs
  // server-side rate limiting once a backend is wired in.
  function generateRefCode(prefix) {
    prefix = prefix || 'VS';
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I confusion
    const N = 8;
    let code = '';
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(N);
      window.crypto.getRandomValues(buf);
      for (let i = 0; i < N; i++) code += chars.charAt(buf[i] % chars.length);
    } else {
      for (let i = 0; i < N; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return prefix + '-' + code;
  }

  // A number nothing else uses: checked against the drafts and submissions this
  // browser (or Firestore, when connected) knows about. The server adapter asks
  // the server instead, which sees every filing.
  async function newRefCode(prefix) {
    for (let i = 0; i < 20; i++) {
      const c = generateRefCode(prefix);
      let used = false;
      try { used = !!(await loadDraft(c)) || !!(await getSubmissionStatus(c)); } catch (e) { used = false; }
      if (!used) return c;
    }
    return generateRefCode(prefix);
  }

  // --- Draft Save/Resume via Firebase ---

  async function saveDraft(refCode, formData) {
    if (!isOnline()) return saveDraftOffline(refCode, formData);
    const ref = db.ref('drafts/' + refCode);
    await ref.set({
      data: JSON.stringify(formData),
      saved_at: firebase.database.ServerValue.TIMESTAMP,
      expires_at: Date.now() + DRAFT_TTL_MS
    });
    return refCode;
  }

  async function loadDraft(refCode) {
    if (!isOnline()) return loadDraftOffline(refCode);
    const snap = await db.ref('drafts/' + refCode).once('value');
    if (!snap.exists()) return null;
    const record = snap.val();
    // Check expiry
    if (record.expires_at && record.expires_at < Date.now()) {
      await db.ref('drafts/' + refCode).remove();
      return null;
    }
    return JSON.parse(record.data);
  }

  async function deleteDraft(refCode) {
    if (!isOnline()) return deleteDraftOffline(refCode);
    await db.ref('drafts/' + refCode).remove();
  }

  // --- Submission Storage ---

  async function saveSubmission(refCode, submissionData) {
    if (!isOnline()) return saveSubmissionOffline(refCode, submissionData);
    const ref = db.ref('submissions/' + refCode);
    await ref.set({
      data: JSON.stringify(submissionData),
      status: 'submitted',
      status_dv: 'ހުށަހެޅިފައި',
      submitted_at: firebase.database.ServerValue.TIMESTAMP,
      contact_number: submissionData.contact_number || '',
      id_number: submissionData.id_number || '',
      form_code: submissionData.form_code || 'Fm-C-B20',
      history: [{
        status: 'submitted',
        status_dv: 'ހުށަހެޅިފައި',
        timestamp: Date.now(),
        note: ''
      }]
    });
    // Delete the draft since it's now submitted
    await deleteDraft(refCode);
    return refCode;
  }

  async function getSubmissionStatus(refCode) {
    if (!isOnline()) return getSubmissionStatusOffline(refCode);
    const snap = await db.ref('submissions/' + refCode).once('value');
    if (!snap.exists()) return null;
    const record = snap.val();
    return {
      ref_code: refCode,
      status: record.status,
      status_dv: record.status_dv,
      submitted_at: record.submitted_at,
      form_code: record.form_code,
      history: record.history || []
    };
  }

  async function updateSubmissionStatus(refCode, status, statusDv, note) {
    if (!isOnline()) return updateSubmissionStatusOffline(refCode, status, statusDv, note);
    const ref = db.ref('submissions/' + refCode);
    const snap = await ref.once('value');
    if (!snap.exists()) return false;
    const record = snap.val();
    const history = record.history || [];
    history.push({
      status: status,
      status_dv: statusDv,
      timestamp: Date.now(),
      note: note || ''
    });
    await ref.update({
      status: status,
      status_dv: statusDv,
      history: history
    });
    return true;
  }

  async function listSubmissions() {
    if (!isOnline()) return listSubmissionsOffline();
    const snap = await db.ref('submissions').once('value');
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.keys(data).map(code => ({
      ref_code: code,
      status: data[code].status,
      status_dv: data[code].status_dv,
      submitted_at: data[code].submitted_at,
      form_code: data[code].form_code,
      contact_number: data[code].contact_number || '',
      id_number: data[code].id_number || ''
    }));
  }

  // --- Offline fallbacks using localStorage (+ IndexedDB for the files) ---
  // localStorage holds about 5 MB for the whole site; one attachment can be 10 MB.
  // A value over FILE_INLINE_MAX bytes is kept in IndexedDB under "<ref>:<field>"
  // and the record carries "@idb:<ref>:<field>" in its place. Readers put the
  // file back before handing the record out, so nothing downstream changes.
  const FILE_INLINE_MAX = 64 * 1024;
  const IDB_NAME = 'fc_demo_files', IDB_STORE = 'files';
  let idbPromise = null;
  function idb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return idbPromise;
  }
  function idbPut(key, value) {
    return idb().then(function (db) { return new Promise(function (res, rej) { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(value, key); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); });
  }
  function idbGet(key) {
    return idb().then(function (db) { return new Promise(function (res, rej) { const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); });
  }
  function isBigFile(v) { return typeof v === 'string' && v.indexOf('data:') === 0 && v.length > FILE_INLINE_MAX; }
  // split a record's data: big files go to IndexedDB, the record keeps markers
  async function stashFiles(refCode, data) {
    const out = {};
    for (const k of Object.keys(data || {})) {
      const v = data[k];
      if (isBigFile(v)) {
        await idbPut(refCode + ':' + k, v);
        out[k] = '@idb:' + refCode + ':' + k;
      } else out[k] = v;
    }
    return out;
  }
  async function restoreFiles(data) {
    const out = {};
    for (const k of Object.keys(data || {})) {
      const v = data[k];
      if (typeof v === 'string' && v.indexOf('@idb:') === 0) {
        try { out[k] = (await idbGet(v.slice(5))) || ''; } catch (e) { out[k] = ''; }
      } else out[k] = v;
    }
    return out;
  }

  async function saveDraftOffline(refCode, formData) {
    const drafts = JSON.parse(localStorage.getItem('fc_demo_drafts') || '{}');
    drafts[refCode] = {
      data: await stashFiles(refCode, formData),
      saved_at: Date.now(),
      expires_at: Date.now() + DRAFT_TTL_MS
    };
    localStorage.setItem('fc_demo_drafts', JSON.stringify(drafts));
    return refCode;
  }

  async function loadDraftOffline(refCode) {
    const drafts = JSON.parse(localStorage.getItem('fc_demo_drafts') || '{}');
    const record = drafts[refCode];
    if (!record) return null;
    if (record.expires_at && record.expires_at < Date.now()) {
      delete drafts[refCode];
      localStorage.setItem('fc_demo_drafts', JSON.stringify(drafts));
      return null;
    }
    return restoreFiles(record.data);
  }

  function deleteDraftOffline(refCode) {
    const drafts = JSON.parse(localStorage.getItem('fc_demo_drafts') || '{}');
    delete drafts[refCode];
    localStorage.setItem('fc_demo_drafts', JSON.stringify(drafts));
  }

  async function saveSubmissionOffline(refCode, submissionData) {
    const subs = JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
    subs[refCode] = {
      data: await stashFiles(refCode, submissionData),
      status: 'submitted',
      status_dv: 'ހުށަހެޅިފައި',
      submitted_at: Date.now(),
      contact_number: submissionData.contact_number || '',
      id_number: submissionData.id_number || '',
      form_code: submissionData.form_code || 'Fm-C-B20',
      history: [{
        status: 'submitted',
        status_dv: 'ހުށަހެޅިފައި',
        timestamp: Date.now(),
        note: ''
      }]
    };
    localStorage.setItem('fc_demo_submissions', JSON.stringify(subs));
    // Delete draft
    deleteDraftOffline(refCode);
    return refCode;
  }

  function getSubmissionStatusOffline(refCode) {
    const subs = JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
    const record = subs[refCode];
    if (!record) return null;
    const out = {
      ref_code: refCode,
      status: record.status,
      status_dv: record.status_dv,
      submitted_at: record.submitted_at,
      form_code: record.form_code,
      history: record.history || []
    };
    if (record.status === 'returned') {
      const d = record.data || {};
      out.attachment_fields = Object.keys(d).filter(function (k) {
        const v = d[k];
        return typeof v === 'string' && (v.indexOf('data:') === 0 || v.indexOf('@file:') === 0 || v.indexOf('@idb:') === 0) && k !== 'selfie_photo' && k !== 'declarant_signature' && k.charAt(0) !== '_';
      });
    }
    return out;
  }
  // demo data layer: a returned case takes one replacement document, same as the backend
  async function submitCorrection(refCode, field, dataUri) {
    const subs = JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
    const record = subs[refCode];
    if (!record || record.status !== 'returned') return false;
    record.data = record.data || {};
    if (isBigFile(dataUri)) { await idbPut(refCode + ':' + field, dataUri); record.data[field] = '@idb:' + refCode + ':' + field; }
    else record.data[field] = dataUri;
    record.data._corrections = (record.data._corrections || []).concat([{ field: field, file: '(demo)', at: Date.now() }]);
    record.status = 'processing'; record.status_dv = 'ޕްރޮސެސް ކުރަނީ';
    (record.history = record.history || []).push({ status: 'processing', status_dv: 'ޕްރޮސެސް ކުރަނީ', timestamp: Date.now(), note: '' });
    localStorage.setItem('fc_demo_submissions', JSON.stringify(subs));
    return true;
  }

  function updateSubmissionStatusOffline(refCode, status, statusDv, note) {
    const subs = JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
    const record = subs[refCode];
    if (!record) return false;
    record.status = status;
    record.status_dv = statusDv;
    if (!record.history) record.history = [];
    record.history.push({
      status: status,
      status_dv: statusDv,
      timestamp: Date.now(),
      note: note || ''
    });
    localStorage.setItem('fc_demo_submissions', JSON.stringify(subs));
    return true;
  }

  function listSubmissionsOffline() {
    const subs = JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
    return Object.keys(subs).map(code => ({
      ref_code: code,
      status: subs[code].status,
      status_dv: subs[code].status_dv,
      submitted_at: subs[code].submitted_at,
      form_code: subs[code].form_code,
      contact_number: subs[code].contact_number || '',
      id_number: subs[code].id_number || ''
    }));
  }

  // Get full submission record (data + history) — used by admin detail view
  async function getSubmissionFull(refCode) {
    if (!isOnline()) {
      const subs = JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
      const rec = subs[refCode];
      if (!rec) return null;
      return Object.assign({}, rec, { data: await restoreFiles(rec.data || {}) });
    }
    const snap = await db.ref('submissions/' + refCode).once('value');
    if (!snap.exists()) return null;
    const record = snap.val();
    // Online stores data as a JSON string; parse it
    if (typeof record.data === 'string') {
      try { record.data = JSON.parse(record.data); } catch (e) {}
    }
    return record;
  }

  return {
    init, isOnline, getDb, generateRefCode, newRefCode,
    saveDraft, loadDraft, deleteDraft,
    saveSubmission, getSubmissionStatus, updateSubmissionStatus, listSubmissions,
    getSubmissionFull, submitCorrection
  };
})();

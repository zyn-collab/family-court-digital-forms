/* === Family Court Form Engine ===
   Renders a wizard form from a JSON spec.
   Reuses: js/browser-store.js (save/load) + js/media-capture.js (signature/selfie/image) + js/lookups.js (shared options).
   The form definitions are the JSON files in specs/.
*/

window.FormEngine = (function () {

  // ─── State ────────────────────────────────────────────────────────
  let spec = null;
  let currentStep = 0;
  let maxStepReached = 0;
  let signaturePad = null;
  let currentRefCode = null;
  let wizardJuris = null;          // the wizard's four jurisdiction answers (?juris=)
  let resolvedSteps = [];      // steps array after audience filtering, with built-in step types expanded

  // ─── Dates: the calendar input holds ISO (YYYY-MM-DD); the form's data,
  // drafts, exports and print keep DD/MM/YYYY as before. "Today" is taken in
  // Maldives time.
  function todayMaldives() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const g = function (t) { return parts.find(function (x) { return x.type === t; }).value; };
      return g('year') + '-' + g('month') + '-' + g('day');
    } catch (e) {
      const d = new Date(); return d.toISOString().slice(0, 10);
    }
  }
  function isoToDmy(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (v || '');
  }
  function dmyToIso(v) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v || '');
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : (v || '');
  }
  // Country dial codes for every phone field: Maldives first.
  // National number length by dial code (subscriber digits, without the code). Maldives
  // is exactly 7; no first-digit rule. Others: the common
  // lengths for the countries most callers come from; anything else is 7–15 digits.
  const PHONE_LEN = { '+960': [7, 7], '+91': [10, 10], '+94': [9, 9], '+880': [10, 10], '+92': [10, 10], '+977': [10, 10],
    '+63': [10, 10], '+60': [9, 10], '+65': [8, 8], '+66': [9, 9], '+44': [10, 10], '+61': [9, 9], '+971': [9, 9], '+1': [10, 10] };
  // Dhivehi phonetic keyboard layout (the standard Windows/Android "Divehi Phonetic")
  const THAANA_KEYS = {
    q: 'ް', w: 'އ', e: 'ެ', r: 'ރ', t: 'ތ', y: 'ޔ', u: 'ު', i: 'ި', o: 'ޮ', p: 'ޕ',
    a: 'ަ', s: 'ސ', d: 'ދ', f: 'ފ', g: 'ގ', h: 'ހ', j: 'ޖ', k: 'ކ', l: 'ލ',
    z: 'ޒ', x: '×', c: 'ޗ', v: 'ވ', b: 'ބ', n: 'ނ', m: 'މ',
    Q: 'ޤ', W: 'ޢ', E: 'ޭ', R: 'ޜ', T: 'ޓ', Y: 'ޠ', U: 'ޫ', I: 'ީ', O: 'ޯ', P: '÷',
    A: 'ާ', S: 'ށ', D: 'ޑ', F: 'ﷲ', G: 'ޣ', H: 'ޙ', J: 'ޛ', K: 'ޚ', L: 'ޅ',
    Z: 'ޡ', X: 'ޘ', C: 'ޝ', V: 'ޥ', B: 'ޞ', N: 'ޏ', M: 'ޟ',
    ',': '،', ';': '؛', '?': '؟'
  };
  const DIAL_CODES = [
    ['+960', 'Maldives', 'mv'],
    ['+91', 'India', 'in'],
    ['+94', 'Sri Lanka', 'lk'],
    ['+880', 'Bangladesh', 'bd'],
    ['+92', 'Pakistan', 'pk'],
    ['+977', 'Nepal', 'np'],
    ['+63', 'Philippines', 'ph'],
    ['+60', 'Malaysia', 'my'],
    ['+65', 'Singapore', 'sg'],
    ['+62', 'Indonesia', 'id'],
    ['+66', 'Thailand', 'th'],
    ['+86', 'China', 'cn'],
    ['+81', 'Japan', 'jp'],
    ['+82', 'Korea', 'kr'],
    ['+971', 'UAE', 'ae'],
    ['+966', 'Saudi Arabia', 'sa'],
    ['+974', 'Qatar', 'qa'],
    ['+968', 'Oman', 'om'],
    ['+965', 'Kuwait', 'kw'],
    ['+973', 'Bahrain', 'bh'],
    ['+962', 'Jordan', 'jo'],
    ['+20', 'Egypt', 'eg'],
    ['+90', 'Turkey', 'tr'],
    ['+44', 'United Kingdom', 'gb'],
    ['+1', 'USA / Canada', 'us'],
    ['+61', 'Australia', 'au'],
    ['+64', 'New Zealand', 'nz'],
    ['+49', 'Germany', 'de'],
    ['+33', 'France', 'fr'],
    ['+39', 'Italy', 'it'],
    ['+34', 'Spain', 'es'],
    ['+31', 'Netherlands', 'nl'],
    ['+41', 'Switzerland', 'ch'],
    ['+46', 'Sweden', 'se'],
    ['+47', 'Norway', 'no'],
    ['+45', 'Denmark', 'dk'],
    ['+358', 'Finland', 'fi'],
    ['+7', 'Russia', 'ru'],
    ['+380', 'Ukraine', 'ua'],
    ['+48', 'Poland', 'pl'],
    ['+420', 'Czechia', 'cz'],
    ['+43', 'Austria', 'at'],
    ['+32', 'Belgium', 'be'],
    ['+351', 'Portugal', 'pt'],
    ['+30', 'Greece', 'gr'],
    ['+353', 'Ireland', 'ie'],
    ['+27', 'South Africa', 'za'],
    ['+254', 'Kenya', 'ke'],
    ['+255', 'Tanzania', 'tz'],
    ['+234', 'Nigeria', 'ng'],
    ['+212', 'Morocco', 'ma'],
    ['+216', 'Tunisia', 'tn'],
    ['+98', 'Iran', 'ir'],
    ['+964', 'Iraq', 'iq'],
    ['+961', 'Lebanon', 'lb'],
    ['+970', 'Palestine', 'ps'],
    ['+93', 'Afghanistan', 'af'],
    ['+95', 'Myanmar', 'mm'],
    ['+84', 'Vietnam', 'vn'],
    ['+855', 'Cambodia', 'kh'],
    ['+673', 'Brunei', 'bn'],
    ['+886', 'Taiwan', 'tw'],
    ['+852', 'Hong Kong', 'hk'],
    ['+55', 'Brazil', 'br'],
    ['+52', 'Mexico', 'mx'],
    ['+54', 'Argentina', 'ar']
  ];

  // Atoll/island data for address fields: loaded once per page.
  let ATOLLS = null;
  let COUNTRIES = null;   // data/countries.json — the list an address abroad picks its country from
  function loadAtolls() {
    if (ATOLLS !== null) return Promise.resolve(ATOLLS);
    const countries = fetch('data/countries.json').then(function (r) { return r.json(); })
      .then(function (d) { COUNTRIES = d.countries || []; }).catch(function () { COUNTRIES = []; });
    return fetch('data/atolls-islands.json').then(function (r) { return r.json(); })
      .then(function (d) { ATOLLS = d.atolls || []; return countries; })
      .then(function () { return ATOLLS; })
      .catch(function () { ATOLLS = []; return ATOLLS; });
  }
  // ނޭނގޭ sits at the very bottom, after every atoll and after "abroad", so
  // it is reached only by scrolling past the real choices — and only for the
  // other party's addresses (the person filling the form knows their own).
  function atollOptions(sel, current, allowUnknown) {
    let html = '<option value="">އަތޮޅު</option>';
    (ATOLLS || []).forEach(function (a) {
      html += '<option value="' + esc(a.code) + '"' + (a.code === current ? ' selected' : '') + '>' + esc(a.name_dv.split(' (')[0]) + '</option>';
    });
    html += '<option value="ABROAD"' + (current === 'ABROAD' ? ' selected' : '') + '>ރާއްޖޭން ބޭރު</option>';
    if (allowUnknown) html += '<option value="UNKNOWN"' + (current === 'UNKNOWN' ? ' selected' : '') + '>ނޭނގޭ</option>';
    sel.innerHTML = html;
  }
  function countryOptions(sel, current) {
    if (!sel) return;
    let html = '<option value="">ޤައުމު</option>';
    (COUNTRIES || []).forEach(function (n) {
      html += '<option value="' + esc(n) + '"' + (n === current ? ' selected' : '') + '>' + esc(n) + '</option>';
    });
    sel.innerHTML = html;
  }
  function allowUnknownFor(k) { return /(^|_)respondent_/.test(k); }

  // "make these easier to search" — a select with many options gets a text
  // box in front of it: type to filter, pick to set. The select stays in the DOM
  // (validation and data read it as before); Thaana lists take Thaana typing.
  const SEARCHABLE_MIN = 8;
  function selectedLabel(sel) { const o = sel.options[sel.selectedIndex]; return (o && o.value) ? o.textContent : ''; }
  function enhanceSelect(sel) {
    if (sel.dataset.searchable || sel.options.length <= SEARCHABLE_MIN) return;
    sel.dataset.searchable = '1';
    sel.classList.add('ss-native');
    const box = document.createElement('div');
    box.className = 'ss-box';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'field-input ss-input'; inp.autocomplete = 'off';
    inp.placeholder = sel.options[0] && !sel.options[0].value ? sel.options[0].textContent : '';
    if (sel.title && !inp.placeholder) inp.placeholder = sel.title;
    const thaanaList = Array.prototype.some.call(sel.options, function (o) { return /[\u0780-\u07BF]/.test(o.textContent); });
    if (thaanaList) inp.dataset.script = 'thaana'; else inp.dir = 'ltr';
    inp.value = selectedLabel(sel);
    const list = document.createElement('div');
    list.className = 'ss-list'; list.hidden = true;
    const render = function (q) {
      const needle = (q || '').trim();
      let html = '', n = 0;
      Array.prototype.forEach.call(sel.options, function (o) {
        if (!o.value) return;
        if (needle && o.textContent.indexOf(needle) < 0 && o.textContent.toLowerCase().indexOf(needle.toLowerCase()) < 0) return;
        html += '<button type="button" class="ss-item' + (o.value === sel.value ? ' on' : '') + '"' + (thaanaList ? '' : ' dir="ltr"') + ' data-v="' + esc(o.value) + '">' + esc(o.textContent) + '</button>';
        n++;
      });
      list.innerHTML = html || '<div class="ss-none"><span class="dv">ނުފެނުނު</span></div>';
      list.hidden = false;
    };
    const pick = function (v) {
      sel.value = v;
      inp.value = selectedLabel(sel);
      list.hidden = true;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    inp.addEventListener('focus', function () { render(''); });
    inp.addEventListener('input', function () { render(inp.value); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { list.hidden = true; return; }
      if (e.key === 'Enter') { e.preventDefault(); const first = list.querySelector('.ss-item'); if (first) pick(first.dataset.v); }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the focus, so blur does not close first
    list.addEventListener('click', function (e) { const b = e.target.closest('.ss-item'); if (b) pick(b.dataset.v); });
    inp.addEventListener('blur', function () {
      setTimeout(function () { list.hidden = true; inp.value = selectedLabel(sel); }, 120);
    });
    box.appendChild(inp); box.appendChild(list);
    sel.insertAdjacentElement('afterend', box);
    sel._ss = inp;
  }
  function syncSearchable(sel) { if (sel && sel._ss) sel._ss.value = selectedLabel(sel); }
  function enhanceSelects(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('select.field-input'), enhanceSelect);
  }
  function syncAllSearchable() { Array.prototype.forEach.call(document.querySelectorAll('select[data-searchable]'), syncSearchable); }
  function islandOptions(sel, atollCode, current) {
    const a = (ATOLLS || []).find(function (x) { return x.code === atollCode; });
    let html = '<option value="">ރަށް</option>';
    ((a && a.islands) || []).forEach(function (n) {
      html += '<option value="' + esc(n) + '"' + (n === current ? ' selected' : '') + '>' + esc(n) + '</option>';
    });
    sel.innerHTML = html;
  }

  // ─── Public API ───────────────────────────────────────────────────
  async function init(formSpec, opts) {
    spec = formSpec;
    opts = opts || {};
    window.DataStore.init();

    document.title = (spec.title_dv || spec.form_code) + ' — ފެމިލީ ކޯޓު | ' + spec.form_code;
    document.getElementById('formTitleDv').textContent = spec.title_dv || '';
    // Verbatim header block from the validated source document
    if (spec.header) {
      const courtEl = document.querySelector('.court-name');
      const locEl = document.querySelector('.country-name');
      if (courtEl && spec.header.court_dv) courtEl.textContent = spec.header.court_dv;
      if (locEl && spec.header.location_dv) locEl.textContent = spec.header.location_dv;
    }
    document.getElementById('formCodeBadge').textContent =
      (spec.header && spec.header.code_dv) || spec.form_code;
    const topNotice = spec.notice_dv || spec.banner_dv;
    if (topNotice) {
      document.getElementById('formBannerDv').textContent = topNotice;
      document.getElementById('thaanaNotif').style.display = 'flex';
    }

    // Filter staff-only steps from citizen view
    resolvedSteps = (spec.steps || []).filter(function (s) {
      if (s.audience === 'staff_only') return false;
      // a page with nothing left on it is not shown (an amendment can empty one)
      return !!(s.type || s.module || s.question_dv || s.title_dv || (s.fields && s.fields.length));
    });

    // Forms with a fee get a payment step (gateway link + receipt upload)
    // right before the declaration — same flow as the original B20 demo.
    if (spec.fee_mvr && !resolvedSteps.some(function (s) { return s.type === 'payment'; })) {
      const payStep = { step_key: 'payment', type: 'payment', fee_mvr: spec.fee_mvr };
      let at = resolvedSteps.findIndex(function (s) { return s.type === 'declaration'; });
      if (at < 0) at = resolvedSteps.findIndex(function (s) { return s.type === 'review'; });
      if (at < 0) at = resolvedSteps.length;
      resolvedSteps.splice(at, 0, payStep);
    }

    await loadAtolls();
    renderForm();
    buildProgressSteps();
    initDateInputs();
    initFieldFeedback();
    initLiveChecks();
    decorateFileInputs(document);
    enhanceSelects(document);
    showStep(0);

    // URL ?resume= auto-load
    const params = new URLSearchParams(window.location.search);
    if (params.get('juris')) { try { wizardJuris = JSON.parse(params.get('juris')); } catch (e) { wizardJuris = null; } }
    // the wizard's "which order" answer fills section 6 of the protection-order form
    if (params.get('order')) { const r = document.querySelector('input[name="order_type"][value="' + params.get('order').replace(/[^a-z_]/g, '') + '"]'); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); wizardOrder = true; applyStepVisibility(); } }
    const resumeCode = params.get('resume');
    if (resumeCode) {
      await resumeFormDraft(resumeCode.toUpperCase());   // toolbar removed; resume comes from the status page link
    }
    // a reload of this tab brings back what was typed, under the same number
    const snap = !currentRefCode ? loadSnapshot() : null;
    if (snap && snap.ref && snap.data && (!snap.data.form_code || snap.data.form_code === spec.form_code)) {
      restoreFormData(snap.data);
      currentRefCode = snap.ref;
      // the page first, then the number: issuing the number autosaves, and the draft must
      // record the page reached, not page 1
      if (typeof snap.step === 'number' && snap.step > 0 && snap.step < resolvedSteps.length) { maxStepReached = snap.step; showStep(snap.step); }
      issueRefCode(snap.ref);
    }
    // a reference number is issued the
    // moment a form is opened, shown as a notice, with advice to keep it. The
    // number is drawn by the store (the server, when there is one) and checked
    // against every existing draft and submission, so it is never a repeat.
    if (!currentRefCode) issueRefCode(await window.DataStore.newRefCode(spec.ref_prefix || 'FC', spec.form_code));
    initAutosave();
    // Wizard already asked "who is submitting": pre-answer step 1.
    if (opts.party === 'party' || opts.party === 'poa') {
      const r = document.querySelector('input[name="submitting_party"][value="' + opts.party + '"]');
      if (r && !r.checked) { r.checked = true; handleSubmittingPartyChange(); }
    }
  }

  function issueRefCode(existing) {
    currentRefCode = existing || window.DataStore.generateRefCode(spec.ref_prefix || 'FC');
    const badge = document.getElementById('currentRefCode');
    if (badge) { badge.textContent = currentRefCode; badge.style.display = 'inline-block'; }
    // The number must lead somewhere from the moment it is shown ("updates can
    // only be viewed with the number"): store the draft now, and again after
    // every completed step (autosaveDraft), without any prompt.
    autosaveDraft();
    const anchor = document.getElementById('wizardProgress');
    if (!anchor || document.getElementById('refNotice')) return;
    const note = document.createElement('div');
    note.className = 'form-notification info no-print ref-notice-big';
    note.id = 'refNotice';
    // Wording: "ރެފަރެންސް ނަންބަރު" and "ނަންބަރު ރައްކާކުރުމަށް" are the Court's own
    // words. The last clause renders the
    // Court's English-only note "updates can only be viewed with the number" and
    // is
    note.innerHTML = '<span class="notif-icon">' + FcIcons.svg('key') + '</span><div><span class="dv">ރެފަރެންސް ނަންބަރު: </span>' +
      '<strong class="ref-code-display" id="refNoticeCode" style="direction:ltr;display:inline-block;">' + esc(currentRefCode) + '</strong> ' +
      '<button type="button" class="btn-sm" onclick="FormEngine.copyRefCode()"><span class="dv">ކޮޕީ ކުރައްވާ</span></button>' +
      '<br><span class="dv">ނަންބަރު ރައްކާކުރުމަށް — ފޯމުގެ އަޕްޑޭޓް ބެލޭނީ ހަމައެކަނި މި ނަންބަރު ބޭނުންކޮށްގެންނެވެ.</span></div>';
    anchor.parentNode.insertBefore(note, anchor);
  }

  // ─── Renderer ─────────────────────────────────────────────────────
  function renderForm() {
    const form = document.getElementById('mainForm');
    form.innerHTML = '';

    resolvedSteps.forEach(function (step, idx) {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'section-card';
      stepDiv.id = 'step_' + idx;
      stepDiv.dataset.step = idx;
      stepDiv.dataset.stepKey = step.step_key || ('step_' + idx);
      if (idx !== 0) stepDiv.hidden = true;

      if (step.type === 'submitting_party') {
        renderSubmittingPartyStep(stepDiv, step);
      } else if (step.type === 'payment') {
        renderPaymentStep(stepDiv, step);
      } else if (step.type === 'declaration') {
        renderDeclarationStep(stepDiv, step);
      } else if (step.type === 'review') {
        renderReviewStep(stepDiv, step);
      } else {
        renderRegularStep(stepDiv, step);
      }

      form.appendChild(stepDiv);
    });
  }

  // A heading that the paper form leaves unnumbered while its fields are 1.1, 1.2 … is shown
  // as "1. …" so a clerk can cite section and field the same way everywhere (display rule only;
  // the verbatim title is untouched). Headings that already start with a number are left alone.
  function displayStepTitle(step) {
    const t = step.title_dv || '';
    if (!t || /^\s*[0-9]/.test(t)) return t;
    let major = null;
    for (const f of (step.fields || [])) {
      const src = f.number || (f.label_dv || '');
      const m = String(src).match(/^\s*([0-9]+)\.[0-9]/);
      if (!m) continue;
      if (major === null) major = m[1];
      else if (major !== m[1]) return t;         // mixed sections: leave the heading alone
    }
    return major === null ? t : major + '. ' + t;
  }

  function renderRegularStep(stepDiv, step) {
    if (step.title_dv) {
      const h = document.createElement('h3');
      h.className = 'section-title';
      h.textContent = displayStepTitle(step);
      // In a combined flow, tag which member form this section belongs to
      if (step._form && spec.member_forms && spec.member_forms.length > 1) {
        const chip = document.createElement('span');
        chip.className = 'form-code-badge';
        chip.style.cssText = 'font-size:0.7rem;margin-inline-start:8px;vertical-align:middle;';
        chip.textContent = step._form;
        h.appendChild(chip);
      }
      stepDiv.appendChild(h);
    }
    if (step.notice_dv) {
      stepDiv.appendChild(infoBanner(step.notice_dv, 'info'));
    }
    if (step.module === 'attachments') stepDiv.appendChild(renderUploadsSummary());
    (step.fields || []).forEach(function (field) {
      stepDiv.appendChild(renderField(field));
    });
    // a page whose one question is its own title (B05 "އެދޭ ގޮތް") carries the asterisk on the title
    const keyed = (step.fields || []).filter(function (f) { return f.key && !f.visible_when; });
    const titled = keyed.filter(function (f) { return !f.label_dv && f.validation && f.validation.required; });
    if (step.title_dv && titled.length === 1 && keyed[0] === titled[0]) {
      const t = stepDiv.querySelector('.section-title');
      if (t && !t.querySelector('.required-mark')) t.insertAdjacentHTML('afterbegin', '<span class="required-mark">*</span>');
    }
    if (step.module === 'instructions') {
      // the instructions open the form together with a phone number
      // (OTP to follow once an SMS gateway exists).
      stepDiv.appendChild(renderField({
        key: 'contact_phone', type: 'tel', label_dv: 'ފޯނު ނަންބަރު', validation: { required: true }
      }));
    }
  }

  // with uploads made in their sections, the final page shows
  // what was attached so the person can check it before submitting.
  function renderUploadsSummary() {
    const box = document.createElement('div');
    box.className = 'uploads-summary form-notification info';
    box.id = 'uploadsSummary';
    box.innerHTML = '<div><span class="dv">ކުރީގެ ބައިތަކުގައި ހުށަހަޅުއްވާފައިވާ ލިޔުންތައް:</span><ul id="uploadsSummaryList" style="margin:6px 0 0;padding-inline-start:18px;"></ul></div>';
    return box;
  }
  function refreshUploadsSummary() {
    const ul = document.getElementById('uploadsSummaryList');
    if (!ul) return;
    ul.innerHTML = '';
    Array.prototype.forEach.call(document.querySelectorAll('.section-card:not(.step-skipped) input[type="file"]'), function (fi) {
      if (fi.closest('.conditional-hidden') || fi.closest('.attachments-checklist')) return;
      const hid = document.getElementById(fi.id + '_data');
      const grp = fi.closest('.field-group, .payment-receipt-upload');
      let label = grp && grp.querySelector('.field-label .dv') ? grp.querySelector('.field-label .dv').textContent : '';
      const td = fi.closest('td');
      if (td) {
        // "no fields that are in English" — a file in a table row is named by its column and row
        const tr = td.parentNode, idx = Array.prototype.indexOf.call(tr.children, td);
        const th = td.closest('table').querySelectorAll('thead th')[idx];
        const cap = fi.closest('.field-group') && fi.closest('.field-group').querySelector('.field-label .dv');
        label = (th ? th.textContent.replace(/\ */g, '').trim() : '') + ' (' + (tr.dataset.rowIdx || '') + ')' + (cap ? ' — ' + cap.textContent.trim() : '');
      }
      if (!label) label = fi.id;
      const li = document.createElement('li');
      li.innerHTML = '<span class="dv">' + esc(label) + '</span> — ' + (hid && hid.value ? '✓' : '<span class="dv">ނެތް</span>');
      ul.appendChild(li);
    });
  }

  function renderSubmittingPartyStep(stepDiv, step) {
    const h = document.createElement('h3');
    h.className = 'section-title';
    // "change … haisiyyathu to just form hushahalhanee kaaku? and not a question number"
    h.innerHTML = '<span class="required-mark">*</span><span class="dv">' + esc(step.question_dv || 'ފޯމު ހުށަހަޅަނީ ކާކު؟') + '</span>';
    stepDiv.appendChild(h);

    const opts = step.options || [
      { value: 'applicant', label_dv: 'ޚަޞްމެއް' },
      { value: 'poa',       label_dv: 'ޚަޞްމުގެ ބަދަލުގައި މައްސަލަ ހުށަހަޅާ ފަރާތެއް' }
    ];

    const fg = document.createElement('div');
    fg.className = 'field-group';
    fg.dataset.key = 'submitting_party';


    const radioGrp = document.createElement('div');
    radioGrp.className = 'radio-group';
    opts.forEach(function (o) {
      const lbl = document.createElement('label');
      lbl.className = 'radio-option';
      lbl.innerHTML = '<input type="radio" name="submitting_party" value="' + esc(o.value) +
        '" onchange="FormEngine.handleSubmittingPartyChange()" required>' +
        '<span class="dv">' + esc(o.label_dv) + '</span>';
      radioGrp.appendChild(lbl);
    });
    fg.appendChild(radioGrp);
    fg.appendChild(errEl('submitting_party'));
    stepDiv.appendChild(fg);

    // Conditional POA uploads
    const poaWrap = document.createElement('div');
    poaWrap.id = 'poa_uploads';
    poaWrap.className = 'conditional-hidden';
    poaWrap.style.marginTop = '12px';
    // no alert banner; labels verbatim from the
    // feedback docx; all three uploads stay required.
    [
      { key: 'poa_document',   label_dv: 'ޕަވަރ އޮފް އެޓާރނީ' },
      { key: 'poa_grantor_id', label_dv: 'ޕަވަރ އޮފް އެޓާރނީ ޙަވާލުކުރާ ފަރާތުގެ އައިޑީ ކާޑު (ބިދޭސީއެއް ނަމަ ޕާސްޕޯޓު)' },
      { key: 'poa_grantee_id', label_dv: 'ޕަވަރ އޮފް އެޓާރނީ ޙަވާލުވާ ފަރާތުގެ އައިޑީ ކާޑު' }
    ].forEach(function (f) {
      poaWrap.appendChild(renderField({
        key: f.key, type: 'file_attachment', label_dv: f.label_dv,
        accept: 'image/*,.pdf', validation: { required: true }
      }));
    });
    stepDiv.appendChild(poaWrap);

    // POA attorney name (auto-fills declarant)
    const nameWrap = document.createElement('div');
    nameWrap.id = 'poa_attorney_wrap';
    nameWrap.className = 'conditional-hidden';
    nameWrap.appendChild(renderField({
      key: 'poa_attorney_name', type: 'text',
      label_dv: 'ޕަވަރ އޮފް އެޓާރނީއާ ޙަވާލުވާ ފަރާތުގެ ނަން',   // feedback b0012
      validation_script: 'thaana',
      validation: { required: true }
    }));
    // the attorney's phone number (used for the notification when
    // someone else submits).
    nameWrap.appendChild(renderField({
      key: 'poa_attorney_phone', type: 'tel',
      label_dv: 'ޕަވަރ އޮފް އެޓާރނީއާ ޙަވާލުވާ ފަރާތުގެ ފޯނު ނަންބަރު',
      validation: { required: true }
    }));
    stepDiv.appendChild(nameWrap);
  }

  // the guidance video is a link rather than a player embedded in the page.
  // The Court supplies the address; while it is empty the line reads as before.
  const VIDEO_GUIDE_URL = '';
  function videoGuideLine() {
    const t = 'ވީޑިއޯ އިރުޝާދު';
    return VIDEO_GUIDE_URL
      ? '<p class="video-link-line"><a href="' + VIDEO_GUIDE_URL + '" target="_blank" rel="noopener"><span class="dv">' + t + '</span></a></p>'
      : '<p class="video-link-line"><span class="dv">' + t + ' — ތައްޔާރުވަމުން</span></p>';
  }
  function renderPaymentStep(stepDiv, step) {
    const fee = step.fee_mvr || spec.fee_mvr || 25;
    stepDiv.innerHTML =
      // heading ފޯމު ފީ, no explanatory
      // paragraph, gateway link https://bp.finance.gov.mv/, receipt label b0088.
      '<h3 class="section-title"><span class="dv">ފޯމު ފީ</span></h3>' +
      '<div class="payment-step-panel">' +
        '<div class="payment-icon">' + FcIcons.svg('card', 28) + '</div>' +
        '<h3 class="payment-title"><span class="dv">ފޯމު ފީ</span>' +
          '<button type="button" class="payment-help-btn" onclick="FormEngine.togglePaymentHelp()"><span class="dv">އިރުޝާދު ؟</span></button></h3>' +
        '<div id="paymentHelp" class="form-notification info" hidden><div>' +
          '<span class="dv">ބަނޑޭރި ޕޭ މެދުވެރިކޮށް ފީ ދެއްކެވުމަށް: ލިންކުން ބަނޑޭރި ޕޭ ހުޅުއްވައި، ފެމިލީ ކޯޓު ޚިޔާރުކުރައްވައި، ރެފަރެންސް ނަންބަރުގެ ގޮތުގައި ތިޔަ ފަރާތުގެ އައިޑީ ކާޑު ނަންބަރު ޖައްސަވާ. ފައިސާ ދެއްކެވުމަށްފަހު ލިބޭ ރަސީދު ތިރީގައި އަޕްލޯޑް ކުރައްވާ.</span>' +
          videoGuideLine() +
        '</div></div>' +
        '<div class="payment-amount"><span class="dv">ފީ: ' + fee + '.00 ރުފިޔާ</span></div>' +
        '<a href="https://bp.finance.gov.mv/" target="_blank" rel="noopener" class="btn btn-primary" style="margin-bottom:24px;display:inline-flex;"><span class="dv">ޕޭމަންޓް ގޭޓްވޭ ހުޅުއްވާ</span></a>' +
        '<div class="payment-receipt-upload">' +
          '<label class="field-label"><span class="required-mark">*</span><span class="dv">ފައިސާ ދެއްކިކަމުގެ ރަސީދު</span></label>' +
          '<input type="file" id="payment_receipt" accept="image/*,.pdf" class="field-input file-input" data-required-file="1" ' +
            'onchange="FormEngine.persistFile(\'payment_receipt\')">' +
          '<input type="hidden" id="payment_receipt_data" name="payment_receipt">' +
          '<p class="field-hint"><span class="dv">ރަސީދުގެ ފޮޓޯ ނުވަތަ PDF</span></p>' +
          '<div class="field-error" id="err_payment_receipt"></div>' +
        '</div>' +
      '</div>';
  }

  function renderDeclarationStep(stepDiv, step) {
    // Verbatim iqraar text from the source document when the spec provides it
    const declLines = (step.declaration_lines_dv && step.declaration_lines_dv.length)
      ? step.declaration_lines_dv
      : ['މި ފޯމުގައި ހިމެނިފައިވާ މައުލޫމާތަކީ ތެދު ސައްހަ މައުލޫމާތެވެ.'];
    let declHtml = '';
    declLines.forEach(function (l) {
      declHtml += '<li><span class="dv">' + esc(l) + '</span></li>';
    });
    const nameLbl = step.name_label_dv || 'ހުށަހަޅާފަރާތުގެ ނަން:';
    const dateLbl = step.date_label_dv || 'ތާރީޚް:';
    const signLbl = step.sign_label_dv || 'ސޮއި:';
    stepDiv.innerHTML =
      '<h3 class="section-title"><span class="dv">އިޤްރާރު</span></h3>' +
      '<div class="declaration-block"><ul class="declaration-text">' +
        declHtml +
        (spec.fee_mvr ? '<li><span class="dv">މިފޯމު ހުށަހެޅުމަށް ' + spec.fee_mvr + '.00ރ ދައްކައިފީމެވެ.</span></li>' : '') +
      '</ul></div>' +
      '<div class="field-group"><label class="field-label"><span class="required-mark">*</span>' +
        '<span class="dv">' + esc(nameLbl) + '</span></label>' +
        '<input class="field-input" type="text" id="declarant_name" name="declarant_name" required>' +
        '<p class="field-hint" id="declarant_name_hint" style="display:none;"><span class="dv">ޕަވަރ އޮފް އެޓާރނީ ޙަވާލުވާ ފަރާތުގެ ނަން އޮޓޯއިން ފެނިފައި</span></p>' +
        '<div class="field-error" id="err_declarant_name"></div></div>' +
      '<div class="field-group"><label class="field-label"><span class="required-mark">*</span>' +
        '<span class="dv">' + esc(dateLbl) + '</span></label>' +
        '<input class="field-input date-input" type="date" data-date-constraint="today_only" ' +
          'id="declarant_date" name="declarant_date" value="' + todayMaldives() + '" min="' + todayMaldives() + '" max="' + todayMaldives() + '" required>' +
        '<div class="field-error" id="err_declarant_date"></div></div>' +
      '<div class="field-group signature-pad-group" data-key="declarant_signature">' +
        '<label class="field-label"><span class="required-mark">*</span><span class="dv">' + esc(signLbl) + '</span></label>' +
        '<p class="field-hint"><span class="dv">ތިރީގައިވާ ގޮޅީގައި ސޮއި ކުރައްވާ</span></p>' +   // (transliteration)
        '<div class="signature-pad-wrapper"><canvas id="declarant_signature_canvas" class="signature-canvas"></canvas>' +
        '<input type="hidden" id="declarant_signature_canvas_data" name="declarant_signature">' +
        '<div class="signature-pad-actions"><button type="button" class="btn-sm" id="clearSigBtn">' +
        '<span class="dv">ފޮހެލާ</span></button></div></div>' +
        '<div class="field-error" id="err_declarant_signature"></div></div>' +
      '<div class="field-group selfie-group" data-key="selfie_photo" style="margin-top:28px;">' +
        '<label class="field-label"><span class="required-mark">*</span>' +
          '<span class="dv">ސެލްފީ (ފޮޓޯ ނެގުން)</span></label>' +
        '<div class="selfie-capture-area" id="selfie_area">' +
          '<video id="selfie_video" class="selfie-video" autoplay playsinline style="display:none;"></video>' +
          '<canvas id="selfie_canvas" class="selfie-canvas" style="display:none;"></canvas>' +
          '<img id="selfie_preview" class="selfie-preview" style="display:none;" alt="Selfie">' +
          '<input type="hidden" id="selfie_data" name="selfie_photo">' +
          '<div class="selfie-actions">' +
            '<button type="button" class="btn btn-secondary" id="selfie_startBtn" onclick="MediaCapture.startCamera(\'selfie\')"><span class="dv">ކެމެރާ ހުޅުވާ</span></button>' +
            '<button type="button" class="btn btn-primary" id="selfie_captureBtn" style="display:none;" onclick="MediaCapture.captureSelfie(\'selfie\')"><span class="dv">ފޮޓޯ ނަންގަވާ</span></button>' +
            '<button type="button" class="btn-sm" id="selfie_retakeBtn" style="display:none;" onclick="MediaCapture.retakeSelfie(\'selfie\')"><span class="dv">އަލުން ނަންގަވާ</span></button>' +
          '</div></div><div class="field-error" id="err_selfie_photo"></div></div>';
  }

  // the notification details sit on the very last page. The
  // phone defaults to the applicant's number, or the attorney's when someone else
  // submits; the email is the one given in the form.
  // Court's transliteration except the one it wrote out (see submit).
  function renderNotifyBlock() {
    return '<div class="notify-block" id="notifyBlock">' +
      '<p class="dv" style="margin:0 0 10px;font-weight:600;">ފޯމު ހުށަހެޅުނުކަމުގެ ނޮޓިފިކޭޝަން މި ނަންބަރު އަދި މި އީމެއިލް އަށް ފޮނުވިފައި ވާނެއެވެ.</p>' +
      '<div class="field-group"><label class="field-label"><span class="required-mark">*</span><span class="dv">ފޯނު ނަންބަރު</span></label>' +
        renderPhoneRow('sms_phone', '').replace('type="tel"', 'type="tel" required') +
        '<div class="field-error" id="err_sms_phone"></div></div>' +
      '<div class="field-group"><label class="field-label"><span class="required-mark">*</span><span class="dv">އީމެއިލް</span></label>' +
        '<input class="field-input" type="email" id="notify_email" name="notify_email" required data-format="email" style="direction:ltr;text-align:left;">' +
        '<div class="field-error" id="err_notify_email"></div></div>' +
    '</div>';
  }
  function prefillNotifyBlock() {
    const poa = readFieldValue('submitting_party') === 'poa';
    const phone = readFieldValue('contact_phone') || (poa ? readFieldValue('poa_attorney_phone') : readFieldValue('applicant_phone'));
    const cc = readFieldValue('contact_phone_cc') || (poa ? readFieldValue('poa_attorney_phone_cc') : readFieldValue('applicant_phone_cc'));
    const email = readFieldValue('applicant_email');
    const ph = document.getElementById('sms_phone'), ccSel = document.getElementById('sms_phone_cc'), em = document.getElementById('notify_email');
    if (ph && !ph.value && phone) ph.value = phone;
    if (ccSel && cc) { ccSel.value = cc; syncCcPicker('sms_phone'); }
    if (em && !em.value && email) em.value = email;
  }

  function renderReviewStep(stepDiv, step) {
    stepDiv.innerHTML =
      '<h3 class="section-title"><span class="dv">ފޯމު ބަލައި ހުށަހެޅުން</span></h3>' +
      '<div id="jurisdictionError" class="jurisdiction-error" style="display:none;"></div>' +
      '<div id="reviewSummary"></div>' +
      renderNotifyBlock() +
      '<div id="submitArea" class="export-panel" style="margin-top:24px;">' +
        '<h3 class="export-title"><span class="dv">ފޯމު ހުށަހެޅުން</span></h3>' +
        '<div class="export-buttons">' +
          '<button type="button" class="btn btn-primary" id="submitBtn" onclick="FormEngine.submitForm()"><span class="dv">ފޯމު ހުށަހެޅުން</span></button>' +
          '<button type="button" class="btn btn-secondary" onclick="FormEngine.printForm()"><span class="dv">PDF ޑައުންލޯޑް</span></button>' +
        '</div></div>' +
      '<div id="successPanel" class="submit-success-panel" style="display:none;">' +
        '<div class="success-icon">✓</div>' +
        '<h3><span class="dv">ފޯމު ހުށަހެޅިއްޖެ!</span></h3>' +
        '<p style="margin-bottom:16px;"><span class="dv" id="successNotifyLine">ތިޔަ ފޯމު ފެމިލީ ކޯޓަށް ހުށަހެޅިއްޖެ.</span></p>' +
        '<div style="margin-bottom:16px;"><span class="dv" style="font-size:0.9rem;">ރެފަރެންސް ނަންބަރު:</span>' +
        '<div class="ref-code-display" id="submittedRefCode" style="margin-top:8px;font-size:1.3rem;"></div></div>' +
        '<p style="font-size:0.85rem;color:var(--color-text-secondary);">' +
        '<span class="dv">މި ނަންބަރު ބޭނުންކޮށްގެން ސްޓެޓަސް ބެލޭނެ.</span></p>' +
        '<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-secondary" onclick="window.location.href=\'status.html?ref=\' + encodeURIComponent(FormEngine._refCode())"><span class="dv">ސްޓެޓަސް ބައްލަވާ</span></button>' +
          '<button type="button" class="btn btn-secondary" onclick="FormEngine.printForm()"><span class="dv">PDF ޑައުންލޯޑް</span></button>' +
        '</div></div>';
  }

  // attachment labels name the document itself, not "a copy of"
  // it, and say pages (ޞަފްޙާ) rather than sides (ފުށް). Display-only normalisation;
  // the verbatim source text is untouched in the spec.
  // Label display rules from the Court: "ފުރިހަމަނަން" is
  // two words; "(އަތޮޅާއި ރަށާއެކު)" is dropped now that atoll and island are dropdowns.
  // Display only — the verbatim spec text is untouched.
  function displayLabel(t) {
    return (t || '').replace(/ފުރިހަމަނަން/g, 'ފުރިހަމަ ނަން').replace(/\s*\(އަތޮޅާއި ރަށާއެކު\)/g, '').replace(/\s+:/g, ':').replace(/([^.])\.\s*$/, '$1');
  }
  function attachmentLabel(t) {
    return (t || '')
      .replace(/ގެ ކޮޕީ/g, '').replace(/ކޮޕީ ނަގަންވާނީ /g, '').replace(/ކޮޕީ/g, '')
      .replace(/ފުށެއް/g, 'ޞަފްޙާއެއް').replace(/ފުށް/g, 'ޞަފްޙާ')
      .replace(/\s+([.،])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  // ─── Field renderers ──────────────────────────────────────────────
  function renderField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'field-group';
    if (field.key) wrap.dataset.key = field.key;
    if (field.visible_when) wrap.dataset.visibleWhen = JSON.stringify(field.visible_when);

    if (field.type === 'info_banner') {
      const banner = infoBanner(field.text_dv || '', field.kind || 'info');
      if (field.visible_when) banner.dataset.visibleWhen = JSON.stringify(field.visible_when);
      return banner;
    }

    if (field.type === 'notice_block') {
      // Multi-line plain text notice (one or more paragraphs of source text)
      const div = document.createElement('div');
      div.className = 'notice-block';
      div.style.cssText = 'background:#fafafa;border-right:3px solid var(--color-primary);padding:10px 14px;margin:10px 0;font-size:0.9rem;line-height:1.6;';
      // display-only blocks can be conditional too (e.g. a table caption shown only when the table is)
      if (field.visible_when) div.dataset.visibleWhen = JSON.stringify(field.visible_when);
      const lines = Array.isArray(field.lines_dv) ? field.lines_dv : [field.text_dv || ''];
      lines.forEach(function (l) {
        const p = document.createElement('p');
        p.style.margin = '4px 0';
        p.innerHTML = '<span class="dv">' + esc(l) + '</span>';
        div.appendChild(p);
      });
      return div;
    }

    if (field.type === 'attachments_checklist') {
      // Verbatim required-attachments checklist from the docx; nothing left → nothing shown
      if (!(field.items_dv || []).length) return document.createDocumentFragment();
      const div = document.createElement('div');
      div.className = 'attachments-checklist';
      div.style.cssText = 'background:#fffbe6;border:1px solid #f0e0a0;border-radius:8px;padding:14px 18px;margin:16px 0;';
      const header = document.createElement('p');
      header.style.cssText = 'font-weight:600;margin:0 0 10px 0;font-size:0.92rem;';
      header.innerHTML = '<span class="dv">' + esc(field.title_dv || 'ފޯމާއެކު ހުށަހަޅަންޖެހޭ ތަކެތި ހަމައަށް ހުރިކަން ޔަޤީންކުރެއްވުމަށް މި ފާހަގަ ޖަހާށެވެ!') + '</span>';
      div.appendChild(header);
      const list = document.createElement('div');
      (field.items_dv || []).forEach(function (text, i) {
        text = attachmentLabel(text);
        const groupKey = field.key || 'attachments';
        const itemKey = groupKey + '_' + i + '_file';
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 0;border-bottom:1px dashed #eee2b8;';
        row.innerHTML =
          '<label class="checkbox-option" style="display:block;">' +
            '<input type="checkbox" name="' + groupKey + '" value="' + esc(text.substring(0, 50)) + '" ' +
              'onchange="this.closest(\'div\').querySelector(\'.att-upload\').style.display = this.checked ? \'block\' : \'none\'">' +
            ' <span class="dv">' + esc(text) + '</span>' +
          '</label>' +
          '<div class="att-upload" style="display:none;margin:6px 24px 4px 0;">' +
            '<input type="file" id="' + itemKey + '" accept="image/*,.pdf,.doc,.docx" class="field-input file-input" ' +
              'onchange="FormEngine.persistFile(\'' + itemKey + '\')" style="font-size:0.82rem;">' +
            '<input type="hidden" id="' + itemKey + '_data" name="' + itemKey + '">' +
            '<p class="field-hint" style="margin:2px 0 0;"><span class="dv">ފޮޓޯ ނުވަތަ ފައިލް އަޕްލޯޑް ކުރައްވާ</span></p>' +
          '</div>';
        list.appendChild(row);
      });
      div.appendChild(list);
      if (field.footnote_dv) {
        const fn = document.createElement('p');
        fn.style.cssText = 'margin:10px 0 0 0;font-size:0.85rem;color:#666;line-height:1.5;';
        fn.innerHTML = '<span class="dv">' + esc(field.footnote_dv) + '</span>';
        div.appendChild(fn);
      }
      return div;
    }

    if (field.type === 'instructions_block') {
      // Footer instructions block: long display-only text from the docx
      const wrap = document.createElement('div');
      wrap.className = 'instructions-block';
      wrap.style.cssText = 'background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;padding:18px 22px;margin:20px 0;font-size:0.88rem;line-height:1.7;';
      if (field.title_dv) {
        // the title is the page's heading, not grey text inside the box
        const h = document.createElement('h3');
        h.className = 'section-title';
        h.innerHTML = '<span class="dv">' + esc(field.title_dv) + '</span>';
        const holder = document.createElement('div');
        holder.appendChild(h);
        holder.appendChild(wrap);
        holder.dataset.instructions = '1';
        wrap.style.marginTop = '0';
        wrap._holder = holder;
      }
      (field.sections || []).forEach(function (sec) {
        if (sec.heading_dv) {
          const sh = document.createElement('h5');
          sh.style.cssText = 'margin:14px 0 6px 0;font-size:0.95rem;font-weight:700;color:var(--color-text-primary);';   // bold sub-headings
          sh.innerHTML = '<span class="dv">' + esc(sec.heading_dv) + '</span>';
          wrap.appendChild(sh);
        }
        (sec.paragraphs_dv || []).forEach(function (p) {
          const para = document.createElement('p');
          para.style.margin = '6px 0';
          para.innerHTML = '<span class="dv">' + esc(p) + '</span>';
          wrap.appendChild(para);
        });
      });
      return wrap._holder || wrap;
    }

    if (field.type === 'court_use_block') {
      // Admin section: visible only in admin view; in the citizen wizard, we still show
      // the section labels so the form is faithful to the source, but with a clear "court use" tag.
      const div = document.createElement('div');
      div.className = 'court-use-block';
      div.style.cssText = 'background:#f0f3f7;border:2px dashed #b0b8c5;border-radius:8px;padding:14px 18px;margin:16px 0;opacity:0.85;';
      const h = document.createElement('h4');
      h.style.cssText = 'margin:0 0 10px 0;font-size:0.95rem;color:#5a6680;';
      h.innerHTML = '<span class="dv">' + esc(field.title_dv || 'ކޯޓުގެ ބޭނުމަށް') + '</span>';
      div.appendChild(h);
      (field.fields_dv || []).forEach(function (txt) {
        const p = document.createElement('p');
        p.style.cssText = 'margin:4px 0;font-size:0.85rem;color:#666;';
        p.innerHTML = '<span class="dv">' + esc(txt) + '</span>';
        div.appendChild(p);
      });
      return div;
    }

    if (field.label_dv) {
      const lbl = document.createElement('label');
      lbl.className = 'field-label';
      const num = field.number ? field.number + ' ' : '';
      // uploads created from the "documents to submit" list follow the same display rule (no "copy")
      const labelText = displayLabel(field.type === 'file_attachment' ? attachmentLabel(field.label_dv) : field.label_dv);
      const optional = false;   // "cut the ikhthiyaaree" — the asterisk alone marks what is required
      // the label row is laid out reversed so marks placed first in the markup read after the text
      lbl.innerHTML = (field.validation && field.validation.required ? '<span class="required-mark">*</span>' : '') +
        (optional ? '<span class="optional-mark dv">(އިޚްތިޔާރީ)</span>' : '') +   // optional fields say so.
        '<span class="dv">' + esc(num + labelText) + '</span>';
      if (field.label_variants) {
        // the label shown depends on an earlier answer; the spec keeps the paper's
        lbl.dataset.labelVariants = JSON.stringify(field.label_variants);
        lbl.dataset.labelBase = num + labelText;
        lbl.dataset.labelNum = num;
      }
      wrap.appendChild(lbl);
    }

    const t = field.type;
    // a case number gets its own panel, written left to right as it appears on the
    // Court's papers.
    const isCaseNo = t === 'text' && (/case_number$/.test(field.key || '') || /ޤަޟިއްޔާ ނަންބަރ/.test(field.label_dv || ''));
    if (isCaseNo) {
      wrap.classList.add('case-lookup');
      const hint = document.createElement('p');
      hint.className = 'field-hint case-hint';
      hint.innerHTML = '<span class="dv">ކޯޓުގެ ލިޔުންތަކުގައިވާ ގޮތަށް ލިޔުއްވާ</span>';
      wrap.appendChild(hint);
    }
    if (t === 'text' || t === 'tel' || t === 'email' || t === 'number' || t === 'date') {
      const inputEl = renderInput(field);
      if (isCaseNo) { const inp = inputEl.tagName === 'INPUT' ? inputEl : inputEl.querySelector('input'); if (inp) { inp.classList.add('case-input'); inp.removeAttribute('data-script'); inp.dir = 'ltr'; } }
      wrap.appendChild(inputEl);
    } else if (t === 'textarea') {
      wrap.appendChild(renderTextarea(field));
      if (field.maxlength) {
        const cc = document.createElement('div');
        cc.className = 'char-counter';
        cc.id = 'cc_' + field.key;
        cc.textContent = '0 / ' + field.maxlength;
        wrap.appendChild(cc);
      }
    } else if (t === 'textarea_with_overflow_attachment') {
      wrap.appendChild(renderTextarea(field));
      if (field.maxlength) {
        const cc = document.createElement('div');
        cc.className = 'char-counter';
        cc.id = 'cc_' + field.key;
        cc.textContent = '0 / ' + field.maxlength;
        wrap.appendChild(cc);
      }
      const note = document.createElement('div');
      note.className = 'form-notification info';
      note.style.marginTop = '8px';
      note.innerHTML = '<span class="notif-icon">' + FcIcons.svg('info') + '</span><div><span class="dv">' +
        esc(field.overflow_hint_dv || 'ދިގު ވާނަމަ ވާޑު ފައިލެއް ހުށަހެޅުއްވޭނެ') + '</span></div>';
      wrap.appendChild(note);
      const fileWrap = document.createElement('div');
      fileWrap.style.marginTop = '8px';
      fileWrap.innerHTML =
        '<input type="file" id="' + field.key + '_attachment" accept="' + (field.attachment_accept || '.doc,.docx,.pdf') +
        '" class="field-input file-input" onchange="FormEngine.persistFile(\'' + field.key + '_attachment\')">' +
        '<input type="hidden" id="' + field.key + '_attachment_data" name="' + field.key + '_attachment">';
      wrap.appendChild(fileWrap);
    } else if (t === 'select') {
      wrap.appendChild(renderSelect(field));
    } else if (t === 'radio') {
      wrap.appendChild(renderRadioGroup(field));
    } else if (t === 'checkbox') {
      wrap.appendChild(renderCheckboxGroup(field));
    } else if (t === 'composite_address') {
      wrap.appendChild(renderAddress(field));
    } else if (t === 'address') {
      wrap.appendChild(renderAddress(field));
    } else if (t === 'composite_group') {
      wrap.appendChild(renderCompositeGroup(field));
    } else if (t === 'id_photo') {
      wrap.appendChild(renderIdPhoto(field));
    } else if (t === 'file_attachment') {
      wrap.appendChild(renderFileAttachment(field));
    } else if (t === 'derived_age') {
      const span = document.createElement('span');
      span.className = 'field-hint';
      span.id = field.key + '_display';
      span.textContent = '—';
      if (field.from_field) span.dataset.derivedFrom = field.from_field;
      if (field.until_field) span.dataset.derivedUntil = field.until_field;   // age at a second date (e.g. at death)
      const hid = document.createElement('input');
      hid.type = 'hidden';
      hid.id = field.key;
      hid.name = field.key;
      wrap.appendChild(span);
      wrap.appendChild(hid);
    } else if (t === 'multi_period_sum') {
      wrap.appendChild(renderMultiPeriodSum(field));
    } else if (t === 'dynamic_table') {
      wrap.appendChild(renderDynamicTable(field));
    } else {
      // unknown — render as text fallback
      wrap.appendChild(renderInput(Object.assign({}, field, { type: 'text' })));
    }

    if (field.key) wrap.appendChild(errEl(field.key));
    return wrap;
  }

  // Dial code as a flag + code picker (the country name is in the list, not on the field).
  // The value lives in a hidden input <key>_cc, so everything that read the old select
  // (validation, drafts, payload) keeps working.
  function ccFlag(code) { const c = DIAL_CODES.find(function (x) { return x[0] === code; }); return 'img/flags/' + (c ? c[2] : 'mv') + '.png'; }
  function renderPhoneRow(key, value) {
    return '<div class="phone-row"><div class="cc-picker" data-cc-key="' + key + '">' +
        '<button type="button" class="cc-btn" onclick="FormEngine.ccToggle(\'' + key + '\')" aria-haspopup="listbox">' +
          '<img class="cc-flag" id="' + key + '_cc_flag" src="' + ccFlag('+960') + '" alt=""><span class="cc-code" id="' + key + '_cc_code">+960</span><span class="cc-caret">▾</span></button>' +
        '<input type="hidden" id="' + key + '_cc" name="' + key + '_cc" value="+960">' +
        '<div class="cc-list" id="' + key + '_cc_list" hidden><input type="text" class="cc-search" placeholder="…" oninput="FormEngine.ccFilter(\'' + key + '\', this.value)">' +
          DIAL_CODES.map(function (c) {
            return '<button type="button" class="cc-item" data-cc="' + c[0] + '" data-name="' + esc(c[1].toLowerCase()) + '" onclick="FormEngine.ccPick(\'' + key + '\', \'' + c[0] + '\')">' +
              '<img src="img/flags/' + c[2] + '.png" alt=""><span class="cc-name">' + esc(c[1]) + '</span><span class="cc-code">' + c[0] + '</span></button>';
          }).join('') + '</div></div>' +
      '<input class="field-input" type="tel" id="' + key + '" name="' + key + '" inputmode="tel" value="' + esc(value || '') + '" data-pattern="^[0-9]{7,15}$" style="font-family:var(--font-en);direction:ltr;"></div>';
  }
  function ccToggle(key) {
    const list = document.getElementById(key + '_cc_list');
    if (!list) return;
    const open = list.hidden;
    Array.prototype.forEach.call(document.querySelectorAll('.cc-list'), function (l) { l.hidden = true; });
    list.hidden = !open;
    if (open) { const s = list.querySelector('.cc-search'); if (s) { s.value = ''; ccFilter(key, ''); s.focus(); } }
  }
  function ccFilter(key, q) {
    q = (q || '').toLowerCase().trim();
    Array.prototype.forEach.call(document.querySelectorAll('#' + key + '_cc_list .cc-item'), function (b) {
      b.hidden = !!q && b.dataset.name.indexOf(q) < 0 && b.dataset.cc.indexOf(q) < 0;
    });
  }
  function ccPick(key, code) {
    const hid = document.getElementById(key + '_cc');
    if (hid) { hid.value = code; hid.dispatchEvent(new Event('change', { bubbles: true })); }
    syncCcPicker(key);
    const list = document.getElementById(key + '_cc_list'); if (list) list.hidden = true;
    const tel = document.getElementById(key); if (tel) tel.focus();
  }
  function syncCcPicker(key) {
    const hid = document.getElementById(key + '_cc'); if (!hid) return;
    const code = hid.value || '+960';
    const f = document.getElementById(key + '_cc_flag'), c = document.getElementById(key + '_cc_code');
    if (f) f.src = ccFlag(code);
    if (c) c.textContent = code;
  }
  function syncCcPickers() { Array.prototype.forEach.call(document.querySelectorAll('[data-cc-key]'), function (w) { syncCcPicker(w.dataset.ccKey); }); }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.cc-picker')) return;
    Array.prototype.forEach.call(document.querySelectorAll('.cc-list'), function (l) { l.hidden = true; });
  });

  // ID fields whose label offers a passport for foreigners: one field, one stored
  // value, but a small choice in front of it decides which shape is enforced. The
  // choice is saved as <key>_kind (id | passport) so search still works on one column.
  const ID_OR_PASSPORT = '^(A[0-9]{6}|[A-Za-z0-9]{6,12})$';
  function renderIdKind(field, inp) {
    const wrap = document.createElement('div');
    wrap.className = 'id-kind-wrap';
    const k = field.key;
    wrap.innerHTML =
      '<div class="radio-group inline id-kind" style="margin-bottom:6px;">' +
        '<label class="radio-option"><input type="radio" name="' + k + '_kind" value="id" checked onchange="FormEngine.idKindChanged(\'' + k + '\')"><span class="dv">އައިޑީ ކާޑު</span></label>' +
        '<label class="radio-option"><input type="radio" name="' + k + '_kind" value="passport" onchange="FormEngine.idKindChanged(\'' + k + '\')"><span class="dv">ޕާސްޕޯޓު</span></label>' +
      '</div>';
    inp.dataset.idKind = '1';
    inp.placeholder = 'A123456';
    inp.inputMode = 'numeric';       // only the six digits are typed; the A is added
    inp.value = 'A';                 // the A is there before anything is typed
    wrap.appendChild(inp);
    return wrap;
  }
  // a lone "A" is an empty ID field — for the required check, the shape
  // check and the data alike
  function idValue(inp) { const v = (inp.value || '').trim(); return (inp.dataset.idKind === '1' && v === 'A') ? '' : v; }
  function syncIdPrefixes() {
    Array.prototype.forEach.call(document.querySelectorAll('input[data-id-kind="1"]'), function (inp) {
      const passport = readFieldValue(inp.id + '_kind') === 'passport';
      if (!passport && !(inp.value || '').trim()) inp.value = 'A';
      if (passport && (inp.value || '').trim() === 'A') inp.value = '';
    });
  }
  function idKindChanged(k) {
    const inp = document.getElementById(k);
    if (!inp) return;
    syncIdPrefixes();
    inp.placeholder = readFieldValue(k + '_kind') === 'passport' ? '' : 'A123456';
    inp.inputMode = readFieldValue(k + '_kind') === 'passport' ? 'text' : 'numeric';
    const err = document.getElementById('err_' + k); if (err) { err.textContent = ''; err.classList.remove('visible'); }
  }
  // "have month be number not english letter … calendar can still be". The
  // field is a plain dd/mm/yyyy entry (the digits format themselves); the button
  // opens the browser's calendar, whose choice is written back as numbers.
  function dateWidget(inp, constraint) {
    const wrap = document.createElement('div');
    wrap.className = 'date-wrap';
    wrap.appendChild(inp);
    const nat = document.createElement('input');
    nat.type = 'date'; nat.className = 'date-native'; nat.tabIndex = -1; nat.setAttribute('aria-hidden', 'true');
    nat.min = '1900-01-01';
    if (constraint === 'past_only') nat.max = todayMaldives();
    if (constraint === 'today_only') { nat.min = todayMaldives(); nat.max = todayMaldives(); }
    nat.addEventListener('change', function () {
      if (!nat.value) return;
      inp.value = isoToDmy(nat.value);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'date-cal'; btn.title = 'ކަލަންޑަރު'; btn.setAttribute('aria-label', 'ކަލަންޑަރު');
    btn.innerHTML = FcIcons.svg('calendar', 18);
    btn.addEventListener('click', function () {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(inp.value)) nat.value = dmyToIso(inp.value);
      else if (inp.dataset.minAge) nat.value = '1990-01-01';   // a birth-date calendar starts a generation back, not at today
      try { if (typeof nat.showPicker === 'function') nat.showPicker(); else nat.click(); } catch (e) { try { nat.click(); } catch (e2) { /* ignore */ } }
    });
    wrap.appendChild(btn);
    wrap.appendChild(nat);
    return wrap;
  }

  function renderInput(field) {
    const val0 = field.validation || {};
    if (field.type === 'text' && val0.pattern === ID_OR_PASSPORT) return renderIdKind(field, renderInputInner(field));
    return renderInputInner(field);
  }
  function renderInputInner(field) {
    const inp = document.createElement('input');
    const isDate = field.type === 'date';
    const val0 = field.validation || {};
    if (field.type === 'tel') {
      // dial code + number; the number keeps the field's key, the code is <key>_cc
      const wrap = document.createElement('div');
      wrap.innerHTML = renderPhoneRow(field.key, '');
      const tel = wrap.querySelector('input');
      if (val0.required) tel.required = true;
      return wrap.firstChild;
    }
    inp.type = isDate ? 'text' : field.type;
    inp.className = 'field-input' + (isDate ? ' date-input' : '');
    inp.id = field.key;
    inp.name = field.key;
    if (isDate) {
      // no future dates unless the field says otherwise; the
      // rule is enforced by the step gate and the live check
      const c = field.constraint || val0.date_constraint || 'past_only';
      inp.placeholder = 'dd/mm/yyyy';
      inp.inputMode = 'numeric';
      inp.maxLength = 10;
      inp.autocomplete = 'off';
      inp.dataset.dateConstraint = c;
      if (val0.min_age) inp.dataset.minAge = val0.min_age;
      if (val0.max_field) inp.dataset.maxField = val0.max_field;
      if (val0.min_date_field) inp.dataset.minDateField = [].concat(val0.min_date_field).join(',');
    } else if (field.placeholder) {
      inp.placeholder = field.placeholder;
    }
    if (field.type === 'number') {
      if (val0.max_field) inp.dataset.maxField = val0.max_field;
    }
    const val = field.validation || {};
    if (val.required) inp.required = true;
    if (field.type === 'number') {
      const mn = field.min !== undefined ? field.min : val.min;
      const mx = field.max !== undefined ? field.max : val.max;
      const st = field.step !== undefined ? field.step : val.step;
      if (mn !== undefined) inp.min = mn;
      if (mx !== undefined) inp.max = mx;
      if (st !== undefined) inp.step = st;
    }

    if (field.maxlength || val.maxlength) inp.maxLength = field.maxlength || val.maxlength;
    // carry validation rules for the step gate
    if (val.pattern) inp.dataset.pattern = val.pattern;
    if (/^\^\[0-9\]/.test(val.pattern || '')) inp.inputMode = 'decimal';   // amounts are numbers only
    if (val.not_equal_field) inp.dataset.notEqualField = val.not_equal_field;
    if (val.format) inp.dataset.format = val.format;
    if (field.type === 'email' && !inp.dataset.format) inp.dataset.format = 'email';
    if (val.script || field.validation_script) inp.dataset.script = val.script || field.validation_script;
    if (isDate && (field.constraint || val.date_constraint)) {
      inp.dataset.dateConstraint = field.constraint || val.date_constraint;
    }
    if (field.on_change) inp.setAttribute('onchange', field.on_change);
    if (isDate) return dateWidget(inp, inp.dataset.dateConstraint || 'past_only');
    return inp;
  }

  function renderTextarea(field) {
    const ta = document.createElement('textarea');
    ta.className = 'field-input';
    ta.id = field.key;
    ta.name = field.key;
    ta.rows = field.rows || 4;
    if (field.validation && field.validation.script) ta.dataset.script = field.validation.script;
    if (field.maxlength) {
      ta.maxLength = field.maxlength;
      ta.setAttribute('oninput', "FormEngine.updateCharCount('" + field.key + "', " + field.maxlength + ")");
    }
    if (field.validation && field.validation.required) ta.required = true;
    return ta;
  }

  function renderSelect(field) {
    const sel = document.createElement('select');
    sel.className = 'field-input field-select';
    sel.id = field.key;
    sel.name = field.key;
    if (field.validation && field.validation.required) sel.required = true;
    const opts = field.options_ref
      ? window.FormLookups.get(field.options_ref)
      : (field.options || []);
    opts.forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label_dv;
      sel.appendChild(opt);
    });
    return sel;
  }

  function renderRadioGroup(field) {
    const wrap = document.createElement('div');
    wrap.className = 'radio-group' + (field.inline ? ' inline' : '');
    const radioOpts = field.options || (field.options_ref ? window.FormLookups.get(field.options_ref) : []) || [];
    radioOpts.forEach(function (o) {
      const lbl = document.createElement('label');
      lbl.className = 'radio-option';
      const onChange = field.on_change ? ' onchange="' + field.on_change + '"' : '';
      lbl.innerHTML = '<input type="radio" name="' + field.key + '" value="' + esc(o.value) + '"' +
        (field.validation && field.validation.required ? ' required' : '') + onChange + '>' +
        '<span class="dv">' + esc(o.label_dv) + '</span>';
      wrap.appendChild(lbl);
    });
    return wrap;
  }

  function renderCheckboxGroup(field) {
    const wrap = document.createElement('div');
    wrap.className = 'checkbox-group' + (field.inline ? ' inline' : '');
    (field.options || []).forEach(function (o) {
      const lbl = document.createElement('label');
      lbl.className = 'checkbox-option';
      const onChange = field.on_change ? ' onchange="' + field.on_change + '"' : '';
      const req = field.validation && field.validation.required ? ' required' : '';   // audit: was never set
      lbl.innerHTML = '<input type="checkbox" name="' + field.key + '" value="' + esc(o.value) + '"' + onChange + req + '>' +
        '<span class="dv">' + esc(o.label_dv) + '</span>';
      wrap.appendChild(lbl);
    });
    return wrap;
  }

  function renderAddress(field) {
    const wrap = document.createElement('div');
    const islands = window.FormLookups.get(field.island_options || 'islands');
    const islandSel = document.createElement('select');
    islandSel.className = 'field-input field-select';
    islandSel.id = field.key + '_island';
    islandSel.name = field.key + '_island';
    islands.forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label_dv;
      islandSel.appendChild(opt);
    });
    wrap.appendChild(islandSel);

    const ta = document.createElement('textarea');
    ta.className = 'field-input';
    ta.id = field.key;
    ta.name = field.key;
    ta.rows = 2;
    ta.style.marginTop = '8px';
    ta.placeholder = 'ގޭގެ ނަން / ނަންބަރު';
    if (field.validation && field.validation.required) ta.required = true;
    wrap.appendChild(ta);

    if (field.with_apartment) {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.style.marginTop = '8px';
      // Docx uses: "ވަނަ ފަންގިފިލާ، އެޕާޓްމަންޓް:" and "މަގު:"
      row.innerHTML =
        '<div><label class="field-label"><span class="dv">ވަނަ ފަންގިފިލާ، އެޕާޓްމަންޓް:</span></label>' +
        '<input class="field-input" type="text" name="' + field.key + '_apartment"></div>' +
        '<div><label class="field-label"><span class="dv">މަގު:</span></label>' +
        '<input class="field-input" type="text" name="' + field.key + '_road"></div>';
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderCompositeGroup(field) {
    const wrap = document.createElement('div');
    wrap.className = 'field-sub-group';
    (field.subfields || []).forEach(function (sub, i) {
      // every part carries its own number (3.3.1, 3.3.2 …)
      if (!sub.number && field.number) sub = Object.assign({}, sub, { number: field.number + '.' + (i + 1) });
      if (field.validation && field.validation.required && !(sub.validation && sub.validation.required)) {
        sub = Object.assign({}, sub, { validation: Object.assign({}, sub.validation || {}, { required: true }) });
      }
      wrap.appendChild(renderField(sub));
    });
    return wrap;
  }

  // addresses are atoll → island → house, from the island list,
  // so they validate; the whole address is also kept as one line under the field's key.
  // Sub-labels)"; ގެ is ours).
  // every address is atoll + island dropdowns (validated) + house line.
  // Same widget for a field and for a table cell (compact: the column header is the label).
  // an address abroad is country (from a list) + city (typed); ނޭނގޭ leaves the
  // rest blank. Sub-labels ޤައުމު / ސިޓީ
  function addressWidgetHtml(k, req, num, compact) {
    const lab = function (t, id) { return compact ? '' : '<label class="field-label" id="' + id + '" data-num="' + esc(num) + '">' + (req ? '<span class="required-mark">*</span>' : '') + '<span class="dv">' + num + t + '</span></label>'; };
    const ph = function (t) { return compact ? ' title="' + t + '"' : ''; };
    return '<div class="field-group"' + (compact ? ' style="margin:0 0 4px"' : '') + '>' + lab('1 އަތޮޅު', k + '_lbl_atoll') +
        '<select class="field-input field-select" id="' + k + '_atoll" name="' + k + '_atoll"' + (req ? ' required' : '') + ph('އަތޮޅު') + ' onchange="FormEngine.addressAtollChanged(\'' + k + '\')"></select>' +
        '<div class="field-error" id="err_' + k + '_atoll"></div></div>' +
      '<div class="field-group" id="' + k + '_island_wrap"' + (compact ? ' style="margin:0 0 4px"' : '') + '>' + lab('2 ރަށް', k + '_lbl_island') +
        '<select class="field-input field-select" id="' + k + '_island" name="' + k + '_island"' + (req ? ' required' : '') + ph('ރަށް') + ' onchange="FormEngine.addressChanged(\'' + k + '\')"></select>' +
        '<select class="field-input field-select" id="' + k + '_country" name="' + k + '_country" hidden' + ph('ޤައުމު') + ' onchange="FormEngine.addressChanged(\'' + k + '\')"></select>' +
        '<input class="field-input" type="text" id="' + k + '_island_text" hidden data-script="thaana"' + ph('ރަށް') + ' oninput="FormEngine.addressChanged(\'' + k + '\')">' +
        '<div class="field-error" id="err_' + k + '_island"></div></div>' +
      '<div class="field-group" id="' + k + '_detail_wrap"' + (compact ? ' style="margin:0"' : '') + '>' + lab('3 ގޭގެ ނަން', k + '_lbl_detail') +
        '<input class="field-input" type="text" id="' + k + '_detail" name="' + k + '_detail" data-script="thaana" placeholder="ގޭގެ ނަން"' + (req ? ' required' : '') + ph('ގޭގެ ނަން') + ' oninput="FormEngine.addressChanged(\'' + k + '\')">' +
        '<div class="field-error" id="err_' + k + '_detail"></div></div>' +
      '<input type="hidden" id="' + k + '" name="' + k + '">';
  }
  function fillAddressLists(root) {
    const nodes = Array.prototype.slice.call(root.querySelectorAll('[data-address-key]'));
    if (root.dataset && root.dataset.addressKey) nodes.push(root);     // the wrapper itself
    nodes.forEach(function (w) {
      const k = w.dataset.addressKey;
      atollOptions(w.querySelector('#' + k + '_atoll'), '', allowUnknownFor(k));
      islandOptions(w.querySelector('#' + k + '_island'), '', '');
      countryOptions(w.querySelector('#' + k + '_country'), '');
      enhanceSelects(w);
    });
  }
  function renderAddress(field) {
    const k = field.key, num = field.number ? field.number + '.' : '';
    const req = field.validation && field.validation.required;
    const wrap = document.createElement('div');
    wrap.className = 'field-sub-group address-group';
    wrap.dataset.addressKey = k;
    // a current address that follows a permanent one on the same page can copy it
    const pk = /_current_address$/.test(k) ? k.replace(/_current_address$/, '_permanent_address') : null;
    const hasPermanent = pk && resolvedSteps.some(function (st) { return (st.fields || []).some(function (f) { return f.key === pk; }); });
    const sameBox = hasPermanent
      ? '<label class="checkbox-option same-addr"><input type="checkbox" id="' + k + '_same" data-same-of="' + pk + '" onchange="FormEngine.sameAddress(\'' + k + '\', \'' + pk + '\')"><span class="dv">ދާއިމީ އެޑްރެހާ އެއްގޮތް</span></label>'
      : '';
    wrap.innerHTML = sameBox + '<div class="addr-fields">' + addressWidgetHtml(k, req, num, false) + '</div>';
    fillAddressLists(wrap);
    return wrap;
  }
  function copyAddress(pk, k) {
    const src = document.getElementById(pk + '_atoll'), dst = document.getElementById(k + '_atoll');
    if (!src || !dst) return;
    const srcCode = src.value;
    // ނޭނގޭ exists only on the other party's list; a permanent address never has it
    if (!Array.prototype.some.call(dst.options, function (o) { return o.value === srcCode; })) return;
    dst.value = srcCode;
    addressAtollChanged(k);
    ['_island', '_country', '_island_text', '_detail'].forEach(function (suf) {
      const a = document.getElementById(pk + suf), b = document.getElementById(k + suf);
      if (a && b) b.value = a.value;
    });
    [dst, document.getElementById(k + '_island'), document.getElementById(k + '_country')].forEach(syncSearchable);
    addressChanged(k);
  }
  function sameAddress(k, pk) {
    const box = document.getElementById(k + '_same');
    const wrap = document.querySelector('[data-address-key="' + k + '"]');
    if (!box || !wrap) return;
    wrap.classList.toggle('addr-locked', box.checked);
    if (box.checked) copyAddress(pk, k);
  }
  // put a saved atoll/island/house back into one widget (top-level field or table cell)
  function restoreAddressWidget(k, data) {
    const sel = document.getElementById(k + '_atoll');
    if (!sel) return;
    sel.value = data[k + '_atoll'] || '';
    addressAtollChanged(k);
    const isl = document.getElementById(k + '_island'), txt = document.getElementById(k + '_island_text');
    const island = data[k + '_island'] !== undefined ? data[k + '_island'] : (data[k + '_island_text'] || '');
    if (isl && !isl.hidden) isl.value = island || '';
    if (txt && !txt.hidden) txt.value = island || '';
    const co = document.getElementById(k + '_country');
    if (co && data[k + '_country'] !== undefined) co.value = data[k + '_country'];
    const det = document.getElementById(k + '_detail');
    if (det && data[k + '_detail'] !== undefined) det.value = data[k + '_detail'];
    [sel, isl, co].forEach(syncSearchable);
    addressChanged(k);
  }
  function addressAtollChanged(k) {
    const sel = document.getElementById(k + '_atoll');
    const code = sel.value;
    const isl = document.getElementById(k + '_island'), txt = document.getElementById(k + '_island_text');
    const co = document.getElementById(k + '_country');
    const det = document.getElementById(k + '_detail'), detWrap = document.getElementById(k + '_detail_wrap');
    const lblIsl = document.getElementById(k + '_lbl_island'), lblDet = document.getElementById(k + '_lbl_detail');
    const noData = !(ATOLLS && ATOLLS.length);        // file:// fallback — islands are typed
    const unknown = code === 'UNKNOWN';
    const abroad = code === 'ABROAD';
    // abroad → country from the list + city typed; unknown → nothing more to fill
    isl.hidden = abroad || unknown || noData;
    if (co) co.hidden = !abroad;
    txt.hidden = !(noData && !abroad && !unknown);
    if (detWrap) detWrap.hidden = unknown;
    // the visible control carries the requirement; a foreign town may be written
    // in Latin
    isl.required = !isl.hidden && sel.required;
    if (co) co.required = abroad && sel.required;
    txt.required = !txt.hidden && sel.required;
    if (det) det.required = !unknown && sel.required;
    if (abroad) { txt.removeAttribute('data-script'); if (det) det.removeAttribute('data-script'); }
    else { txt.setAttribute('data-script', 'thaana'); if (det) det.setAttribute('data-script', 'thaana'); }
    if (lblIsl) lblIsl.querySelector('.dv').textContent = (lblIsl.dataset.num || '') + (abroad ? '2 ޤައުމު' : '2 ރަށް');
    if (lblDet) lblDet.querySelector('.dv').textContent = (lblDet.dataset.num || '') + (abroad ? '3 ސިޓީ' : '3 ގޭގެ ނަން');
    if (det) det.placeholder = abroad ? 'ސިޓީ' : 'ގޭގެ ނަން';   // the placeholder, like the atoll's and the island's
    if (!abroad && !unknown && !noData) { islandOptions(isl, code, ''); enhanceSelect(isl); syncSearchable(isl); }
    addressChanged(k);
  }
  function addressChanged(k) {
    // a current address ticked "same as permanent" follows every change to the permanent one
    Array.prototype.forEach.call(document.querySelectorAll('input[data-same-of="' + k + '"]:checked'), function (box) {
      copyAddress(k, box.id.replace(/_same$/, ''));
    });
    const code = document.getElementById(k + '_atoll').value;
    const hid = document.getElementById(k);
    if (code === 'UNKNOWN') { if (hid) hid.value = 'ނޭނގޭ'; return; }
    const a = (ATOLLS || []).find(function (x) { return x.code === code; });
    const noData = !(ATOLLS && ATOLLS.length);
    const abroad = code === 'ABROAD';
    const atollName = abroad ? 'ރާއްޖޭން ބޭރު' : (a ? a.name_dv.split(' (')[0] : '');
    const co = document.getElementById(k + '_country');
    const island = abroad ? ((co && co.value) || '')
      : (noData ? document.getElementById(k + '_island_text').value : document.getElementById(k + '_island').value);
    const detail = document.getElementById(k + '_detail').value;
    if (hid) hid.value = [detail, island, atollName].filter(Boolean).join('، ');
  }

  function renderIdPhoto(field) {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<p class="field-hint"><span class="dv">ފޮޓޯ މަދުވެގެން ' + (field.min_w || 300) + 'x' + (field.min_h || 300) +
        ' ޕިކްސެލް، ސައިޒް މަދުވެގެން ' + (field.min_kb || 50) + 'KB</span></p>' +
      '<input type="file" id="' + field.key + '" accept="image/*" class="field-input file-input"' + (field.validation && field.validation.required ? ' data-required-file="1"' : '') + ' ' +
        'onchange="MediaCapture.validateImage(\'' + field.key + '\'); FormEngine.persistFile(\'' + field.key + '\')">' +
      '<input type="hidden" id="' + field.key + '_data" name="' + field.key + '">' +
      '<div class="image-preview-box" id="' + field.key + '_preview" style="display:none;">' +
        '<img id="' + field.key + '_img" class="image-preview-thumb" alt="">' +
        '<span id="' + field.key + '_info" class="image-info"></span>' +
      '</div>';
    return wrap;
  }

  function renderFileAttachment(field) {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<input type="file" id="' + field.key + '" accept="' + (field.accept || ' */*') +
        '" class="field-input file-input"' + (field.validation && field.validation.required ? ' data-required-file="1"' : '') +
        ' onchange="FormEngine.persistFile(\'' + field.key + '\')">' +
      '<input type="hidden" id="' + field.key + '_data" name="' + field.key + '">';
    return wrap;
  }

  function renderMultiPeriodSum(field) {
    const wrap = document.createElement('div');
    (field.rows || []).forEach(function (r) {
      const rowWrap = document.createElement('div');
      rowWrap.className = 'field-group';
      rowWrap.innerHTML =
        '<label class="field-label"><span class="dv">' + esc(r.label_dv) + '</span></label>' +
        '<div class="field-row">' +
          '<div><label class="field-label" style="font-size:0.82rem"><span class="dv">އަހަރު</span></label>' +
          '<input class="field-input" type="number" name="' + r.key + '_years" min="0" onchange="FormEngine.recalcPeriodSum(\'' + field.key + '\')"></div>' +
          '<div><label class="field-label" style="font-size:0.82rem"><span class="dv">މަސް</span></label>' +
          '<input class="field-input" type="number" name="' + r.key + '_months" min="0" max="11" onchange="FormEngine.recalcPeriodSum(\'' + field.key + '\')"></div>' +
          '<div><label class="field-label" style="font-size:0.82rem"><span class="dv">ދުވަސް</span></label>' +
          '<input class="field-input" type="number" name="' + r.key + '_days" min="0" max="30" onchange="FormEngine.recalcPeriodSum(\'' + field.key + '\')"></div>' +
        '</div>';
      wrap.appendChild(rowWrap);
    });
    if (field.show_total) {
      const totalDiv = document.createElement('div');
      totalDiv.className = 'field-group';
      totalDiv.style.cssText = 'background:var(--color-primary-light);padding:12px 16px;border-radius:var(--radius-sm);';
      totalDiv.innerHTML = '<label class="field-label"><span class="dv">ޖުމްލަ މުއްދަތު (އޮޓޮ)</span></label>' +
        '<span id="' + field.key + '_total" style="font-family:var(--font-en);font-weight:700;font-size:1rem;">0 އަހަރު، 0 މަސް، 0 ދުވަސް</span>';
      wrap.appendChild(totalDiv);
    }
    wrap.dataset.periodKey = field.key;
    wrap.dataset.rowKeys = JSON.stringify((field.rows || []).map(function (r) { return r.key; }));
    return wrap;
  }

  function renderDynamicTable(field) {
    const wrap = document.createElement('div');
    wrap.dataset.dynamicTableKey = field.key;
    wrap.dataset.mode = field.mode || 'count_driven';
    if (field.validation && field.validation.required) wrap.dataset.required = '1';
    if (field.count_field) wrap.dataset.countField = field.count_field;   // was never set → rows never appeared
    wrap.dataset.columns = JSON.stringify(field.columns || []);
    const cols = field.columns || [];
    let headHtml = '<tr><th>#</th>';
    const tableRequired = !!(field.validation && field.validation.required) || (field.mode || 'count_driven') === 'count_driven';
    cols.forEach(function (c, ci) {
      const must = c.required || (tableRequired && ci === 0);   // a required file column, or the first cell of every row
      headHtml += '<th>' + (must ? '<span class="required-mark">*</span>' : '') + '<span class="dv">' + esc(displayLabel(c.type === 'file' ? attachmentLabel(c.label_dv) : c.label_dv)) + '</span></th>';
    });
    headHtml += '</tr>';
    wrap.innerHTML =
      '<div class="form-table-wrapper"><table class="form-table">' +
        '<thead>' + headHtml + '</thead>' +
        '<tbody id="' + field.key + '_tbody"></tbody>' +
      '</table></div>';
    if (field.mode === 'plus_button') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-sm';
      btn.style.marginTop = '8px';
      btn.innerHTML = '<span class="dv">+ އިތުރު ކުރޭ</span>'; // "across everything change to ithuru kurey"
      btn.onclick = function () { addDynamicRow(field.key); };
      wrap.appendChild(btn);
      // Start with min_rows (default 1)
      setTimeout(function () {
        // optional tables show nothing until "+" is pressed
        const initRows = (field.validation && field.validation.required) ? Math.max(1, field.min_rows || 1) : 0;
        wrap.dataset.minRows = String(field.min_rows || 1);
        for (let i = 0; i < initRows; i++) addDynamicRow(field.key);
      }, 0);
    }
    return wrap;
  }

  // ─── Dynamic table helpers ────────────────────────────────────────
  function addDynamicRow(key) {
    const tbody = document.getElementById(key + '_tbody');
    if (!tbody) return;
    const wrap = tbody.closest('[data-dynamic-table-key]');
    const cols = JSON.parse(wrap.dataset.columns || '[]');
    const idx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.dataset.rowIdx = idx;
    let html = '<td>' + idx + '</td>';
    cols.forEach(function (c) {
      const cellName = key + '_' + idx + '_' + c.key;
      if (c.type === 'select') {
        html += '<td><select class="field-input" name="' + cellName + '">';
        const colOpts = c.options || (c.options_ref ? window.FormLookups.get(c.options_ref) : []) || [];
        colOpts.forEach(function (o) {
          html += '<option value="' + esc(o.value) + '">' + esc(o.label_dv) + '</option>';
        });
        html += '</select></td>';
      } else if (c.type === 'date') {
        html += '<td><input type="text" class="field-input date-input" name="' + cellName + '" placeholder="dd/mm/yyyy" inputmode="numeric" maxlength="10" autocomplete="off" data-date-constraint="past_only" style="width:130px"></td>';
      } else if (c.type === 'number') {
        html += '<td><input type="number" class="field-input" name="' + cellName + '"' +
                (c.min !== undefined ? ' min="' + c.min + '"' : '') + (c.max !== undefined ? ' max="' + c.max + '"' : '') +
                (c.step !== undefined ? ' step="' + c.step + '"' : '') + '></td>';
      } else if (c.type === 'file') {
        html += '<td><input type="file" id="' + cellName + '" accept="image/*,.pdf" class="field-input file-input" onchange="FormEngine.persistFile(\'' + cellName + '\')"' + (c.required ? ' data-required-file="1"' : '') + '>' +
                '<input type="hidden" id="' + cellName + '_data" name="' + cellName + '"></td>';
      } else if (c.type === 'tel') {
        // country code on every phone number, tables included
        html += '<td style="min-width:230px">' + renderPhoneRow(cellName, '') + '</td>';
      } else if (c.type === 'address') {
        // atoll/island dropdowns for every address, tables included
        html += '<td style="min-width:200px"><div data-address-key="' + cellName + '">' + addressWidgetHtml(cellName, false, '', true) + '</div></td>';
      } else {
        // Thaana-only rule reaches table cells too (gen_spec sets col.script)
        html += '<td><input type="text" class="field-input" name="' + cellName + '"' +
                (c.script ? ' data-script="' + esc(c.script) + '"' : '') +
                (c.pattern ? ' data-pattern="' + esc(c.pattern) + '" style="direction:ltr"' : '') + '></td>';
      }
    });
    if (wrap.dataset.mode === 'plus_button') {
      html += '<td><button type="button" class="btn-sm" onclick="FormEngine.removeDynamicRow(\'' + key + '\', ' + idx + ')">×</button></td>';
    }
    tr.innerHTML = html;
    tbody.appendChild(tr);
    fillAddressLists(tr);
    decorateFileInputs(tr);
    enhanceSelects(tr);
  }

  function removeDynamicRow(key, idx) {
    const tbody = document.getElementById(key + '_tbody');
    if (!tbody) return;
    const tr = tbody.querySelector('tr[data-row-idx="' + idx + '"]');
    if (tr) tr.remove();
    // Renumber
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (row, i) {
      row.dataset.rowIdx = i + 1;
      row.firstChild.textContent = i + 1;
    });
  }

  function rebuildCountDrivenTable(key, count) {
    const tbody = document.getElementById(key + '_tbody');
    if (!tbody) return;
    const wrap = tbody.closest('[data-dynamic-table-key]');
    if (!wrap) return;
    // Save existing data
    const saved = {};
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      const idx = tr.dataset.rowIdx;
      saved[idx] = {};
      Array.prototype.forEach.call(tr.querySelectorAll('input,select'), function (el) {
        const nm = el.name || el.id;
        if (nm) saved[idx][nm] = el.value;
      });
    });
    tbody.innerHTML = '';
    for (let i = 0; i < count; i++) addDynamicRow(key);
    // Restore
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      const idx = tr.dataset.rowIdx;
      if (saved[idx]) {
        Array.prototype.forEach.call(tr.querySelectorAll('input,select'), function (el) {
          if (el.name && saved[idx][el.name] !== undefined) el.value = saved[idx][el.name];
        });
        Array.prototype.forEach.call(tr.querySelectorAll('[data-address-key]'), function (w) {
          restoreAddressWidget(w.dataset.addressKey, saved[idx]);
        });
        Array.prototype.forEach.call(tr.querySelectorAll('[data-cc-key]'), function (w) { syncCcPicker(w.dataset.ccKey); });
      }
    });
  }

  // ─── Multi-period sum recalc ──────────────────────────────────────
  function recalcPeriodSum(key) {
    const wrap = document.querySelector('[data-period-key="' + key + '"]');
    if (!wrap) return;
    const rowKeys = JSON.parse(wrap.dataset.rowKeys || '[]');
    let y = 0, m = 0, d = 0;
    rowKeys.forEach(function (rk) {
      y += parseInt(document.querySelector('[name="' + rk + '_years"]').value) || 0;
      m += parseInt(document.querySelector('[name="' + rk + '_months"]').value) || 0;
      d += parseInt(document.querySelector('[name="' + rk + '_days"]').value) || 0;
    });
    m += Math.floor(d / 30); d %= 30;
    y += Math.floor(m / 12); m %= 12;
    const totalEl = document.getElementById(key + '_total');
    if (totalEl) totalEl.textContent = y + ' އަހަރު، ' + m + ' މަސް، ' + d + ' ދުވަސް';
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  function infoBanner(text_dv, kind) {
    const div = document.createElement('div');
    div.className = 'form-notification ' + (kind || 'info');
    div.innerHTML = '<span class="notif-icon">' + FcIcons.svg(kind === 'warning' ? 'warning' : 'info') + '</span>' +
      '<div><span class="dv">' + esc(text_dv) + '</span></div>';
    return div;
  }

  function errEl(key) {
    const e = document.createElement('div');
    e.className = 'field-error';
    e.id = 'err_' + key;
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Wizard ───────────────────────────────────────────────────────
  // "match these numbers with the numbering of the section of the forms
  // starting with zero or letters": a page shows its section number (from its
  // title or its first numbered field); the instructions page is 0; a page with
  // no number between sections n and n+2 is n+1; the rest (who is submitting,
  // declaration, attachments, review …) are lettered.
  function stepBadges() {
    // a title's own number wins, sub-number included ("12.3 …" → 12.3); a number read
    // off the first field is only its section part, and is ignored if it falls
    // behind the sections before it (per-person item numbers such as 1–6 under 11.x)
    const raw = resolvedSteps.map(function (st) {
      if (st.step_key === 'instructions' || st.module === 'instructions') return { n: '0', major: 0 };
      let m = /^\s*(\d+(?:\.\d+)?)/.exec(st.title_dv || '');
      if (m) return { n: m[1], major: parseInt(m[1], 10) };
      const f = (st.fields || []).find(function (x) { return x.key && (x.number || /^\s*\d/.test(x.label_dv || '')); });
      if (f) { m = /^\s*(\d+)/.exec(String(f.number || f.label_dv)); if (m) return { n: m[1], major: parseInt(m[1], 10), weak: true }; }
      return null;
    });
    let lastMajor = -1;
    for (let i = 0; i < raw.length; i++) {
      if (!raw[i]) continue;
      if (raw[i].weak && raw[i].major < lastMajor) { raw[i] = null; continue; }
      lastMajor = Math.max(lastMajor, raw[i].major);
    }
    // a run of pages without a number between section p and section q: exactly
    // q-p-1 pages → p+1 … q-1 each; one page covering several sections → "p+1–q-1"
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== null) continue;
      let j = i; while (j < raw.length && raw[j] === null) j++;
      const prev = i > 0 && raw[i - 1] ? raw[i - 1].major : NaN;
      const next = j < raw.length && raw[j] ? raw[j].major : NaN;
      const k = j - i, span = next - prev - 1;
      if (!isNaN(prev) && !isNaN(next) && span >= 1) {
        if (span === k) for (let t = 0; t < k; t++) raw[i + t] = { n: String(prev + 1 + t), major: prev + 1 + t };
        else if (k === 1) raw[i] = { n: (prev + 1) + '–' + (next - 1), major: prev + 1 };
      }
      i = j;
    }
    // pages outside the form's own numbering are lettered ހ ށ ނ ރ … (the
    // Thaana alphabet), the instructions page included
    const THAANA = ['ހ', 'ށ', 'ނ', 'ރ', 'ބ', 'ޅ', 'ކ', 'އ', 'ވ', 'މ', 'ފ', 'ދ', 'ތ', 'ލ', 'ގ', 'ޏ', 'ސ', 'ޑ', 'ޒ', 'ޓ', 'ޔ', 'ޕ', 'ޖ', 'ޗ'];
    let letter = 0;
    return raw.map(function (r) { return (r && r.n !== '0') ? r.n : THAANA[letter++ % THAANA.length]; });
  }
  // The name a page is listed under in the side list: its own
  // title, else a name for its kind, else its first question. Kind names
  function stepName(st) {
    const t = (st.title_dv || '').replace(/^\s*[\d.]+\s */, '').replace(/[:\s]+$/, '');
    if (t) return t;
    if (st.module === 'instructions') return 'އިރުޝާދު';
    if (st.type === 'submitting_party') return 'ފޯމު ހުށަހަޅަނީ ކާކު؟';
    if (st.type === 'payment') return 'ފޯމު ފީ';
    if (st.type === 'declaration') return 'އިޤްރާރު';
    if (st.module === 'attachments') return 'ލިޔުންތައް';
    if (st.type === 'review') return 'ފޯމު ބަލައި ހުށަހެޅުން';
    const f = (st.fields || []).find(function (x) { return x.label_dv; });
    const lab = f ? displayLabel(f.label_dv).replace(/^\s*[\d.]+\s */, '').replace(/[:؟\s]+$/, '') : '';
    return lab.length > 44 ? lab.slice(0, 42) + '…' : (lab || st.step_key);
  }
  function buildStepNav(badges) {
    const nav = document.getElementById('stepNav');
    if (!nav) return;
    nav.innerHTML = '<ol class="step-list">' + resolvedSteps.map(function (st, i) {
      return '<li class="step-item" data-step="' + i + '" onclick="FormEngine.goToStep(' + i + ')">' +
        '<span class="sn-badge' + (/[\u0780-\u07BF]/.test(badges[i]) ? ' dv' : '') + '">' + esc(badges[i]) + '</span>' +
        '<span class="sn-name dv">' + esc(stepName(st)) + '</span></li>';
    }).join('') + '</ol>';
  }
  function buildProgressSteps() {
    const container = document.getElementById('progressSteps');
    const badges = stepBadges();
    buildStepNav(badges);
    container.innerHTML = resolvedSteps.map(function (_, i) {
      const thaana = /[\u0780-\u07BF]/.test(badges[i]);
      return '<div class="progress-step" data-step="' + i + '" onclick="FormEngine.goToStep(' + i + ')">' + (thaana ? '<span class="dv">' + esc(badges[i]) + '</span>' : esc(badges[i])) + '</div>';
    }).join('');
  }

  function showStep(index) {
    if (index < 0 || index >= resolvedSteps.length) return;
    for (let i = 0; i < resolvedSteps.length; i++) {
      const el = document.getElementById('step_' + i);
      if (el) el.hidden = (i !== index);
    }
    currentStep = index;
    if (index > maxStepReached) maxStepReached = index;
    clearErrorSummary();
    updateProgress();
    updateNav();
    applyAllConditionals();
    // after the very first page the reference code is small faded text
    // under the form name — still there, no longer a box
    const rn = document.getElementById('refNotice');
    if (rn) rn.classList.toggle('ref-quiet', index > 0);

    const step = resolvedSteps[index];
    if (step.type === 'declaration') {
      // Init signature pad first time
      if (!signaturePad) {
        signaturePad = window.MediaCapture.initSignaturePad('declarant_signature_canvas');
        window.MediaCapture.signaturePads['declarant_signature'] = signaturePad;
        const clearBtn = document.getElementById('clearSigBtn');
        if (clearBtn) clearBtn.addEventListener('click', function () { if (signaturePad) signaturePad.clear(); });
      } else {
        signaturePad.resize();
      }
      // Auto-fill declarant name
      maybeAutoFillDeclarant();
    } else if (step.type === 'review') {
      buildReview();
      prefillNotifyBlock();
    } else if (step.module === 'attachments') {
      refreshUploadsSummary();
    }
    document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateProgress() {
    const pct = ((currentStep + 1) / resolvedSteps.length) * 100;
    document.getElementById('progressFill').style.width = pct + '%';
    const pt = document.getElementById('progressText');
    if (pt) pt.textContent = (currentStep + 1) + ' / ' + resolvedSteps.length;
    Array.prototype.forEach.call(document.querySelectorAll('.progress-step'), function (el, i) {
      el.classList.toggle('active', i === currentStep);
      el.classList.toggle('completed', i < currentStep);
      el.style.cursor = i <= maxStepReached ? 'pointer' : 'default';
      el.style.opacity = i <= maxStepReached ? '1' : '0.4';
    });
    Array.prototype.forEach.call(document.querySelectorAll('#stepNav .step-item'), function (el, i) {
      el.classList.toggle('active', i === currentStep);
      el.classList.toggle('completed', i < currentStep);
      el.classList.toggle('reachable', i <= maxStepReached);
    });
  }

  function updateNav() {
    document.getElementById('btnPrev').style.visibility = nextVisible(currentStep, -1) < 0 ? 'hidden' : 'visible';
    const nextBtn = document.getElementById('btnNext');
    const j = nextVisible(currentStep, +1);
    if (j < 0) {
      nextBtn.style.display = 'none';
    } else {
      nextBtn.style.display = '';
      const dvSpan = nextBtn.querySelector('.dv');
      dvSpan.textContent = resolvedSteps[j].type === 'review' ? 'ރިވިއު ކުރުމަށް' : 'ކުރިއަށް';   // "Review kurumah"
    }
  }

  // ─── Step-level visibility ───────────────────────────────────────
  // A step with visible_when (e.g. "6.2 court details" after 6.1 = no, the
  // grandmother sections when "alive" = no) is skipped entirely: not shown, not
  // validated, greyed in the progress bar, and its data left out of the
  // submission. states the general rule:
  // nothing that an earlier answer rules out may be shown or required.
  let wizardOrder = false;   // the wizard's choice answers section 6, so its page is skipped
  function stepVisible(i) {
    const st = resolvedSteps[i];
    if (!st) return true;
    if (wizardOrder && (st.fields || []).some(function (f) { return f.key === 'order_type'; })) return false;
    if (!st.visible_when) return true;
    try { return evalCondition(st.visible_when); } catch (e) { return true; }
  }
  function nextVisible(from, dir) {
    for (let j = from + dir; j >= 0 && j < resolvedSteps.length; j += dir) {
      if (stepVisible(j)) return j;
    }
    return -1;
  }
  function applyStepVisibility() {
    let changed = false;
    for (let i = 0; i < resolvedSteps.length; i++) {
      const el = document.getElementById('step_' + i);
      if (!el) continue;
      const skip = !stepVisible(i);
      if (el.classList.contains('step-skipped') !== skip) changed = true;
      el.classList.toggle('step-skipped', skip);
    }
    Array.prototype.forEach.call(document.querySelectorAll('.progress-step, #stepNav .step-item'), function (el) {
      el.classList.toggle('skipped', !stepVisible(Number(el.dataset.step)));
    });
    return changed;
  }

  // "show the error … at the bottom so they know what question to correct
  // without having to scroll up" — every error on the page is listed under the
  // buttons; each entry scrolls to its question.
  function showErrorSummary(stepIdx) {
    const stepEl = document.getElementById('step_' + stepIdx);
    const nav = document.getElementById('wizardNav');
    let box = document.getElementById('stepErrors');
    if (!stepEl || !nav) return;
    const items = [];
    Array.prototype.forEach.call(stepEl.querySelectorAll('.field-error.visible'), function (err) {
      const grp = err.closest('.field-group') || err.closest('[data-dynamic-table-key]') || err.parentElement;
      const lbl = grp && grp.querySelector('.field-label .dv');
      const key = (err.id || '').replace(/^err_/, '');
      let text = lbl ? lbl.textContent.trim() : '';
      if (!text && grp) { const cap = grp.closest('.field-group'); const l2 = cap && cap.querySelector('.field-label .dv'); text = l2 ? l2.textContent.trim() : ''; }
      items.push({ key: key, text: text || key, msg: err.textContent.trim() });
    });
    if (!items.length) { if (box) box.remove(); return; }
    // the same list in a popup, closed with an X, so the person sees it wherever the page is scrolled
    let modal = document.getElementById('errorModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'errorModal'; modal.className = 'modal-overlay';
      modal.innerHTML = '<div class="modal-box"><button type="button" class="modal-x" aria-label="close" onclick="document.getElementById(\'errorModal\').style.display=\'none\'">&times;</button><h3><span class="dv">ފުރިހަމަނުވާ ބައިތައް</span></h3><ul id="errorModalList" class="step-errors-list"></ul></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
    }
    document.getElementById('errorModalList').innerHTML = items.map(function (it) { return '<li><span class="dv">' + esc(it.text) + '</span> <span class="dv step-err-msg">' + esc(it.msg) + '</span></li>'; }).join('');
    modal.style.display = 'flex';
    if (!box) { box = document.createElement('div'); box.id = 'stepErrors'; box.className = 'form-notification error step-errors no-print'; nav.insertAdjacentElement('beforebegin', box); }
    box.innerHTML = '<span class="notif-icon">' + FcIcons.svg('warning') + '</span><div><span class="dv step-errors-title">ފުރިހަމަނުވާ ބައިތައް:</span><ul>' +
      items.map(function (it) { return '<li><button type="button" class="step-err-link" data-key="' + esc(it.key) + '"><span class="dv">' + esc(it.text) + '</span></button> <span class="dv step-err-msg">' + esc(it.msg) + '</span></li>'; }).join('') + '</ul></div>';
    box.addEventListener('click', function (e) {
      const b = e.target.closest('.step-err-link'); if (!b) return;
      const el = document.getElementById(b.dataset.key) || document.querySelector('[name="' + b.dataset.key + '"]') || document.getElementById('err_' + b.dataset.key);
      if (!el) return;
      const target = el.closest('.field-group') || el;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof el.focus === 'function') setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }, 300);
    });
  }
  function clearErrorSummary() { const box = document.getElementById('stepErrors'); if (box) box.remove(); }

  function nextStep() {
    if (!validateCurrentStep()) { showErrorSummary(currentStep); return; }
    clearErrorSummary();
    autosaveDraft();
    const j = nextVisible(currentStep, +1);
    if (j >= 0) showStep(j);
  }
  function prevStep() { const j = nextVisible(currentStep, -1); if (j >= 0) showStep(j); }
  function goToStep(i) {
    if (!(i >= 0 && i <= maxStepReached && stepVisible(i))) return;
    if (i > currentStep && !validateCurrentStep()) return;   // a forward jump must not skip the gate
    showStep(i);
  }
  // Every visible step must pass before submission (a person can go back from the
  // review and blank a field, then return by the progress bar). Returns the index
  // of the first failing step or -1.
  function firstInvalidStep() {
    for (let i = 0; i < resolvedSteps.length; i++) {
      if (!stepVisible(i)) continue;
      if (!validateStepIndex(i)) return i;
    }
    return -1;
  }

  // ─── Validation ───────────────────────────────────────────────────
  function validateCurrentStep() { return validateStepIndex(currentStep); }
  function validateStepIndex(stepIdx) {
    const stepEl = document.getElementById('step_' + stepIdx);
    if (!stepEl) return true;
    clearErrors(stepEl);
    let valid = true;
    Array.prototype.forEach.call(stepEl.querySelectorAll('[required]'), function (input) {
      // skip if hidden (ruled out by an answer, or a swapped-out control such as the island list for an address abroad)
      if (input.closest('.conditional-hidden') || input.hidden || input.closest('[hidden]')) return;
      const name = input.name || input.id;
      if (input.type === 'radio') {
        const checked = stepEl.querySelector('input[name="' + name + '"]:checked');
        if (!checked) { showError(name, 'މިބައި ފުރިހަމަކުރައްވާ!'); valid = false; }
      } else if (input.type === 'checkbox') {
        const anyChecked = stepEl.querySelector('input[type="checkbox"][name="' + name + '"]:checked');
        if (!anyChecked) { showError(name, 'މަދުވެގެން އެއް ގޮޅި ފާހަގަ ކުރައްވާ'); valid = false; }
      } else if (!(input.dataset && input.dataset.idKind === '1' ? idValue(input) : input.value.trim())) {
        showError(name, 'މިބައި ފުރިހަމަކުރައްވާ!'); valid = false;
      }
    });
    // the signature and the photo are required on their page, not only at submission
    if (stepEl.querySelector('#declarant_signature_canvas') && signaturePad && signaturePad.isEmpty()) {
      showError('declarant_signature', 'ސޮއި ކުރައްވާ'); valid = false;
    }
    const selfieHid = stepEl.querySelector('#selfie_data');
    if (selfieHid && !selfieHid.value) { showError('selfie_photo', 'ސެލްފީ ނަންގަވާ'); valid = false; }
    // required file cells (a document per row, e.g. a child's birth certificate)
    Array.prototype.forEach.call(stepEl.querySelectorAll('input[type="file"][data-required-file="1"]'), function (fi) {
      if (fi.closest('.conditional-hidden')) return;
      const hid = document.getElementById(fi.id + '_data');
      if (hid && !hid.value) {
        showError(fi.id, 'މިބައި ފުރިހަމަކުރައްވާ!'); fi.classList.add('has-error'); valid = false;
        // a cell has no error line of its own; the table's line says which row
        const tbl = fi.closest('[data-dynamic-table-key]'), tr = fi.closest('tr');
        if (tbl) showError(tbl.dataset.dynamicTableKey, 'ލިޔުން އެޓޭޗް ކުރައްވާ (' + (tr && tr.dataset.rowIdx ? tr.dataset.rowIdx : '') + ')');
      }
    });
    // required tables (e.g. witnesses when "witnesses present" = yes): at least one row with content
    Array.prototype.forEach.call(stepEl.querySelectorAll('[data-dynamic-table-key][data-required="1"]'), function (wrap) {
      if (wrap.closest('.conditional-hidden')) return;
      const need = Math.max(1, parseInt(wrap.dataset.minRows, 10) || 1);
      const filledRows = Array.prototype.filter.call(wrap.querySelectorAll('tbody tr'), function (tr) {
        return Array.prototype.some.call(tr.querySelectorAll('input, select'), function (el) { return (el.value || '').trim() !== ''; });
      }).length;
      if (filledRows < need) { showError(wrap.dataset.dynamicTableKey, 'މިބައި ފުރިހަމަކުރައްވާ!'); valid = false; }
    });
    // count-driven tables (one row per child): every row needs at least its first cell
    Array.prototype.forEach.call(stepEl.querySelectorAll('[data-dynamic-table-key][data-mode="count_driven"]'), function (wrap) {
      if (wrap.closest('.conditional-hidden')) return;
      Array.prototype.forEach.call(wrap.querySelectorAll('tbody tr'), function (tr) {
        const first = tr.querySelector('input[type="text"], input[type="number"]');
        if (first && !(first.value || '').trim()) { showError(first.name, 'މިބައި ފުރިހަމަކުރައްވާ!'); first.classList.add('has-error'); valid = false; }
      });
    });

    // Thaana-only fields: no Latin letters may be entered
    Array.prototype.forEach.call(stepEl.querySelectorAll('[data-script="thaana"]'), function (el) {
      if (el.closest('.conditional-hidden')) return;
      const name = el.name || el.id;
      if (name && /[A-Za-z]/.test(el.value || '')) {
        showError(name, THAANA_ONLY_DV); valid = false;
      }
    });
    // format rules on filled visible inputs (pattern / date / number ranges)
    Array.prototype.forEach.call(stepEl.querySelectorAll('input'), function (input) {
      if (input.closest('.conditional-hidden')) return;
      const name = input.name || input.id;
      const v = input.dataset.idKind === '1' ? idValue(input) : (input.value || '').trim();
      if (!v || !name) return;
      if (input.dataset.pattern) {
        try {
          // ID-card / passport gate: the strict A###### shape when "ID card" is chosen,
          // a passport shape (6–12 letters/digits, at least one digit) when "passport"
          if (input.dataset.idKind) {
            const kind = readFieldValue(name + '_kind') || 'id';
            const okId = kind === 'passport' ? (/^[A-Z0-9]{6,12}$/.test(v) && /[0-9]/.test(v)) : /^A[0-9]{6}$/.test(v);
            if (!okId) {
              showError(name, kind === 'passport' ? 'ސައްޙަ ޕާސްޕޯޓު ނަންބަރެއް ޖައްސަވާ' : 'އައިޑީ ކާޑު ނަންބަރު ރަނގަޅު ކުރައްވާ');   // "just asking them to correct the ID card number"
              valid = false;
              return;
            }
          } else if (!new RegExp(input.dataset.pattern).test(v)) {
            showError(name, input.type === 'tel' ? 'ސައްޙަ ފޯނު ނަންބަރެއް ޖައްސަވާ' : 'ސައްޙަ ގޮތަށް ފުރުއްވާ');
            valid = false;
            return;
          }
        } catch (e) { /* bad regex in spec — don't block */ }
      }
      if (input.type === 'tel') {
        const ccEl = document.getElementById(name + '_cc');
        const cc = ccEl ? ccEl.value : '';
        const rule = PHONE_LEN[cc];
        // a national trunk "0" typed in front of a foreign number is not counted
        const digits = (cc && cc !== '+960' && v.charAt(0) === '0') ? v.slice(1) : v;
        if (rule && (digits.length < rule[0] || digits.length > rule[1])) {
          showError(name, 'ސައްޙަ ފޯނު ނަންބަރެއް ޖައްސަވާ (' + (rule[0] === rule[1] ? rule[0] : rule[0] + '–' + rule[1]) + ' އަކުރު)');
          valid = false;
          return;
        }
      }
      // two fields that may not hold the same value (applicant vs respondent ID …)
      if (input.dataset.notEqualField) {
        const otherV = (readFieldValue(input.dataset.notEqualField) || '').trim().toUpperCase();
        if (otherV && otherV === v.toUpperCase()) {
          showError(name, 'މައްސަލަ ހުށަހަޅާ ފަރާތާއި މި ފަރާތުގެ އައިޑީ ކާޑު ނަންބަރު އެއްގޮތްވެގެން ނުވާނެ');
          valid = false;
          return;
        }
      }
      // the person filling the form may not know the other party's address,
      // so a single dash is accepted in place of an email.
      if (input.dataset.format === 'email' && v !== '-' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        showError(name, 'ސައްޙަ އީމެއިލް އެޑްރެހެއް ޖައްސަވާ');
        valid = false;
        return;
      }
      if (input.classList.contains('date-input')) {
        const d = parseAnyDate(v);
        if (!d || d.getFullYear() < 1900 || d.getFullYear() > 2100) {
          showError(name, 'ތާރީޚު ރަނގަޅެއް ނޫން');
          valid = false;
          return;
        }
        // 09-07: no future dates anywhere
        // unless a field explicitly allows them; the declaration date is today only.
        const c = input.dataset.dateConstraint || 'past_only';
        const todayIso = todayMaldives();
        const vIso = /^\d{4}-/.test(v) ? v : dmyToIso(v);
        if (c === 'past_only' && vIso > todayIso) {
          showError(name, 'ނިމިފައިވާ ތާރީޚެއް');
          valid = false;
          return;
        }
        if (c === 'today_only' && vIso !== todayIso) {
          showError(name, 'ތާރީޚު ރަނގަޅެއް ނޫން');
          valid = false;
          return;
        }
        // adults must be 18 (applicant, respondent, person to marry)
        if (input.dataset.minAge) {
          const age = ageFromDate(d);
          if (age < Number(input.dataset.minAge)) {
            showError(name, 'ޢުމުރުން ' + input.dataset.minAge + ' އަހަރު ފުރިފައިވާން ޖެހޭނެ');
            valid = false;
            return;
          }
        }
      }
      // a date that may not fall before another (death ≥ birth, concluded ≥ filed …)
      if (input.dataset.minDateField && input.classList.contains('date-input')) {
        const vIso2 = /^\d{4}-/.test(v) ? v : dmyToIso(v);
        let earlier = null;
        input.dataset.minDateField.split(',').forEach(function (fk) {
          const other = readFieldValue(fk);
          const otherIso = other ? (/^\d{4}-/.test(other) ? other : dmyToIso(other)) : '';
          if (otherIso && vIso2 && vIso2 < otherIso && !earlier) earlier = fk;
        });
        if (earlier) {
          showError(name, 'މި ތާރީޚު ' + (labelOf(earlier) || '') + ' އަށްވުރެ ކުރީގައި ވެގެން ނުވާނެ');
          valid = false;
          return;
        }
      }
      // a count may not exceed its parent count (6.2 ≤ 6.1)
      if (input.dataset.maxField) {
        const other = readFieldValue(input.dataset.maxField);
        if (other !== '' && Number(v) > Number(other)) {
          showError(name, 'މި ޢަދަދު ' + (labelOf(input.dataset.maxField) || '') + ' އަށްވުރެ ގިނަވެގެން ނުވާނެ');
          valid = false;
          return;
        }
      }
      if (input.type === 'number') {
        const num = Number(v);
        if (isNaN(num) ||
            (input.min !== '' && num < Number(input.min)) ||
            (input.max !== '' && num > Number(input.max)) ||
            (input.step === '1' && num % 1 !== 0)) {
          showError(name, 'ސައްޙަ ޢަދަދެއް ޖައްސަވާ');
          valid = false;
        }
      }
    });
    return valid;
  }

  function showError(key, msg) {
    const errEl = document.getElementById('err_' + key);
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    const input = document.getElementById(key);
    if (input) input.classList.add('has-error');
  }
  function clearErrors(container) {
    Array.prototype.forEach.call(container.querySelectorAll('.field-error'), function (el) {
      el.textContent = ''; el.classList.remove('visible');
    });
    Array.prototype.forEach.call(container.querySelectorAll('.has-error'), function (el) {
      el.classList.remove('has-error');
    });
  }

  // ─── Conditional visibility ───────────────────────────────────────
  function applyLabelVariants() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-label-variants]'), function (lbl) {
      try {
        const vs = JSON.parse(lbl.dataset.labelVariants);
        const hit = vs.find(function (v) { return evalCondition(v.when); });
        const dv = lbl.querySelector('.dv');
        if (dv) dv.textContent = hit ? (lbl.dataset.labelNum || '') + displayLabel(hit.label_dv) : lbl.dataset.labelBase;
      } catch (e) { /* ignore */ }
    });
  }
  function applyAllConditionals() {
    applyLabelVariants();
    Array.prototype.forEach.call(document.querySelectorAll('[data-visible-when]'), function (el) {
      try {
        const rule = JSON.parse(el.dataset.visibleWhen);
        const visible = evalCondition(rule);
        el.classList.toggle('conditional-hidden', !visible);
      } catch (e) { /* ignore parse errors */ }
    });
    if (applyStepVisibility() && document.getElementById('btnNext')) updateNav();
  }

  function evalCondition(rule) {
    if (rule.all) return rule.all.every(evalCondition);
    if (rule.any) return rule.any.some(evalCondition);
    if (rule.computed) return evalComputed(rule.computed, rule.args || {});
    const val = readFieldValue(rule.field);
    switch (rule.op) {
      case 'eq': return val === rule.value;
      case 'ne': return val !== rule.value;
      case 'gt': return Number(val) >  Number(rule.value);
      case 'gte': return Number(val) >= Number(rule.value);
      case 'lt': return Number(val) <  Number(rule.value);
      case 'lte': return Number(val) <= Number(rule.value);
      case 'in':
        if (Array.isArray(val)) {
          return val.some(function (v) { return (rule.values || []).indexOf(v) >= 0; });
        }
        return (rule.values || []).indexOf(val) >= 0;
      case 'not_in':
        if (Array.isArray(val)) {
          return !val.some(function (v) { return (rule.values || []).indexOf(v) >= 0; });
        }
        return (rule.values || []).indexOf(val) < 0;
      case 'truthy': return Array.isArray(val) ? val.length > 0 : !!val;
      case 'falsy': return !val;
      default: return false;
    }
  }

  function evalComputed(name, args) {
    if (name === 'is_submitter_poa') return readFieldValue('submitting_party') === 'poa';
    if (name === 'any_child_under_18') {
      const count = parseInt(readFieldValue(args.count_field || 'children_count')) || 0;
      const prefix = args.dob_prefix || 'children_count_';
      const suffix = args.dob_suffix || '_dob';
      for (let i = 1; i <= count; i++) {
        const dob = readFieldValue(prefix + i + suffix);
        const parsed = parseDMY(dob);
        if (!parsed) return true;  // unknown DOB → assume minor present
        const age = Math.floor((Date.now() - parsed.getTime()) / (365.25*24*60*60*1000));
        if (age < 18) return true;
      }
      return false;
    }
    return false;
  }

  function readFieldValue(key) {
    const radioChecked = document.querySelector('input[type="radio"][name="' + key + '"]:checked');
    // A field hidden by its own conditional counts as unanswered, so anything that
    // depends on it hides too (e.g. "has children" switched back to no must hide
    // the spending details even though 6.3 still holds its earlier answer).
    if (radioChecked) return (radioChecked.closest('.conditional-hidden') || radioChecked.closest('.step-skipped')) ? '' : radioChecked.value;
    if (document.querySelector('input[type="radio"][name="' + key + '"]')) return '';   // radio group with nothing chosen = unanswered
    // checkbox group → array of checked values
    const boxes = document.querySelectorAll('input[type="checkbox"][name="' + key + '"]');
    if (boxes.length) {
      const vals = [];
      Array.prototype.forEach.call(boxes, function (b) { if (b.checked) vals.push(b.value); });
      return vals;
    }
    const el = document.getElementById(key) || document.querySelector('[name="' + key + '"]');
    if (!el || el.closest('.conditional-hidden') || el.closest('.step-skipped')) return '';
    return el.value || '';
  }

  // ─── Submitting-party POA toggle ──────────────────────────────────
  function handleSubmittingPartyChange() {
    const val = readFieldValue('submitting_party');
    const poaWrap = document.getElementById('poa_uploads');
    const nameWrap = document.getElementById('poa_attorney_wrap');
    if (poaWrap) poaWrap.classList.toggle('conditional-hidden', val !== 'poa');
    if (nameWrap) nameWrap.classList.toggle('conditional-hidden', val !== 'poa');
    applyAllConditionals();
  }

  function maybeAutoFillDeclarant() {
    const declInput = document.getElementById('declarant_name');
    if (!declInput || declInput.value.trim()) return;
    const isPoa = readFieldValue('submitting_party') === 'poa';
    const src = isPoa
      ? document.querySelector('[name="poa_attorney_name"]')
      : document.querySelector('[name="applicant_full_name"]');
    if (src && src.value) {
      declInput.value = src.value;
      const hint = document.getElementById('declarant_name_hint');
      if (hint && isPoa) hint.style.display = '';
    }
    // Prefill date
    const dateInput = document.getElementById('declarant_date');
    if (dateInput && !dateInput.value) dateInput.value = todayDMY();
  }

  // Court wording for the Thaana-only rule
  const THAANA_ONLY_DV = 'ހަމައެކަނި ތާނައިން ލިޔުއްވާ';


  // ─── Optional on-screen Dhivehi keyboard ─────────────────────────
  // A "ދިވެހި ކީބޯޑު" button appears under whichever Thaana-only field has focus; it
  // opens a tap keyboard (letters, fili, sukun, space, backspace) that inserts at
  // the caret. The phonetic mapping above still works alongside it.
  const KB_ROWS = [
    ['ހ', 'ށ', 'ނ', 'ރ', 'ބ', 'ޅ', 'ކ', 'އ', 'ވ', 'މ', 'ފ', 'ދ', 'ތ', 'ލ', 'ގ', 'ޏ', 'ސ', 'ޑ', 'ޒ', 'ޓ', 'ޔ', 'ޕ', 'ޖ', 'ޗ'],
    ['ޘ', 'ޙ', 'ޚ', 'ޛ', 'ޜ', 'ޝ', 'ޞ', 'ޟ', 'ޠ', 'ޡ', 'ޢ', 'ޣ', 'ޤ', 'ޥ'],
    ['ަ', 'ާ', 'ި', 'ީ', 'ު', 'ޫ', 'ެ', 'ޭ', 'ޮ', 'ޯ', 'ް'],
    ['،', '؟', '.', 'SPACE', 'BACK']
  ];
  let kbTarget = null;
  function kbInsert(ch) {
    const el = kbTarget;
    if (!el) return;
    el.focus();
    const s = el.selectionStart, t = el.selectionEnd;
    if (ch === 'BACK') {
      if (s === t && s > 0) el.setRangeText('', s - 1, t, 'end'); else el.setRangeText('', s, t, 'end');
    } else {
      el.setRangeText(ch === 'SPACE' ? ' ' : ch, s, t, 'end');
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function kbPanel() {
    let p = document.getElementById('dvKeyboard');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'dvKeyboard';
    p.className = 'dv-keyboard';
    p.hidden = true;
    p.innerHTML = KB_ROWS.map(function (row) {
      return '<div class="dv-kb-row">' + row.map(function (ch) {
        const label = ch === 'SPACE' ? 'ސްޕޭސް' : (ch === 'BACK' ? 'ފޮހެލާ' : ch);
        return '<button type="button" class="dv-kb-key' + (ch === 'SPACE' || ch === 'BACK' ? ' wide' : '') + '" data-ch="' + ch + '">' + label + '</button>';
      }).join('') + '</div>';
    }).join('');
    p.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the field's focus
    p.addEventListener('click', function (e) {
      const b = e.target.closest('.dv-kb-key');
      if (b) kbInsert(b.dataset.ch);
    });
    return p;
  }
  function kbToggleBtn() { return document.getElementById('dvKeyboardBtn'); }
  function kbToggle() {
    const p = kbPanel();
    if (!kbTarget) return;
    if (!p.hidden) { p.hidden = true; return; }
    kbToggleBtn().insertAdjacentElement('afterend', p);
    p.hidden = false;
  }
  function initDvKeyboard() {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'dvKeyboardBtn'; btn.className = 'dv-kb-btn'; btn.hidden = true;
    btn.innerHTML = FcIcons.svg('keyboard', 18) + ' <span class="dv">ދިވެހި ކީބޯޑު</span>';
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', kbToggle);
    document.body.appendChild(btn);
    document.addEventListener('focusin', function (e) {
      const el = e.target;
      if (!(el && el.dataset && el.dataset.script === 'thaana')) return;
      kbTarget = el;
      const grp = el.closest('.field-group') || el.parentElement;
      grp.insertAdjacentElement('afterend', btn);
      btn.hidden = false;
      const p = document.getElementById('dvKeyboard');
      if (p && !p.hidden) btn.insertAdjacentElement('afterend', p);
    });
    document.addEventListener('focusout', function () {
      // hide only when focus has really left for something other than a Thaana field
      setTimeout(function () {
        const a = document.activeElement;
        if (a && a.dataset && a.dataset.script === 'thaana') return;
        const p = document.getElementById('dvKeyboard');
        if (p) p.hidden = true;
        btn.hidden = true;
      }, 150);
    });
  }

  // "the error should show immediately" — the 18-and-over rule, a count that
  // may not exceed its parent count, and an impossible date are reported as soon as
  // the value is complete, not only when "continue" is pressed. The step gate still
  // runs the full set.
  function liveValidate(el) {
    if (!el || !el.dataset || el.closest('.conditional-hidden')) return;
    const name = el.name || el.id;
    const v = (el.value || '').trim();
    if (!name || !v) return;
    if (el.classList.contains('date-input')) {
      const d = parseAnyDate(v);
      if (!d) return;
      const c = el.dataset.dateConstraint || 'past_only';
      const vIso = /^\d{4}-/.test(v) ? v : dmyToIso(v);
      if (c === 'past_only' && vIso > todayMaldives()) { showError(name, 'ނިމިފައިވާ ތާރީޚެއް'); return; }
      if (el.dataset.minAge && ageFromDate(d) < Number(el.dataset.minAge)) {
        showError(name, 'ޢުމުރުން ' + el.dataset.minAge + ' އަހަރު ފުރިފައިވާން ޖެހޭނެ');
        return;
      }
    }
    if (el.dataset.maxField) {
      const other = readFieldValue(el.dataset.maxField);
      if (other !== '' && Number(v) > Number(other)) {
        showError(name, 'މި ޢަދަދު ' + (labelOf(el.dataset.maxField) || '') + ' އަށްވުރެ ގިނަވެގެން ނުވާނެ');
      }
    }
    // "if 6.2.3 is after 6.2.4 flag the error immediately upon selecting"
    if (el.dataset.minDateField && el.classList.contains('date-input') && parseAnyDate(v)) {
      const vIso2 = /^\d{4}-/.test(v) ? v : dmyToIso(v);
      let earlier = null;
      el.dataset.minDateField.split(',').forEach(function (fk) {
        const other = readFieldValue(fk);
        const otherIso = other ? (/^\d{4}-/.test(other) ? other : dmyToIso(other)) : '';
        if (otherIso && vIso2 < otherIso && !earlier) earlier = fk;
      });
      if (earlier) showError(name, 'މި ތާރީޚު ' + (labelOf(earlier) || '') + ' އަށްވުރެ ކުރީގައި ވެގެން ނުވާނެ');
    }
  }
  function initLiveChecks() {
    document.addEventListener('input', function (e) {
      const el = e.target;
      if (!el || !el.dataset) return;
      const v = (el.value || '').trim();
      if (el.type === 'number' && el.max !== '' && Number(el.max) <= 9 && (el.value || '').length > 1) el.value = el.value.slice(0, 1);   // one digit (months)
      if (el.dataset.maxField) liveValidate(el);
      if (el.classList.contains('date-input') && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) liveValidate(el);
      // a parent count changed: the counts that depend on it are checked again
      const nm = el.name || el.id;
      if (nm) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-max-field="' + nm + '"], [data-min-date-field*="' + nm + '"]'), function (dep) {
          const g = dep.closest('.field-group');
          if (g) { Array.prototype.forEach.call(g.querySelectorAll('.field-error.visible'), function (x) { x.textContent = ''; x.classList.remove('visible'); }); dep.classList.remove('has-error'); }
          liveValidate(dep);
        });
      }
    });
    document.addEventListener('change', function (e) { liveValidate(e.target); });
    document.addEventListener('blur', function (e) { liveValidate(e.target); }, true);
  }

  function initFieldFeedback() {
    initDvKeyboard();
    // ID numbers are upper-case (A123456); typing a123456 should not fail the pattern
    document.addEventListener('input', function (e) {
      const el = e.target;
      if (el && el.dataset && el.dataset.pattern && el.dataset.pattern.indexOf('A[0-9]') >= 0 && /[a-z]/.test(el.value || '')) {
        const pos = el.selectionStart; el.value = el.value.toUpperCase();
        try { el.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
      }
    });
    // with "ID card" chosen the A is there by default — the person types the
    // six digits and the value is A######; the letter cannot be lost or doubled.
    document.addEventListener('input', function (e) {
      const el = e.target;
      if (!(el && el.dataset && el.dataset.idKind === '1')) return;
      if (readFieldValue(el.id + '_kind') === 'passport') return;
      const digits = (el.value || '').replace(/[^0-9]/g, '').slice(0, 6);
      const want = digits ? 'A' + digits : ((el.value || '').toUpperCase() === 'A' ? 'A' : '');
      if (el.value !== want) {
        el.value = want;
        try { el.setSelectionRange(want.length, want.length); } catch (err) { /* ignore */ }
      }
    });
    // "once the information starts being filled the notification must disappear" (b0025)
    document.addEventListener('input', function (e) {
      const g = e.target.closest && e.target.closest('.field-group');
      if (!g) return;
      Array.prototype.forEach.call(g.querySelectorAll('.field-error.visible'), function (el) {
        el.textContent = ''; el.classList.remove('visible');
      });
      e.target.classList.remove('has-error');
    });
    document.addEventListener('change', function (e) {
      const g = e.target.closest && e.target.closest('.field-group');
      if (!g) return;
      Array.prototype.forEach.call(g.querySelectorAll('.field-error.visible'), function (el) {
        el.textContent = ''; el.classList.remove('visible');
      });
    });
    // Thaana-only fields type Thaana whatever keyboard is active: Latin keys are
    // mapped through the standard Dhivehi phonetic layout (q→ް w→އ e→ެ r→ރ …, shift
    // for the second set), so nobody has to switch keyboards. Pasted Latin text is
    // still refused (b0019).
    document.addEventListener('beforeinput', function (e) {
      const el = e.target;
      if (!el.dataset || el.dataset.script !== 'thaana') return;
      if (e.inputType !== 'insertText' || !e.data) return;
      let out = '', mapped = false;
      for (const ch of e.data) {
        if (THAANA_KEYS[ch]) { out += THAANA_KEYS[ch]; mapped = true; } else out += ch;
      }
      if (!mapped) return;
      e.preventDefault();
      const s = el.selectionStart, t = el.selectionEnd;
      if (typeof el.setRangeText === 'function') el.setRangeText(out, s, t, 'end');
      else el.value = el.value.slice(0, s) + out + el.value.slice(t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.addEventListener('input', function (e) {
      const el = e.target;
      if (!el.dataset || el.dataset.script !== 'thaana') return;
      if (!/[A-Za-z]/.test(el.value)) return;
      const pos = el.selectionStart;
      const before = el.value.length;
      if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') {
        el.value = el.value.replace(/[A-Za-z]/g, '');            // pasted Latin: dropped
        showError(el.name || el.id, THAANA_ONLY_DV);
      } else {
        el.value = el.value.replace(/[A-Za-z]/g, function (c) { return THAANA_KEYS[c] || ''; });   // composed input (mobile keyboards)
      }
      try { const d = before - el.value.length; el.setSelectionRange(pos - d, pos - d); } catch (err) { /* not all inputs support it */ }
    });
  }

  // ─── Date input auto-format ───────────────────────────────────────
  function initDateInputs() {
    document.addEventListener('input', function (e) {
      if (!e.target.classList.contains('date-input') || e.target.type === 'date') return;
      const inp = e.target;
      const raw = inp.value.replace(/\D/g, '').slice(0, 8);
      let fmt = raw;
      if (raw.length > 2) fmt = raw.slice(0, 2) + '/' + raw.slice(2);
      if (raw.length > 4) fmt = raw.slice(0, 2) + '/' + raw.slice(2, 4) + '/' + raw.slice(4);
      if (fmt !== inp.value) inp.value = fmt;
    });
    document.addEventListener('blur', function (e) {
      if (!e.target.classList.contains('date-input')) return;
      const inp = e.target;
      if (!inp.value) { inp.style.borderColor = ''; return; }
      const d = parseAnyDate(inp.value);
      inp.style.borderColor = d ? 'var(--color-success, #10b981)' : 'var(--color-error, #ef4444)';
      updateDerivedAges(inp, d);
    }, true);
    document.addEventListener('input', function (e) {
      if (!e.target.classList.contains('date-input')) return;
      updateDerivedAges(e.target, parseAnyDate(e.target.value));
    });
    document.addEventListener('change', function (e) {
      if (!e.target.classList.contains('date-input')) return;
      updateDerivedAges(e.target, parseAnyDate(e.target.value));
    });
    // Re-apply conditionals on any input change
    document.addEventListener('change', function () { applyAllConditionals(); });
    document.addEventListener('input', function (e) {
      // Children count drives count-driven table rebuild
      const allTables = document.querySelectorAll('[data-dynamic-table-key][data-mode="count_driven"]');
      Array.prototype.forEach.call(allTables, function (wrap) {
        const tableKey = wrap.dataset.dynamicTableKey;
        // Look up which count field drives this; encoded as data-count-field on the input
        const countField = wrap.dataset.countField || (tableKey + '_count');
        if (e.target.name === countField || e.target.id === countField) {
          const c = parseInt(e.target.value) || 0;
          rebuildCountDrivenTable(tableKey, c);
        }
      });
    });
  }

  // FC comment (recurring): "when the date of birth is typed the age fills automatically"
  function updateDerivedAges() {
    // every derived age is recomputed from its source date(s): birth → today, or
    // birth → a second date (age at death) when until_field is set
    Array.prototype.forEach.call(document.querySelectorAll('[data-derived-from]'), function (span) {
      let txt = '—', val = '';
      const from = parseAnyDate(readFieldValue(span.dataset.derivedFrom) || '');
      const untilKey = span.dataset.derivedUntil;
      const until = untilKey ? parseAnyDate(readFieldValue(untilKey) || '') : new Date(todayMaldives() + 'T00:00:00');
      if (from && until) {
        let age = until.getFullYear() - from.getFullYear();
        const m = until.getMonth() - from.getMonth();
        if (m < 0 || (m === 0 && until.getDate() < from.getDate())) age--;
        if (age >= 0 && age < 150) { txt = String(age); val = String(age); }
      }
      span.textContent = txt;
      const hid = document.getElementById(span.id.replace(/_display$/, ''));
      if (hid) hid.value = val;
    });
  }

  function parseAnyDate(str) {
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const p = str.split('-').map(Number);
      const dt = new Date(p[0], p[1] - 1, p[2]);
      return (dt.getFullYear() === p[0] && dt.getMonth() === p[1] - 1 && dt.getDate() === p[2]) ? dt : null;
    }
    return parseDMY(str);
  }
  function ageFromDate(d) {
    const t = new Date(todayMaldives() + 'T00:00:00');
    let age = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    return age;
  }
  function labelOf(key) {
    const el = document.querySelector('[data-key="' + key + '"] .field-label .dv');
    return el ? el.textContent : '';
  }

  function parseDMY(str) {
    if (!str) return null;
    const p = str.split('/');
    if (p.length !== 3) return null;
    const d = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1, y = parseInt(p[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  function todayDMY() {
    const t = new Date();
    return String(t.getDate()).padStart(2,'0') + '/' + String(t.getMonth()+1).padStart(2,'0') + '/' + t.getFullYear();
  }

  function updateCharCount(id, max) {
    const field = document.getElementById(id);
    const counter = document.getElementById('cc_' + id);
    if (!field || !counter) return;
    const len = field.value.length;
    counter.textContent = len + ' / ' + max;
    counter.classList.toggle('over-limit', len >= max);
  }

  // ─── File → data URI ──────────────────────────────────────────────
  // Every file input is shown as a Dhivehi button (the browser's own "Choose File /
  // No file chosen" is hidden). After a pick the file name appears; a restored draft
  // shows that a file is already held.
  function decorateFileInputs(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('input[type="file"]:not([data-decorated])'), function (fi) {
      fi.dataset.decorated = '1';
      fi.classList.add('file-native');
      const pick = document.createElement('span');
      pick.className = 'file-pick';
      pick.innerHTML = '<label class="file-btn" for="' + fi.id + '"><span class="dv">އެޓޭޗް ކުރުމަށް</span></label><span class="file-name" id="' + fi.id + '_name"></span>';   // "attach kurumah", every upload
      fi.insertAdjacentElement('afterend', pick);
      // what is accepted, before a file is chosen. Words
      const acc = (fi.accept || '').toLowerCase();
      const kinds = [];
      if (!acc || acc.indexOf('image') >= 0) kinds.push('ފޮޓޯ');
      if (!acc || acc.indexOf('.pdf') >= 0) kinds.push('PDF');
      if (!acc || acc.indexOf('.doc') >= 0) kinds.push('Word');
      const hint = document.createElement('span');
      hint.className = 'file-hint';
      hint.innerHTML = '<span class="dv">' + esc(kinds.join('، ')) + '</span> · <span class="en">10 MB</span>';
      pick.insertAdjacentElement('afterend', hint);
      const hid = document.getElementById(fi.id + '_data');
      if (hid && hid.value) pick.querySelector('.file-name').innerHTML = '<span class="dv">✓ ފައިލް ހުށަހަޅުއްވާފައި</span>';
    });
  }
  function setFileName(id, name) {
    const n = document.getElementById(id + '_name');
    if (n) n.textContent = name || '';
  }
  const FILE_MAX_BYTES = 10 * 1024 * 1024;       // mirrors the server's FC_MAX_FILE_MB default
  const FILE_TYPES_RE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;
  function persistFile(id) {
    const inp = document.getElementById(id);
    const hidden = document.getElementById(id + '_data');
    if (!inp || !hidden) return;
    if (!inp.files || !inp.files[0]) { hidden.value = ''; setFileName(id, ''); return; }
    const f = inp.files[0];
    setFileName(id, f.name);
    if (f.size > FILE_MAX_BYTES) {
      hidden.value = ''; inp.value = ''; setFileName(id, '');
      showError(id, 'ފައިލް 10 MB އަށްވުރެ ބޮޑުވެގެން ނުވާނެ');
      return;
    }
    if (f.type && !FILE_TYPES_RE.test(f.type)) {
      hidden.value = ''; inp.value = ''; setFileName(id, '');
      showError(id, 'ފޮޓޯ، PDF ނުވަތަ ވޯޑް ފައިލެއް ހުށަހަޅުއްވާ');
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) { hidden.value = e.target.result; };
    reader.onerror = function () { hidden.value = ''; };
    reader.readAsDataURL(inp.files[0]);
  }

  // ─── Jurisdiction check ───────────────────────────────────────────
  function checkJurisdiction() {
    if (!spec.jurisdiction_check) return { ok: true };
    const jc = spec.jurisdiction_check;
    if (jc.type === 'any_island_equals') {
      const ok = jc.fields.some(function (f) {
        return readFieldValue(f) === jc.value;
      });
      return { ok: ok, error_dv: jc.error_dv, alt_courts_dv: jc.alt_courts_dv };
    }
    return { ok: true };
  }

  // ─── Display groups (review + PDF share this) ─────────────────────
  // Map every field key → its Dhivehi label + number so nothing ever falls
  // back to the raw English key unless the spec genuinely has no label.
  function buildFieldMeta() {
    const meta = {};
    resolvedSteps.forEach(function (s) {
      (s.fields || []).forEach(function (f) {
        if (f.key) meta[f.key] = { label_dv: f.label_dv, number: f.number };
        (f.subfields || []).forEach(function (sub) {
          if (sub.key && !meta[sub.key]) meta[sub.key] = { label_dv: sub.label_dv, number: sub.number };
        });
      });
    });
    return meta;
  }

  // Groups of {title_dv, fields:[{key,label_dv,number}]}. Uses the spec's
  // display_groups (bare keys, resolved against field metadata) when present,
  // else one group per resolved step. Titles fall back to '' (never the
  // English step_key) so no raw key surfaces to the citizen.
  function buildDisplayGroups() {
    if (spec.display_groups) {
      const meta = buildFieldMeta();
      return spec.display_groups.map(function (g) {
        return {
          title_dv: g.title_dv || '',
          fields: (g.fields || []).map(function (k) {
            const m = meta[k] || {};
            return { key: k, label_dv: m.label_dv, number: m.number, options: m.options };
          })
        };
      });
    }
    return resolvedSteps.map(function (s) {
      const rows = [];
      (s.fields || []).forEach(function (f) {
        if (!f.key || f.key === 'additional_writing_wanted') return;   // the reveal checkbox is not reviewed
        if (f.type === 'composite_group') {
          // the parts of a group are reviewed under their own numbers
          (f.subfields || []).forEach(function (sub, i) {
            rows.push({ key: sub.key, label_dv: sub.label_dv, number: sub.number || (f.number ? f.number + '.' + (i + 1) : ''), options: sub.options });
          });
          return;
        }
        rows.push({ key: f.key, label_dv: f.label_dv, number: f.number, options: f.options, type: f.type });
      });
      return { title_dv: displayStepTitle(s), fields: rows };
    });
  }
  // "this view is showing the variables" — the review shows the option's
  // wording as the form shows it, never the stored value; any attached file is a tick.
  function optionLabelFor(f, v) {
    const o = (f.options || []).find(function (x) { return String(x.value) === String(v); });
    return o ? o.label_dv : v;
  }
  function reviewValue(f, v) {
    if (Array.isArray(v)) return v.map(function (x) { return optionLabelFor(f, x); }).join('، ');
    if (typeof v === 'string' && (v.indexOf('data:') === 0 || v.indexOf('@file:') === 0)) return '✓';
    return optionLabelFor(f, v);
  }

  // ─── Review summary ──────────────────────────────────────────────
  function buildReview() {
    const result = checkJurisdiction();
    const jErr = document.getElementById('jurisdictionError');
    if (!result.ok) {
      jErr.style.display = 'block';
      jErr.innerHTML = '<h4><span class="dv">މައްސަލަ ހުށަހެޅުމުގެ ސަރަހައްދީ އިޚްތިޞާޞް ނުލިބޭ</span></h4>' +   // the Court's wording
        '<p><span class="dv">' + esc(result.error_dv || '') + '</span></p>';
      document.getElementById('submitBtn').disabled = true;
      document.getElementById('submitBtn').style.opacity = '0.4';
    } else {
      jErr.style.display = 'none';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
    }

    // Build summary by display_groups (if defined) else by step structure.
    // Each row's label is the field's Dhivehi label (+ number), never the key.
    const summary = document.getElementById('reviewSummary');
    summary.innerHTML = '';
    const data = collectAllFormData({ onlyVisible: true });
    const groups = buildDisplayGroups();
    groups.forEach(function (g) {
      let rows = '';
      g.fields.forEach(function (f) {
        const v = data[f.key];
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
        const dv = reviewValue(f, v);
        const labelText = esc(f.number ? f.number + ' ' : '') + esc(displayLabel(f.label_dv) || f.key);
        rows += '<div class="review-field"><span class="review-label">' + labelText +
          '</span><span class="review-value">' + esc(String(dv).substring(0, 80)) + '</span></div>';
      });
      if (!rows) return;                        // no values → skip (also avoids empty key-titled sections)
      const sec = document.createElement('div');
      sec.className = 'review-section';
      sec.innerHTML = (g.title_dv ? '<div class="review-section-title">' + esc(g.title_dv) + '</div>' : '') + rows;
      summary.appendChild(sec);
    });
  }

  // ─── Save / load / submit ────────────────────────────────────────
  function collectAllFormData(opts) {
    const onlyVisible = !!(opts && opts.onlyVisible);
    const data = {};
    const form = document.getElementById('mainForm');
    Array.prototype.forEach.call(form.querySelectorAll('input, textarea, select'), function (el) {
      if (!el.name) return;
      // ruled-out sections never reach the review or the Court (drafts keep them so
      // switching an answer back restores what was typed)
      if (onlyVisible && (el.closest('.conditional-hidden') || el.closest('.step-skipped'))) return;
      if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
      else if (el.type === 'checkbox') {
        if (!data[el.name]) data[el.name] = [];
        if (el.checked) data[el.name].push(el.value);
      }
      else if (el.type === 'date') { data[el.name] = isoToDmy(el.value); }
      else if (el.tagName === 'SELECT' && /_island$/.test(el.name) && el.hidden) {
        const txt = document.getElementById(el.id + '_text'); data[el.name] = txt ? txt.value : '';
      }
      else if (el.dataset && el.dataset.idKind === '1') { data[el.name] = idValue(el); }
      else if (el.type !== 'file') { data[el.name] = el.value; }
    });
    return data;
  }

  // "keep what was filled briefly local so that just refreshing doesn't
  // remove everything" — a copy of the form, with its reference number, lives in
  // this tab's sessionStorage and comes back on a reload; the reference-number
  // draft (store / server) is written on every change, not only per completed
  // step ("make sure the auto generated number is actually saving the content");
  // and an index of unfinished forms on this device feeds the landing page.
  const SNAP_KEY = function () { return 'fc_snapshot_' + (spec && spec.form_code); };
  const INDEX_KEY = 'fc_draft_index';
  function saveSnapshot() {
    if (!spec || !currentRefCode) return;
    try { sessionStorage.setItem(SNAP_KEY(), JSON.stringify({ ref: currentRefCode, step: currentStep, saved_at: Date.now(), data: draftPayload() })); } catch (e) { /* storage full or blocked */ }
  }
  function loadSnapshot() {
    try { const raw = sessionStorage.getItem(SNAP_KEY()); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function clearSnapshot() { try { sessionStorage.removeItem(SNAP_KEY()); } catch (e) { /* ignore */ } }
  function readIndex() { try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); } catch (e) { return {}; } }
  function writeIndex(idx) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (e) { /* ignore */ } }
  function indexDraft() {
    if (!spec || !currentRefCode) return;
    const idx = readIndex();
    idx[currentRefCode] = { form_code: spec.form_code, title_dv: spec.title_dv || spec.form_code, step: currentStep, steps: resolvedSteps.length, saved_at: Date.now(),
      forms: spec.member_forms && spec.member_forms.length > 1 ? spec.member_forms.map(function (m) { return m.form_code; }) : null };
    writeIndex(idx);
  }
  function unindexDraft(ref) { const idx = readIndex(); delete idx[ref || currentRefCode]; writeIndex(idx); }
  let autosaveTimer = null;
  function scheduleAutosave() {
    saveSnapshot();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () { autosaveDraft(); }, 1500);
  }
  function initAutosave() {
    const form = document.getElementById('mainForm');
    if (!form) return;
    form.addEventListener('input', scheduleAutosave);
    form.addEventListener('change', scheduleAutosave);
    window.addEventListener('beforeunload', function () { saveSnapshot(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { saveSnapshot(); autosaveDraft(); } });
  }
  // "Make alun feshumah button also in other pages": start this form again from
  // a blank page — the draft behind the reference number and the local copy go.
  function restartForm() {
    if (!window.confirm('ފޯމު އަލުން ފައްޓަވަންތޯ؟ މިހާތަނަށް ފުރުއްވާފައިވާ މަޢުލޫމާތު ފޮހެވޭނެއެވެ.')) return;
    const ref = currentRefCode;
    clearSnapshot();
    unindexDraft(ref);
    try { Promise.resolve(window.DataStore.deleteDraft(ref)).catch(function () {}); } catch (e) { /* ignore */ }
    const params = new URLSearchParams(window.location.search);
    params.delete('resume');
    window.location.href = window.location.pathname + '?' + params.toString();
  }

  function draftPayload() {
    const formData = collectAllFormData();
    formData.form_code = spec.form_code;
    formData._step = currentStep;          // the page reached comes back with the number (never part of a submission)
    if (wizardJuris) formData.jurisdiction_answers = wizardJuris;
    // A combined flow spans several forms — persist the member list so the draft
    // can be reopened as the same combination (resume via ?forms=A,B,C).
    if (spec.member_forms && spec.member_forms.length > 1) {
      formData.member_forms = spec.member_forms.map(function (m) { return m.form_code; });
    }
    return formData;
  }

  // Quiet save behind the reference number: on issue and after every completed
  // step. Failures are logged, never shown — the explicit save button reports.
  function autosaveDraft() {
    if (!currentRefCode) return;
    indexDraft();
    try {
      Promise.resolve(window.DataStore.saveDraft(currentRefCode, draftPayload()))
        .catch(function (e) { console.warn('autosave failed', e); });
    } catch (e) { console.warn('autosave failed', e); }
  }

  function copyRefCode() {
    if (!currentRefCode || !navigator.clipboard) return;
    navigator.clipboard.writeText(currentRefCode).then(function () {
      const b = document.querySelector('#refNotice .btn-sm .dv');
      if (b) { b.textContent = 'ކޮޕީ ވެއްޖެ'; setTimeout(function () { b.textContent = 'ކޮޕީ ކުރައްވާ'; }, 2000); }
    }).catch(function () {});
  }

  async function saveFormDraft() {
    if (!currentRefCode) currentRefCode = await window.DataStore.newRefCode(spec.ref_prefix || 'FC', spec.form_code);
    const formData = draftPayload();
    try {
      await window.DataStore.saveDraft(currentRefCode, formData);
      const badge = document.getElementById('currentRefCode');
      if (badge) { badge.textContent = currentRefCode; badge.style.display = 'inline-block'; }
      const msg = document.getElementById('savedMsg');
      if (msg) {
        msg.textContent = 'ސޭވް ވެއްޖެ!';
        msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 3000);
      }
    } catch (e) {
      alert('ސޭވް ނުކުރެވުނު: ' + e.message);
    }
  }

  async function resumeFormDraft(codeArg) {
    const inp = document.getElementById('resumeCodeInput');
    const code = (codeArg || (inp ? inp.value : '') || '').trim().toUpperCase();
    if (!code) return;
    try {
      const data = await window.DataStore.loadDraft(code);
      if (!data) { alert('މި ކޯޑަށް ޑްރާފްޓެއް ނުފެނުނު.'); return; }
      if (data.form_code && spec.form_code && data.form_code !== spec.form_code) {
        alert('މި ރެފަރެންސް ނަންބަރު ނިސްބަތްވަނީ އެހެން ފޯމަކަށެވެ.');
        return;
      }
      restoreFormData(data);
      currentRefCode = code;
      const badge = document.getElementById('currentRefCode');
      if (badge) { badge.textContent = code; badge.style.display = 'inline-block'; }
      const rn = document.getElementById('refNoticeCode');
      if (rn) rn.textContent = code;
      if (!document.getElementById('refNotice')) issueRefCode(code);
      // the draft remembers the page reached: open there, with the earlier pages reachable
      if (typeof data._step === 'number' && data._step > 0 && data._step < resolvedSteps.length) { maxStepReached = data._step; showStep(data._step); }
      indexDraft();
    } catch (e) {
      alert('ލޯޑު ނުކުރެވުނު: ' + e.message);
    }
  }

  function restoreAddresses(data) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-address-key]'), function (w) {
      restoreAddressWidget(w.dataset.addressKey, data);
    });
  }

  function restoreFormData(data) {
    const form = document.getElementById('mainForm');
    // Clear radios/checkboxes first
    Array.prototype.forEach.call(form.querySelectorAll('input[type="radio"], input[type="checkbox"]'), function (el) {
      el.checked = false;
    });
    // Rebuild any count-driven dynamic tables first so child fields exist
    Array.prototype.forEach.call(document.querySelectorAll('[data-dynamic-table-key][data-mode="count_driven"]'), function (wrap) {
      const tableKey = wrap.dataset.dynamicTableKey;
      const countField = wrap.dataset.countField || (tableKey + '_count');
      const cnt = parseInt(data[countField]) || 0;
      if (cnt > 0) {
        const cntEl = document.getElementById(countField) || document.querySelector('[name="' + countField + '"]');
        if (cntEl) cntEl.value = cnt;
        rebuildCountDrivenTable(tableKey, cnt);
      }
    });
    // "+" tables start empty; a draft brings its rows back by their highest index
    Array.prototype.forEach.call(document.querySelectorAll('[data-dynamic-table-key][data-mode="plus_button"]'), function (wrap) {
      const tableKey = wrap.dataset.dynamicTableKey;
      const re = new RegExp('^' + tableKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)_');
      let maxIdx = 0;
      Object.keys(data).forEach(function (k) { const m = k.match(re); if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10)); });
      const tbody = document.getElementById(tableKey + '_tbody');
      while (tbody && tbody.children.length < maxIdx) addDynamicRow(tableKey);
    });
    // Apply all field values (address parts come back by name; island lists follow their atoll below)
    Object.keys(data).forEach(function (name) {
      const v = data[name];
      if (Array.isArray(v)) {
        v.forEach(function (val) {
          const cb = form.querySelector('input[name="' + name + '"][value="' + val + '"]');
          if (cb) cb.checked = true;
        });
      } else {
        const radio = form.querySelector('input[name="' + name + '"][type="radio"][value="' + v + '"]');
        if (radio) { radio.checked = true; return; }
        const input = form.querySelector('[name="' + name + '"]');
        if (input && input.type === 'date') input.value = dmyToIso(v);
        else if (input && input.type !== 'file') input.value = v;
      }
    });
    handleSubmittingPartyChange();
    applyAllConditionals();
    restoreAddresses(data);
    syncCcPickers();
    syncAllSearchable();
    syncIdPrefixes();
    decorateFileInputs(document);
    Array.prototype.forEach.call(document.querySelectorAll('input[type="hidden"][id$="_data"]'), function (h) {
      if (h.value) { const n = document.getElementById(h.id.replace(/_data$/, '') + '_name'); if (n && !n.textContent) n.innerHTML = '<span class="dv">✓ ފައިލް ހުށަހަޅުއްވާފައި</span>'; }
    });
  }

  async function submitForm() {
    const bad = firstInvalidStep();
    if (bad >= 0) { showStep(bad); validateStepIndex(bad); showErrorSummary(bad); return; }
    const result = checkJurisdiction();
    if (!result.ok) return;
    if (signaturePad && signaturePad.isEmpty()) {
      const declStepIdx = resolvedSteps.findIndex(function (s) { return s.type === 'declaration'; });
      if (declStepIdx >= 0) showStep(declStepIdx);
      setTimeout(function () { showError('declarant_signature', 'ސޮއި ކުރައްވާ'); }, 100);
      return;
    }
    const selfieData = document.getElementById('selfie_data');
    if (!selfieData || !selfieData.value) {
      const declStepIdx = resolvedSteps.findIndex(function (s) { return s.type === 'declaration'; });
      if (declStepIdx >= 0) showStep(declStepIdx);
      setTimeout(function () { showError('selfie_photo', 'ސެލްފީ ނަންގަވާ'); }, 100);
      return;
    }
    const formData = collectAllFormData({ onlyVisible: true });   // ruled-out sections never reach the Court
    delete formData.additional_writing_wanted;                       // the checkbox that reveals the extra-writing box is a page control, not an answer
    if (wizardJuris) formData.jurisdiction_answers = wizardJuris;   // the four wizard answers travel with the filing
    formData.declarant_signature = signaturePad ? signaturePad.getDataURL() : '';
    formData.selfie_photo = selfieData.value;
    // A combined flow saves one submission per member form, so each form's
    // records/export fill exactly as if it had been submitted on its own.
    const members = (spec.member_forms && spec.member_forms.length)
      ? spec.member_forms
      : [{ form_code: spec.form_code, ref_prefix: spec.ref_prefix || 'FC' }];
    try {
      const refCodes = [];
      for (const m of members) {
        let ref;
        if (members.length === 1) {
          if (!currentRefCode) currentRefCode = await window.DataStore.newRefCode(m.ref_prefix || 'FC', m.form_code);
          ref = currentRefCode;
        } else {
          ref = await window.DataStore.newRefCode(m.ref_prefix || 'FC', m.form_code);
        }
        const payload = Object.assign({}, formData);
        payload.form_code = m.form_code;
        payload.ref_code = ref;
        payload.id_number = formData.applicant_id_number || formData.appellant_id_number || '';
        // dial code + number as one string, the way the SMS gateway will need it
        payload.contact_number = ((formData.sms_phone_cc || '') + ' ' + (formData.sms_phone || formData.applicant_phone || formData.applicant_contact_number || '')).trim();
        payload.contact_email = formData.notify_email || formData.applicant_email || '';
        await window.DataStore.saveSubmission(ref, payload);
        refCodes.push(ref);
      }
      if (!currentRefCode) currentRefCode = refCodes[0];
      const smsData = window.MediaCapture.generateSMSPreview({
        form_code: members.map(function (m) { return m.form_code; }).join(', '),
        id_number: formData.applicant_id_number || '',
        contact_number: formData.sms_phone || formData.applicant_contact_number || '',
        ref_code: refCodes.join(', ')
      });
      window.MediaCapture.showSMSModal(smsData);
      document.getElementById('submitArea').style.display = 'none';
      document.getElementById('reviewSummary').style.display = 'none';
      document.getElementById('jurisdictionError').style.display = 'none';
      document.getElementById('successPanel').style.display = 'block';
      document.getElementById('submittedRefCode').textContent = refCodes.join(' · ');
      clearSnapshot();
      refCodes.forEach(unindexDraft);
      // verbatim with the number and email filled in
      const line = document.getElementById('successNotifyLine');
      if (line) {
        const ph = ((readFieldValue('sms_phone_cc') || '') + ' ' + (readFieldValue('sms_phone') || '')).trim() || '—';
        const em = readFieldValue('notify_email') || '—';
        // "+960 7861232" printed the wrong way round inside the RTL sentence — isolated left-to-right
        line.innerHTML = 'ތިޔަ ފަރާތުން މި ކޯޓަށް މައްސަލަ ފޯމު ހުށަހެޅިކަމުގެ ނޮޓިފިކޭޝަން (<bdi dir="ltr">' + esc(ph) + '</bdi>) އަށް ވަނީ ފޮނުވިފައެވެ. އަދި މައްސަލަ ފޯމު ހުށަހެޅިކަމުގެ ލިޔުން (<bdi dir="ltr">' + esc(em) + '</bdi>) އަށް އީމެއިލް ކުރެވިފައިވާނެއެވެ. ފޯމުގެ އަދާހަމަ ބެލުމަށް ރިފަރެންސް ނަންބަރު ބޭނުންކުރައްވާ!';
      }
      document.getElementById('wizardNav').style.display = 'none';
      document.getElementById('saveResumeBar').style.display = 'none';
    } catch (e) {
      console.error('submit failed', e);
      const why = /quota|storage/i.test(String(e && e.message)) ? 'ހުށަހަޅާ ލިޔުންތައް މި ބްރައުޒަރުގައި ރައްކާކުރެވޭ ވަރަށްވުރެ ބޮޑެވެ.' : 'ކޯޓުގެ ސަރވަރާ ގުޅުމުގައި މައްސަލައެއް ދިމާވިއެވެ.';
      alert('ފޯމު ހުށަހެޅުމުގައި މައްސަލައެއް ދިމާވިއެވެ. ' + why + ' އަލުން މަސައްކަތް ކުރައްވާ.');
    }
  }

  function downloadPDF() {
    // Generic page-per-section PDF (v1, html2canvas + jsPDF)
    if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      alert('PDF ލައިބްރަރީ ތައްޔާރު ނުވޭ. ދެތިން ސިކުންތު ކޮށްފައި ތިލި ދެވަނަ ފަހަރު ކްލިކް ކުރައްވާ.');
      return;
    }
    const data = collectAllFormData({ onlyVisible: true });
    const ref = currentRefCode || '——';
    const sig = signaturePad && !signaturePad.isEmpty() ? signaturePad.getDataURL() : '';
    const groups = buildDisplayGroups();
    let html = '<style>*{margin:0;padding:0;box-sizing:border-box}body{direction:rtl;font-family:"Faruma","MV Faseyha","Noto Sans Thaana",sans-serif;font-size:11px;padding:32px}h1{font-size:16px;text-align:center;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:12px}h2{font-size:12px;background:#ddd;padding:4px 8px;margin-top:12px}.row{display:flex;border-bottom:1px solid #eee;padding:4px 0}.lbl{min-width:140px;color:#555;font-size:10px}.val{flex:1}</style>';
    html += '<h1>' + esc(spec.title_dv || '') + ' &nbsp;·&nbsp; ' + esc(spec.form_code) + ' &nbsp;·&nbsp; Ref: ' + esc(ref) + '</h1>';
    groups.forEach(function (g) {
      let rows = '';
      g.fields.forEach(function (f) {
        const v = data[f.key];
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
        const dv = Array.isArray(v) ? v.join('، ') : (typeof v === 'string' && v.indexOf('data:image') === 0 ? '[image]' : v);
        const labelText = esc(f.number ? f.number + ' ' : '') + esc(f.label_dv || f.key);
        rows += '<div class="row"><div class="lbl">' + labelText + '</div><div class="val">' + esc(String(dv)) + '</div></div>';
      });
      if (!rows) return;
      html += (g.title_dv ? '<h2>' + esc(g.title_dv) + '</h2>' : '') + rows;
    });
    if (sig) html += '<h2>ސޮއި</h2><img src="' + sig + '" style="max-width:180px;max-height:70px;">';

    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-10000px;top:0;width:794px;background:#fff;direction:rtl;';
    container.innerHTML = html;
    document.body.appendChild(container);
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    window.html2canvas(container, { scale: 1.5, backgroundColor: '#fff', logging: false }).then(function (canvas) {
      const img = canvas.toDataURL('image/jpeg', 0.92);
      doc.addImage(img, 'JPEG', 0, 0, 210, Math.min(297, 210 * canvas.height / canvas.width));
      doc.save(spec.form_code + '_' + (currentRefCode || 'draft') + '.pdf');
      document.body.removeChild(container);
    }).catch(function () {
      document.body.removeChild(container);
      alert('PDF ތައްޔާރު ނުކުރެވުނު.');
    });
  }

  // ─── Browser-native print / PDF (spec 05 §2) ─────────────────────
  // Hands the current form's data to print.html via a sessionStorage payload
  // and opens it in a new tab, where real selectable Faruma text is printed /
  // saved as PDF by the browser. The old html2canvas path stays reachable for
  // one release behind ?legacy_pdf=1.
  function printForm() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('legacy_pdf') === '1') { downloadPDF(); return; }
    const data = collectAllFormData({ onlyVisible: true });
    if (signaturePad && !signaturePad.isEmpty()) data.declarant_signature = signaturePad.getDataURL();
    const selfie = document.getElementById('selfie_data');
    if (selfie && selfie.value) data.selfie_photo = selfie.value;
    const forms = (spec.member_forms && spec.member_forms.length)
      ? spec.member_forms.map(function (m) { return m.form_code; })
      : [spec.form_code];
    const payload = { forms: forms, data: data };
    if (currentRefCode) payload.ref = currentRefCode;
    try {
      sessionStorage.setItem('fc_print_payload', JSON.stringify(payload));
    } catch (e) { /* quota/private-mode — print.html can still render blank via URL */ }
    window.open('print.html', '_blank');
  }

  // ─── Public surface ──────────────────────────────────────────────
  return {
    init, idKindChanged, ccToggle, ccFilter, ccPick, restartForm, sameAddress,
    nextStep, prevStep, goToStep,
    handleSubmittingPartyChange,
    saveFormDraft, resumeFormDraft, restoreFormData,
    submitForm, downloadPDF, printForm,
    persistFile, updateCharCount,
    recalcPeriodSum,
    addDynamicRow, removeDynamicRow, rebuildCountDrivenTable,
    _refCode: function () { return currentRefCode || ''; },
    copyRefCode: copyRefCode,
    togglePaymentHelp: function () { const h = document.getElementById('paymentHelp'); if (h) h.hidden = !h.hidden; },
    addressAtollChanged: addressAtollChanged,
    addressChanged: addressChanged
  };
})();

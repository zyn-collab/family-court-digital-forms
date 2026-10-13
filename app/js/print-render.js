/* === PrintRender — spec-driven, browser-printable court document ===
   Input:  a form spec (single or CombineSpecs-merged) + a flat data object
           ({ fieldKey: value }, exactly what engine.collectAllFormData() yields).
   Output: DOM built with the `.print-*` classes in css/print.css, showing real
           selectable Thaana text (bundled Faruma font), RTL, so the BROWSER's
           print engine renders the PDF — no jsPDF, no html2canvas, no <canvas>.

   All Dhivehi comes from the spec (label_dv / title_dv / header.* /
   declaration_lines_dv) or from citizen input — none is hand-typed here.
   Empty values render as a dotted `.print-blank` line, which makes
   `print.html?...&blank=1` a clean fillable blank form for free.
*/

window.PrintRender = (function () {

  // ── tiny DOM helpers (textContent everywhere → user data never parsed as HTML)
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  }
  function isImage(v) { return typeof v === 'string' && v.indexOf('data:image') === 0; }
  function isDataUri(v) { return typeof v === 'string' && v.indexOf('data:') === 0; }
  function isFileMarker(v) { return typeof v === 'string' && (v.indexOf('@file:') === 0 || v.indexOf('@idb:') === 0); }

  // (7.2 printed a photo as its base64 text): every attachment — ID cards,
  // certificates, receipts, in a table or not — goes to numbered annex sheets at the
  // end; the body shows the annex number. The signature stays inline (renderDeclaration).
  let annexes = [];
  function annexRef(label, v) {
    annexes.push({ label: label, value: v });
    const n = annexes.length;
    const ref = el('span', 'print-annex-ref', 'ޖަދުވަލު ' + n + ' ބައްލަވާ');
    return ref;
  }
  function attachmentKind(v) {
    if (isImage(v)) return 'ފޮޓޯ';
    if (/^data:application\/pdf/.test(v)) return 'PDF';
    if (/^data:application\/(msword|vnd\.openxmlformats)/.test(v)) return 'Word';
    return 'ލިޔުން';
  }
  function renderAnnexes(blank) {
    if (blank || !annexes.length) return null;
    const frag = document.createDocumentFragment();
    annexes.forEach(function (a, i) {
      const sec = el('div', 'print-section print-page-break print-annex');
      sec.appendChild(el('div', 'print-section-title', 'ޖަދުވަލު ' + (i + 1) + ' — ' + a.label));
      if (isImage(a.value)) {
        const img = document.createElement('img');
        img.className = 'print-annex-img'; img.src = a.value; img.alt = '';
        sec.appendChild(img);
      } else if (isFileMarker(a.value)) {
        sec.appendChild(el('div', 'print-value', 'ލިޔުން ކޯޓުގެ ރެކޯޑުގައި (' + a.value.replace(/^@\w+:/, '') + ')'));
      } else {
        sec.appendChild(el('div', 'print-value', attachmentKind(a.value) + ' — ލިޔުން ކޯޓުގެ ރެކޯޑުގައި'));   // a PDF or Word file cannot be laid on the sheet;
      }
      frag.appendChild(sec);
    });
    return frag;
  }
  function isEmpty(v) {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  }
  const LTR_TYPES = { tel: 1, email: 1, number: 1, date: 1, derived_age: 1 };

  function todayDMY() {
    const t = new Date();
    return String(t.getDate()).padStart(2, '0') + '/' +
           String(t.getMonth() + 1).padStart(2, '0') + '/' + t.getFullYear();
  }

  // Resolve a radio/select/checkbox stored value → its Dhivehi option label.
  function optionsOf(field) {
    if (field.options) return field.options;
    if (field.options_ref && window.FormLookups) {
      try { return window.FormLookups.get(field.options_ref) || []; } catch (e) { /* */ }
    }
    return [];
  }
  function optionLabel(field, value) {
    const opts = optionsOf(field);
    for (let i = 0; i < opts.length; i++) if (opts[i].value === value) return opts[i].label_dv;
    return value;
  }

  // ── value cell: dotted blank, image, file-note, or plain (LTR for codes/dates)
  function valueCell(field, rawValue, blank) {
    const cell = el('div', 'print-value');
    if (LTR_TYPES[field.type]) cell.classList.add('print-ltr');

    if (blank || isEmpty(rawValue)) {
      cell.appendChild(el('span', 'print-blank'));
      return cell;
    }
    let v = rawValue;
    if (field.type === 'radio' || field.type === 'select') v = optionLabel(field, v);
    else if (field.type === 'checkbox' && Array.isArray(v)) {
      v = v.map(function (x) { return optionLabel(field, x); }).join('، ');
    }
    if (isDataUri(v) || isFileMarker(v)) {       // an attachment: annex sheet, reference here
      cell.appendChild(annexRef(labelText(field).replace(/[:\s]+$/, ''), v));
      return cell;
    }
    cell.textContent = Array.isArray(v) ? v.join('، ') : String(v);
    return cell;
  }

  function labelText(field, data) {
    let base = field.label_dv || field.key || '';
    // a label that follows an earlier answer prints the half that applies
    if (field.label_variants && data) {
      const hit = field.label_variants.find(function (v) { return v.when && data[v.when.field] === v.when.value; });
      if (hit) base = hit.label_dv;
    }
    const t = base.replace(/ފުރިހަމަނަން/g, 'ފުރިހަމަ ނަން').replace(/\s*\(އަތޮޅާއި ރަށާއެކު\)/g, '').replace(/\s+:/g, ':').replace(/([^.])\.\s*$/, '$1');
    return (field.number ? field.number + ' ' : '') + t;
  }

  // A single label|value row (the mockup's two-column .pfr pattern)
  function fieldRow(field, data, blank) {
    const row = el('div', 'print-field');
    row.appendChild(el('div', 'print-label', labelText(field, data)));
    row.appendChild(valueCell(field, data[field.key], blank));
    return row;
  }

  // ── display-only blocks ──────────────────────────────────────────
  function noteBlock(field) {
    const div = el('div', 'print-note');
    const lines = Array.isArray(field.lines_dv) ? field.lines_dv : [field.text_dv || ''];
    lines.forEach(function (l) { if (l) div.appendChild(el('p', null, l)); });
    return div.childNodes.length ? div : null;
  }

  function checklistBlock(field) {
    const sec = el('div', 'print-section print-checklist');
    if (field.title_dv) sec.appendChild(el('div', 'print-section-title', field.title_dv));
    const box = el('div', 'print-box');
    (field.items_dv || []).forEach(function (t) {
      const row = el('div', 'print-check-item');
      row.appendChild(el('span', 'print-check-box', '☐')); // ☐
      row.appendChild(el('span', 'print-check-text', t));
      box.appendChild(row);
    });
    sec.appendChild(box);
    if (field.footnote_dv) sec.appendChild(el('p', 'print-footnote', field.footnote_dv));
    return sec;
  }

  function instructionsBlock(field) {
    const div = el('div', 'print-instructions');
    if (field.title_dv) div.appendChild(el('h4', 'print-instructions-title', field.title_dv));
    (field.sections || []).forEach(function (s) {
      if (s.heading_dv) div.appendChild(el('h5', 'print-instructions-heading', s.heading_dv));
      (s.paragraphs_dv || []).forEach(function (p) { div.appendChild(el('p', null, p)); });
    });
    return div;
  }

  // ── composite (year/month/day etc.) → one labelled row ───────────
  function compositeRow(field, data, blank) {
    const row = el('div', 'print-field');
    row.appendChild(el('div', 'print-label', labelText(field)));
    const cell = el('div', 'print-value');
    const parts = [];
    if (!blank) {
      (field.subfields || []).forEach(function (sub) {
        const v = data[sub.key];
        if (!isEmpty(v)) parts.push((sub.label_dv ? sub.label_dv + ' ' : '') + v);
      });
    }
    if (parts.length) cell.textContent = parts.join(' · ');
    else cell.appendChild(el('span', 'print-blank'));
    row.appendChild(cell);
    return row;
  }

  function addressRow(field, data, blank) {
    const row = el('div', 'print-field');
    row.appendChild(el('div', 'print-label', labelText(field)));
    const cell = el('div', 'print-value');
    const parts = [];
    if (!blank) {
      const island = data[field.key + '_island'];
      const body = data[field.key];
      const apt = data[field.key + '_apartment'];
      const road = data[field.key + '_road'];
      [island, body, apt, road].forEach(function (p) { if (!isEmpty(p)) parts.push(p); });
    }
    if (parts.length) cell.textContent = parts.join('، ');
    else cell.appendChild(el('span', 'print-blank'));
    row.appendChild(cell);
    return row;
  }

  // ── options as a ☐ list (blank forms) ────────────────────────────
  function optionsList(field) {
    const wrap = el('div', 'print-options');
    optionsOf(field).forEach(function (o) {
      const opt = el('span', 'print-option');
      opt.appendChild(el('span', 'print-check-box', '☐'));
      opt.appendChild(el('span', null, o.label_dv));
      wrap.appendChild(opt);
    });
    return wrap;
  }

  function blankChoiceRow(field) {
    const row = el('div', 'print-field print-field-block');
    row.appendChild(el('div', 'print-label', labelText(field)));
    row.appendChild(optionsList(field));
    return row;
  }

  // ── dynamic table (children / witnesses) ─────────────────────────
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function tableBlock(field, data, blank) {
    const cols = field.columns || [];
    const key = field.key;
    let maxIdx = 0;
    const re = new RegExp('^' + escRe(key) + '_(\\d+)_');
    Object.keys(data || {}).forEach(function (k) {
      const m = k.match(re);
      if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
    });
    if (field.count_field && data[field.count_field]) {
      maxIdx = Math.max(maxIdx, parseInt(data[field.count_field], 10) || 0);
    }
    if (blank || maxIdx === 0) maxIdx = Math.max(maxIdx, field.min_rows || 3);

    const sec = el('div', 'print-table-section');
    if (field.label_dv) sec.appendChild(el('div', 'print-table-title', labelText(field)));
    const wrap = el('div', 'print-table-wrap');
    const table = el('table', 'print-table');

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(el('th', 'print-th-num', '#'));
    cols.forEach(function (c) { htr.appendChild(el('th', null, c.label_dv || c.key)); });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 1; i <= maxIdx; i++) {
      const tr = document.createElement('tr');
      const numCell = el('td', 'print-td-num'); numCell.textContent = String(i);
      tr.appendChild(numCell);
      cols.forEach(function (c) {
        const td = document.createElement('td');
        const v = blank ? '' : data[key + '_' + i + '_' + c.key];
        if (isEmpty(v)) { td.innerHTML = '&nbsp;'; }
        else if (isDataUri(v) || isFileMarker(v)) {   // never the base64 text — an annex
          td.appendChild(annexRef((c.label_dv || c.key) + ' (' + i + ')', v));
        }
        else {
          td.textContent = String(v);
          if (LTR_TYPES[c.type]) td.classList.add('print-ltr');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    sec.appendChild(wrap);
    return sec;
  }

  // ── one field → DOM (or null to skip) ────────────────────────────
  function renderField(field, data, blank) {
    // the extra writing prints on its own last page (see render); its checkbox is not printed
    if (field.key === 'additional_writing' || field.key === 'additional_writing_wanted') return null;
    switch (field.type) {
      case 'info_banner':
      case 'notice_block':          return noteBlock(field);
      case 'attachments_checklist': return checklistBlock(field);
      case 'instructions_block':    return null;   // not in the PDF
      case 'court_use_block':       return null;                 // staff-only
      case 'composite_group':       return compositeRow(field, data, blank);
      case 'composite_address':     return addressRow(field, data, blank);
      case 'dynamic_table':         return tableBlock(field, data, blank);
      case 'radio':
      case 'checkbox':
      case 'select':
        if (blank && optionsOf(field).length) return blankChoiceRow(field);
        return fieldRow(field, data, blank);
      default:
        if (!field.key) return null;                            // unknown display-only
        return fieldRow(field, data, blank);
    }
  }

  // ── section (a regular step) ─────────────────────────────────────
  // same display rule as the engine: an unnumbered heading over 1.x fields prints as "1. …"
  function displayStepTitle(step) {
    const t = step.title_dv || '';
    if (!t || /^\s*[0-9]/.test(t)) return t;
    let major = null;
    for (const f of (step.fields || [])) {
      const m = String(f.number || f.label_dv || '').match(/^\s*([0-9]+)\.[0-9]/);
      if (!m) continue;
      if (major === null) major = m[1];
      else if (major !== m[1]) return t;
    }
    return major === null ? t : major + '. ' + t;
  }

  function renderSection(step, data, blank, showFormChip) {
    const sec = el('div', 'print-section');
    // the extra writing is "a separate page at the end of the pdf with the title there"
    if (step.step_key === 'additional_writing') sec.classList.add('print-page-break');
    if (step.title_dv) {
      const title = el('div', 'print-section-title', displayStepTitle(step));
      if (showFormChip && step._form) title.appendChild(el('span', 'print-form-chip', step._form));
      sec.appendChild(title);
    }
    if (step.notice_dv) sec.appendChild(el('p', 'print-note', step.notice_dv));
    const box = el('div', 'print-box');
    let count = 0;
    (step.fields || []).forEach(function (f) {
      const node = renderField(f, data, blank);
      if (node) { box.appendChild(node); count++; }
    });
    if (!count && !step.title_dv) return null;
    if (count) sec.appendChild(box);
    return sec;
  }

  // ── submitting-party step (hisaabiyyat) ──────────────────────────
  function renderSubmittingParty(step, data, blank) {
    const sec = el('div', 'print-section');
    if (step.title_dv) sec.appendChild(el('div', 'print-section-title', step.title_dv));
    const box = el('div', 'print-box');
    const pseudo = { key: 'submitting_party', label_dv: step.question_dv || '', options: step.options || [], type: 'radio' };
    if (blank && (step.options || []).length) box.appendChild(blankChoiceRow(pseudo));
    else box.appendChild(fieldRow(pseudo, data, blank));
    sec.appendChild(box);
    return sec;
  }

  // ── declaration + signature + selfie ─────────────────────────────
  function renderDeclaration(step, spec, data, blank) {
    const sec = el('div', 'print-section print-declaration-section');
    const box = el('div', 'print-declaration');
    const lines = (step.declaration_lines_dv && step.declaration_lines_dv.length)
      ? step.declaration_lines_dv : [];
    if (lines.length) {
      const ul = el('ul', 'print-declaration-list');
      lines.forEach(function (l) { ul.appendChild(el('li', null, l)); });
      box.appendChild(ul);
    }
    sec.appendChild(box);

    const grid = el('div', 'print-sign-grid');

    // left column: name + date (verbatim labels from the spec)
    const idBox = el('div', 'print-box print-sign-id');
    idBox.appendChild(fieldRow(
      { key: 'declarant_name', label_dv: step.name_label_dv || '', type: 'text' }, data, blank));
    idBox.appendChild(fieldRow(
      { key: 'declarant_date', label_dv: step.date_label_dv || '', type: 'date' }, data, blank));
    grid.appendChild(idBox);

    // right column: signature (+ selfie image)
    const sigBox = el('div', 'print-sign-box');
    if (step.sign_label_dv) sigBox.appendChild(el('div', 'print-sign-label', step.sign_label_dv));
    const sig = data.declarant_signature;
    if (!blank && isImage(sig)) {
      const img = document.createElement('img');
      img.className = 'print-sig-img'; img.src = sig; img.alt = '';
      sigBox.appendChild(img);
    } else {
      sigBox.appendChild(el('div', 'print-sig-line'));
    }
    // the selfie is a check for the Court, not part of the printed form
    grid.appendChild(sigBox);
    sec.appendChild(grid);
    return sec;
  }

  // ── header + meta ────────────────────────────────────────────────
  function renderHeader(spec) {
    const head = el('div', 'print-page-header');
    const code = (spec.header && spec.header.code_dv) || spec.form_code || '';
    if (code) head.appendChild(el('div', 'print-code-box', code));
    const center = el('div', 'print-court-center');
    const court = spec.header && spec.header.court_dv;
    const loc = spec.header && spec.header.location_dv;
    if (court) center.appendChild(el('div', 'print-court-name', court));
    if (loc) center.appendChild(el('div', 'print-country-name', loc));
    if (spec.title_dv) center.appendChild(el('div', 'print-form-title', spec.title_dv));
    head.appendChild(center);
    return head;
  }

  function renderMeta(spec, data, opts) {
    // Technical tokens only (codes / ref / date) — inherently LTR, no Dhivehi.
    const meta = el('div', 'print-meta');
    const parts = [];
    const codes = (spec.member_forms && spec.member_forms.length)
      ? spec.member_forms.map(function (m) { return m.form_code; }).join(' + ')
      : (spec.form_code || '');
    if (codes) parts.push(codes);
    const ref = opts.ref || data.ref_code;
    if (ref) parts.push('Ref: ' + ref);
    const date = data.declarant_date ||
      (data.submitted_at ? new Date(data.submitted_at).toLocaleDateString('en-GB') : todayDMY());
    if (date) parts.push(date);
    meta.textContent = parts.join('  ·  ');
    return meta;
  }

  // ── entry point ──────────────────────────────────────────────────
  function render(container, spec, data, opts) {
    opts = opts || {};
    const blank = !!opts.blank;
    data = data || {};
    container.innerHTML = '';

    annexes = [];
    const doc = el('div', 'print-doc');
    doc.setAttribute('dir', 'rtl');
    doc.appendChild(renderHeader(spec));
    doc.appendChild(renderMeta(spec, data, opts));

    const showFormChip = !!(spec.member_forms && spec.member_forms.length > 1);
    let extraField = null;
    (spec.steps || []).forEach(function (step) {
      if (step.audience === 'staff_only' && !opts.staff) return;
      (step.fields || []).forEach(function (f) { if (f.key === 'additional_writing') extraField = f; });
      let node = null;
      if (step.type === 'review' || step.type === 'payment') return;
      else if (step.type === 'declaration') node = renderDeclaration(step, spec, data, blank);
      else if (step.type === 'submitting_party') node = renderSubmittingParty(step, data, blank);
      else node = renderSection(step, data, blank, showFormChip);
      if (node) doc.appendChild(node);
    });
    // ("it will still show at the end in a separate page for the pdf"): the extra
    // writing, when there is any (or on a blank form), on its own last sheet under its title
    if (extraField && (blank || !isEmpty(data[extraField.key]))) {
      const sec = el('div', 'print-section print-page-break');
      sec.appendChild(el('div', 'print-section-title', extraField.label_dv || 'އިތުރަށް ލިޔުން'));
      const box = el('div', 'print-box');
      box.appendChild(fieldRow(Object.assign({}, extraField, { number: '' }), data, blank));
      sec.appendChild(box);
      doc.appendChild(sec);
    }
    const ann = renderAnnexes(blank);
    if (ann) doc.appendChild(ann);

    container.appendChild(doc);
    return doc;
  }

  return { render: render };
})();

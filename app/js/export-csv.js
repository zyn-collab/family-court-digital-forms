/* === Per-form CSV export ===
   One CSV per form, columns in source-document order, headers = verbatim
   Dhivehi labels (row 1) + stable field keys (row 2). Opens directly in Excel
   (UTF-8 BOM). A combined submission is stored as one submission per member
   form, so each form's sheet fills exactly as if the form had been submitted
   on its own.

   Robustness:
   - a UTF-8 BOM is the very first bytes of every file (without it Excel renders
     Dhivehi as mojibake); it is prepended once, before any header/row content;
   - spreadsheet formula-injection guard on every cell;
   - date-type fields are normalized to ISO YYYY-MM-DD;
   - attachment values never leak base64: an "@file:<name>" marker exports the
     stored filename, a "data:" data-URI exports a short "[field]" placeholder;
   - exports honor the caller's filters (form / status / submitted-date range /
     include-archived) so staff export exactly the slice they see; archived
     records are excluded by default.
   This file is shared by admin.html (localStorage) — the added options are
   all optional, so existing callers keep working unchanged.
*/

window.ExportCSV = (function () {

  // A UTF-8 byte-order mark (U+FEFF). Excel needs it as the first bytes of the
  // file to read the CSV as UTF-8 and shape Dhivehi correctly. Written as an
  // explicit escape (not an invisible literal) so it can never be dropped by an
  // editor. When encoded UTF-8 this is the 3 bytes EF BB BF.
  const BOM = '\uFEFF';

  const DISPLAY_ONLY = {
    notice_block: 1, info_banner: 1, instructions_block: 1, court_use_block: 1
  };

  function pad2(n) { return ('0' + n).slice(-2); }

  // Normalize a date-field value to ISO YYYY-MM-DD. HTML date inputs already
  // emit ISO, so that is the common path; DD/MM/YYYY (and . or - separated)
  // legacy values are reordered. Anything unrecognized is returned unchanged —
  // export must never corrupt a value it does not understand.
  function toISODate(s) {
    if (s == null) return '';
    s = String(s).trim();
    if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);          // ISO (maybe w/ time)
    if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/); // D/M/Y or D-M-Y
    if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
    return s;
  }

  // Ordered flat column list from a spec: [{key, header, isDate}]
  function columnsForSpec(spec) {
    const cols = [
      { key: '_ref', header: 'Ref' },
      { key: '_submitted_at', header: 'Submitted at' },
      { key: '_form_code', header: 'Form' }
    ];
    (spec.steps || []).forEach(function (step) {
      if (step.type === 'submitting_party') {
        cols.push({ key: 'submitting_party', header: step.question_dv || 'ހައިސިއްޔަތު' });
        return;
      }
      if (step.type === 'declaration') {
        cols.push({ key: 'declarant_name', header: step.name_label_dv || 'ހުށަހަޅާފަރާތުގެ ނަން:' });
        cols.push({ key: 'declarant_date', header: step.date_label_dv || 'ތާރީޚް:', isDate: true });
        cols.push({ key: 'declarant_signature', header: step.sign_label_dv || 'ސޮއި:' });
        if (step.include_sms_phone !== false) cols.push({ key: 'sms_phone', header: 'SMS' });
        return;
      }
      if (step.type === 'payment' || step.type === 'review') return;
      (step.fields || []).forEach(function (f) {
        if (!f.key || DISPLAY_ONLY[f.type]) return;
        const num = f.number ? f.number + ' ' : '';
        if (f.type === 'attachments_checklist') {
          cols.push({ key: f.key, header: f.title_dv || f.key });
          return;
        }
        if (f.type === 'composite_group') {
          (f.subfields || []).forEach(function (s) {
            cols.push({ key: s.key, header: num + (f.label_dv ? f.label_dv + ' — ' : '') + s.label_dv,
                        isDate: s.type === 'date' });
          });
          return;
        }
        cols.push({ key: f.key, header: num + (f.label_dv || f.key), isDate: f.type === 'date' });
      });
    });
    return cols;
  }

  // option value -> verbatim Dhivehi label
  function optionLabelMaps(spec) {
    const maps = {};
    (spec.steps || []).forEach(function (step) {
      if (step.type === 'submitting_party') {
        const m = {};
        (step.options || []).forEach(function (o) { m[o.value] = o.label_dv; });
        maps['submitting_party'] = m;
      }
      (step.fields || []).forEach(function (f) {
        if (f.options && f.key) {
          const m = {};
          f.options.forEach(function (o) { m[o.value] = o.label_dv; });
          maps[f.key] = m;
        }
      });
    });
    return maps;
  }

  function cellValue(key, data, optMaps) {
    let v = data[key];
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) {
      // dynamic table rows or checkbox list
      return v.map(function (row) {
        if (row && typeof row === 'object') {
          return Object.keys(row).map(function (k) { return k + ': ' + row[k]; }).join('; ');
        }
        return row;
      }).join(' | ');
    }
    if (typeof v === 'string') {
      // Attachment markers must never dump base64 into the sheet.
      // "@file:<name>" (post-backend records) → the stored filename.
      if (v.indexOf('@file:') === 0) return v.slice(6) || ('[' + key + ']');
      // "data:..." data-URI (drafts / demo images) → a short placeholder.
      if (v.indexOf('data:') === 0) return '[' + key + ']';
    }
    if (optMaps[key] && optMaps[key][v] !== undefined) return optMaps[key][v];
    return String(v);
  }

  function csvEscape(s) {
    s = String(s == null ? '' : s);
    // Prevent spreadsheet formula injection: a cell that begins with = + - @
    // (or a tab / carriage return) can execute as a formula when the CSV is
    // opened in Excel or Sheets. Citizen-entered text must never do that, so
    // prefix such values with an apostrophe to force them to plain text.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Does a submission record pass the current filters? Shared by the admin
  // page's list rendering and by export, so the visible list and the exported
  // file always agree. `rec` must carry `ref_code`, `form_code`, `status`,
  // `submitted_at` and (optionally) `archived_at`.
  //   opts.includeArchived : include records with archived_at set (default off)
  //   opts.form            : restrict to one form_code (optional)
  //   opts.statuses        : array of allowed statuses (empty/absent = any)
  //   opts.from / opts.to  : submitted_at range in ms (inclusive; optional)
  function recordMatches(rec, opts) {
    opts = opts || {};
    if (!opts.includeArchived && rec.archived_at) return false;
    if (opts.form && (rec.form_code || 'Fm-C-B20') !== opts.form) return false;
    if (opts.statuses && opts.statuses.length && opts.statuses.indexOf(rec.status) === -1) return false;
    const at = rec.submitted_at || 0;
    if (opts.from != null && at < opts.from) return false;
    if (opts.to != null && at > opts.to) return false;
    return true;
  }

  async function fetchSpec(formCode) {
    return window.SpecLoader.load(formCode);
  }

  function allSubmissions() {
    return JSON.parse(localStorage.getItem('fc_demo_submissions') || '{}');
  }

  // Export one form's submissions to CSV (Excel-ready). `opts` (optional) filters
  // the exported set — status / submitted-date range / include-archived. The form
  // is fixed to `formCode`, so opts.form is ignored here.
  async function exportForm(formCode, opts) {
    opts = opts || {};
    const spec = await fetchSpec(formCode);
    const cols = columnsForSpec(spec);
    const optMaps = optionLabelMaps(spec);
    const subs = allSubmissions();
    const fopts = {
      statuses: opts.statuses, from: opts.from, to: opts.to,
      includeArchived: opts.includeArchived
    };
    const rows = [];
    Object.keys(subs).forEach(function (ref) {
      const rec = subs[ref];
      if ((rec.form_code || 'Fm-C-B20') !== formCode) return;
      rec.ref_code = ref;
      if (!recordMatches(rec, fopts)) return;
      let data = {};
      try { data = typeof rec.data === 'string' ? JSON.parse(rec.data) : (rec.data || {}); } catch (e) {}
      data._ref = ref;
      data._submitted_at = rec.submitted_at || '';
      data._form_code = formCode;
      rows.push(cols.map(function (c) {
        let val = cellValue(c.key, data, optMaps);
        if (c.isDate) val = toISODate(val);
        return csvEscape(val);
      }).join(','));
    });
    const headerDv = cols.map(function (c) { return csvEscape(c.header); }).join(',');
    const headerKeys = cols.map(function (c) { return csvEscape(c.key); }).join(',');
    // BOM prepended exactly once, before the header — never per row.
    const csv = BOM + headerDv + '\r\n' + headerKeys + '\r\n' + rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = formCode + '-submissions.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    return rows.length;
  }

  // Export every form that has at least one submission, honoring `opts`
  // (status / date range / include-archived). The per-form loop applies the
  // same filters, so a form with no matching rows still exports its headers.
  async function exportAll(opts) {
    const subs = allSubmissions();
    const codes = {};
    Object.keys(subs).forEach(function (r) { codes[subs[r].form_code || 'Fm-C-B20'] = 1; });
    for (const code of Object.keys(codes)) {
      try { await exportForm(code, opts); } catch (e) { console.warn(e); }
    }
  }

  return {
    exportForm: exportForm,
    exportAll: exportAll,
    columnsForSpec: columnsForSpec,
    recordMatches: recordMatches,
    toISODate: toISODate
  };
})();

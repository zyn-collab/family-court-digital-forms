/*
 * Sample filings built from a form's own definition (specs/<form>.json): every question
 * that applies is answered, list questions with one of their real options, tables with
 * two rows, every upload with a small image. Used by backend/seed-sample.js (test
 * installations) and by the admin page's demonstration mode. Every applicant name starts
 * with ޓެސްޓް so sample cases are never mistaken for real ones.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SampleFilings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  var NAMES = ['ޓެސްޓް ފާޠިމަތު ޙަސަން', 'ޓެސްޓް އަޙްމަދު ޝަރީފް', 'ޓެސްޓް މަރިޔަމް ނާޒިމާ', 'ޓެސްޓް އިބްރާހީމް ރަޝީދު', 'ޓެސްޓް ޢާއިޝަތު ނަސީމާ', 'ޓެސްޓް މުޙައްމަދު ޢަލީ'];
  var ISLANDS = [['HA', 'ބާރަށް', 'ހއ.'], ['K', 'ތިލަފުށި', 'ކ.'], ['S', 'ހިތަދޫ', 'ސ.'], ['GDh', 'ތިނަދޫ', 'ގދ.']];
  var HOUSES = ['ނޫރާނީވިލާ', 'ގުލްޝަނުގެ', 'ސީބްރީޒް', 'ހަނދުވަރީގެ'];
  var SENTENCE = 'ޓެސްޓް ބަޔާން: މި މައްސަލަ ހުށަހަޅަނީ ޓެސްޓް ކުރުމުގެ ބޭނުމަށް.';
  // status and note given to the n-th sample (null = left as submitted)
  var STATUS_PLAN = [['processing', 'ލިޔެކިޔުން ބަލަމުން'], ['pending', 'ހެކިން ގެނައުމަށް'], ['returned', 'އައިޑީ ކާޑުގެ ފޮޓޯ ސާފެއް ނޫން'], ['approved', 'ބަލައިގަނެވިއްޖެ'], ['completed', 'މައްސަލަ ނިމިއްޖެ'], [null, '']];

  function pad(n) { return String(n).padStart(2, '0'); }
  function opts(f) { return (f.options || []).filter(function (o) { return o && o.value !== '' && o.value != null; }); }
  function holds(rule, d) {
    if (!rule) return true;
    if (rule.all) return rule.all.every(function (r) { return holds(r, d); });
    if (rule.any) return rule.any.some(function (r) { return holds(r, d); });
    var v = d[rule.field];
    var has = function (x) { return Array.isArray(v) ? v.indexOf(x) >= 0 : v === x; };
    switch (rule.op) {
      case 'eq': return has(rule.value);
      case 'ne': return !has(rule.value);
      case 'in': return (rule.values || []).some(has);
      case 'not_in': return !(rule.values || []).some(has);
      case 'gt': return Number(v) > Number(rule.value);
      case 'gte': return Number(v) >= Number(rule.value);
      case 'filled': return v != null && v !== '' && !(Array.isArray(v) && !v.length);
      default: return true;
    }
  }

  /** spec: one form definition; seq: a running number that varies names, numbers and options. */
  function build(spec, seq) {
    var pick = function (arr) { return arr[seq % arr.length]; };
    var idNo = function () { return 'A' + String(100000 + ((seq * 7919) % 899999)); };
    var phone = function () { return '7' + String(100000 + ((seq * 104729) % 899999)); };
    var dob = function () { return pad(1 + seq % 27) + '/' + pad(1 + seq % 12) + '/' + (1975 + seq % 20); };
    var d = { form_code: spec.form_code };
    function address(k) {
      var isl = pick(ISLANDS), house = pick(HOUSES);
      d[k + '_atoll'] = isl[0]; d[k + '_island'] = isl[1]; d[k + '_detail'] = house; d[k + '_country'] = '';
      d[k] = house + '، ' + isl[1] + '، ' + isl[2];
    }
    function value(f, k) {
      var t = f.type, o = opts(f);
      if (/full_name$|_name$/.test(k) && (t === 'text' || !t)) return pick(NAMES);
      if (/id_number$/.test(k)) { d[k + '_kind'] = 'id'; return idNo(); }
      switch (t) {
        case 'text': return /case_number$/.test(k) ? '0' + (100 + seq) + '/FC/2026' : 'ޓެސްޓް';
        case 'textarea': return SENTENCE;
        case 'number': return f.validation && f.validation.max != null && f.validation.max < 2 ? String(f.validation.max) : '2';
        case 'date': return dob();
        case 'tel': d[k + '_cc'] = '+960'; return phone();
        case 'email': return 'test' + seq + '@example.com';
        case 'radio': case 'select': return o.length ? o[seq % o.length].value : '';
        case 'checkbox': return o.length ? [o[0].value] : [];
        case 'file': case 'file_attachment': case 'id_photo': return PNG;
        default: return undefined;
      }
    }
    (spec.steps || []).forEach(function (step) {
      if (step.type === 'review' || step.type === 'payment' || step.audience === 'staff_only') return;
      if (step.visible_when && !holds(step.visible_when, d)) return;
      if (step.type === 'submitting_party') { d.submitting_party = 'party'; return; }
      if (step.type === 'declaration') {
        d.declarant_name = d.applicant_full_name || pick(NAMES);
        d.declarant_date = '13/10/2026'; d.declarant_signature = PNG; d.selfie_photo = PNG;
        return;
      }
      if (step.module === 'instructions') { d.contact_phone = phone(); d.contact_phone_cc = '+960'; }
      (step.fields || []).forEach(function (f) {
        if (!f.key || !holds(f.visible_when, d)) return;
        if (f.type === 'address') { address(f.key); return; }
        if (f.type === 'derived_age') { d[f.key] = String(30 + seq % 15); return; }
        if (f.type === 'composite_group') {
          (f.subfields || []).forEach(function (sf) { var v = value(sf, sf.key); if (v !== undefined) d[sf.key] = v; });
          return;
        }
        if (f.type === 'dynamic_table') {
          var rows = 2;
          if (f.count_field) d[f.count_field] = String(rows);
          for (var i = 1; i <= rows; i++) (f.columns || []).forEach(function (c) {
            var ck = f.key + '_' + i + '_' + c.key;
            if (c.type === 'address') { address(ck); return; }
            var v = value(c, ck); if (v !== undefined) d[ck] = v;
          });
          return;
        }
        if (f.type === 'attachments_checklist') { d[f.key || 'attachments'] = []; return; }
        var v = value(f, f.key);
        if (v !== undefined && !(f.key in d)) d[f.key] = v;
      });
    });
    d.sms_phone = phone(); d.sms_phone_cc = '+960'; d.notify_email = 'test' + seq + '@example.com';
    d.id_number = d.applicant_id_number || d.appellant_id_number || '';
    d.contact_number = d.sms_phone_cc + ' ' + d.sms_phone;
    d.contact_email = d.notify_email;
    return d;
  }

  return { build: build, STATUS_PLAN: STATUS_PLAN, PNG: PNG };
});

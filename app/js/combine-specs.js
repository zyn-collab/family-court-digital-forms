/* === CombineSpecs — merge several form specs into one wizard flow ===
   The "cards" model: a module (applicant, respondent, children…) that appears
   in more than one selected form is rendered ONCE, because its fields carry the
   same canonical keys in every form spec. On submit the engine stores one
   submission per member form (see engine.js), so every form's record/export is
   complete, exactly as if each form had been filled individually.
*/

window.CombineSpecs = (function () {

  // Canonical filing order
  const ORDER = [
    'Fm-C-B02',  // sulha
    'Fm-C-B03C', // divorce application
    'Fm-C-B04',  // divorce confirmation
    'Fm-C-B20',  // divorce suspicion
    'Fm-C-B07',  // custody
    'Fm-C-B05',  // maintenance
    'Fm-C-B15', 'Fm-C-B16', 'Fm-C-B28',          // DV & children orders
    'Fm-C-B01', 'Fm-C-B08', 'Fm-C-B12',           // wali, other family, death
    'Fm-C-B17', 'Fm-C-B19', 'Fm-C-B21',           // enforcement, paternity, guardianship
    'Fm-C-B24', 'Fm-C-B11'                         // appeal, online hearing (procedural)
  ];

  // Modules rendered once per combined flow (fill once, export everywhere)
  const SHARED_MODULES = { applicant: 1, respondent: 1, children: 1, marriage_info: 1 };

  function sortCodes(codes) {
    return codes.slice().sort(function (a, b) {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  async function fetchSpec(code) {
    return window.SpecLoader.load(code);
  }

  function merge(specs) {
    const first = specs[0];
    const merged = {
      form_code: specs.map(function (s) { return s.form_code; }).join('+'),
      ref_prefix: 'CM',
      member_forms: specs.map(function (s) {
        return { form_code: s.form_code, ref_prefix: s.ref_prefix || 'FC', title_dv: s.title_dv };
      }),
      header: first.header || null,
      title_dv: specs.map(function (s) { return s.title_dv; }).join(' + '),
      notice_dv: first.notice_dv || first.banner_dv || null,
      steps: []
    };
    // one payment covers the combined filing: sum of the member forms' fees
    const totalFee = specs.reduce(function (t, s) { return t + (s.fee_mvr || 0); }, 0);
    if (totalFee > 0) merged.fee_mvr = totalFee;

    const seenModules = {};
    let submittingPartyAdded = false;
    const declarationLines = [];
    let declStep = null;

    specs.forEach(function (s) {
      (s.steps || []).forEach(function (step) {
        const st = Object.assign({}, step, { _form: s.form_code });
        if (st.type === 'review') return;                       // single review at end
        if (st.type === 'submitting_party') {
          if (submittingPartyAdded) return;
          submittingPartyAdded = true;
          merged.steps.push(st);
          return;
        }
        if (st.type === 'declaration') {
          // merge: every form's verbatim iqraar line(s), one signature
          (st.declaration_lines_dv || []).forEach(function (l) {
            if (declarationLines.indexOf(l) < 0) declarationLines.push(l);
          });
          if (!declStep) declStep = st;
          return;
        }
        if (st.module && SHARED_MODULES[st.module]) {
          if (seenModules[st.module]) return;                   // fill once
          seenModules[st.module] = s.form_code;
        }
        merged.steps.push(st);
      });
    });

    if (declStep) {
      declStep.declaration_lines_dv = declarationLines;
      merged.steps.push(declStep);
    }
    merged.steps.push({ step_key: 'review', type: 'review' });
    return merged;
  }

  async function load(codes) {
    const ordered = sortCodes(codes);
    const specs = [];
    for (const c of ordered) specs.push(await fetchSpec(c));
    if (specs.length === 1) return specs[0];
    return merge(specs);
  }

  return { load: load, merge: merge, sortCodes: sortCodes, ORDER: ORDER };
})();

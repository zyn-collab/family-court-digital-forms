/* === Shared lookup tables for form engine === */

window.FormLookups = (function () {

  // Islands / city dropdown used in jurisdiction addresses
  const islands = [
    { value: '',                label_dv: '— ރަށް ނުވަތަ ސިޓީ —' },
    { value: 'male',            label_dv: 'މާލެ' },
    { value: 'hulhumale',       label_dv: 'ހުޅުމާލެ' },
    { value: 'villimale',       label_dv: 'ވިލިމާލެ' },
    { value: 'addu',            label_dv: 'އައްޑޫ ސިޓީ' },
    { value: 'fuvahmulah',      label_dv: 'ފުވައްމުލައް ސިޓީ' },
    { value: 'kulhudhuffushi',  label_dv: 'ކުޅުދުއްފުށި ސިޓީ' },
    { value: 'other_island',    label_dv: 'އެހެން ރަށެއް' }
  ];

  // All Maldivian courts
  const courts_list = [
    { value: '',                  label_dv: '— ކޯޓު —' },
    { value: 'family_court',      label_dv: 'ފެމިލީ ކޯޓު' },
    { value: 'civil_court',       label_dv: 'ސިވިލް ކޯޓު' },
    { value: 'criminal_court',    label_dv: 'ކްރިމިނަލް ކޯޓު' },
    { value: 'drug_court',        label_dv: 'ޑްރަގް ކޯޓު' },
    { value: 'juvenile_court',    label_dv: 'ޖުވަނައިލް ކޯޓު' },
    { value: 'high_court',        label_dv: 'ހައި ކޯޓު' },
    { value: 'supreme_court',     label_dv: 'ސުޕްރީމް ކޯޓު' },
    { value: 'hulhumale_mc',      label_dv: 'ހުޅުމާލެ މެޖިސްޓްރޭޓް ކޯޓު' },
    { value: 'other_mc',          label_dv: 'އެހެން މެޖިސްޓްރޭޓް ކޯޓު' }
  ];

  // Relationship dropdown
  const relationship_basic = [
    { value: '',           label_dv: '— ހައިސިއްޔަތު —' },
    { value: 'mother',     label_dv: 'މަންމަ' },
    { value: 'father',     label_dv: 'ބައްޕަ' },
    { value: 'family',     label_dv: 'ތިމާގެ މީހެއް' },
    { value: 'other',      label_dv: 'އެހެން މީހެއް' }
  ];

  // Sex dropdown
  const sex = [
    { value: '',          label_dv: '—' },
    { value: 'male',      label_dv: 'ފިރިހެން' },
    { value: 'female',    label_dv: 'އަންހެން' }
  ];

  // Yes / No
  const yes_no = [
    { value: 'yes', label_dv: 'އާއެކެވެ' },
    { value: 'no',  label_dv: 'ނޫނެކެވެ' }
  ];

  return {
    islands,
    courts_list,
    relationship_basic,
    sex,
    yes_no,

    // Helper: get options by name
    get: function (name) {
      const map = { islands, courts_list, relationship_basic, sex, yes_no };
      return map[name] || [];
    }
  };
})();

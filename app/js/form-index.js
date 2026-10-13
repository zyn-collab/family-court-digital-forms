/* === Form index — single source of truth for the launcher & wizard ===
   Categories follow the Family Court's own categorization workbooks.
   To add a new form later: 1) build its spec via the tools pipeline,
   2) add its code to a category's `forms`, and 3) add its PDF path below.
   Titles come from each spec (title_dv / title_en) via SpecLoader, so they
   are never duplicated here. Colors stay within the Court's wine/rose theme.
*/
window.FC_FORMS = {
  categories: [
    { key: 'vari',     color: '#6d1a41',
      title_dv: 'ޞުލްޙަ އަދި ވަރިއާ ގުޅުންހުރި',
      forms: ['Fm-C-B02', 'Fm-C-B03C', 'Fm-C-B04', 'Fm-C-B20'] },
    { key: 'children', color: '#a52056',
      title_dv: 'ދަރިންނާ ގުޅުންހުރި',
      forms: ['Fm-C-B07', 'Fm-C-B05', 'Fm-C-B19', 'Fm-C-B21'] },
    { key: 'dv',       color: '#9c2f6e',
      title_dv: 'ގެވެށި އަނިޔާ އަދި ކުޑަކުދިންގެ މައްސަލަ',
      forms: ['Fm-C-B15', 'Fm-C-B16', 'Fm-C-B28'] },
    { key: 'other',    color: '#5c2b4d',
      title_dv: 'އެހެނިހެން އަދި އިޖުރާއީ ފޯމުތައް',
      forms: ['Fm-C-B01', 'Fm-C-B08', 'Fm-C-B12', 'Fm-C-B17', 'Fm-C-B24', 'Fm-C-B11'] }
  ],
  // PDF fallbacks, relative to app/ (kept inside the handover folder)
  pdf: {
    'Fm-C-B01':  '../source/pdfs/cases/Fm-C-B01_Valee-massala-form-v1-2024.pdf',
    'Fm-C-B02':  '../source/pdfs/cases/Fm-C-B02_Sulha-v1-2024-.pdf',
    'Fm-C-B03C': '../source/pdfs/cases/Fm-C-B03C_Varikurumah-form-pdf.pdf',
    'Fm-C-B04':  '../source/pdfs/cases/Fm-C-B04_Vari-saabith-form-v1.2024-2 (1).pdf',
    'Fm-C-B05':  '../source/pdfs/cases/Fm-C-B05_Kharadhu-form-v1-2024-2.pdf',
    'Fm-C-B07':  '../source/pdfs/cases/Fm-C-B07_Halaanath-form-v1-2024.pdf',
    'Fm-C-B08':  '../source/pdfs/cases/Fm-C-B08_Aily-Ehenihen-form-v1-2024 (1).pdf',
    'Fm-C-B12':  '../source/pdfs/cases/Fm-C-B12_Maru-Saabithu-form-1-1.pdf',
    'Fm-C-B15':  '../source/pdfs/cases/Fm-C-B15_Geveshi-Aniyaa-Amuru-form-v1-2024 (1).pdf',
    'Fm-C-B16':  '../source/pdfs/cases/Fm-C-B16_Geveshi-Aniyaa-Amuru-Bathil_form-v1-2024.pdf',
    'Fm-C-B17':  '../source/pdfs/cases/Fm-C-B17_Hukum-thanfeez-form-v1-2024.pdf',
    'Fm-C-B19':  '../source/pdfs/cases/Fm-C-B19_Nasabu_form-v1-2024.pdf',
    'Fm-C-B20':  '../source/pdfs/cases/Fm-C-B20_Vari-Shakku-Form-v1-2024-3.pdf',
    'Fm-C-B21':  '../source/pdfs/cases/Fm-C-B21_Baladhu_form-v1-2024-.pdf',
    'Fm-C-B28':  '../source/pdfs/cases/Fm-C-B28-Child-Rights-Protection-Act-aa-gulhey-Amuru.pdf',
    'Fm-C-B24':  '../source/pdfs/cases-other/FmC_B24-Isthiunaaf-form.pdf',
    'Fm-C-B11':  '../source/pdfs/cases-other/online-koh-shariah-hingumah-edhi-hushalahaa-form-v2.pdf'
  },
  allCodes: function () {
    return this.categories.reduce(function (a, c) { return a.concat(c.forms); }, []);
  },
  // Every distinct MULTI-form combination the wizard can produce (its single-form
  // outputs are already covered by the per-form list above). Used by the demo
  // seeder so there is a pre-filled draft for each wizard path. Codes are what a
  // presenter types/loads. Order here is the canonical filing order.
  // cut the divorce → "children under 18?" step
  // ("otherwise it's filling double parallel forms"), so divorce forms no longer
  // combine with custody/maintenance; the only wizard-reachable combination left
  // is custody + maintenance. (CM-DEMO1…6 retired with that step.)
  combos: [
    { code: 'CM-DEMO7', forms: ['Fm-C-B07', 'Fm-C-B05'],             label: 'ޙަޟާނަތު + ޚަރަދު' }
  ],
  // find the seed combo matching a set of form codes (order-insensitive)
  comboFor: function (codes) {
    var want = codes.slice().sort().join(',');
    return this.combos.find(function (c) { return c.forms.slice().sort().join(',') === want; }) || null;
  }
};

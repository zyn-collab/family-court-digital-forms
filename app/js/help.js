/* === Help widget ===
   Self-contained floating "help" button + popup, injected on load. Add it to a
   page with a single <script src="js/help.js"></script> — it builds its own
   button, modal and styles, so it can't disturb existing layout.

   Confirm these contacts with the Family Court before launch (a dedicated
   tech/bug email + help line can replace the defaults). */
(function () {
  var CONTACT = {
    phone: '3325502',
    email: 'registration@familycourt.gov.mv',
    address: 'ފެމިލީ ކޯޓު، އޯކިޑް މަގު، މާލެ',
    formsPage: 'index.html'
  };

  var css =
    '.fc-help-fab{position:fixed;inset-inline-start:20px;bottom:20px;z-index:9998;display:flex;' +
    'align-items:center;gap:10px;background:var(--color-primary,#6d1a41);color:#fff;border:3px solid #fff;' +
    'border-radius:999px;padding:13px 22px;font-family:inherit;font-size:1.08rem;font-weight:800;' +
    'cursor:pointer;box-shadow:0 8px 26px rgba(109,26,65,0.5);animation:fcHelpPulse 2.4s ease-in-out infinite;}' +
    '.fc-help-fab:hover{filter:brightness(1.08);transform:translateY(-1px);}' +
    '.fc-help-fab .i{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;' +
    'border-radius:50%;background:#fff;color:var(--color-primary,#6d1a41);font-size:1.05rem;font-weight:900;line-height:1;}' +
    '@keyframes fcHelpPulse{0%,100%{box-shadow:0 8px 26px rgba(109,26,65,0.5),0 0 0 0 rgba(109,26,65,0.45);}' +
    '50%{box-shadow:0 8px 26px rgba(109,26,65,0.5),0 0 0 14px rgba(109,26,65,0);}}' +
    '@media(prefers-reduced-motion:reduce){.fc-help-fab{animation:none;}}' +
    '.fc-help-ov{position:fixed;inset:0;z-index:9999;background:rgba(30,10,20,0.55);' +
    'display:none;align-items:center;justify-content:center;padding:16px;}' +
    '.fc-help-ov.open{display:flex;}' +
    '.fc-help-box{background:#fff;border-radius:16px;width:100%;max-width:460px;max-height:88vh;' +
    'overflow-y:auto;padding:22px 22px 18px;box-shadow:0 12px 40px rgba(0,0,0,0.3);}' +
    '.fc-help-box h3{margin:0 0 4px;font-size:1.2rem;color:var(--color-primary-dark,#45122c);}' +
    '.fc-help-box .sub{margin:0 0 16px;font-size:0.88rem;color:#8a7d84;line-height:1.7;}' +
    '.fc-help-opt{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;margin:10px 0;' +
    'border:1px solid var(--color-border,#e6dee2);border-radius:12px;text-decoration:none;color:inherit;' +
    'background:#fbf8fa;transition:border-color .12s,background .12s;}' +
    '.fc-help-opt:hover{border-color:var(--color-primary,#6d1a41);background:#f6ecf1;}' +
    '.fc-help-opt .ico{flex:none;display:flex;align-items:center;color:var(--color-primary,#6d1a41);}' +
    '.fc-help-opt .t{font-weight:700;line-height:1.8;}' +
    '.fc-help-opt .d{font-size:0.84rem;color:#6a5560;line-height:1.7;margin-top:2px;}' +
    '.fc-help-opt .d.en{direction:ltr;font-family:var(--font-en,sans-serif);}' +
    '.fc-help-close{margin-top:10px;width:100%;background:none;border:none;color:#8a7d84;' +
    'font-family:inherit;font-size:0.95rem;cursor:pointer;padding:8px;}' +
    '.fc-help-close:hover{color:var(--color-primary,#6d1a41);}' +
    '@media(max-width:600px){.fc-help-fab{inset-inline-start:14px;bottom:14px;padding:12px 18px;font-size:1rem;}}';

  function opt(icon, title, desc, extra, href, blank) {
    var a = document.createElement(href ? 'a' : 'div');
    a.className = 'fc-help-opt';
    if (href) { a.href = href; if (blank) { a.target = '_blank'; a.rel = 'noopener'; } }
    a.innerHTML = '<span class="ico" aria-hidden="true">' + icon + '</span>' +
      '<span><span class="t dv">' + title + '</span>' +
      '<span class="d dv">' + desc + '</span>' +
      (extra ? '<span class="d en">' + extra + '</span>' : '') + '</span>';
    return a;
  }

  function build() {
    if (document.querySelector('.fc-help-fab')) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

    var fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'fc-help-fab no-print';
    fab.innerHTML = '<span class="i" aria-hidden="true">؟</span><span class="dv">އެހީ ބޭނުންތޯ</span>';

    var ov = document.createElement('div'); ov.className = 'fc-help-ov no-print';
    var box = document.createElement('div'); box.className = 'fc-help-box';
    box.innerHTML = '<h3><span class="dv">އެހީ ބޭނުންފުޅުވޭތޯ؟</span></h3>' +
      '<p class="sub"><span class="dv">ފޯމު ފުރުމުގައި ދަތިކަމެއް ދިމާވެއްޖެނަމަ، ތިރީގައިވާ ގޮތްތަކުން އެހީ ލިބިވަޑައިގަންނަވާނެއެވެ.</span></p>';

    box.appendChild(opt(FcIcons.svg('doc', 22),
      'ފޯމު PDF ގޮތުގައި އަތުން ފުރުއްވުމަށް',
      'ފޯމުތަކުގެ ލިސްޓުން ކޮންމެ ފޯމެއްގެ PDF ޑައުންލޯޑްކޮށް، ޕްރިންޓްކޮށް އަތުން ފުރުއްވޭނެއެވެ.',
      '', CONTACT.formsPage, false));

    box.appendChild(opt(FcIcons.svg('bug', 22),
      'މައްސަލައެއް ނުވަތަ އޮޅުމެއް ރިޕޯޓް ކުރެއްވުމަށް',
      'ޓެކްނިކަލް މައްސަލައެއް ދިމާވެއްޖެނަމަ، އީމެއިލް ކުރައްވާ:',
      CONTACT.email, 'mailto:' + CONTACT.email + '?subject=' + encodeURIComponent('Digital forms — issue report'), false));

    box.appendChild(opt(FcIcons.svg('question', 22),
      'ސުވާލެއްގެ ޖަވާބު ދޭން ނޭނގޭނަމަ',
      'ފޯމުގައި ސުވާލެއް އޮޅުންފިލުވަން ބޭނުންފުޅުވާނަމަ، ފެމިލީ ކޯޓަށް ގުޅުއްވާ:',
      CONTACT.phone, 'tel:' + CONTACT.phone, false));

    box.appendChild(opt(FcIcons.svg('building', 22),
      'ފޯމު ފުރުމަށް އެހީ ބޭނުންފުޅުވާނަމަ',
      'ބަހުގެ ދަތިކަން ނުވަތަ ޤާނޫނީ އޮޅުމެއް ހުރިނަމަ، ފެމިލީ ކޯޓުގެ އޮފީހަށް ވަޑައިގެން އެހީއަށް އެދިވަޑައިގަންނަވާ: ' + CONTACT.address,
      '', '', false));

    var close = document.createElement('button');
    close.type = 'button'; close.className = 'fc-help-close';
    close.innerHTML = '<span class="dv">ބަންދުކުރައްވާ</span>';
    box.appendChild(close);
    ov.appendChild(box);

    function openM() { ov.classList.add('open'); }
    function closeM() { ov.classList.remove('open'); }
    fab.addEventListener('click', openM);
    close.addEventListener('click', closeM);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeM(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeM(); });

    document.body.appendChild(fab);
    document.body.appendChild(ov);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();

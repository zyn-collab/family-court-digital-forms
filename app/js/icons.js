/* ===========================================================================
 * icons.js — one small set of line icons (inline SVG, currentColor) used in
 * place of emoji across the pages, so the look is the same on every device
 * and matches the type rather than the phone's emoji font.
 * =========================================================================== */
window.FcIcons = (function () {
  const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M12 3.5 21 19H3L12 3.5z"/><path d="M12 10v4M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="M11 11 20 2M16 6l3 3M13 9l3 3"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="m13 7 4 4"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h4M18 14h.01"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
    bug: '<path d="M8 8a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z"/><path d="M8 11H4M20 11h-4M8 15l-3 2M16 15l3 2M8 7 5 5M16 7l3-2M12 18v3"/>',
    building: '<path d="M3 21h18M5 21V8l7-4 7 4v13"/><path d="M9 21v-5h6v5M9 12h.01M12 12h.01M15 12h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'
  };
  function svg(name, size) {
    const body = icons[name] || icons.info;
    return '<svg class="fc-icon fc-icon-' + name + '" viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" ' + P + ' aria-hidden="true">' + body + '</svg>';
  }
  return { svg: svg };
})();

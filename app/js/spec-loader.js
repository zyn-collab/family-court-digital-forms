/* === SpecLoader — load a form spec with file:// fallback ===
   Tries fetch (works on any web server); if that fails (opening the app
   straight from disk blocks fetch of local JSON), falls back to the
   pre-bundled window.FC_SPECS from specs/specs-bundle.js. */

window.SpecLoader = (function () {
  async function load(code) {
    try {
      const res = await fetch('specs/' + code + '.json');
      if (res.ok) return await res.json();
    } catch (e) { /* file:// or offline — fall through to bundle */ }
    if (window.FC_SPECS && window.FC_SPECS[code]) return window.FC_SPECS[code];
    throw new Error('Spec not available: ' + code);
  }
  function list() {
    return window.FC_FORM_LIST || [];
  }
  return { load: load, list: list };
})();

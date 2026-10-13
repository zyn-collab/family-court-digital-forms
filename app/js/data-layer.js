/*
 * Picks the data layer from js/site-config.js: with FC_API_BASE set the pages talk
 * to the backend (js/api-config.js); without it they use the browser store
 * (js/browser-store.js). Both expose the same window.DataStore interface, so
 * nothing else on the page changes. Loaded synchronously, in place, so the adapter
 * exists before the page's own scripts run.
 */
(function () {
  var useApi = typeof window.FC_API_BASE === 'string' && window.FC_API_BASE.trim() !== '';
  var src = useApi ? 'js/api-config.js' : 'js/browser-store.js';
  document.write('<script src="' + src + '"><\/script>');
})();

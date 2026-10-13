/*
 * Site configuration — the one file the Court's IT team edits.
 *
 * FC_API_BASE: the address of the backend service (backend/server.js), without a
 * trailing slash, for example 'https://forms.familycourt.gov.mv' when the API is
 * proxied under /api on the same host, or 'https://api.familycourt.gov.mv'.
 *
 * Leave it empty ('') and every page keeps its data in the visitor's own browser
 * (the demonstration mode: nothing reaches a server; the admin page cannot log in).
 */
window.FC_API_BASE = '';

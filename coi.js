/*
 * Cross-origin isolation helper.
 * GitHub Pages can't set COOP/COEP headers, but multi-threaded wasm needs them
 * (SharedArrayBuffer). This file is loaded twice: as a normal script in the page,
 * where it registers itself as a service worker, and as that service worker, where
 * it adds the headers to every response. Without it the app still works, single-threaded.
 */
if (typeof window === 'undefined') {
  // ---- service worker context ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    // Only touch our own files; cross-origin requests (CDN, Hugging Face, APIs) pass through.
    if (new URL(req.url).origin !== self.location.origin) return;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }).catch(() => fetch(req))
    );
  });
} else {
  // ---- page context ----
  (() => {
    if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    const reloaded = sessionStorage.getItem('coiReloaded');
    navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
      if (reloaded) return; // tried once already; browser doesn't support it, stay single-threaded
      const reload = () => { sessionStorage.setItem('coiReloaded', '1'); location.reload(); };
      if (reg.active && !navigator.serviceWorker.controller) reload();
      else if (!reg.active) reg.addEventListener('updatefound', () => {
        reg.installing.addEventListener('statechange', (ev) => { if (ev.target.state === 'activated') reload(); });
      });
    }).catch(() => {});
  })();
}

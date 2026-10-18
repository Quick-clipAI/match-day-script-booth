// Admin app service worker. It caches NOTHING: every open fetches the newest admin.html from the website, so the
// installed admin app is always the current version and "updating" it means just deploying the website.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only (browser default) */ });

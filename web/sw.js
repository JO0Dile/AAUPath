// Service worker for the hosted app.
//
// The app is self-contained: shell, styles, modules, icons, and the whole
// study-plan catalogue (plans.json) are all precached, so it works with no
// network at all from the first visit onward. The only thing that ever goes
// online is the plan collector, when a student chooses to share a plan.
// BUMP THIS whenever a precached file changes. It is the only thing that
// makes a browser reinstall the shell.
//
// The trap is that nothing warns you. A browser checks for an update by
// comparing *this file* byte for byte; if sw.js is unchanged it does not
// reinstall, addAll never re-runs, and every already-installed browser keeps
// serving the old cache entries. Shipping a fixed js/48-admin.js therefore
// changed nothing for anyone who had already opened the app — the fix was on
// the CDN, correct and verified, and simply not what the browser ran. The
// fetch handler below does refresh entries one at a time, so it heals after an
// extra reload, but "reload twice" is not a fix anyone can be told to rely on.
var CACHE = 'studyplan-shell-v188';
var CORE = [
  './index.html', './manifest.json', './plans.json', './contacts.json', './css/app.css',
  './js/00-diagnostics.js', './js/01-catalogue.js',
  './bundles/core.bundle.js', './bundles/shell.bundle.js', './bundles/edit.bundle.js',
  './bundles/plan.bundle.js', './bundles/server.bundle.js', './bundles/admin.bundle.js',
  './assets/icons/favicon.png', './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-any-192.png', './assets/icons/icon-any-384.png',
  './assets/icons/icon-any-512.png',
  './assets/icons/icon-maskable-192.png', './assets/icons/icon-maskable-384.png',
  './assets/icons/icon-maskable-512.png',
  './assets/fonts/cairo-arabic.woff2', './assets/fonts/cairo-latin.woff2',
  // The backdrop on the landing. Precached like the fonts because it is on
  // the very first screen: a student who installs the app and opens it on
  // the bus should not meet a blank one.
  // (No apostrophes in here — check-precache reads this array with a regex
  // over quoted strings, and one inside a comment opens a string it then
  // closes at the next real quote.)
  './assets/img/landing-campus.webp',
  './assets/img/aaup-emblem.png'
];

// Precached at install rather than opportunistically on first fetch. The
// worker does not control the very first page load, so anything cached only by
// the fetch handler is missed on a first visit — which meant the app looked
// offline-capable but wasn't until you had loaded it twice.
//
// addAll is atomic: one missing file fails the whole install. That is the
// behaviour we want (a half-cached shell is worse than none), but it does mean
// adding a module under js/ requires adding it here too. Forgetting is silent
// — the app looks fine until it is opened without a connection — so the Fix
// panel now compares this list against the files index.html actually loads and
// reports the difference (see the precache-drift check in
// js/44-fix-analyzers.js), and tools/check-precache.py does the same in CI.
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// The shell is cache-first: index.html, the modules, the CSS and the icons
// barely change, and serving them from disk is what makes the app open
// instantly and work with no signal.
//
// The CATALOGUE is not shell, it is data, and treating it the same way was
// wrong. plans.json is precached at install, so `cached || fetched` handed
// back the copy from install time on every single load and only refreshed the
// cache afterwards — meaning a published change never appeared on the visit
// that fetched it, only on some later one. From the outside that looked like
// edits "only going live when a pull request is merged", because a merge is
// what eventually produced enough reloads.
//
// So anything whose whole purpose is to be current is network-first, falling
// back to the cache when there is no connection. Offline still works: the
// fallback is the same precached copy as before.
function isLiveData(url) {
  var p = url.pathname;
  return p.indexOf('plans.json') !== -1 ||
         p.indexOf('contacts.json') !== -1 ||    // grows as more names come in
         p.indexOf('/assets/uploads/') !== -1;   // admin-uploaded logos and icons
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.pathname.indexOf('/api/') !== -1) return;

  if (isLiveData(url)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () {
        // Offline, or the network failed. The precached copy is exactly what
        // this used to serve first, so nothing is lost by falling back to it.
        return caches.match(e.request);
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var fetched = fetch(e.request, { cache: 'no-store' }).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || fetched;
    })
  );
});

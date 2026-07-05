const CACHE_NAME = 'wotn-weather-v1';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', (evt) => {
    evt.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (evt) => {
    evt.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    );
});

self.addEventListener('fetch', (evt) => {
    evt.respondWith(
        caches.match(evt.request).then(cacheRes => {
            if(cacheRes) return cacheRes;
            return fetch(evt.request).then(networkRes => {
                // Clone response
                const clone = networkRes.clone();
                // Cache only successful HTML/API responses if you want to be fancy
                caches.open(CACHE_NAME).then(c => c.put(evt.request, clone));
                return networkRes;
            }).catch(() => {
                // Offline fallback logic could go here
                // Return cached shell if possible
                if(evt.request.mode === 'navigate') return caches.match('/index.html');
            });
        })
    );
});

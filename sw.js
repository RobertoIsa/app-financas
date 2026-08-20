const CACHE_NAME = 'financas-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './logic.js',
  './ui/lancamento.js',
  './ui/mes.js',
  './ui/receber.js',
  './ui/cartoes.js',
  './ui/recorrencias.js',
  './ui/faturas.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
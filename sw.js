const CACHE_NAME = 'financas-v7';
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
  './ui/dashboard.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // ativa a nova versão do SW assim que instalada, sem esperar
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Apaga caches de versões antigas (ex.: financas-v2) e assume o controle das abas já
// abertas — sem isso, um bump em CACHE_NAME sozinho não garante que o navegador pare de
// servir bundles JS desatualizados de uma versão anterior (foi a causa do bug de tela
// "Mês" quebrada: getElementById batendo em ids/linhas de uma versão velha de mes.js
// ainda em cache, mesmo com o código-fonte atual já correto).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((nome) => nome !== CACHE_NAME).map((nome) => caches.delete(nome)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
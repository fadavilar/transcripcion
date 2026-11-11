// Service worker mínimo: solo cachea el "shell" de la app (HTML/JS/íconos propios)
// para que el navegador la considere instalable y arranque más rápido en visitas
// repetidas. Las librerías de terceros (pdf.js, Tesseract, transformers.js) y los
// modelos de Whisper NO se cachean aquí: cada una ya gestiona su propia caché
// (p. ej. transformers.js guarda los modelos en el Cache Storage del navegador por
// su cuenta), y no tiene sentido duplicar archivos de cientos de MB en esta caché.
const CACHE = 'transcriptor-shell-v12';
const SHELL = [
  './',
  'index.html',
  'src/app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
  'favicon.ico',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // deja pasar CDN/modelos tal cual
  // Primero la red, para que cada versión publicada llegue de inmediato; la caché es el respaldo
  // sin conexión y se refresca con cada respuesta buena.
  // cache: 'no-cache' revalida con el servidor: sin eso, la caché HTTP de GitHub Pages
  // (hasta 10 minutos) seguiría entregando la versión anterior.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return respuesta;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((cached) => cached || Response.error()))
  );
});

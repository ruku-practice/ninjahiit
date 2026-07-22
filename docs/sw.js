// NinjaHIIT Service Worker — キャッシュファーストでオフライン動作
const CACHE = "ninjahiit-v696";
// Viteビルド後はJS/CSSがハッシュ付きファイル名になるため、precacheは骨格のみ。
// バンドルやメディアは下のfetchハンドラ（キャッシュ優先＋バックグラウンド更新）が拾う
const CORE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 同一オリジンはキャッシュ優先＋バックグラウンド更新。キャラ画像も初回取得後にキャッシュされる
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          // 206(動画のRange応答)をキャッシュすると再生が壊れるため200のみ保存
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});

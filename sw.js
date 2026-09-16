/* Offline provoz. Verzi zvedni při každé změně appky, ať se stáhne nová. */
const CACHE = "kapybari-diplomka-v9";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // fonty z Googlu řeší prohlížeč sám

  // odměny a fotky: nejdřív síť, ať se nové věci od Kryštofa objeví hned
  const fresh = url.pathname.endsWith("odmeny.json") || url.pathname.includes("/fotky/");
  if (fresh) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return r;
    }))
  );
});

/* ------------------------------------------------------------------ *
 * Upozornění. Server posílá prázdný push (bez obsahu); text si sem
 * dotáhneme z /api/nudge, aby odpadlo šifrování obsahu.
 * ------------------------------------------------------------------ */
function readCfg() {
  return new Promise(res => {
    try {
      const req = indexedDB.open("capy-sync", 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("cfg"); };
      req.onerror = () => res(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction("cfg", "readonly");
          const g = tx.objectStore("cfg").get("cfg");
          g.onsuccess = () => res(g.result || null);
          g.onerror = () => res(null);
        } catch (e) { res(null); }
      };
    } catch (e) { res(null); }
  });
}

self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let title = "Kapybaří diplomka";
    let body = "Mrkni na dnešek — stačí jeden úkol.";
    try {
      if (e.data) {
        const d = e.data.json();
        title = d.title || title; body = d.body || body;
      } else {
        const cfg = await readCfg();
        if (cfg && cfg.base && cfg.room && cfg.token) {
          const r = await fetch(`${cfg.base}/api/nudge?room=${encodeURIComponent(cfg.room)}`, {
            headers: { authorization: "Bearer " + cfg.token },
          });
          if (r.ok) { const d = await r.json(); title = d.title || title; body = d.body || body; }
        }
      }
    } catch (err) { /* text se nepovedlo dotáhnout, pošleme obecný */ }

    await self.registration.showNotification(title, {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag: "capy-nudge",
      renotify: true,
      data: { url: "./index.html" },
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) if ("focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow(e.notification.data?.url || "./index.html");
  })());
});

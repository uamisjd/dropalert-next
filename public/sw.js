/**
 * Service worker di DropAlert — solo notifiche push.
 *
 * Non mette in cache nulla e non intercetta le richieste di rete: un
 * osservatorio che serve dati freschi non deve avere una copia vecchia del
 * sito installata nel browser. Qui c'è il minimo indispensabile per
 * ricevere una notifica e aprire la pagina giusta al clic.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeNotificationUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/preferite", self.location.origin);
    return url.origin === self.location.origin && !url.username && !url.password ? url.href : new URL("/preferite", self.location.origin).href;
  } catch { return new URL("/preferite", self.location.origin).href; }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* payload non leggibile: si mostra comunque un avviso onesto */
    data = {};
  }
  if (typeof data !== "object" || data === null) data = {};
  const title = typeof data.title === "string" ? data.title : "DropAlert";
  const body =
    (typeof data.body === "string" && data.body) ||
    "Una partita che segui ha superato la tua soglia. Nessuna vincita garantita: gioca responsabilmente.";
  const url = safeNotificationUrl(data.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      lang: "it",
      tag: url,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeNotificationUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          return client.navigate(url).then(() => client.focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

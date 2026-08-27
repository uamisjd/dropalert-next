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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* payload non leggibile: si mostra comunque un avviso onesto */
    data = {};
  }
  const title = data.title || "DropAlert";
  const body =
    data.body ||
    "Una partita che segui ha superato la tua soglia. Non è un consiglio di scommessa.";
  const url = data.url || "/preferite";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/og-cover.png",
      badge: "/og-cover.png",
      lang: "it",
      tag: url,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/preferite";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

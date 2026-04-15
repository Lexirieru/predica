// Predica Service Worker — handles Web Push events for market-resolve
// notifications. Payload contract is produced by be/src/lib/crons.ts after
// settlement commits. See fe/docs/updateBe-03.md §Push Notifications.

self.addEventListener("install", (event) => {
  // Activate immediately on first install — no tab-refresh delay for users
  // who just granted notification permission.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Predica", body: event.data.text() };
  }

  const title = payload.title || "Predica";
  const options = {
    body: payload.body || "",
    tag: payload.tag,
    data: payload.data || {},
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    // Re-notify on the same tag — so if a user has a stale notif, the new
    // one still chimes/shows rather than silently replacing.
    renotify: !!payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlFromPayload = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // If Predica is already open, focus that tab and navigate — avoids
      // stacking duplicate tabs each time a notification is clicked.
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(urlFromPayload);
          return;
        }
      }
      return self.clients.openWindow(urlFromPayload);
    }),
  );
});

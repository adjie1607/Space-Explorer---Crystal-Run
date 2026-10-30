"use strict";

const CACHE_NAME = "space-explorer-v1";
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/config.js",
  "./js/assets.js",
  "./js/audio.js",
  "./js/game.js",
  "./assets/fonts/Inter-Variable.ttf",
  "./assets/fonts/BarlowCondensed-SemiBold.ttf",
  "./assets/images/logo.svg",
  "./assets/images/ship.svg",
  "./assets/images/crystal.svg",
  "./assets/images/asteroid.svg",
  "./assets/images/shield.svg",
  "./assets/images/check.svg",
  "./assets/images/planet-kepler.svg",
  "./assets/images/planet-orion.svg",
  "./assets/images/planet-perseid.svg",
  "./assets/images/apple-touch-icon.png",
  "./assets/images/icon-192.png",
  "./assets/images/icon-512.png",
  "./assets/images/icon-maskable-512.png",
  "./assets/audio/orbit-theme.wav",
  "./assets/audio/crystal.wav",
  "./assets/audio/collision.wav",
  "./assets/audio/dash.wav",
  "./assets/audio/shield.wav",
  "./assets/audio/level-complete.wav",
  "./assets/audio/victory.wav",
  "./assets/audio/defeat.wav",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});

"use strict";

// Gambar dimuat satu kali, lalu dipakai kembali oleh Canvas dan panduan HTML.
window.GameAssets = (() => {
  const images = {};

  const ready = Promise.all(
    Object.entries(window.GameConfig.media.images).map(
      ([name, source]) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            images[name] = image;
            resolve();
          };
          image.onerror = () =>
            reject(new Error(`Aset tidak ditemukan: ${source}`));
          image.src = source;
        }),
    ),
  );

  return Object.freeze({ images, ready });
})();

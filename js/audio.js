"use strict";

// Pengelola file audio lokal. Tidak ada oscillator atau nada tersembunyi di game.js.
// Mendukung Web Audio API untuk latensi rendah & kontrol volume di iOS/Android,
// serta fallback ke HTMLAudioElement saat dibuka langsung melalui protokol file://.
window.GameAudio = (() => {
  const sources = window.GameConfig.media.audio;
  const music = new Audio(sources.music);
  const effects = new Set();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  const buffers = {};
  const activeNodes = new Set();
  let musicNode = null;
  let musicGain = null;
  let muted = false;
  let musicWanted = false;

  music.loop = true;
  music.preload = "auto";
  music.volume = 0.16;

  function ensureContext() {
    if (!AudioCtx || window.location.protocol === "file:") return null;
    if (!audioCtx) {
      try {
        audioCtx = new AudioCtx();
        preloadBuffers();
      } catch {
        audioCtx = null;
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function preloadBuffers() {
    if (!audioCtx) return;
    Object.entries(sources).forEach(([name, url]) => {
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
        .then((buf) => audioCtx.decodeAudioData(buf))
        .then((decoded) => {
          buffers[name] = decoded;
          if (name === "music" && musicWanted && !muted && !musicNode) {
            music.pause();
            playBufferMusic();
          }
        })
        .catch(() => {
          // Gunakan fallback HTMLAudioElement jika gagal memuat via fetch.
        });
    });
  }

  // Buka kunci audio pada sentuhan/ketukan pertama di iOS Safari & Android Chrome.
  function unlockAudio() {
    const ctx = ensureContext();
    if (ctx && ctx.state === "running") {
      ["pointerdown", "touchstart", "keydown", "click"].forEach((evt) =>
        document.removeEventListener(evt, unlockAudio, true),
      );
    }
  }
  ["pointerdown", "touchstart", "keydown", "click"].forEach((evt) =>
    document.addEventListener(evt, unlockAudio, { capture: true, passive: true }),
  );

  function safelyPlay(audio) {
    const promise = audio.play();
    if (promise)
      promise.catch(() => {
        // Browser boleh menolak autoplay. Game tetap berjalan tanpa audio.
      });
  }

  function stopBufferMusic() {
    if (musicNode) {
      try {
        musicNode.stop();
        musicNode.disconnect();
      } catch {}
      musicNode = null;
    }
  }

  function playBufferMusic() {
    const ctx = ensureContext();
    if (!ctx || !buffers.music || muted || !musicWanted) return false;
    stopBufferMusic();
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffers.music;
      source.loop = true;
      gain.gain.value = 0.16;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      musicNode = source;
      musicGain = gain;
      return true;
    } catch {
      return false;
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) pause();
    else if (musicWanted) startMusic(false);
  }

  function play(name, { rate = 1 } = {}) {
    if (muted || !sources[name] || name === "music") return;
    const ctx = ensureContext();
    if (ctx && buffers[name]) {
      try {
        if (activeNodes.size >= 8) {
          const oldest = activeNodes.values().next().value;
          try {
            oldest.stop();
          } catch {}
          activeNodes.delete(oldest);
        }
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffers[name];
        source.playbackRate.value = rate;
        gain.gain.value = 0.3;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => activeNodes.delete(source);
        activeNodes.add(source);
        source.start(0);
        return;
      } catch {
        // Lanjut ke fallback HTMLAudioElement bila gagal.
      }
    }
    const effect = new Audio(sources[name]);
    effect.volume = 0.3;
    effect.playbackRate = rate;
    const remove = () => effects.delete(effect);
    effect.addEventListener("ended", remove, { once: true });
    effect.addEventListener("error", remove, { once: true });
    // Batas suara bersamaan mencegah tumpukan efek saat combo cepat.
    if (effects.size >= 8) {
      const oldest = effects.values().next().value;
      oldest.pause();
      effects.delete(oldest);
    }
    effects.add(effect);
    safelyPlay(effect);
  }

  function startMusic(reset = false) {
    musicWanted = true;
    if (muted) return;
    if (playBufferMusic()) {
      music.pause();
      return;
    }
    if (reset) music.currentTime = 0;
    safelyPlay(music);
  }

  function pause() {
    stopBufferMusic();
    music.pause();
    activeNodes.forEach((node) => {
      try {
        node.stop();
      } catch {}
    });
    activeNodes.clear();
    effects.forEach((effect) => effect.pause());
    effects.clear();
  }

  function stopMusic() {
    musicWanted = false;
    pause();
  }

  return Object.freeze({ play, startMusic, pause, stopMusic, setMuted });
})();

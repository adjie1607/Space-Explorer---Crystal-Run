"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas"),
    ctx = canvas.getContext("2d"),
    arena = $("arena");
  // 1. KONFIGURASI DAN STATE
  const CONFIG = window.GameConfig.settings;
  const LEVELS = window.GameConfig.levels;
  const ENDLESS = window.GameConfig.endless;
  const PLANETS = ["planet-perseid", "planet-kepler", "planet-orion"];
  const images = window.GameAssets.images;
  let levelIndex = 0,
    levelScore = 0,
    levelStartScore = 0,
    completedLevels = 0,
    endlessWave = 1;
  let assetsReady = false;
  const isEndless = () => levelIndex >= LEVELS.length;
  function currentLevel() {
    if (!isEndless()) return LEVELS[levelIndex];
    const step = Math.max(0, endlessWave - 1);
    return {
      id: "∞",
      name: ENDLESS.name,
      description: ENDLESS.description,
      target: ENDLESS.wavePoints,
      duration: 0,
      spawnInterval: Math.max(
        ENDLESS.minSpawnInterval,
        ENDLESS.baseSpawnInterval - step * ENDLESS.spawnStep,
      ),
      minSpeed: Math.min(280, ENDLESS.baseMinSpeed + step * ENDLESS.speedStep),
      maxSpeed: Math.min(360, ENDLESS.baseMaxSpeed + step * ENDLESS.speedStep),
      drift: Math.min(165, ENDLESS.baseDrift + step * ENDLESS.driftStep),
      planet: PLANETS[step % PLANETS.length],
      difficulty: `Gelombang ${endlessWave}`,
      isEndless: true,
    };
  }
  const C = {
    bg: "#101512",
    star: "#bbc4ac",
    ink: "#f1f0e8",
    orange: "#ed8c50",
    mint: "#a8c9ac",
    rock: "#77776a",
    danger: "#ed866b",
  };
  let W = 1100,
    H = 595,
    scale = 1,
    state = "ready",
    previous = 0,
    clock = 0;
  let score = 0,
    timeLeft = LEVELS[0].duration,
    health = CONFIG.lives,
    elapsed = 0,
    combo = 0,
    comboTime = 0,
    maxCombo = 0;
  let spawnTimer = 0,
    healTimer = 0,
    dashCooldown = 0,
    dashTime = 0,
    invincible = 0,
    shake = 0,
    announceTime = 0,
    collected = 0;
  let best = 0,
    muted = false;
  let coins = [],
    rocks = [],
    heals = [],
    particles = [],
    popups = [],
    trail = [];
  const keys = new Set(),
    pointer = {
      active: false,
      id: null,
      x: 0,
      y: 0,
      isTouch: false,
      lastTap: 0,
    },
    joystick = {
      active: false,
      pointerId: null,
      dx: 0,
      dy: 0,
      magnitude: 0,
    };
  let wakeLockSentinel = null;
  const player = { x: W * 0.5, y: H * 0.72, r: 17, angle: 0, dx: 0, dy: -1 };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const random = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const stars = Array.from({ length: 115 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: random(0.5, 1.5),
    speed: random(0.003, 0.018),
    brightness: random(0.15, 0.6),
  }));
  try {
    best = Number(localStorage.getItem("spaceExplorerCampaignBest")) || 0;
    muted = localStorage.getItem("spaceExplorerMuted") === "true";
  } catch {
    /* Storage is optional, including file:// and private mode. */
  }
  $("highScore").textContent = best;

  // 2. UKURAN ARENA DAN UTILITAS
  function resize() {
    const oldW = W,
      oldH = H,
      bounds = arena.getBoundingClientRect();
    W = bounds.width < 480 ? 540 : bounds.width < 700 ? 850 : 1100;
    scale = bounds.width / W;
    H = bounds.height / scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    [player, ...coins, ...rocks, ...heals].forEach((item) => {
      item.x = clamp((item.x / oldW) * W, 20, W - 20);
      item.y = (item.y / oldH) * H;
    });
    pointer.active = false;
    pointer.id = null;
    resetJoystick();
    trail = [];
  }
  new ResizeObserver(resize).observe(arena);

  function haptic(pattern) {
    if (reducedMotion.matches || typeof navigator.vibrate !== "function")
      return;
    try {
      navigator.vibrate(pattern);
    } catch {}
  }

  function resetJoystick() {
    joystick.active = false;
    joystick.pointerId = null;
    joystick.dx = 0;
    joystick.dy = 0;
    joystick.magnitude = 0;
    const zone = $("joystickZone");
    const knob = $("joystickKnob");
    if (zone) zone.classList.remove("active");
    if (knob) knob.style.transform = "translate3d(0px, 0px, 0px)";
  }

  async function syncWakeLock(active) {
    if (!("wakeLock" in navigator)) return;
    try {
      if (active && !wakeLockSentinel && !document.hidden) {
        wakeLockSentinel = await navigator.wakeLock.request("screen");
        wakeLockSentinel.addEventListener("release", () => {
          wakeLockSentinel = null;
        });
      } else if (!active && wakeLockSentinel) {
        await wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
    } catch {}
  }

  // Suara diputar dari file di assets/audio; detail pemutar ada di audio.js.
  function sound(kind) {
    window.GameAudio.play(kind, {
      rate: kind === "coin" ? 1 + Math.min(combo, 8) * 0.035 : 1,
    });
  }
  function updateSoundButton() {
    $("soundLabel").textContent = muted ? "Suara mati" : "Suara aktif";
    $("soundButton").setAttribute("aria-pressed", String(muted));
    $("soundButton").setAttribute(
      "aria-label",
      muted ? "Aktifkan suara (M)" : "Matikan suara (M)",
    );
    $("soundButton").querySelector(".sound-waves").style.visibility = muted
      ? "hidden"
      : "visible";
  }
  function toggleSound() {
    muted = !muted;
    window.GameAudio.setMuted(muted);
    try {
      localStorage.setItem("spaceExplorerMuted", muted);
    } catch {}
    updateSoundButton();
  }
  function announce(text) {
    $("announcement").textContent = text;
    $("announcement").classList.add("visible");
    announceTime = 2.4;
  }
  function spawnPoint() {
    // Avoid placing a collectible on top of the pilot or an asteroid.
    let p;
    for (let i = 0; i < 40; i++) {
      p = { x: random(42, W - 42), y: random(74, H - 65) };
      if (
        distance(p, player) > 90 &&
        !rocks.some((r) => distance(p, r) < r.r + 45)
      )
        break;
    }
    return p;
  }
  function newCoin() {
    return { ...spawnPoint(), r: 13, phase: random(0, Math.PI * 2) };
  }
  function newRock() {
    const level = currentLevel();
    const r = random(19, 34);
    return {
      x: random(r, W - r),
      y: -r - 10,
      r,
      vx: random(-level.drift, level.drift),
      vy: random(level.minSpeed, level.maxSpeed),
      angle: random(0, 6),
      spin: random(-0.7, 0.7),
    };
  }
  function formatClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  function syncHUD() {
    const endless = isEndless();
    const seconds = endless ? Math.floor(elapsed) : Math.ceil(timeLeft);
    const progressValue = endless
      ? levelScore % ENDLESS.wavePoints
      : Math.min(levelScore, currentLevel().target);
    const progressMax = endless ? ENDLESS.wavePoints : currentLevel().target;
    if ($("levelHeading")) {
      $("levelHeading").innerHTML = endless
        ? `Mode Endless · Gelombang <span>${endlessWave}</span>`
        : `Level <span id="levelNumber">${levelIndex + 1}</span> dari ${LEVELS.length}`;
    }
    $("levelName").textContent = currentLevel().name;
    $("levelTarget").textContent = progressMax;
    if ($("levelTargetUnit")) {
      $("levelTargetUnit").textContent = endless ? "poin / gelombang" : "poin";
    }
    $("levelDescription").textContent = currentLevel().description;
    $("levelDuration").textContent = endless ? "∞" : currentLevel().duration;
    if ($("levelDurationUnit")) {
      $("levelDurationUnit").textContent = endless
        ? "tanpa batas waktu"
        : "detik";
    }
    $("progressTrack").setAttribute("aria-valuenow", progressValue);
    $("progressTrack").setAttribute("aria-valuemax", progressMax);
    if ($("timerLabel")) {
      $("timerLabel").textContent = endless ? "Waktu bertahan" : "Sisa waktu";
    }
    $("timer").textContent = formatClock(seconds);
    $("timer").classList.toggle("timer-urgent", !endless && seconds <= 10);
    $("score").textContent = String(score).padStart(3, "0");
    $("lives").setAttribute(
      "aria-label",
      `${health} dari ${CONFIG.lives} nyawa`,
    );
    [...$("lives").children].forEach((heart, i) =>
      heart.classList.toggle("lost", i >= health),
    );
    $("progressFill").style.width =
      `${Math.min(100, (progressValue / progressMax) * 100)}%`;
    $("progressLabel").textContent = endless
      ? `${progressValue} dari ${progressMax} poin ke Gelombang ${endlessWave + 1}`
      : `${levelScore} dari ${currentLevel().target} poin level`;
    $("dashFill").style.width =
      `${(1 - dashCooldown / CONFIG.dashCooldown) * 100}%`;
    $("dashStatus").textContent =
      dashCooldown > 0
        ? `Dash siap dalam ${dashCooldown.toFixed(1)} d`
        : "Dash siap · Shift";
    const dashDisabled = state !== "playing" || dashCooldown > 0;
    $("dashButton").disabled = dashDisabled;
    if ($("touchDashButton")) {
      $("touchDashButton").disabled = dashDisabled;
      const circumference = 238.76;
      $("touchDashRing").style.strokeDashoffset =
        `${(dashCooldown / CONFIG.dashCooldown) * circumference}`;
      $("touchDashStatus").textContent =
        dashCooldown > 0
          ? `Isi ulang ${dashCooldown.toFixed(1)} d`
          : "Dash siap · Ketuk!";
      $("touchDashStatus").classList.toggle("cooldown", dashCooldown > 0);
    }
    $("comboLabel").textContent =
      state === "playing"
        ? combo > 0
          ? `Combo ${combo} · ×${multiplier()}${comboTime < 1 ? " · cepat!" : ""}`
          : "Ambil kristal untuk mulai combo"
        : "Jelajahi yang belum terjamah.";
  }
  function multiplier() {
    return Math.min(3, 1 + Math.floor(combo / 3));
  }
  // STATE: ready → playing → level-complete → playing → victory.
  // Dari playing pemain juga bisa menuju paused atau game-over.
  function renderRoute() {
    const steps = LEVELS.map((level, index) => {
      const complete = index < completedLevels;
      const active = index === levelIndex && !complete;
      const status = complete
        ? "Tuntas"
        : active
          ? "Saat ini"
          : index === completedLevels
            ? "Berikutnya"
            : "Terkunci";
      return `<li class="route-step ${complete ? "complete" : active ? "current" : "locked"}" ${active ? 'aria-current="step"' : ""}><span class="route-number">${complete ? '<img src="assets/images/check.svg" width="20" height="20" alt="">' : level.id}</span><div><strong>${level.name}</strong><span>${level.target} poin · ${level.duration} detik</span></div><span class="route-status">${status}</span></li>`;
    });
    const endlessActive = isEndless();
    const endlessUnlocked = completedLevels >= LEVELS.length;
    const endlessStatus = endlessActive
      ? `Gelombang ${endlessWave}`
      : endlessUnlocked
        ? "Siap dijelajahi"
        : "Setelah Lv. 3";
    steps.push(
      `<li class="route-step ${endlessActive ? "current" : endlessUnlocked ? "complete" : "locked"}" ${endlessActive ? 'aria-current="step"' : ""}><span class="route-number">∞</span><div><strong>${ENDLESS.name}</strong><span>Tanpa batas waktu · Gelombang abadi</span></div><span class="route-status">${endlessStatus}</span></li>`,
    );
    $("levelRoute").innerHTML = steps.join("");
  }

  function setState(next) {
    state = next;
    const endState = ["level-complete", "game-over", "victory"].includes(next);
    canvas.closest(".game-panel").className =
      `game-panel is-${next}${endState ? " is-ended" : ""}`;
    $("overlay").hidden = next === "playing";
    $("pauseButton").disabled = !["playing", "paused"].includes(next);
    $("pauseButton").setAttribute(
      "aria-label",
      next === "paused" ? "Lanjutkan permainan" : "Jeda permainan",
    );
    $("pauseButton").innerHTML =
      next === "paused"
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
    const labels = {
      ready: "Siap menjelajah",
      playing: "Misi berlangsung",
      paused: "Misi dijeda",
      "level-complete": "Level selesai",
      "game-over": "Misi terhenti",
      victory: "Ekspedisi tuntas",
    };
    $("missionStatus").textContent = labels[next];
    $("restartButton").hidden = !endState || next === "victory";
    if (next !== "playing") window.GameAudio.stopMusic();
    if (next !== "playing") {
      announceTime = 0;
      $("announcement").classList.remove("visible");
      resetJoystick();
      pointer.active = false;
      pointer.id = null;
    }
    syncWakeLock(next === "playing");
    renderRoute();
    syncHUD();
  }

  // Satu level selalu dimulai dengan timer penuh dan tiga nyawa.
  // Skor dari level sebelumnya disimpan di levelStartScore.
  function beginLevel() {
    if (!assetsReady) return;
    score = levelStartScore;
    levelScore = 0;
    endlessWave = 1;
    timeLeft = isEndless() ? 0 : currentLevel().duration;
    health = CONFIG.lives;
    elapsed = 0;
    combo = 0;
    comboTime = 0;
    maxCombo = 0;
    collected = 0;
    spawnTimer = 0.8;
    healTimer = 7;
    dashCooldown = 0;
    dashTime = 0;
    invincible = 1.2;
    shake = 0;
    keys.clear();
    pointer.active = false;
    Object.assign(player, { x: W * 0.5, y: H * 0.72, angle: 0, dx: 0, dy: -1 });
    rocks = [];
    heals = [];
    particles = [];
    popups = [];
    trail = [];
    coins = Array.from({ length: W < 700 ? 4 : 5 }, newCoin);
    $("sectorLabel").textContent = isEndless()
      ? `Mode Endless · Gelombang 1`
      : `Level ${levelIndex + 1} · ${currentLevel().name}`;
    $("flightStatus").textContent = `Nomad · ${currentLevel().difficulty}`;
    setState("playing");
    window.GameAudio.startMusic(true);
    announce(
      isEndless()
        ? "Mode Endless dimulai! Bertahanlah selama mungkin!"
        : `Level ${levelIndex + 1} dimulai. Kejar ${currentLevel().target} poin!`,
    );
  }

  function start() {
    if (!assetsReady) return;
    levelIndex = 0;
    completedLevels = 0;
    levelStartScore = 0;
    beginLevel();
  }

  function nextLevel() {
    if (state !== "level-complete" || levelIndex >= LEVELS.length) return;
    levelStartScore = score;
    levelIndex++;
    beginLevel();
  }

  function primaryAction() {
    if (state === "paused") pause();
    else if (state === "level-complete") nextLevel();
    else if (state === "game-over") beginLevel();
    else if (state === "ready" || state === "victory") start();
  }

  function pause() {
    if (state === "playing") {
      keys.clear();
      pointer.active = false;
      setState("paused");
      $("overlayTitle").innerHTML = "Jeda dulu.<br>Tarik napas.";
      $("overlayDescription").textContent = isEndless()
        ? `Mode Endless (Gelombang ${endlessWave}) tetap aman. Waktu dan posisi dibekukan.`
        : `Level ${levelIndex + 1} tetap aman. Timer dan posisi dibekukan.`;
      $("startLabel").textContent = "Lanjutkan misi";
      $("result").hidden = true;
      $("enterHint").innerHTML = "atau tekan <kbd>P</kbd>";
      $("startButton").focus({ preventScroll: true });
    } else if (state === "paused" && !$("helpDialog").open) {
      setState("playing");
      window.GameAudio.startMusic();
    }
  }

  function finish(won, reason) {
    if (state !== "playing") return;
    const oldBest = best;
    const endless = isEndless();
    const bonus =
      won && !endless ? Math.ceil(timeLeft) * 2 + health * 20 : 0;
    score += bonus;
    if (won) completedLevels = Math.max(completedLevels, levelIndex + 1);
    if (score > best) {
      best = score;
      try {
        localStorage.setItem("spaceExplorerCampaignBest", best);
      } catch {}
      $("highScore").textContent = best;
    }
    const finalCampaignLevel = levelIndex === LEVELS.length - 1;
    const next = !won ? "game-over" : "level-complete";
    pointer.active = false;
    keys.clear();
    popups = [];
    setState(next);
    sound(!won ? "lost" : finalCampaignLevel ? "won" : "level");
    $("overlayTitle").innerHTML = won
      ? finalCampaignLevel
        ? "Tiga orbit tuntas.<br>Masuki Endless."
        : levelIndex === 0
          ? "Kepler tuntas.<br>Orion menunggu."
          : "Orion tuntas.<br>Satu orbit lagi."
      : endless
        ? `Misi abadi usai.<br>Gelombang ${endlessWave}.`
        : reason === "time"
          ? "Waktu habis.<br>Sekali lagi?"
          : "Kena asteroid.<br>Balas di orbit.";
    $("overlayDescription").textContent = won
      ? finalCampaignLevel
        ? `Bonus +${bonus} poin. Mode Endless terbuka: terbang tanpa batas waktu dan kejar skor tertinggi!`
        : `Bonus +${bonus} poin. Berikutnya: ${LEVELS[levelIndex + 1].target} poin dalam ${LEVELS[levelIndex + 1].duration} detik.`
      : endless
        ? `Bertahan selama ${formatClock(elapsed)} di Mode Endless. Main lagi di Endless dari skor akhir Level 3 (${levelStartScore} poin) tanpa balik ke Level 1.`
        : `Level ${levelIndex + 1} belum selesai. Ulangi level ini; skor level sebelumnya tetap aman.`;
    $("result").hidden = false;
    $("resultScore").textContent = score;
    $("resultDetail").textContent =
      `skor total${score > oldBest ? " · rekor baru!" : ""}`;
    $("startLabel").textContent = won
      ? finalCampaignLevel
        ? "Lanjut ke Mode Endless"
        : `Lanjut ke level ${levelIndex + 2}`
      : endless
        ? "Main lagi di Endless"
        : `Ulangi level ${levelIndex + 1}`;
    $("enterHint").innerHTML = "atau tekan <kbd>Enter</kbd>";
    $("flightStatus").textContent = won
      ? "Nomad · Level berhasil"
      : "Nomad · Menunggu penerbangan ulang";
    $("startButton").focus({ preventScroll: true });
    if (won) burst(player.x, player.y, C.orange, 45);
  }
  function dash() {
    if (state !== "playing" || dashCooldown > 0) return;
    dashCooldown = CONFIG.dashCooldown;
    dashTime = CONFIG.dashDuration;
    invincible = Math.max(invincible, 0.45);
    sound("dash");
    haptic(22);
    burst(player.x, player.y, C.mint, 12);
  }
  function burst(x, y, color, count) {
    if (reducedMotion.matches) count = Math.min(count, 5);
    for (let i = 0; i < count; i++) {
      const a = random(0, Math.PI * 2),
        v = random(30, 190);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: random(0.2, 0.75),
        max: 0.75,
        color,
        r: random(1, 3),
      });
    }
  }
  function popup(x, y, text, color) {
    popups.push({ x, y, text, color, life: 1 });
  }

  // 4. UPDATE: gerak, timer, spawn, skor, dan tabrakan
  function update(dt) {
    if (state !== "paused") clock += dt;
    if (state === "ready" && !reducedMotion.matches)
      stars.forEach((s) => {
        s.y = (s.y + s.speed * dt * 0.25) % 1;
      });
    if (state === "paused") return;
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    particles = particles.filter((p) => p.life > 0);
    if (state !== "playing") return;
    elapsed += dt;
    if (!isEndless()) timeLeft = Math.max(0, timeLeft - dt);
    invincible = Math.max(0, invincible - dt);
    dashCooldown = Math.max(0, dashCooldown - dt);
    dashTime = Math.max(0, dashTime - dt);
    shake = Math.max(0, shake - dt * 25);
    comboTime -= dt;
    if (comboTime <= 0) combo = 0;
    if (announceTime > 0) {
      announceTime -= dt;
      if (announceTime <= 0) $("announcement").classList.remove("visible");
    }
    stars.forEach((s) => {
      s.y = (s.y + s.speed * dt * (dashTime > 0 ? 10 : 1.5)) % 1;
    });
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      rocks.push(newRock());
      spawnTimer = currentLevel().spawnInterval;
    }
    healTimer -= dt;
    if (healTimer <= 0) {
      if (health < CONFIG.lives && !heals.length)
        heals.push({ ...spawnPoint(), r: 15, life: 9 });
      healTimer = 7;
    }
    let dx =
      Number(keys.has("arrowright") || keys.has("d")) -
      Number(keys.has("arrowleft") || keys.has("a"));
    let dy =
      Number(keys.has("arrowdown") || keys.has("s")) -
      Number(keys.has("arrowup") || keys.has("w"));
    let speedFactor = 1;
    if (joystick.active && joystick.magnitude > 0.08) {
      dx = joystick.dx;
      dy = joystick.dy;
      speedFactor = Math.min(1, joystick.magnitude * 1.15);
    } else if (pointer.active) {
      const deltaX = pointer.x - player.x,
        deltaY = pointer.y - player.y,
        d = Math.hypot(deltaX, deltaY);
      dx = d > 5 ? deltaX / d : 0;
      dy = d > 5 ? deltaY / d : 0;
    }
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      dx /= length;
      dy /= length;
      player.dx = dx;
      player.dy = dy;
    }
    const speed =
      CONFIG.speed * (dashTime > 0 ? 3.2 : speedFactor);
    if (length > 0 || dashTime > 0) {
      let step = speed * dt;
      if (pointer.active && !joystick.active && dashTime <= 0)
        step = Math.min(
          step,
          Math.hypot(pointer.x - player.x, pointer.y - player.y),
        );
      player.x += (dashTime > 0 ? player.dx : dx) * step;
      player.y += (dashTime > 0 ? player.dy : dy) * step;
    }
    player.x = clamp(player.x, 24, W - 24);
    player.y = clamp(player.y, 60, H - 37);
    player.angle += (dx * 0.32 - player.angle) * Math.min(1, dt * 12);
    if (!reducedMotion.matches) {
      trail.push({ x: player.x, y: player.y + 13, life: 0.3 });
      trail = trail.slice(-18);
    }
    trail.forEach((t) => (t.life -= dt));
    trail = trail.filter((t) => t.life > 0);
    rocks.forEach((r) => {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.angle += r.spin * dt;
      if (r.x < r.r || r.x > W - r.r) {
        r.vx *= -1;
        r.x = clamp(r.x, r.r, W - r.r);
      }
    });
    rocks = rocks.filter((r) => r.y < H + r.r);
    for (const coin of coins) {
      if (distance(player, coin) < player.r + coin.r) {
        combo++;
        comboTime = CONFIG.comboWindow;
        maxCombo = Math.max(combo, maxCombo);
        collected++;
        const points = 10 * multiplier();
        score += points;
        levelScore += points;
        burst(coin.x, coin.y, C.orange, 16);
        popup(
          coin.x,
          coin.y - 18,
          `+${points}${multiplier() > 1 ? ` ×${multiplier()}` : ""}`,
          C.orange,
        );
        sound("coin");
        haptic(10);
        Object.assign(coin, newCoin());
        if (score > best) {
          best = score;
          try {
            localStorage.setItem("spaceExplorerCampaignBest", best);
          } catch {}
          $("highScore").textContent = best;
        }
        if (isEndless()) {
          const nextWave = 1 + Math.floor(levelScore / ENDLESS.wavePoints);
          if (nextWave > endlessWave) {
            endlessWave = nextWave;
            score += ENDLESS.waveBonus;
            if (score > best) {
              best = score;
              try {
                localStorage.setItem("spaceExplorerCampaignBest", best);
              } catch {}
              $("highScore").textContent = best;
            }
            if (health < CONFIG.lives) health++;
            sound("level");
            haptic([20, 40, 30]);
            burst(player.x, player.y, C.mint, 32);
            popup(
              player.x,
              player.y - 32,
              `Gelombang ${endlessWave}! +${ENDLESS.waveBonus}`,
              C.mint,
            );
            $("sectorLabel").textContent =
              `Mode Endless · Gelombang ${endlessWave}`;
            $("flightStatus").textContent = `Nomad · Gelombang ${endlessWave}`;
            announce(
              `Gelombang ${endlessWave}! Bonus +${ENDLESS.waveBonus} poin & +1 nyawa.`,
            );
            renderRoute();
          }
        } else if (levelScore >= currentLevel().target) {
          finish(true);
          return;
        }
      }
    }
    heals.forEach((h) => (h.life -= dt));
    heals = heals.filter((h) => {
      if (distance(player, h) < player.r + h.r) {
        health = Math.min(CONFIG.lives, health + 1);
        burst(h.x, h.y, C.mint, 20);
        popup(h.x, h.y, "+1 nyawa", C.mint);
        sound("heal");
        haptic([15, 30, 20]);
        announce("Perisai pulih. Lanjutkan misi!");
        return false;
      }
      return h.life > 0;
    });
    if (invincible <= 0) {
      const hit = rocks.findIndex(
        (r) => distance(player, r) < player.r + r.r * 0.77,
      );
      if (hit >= 0) {
        const r = rocks.splice(hit, 1)[0];
        health--;
        combo = 0;
        comboTime = 0;
        invincible = 1.6;
        shake = reducedMotion.matches ? 0 : 7;
        burst(r.x, r.y, C.danger, 28);
        popup(player.x, player.y - 35, "−1 nyawa", C.danger);
        sound("hit");
        haptic([45, 30, 65]);
        if (health <= 0) {
          finish(false, "health");
          return;
        }
        announce("Kena asteroid! Manfaatkan dash.");
      }
    }
    popups.forEach((p) => {
      p.y -= 28 * dt;
      p.life -= dt;
    });
    popups = popups.filter((p) => p.life > 0);
    if (!isEndless() && timeLeft <= 0) {
      finish(false, "time");
      return;
    }
  }

  // Gambar diambil dari assets/images. Bintang dan partikel adalah efek Canvas.
  function planet() {
    const x = W * (W < 700 ? 0.9 : 0.77);
    const y = H * (W < 700 ? 0.78 : 0.42);
    const r = Math.min(W * 0.205, H * 0.34);
    ctx.save();
    ctx.globalAlpha = state === "ready" ? 1 : 0.23;
    ctx.drawImage(
      images[currentLevel().planet],
      x - (r * 400) / 205,
      y - (r * 260) / 205,
      (r * 800) / 205,
      (r * 520) / 205,
    );
    ctx.restore();
  }

  function drawRock(rock) {
    ctx.save();
    ctx.translate(rock.x, rock.y);
    ctx.rotate(rock.angle);
    ctx.drawImage(images.asteroid, -rock.r, -rock.r, rock.r * 2, rock.r * 2);
    ctx.restore();
  }

  function crystal(x, y, r, phase = 0) {
    ctx.save();
    ctx.translate(
      x,
      y + (reducedMotion.matches ? 0 : Math.sin(clock * 2.7 + phase) * 3),
    );
    ctx.drawImage(images.crystal, -r, -r * 1.3, r * 2, r * 2.6);
    ctx.restore();
  }

  function ship(x, y, size = 1, angle = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(size, size);
    ctx.drawImage(images.ship, -32, -37, 64, 80);
    if (invincible > 0 && state === "playing") {
      ctx.strokeStyle = C.mint;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 5. RENDER: menggambar satu frame
  function draw() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (shake > 0 && state === "playing")
      ctx.translate(random(-shake, shake), random(-shake, shake));
    for (const s of stars) {
      ctx.fillStyle = C.star;
      ctx.globalAlpha =
        s.brightness *
        (reducedMotion.matches ? 1 : 0.8 + Math.sin(clock + s.x * 90) * 0.2);
      ctx.fillRect(s.x * W, s.y * H, s.r, s.r * (dashTime > 0 ? 8 : 1));
    }
    ctx.globalAlpha = 1;
    planet();
    if (state === "ready") {
      const mobile = W < 700;
      [
        {
          x: W * 0.56,
          y: H * 0.21,
          r: 18,
          angle: 0.8,
          sides: [0.8, 1, 0.9, 0.8, 1, 0.7, 1, 0.8, 0.9],
        },
        {
          x: W * 0.94,
          y: H * 0.76,
          r: 30,
          angle: -0.2,
          sides: [0.8, 1, 0.9, 0.8, 1, 0.7, 1, 0.8, 0.9],
        },
        {
          x: W * 0.55,
          y: H * 0.88,
          r: 11,
          angle: 0.3,
          sides: [0.8, 1, 0.9, 0.8, 1, 0.7, 1, 0.8, 0.9],
        },
      ].forEach(drawRock);
      crystal(W * (mobile ? 0.76 : 0.62), H * (mobile ? 0.9 : 0.48), 11, 1);
      crystal(W * 0.94, H * 0.17, 8, 2);
      ship(
        W * (mobile ? 0.58 : 0.72),
        H * (mobile ? 0.85 : 0.77) +
          (reducedMotion.matches ? 0 : Math.sin(clock * 1.4) * 5),
        mobile ? 1.1 : 1.5,
        -0.28,
      );
      ctx.fillStyle = "#7a8772";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("KEPLER — 186f", W * 0.8, H * (mobile ? 0.99 : 0.88));
    } else {
      trail.forEach((t) => {
        ctx.globalAlpha = t.life * 0.5;
        ctx.fillStyle = dashTime > 0 ? C.mint : C.orange;
        ctx.beginPath();
        ctx.arc(t.x, t.y, (5 * t.life) / 0.3, 0, 7);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      coins.forEach((c) => crystal(c.x, c.y, c.r, c.phase));
      rocks.forEach(drawRock);
      heals.forEach((h) => {
        ctx.save();
        ctx.globalAlpha = h.life < 2 ? 0.6 : 1;
        ctx.drawImage(images.shield, h.x - 18, h.y - 21, 36, 42);
        ctx.restore();
      });
      ctx.globalAlpha =
        invincible > 0 &&
        dashTime <= 0 &&
        !reducedMotion.matches &&
        Math.floor(clock * 12) % 2
          ? 0.45
          : 1;
      ship(player.x, player.y, 1, player.angle);
      if (pointer.active && !joystick.active && state === "playing") {
        ctx.save();
        ctx.strokeStyle = C.orange;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      popups.forEach((p) => {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.font = "600 17px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      });
      ctx.globalAlpha = 1;
    }
    particles.forEach((p) => {
      ctx.globalAlpha = Math.min(1, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // Bounded substeps keep movement and collisions consistent across refresh rates.
  function frame(timestamp) {
    const dt = previous ? Math.min((timestamp - previous) / 1000, 0.1) : 0;
    previous = timestamp;
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 120);
      update(step);
      remaining -= step;
    }
    if (state === "playing") syncHUD();
    if (assetsReady) draw();
    requestAnimationFrame(frame);
  }
  // 6. INPUT: tombol, keyboard, pointer, dan jeda otomatis
  $("startButton").addEventListener("click", primaryAction);
  $("restartButton").addEventListener("click", start);
  $("pauseButton").addEventListener("click", pause);
  $("dashButton").addEventListener("click", dash);
  if ($("touchDashButton")) {
    $("touchDashButton").addEventListener("pointerdown", (e) => {
      if (state !== "playing") return;
      e.preventDefault();
      dash();
    });
    $("touchDashButton").addEventListener("click", dash);
  }
  $("soundButton").addEventListener("click", toggleSound);
  $("helpButton").addEventListener("click", () => {
    if (state === "playing") pause();
    $("helpDialog").showModal();
  });
  function closeHelp() {
    $("helpDialog").close();
  }
  $("closeHelp").addEventListener("click", closeHelp);
  $("understood").addEventListener("click", closeHelp);

  // Panduan & tombol instalasi aplikasi (PWA Android / iOS Home Screen)
  let deferredInstallPrompt = null;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!isStandalone && $("installButton")) {
    $("installButton").hidden = false;
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!isStandalone && $("installButton")) {
      $("installButton").hidden = false;
    }
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if ($("installButton")) $("installButton").hidden = true;
    announce("Space Explorer berhasil dipasang!");
  });
  if ($("installButton")) {
    $("installButton").addEventListener("click", async () => {
      if (state === "playing") pause();
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch {}
        deferredInstallPrompt = null;
      } else if ($("installDialog")) {
        $("installDialog").showModal();
      }
    });
  }
  function closeInstall() {
    if ($("installDialog")) $("installDialog").close();
  }
  if ($("closeInstall"))
    $("closeInstall").addEventListener("click", closeInstall);
  if ($("closeInstallConfirm"))
    $("closeInstallConfirm").addEventListener("click", closeInstall);

  // Tombol layar penuh (Fullscreen API) untuk pengalaman layaknya aplikasi native
  const fsElement = () =>
    document.fullscreenElement || document.webkitFullscreenElement;
  const canFullscreen =
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen;
  if (canFullscreen && !isStandalone && $("fullscreenButton")) {
    $("fullscreenButton").hidden = false;
    $("fullscreenButton").addEventListener("click", () => {
      try {
        if (fsElement()) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen)
            document.webkitExitFullscreen();
        } else {
          const el = document.documentElement;
          if (el.requestFullscreen) el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        }
      } catch {}
    });
    ["fullscreenchange", "webkitfullscreenchange"].forEach((evt) =>
      document.addEventListener(evt, () => {
        const active = Boolean(fsElement());
        $("fullscreenLabel").textContent = active
          ? "Keluar penuh"
          : "Layar penuh";
      }),
    );
  }

  document.addEventListener("keydown", (e) => {
    if (
      $("helpDialog").open ||
      ($("installDialog") && $("installDialog").open) ||
      ["INPUT", "TEXTAREA"].includes(e.target.tagName)
    )
      return;
    const key = e.key.toLowerCase();
    if (key === " " && ["BUTTON", "A"].includes(e.target.tagName)) return;
    if (
      [
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        " ",
        "shift",
      ].includes(key)
    )
      e.preventDefault();
    if (e.repeat) return;
    keys.add(key);
    if (key === "m") toggleSound();
    else if (key === "shift" || key === " ") dash();
    else if (key === "p" || key === "escape") pause();
    else if (
      key === "enter" &&
      e.target.tagName !== "BUTTON" &&
      e.target.tagName !== "A"
    ) {
      primaryAction();
    }
  });
  document.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  // Kontrol Virtual Analog Joystick (jempol kiri di HP / tablet)
  const joyZone = $("joystickZone");
  const joyBase = $("joystickBase");
  const joyKnob = $("joystickKnob");
  function updateJoystick(e) {
    if (!joyBase || !joyKnob) return;
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxRadius = rect.width * 0.36;
    const rawX = e.clientX - cx;
    const rawY = e.clientY - cy;
    const dist = Math.hypot(rawX, rawY);
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(rawY, rawX);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    joyKnob.style.transform = `translate3d(${kx.toFixed(1)}px, ${ky.toFixed(1)}px, 0px)`;
    joystick.magnitude = maxRadius > 0 ? clampedDist / maxRadius : 0;
    joystick.dx = dist > 0 ? rawX / dist : 0;
    joystick.dy = dist > 0 ? rawY / dist : 0;
  }
  if (joyZone) {
    joyZone.addEventListener("pointerdown", (e) => {
      if (joystick.active) return;
      joystick.active = true;
      joystick.pointerId = e.pointerId;
      joyZone.classList.add("active");
      updateJoystick(e);
      try {
        joyZone.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    });
    joyZone.addEventListener("pointermove", (e) => {
      if (joystick.active && e.pointerId === joystick.pointerId) {
        updateJoystick(e);
      }
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((event) =>
      joyZone.addEventListener(event, (e) => {
        if (e.pointerId === joystick.pointerId) resetJoystick();
      }),
    );
  }

  // Kontrol sentuh & seret langsung di arena (mendukung multi-touch & ketuk 2x Dash)
  function movePointer(e) {
    const b = canvas.getBoundingClientRect();
    const touchOffsetY = e.pointerType === "touch" ? -24 : 0;
    pointer.x = clamp(((e.clientX - b.left) / b.width) * W, 24, W - 24);
    pointer.y = clamp(
      ((e.clientY - b.top) / b.height) * H + touchOffsetY,
      60,
      H - 37,
    );
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (state !== "playing") return;
    // Jika jari pertama sedang menyeret arena atau analog, ketukan jari kedua memicu Dash.
    if ((pointer.active && pointer.id !== e.pointerId) || joystick.active) {
      dash();
      e.preventDefault();
      return;
    }
    const now = performance.now();
    if (now - pointer.lastTap < 280) {
      dash();
    }
    pointer.lastTap = now;
    pointer.active = true;
    pointer.id = e.pointerId;
    pointer.isTouch = e.pointerType === "touch";
    movePointer(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointer.active && e.pointerId === pointer.id) movePointer(e);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((event) =>
    canvas.addEventListener(event, (e) => {
      if (e.pointerId === pointer.id) {
        pointer.active = false;
        pointer.id = null;
      }
    }),
  );
  window.addEventListener("blur", () => {
    keys.clear();
    pointer.active = false;
    pointer.id = null;
    resetJoystick();
    if (state === "playing") pause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") pause();
  });

  // Pendaftaran Service Worker agar game dapat dipasang & dimainkan offline di Android/iOS.
  if (
    "serviceWorker" in navigator &&
    (window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
  // Inisialisasi: tunggu gambar lengkap sebelum tombol mulai dapat digunakan.
  window.GameAudio.setMuted(muted);
  updateSoundButton();
  resize();
  renderRoute();
  syncHUD();
  requestAnimationFrame(frame);
  window.GameAssets.ready
    .then(() => {
      assetsReady = true;
      $("startButton").disabled = false;
      $("startLabel").textContent = "Mulai level 1";
    })
    .catch((error) => {
      $("overlayDescription").textContent =
        error.message + ". Pastikan folder assets ikut disalin.";
      $("startLabel").textContent = "Aset belum lengkap";
    });
})();

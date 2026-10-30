"use strict";

// Pengelola Leaderboard Otomatis (1 Perangkat = 1 Nama Pilot Permanen):
// - Nama pilot hanya diisi satu kali di awal permainan untuk perangkat tersebut.
// - Skor terbaik otomatis disinkronkan ke Leaderboard (Lokal & Global Online) tanpa tombol manual.
window.GameLeaderboard = (() => {
  const CFG = window.GameConfig.leaderboard || {};
  const STORAGE_KEY = "spaceExplorerLeaderboardV2";
  const LEGACY_STORAGE_KEY = "spaceExplorerLeaderboardV1";
  const PILOT_KEY = "spaceExplorerPilotNameLocked";
  const DEVICE_KEY = "spaceExplorerDeviceId";
  const MAX_ENTRIES = CFG.maxEntries || 10;

  function cleanPilotName(raw) {
    return String(raw || "")
      .replace(/[^\p{L}\p{N}\s._-]/gu, "")
      .trim()
      .slice(0, 14);
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id =
          "dev_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return "dev_local_session";
    }
  }

  let memoryPilotName = "";

  function getPilotName() {
    if (memoryPilotName) return memoryPilotName;
    try {
      const locked = cleanPilotName(localStorage.getItem(PILOT_KEY));
      if (locked) {
        memoryPilotName = locked;
        return locked;
      }
    } catch {}
    return "";
  }

  function hasPilotName() {
    return Boolean(getPilotName());
  }

  // Hanya mengizinkan pendaftaran nama pilot SEKALI untuk satu perangkat.
  function registerPilotOnce(rawName) {
    const existing = getPilotName();
    if (existing) return existing;
    const cleaned = cleanPilotName(rawName);
    if (!cleaned) return "";
    memoryPilotName = cleaned;
    try {
      localStorage.setItem(PILOT_KEY, cleaned);
      // Bersihkan data percobaan lama jika ada
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
    return cleaned;
  }

  function isFirebaseConfigured() {
    return Boolean(CFG.firebaseUrl && CFG.firebaseUrl.trim().startsWith("http"));
  }

  function isSupabaseConfigured() {
    return Boolean(
      CFG.supabaseUrl &&
        CFG.supabaseUrl.trim().startsWith("http") &&
        CFG.supabaseAnonKey &&
        CFG.supabaseAnonKey.trim(),
    );
  }

  function isOnlineConfigured() {
    return isFirebaseConfigured() || isSupabaseConfigured();
  }

  function normalizeEntries(list) {
    const byDevice = new Map();
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item || typeof item.score !== "number" || item.score <= 0) return;
      const name = cleanPilotName(item.name);
      if (!name) return;
      const devId = String(item.deviceId || "id_" + name.toLowerCase());
      const entry = {
        deviceId: devId,
        name,
        score: Math.floor(item.score),
        stage: String(item.stage || "Level 1").slice(0, 28),
        updatedAt: Number(item.updatedAt) || Date.now(),
      };
      const existing = byDevice.get(devId);
      if (
        !existing ||
        entry.score > existing.score ||
        (entry.score === existing.score && entry.updatedAt > existing.updatedAt)
      ) {
        byDevice.set(devId, entry);
      }
    });
    return [...byDevice.values()]
      .sort((a, b) => b.score - a.score || a.updatedAt - b.updatedAt)
      .slice(0, MAX_ENTRIES);
  }

  function getLocalEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return normalizeEntries(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  function saveLocalEntry(entry) {
    const current = getLocalEntries();
    const existing = current.find((item) => item.deviceId === entry.deviceId);
    if (existing && existing.score >= entry.score) {
      return current;
    }
    const merged = normalizeEntries([...current, entry]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {}
    return merged;
  }

  async function fetchFirebaseEntries() {
    const base = CFG.firebaseUrl.trim().replace(/\/+$/, "");
    const res = await fetch(`${base}/leaderboard.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== "object") return [];
    return normalizeEntries(Object.values(data));
  }

  async function submitFirebaseEntry(entry) {
    const base = CFG.firebaseUrl.trim().replace(/\/+$/, "");
    const key = encodeURIComponent(entry.deviceId);
    const url = `${base}/leaderboard/${key}.json`;
    try {
      const check = await fetch(url, { cache: "no-store" });
      if (check.ok) {
        const existing = await check.json();
        if (
          existing &&
          typeof existing.score === "number" &&
          existing.score >= entry.score
        ) {
          return;
        }
      }
    } catch {}
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function fetchSupabaseEntries() {
    const base = CFG.supabaseUrl.trim().replace(/\/+$/, "");
    const key = CFG.supabaseAnonKey.trim();
    const res = await fetch(
      `${base}/rest/v1/leaderboard?select=deviceId:pilot_id,name,score,stage,updatedAt&order=score.desc&limit=${MAX_ENTRIES}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return normalizeEntries(data);
  }

  async function submitSupabaseEntry(entry) {
    const base = CFG.supabaseUrl.trim().replace(/\/+$/, "");
    const key = CFG.supabaseAnonKey.trim();
    const res = await fetch(`${base}/rest/v1/leaderboard`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        pilot_id: entry.deviceId,
        name: entry.name,
        score: entry.score,
        stage: entry.stage,
        updatedAt: entry.updatedAt,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function fetchLeaderboard() {
    const local = getLocalEntries();
    if (!isOnlineConfigured()) {
      return { entries: local, mode: "local" };
    }
    try {
      const remote = isFirebaseConfigured()
        ? await fetchFirebaseEntries()
        : await fetchSupabaseEntries();
      const merged = normalizeEntries([...remote, ...local]);
      return { entries: merged, mode: "online" };
    } catch {
      return { entries: local, mode: "offline-fallback" };
    }
  }

  // Dipanggil otomatis oleh game saat skor naik / level selesai / game over.
  async function syncAutoScore({ score, stage }) {
    const pilotName = getPilotName();
    const numericScore = Math.max(0, Math.floor(Number(score) || 0));
    if (!pilotName || numericScore <= 0) return;
    const entry = {
      deviceId: getDeviceId(),
      name: pilotName,
      score: numericScore,
      stage: String(stage || "Orbit Kepler"),
      updatedAt: Date.now(),
    };
    saveLocalEntry(entry);
    if (isOnlineConfigured()) {
      try {
        if (isFirebaseConfigured()) await submitFirebaseEntry(entry);
        else if (isSupabaseConfigured()) await submitSupabaseEntry(entry);
      } catch {
        // Tetap aman di penyimpanan lokal saat offline.
      }
    }
  }

  return Object.freeze({
    cleanPilotName,
    getDeviceId,
    getPilotName,
    hasPilotName,
    registerPilotOnce,
    isOnlineConfigured,
    getLocalEntries,
    fetchLeaderboard,
    syncAutoScore,
  });
})();

"use strict";

// Pengelola Leaderboard Hibrida:
// 1. Mendukung Global Online via Firebase Realtime Database REST API atau Supabase REST API.
// 2. Otomatis menyimpan & melakukan fallback ke localStorage (Lokal) saat offline atau belum dikonfigurasi.
window.GameLeaderboard = (() => {
  const CFG = window.GameConfig.leaderboard || {};
  const STORAGE_KEY = "spaceExplorerLeaderboardV1";
  const PILOT_KEY = "spaceExplorerPilotName";
  const MAX_ENTRIES = CFG.maxEntries || 10;

  function cleanPilotName(raw) {
    const cleaned = String(raw || "")
      .replace(/[^\p{L}\p{N}\s._-]/gu, "")
      .trim()
      .slice(0, 14);
    return cleaned || "PILOT NOMAD";
  }

  function pilotId(name) {
    return (
      cleanPilotName(name)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || "pilot_nomad"
    );
  }

  function getPilotName() {
    try {
      return localStorage.getItem(PILOT_KEY) || "";
    } catch {
      return "";
    }
  }

  function setPilotName(name) {
    const cleaned = cleanPilotName(name);
    try {
      localStorage.setItem(PILOT_KEY, cleaned);
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
    const byPilot = new Map();
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item || typeof item.score !== "number" || item.score <= 0) return;
      const name = cleanPilotName(item.name);
      const key = pilotId(name);
      const entry = {
        name,
        score: Math.floor(item.score),
        stage: String(item.stage || "Level 1").slice(0, 28),
        updatedAt: Number(item.updatedAt) || Date.now(),
      };
      const existing = byPilot.get(key);
      if (
        !existing ||
        entry.score > existing.score ||
        (entry.score === existing.score && entry.updatedAt < existing.updatedAt)
      ) {
        byPilot.set(key, entry);
      }
    });
    return [...byPilot.values()]
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
    const merged = normalizeEntries([...getLocalEntries(), entry]);
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
    const key = encodeURIComponent(pilotId(entry.name));
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
      `${base}/rest/v1/leaderboard?select=name,score,stage,updatedAt&order=score.desc&limit=${MAX_ENTRIES}`,
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
        pilot_id: pilotId(entry.name),
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

  async function submitScore({ name, score, stage }) {
    const cleanName = setPilotName(name);
    const numericScore = Math.max(0, Math.floor(Number(score) || 0));
    if (numericScore <= 0) {
      return fetchLeaderboard();
    }
    const entry = {
      name: cleanName,
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
        // Tetap tersimpan secara lokal bila koneksi internet sedang terputus.
      }
    }
    return fetchLeaderboard();
  }

  return Object.freeze({
    cleanPilotName,
    getPilotName,
    setPilotName,
    isOnlineConfigured,
    getLocalEntries,
    fetchLeaderboard,
    submitScore,
  });
})();

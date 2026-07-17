// Per-puzzle progress persistence.
const KEY = 'fragmentsProgress_v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

export function loadProgress(puzzleId) {
  return readAll()[puzzleId] || null;
}

export function saveProgress(puzzleId, progress) {
  const all = readAll();
  all[puzzleId] = progress;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode etc. */ }
}

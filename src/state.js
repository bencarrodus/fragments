// Per-puzzle progress persistence.
// v2: the great level renumbering of 2026-07 reassigned which puzzle each
// level-N id refers to, so v1 saves would restore tiles onto the wrong boards.
const KEY = 'fragmentsProgress_v2';

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

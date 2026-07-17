import { createGame, render } from './board.js';
import { initDragDrop } from './dragdrop.js';
import { boardIsFull, checkWin } from './rules.js';
import { loadProgress, saveProgress } from './state.js';
import { shareText, fmtTime, copyToClipboard } from './share.js';

const HELP_SEEN_KEY = 'fragmentsHelpSeen_v1';

const boardEl = document.getElementById('board');
const bankEl = document.getElementById('bank');
const gameSection = document.getElementById('game');
const doneOverlay = document.getElementById('doneOverlay');
const levelsOverlay = document.getElementById('levelsOverlay');
const helpOverlay = document.getElementById('helpOverlay');

let levels = [];       // ordered puzzle ids from puzzles/index.json
let levelNum = 0;      // 1-based position of the current level
let game = null;
let attempts = 0;
let startedAt = null;
let finishedAt = null;
let clueUsed = false;
let hintsUsed = 0;
let hintPicking = false; // true while waiting for the player to tap a box to reveal
let countedSigs = new Set(); // full-board arrangements already counted as attempts

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function persist() {
  saveProgress(game.puzzle.id, {
    placements: game.serialize(),
    attempts, startedAt, finishedAt, clueUsed, hintsUsed, solved: game.solved,
  });
}

function rerender() {
  render(game, boardEl, bankEl);
  boardEl.parentElement.classList.toggle('board-solved', game.solved);
}

function boardSignature() {
  return game.rows.map((row, r) =>
    Array.from({ length: row.slots }, (_, i) => game.tileAt(r, i)?.text ?? '·').join('')
  ).join('|');
}

function onChange() {
  if (game.solved) return;
  if (startedAt === null) startedAt = Date.now();
  rerender();
  if (boardIsFull(game)) {
    if (checkWin(game)) return win();
    const sig = boardSignature();
    if (!countedSigs.has(sig)) { countedSigs.add(sig); attempts++; }
    boardEl.classList.remove('shake');
    void boardEl.offsetWidth; // restart the animation
    boardEl.classList.add('shake');
    toast('Not quite…');
  }
  persist();
}

function win() {
  game.solved = true;
  attempts++; // the winning arrangement counts as a try: flawless solve = "1 try"
  finishedAt = Date.now();
  persist();
  rerender();
  showDone();
}

function statsLine() {
  const tries = attempts === 1 ? '1 try' : `${attempts} tries`;
  const time = fmtTime((finishedAt ?? Date.now()) - (startedAt ?? Date.now()));
  const bits = [`${tries} · ${time}`];
  if (clueUsed) bits.push('💡 clue used');
  if (hintsUsed) bits.push(`🔎 ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}`);
  return bits.join(' · ');
}

function showDone() {
  const cat = document.getElementById('doneCategory');
  cat.innerHTML = 'The connection: <strong></strong>';
  cat.querySelector('strong').textContent = game.puzzle.category;
  document.getElementById('doneStats').textContent = statsLine();
  document.getElementById('nextLevelBtn').classList.toggle('hidden', levelNum >= levels.length);
  document.getElementById('shareFallback').classList.add('hidden');
  doneOverlay.classList.remove('hidden');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 1800);
}

// ---------- levels ----------

async function loadLevel(id) {
  const puzzle = await fetchJson(`./puzzles/${id}.json`);
  if (!puzzle.validated) console.warn('Fragments: puzzle is NOT validator-stamped — do not ship this.');
  exitHintPicking();
  game = createGame(puzzle);
  levelNum = levels.indexOf(id) + 1;
  attempts = 0; startedAt = null; finishedAt = null; clueUsed = false; hintsUsed = 0;
  countedSigs = new Set();

  const saved = loadProgress(id);
  if (saved) {
    game.restore(saved.placements);
    attempts = saved.attempts || 0;
    startedAt = saved.startedAt ?? null;
    finishedAt = saved.finishedAt ?? null;
    clueUsed = !!saved.clueUsed;
    hintsUsed = saved.hintsUsed || 0;
    game.solved = !!saved.solved;
  }

  document.getElementById('levelTag').textContent = `Level ${levelNum}`;
  doneOverlay.classList.add('hidden');
  rerender();
  if (game.solved) showDone();
}

function renderLevelList() {
  const list = document.getElementById('levelList');
  list.innerHTML = '';
  levels.forEach((id, i) => {
    const solved = !!loadProgress(id)?.solved;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'levelbtn' + (game?.puzzle.id === id ? ' current' : '');
    const label = document.createElement('span');
    label.textContent = `Level ${i + 1}`;
    const status = document.createElement('span');
    status.className = 'lvl-status' + (solved ? ' solved' : '');
    status.textContent = solved ? '✓ solved' : `${i + 1 === levelNum ? 'in play' : ''}`;
    btn.append(label, status);
    btn.addEventListener('click', async () => {
      levelsOverlay.classList.add('hidden');
      if (game?.puzzle.id !== id) await loadLevel(id);
    });
    list.appendChild(btn);
  });
}

// ---------- hints: reveal the correct fragment for a given board slot ----------
//
// The "correct" fragment for (row, idx) is read from the puzzle's own authored
// word list (theme for row 0, puzzle.words[row-1] otherwise) — that's *a* valid
// answer even though the any-match win rule would also accept a same-length
// word swapped into that row. `exclude` lets a caller solving several slots in
// one pass (the clue button) avoid reusing a tile it already placed or kept.
function solveSlot(row, idx, exclude) {
  const w = row === 0 ? game.puzzle.theme : game.puzzle.words[row - 1];
  const txt = w.slice(idx * 2, idx * 2 + 2);
  const cur = game.tileAt(row, idx);
  if (cur && cur.text === txt) { exclude?.add(cur.id); return true; }
  const cand =
    game.tiles.find(t => t.text === txt && !exclude?.has(t.id) && t.loc.type === 'bank') ||
    game.tiles.find(t => t.text === txt && !exclude?.has(t.id) &&
      !(t.loc.type === 'slot' && t.loc.row === row && t.loc.idx === idx));
  if (!cand) return false; // can't happen on a valid puzzle
  game.place(cand.id, row, idx);
  exclude?.add(cand.id);
  return true;
}

// clue: reveal the whole theme word (top row) in one go
function useClue() {
  if (!game || game.solved) return;
  exitHintPicking();
  const claimed = new Set();
  const frags = game.puzzle.theme.match(/../g);
  frags.forEach((_, i) => solveSlot(0, i, claimed));
  if (!clueUsed) { clueUsed = true; toast('Theme word revealed'); }
  onChange();
}

// hint: player picks one empty box, that one box gets solved
function enterHintPicking() {
  if (!game || game.solved || hintPicking) return;
  hintPicking = true;
  boardEl.classList.add('hint-picking');
  document.getElementById('hintBtn').classList.add('active');
  toast('Tap an empty box to reveal it');
}

function exitHintPicking() {
  hintPicking = false;
  boardEl.classList.remove('hint-picking');
  document.getElementById('hintBtn')?.classList.remove('active');
}

function useHintOnSlot(row, idx) {
  if (!game || game.solved) return;
  if (game.tileAt(row, idx)) { toast('Pick an empty box'); return; }
  if (!solveSlot(row, idx)) return;
  hintsUsed++;
  exitHintPicking();
  onChange();
}

// ---------- boot ----------

async function boot() {
  try {
    ({ levels } = await fetchJson('./puzzles/index.json'));
    if (!levels?.length) throw new Error('empty level index');
  } catch (err) {
    console.error(err);
    document.getElementById('loadError').classList.remove('hidden');
    return;
  }

  initDragDrop({ gameRef: () => game, boardEl, bankEl, onChange });

  document.getElementById('shareBtn').addEventListener('click', async () => {
    const text = shareText(levelNum, attempts, (finishedAt ?? Date.now()) - (startedAt ?? Date.now()), clueUsed, hintsUsed);
    const ok = await copyToClipboard(text);
    if (ok) { toast('Result copied!'); return; }
    // clipboard unavailable — show the text for manual copy
    const ta = document.getElementById('shareFallback');
    ta.value = text;
    ta.classList.remove('hidden');
    ta.select();
    toast('Copy it from the box below');
  });
  document.getElementById('closeDoneBtn').addEventListener('click', () =>
    doneOverlay.classList.add('hidden'));
  document.getElementById('nextLevelBtn').addEventListener('click', () => {
    const next = levels[levelNum]; // levelNum is 1-based, so this is the next id
    if (next) loadLevel(next);
  });

  document.getElementById('levelsBtn').addEventListener('click', () => {
    exitHintPicking();
    renderLevelList();
    levelsOverlay.classList.remove('hidden');
  });
  document.getElementById('closeLevelsBtn').addEventListener('click', () =>
    levelsOverlay.classList.add('hidden'));

  document.getElementById('clueBtn').addEventListener('click', useClue);
  document.getElementById('hintBtn').addEventListener('click', () => {
    if (hintPicking) exitHintPicking();
    else enterHintPicking();
  });

  // while picking, intercept board/bank taps before dragdrop's own handlers see them
  boardEl.addEventListener('pointerdown', e => {
    if (!hintPicking) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const slotEl = e.target.closest('.slot');
    if (!slotEl) return; // tapped empty space on the board — stay in picking mode
    useHintOnSlot(+slotEl.dataset.row, +slotEl.dataset.idx);
  }, { capture: true });
  bankEl.addEventListener('pointerdown', e => {
    if (!hintPicking) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    exitHintPicking();
    toast('Hint cancelled');
  }, { capture: true });

  document.getElementById('helpBtn').addEventListener('click', () => {
    exitHintPicking();
    helpOverlay.classList.remove('hidden');
  });
  document.getElementById('closeHelpBtn').addEventListener('click', () => {
    helpOverlay.classList.add('hidden');
    try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch { /* ignore */ }
  });

  // clicking an overlay backdrop closes it
  for (const ov of [levelsOverlay, helpOverlay, doneOverlay]) {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.add('hidden'); });
  }

  // start on the first unsolved level (level 1 for new players)
  const firstUnsolved = levels.find(id => !loadProgress(id)?.solved) || levels[0];
  try {
    await loadLevel(firstUnsolved);
  } catch (err) {
    console.error(err);
    document.getElementById('loadError').classList.remove('hidden');
    return;
  }
  gameSection.hidden = false;

  // first-time visitors get the how-to-play screen
  let helpSeen = false;
  try { helpSeen = !!localStorage.getItem(HELP_SEEN_KEY); } catch { /* ignore */ }
  if (!helpSeen) helpOverlay.classList.remove('hidden');
}

boot();

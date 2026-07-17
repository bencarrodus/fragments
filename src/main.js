import { createGame, render } from './board.js';
import { initDragDrop } from './dragdrop.js';
import { boardIsFull, checkWin } from './rules.js';
import { loadProgress, saveProgress } from './state.js';
import { shareText, fmtTime, copyToClipboard } from './share.js';
import { sfx } from './sfx.js';

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

function onChange(kind) {
  if (game.solved) return;
  if (startedAt === null) startedAt = Date.now();
  rerender();
  if (kind === 'place') sfx.place();
  else if (kind === 'remove') sfx.remove();
  if (boardIsFull(game)) {
    if (checkWin(game)) return win();
    const sig = boardSignature();
    if (!countedSigs.has(sig)) { countedSigs.add(sig); attempts++; }
    boardEl.classList.remove('shake');
    void boardEl.offsetWidth; // restart the animation
    boardEl.classList.add('shake');
    toast('Not quite…');
    sfx.wrong();
  }
  persist();
}

function win() {
  game.solved = true;
  attempts++; // the winning arrangement counts as a try: flawless solve = "1 try"
  finishedAt = Date.now();
  persist();
  rerender();
  sfx.win();
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
// Because same-length words are interchangeable between rows (any-match win
// rule), a row's "correct" word isn't fixed — a player may have legitimately
// started spelling a different same-length word than the one originally
// authored for that row. bestWordForRow reads whatever fragments are already
// placed and picks the intended word consistent with them, so a hint always
// continues what the player already started instead of contradicting it.

function rowStringIfFull(row) {
  let s = '';
  for (let i = 0; i < game.rows[row].slots; i++) {
    const t = game.tileAt(row, i);
    if (!t) return null;
    s += t.text;
  }
  return s;
}

function bestWordForRow(row) {
  if (row === 0) return game.puzzle.theme;
  const wordLen = game.rows[row].slots * 2;
  const usedElsewhere = new Set();
  game.rows.forEach((_, ri) => {
    if (ri === row || ri === 0) return;
    const s = rowStringIfFull(ri);
    if (s) usedElsewhere.add(s);
  });
  const candidates = game.puzzle.words.filter(w => w.length === wordLen && !usedElsewhere.has(w));
  const consistent = candidates.filter(w => {
    for (let i = 0; i < w.length / 2; i++) {
      const cur = game.tileAt(row, i);
      if (cur && cur.text !== w.slice(i * 2, i * 2 + 2)) return false;
    }
    return true;
  });
  if (!consistent.length) return game.puzzle.words[row - 1]; // shouldn't happen on a valid puzzle
  const authored = game.puzzle.words[row - 1];
  return consistent.includes(authored) ? authored : consistent[0];
}

// `exclude` lets a caller solving several slots in one pass (the clue button)
// avoid reusing a tile it already placed or kept.
function solveSlot(row, idx, exclude) {
  const w = bestWordForRow(row);
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
  sfx.reveal();
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
  sfx.reveal();
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

  const muteBtn = document.getElementById('muteBtn');
  muteBtn.textContent = sfx.isMuted() ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-pressed', String(sfx.isMuted()));
  muteBtn.addEventListener('click', () => {
    const m = sfx.toggleMuted();
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(m));
    if (!m) sfx.place(); // audible confirmation that sound is back on
  });

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

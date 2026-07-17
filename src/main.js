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
let countedSigs = new Set(); // full-board arrangements already counted as attempts

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function persist() {
  saveProgress(game.puzzle.id, {
    placements: game.serialize(),
    attempts, startedAt, finishedAt, clueUsed, solved: game.solved,
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
  return `${tries} · ${time}${clueUsed ? ' · 💡 clue used' : ''}`;
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
  game = createGame(puzzle);
  levelNum = levels.indexOf(id) + 1;
  attempts = 0; startedAt = null; finishedAt = null; clueUsed = false;
  countedSigs = new Set();

  const saved = loadProgress(id);
  if (saved) {
    game.restore(saved.placements);
    attempts = saved.attempts || 0;
    startedAt = saved.startedAt ?? null;
    finishedAt = saved.finishedAt ?? null;
    clueUsed = !!saved.clueUsed;
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

// ---------- clue: reveal the theme word in the top row ----------

function useClue() {
  if (!game || game.solved) return;
  const frags = game.puzzle.theme.match(/../g);
  const claimed = new Set();
  frags.forEach((txt, i) => {
    const cur = game.tileAt(0, i);
    if (cur && cur.text === txt && !claimed.has(cur.id)) { claimed.add(cur.id); return; }
    const cand =
      game.tiles.find(t => t.text === txt && !claimed.has(t.id) && t.loc.type === 'bank') ||
      game.tiles.find(t => t.text === txt && !claimed.has(t.id));
    if (!cand) return; // can't happen on a valid puzzle
    game.place(cand.id, 0, i);
    claimed.add(cand.id);
  });
  if (!clueUsed) { clueUsed = true; toast('Theme word revealed'); }
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
    const text = shareText(levelNum, attempts, (finishedAt ?? Date.now()) - (startedAt ?? Date.now()), clueUsed);
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
    renderLevelList();
    levelsOverlay.classList.remove('hidden');
  });
  document.getElementById('closeLevelsBtn').addEventListener('click', () =>
    levelsOverlay.classList.add('hidden'));

  document.getElementById('clueBtn').addEventListener('click', useClue);

  document.getElementById('helpBtn').addEventListener('click', () =>
    helpOverlay.classList.remove('hidden'));
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

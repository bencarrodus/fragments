// Game model + DOM rendering. The model is tiny: a list of tiles, each either
// in the bank or in a specific slot. Rendering rebuilds the board/bank DOM
// from the model after every change (the DOM is small enough that this is
// simpler and safer than incremental updates).

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(puzzle) {
  const words = [puzzle.theme, ...puzzle.words];
  const frags = [];
  for (const w of words) for (let i = 0; i < w.length; i += 2) frags.push(w.slice(i, i + 2));
  frags.push(...puzzle.decoys);

  // deterministic shuffle so every player sees the same bank layout
  const rand = mulberry32(puzzle.seed || 1);
  const order = frags.map((text, i) => ({ text, i }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const game = {
    puzzle,
    rows: words.map(w => ({ slots: w.length / 2 })),
    tiles: order.map((o, id) => ({ id, text: o.text, loc: { type: 'bank' } })),
    solved: false,

    tileAt(row, idx) {
      return this.tiles.find(t => t.loc.type === 'slot' && t.loc.row === row && t.loc.idx === idx) || null;
    },
    tile(id) { return this.tiles[id]; },

    // Move tile to a slot (swapping with any occupant) or back to the bank.
    place(tileId, row, idx) {
      const t = this.tile(tileId);
      const occupant = this.tileAt(row, idx);
      if (occupant && occupant.id !== tileId) occupant.loc = { ...t.loc };
      t.loc = { type: 'slot', row, idx };
    },
    toBank(tileId) { this.tile(tileId).loc = { type: 'bank' }; },

    serialize() {
      const placements = {};
      for (const t of this.tiles) if (t.loc.type === 'slot') placements[t.id] = [t.loc.row, t.loc.idx];
      return placements;
    },
    restore(placements) {
      for (const [id, [row, idx]] of Object.entries(placements || {})) {
        const t = this.tile(Number(id));
        if (t && row < this.rows.length && idx < this.rows[row].slots) t.loc = { type: 'slot', row, idx };
      }
    },
  };
  return game;
}

export function render(game, boardEl, bankEl) {
  boardEl.innerHTML = '';
  bankEl.innerHTML = '';
  game.rows.forEach((row, r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'row' + (r === 0 ? ' theme-row' : '');
    rowEl.setAttribute('aria-label', r === 0 ? 'Theme word' : `Word ${r}`);
    for (let i = 0; i < row.slots; i++) {
      const slotEl = document.createElement('div');
      slotEl.className = 'slot';
      slotEl.dataset.row = r;
      slotEl.dataset.idx = i;
      const t = game.tileAt(r, i);
      if (t) { slotEl.classList.add('filled'); slotEl.appendChild(tileEl(t, game)); }
      rowEl.appendChild(slotEl);
    }
    boardEl.appendChild(rowEl);
  });
  for (const t of game.tiles) if (t.loc.type === 'bank') bankEl.appendChild(tileEl(t, game));
}

function tileEl(t, game) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'tile';
  el.dataset.tileId = t.id;
  el.textContent = t.text;
  el.setAttribute('aria-label', `Fragment ${t.text}`);
  if (game.solved) el.disabled = true;
  return el;
}

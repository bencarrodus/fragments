// Runtime win check. Fires only when every slot is filled; reveals nothing
// per-row. Any-match policy: same-length theme words may sit in each other's
// rows, but the theme word must be in the top row and every intended answer
// used exactly once.

export function boardIsFull(game) {
  return game.rows.every((row, r) =>
    Array.from({ length: row.slots }, (_, i) => game.tileAt(r, i)).every(Boolean));
}

export function rowString(game, r) {
  let s = '';
  for (let i = 0; i < game.rows[r].slots; i++) {
    const t = game.tileAt(r, i);
    if (!t) return null;
    s += t.text;
  }
  return s;
}

export function checkWin(game) {
  const top = rowString(game, 0);
  if (top !== game.puzzle.theme) return false;
  const others = [];
  for (let r = 1; r < game.rows.length; r++) {
    const s = rowString(game, r);
    if (s === null) return false;
    others.push(s);
  }
  const a = [...others].sort();
  const b = [...game.puzzle.words].sort();
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

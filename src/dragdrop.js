// Pointer-based drag & drop plus tap-to-place. The native HTML5 drag API is
// unusable on mobile, so this uses Pointer Events for mouse + touch alike.
//
// Interactions:
//  - drag a tile (from bank or slot) onto a slot: place/swap; onto the bank
//    area: return to bank; anywhere else: snap back
//  - tap a bank tile: select it; tap a slot: place the selection
//  - tap a placed tile: return it to the bank

const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

export function initDragDrop({ gameRef, boardEl, bankEl, onChange }) {
  let selected = null; // tile id chosen by tap, awaiting a slot tap

  function clearSelection() {
    selected = null;
    document.querySelectorAll('.tile.selected').forEach(el => el.classList.remove('selected'));
  }

  function handleTap(tileId) {
    const game = gameRef();
    const t = game.tile(tileId);
    if (t.loc.type === 'slot') {         // tap a placed tile → back to bank
      clearSelection();
      game.toBank(tileId);
      onChange('remove');
      return;
    }
    if (selected === tileId) { clearSelection(); return; }
    clearSelection();
    selected = tileId;
    document.querySelector(`.tile[data-tile-id="${tileId}"]`)?.classList.add('selected');
  }

  function handleSlotTap(row, idx) {
    if (selected === null) return;
    const game = gameRef();
    const id = selected;
    clearSelection();
    game.place(id, row, idx);
    onChange('place');
  }

  function onPointerDown(e) {
    const game = gameRef();
    if (game.solved) return;
    const tileTarget = e.target.closest('.tile');
    if (!tileTarget) {
      const slotTarget = e.target.closest('.slot');
      if (slotTarget) handleSlotTap(+slotTarget.dataset.row, +slotTarget.dataset.idx);
      else clearSelection();
      return;
    }
    e.preventDefault();
    const tileId = +tileTarget.dataset.tileId;
    const startX = e.clientX, startY = e.clientY;
    let ghost = null;
    let currentTarget = null;

    function markTarget(el) {
      if (currentTarget === el) return;
      currentTarget?.classList.remove('droptarget');
      currentTarget = el;
      currentTarget?.classList.add('droptarget');
    }

    function under(e2) {
      ghost.style.display = 'none';
      const el = document.elementFromPoint(e2.clientX, e2.clientY);
      ghost.style.display = '';
      return el;
    }

    function onMove(e2) {
      if (!ghost) {
        if (Math.hypot(e2.clientX - startX, e2.clientY - startY) < DRAG_THRESHOLD) return;
        clearSelection();
        ghost = tileTarget.cloneNode(true);
        ghost.classList.add('ghost');
        document.body.appendChild(ghost);
        tileTarget.classList.add('drag-hidden');
      }
      ghost.style.left = `${e2.clientX - ghost.offsetWidth / 2}px`;
      ghost.style.top = `${e2.clientY - ghost.offsetHeight / 2}px`;
      const el = under(e2);
      markTarget(el?.closest('.slot') || (el?.closest('#bankwrap') ? bankEl : null));
    }

    function onUp(e2) {
      tileTarget.removeEventListener('pointermove', onMove);
      tileTarget.removeEventListener('pointerup', onUp);
      tileTarget.removeEventListener('pointercancel', onUp);
      currentTarget?.classList.remove('droptarget');
      if (!ghost) {                       // no movement → it was a tap
        if (e2.type !== 'pointercancel') handleTap(tileId);
        return;
      }
      const el = under(e2);
      ghost.remove();
      tileTarget.classList.remove('drag-hidden');
      if (e2.type === 'pointercancel') return;
      const slotEl = el?.closest('.slot');
      const game2 = gameRef();
      if (slotEl) {
        game2.place(tileId, +slotEl.dataset.row, +slotEl.dataset.idx);
        onChange('place');
      } else if (el?.closest('#bankwrap')) {
        if (game2.tile(tileId).loc.type === 'slot') { game2.toBank(tileId); onChange('remove'); }
      }
      // dropped elsewhere: model unchanged, tile snaps back visually
    }

    try { tileTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    tileTarget.addEventListener('pointermove', onMove);
    tileTarget.addEventListener('pointerup', onUp);
    tileTarget.addEventListener('pointercancel', onUp);
  }

  boardEl.addEventListener('pointerdown', onPointerDown);
  bankEl.addEventListener('pointerdown', onPointerDown);
  return { clearSelection };
}

// Share text à la Wordle — no per-row history exists (the game only judges
// full boards), so the result is attempts + time.

export function shareText(levelNum, attempts, ms, clueUsed) {
  const tries = attempts === 1 ? '1 try' : `${attempts} tries`;
  return `🧩 Fragments — Level ${levelNum}\nSolved in ${tries} · ${fmtTime(ms)}${clueUsed ? ' · 💡 clue used' : ''}`;
}

export function fmtTime(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

// Sound effects, synthesized at runtime via WebAudio — no audio files.
// The AudioContext is created lazily inside the first play call, which always
// happens within a user-gesture handler, satisfying mobile autoplay policies.

const MUTE_KEY = 'fragmentsMuted_v1';

let ctx = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { at = 0, dur = 0.08, type = 'sine', gain = 0.06, slide = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  isMuted: () => muted,
  toggleMuted() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
    return muted;
  },
  place() { if (!muted) tone(520, { dur: 0.07, gain: 0.05, slide: 140 }); },
  remove() { if (!muted) tone(340, { dur: 0.07, gain: 0.04, slide: -80 }); },
  reveal() {
    if (muted) return;
    tone(660, { dur: 0.09, gain: 0.05 });
    tone(880, { at: 0.07, dur: 0.12, gain: 0.05 });
  },
  wrong() {
    if (muted) return;
    tone(160, { dur: 0.16, type: 'square', gain: 0.035 });
    tone(120, { at: 0.14, dur: 0.2, type: 'square', gain: 0.035 });
  },
  win() {
    if (muted) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.16, gain: 0.06 }));
    tone(1319, { at: 0.36, dur: 0.3, gain: 0.05 });
  },
};

#!/usr/bin/env node
// Fragments puzzle validator.
//
// Guarantees (Check B) that a puzzle has exactly ONE canonical solution:
// an assignment of real dictionary words to every row (theme word in the
// top row, one word per theme row) whose combined bigram multiset fits
// inside the fragment pool (intended fragments + decoys). Same-length
// theme words are interchangeable between their rows, so a solution is
// canonicalized as (theme word, sorted list of other words).
//
// Usage:
//   node tools/validate.mjs <puzzle.json> [--no-stamp]
//   node tools/validate.mjs --test
//   node tools/validate.mjs --suggest-decoys <puzzle.json> [--count N]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_VERSION = 'validate.mjs@1';
const HERE = dirname(fileURLToPath(import.meta.url));
const DICT_DIR = join(HERE, 'dict');
const SOLUTION_LIMIT = 100; // cap enumeration in pathological cases

// ---------- multiset helpers (Map<string, count>) ----------

function msFrom(items) {
  const m = new Map();
  for (const it of items) m.set(it, (m.get(it) || 0) + 1);
  return m;
}
function msClone(m) { return new Map(m); }
function msFits(needed, pool) {
  for (const [k, n] of needed) if ((pool.get(k) || 0) < n) return false;
  return true;
}
function msSubtract(pool, needed) { // in place; assumes fits
  for (const [k, n] of needed) {
    const left = pool.get(k) - n;
    if (left === 0) pool.delete(k); else pool.set(k, left);
  }
}
function msAdd(pool, needed) { // in place
  for (const [k, n] of needed) pool.set(k, (pool.get(k) || 0) + n);
}

// ---------- words / bigrams ----------

export function bigrams(word) {
  if (word.length % 2 !== 0) throw new Error(`odd-length word: ${word}`);
  const out = [];
  for (let i = 0; i < word.length; i += 2) out.push(word.slice(i, i + 2));
  return out;
}

function loadDict(file) {
  const set = new Set();
  const text = readFileSync(join(DICT_DIR, file), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().toUpperCase();
    if (w && /^[A-Z]+$/.test(w)) set.add(w);
  }
  return set;
}

let dictCache = null;
export function dicts() {
  if (!dictCache) {
    const enable = loadDict('enable1.txt');
    const alpha = loadDict('words_alpha.txt');
    dictCache = { enable, alpha, label: `enable1 (${enable.size}) + words_alpha (${alpha.size})` };
  }
  return dictCache;
}

// ---------- puzzle loading + Check A (structure) ----------

function loadPuzzle(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function checkStructure(p) {
  const errs = [];
  const wordRe = /^[A-Z]+$/;
  if (!p.theme || typeof p.theme !== 'string') errs.push('missing "theme"');
  if (!Array.isArray(p.words) || p.words.length === 0) errs.push('missing/empty "words"');
  if (!Array.isArray(p.decoys)) errs.push('missing "decoys" (use [] for none)');
  if (errs.length) return errs;
  for (const w of [p.theme, ...p.words]) {
    if (!wordRe.test(w)) errs.push(`word "${w}" must be uppercase A-Z only`);
    else if (w.length % 2 !== 0) errs.push(`word "${w}" has odd length ${w.length} — every word must split into 2-letter fragments`);
    else if (w.length < 4) errs.push(`word "${w}" is shorter than 4 letters`);
  }
  for (const d of p.decoys) {
    if (!wordRe.test(d) || d.length !== 2) errs.push(`decoy "${d}" must be exactly 2 uppercase letters`);
  }
  const seen = new Set();
  for (const w of [p.theme, ...p.words]) {
    if (seen.has(w)) errs.push(`duplicate word "${w}"`);
    seen.add(w);
  }
  return errs;
}

function fragmentPool(p) {
  const frags = [];
  for (const w of [p.theme, ...p.words]) frags.push(...bigrams(w));
  frags.push(...p.decoys);
  return msFrom(frags);
}

// ---------- Check B: exact-cover solution enumeration ----------

// Words of `len` from `dictSet` whose bigram multiset fits in `pool`.
function candidatesFor(len, dictSet, pool, byLenCache) {
  let ofLen = byLenCache.get(dictSet);
  if (!ofLen) { ofLen = new Map(); byLenCache.set(dictSet, ofLen); }
  let words = ofLen.get(len);
  if (!words) {
    words = [];
    for (const w of dictSet) if (w.length === len) words.push(w);
    ofLen.set(len, words);
  }
  const out = [];
  for (const w of words) if (msFits(msFrom(bigrams(w)), pool)) out.push(w);
  return out;
}

const byLenCache = new Map(); // dictSet -> Map<len, words[]>

// Enumerate canonical solutions: { theme, words: sorted[] }.
// extraCandidates: optional Map<len, words[]> unioned into candidate sets
// (used by decoy suggestion's incremental near-miss trick is not needed at
// this scale; we just recompute).
export function enumerateSolutions(p, dictSet, { limit = SOLUTION_LIMIT } = {}) {
  const pool = fragmentPool(p);
  // group non-theme rows by length
  const lenCounts = new Map();
  for (const w of p.words) lenCounts.set(w.length, (lenCounts.get(w.length) || 0) + 1);

  const groups = [{ kind: 'theme', len: p.theme.length, count: 1 }];
  for (const [len, count] of lenCounts) groups.push({ kind: 'words', len, count });
  for (const g of groups) g.cands = candidatesFor(g.len, dictSet, pool, byLenCache).sort();
  // fewest candidates first for pruning
  groups.sort((a, b) => a.cands.length - b.cands.length);

  const solutions = [];
  const picked = []; // {kind, word}

  function dfs(gi, pool) {
    if (solutions.length >= limit) return;
    if (gi === groups.length) {
      const theme = picked.find(x => x.kind === 'theme').word;
      const words = picked.filter(x => x.kind === 'words').map(x => x.word).sort();
      solutions.push({ theme, words });
      return;
    }
    const g = groups[gi];
    // choose g.count words from g.cands as a non-decreasing index sequence
    // (multiset choice — permutations of same-length rows are one solution)
    function pickInGroup(startIdx, left) {
      if (solutions.length >= limit) return;
      if (left === 0) { dfs(gi + 1, pool); return; }
      for (let i = startIdx; i < g.cands.length; i++) {
        const need = msFrom(bigrams(g.cands[i]));
        if (!msFits(need, pool)) continue;
        msSubtract(pool, need);
        picked.push({ kind: g.kind, word: g.cands[i] });
        pickInGroup(i, left - 1); // i (not i+1): same word twice is allowed if pool supports it
        picked.pop();
        msAdd(pool, need);
      }
    }
    pickInGroup(0, g.count);
  }

  dfs(0, msClone(pool));
  return solutions;
}

function canonicalIntended(p) {
  return { theme: p.theme, words: [...p.words].sort() };
}
function sameSolution(a, b) {
  return a.theme === b.theme && a.words.length === b.words.length &&
    a.words.every((w, i) => w === b.words[i]);
}
function fmtSolution(s) {
  return `theme=${s.theme}  words=[${s.words.join(', ')}]`;
}

// ---------- Check C: decoy plausibility ----------

function affixSets() {
  const { enable } = dicts();
  const pre4 = new Set(), suf4 = new Set();
  for (const w of enable) {
    if (w.length >= 5) { pre4.add(w.slice(0, 4)); suf4.add(w.slice(-4)); }
  }
  return { pre4, suf4 };
}

function decoyScore(d, realFrags, { pre4, suf4 }) {
  let score = 0;
  for (const f of realFrags) {
    if (pre4.has(d + f) || pre4.has(f + d)) score++;
    if (suf4.has(d + f) || suf4.has(f + d)) score++;
  }
  return score;
}

// ---------- validation driver ----------

export function validate(p, { verbose = true } = {}) {
  const log = verbose ? console.log : () => {};
  const result = { pass: true, errors: [], warnings: [], info: [] };
  const fail = m => { result.pass = false; result.errors.push(m); };
  const warn = m => result.warnings.push(m);
  const info = m => result.info.push(m);

  // Check A
  const structErrs = checkStructure(p);
  if (structErrs.length) {
    structErrs.forEach(fail);
    return finish();
  }

  const { enable, alpha } = dicts();
  const intended = [p.theme, ...p.words];

  for (const w of intended) {
    if (!enable.has(w)) {
      (alpha.has(w) ? info : warn)(
        `intended word "${w}" is not in ENABLE1${alpha.has(w) ? ' (but is in words_alpha)' : ' or words_alpha — is it a real word?'}`);
    }
  }

  // Check B — strict tier: ENABLE1 ∪ intended words
  const strictDict = new Set(enable);
  for (const w of intended) strictDict.add(w);
  const strictSols = enumerateSolutions(p, strictDict);
  const intendedSol = canonicalIntended(p);

  if (!strictSols.some(s => sameSolution(s, intendedSol))) {
    fail('intended solution was not found by the solver — internal inconsistency (report this)');
  }
  const strictAlts = strictSols.filter(s => !sameSolution(s, intendedSol));
  if (strictAlts.length) {
    if (p.words.some(w => w.length === p.theme.length)) {
      fail(`theme word "${p.theme}" (${p.theme.length}) shares its length with a theme word — the two can always be swapped between rows, so no such puzzle can be unique. Pick a theme word whose length differs from every theme word.`);
    }
    fail(`${strictAlts.length}${strictSols.length >= SOLUTION_LIMIT ? '+' : ''} alternate solution(s) exist using real (ENABLE1) words:`);
    for (const s of strictAlts) {
      const diff = [s.theme, ...s.words].filter(w => !intended.includes(w));
      result.errors.push(`    ${fmtSolution(s)}   [differs by: ${diff.join(', ') || 'theme/word swap only'}]`);
    }
  }

  // Check B — paranoid tier: + words_alpha
  const paranoidDict = new Set(strictDict);
  for (const w of alpha) paranoidDict.add(w);
  const paranoidSols = enumerateSolutions(p, paranoidDict);
  const paranoidAlts = paranoidSols.filter(
    s => !sameSolution(s, intendedSol) && !strictAlts.some(a => sameSolution(a, s)));
  if (paranoidAlts.length) {
    warn(`${paranoidAlts.length} alternate solution(s) exist only under the paranoid (words_alpha) dictionary — eyeball these:`);
    for (const s of paranoidAlts) {
      const junk = [s.theme, ...s.words].filter(w => !enable.has(w) && !intended.includes(w));
      result.warnings.push(`    ${fmtSolution(s)}   [non-ENABLE1 words: ${junk.join(', ')}]`);
    }
  }

  // Check C — decoy plausibility (soft)
  if (p.decoys.length) {
    const affix = affixSets();
    const realFrags = [...new Set(intended.flatMap(bigrams))];
    for (const d of p.decoys) {
      if (decoyScore(d, realFrags, affix) === 0) {
        warn(`decoy "${d}" looks implausible — it forms no word-like prefix/suffix with any real fragment`);
      }
    }
  }

  return finish();

  function finish() {
    log(`\n== Fragments validator — ${p.id || '(no id)'} ==`);
    if (!structErrs?.length && result.pass) {
      log(`  theme: ${p.theme}  words: [${p.words.join(', ')}]  decoys: [${p.decoys.join(', ')}]`);
      log(`  pool: ${[...fragmentPool(p).entries()].map(([f, n]) => n > 1 ? `${f}x${n}` : f).join(' ')}`);
    }
    for (const e of result.errors) log(`  ✗ ${e}`);
    for (const w of result.warnings) log(`  ⚠ ${w}`);
    for (const i of result.info) log(`  · ${i}`);
    log(result.pass ? '  PASS — exactly one solution (strict dictionary).' : '  FAIL');
    return result;
  }
}

// ---------- stamping ----------

function contentHash(p) {
  return createHash('sha256')
    .update(JSON.stringify({ theme: p.theme, words: p.words, decoys: p.decoys }))
    .digest('hex').slice(0, 16);
}

function stamp(file, p) {
  const out = {
    id: p.id, category: p.category, theme: p.theme, words: p.words,
    decoys: p.decoys, seed: p.seed,
    validated: {
      tool: TOOL_VERSION, dict: dicts().label,
      at: new Date().toISOString(), hash: contentHash(p),
    },
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`  stamped: ${file}`);
}

// ---------- decoy suggestion ----------

// Greedily pick a JOINTLY-safe decoy set. Individually-safe decoys can
// combine into alternate words (e.g. TH+EN+AR = THENAR), so each pick is
// re-screened against the pool including all previously chosen decoys —
// after every step the puzzle is still strict-unique, so the final set is
// safe by induction. The full validator run remains the source of truth.
function suggestDecoys(p, count) {
  const { enable, alpha } = dicts();
  const affix = affixSets();
  const intended = [p.theme, ...p.words];
  const realFrags = [...new Set(intended.flatMap(bigrams))];

  const strictDict = new Set(enable);
  for (const w of intended) strictDict.add(w);

  // frequency of aligned bigrams across even-length ENABLE1 words (plausibility prior)
  const freq = new Map();
  for (const w of enable) {
    if (w.length % 2 || w.length < 4) continue;
    for (const b of bigrams(w)) freq.set(b, (freq.get(b) || 0) + 1);
  }

  // paranoid uniqueness implies strict uniqueness (strict ⊂ paranoid), so
  // screening against the paranoid dictionary keeps the warning tier quiet too
  const paranoidDict = new Set(strictDict);
  for (const w of alpha) paranoidDict.add(w);
  const uniqueWith = (dictSet, decoys, d) => {
    const trial = { ...p, decoys: [...decoys, d] };
    return enumerateSolutions(trial, dictSet, { limit: 2 }).length === 1;
  };

  console.log(`\nScreening 676 candidate decoys for ${p.id || p.theme} (existing decoys: [${p.decoys.join(', ')}])...`);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const shortlist = [];
  for (const a of letters) for (const b of letters) {
    const d = a + b;
    if (p.decoys.includes(d)) continue;
    const score = decoyScore(d, realFrags, affix);
    if (score === 0) continue; // implausible (Check C would warn)
    if (!uniqueWith(paranoidDict, p.decoys, d)) continue;
    shortlist.push({ d, score, freq: freq.get(d) || 0 });
  }
  shortlist.sort((x, y) => y.score - x.score || y.freq - x.freq);
  console.log(`  ${shortlist.length} individually paranoid-safe, plausible candidates.`);

  const chosen = [];
  while (chosen.length < count) {
    const next = shortlist.find(r => !chosen.includes(r.d) && uniqueWith(paranoidDict, [...p.decoys, ...chosen], r.d));
    if (next) {
      chosen.push(next.d);
      console.log(`  picked ${next.d}   plausibility=${next.score}  bigram-freq=${next.freq}`);
      continue;
    }
    // fall back to strict-only safety (words_alpha warnings possible)
    const fallback = shortlist.find(r => !chosen.includes(r.d) && uniqueWith(strictDict, [...p.decoys, ...chosen], r.d));
    if (!fallback) { console.log('  (no further jointly-safe candidates)'); break; }
    chosen.push(fallback.d);
    console.log(`  picked ${fallback.d}   plausibility=${fallback.score}  bigram-freq=${fallback.freq}  ⚠ strict-safe only — expect words_alpha warnings`);
  }

  console.log(`\n  suggested "decoys": ${JSON.stringify([...p.decoys, ...chosen])}`);
  console.log('  (put this in the puzzle JSON, then run the full validator to stamp)');
}

// ---------- fixture test runner ----------

function runTests() {
  const fixDir = join(HERE, 'fixtures');
  const manifest = JSON.parse(readFileSync(join(fixDir, 'manifest.json'), 'utf8'));
  let failed = 0;
  for (const t of manifest) {
    const p = loadPuzzle(join(fixDir, t.file));
    const r = validate(p, { verbose: false });
    const problems = [];
    if (t.expect === 'pass' && !r.pass) problems.push(`expected PASS, got FAIL: ${r.errors[0] || ''}`);
    if (t.expect === 'fail' && r.pass) problems.push('expected FAIL, got PASS');
    for (const needle of t.mustReport || []) {
      const all = [...r.errors, ...r.warnings].join('\n');
      if (!all.includes(needle)) problems.push(`expected report to mention "${needle}"`);
    }
    if (t.expectWarning && r.warnings.length === 0) problems.push('expected at least one warning');
    if (problems.length) {
      failed++;
      console.log(`✗ ${t.file} — ${t.description}`);
      problems.forEach(m => console.log(`    ${m}`));
      if (r.errors.length) console.log(`    reported: ${r.errors.join(' | ')}`);
    } else {
      console.log(`✓ ${t.file} — ${t.description}`);
    }
  }
  console.log(failed ? `\n${failed} fixture(s) FAILED` : `\nAll ${manifest.length} fixtures passed.`);
  process.exit(failed ? 1 : 0);
}

// ---------- CLI ----------

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
if (!isMain) {
  // imported as a library — skip CLI
} else if (args[0] === '--test') {
  runTests();
} else if (args[0] === '--suggest-decoys') {
  const file = args[1];
  if (!file) { console.error('usage: validate.mjs --suggest-decoys <puzzle.json> [--count N]'); process.exit(2); }
  const n = args.includes('--count') ? parseInt(args[args.indexOf('--count') + 1], 10) : 4;
  suggestDecoys(loadPuzzle(file), n);
} else if (args[0] && !args[0].startsWith('--')) {
  const file = args[0];
  const p = loadPuzzle(file);
  const r = validate(p);
  if (r.pass && !args.includes('--no-stamp')) stamp(file, p);
  process.exit(r.pass ? 0 : 1);
} else {
  console.log('usage:\n  validate.mjs <puzzle.json> [--no-stamp]\n  validate.mjs --test\n  validate.mjs --suggest-decoys <puzzle.json> [--count N]');
  process.exit(2);
}

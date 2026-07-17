# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

"Fragments" — a daily word puzzle game. Players drag 2-letter fragments from a shuffled bank into slot rows to rebuild hidden theme words plus a top-row "theme word" naming their category. No per-row feedback: the board is judged only when every slot is filled (win, or a generic shake). Same-length theme words are accepted in each other's rows. A 💡 clue button auto-places the theme word (flagged in the share text), a ☰ levels menu switches puzzles, and a ? help overlay auto-opens for first-time visitors.

Plain HTML/CSS/vanilla JS, no build system, no package manager, no dependencies. Deployed as a static site to Vercel — `index.html` sits at the repo root so no rewrites are needed.

## Running locally

The game fetches puzzle JSON at load time, so opening `index.html` directly (`file://`) will NOT work — browsers block `fetch()` on the file protocol. Run it through the bundled zero-dependency server instead:

```
node tools/serve.mjs
```

then open `http://localhost:4173/` (Node is at `C:\Program Files\nodejs\node.exe` if not on PATH). The `.claude/launch.json` `fragments` config does the same thing.

There are no lint, build, or test commands for the game itself — changes are verified by playing it in a browser. The puzzle *validator* does have a test suite (see below).

## Architecture

- `index.html` + `style.css` — page shell and styling (CSS variables for light/dark theme).
- `src/` — ES modules: `main.js` (boot/orchestration, level loading, clue logic, help/levels overlays), `board.js` (game model + DOM render, deterministic seeded bank shuffle), `dragdrop.js` (Pointer-Events drag + tap-to-place, works for mouse and touch), `rules.js` (whole-board-only win check, any-match row policy), `state.js` (localStorage persistence, per-puzzle-id), `share.js` (Wordle-style share text + clipboard).
- `puzzles/` — per-level JSON (`level-N.json`), ordered easiest-first by the `levels` array in `puzzles/index.json`. The game boots into the first unsolved level. Early levels use literal theme words (VEGETABLES over vegetables), later ones oblique (SPECTRUM over colors).
- `tools/` — the offline puzzle validator and its dictionaries/tests (not shipped to the client).

## Puzzle validity is the load-bearing invariant

Every puzzle JSON must be stamped by the offline validator, which guarantees **exactly ONE solution** against a real dictionary — this is the hardest part of the project and is treated as such. See `tools/AUTHORING.md` for the full authoring loop and hard rules (even-length words only; theme word length must differ from every theme word's length). **Never commit a puzzle the validator didn't stamp.**

- `node tools/validate.mjs <puzzle.json>` — validates + stamps.
- `node tools/validate.mjs --suggest-decoys <puzzle.json> --count N` — greedy jointly-safe decoy picking (individually-safe decoys can still combine into an alternate solution; this screens the whole set together).
- `node tools/validate.mjs --test` — runs the fixture suite in `tools/fixtures/`. **Run this after ANY change to `validate.mjs`.** The fixtures include deliberately-broken puzzles (planted duplicate solutions, decoy-completed words, theme anagrams) that MUST fail, and clean ones that MUST pass — this is what earns trust in the uniqueness guarantee, not eyeballing output.
- Dictionaries live in `tools/dict/`: ENABLE1 (~173k words) is the strict tier — an alternate solution here is a hard rejection. `words_alpha` (~370k, noisier) is the paranoid warning tier — alternates found only here are reported but don't block a stamp.

## Testing gameplay logic changes

Because there's no game test harness, verifying logic changes (win detection, any-match row policy, attempt counting, clue placement) is easiest by driving the UI through browser tooling: dispatch synthetic `PointerEvent`s (`pointerdown`/`pointermove`/`pointerup`) at bank tiles and slot elements to simulate drag/tap placement, then inspect `localStorage.fragmentsProgress_v1` and the DOM for the expected result. This avoids fighting real pointer-capture/animation timing.

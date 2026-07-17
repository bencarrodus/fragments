# Authoring Fragments puzzles

Every puzzle ships as one JSON file in `puzzles/`, named `level-N.json`, and
must be listed (in play order, easiest first) in the `levels` array of `puzzles/index.json`.
**Never commit a puzzle the validator didn't stamp.**

Difficulty levers: how literal the theme word is (VEGETABLES over vegetables is easy;
SPECTRUM over colors is oblique), and how many decoys (2 = gentle, 4-5 = mean).

## Hard rules (the validator enforces these)

1. **Even lengths only.** Every word — theme words and the theme word — must have
   an even number of letters (fragments are strictly 2 letters). No 5- or 7-letter words.
2. **Theme word length must differ from every theme word's length.** If it matches one,
   the two can always be swapped between rows, so the puzzle can't be unique.
3. Words are uppercase A–Z, at least 4 letters, no duplicates.
4. **Exactly one solution** must exist against the strict dictionary (ENABLE1 + your
   intended words). Alternates are listed in the FAIL report — usually you fix them by
   swapping out the word that shares too many common bigrams.

## The loop

```
# 1. Write the puzzle with an empty decoy list
{ "id": "level-5", "category": "...", "theme": "...", "words": [...], "decoys": [], "seed": 105 }

# 2. Check the core words are unique on their own
node tools/validate.mjs puzzles/level-5.json --no-stamp

# 3. Let the tool pick a jointly-safe decoy set (takes ~30s)
node tools/validate.mjs --suggest-decoys puzzles/level-5.json --count 4

# 4. Paste the suggested "decoys" array into the JSON, then validate + stamp
node tools/validate.mjs puzzles/level-5.json

# 5. Add "level-5" to the levels array in puzzles/index.json
```

The stamp (`validated` block) is written into the file on PASS. Editing theme/words/decoys
after stamping invalidates it morally — re-run the validator after any change.

## Reading the output

- `✗ FAIL` + alternate list — a real (ENABLE1) alternate solution exists. Not shippable.
  The `differs by:` note names the offending words; replace one of your words whose
  fragments feed that alternate, or drop the decoy involved.
- `⚠ words_alpha warnings` — alternates that only exist using junk/obscure words from
  the 370k-word paranoid list. Shippable at your discretion; players essentially never
  construct these, but glance at the list. `--suggest-decoys` avoids creating them.
- `· info` — e.g. an intended word missing from ENABLE1 (it's auto-allowed, but make
  sure it's really a word).

## Design tips (learned from the validator, not enforced)

- 6- and 8-letter words survive uniqueness checks far better than 4-letter words —
  short words with common bigrams (RE, ED, AL, LE...) get rejected constantly.
- A word with at least one uncommon bigram (LV, GZ, YQ...) anchors its row.
- 5–7 theme words + 3–5 decoys is the sweet spot; more decoys = harder + riskier.
- Decoys that duplicate a real fragment (e.g. a second GO when INDIGO is in play)
  are legal, safe, and delightfully mean.

## Fixture suite (validator self-test)

```
node tools/validate.mjs --test
```

Run this after any change to `validate.mjs`. The fixtures in `tools/fixtures/` include
deliberately broken puzzles (planted duplicate solutions, decoy-completed words, theme
anagrams) that MUST fail, and clean ones that MUST pass — this is what earns trust in
the "exactly one solution" guarantee.

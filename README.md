# Zork — Assist Mode

Play the original Infocom classics **Zork I**, **Zork II** and **Zork III** in your browser,
built from the official open-source ZIL releases, with an **Assist Mode**
sidebar of graduated, multiple-choice hints, an auto-map and a full
walkthrough for when you get stuck. Pick the game with the **Zork I / II / III**
switch at the top of the page (or link straight to one with `?game=zork2` or `?game=zork3`);
each game keeps its own autosave, map and walkthrough progress.

Play the game at [https://pataltimore.github.io/zork-assist-mode/](https://pataltimore.github.io/zork-assist-mode/).

- **Real games, not clones.** Zork I is the historicalsource/zork1 ZIL source
  compiled with [ZILF](https://foss.heptapod.net/zilf/zilf); Zork II and Zork III are the
  compiled story files Infocom's own build produced, shipped in the
  historicalsource/zork2 and historicalsource/zork3 repositories. All are real Z-machine story files played with
  the same engine family
  ([ifvms.js](https://github.com/curiousdannii/ifvms.js) +
  [GlkOte](https://github.com/erkyrath/glkote)) used by Parchment/Lectrote.
  (One tiny fix is applied to Zork II's story file as it loads -- see
  `src/js/story-patches.js` for the original game bug it works around.)
- **Type your own commands** in the game console, exactly like the original.
- **Assist Mode**: pick a topic from the dropdown (the troll, the thief, the
  maze, the dam, the endgame, etc.) and reveal hints one tier at a time —
  nudge → stronger hint → answer — instead of a spoiler dump.
- **Tab suggestions / walkthrough**: press **Tab** in the game console (or
  double-tap it on a touch screen) to fill in a suggested command;
  **Shift+Tab** steps back, and Up/Down stay the game's own command history.
  A **Walkthrough / Suggestions** switch at the top of the Hints tab picks what Tab offers. In
  *Walkthrough* mode the next step of a full route to the game's top score
  (350 in Zork I, 400 in Zork II, 7 in Zork III; `src/data/<game>/walkthrough.json`) comes first, with a spoiler-light nudge in
  the input's placeholder text; the page works out which steps you've
  finished from the room name, what you've picked up and what the game says
  back, and walks you back toward the right room if you wander off. **Resync to where I am**
  picks the walkthrough back up if you went off on your own (it matches your
  room and score to the route), and **Skip**
  marks a stuck step done (the thief may have stolen what it needed -- he
  is random, so no route is guaranteed). In *Suggestions* mode Tab just
  offers ideas for the current room. Progress is kept in `localStorage`.
- **Auto-map**: a fog-of-war map fills in as you explore, built from the
  game's real room/exit graph. Areas the game's own text can't distinguish
  (mazes, the river, dark caves) are shown as one fogged region rather than
  spoiled room-by-room. Persists across reloads via `localStorage`. An
  "Exits" line lists every command the current room actually accepts
  (N, S, E, W, U, D, etc.), unexplored neighbor cells are labeled with the
  direction that leads there (e.g. "N ?") instead of a bare "?", and a line
  is drawn between any two grid-adjacent cells with a real exit between
  them (dashed/dim toward unexplored cells, solid between visited ones).
  Zork's real geography also has genuine one-way passages and shortcuts
  that don't fit a clean compass grid (the coal mine slide, the trapdoor,
  the Round Room/Mirror Room network) -- an arrowhead on a connector line
  marks a one-way passage, and a small dashed corner tag on a room marks
  an exit that leads somewhere not shown as a line here (see "Exits"
  for the full list).
- **Continue where you left off**: the game itself autosaves after every turn
  to `localStorage` (score, inventory, room, everything) and silently resumes
  on your next visit to the same browser/PC — no need to type "save"/"restore"
  yourself. A **New Game** button clears it and starts over.
- **Header controls**: **Save**/**Load** buttons for named save slots (same
  as typing the commands yourself), **A−**/**A+** to resize the text, and a
  **Modern**/**Retro** toggle that switches the whole look
  between a green-phosphor CRT (scanlines, glow) and a flat modern terminal
  palette — both use the same clean monospace font. All persisted via
  `localStorage`.
- **`undo`**: type it in the game console to step back one turn (repeatable
  for multiple turns). Zork I is compiled for Z-machine v3, which has no
  native UNDO opcode (that arrived in v5), so this is implemented in
  `src/js/undo.js` by snapshotting the VM's own memory after every turn and
  rolling back on request, then auto-submitting a `look` so the game's own
  code redraws the status line and room description. That auto-`look` is a
  real turn like any other, so — one trade-off worth knowing — the turn
  counter won't visibly decrease the way you might expect from undo, even
  though room/inventory/flags are genuinely rolled back; see the comments in
  `src/js/undo.js` for the full reasoning.
- **Code tab**: links out to [Code Museum](https://pataltimore.github.io/code-museum/#/zork),
  an annotated-source-code site, contextual to the room you're in and the
  hint topic you've picked, plus a general "how the engine works" list.
  Code Museum documents the *original* 1977 MIT MDL mainframe source (not
  the ZIL/Infocom port this game runs — different routine names, same
  rooms and puzzles), so the mapping in `src/data/zork1/code-museum-links.json`
  is hand-curated rather than derived automatically; extend it as more
  bookmarks get added on the Code Museum side. Zork II and III link to Code Museum's
  annotated copies of their own ZIL source (the same code these games run).
- **Zork II's own quirks are covered too**: the Wizard's random spells (waited
  out or recovered from -- the Hints tab explains them), the spinning Carousel
  Room (the walkthrough walks you back and has you try again), the carry
  limits, the balloon, the bank, the genie and the maze of oddly-angled rooms
  all have hints, map entries and walkthrough steps.
- **Zork III's too**: the lake, the viewing table, the aqueduct (which stops
  working after an earthquake), the Royal Puzzle, the time machine, the
  mirror box past the Guardians and the Dungeon Master's final test are all
  in the hints and the walkthrough. Zork III is deadly -- grues, the roc, the
  guards in the past -- so the hints say to save often.
- **Fully static** — no backend, no database, no API keys. Deploys to GitHub
  Pages at no cost.

## Project layout

```
src/                     Everything deployed to GitHub Pages
  index.html             Page shell: game console + assist sidebar (Hints/Map/Code tabs)
  css/style.css          Terminal theme (retro CRT / modern), toggleable
  js/app.js              Boots the Z-machine engine, loads the story file
  js/hints.js            Assist-mode hint sidebar logic
  js/map.js              Fog-of-war auto-map: tracks visited rooms, renders grid
  js/game.js             Which Zork is being played; its data paths and storage keys
  js/story-patches.js    Fixes applied to a story file's bytes as it loads
  js/codemuseum.js       Code tab: room/topic-contextual links to Code Museum
  js/command-suggestions.js  Tab suggestions: walkthrough mode + room hints
  js/walkthrough-logic.js    Step/inventory tracking shared with tools/verify-walkthrough.js
  data/<game>/            One folder per game (zork1, zork2, zork3), each holding:
    story.z3              The compiled story file
    hints.json            Curated hint database
    map.json              Room/exit graph, generated from the ZIL source (see tools/)
    walkthrough.json      Walkthrough steps, generated from tools/walkthroughs/<game>.src
    commands.json         Tab-suggestion ideas per room, plus the items the page tracks
    code-museum-links.json  Hand-curated room/topic -> Code Museum bookmark map
  vendor/                 Third-party engine files (see THIRD_PARTY_NOTICES.md)
  vendor/gidispa-zvm.js   Original shim enabling save/restore for the ZVM engine
game-source/<game>/      Vendored original ZIL source, kept for reference/rebuilds
tools/                   Scripts that generate each game's map.json and walkthrough.json
                         (add --game zork2 or zork3), plus a headless player used to verify the
                         walkthroughs; tools/games/ holds the per-game settings
.github/workflows/       GitHub Actions deploy workflow
BUILD.md                 How to recompile a story file / regenerate map.json / the walkthrough
THIRD_PARTY_NOTICES.md   Licenses for everything bundled here
```

## Running locally

No build step — it's static files. From the repo root:

```bash
python -m http.server 8080 --directory src
```

Then open http://localhost:8080. (Any static file server works — `npx serve src`,
VS Code's Live Server, etc.)

## Save data

Progress (score, inventory, room, everything) autosaves to the browser's
`localStorage` after every turn, and resumes automatically the next time you
open the site — same browser, same device. A few things worth knowing:

- It's per-browser and per-device: `localStorage` isn't synced across
  browsers or machines, so "continue on the same browser or PC" is the scope
  — there's no cloud save.
- Clearing site data/cookies for this site (or a private/incognito window)
  wipes it, same as any other `localStorage`-backed app.
- **New Game** (top right) clears both the autosave and the explored map of
  the game you're playing and starts it over. The other game's progress is
  left alone.
- The header's **Save** and **Load** buttons are shortcuts for the game's own
  `save`/`restore` commands (see below) — they just type the command for you
  and open the same file-naming dialog, for named save slots alongside the
  automatic per-turn autosave.
- This is separate from the autosave above: the in-game `save`/`restore`
  (Zork I also answers to `load` — see `game-source/zork1/gsyntax.zil`) commands
  still work normally if typed directly too, also backed by `localStorage`
  via the same `Dialog` library, giving you named save slots instead of a
  single auto-continuing session.

## Deploying to GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes the
`src/` folder to GitHub Pages on every push to `main` (or manually via the
Actions tab). One-time setup: in the repo's **Settings → Pages**, set
**Source** to **GitHub Actions**. The site is then served at
`https://<user>.github.io/zork-assist-mode/`; all asset paths are relative,
so the project sub-path works without changes.

## Licensing

- Zork I, Zork II and Zork III themselves: MIT, released by Microsoft in 2025 (see
  `game-source/zork1/LICENSE`, `game-source/zork2/LICENSE` and `game-source/zork3/LICENSE`).
- Third-party engine/display libraries: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- This project's own code: MIT (see [LICENSE](LICENSE)).

The hint content in `src/data/<game>/hints.json` is original writing describing
well-known, decades-old puzzle solutions in this project's own words — not
copied from any specific walkthrough.

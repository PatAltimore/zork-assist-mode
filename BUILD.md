# Rebuilding the story files

Each game lives in its own folder: `src/data/<game>/` for the story file and
the data the page loads, `game-source/<game>/` for the original ZIL source.
Every tool takes `--game zork1` (the default) or `--game zork2`; adding a
game (Zork III...) is a new `src/data/<game>/`, a new `game-source/<game>/`,
and one entry each in `src/js/game.js` and `tools/games/`.

**Zork II** needs no compiling: `src/data/zork2/story.z3` is
`COMPILED/zork2.z3` straight from the
[historicalsource/zork2](https://github.com/historicalsource/zork2)
repository (Infocom's own build, release 63), and `game-source/zork2/` is the
source beside it for reference and for generating the map. Its one runtime
fix is described in `src/js/story-patches.js`. The rest of this section is
about **Zork I**.

`src/data/zork1/story.z3` is a compiled Z-machine story file, built from the ZIL
source vendored in [`game-source/zork1/`](game-source/zork1/) (the original
[historicalsource/zork1](https://github.com/historicalsource/zork1) source,
released under MIT by Microsoft in 2025). You only need to rebuild it if you
modify the ZIL source.

## Toolchain

[ZILF](https://foss.heptapod.net/zilf/zilf) (mirrored at
[taradinoc/zilf](https://github.com/taradinoc/zilf)) compiles `.zil` source to
a `.zap` assembly file, then its bundled **ZAPF** assembler turns that into a
`.z3` story file. ZILF ships prebuilt binaries for Windows, macOS, and Linux —
no need to build it yourself.

ZILF is licensed under **GPLv3**. It's a build-time tool only: it is not
included in this repository and nothing from it is redistributed. The GPL
does not apply to the story file it produces (analogous to compiling a
program with GCC).

## Steps

1. Download the latest ZILF release for your platform from
   https://github.com/taradinoc/zilf/releases (e.g. `zilf-1.9.0-win-x64.zip`)
   and extract it.
2. Copy your edited `.zil` files from `game-source/zork1/` into a working folder
   alongside ZILF's `zillib/` folder (ZILF resolves `INSERT-FILE` library
   references relative to its own `zillib` directory).
3. Run the compiler and assembler from that folder:

   ```bash
   zilf zork1.zil
   ```

   This produces `zork1.zap` (plus a few auxiliary `.zap` files) and then
   automatically invokes ZAPF, producing `zork1.z3`.
4. Copy the resulting `zork1.z3` into `src/data/zork1/story.z3`, replacing the
   existing file.
5. Reload the site locally (see [README.md](README.md#running-locally)) and
   play through a few turns to confirm the game still works before deploying.

A couple of harmless warnings about ZSCII tab characters in `1DUNGEON.zil`
are expected and can be ignored — they're pre-existing quirks in the original
1980s source, not something introduced by this project.

## Regenerating the auto-map data

`src/data/<game>/map.json` (used by the assist-mode Map tab) is generated
straight from `game-source/<game>/<n>dungeon.zil` — it is not hand-authored.
If you edit the dungeon's rooms or exits, regenerate it:

```bash
node tools/extract-rooms.js [--game zork2]
node tools/build-map.js [--game zork2]
```

Exits the ZIL can't express as plain "TO" clauses (the river launches in Zork I;
the bucket, the cakes and the balloon in Zork II) and the plain-English notes
for conditional exits are added by hand in `tools/games/<game>.js`.

`tools/extract-rooms.js` parses every `<ROOM ...>` object's `DESC` and
directional `TO` exits. `tools/build-map.js` then:

- Merges rooms that share an identical `DESC` (e.g. all 15 `MAZE-*` rooms, the
  five `RIVER-*` rooms, both `MIRROR-ROOM-*` rooms) into a single "blob" node,
  since the game's own status line can't tell them apart either — the map
  intentionally reflects only what's knowable from the text.
- Auto-lays-out the resulting graph into per-level grid coordinates by
  walking exits breadth-first from `WEST-OF-HOUSE`, using compass directions
  for x/y and `UP`/`DOWN` for level, with collision-avoidance for the
  inherently inconsistent blob areas.
- Also emits `rawExits` (every room's real, un-merged exits) and
  `rawToCanonical` (blob member id → canonical id) alongside the merged
  view. The rooms behind a blob are still fully deterministic — the game
  just never says which one you're in — so `src/js/map.js` uses this data
  to work out the specific real room from how the player got there, and
  shows its exact exits instead of a blanket "varies" whenever it can.

One connection — the Frigid River — is entered by launching a boat (an
action routine, not a room exit), so it has no `TO` reference in the ZIL
source; `build-map.js` adds that one connection manually. If future edits add
similar action-driven room changes, they'll need the same manual treatment.

## The walkthrough

`src/data/<game>/walkthrough.json` (the Walkthrough mode of the Tab suggestions) is
generated from the hand-written `tools/walkthroughs/<game>.src` -- one step per line,
with the room each command is typed in, a spoiler-light hint, and how the
page can tell the step is done (see the header of that file):

```bash
node tools/build-walkthrough.js [--game zork2]
```

`tools/verify-walkthrough.js` replays every step against the real game --
headlessly, through the same ifvms/Glk code the page uses (`tools/play.js`)
-- and checks that each step is marked done by the game's reply, using the
very same tracking code as the page (`src/js/walkthrough-logic.js`). Like a
player following the page's suggestions it always types the next step, and
first walks back to the step's room if something moved it off the route.
A passing run ends on the win screen with the game's full score (350 in
Zork I, 400 in Zork II):

```bash
node tools/verify-walkthrough.js --seed 22               # one run, step by step (Zork I)
node tools/verify-walkthrough.js --game zork2 --seed 3   # the same for Zork II
node tools/verify-walkthrough.js --seeds 1-100           # which seeds play clean
node tools/verify-walkthrough.js --resync 1              # check the page's Resync button
```

`build-walkthrough.js` also replays the route on the first clean seed to
record the game score at each step (`score` in the JSON), which the Resync
button matches against the player's room and score; the `--resync` check
confirms it never lands past the player's true position.

Both games are random -- Zork I's thief and combat, Zork II's Wizard (a
spell may freeze you for a few turns, send you stumbling, make you drop
things or steal a treasure) and spinning Carousel Room -- so only some seeds
play clean (roughly one in five), and the hints can't promise more than that:
the thief may steal something a later step needs, which is what the **Skip**
button is for. The verifier waits out or recovers from the spells that can be
(freeze, float, fence, fumble, feeble, fear, ferment), and in the Carousel
Room, Magnet Room and the oddly-angled maze it just repeats the step (marked
`wander` / `try=` in the `.src` file); the rest fail the run. Set `TRACE=1`
(or `2` for full replies) to watch a run, and `BW_SEED=n` with
`build-walkthrough.js` to see why one seed fails. Anything *other* than that showing up in the verifier's output -- a
step that isn't recognised as done, or one that's still pending when the
next is typed -- is a bug in the data or the tracking code. `tools/play.js`
also works on its own (`node tools/play.js "open mailbox" north`) for
checking what the game actually says.

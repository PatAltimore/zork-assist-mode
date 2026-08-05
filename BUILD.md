# Rebuilding the story file

`src/data/zork1.z3` is a compiled Z-machine story file, built from the ZIL
source vendored in [`game-source/`](game-source/) (the original
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
2. Copy your edited `.zil` files from `game-source/` into a working folder
   alongside ZILF's `zillib/` folder (ZILF resolves `INSERT-FILE` library
   references relative to its own `zillib` directory).
3. Run the compiler and assembler from that folder:

   ```bash
   zilf zork1.zil
   ```

   This produces `zork1.zap` (plus a few auxiliary `.zap` files) and then
   automatically invokes ZAPF, producing `zork1.z3`.
4. Copy the resulting `zork1.z3` into `src/data/zork1.z3`, replacing the
   existing file.
5. Reload the site locally (see [README.md](README.md#running-locally)) and
   play through a few turns to confirm the game still works before deploying.

A couple of harmless warnings about ZSCII tab characters in `1DUNGEON.zil`
are expected and can be ignored — they're pre-existing quirks in the original
1980s source, not something introduced by this project.

## Regenerating the auto-map data

`src/data/map.json` (used by the assist-mode Map tab) is generated straight
from `game-source/1dungeon.zil` — it is not hand-authored. If you edit the
dungeon's rooms or exits, regenerate it:

```bash
node tools/extract-rooms.js
node tools/build-map.js
```

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

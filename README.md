# Zork I — Assist Mode

Play the original 1980 Infocom classic **Zork I** in your browser, compiled
straight from the official open-source ZIL release, with an **Assist Mode**
sidebar of graduated, multiple-choice hints for when you get stuck.

- **Real game, not a clone.** The historicalsource/zork1 ZIL source is
  compiled with [ZILF](https://foss.heptapod.net/zilf/zilf) into an actual
  Z-machine story file and played with the same engine family
  ([ifvms.js](https://github.com/curiousdannii/ifvms.js) +
  [GlkOte](https://github.com/erkyrath/glkote)) used by Parchment/Lectrote.
- **Type your own commands** in the game console, exactly like the original.
- **Assist Mode**: pick a topic from the dropdown (the troll, the thief, the
  maze, the dam, the endgame, etc.) and reveal hints one tier at a time —
  nudge → stronger hint → answer — instead of a spoiler dump.
- **Auto-map**: a fog-of-war map fills in as you explore, built from the
  game's real room/exit graph. Areas the game's own text can't distinguish
  (mazes, the river, dark caves) are shown as one fogged region rather than
  spoiled room-by-room. Persists across reloads via `localStorage`.
- **Continue where you left off**: the game itself autosaves after every turn
  to `localStorage` (score, inventory, room, everything) and silently resumes
  on your next visit to the same browser/PC — no need to type "save"/"restore"
  yourself. A **New Game** button clears it and starts over.
- **Header controls**: **Save**/**Load** buttons for named save slots (same
  as typing the commands yourself), **A−**/**A+** to resize the text, and a
  **Modern Terminal**/**Retro CRT** toggle that switches the whole look
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
- **Fully static** — no backend, no database, no API keys. Deploys to Azure
  Static Web Apps' **Free** tier at no cost.

## Project layout

```
src/                     Everything deployed to Azure Static Web Apps
  index.html             Page shell: game console + assist sidebar (Hints/Map tabs)
  css/style.css          Terminal theme (retro CRT / modern), toggleable
  js/app.js              Boots the Z-machine engine, loads the story file
  js/hints.js            Assist-mode hint sidebar logic
  js/map.js              Fog-of-war auto-map: tracks visited rooms, renders grid
  data/zork1.z3           Compiled Zork I story file
  data/hints.json         Curated hint database
  data/map.json           Room/exit graph, generated from the ZIL source (see tools/)
  vendor/                 Third-party engine files (see THIRD_PARTY_NOTICES.md)
  vendor/gidispa-zvm.js   Original shim enabling save/restore for the ZVM engine
  staticwebapp.config.json  Azure SWA routing/MIME config
game-source/             Vendored original ZIL source, kept for reference/rebuilds
tools/                   Scripts that generate src/data/map.json from game-source/
.github/workflows/       GitHub Actions deploy workflow
BUILD.md                 How to recompile zork1.z3 / regenerate map.json
THIRD_PARTY_NOTICES.md   Licenses for everything bundled here
```

## Running locally

No build step — it's static files. From the repo root:

```bash
python -m http.server 8080 --directory src
```

Then open http://localhost:8080. (Any static file server works — `npx serve src`,
VS Code's Live Server, etc.)

To emulate the Azure Static Web Apps environment (routing rules, config file)
more closely, use the [SWA CLI](https://azure.github.io/static-web-apps-cli/):

```bash
npx @azure/static-web-apps-cli start src
```

## Save data

Progress (score, inventory, room, everything) autosaves to the browser's
`localStorage` after every turn, and resumes automatically the next time you
open the site — same browser, same device. A few things worth knowing:

- It's per-browser and per-device: `localStorage` isn't synced across
  browsers or machines, so "continue on the same browser or PC" is the scope
  — there's no cloud save.
- Clearing site data/cookies for this site (or a private/incognito window)
  wipes it, same as any other `localStorage`-backed app.
- **New Game** (top right) clears both the autosave and the explored map and
  starts over from West of House.
- The header's **Save** and **Load** buttons are shortcuts for the game's own
  `save`/`load` commands (see below) — they just type the command for you
  and open the same file-naming dialog, for named save slots alongside the
  automatic per-turn autosave.
- This is separate from the autosave above: the in-game `save`/`load`
  (originally `restore`, aliased — see `game-source/gsyntax.zil`) commands
  still work normally if typed directly too, also backed by `localStorage`
  via the same `Dialog` library, giving you named save slots instead of a
  single auto-continuing session.

## Deploying to Azure Static Web Apps (Free tier)

This repo ships a GitHub Actions workflow
(`.github/workflows/azure-static-web-apps.yml`) but **does not deploy
anything by itself** — you connect it to your own Azure subscription:

1. Push this repo to GitHub.
2. In the [Azure Portal](https://portal.azure.com), create a **Static Web
   App** resource:
   - **Plan type: Free** (this app needs nothing beyond what Free offers —
     no custom API, generous bandwidth for a personal project).
   - Source: GitHub, pick this repo/branch.
   - Build presets: **Custom**, with:
     - App location: `src`
     - Api location: *(leave blank)*
     - Output location: *(leave blank)*
   - The portal will automatically commit a workflow file and add an
     `AZURE_STATIC_WEB_APPS_API_TOKEN_...` secret to your GitHub repo. If its
     name differs from `AZURE_STATIC_WEB_APPS_API_TOKEN`, either rename the
     secret or update the workflow file to match — then delete the portal's
     auto-generated duplicate workflow file so only one deploy workflow runs.
3. Push to `main` — the existing workflow (or the portal's) builds and
   deploys automatically. Pull requests get their own free staging
   environment, cleaned up when the PR closes.

Alternative: create the resource yourself via the Azure CLI
(`az staticwebapp create --sku Free ...`) and wire up the deployment token as
a repo secret. The portal flow above is the easier path if you're doing this
for the first time.

**Cost:** Static Web Apps Free tier includes 100 GB/month bandwidth and free
SSL/custom domains — this project has no server-side API, so it comfortably
fits within Free for personal or small-scale use.

## Licensing

- Zork I itself: MIT, released by Microsoft in 2025 (see `game-source/LICENSE`).
- Third-party engine/display libraries: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- This project's own code: MIT (see [LICENSE](LICENSE)).

The hint content in `src/data/hints.json` is original writing describing
well-known, decades-old puzzle solutions in this project's own words — not
copied from any specific walkthrough.

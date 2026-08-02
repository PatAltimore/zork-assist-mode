# Third-party notices

This project bundles the following third-party components. Each retains its
original license; see the linked notice/license file for full text.

| Component | Location | License | Notes |
|---|---|---|---|
| Zork I (ZIL source & compiled story file) | `game-source/`, `src/data/zork1.z3` | MIT (Copyright 2025 Microsoft) | Original source at [historicalsource/zork1](https://github.com/historicalsource/zork1); compiled unmodified with ZILF. See `game-source/LICENSE`. |
| ifvms.js (ZVM Z-machine engine) | `src/vendor/zvm.min.js` | BSD | From [curiousdannii/ifvms.js](https://github.com/curiousdannii/ifvms.js). See `src/vendor/LICENSE-ifvms.txt`. |
| GlkOte, GlkApi, Dialog | `src/vendor/glkote.js`, `glkapi.js`, `dialog.js`, `glkote.css`, `dialog.css` | MIT (Copyright 2008-2025 Andrew Plotkin) | From [erkyrath/glkote](https://github.com/erkyrath/glkote). See `src/vendor/LICENSE-glkote.txt`. |
| jQuery 1.12.4 | `src/vendor/jquery-1.12.4.min.js` | MIT | Required by GlkOte's DOM handling. |
| VT323 font | `src/vendor/fonts/VT323-Regular.ttf` | SIL Open Font License 1.1 | Retro terminal typeface, from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/vt323). See `src/vendor/fonts/OFL.txt`. |

## Build-time tooling (not redistributed)

[ZILF](https://foss.heptapod.net/zilf/zilf) was used to compile the ZIL
source into `zork1.z3`. ZILF is licensed under GPLv3; it is a compiler tool
used locally during the build and is **not included in this repository**.
Its license does not extend to the story file it produces. See
[BUILD.md](BUILD.md) for details on rebuilding from source.

## This project's original code

Everything else (HTML, CSS, the hint database and its UI, Azure/CI config,
`src/vendor/gidispa-zvm.js`) is covered by this repository's own
[LICENSE](LICENSE) (MIT). `gidispa-zvm.js` in particular is a small original
shim written for this project — it implements the `GiDispa` interface
GlkApi's save/restore machinery expects, since the real one (from
Quixe/Glulx) writes retained arrays back into VM memory in a way that
doesn't apply to ifvms.js's Z-machine engine. See the comment at the top of
that file for details.

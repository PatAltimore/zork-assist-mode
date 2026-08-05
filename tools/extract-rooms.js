// Parses game-source/1dungeon.zil to extract the authoritative room graph
// (id, display name, exits) used to generate src/data/map.json. This reads
// directly from the vendored ZIL source, so the map data can never drift
// from what's actually shipped in the compiled story file.
//
// Usage: node tools/extract-rooms.js   (run from repo root)
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'game-source', '1dungeon.zil');
const OUT = path.join(__dirname, 'rooms-raw.json');
const text = fs.readFileSync(SRC, 'utf8');

function extractRoomBlocks(src) {
    const blocks = [];
    const re = /<ROOM\s+([A-Z0-9][A-Z0-9-]*)/g;
    let m;
    while ((m = re.exec(src))) {
        const start = m.index;
        let depth = 0;
        let i = start;
        for (; i < src.length; i++) {
            if (src[i] === '<') depth++;
            else if (src[i] === '>') {
                depth--;
                if (depth === 0) { i++; break; }
            }
        }
        blocks.push({ id: m[1], text: src.slice(start, i) });
        re.lastIndex = i;
    }
    return blocks;
}

const DIRS = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'NE', 'NW', 'SE', 'SW', 'UP', 'DOWN', 'IN', 'OUT', 'ENTER', 'LAND'];
// The optional trailing group captures a ZIL "IF <condition>" guard, e.g.
// "(SW TO STONE-BARROW IF WON-FLAG)" or "(UP TO LIVING-ROOM IF TRAP-DOOR IS
// OPEN)" -- these exits only exist once that flag/object-state is true, so
// callers need the raw condition text to tell a real exit from one that's
// only sometimes real. \s already matches the newlines ZIL sometimes wraps
// this clause across (e.g. target and IF on separate lines).
const dirPattern = new RegExp(
    '\\((' + DIRS.join('|') + ')\\s+TO\\s+([A-Z][A-Z0-9-]*)(?:\\s+IF\\s+([A-Z][A-Z0-9-]*(?:\\s+IS\\s+OPEN)?))?',
    'g'
);
const descPattern = /\(DESC\s+"([^"]+)"\)/;

const blocks = extractRoomBlocks(text);
const rooms = {};

for (const b of blocks) {
    const descMatch = descPattern.exec(b.text);
    const desc = descMatch ? descMatch[1] : b.id;
    const exits = [];
    let em;
    dirPattern.lastIndex = 0;
    while ((em = dirPattern.exec(b.text))) {
        const exit = { dir: em[1], target: em[2] };
        if (em[3]) exit.condition = em[3];
        exits.push(exit);
    }
    rooms[b.id] = { id: b.id, desc, exits };
}

fs.writeFileSync(OUT, JSON.stringify(rooms, null, 2));
console.log('Parsed', Object.keys(rooms).length, 'rooms ->', path.relative(process.cwd(), OUT));

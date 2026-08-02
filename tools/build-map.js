// Merges duplicate-name rooms into single "blob" nodes (Maze, Dead End,
// Cave, Frigid River, Coal Mine, etc. -- areas the game's own text can't
// tell apart, by design) and auto-layouts the graph into per-level grid
// coordinates for the assist-mode map. Reads rooms-raw.json (produced by
// extract-rooms.js), writes src/data/map.json.
//
// Usage: node tools/extract-rooms.js && node tools/build-map.js
'use strict';
const fs = require('fs');
const path = require('path');

const rooms = JSON.parse(fs.readFileSync(path.join(__dirname, 'rooms-raw.json'), 'utf8'));
const OUT = path.join(__dirname, '..', 'src', 'data', 'map.json');

// The Frigid River is entered by launching/inflating a boat, an action
// routine (RIVER-LAUNCH table in 1actions.zil), not a normal room exit --
// so it has no "TO" reference anywhere in 1dungeon.zil. Add the real
// launch points manually so it isn't stranded off-map.
rooms['DAM-BASE'].exits.push({ dir: 'DOWN', target: 'RIVER-1' });
rooms['WHITE-CLIFFS-NORTH'].exits.push({ dir: 'DOWN', target: 'RIVER-3' });
rooms['WHITE-CLIFFS-SOUTH'].exits.push({ dir: 'DOWN', target: 'RIVER-4' });

// --- 1. Group by DESC (ambiguous names collapse into one canonical node) ---
const groupByDesc = {};
for (const r of Object.values(rooms)) {
    (groupByDesc[r.desc] = groupByDesc[r.desc] || []).push(r.id);
}

const canonicalOf = {}; // original room id -> canonical id
const canonicalMeta = {}; // canonical id -> { name, blob, members }

for (const [desc, ids] of Object.entries(groupByDesc)) {
    const isBlob = ids.length > 1;
    const canonicalId = isBlob ? 'GROUP-' + desc.toUpperCase().replace(/[^A-Z0-9]+/g, '-') : ids[0];
    for (const id of ids) canonicalOf[id] = canonicalId;
    canonicalMeta[canonicalId] = { name: desc, blob: isBlob, members: ids };
}

// --- 2. Rebuild exits in terms of canonical ids, dedup, drop self-loops ---
const canonicalExits = {};
for (const r of Object.values(rooms)) {
    const from = canonicalOf[r.id];
    canonicalExits[from] = canonicalExits[from] || new Map();
    for (const e of r.exits) {
        const to = canonicalOf[e.target];
        if (!to || to === from) continue;
        canonicalExits[from].set(e.dir + '|' + to, { dir: e.dir, target: to });
    }
}

// --- 3. BFS layout: normal rooms placed by direction delta from their
//        first-discovering neighbor; blob rooms placed adjacent with
//        collision-avoidance spiral search (their internal geometry is
//        intentionally inconsistent -- that's the point of the puzzle).
//
//        Important caveat: Zork's own map is not fully embeddable in a
//        consistent 2D grid. For example NORTH-OF-HOUSE's EAST exit leads
//        to EAST-OF-HOUSE, but EAST-OF-HOUSE's NORTH exit leads back to
//        NORTH-OF-HOUSE -- two directions that can't both be satisfied on
//        any grid (a "cut the corner" shortcut the original game does on
//        purpose). No layout can honor every exit's compass direction
//        simultaneously. What we *can* do is bias toward the exits players
//        actually navigate with: when a room is reachable by more than one
//        exit at the same BFS step, prefer a cardinal direction (N/S/E/W)
//        over a diagonal (NE/NW/SE/SW) to decide its position, since in
//        this dataset diagonals are overwhelmingly redundant shortcuts to
//        a target already reachable the "plain" way (e.g. West of House's
//        NE exit just duplicates its NORTH exit to the same room). ---
const DELTA = {
    NORTH: [0, -1, 0], SOUTH: [0, 1, 0], EAST: [1, 0, 0], WEST: [-1, 0, 0],
    NE: [1, -1, 0], NW: [-1, -1, 0], SE: [1, 1, 0], SW: [-1, 1, 0],
    UP: [0, 0, 1], DOWN: [0, 0, -1],
    IN: [0, 0, 0], OUT: [0, 0, 0], ENTER: [0, 0, 0], LAND: [0, 0, 0],
};
// Primary movement (compass + vertical) is preferred over secondary/
// shortcut exits (diagonals, IN/OUT/ENTER/LAND) when a room is reachable
// both ways -- UP/DOWN must stay in this tier too, or a room normally
// reached by going down a level can end up placed on the *same* level via
// a same-level diagonal/cardinal shortcut instead.
const PRIMARY_DIR = new Set(['NORTH', 'SOUTH', 'EAST', 'WEST', 'UP', 'DOWN']);

const START = canonicalOf['WEST-OF-HOUSE'];
const pos = {};
const occupied = new Set();

function key(level, x, y) { return level + '|' + x + '|' + y; }

// dirDelta, if given, is the [dx,dy] the room was actually reached by (e.g.
// [-1,0] for a WEST exit). When the ideal cell is taken -- usually because
// some unrelated room ended up sharing that row/column, not because this
// particular exit is contradictory -- keep walking further in that *same*
// direction before falling back to a generic spiral. A room reached by
// going west belongs further west of its neighbor, not diagonally away
// from it.
function findFreeCell(level, x, y, dirDelta) {
    if (!occupied.has(key(level, x, y))) return [x, y];

    if (dirDelta && (dirDelta[0] !== 0 || dirDelta[1] !== 0)) {
        for (let step = 2; step <= 40; step++) {
            const cx = x + dirDelta[0] * (step - 1);
            const cy = y + dirDelta[1] * (step - 1);
            if (!occupied.has(key(level, cx, cy))) return [cx, cy];
        }
    }

    for (let radius = 1; radius < 40; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const cx = x + dx, cy = y + dy;
                if (!occupied.has(key(level, cx, cy))) return [cx, cy];
            }
        }
    }
    return [x, y];
}

pos[START] = { x: 0, y: 0, level: 0 };
occupied.add(key(0, 0, 0));
const queue = [START];
const visited = new Set([START]);

while (queue.length) {
    const cur = queue.shift();
    const curPos = pos[cur];
    const exits = canonicalExits[cur] ? Array.from(canonicalExits[cur].values()) : [];
    // Primary exits first, so a room reachable both "north" (or "down")
    // and via some diagonal/IN/OUT shortcut from the same room gets placed
    // by the primary one.
    exits.sort((a, b) => (PRIMARY_DIR.has(a.dir) ? 0 : 1) - (PRIMARY_DIR.has(b.dir) ? 0 : 1));
    for (const { dir, target } of exits) {
        if (visited.has(target)) continue;
        visited.add(target);
        const d = DELTA[dir] || [0, 0, 0];
        let nx = curPos.x + d[0];
        let ny = curPos.y + d[1];
        const nlevel = curPos.level + d[2];
        [nx, ny] = findFreeCell(nlevel, nx, ny, d[2] === 0 ? [d[0], d[1]] : null);
        pos[target] = { x: nx, y: ny, level: nlevel };
        occupied.add(key(nlevel, nx, ny));
        queue.push(target);
    }
}

let strayIndex = 0;
for (const id of Object.keys(canonicalMeta)) {
    if (!pos[id]) {
        pos[id] = { x: strayIndex++, y: 0, level: 99 };
    }
}

// --- 4. Normalize coordinates per level to start at (0,0) ---
const levels = {};
for (const [id, p] of Object.entries(pos)) {
    (levels[p.level] = levels[p.level] || []).push(id);
}
for (const ids of Object.values(levels)) {
    const minX = Math.min(...ids.map((id) => pos[id].x));
    const minY = Math.min(...ids.map((id) => pos[id].y));
    for (const id of ids) {
        pos[id].x -= minX;
        pos[id].y -= minY;
    }
}

// --- 5. Emit final map.json ---
const outRooms = {};
for (const id of Object.keys(canonicalMeta)) {
    outRooms[id] = {
        name: canonicalMeta[id].name,
        blob: canonicalMeta[id].blob,
        level: pos[id].level,
        x: pos[id].x,
        y: pos[id].y,
        exits: canonicalExits[id] ? Array.from(canonicalExits[id].values()) : [],
    };
}

fs.writeFileSync(OUT, JSON.stringify({ start: START, rooms: outRooms }));
console.log('Canonical rooms:', Object.keys(outRooms).length);
console.log('Levels used:', Object.keys(levels).sort((a, b) => b - a).join(', '));
console.log('Wrote', path.relative(process.cwd(), OUT));

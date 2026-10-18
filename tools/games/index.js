// Per-game settings shared by the build/verify tools. Pick the game with
// --game zork2 (anywhere in the command line) or GAME=zork2; default zork1.
//
// A game's own quirks live beside this file: tools/games/<id>.js exports
// { start, patchRooms(rooms), conditionNotes } for build-map.js.
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const GAMES = {
    zork1: { dungeon: '1dungeon.zil', maxScore: 350, winText: /completed a great and perilous/i },
    zork2: { dungeon: '2dungeon.zil', maxScore: 400, winText: /ultimate adventure concludes/i },
};

function gameId(argv) {
    const i = (argv || process.argv).indexOf('--game');
    const id = (i !== -1 && (argv || process.argv)[i + 1]) || process.env.GAME || 'zork1';
    if (!GAMES[id]) {
        throw new Error('unknown game "' + id + '" (known: ' + Object.keys(GAMES).join(', ') + ')');
    }
    return id;
}

function config(id) {
    id = id || gameId();
    const g = GAMES[id];
    return Object.assign({
        id: id,
        dataDir: path.join(ROOT, 'src', 'data', id),
        storyPath: path.join(ROOT, 'src', 'data', id, 'story.z3'),
        dungeonPath: path.join(ROOT, 'game-source', id, g.dungeon),
        walkthroughSrc: path.join(__dirname, '..', 'walkthroughs', id + '.src'),
        roomsRaw: path.join(__dirname, '..', 'rooms-raw-' + id + '.json'),
        extras: require('./' + id + '.js'),
    }, g);
}

// Strips "--game x" so positional args (play.js commands) stay clean.
function stripGameArg(args) {
    const out = args.slice();
    const i = out.indexOf('--game');
    if (i !== -1) { out.splice(i, 2); }
    return out;
}

module.exports = { config, gameId, stripGameArg, GAMES };

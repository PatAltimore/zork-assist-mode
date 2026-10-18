'use strict';
// Zork III specifics for tools/build-map.js.
module.exports = {
    start: 'ZORK2-STAIR',

    // Exits made by verbs instead of "TO" clauses.
    patchRooms(rooms) {
        // "enter lake" from any shore puts you on the lake (and drops everything you carry).
        rooms['LAKE-SHORE'].exits.push({ dir: 'DOWN', target: 'ON-LAKE', condition: 'SWIM' });
        rooms['FAR-SHORE'].exits.push({ dir: 'EAST', target: 'ON-LAKE', condition: 'SWIM' });
        rooms['SOUTH-SHORE'].exits.push({ dir: 'NORTH', target: 'ON-LAKE', condition: 'SWIM' });
        // The ladder back up out of the Royal Puzzle, and the hole down into it.
        rooms['CP-ANTE'].exits.push({ dir: 'DOWN', target: 'CP', condition: 'PUZZLE' });
        rooms['CP'].exits.push({ dir: 'UP', target: 'CP-ANTE', condition: 'LADDER' });
        rooms['CP'].exits.push({ dir: 'WEST', target: 'CP-OUT', condition: 'LADDER' });
        // The mirror box carries you the length of the hallway.
        rooms['MREYE'].exits.push({ dir: 'NORTH', target: 'MRA', condition: 'BEAM' });
        rooms['MRA'].exits.push({ dir: 'NORTH', target: 'IN-MIRROR', condition: 'BOX' });
        rooms['IN-MIRROR'].exits.push({ dir: 'NORTH', target: 'FRONT-DOOR', condition: 'BOX-OUT' });
    },

    impossibleConditions: [],

    conditionNotes: {
        'SWIM': 'only by saying "enter lake" -- and everything you carry (except what you wear) sinks',
        'PUZZLE': 'only once the earth has shaken and the museum cleft has opened',
        'LADDER': 'only with the right ladder pushed into place at the start of the puzzle',
        'BEAM': 'the red beam only matters to the button; you can walk on',
        'BOX': 'only through the opened mirror, to ride the box past the Guardians',
        'BOX-OUT': 'only by riding the box to its far end and opening its pine side',
        'CLEFT-FLAG': 'only after the earthquake opens the cleft beside the great door',
        'JEWEL-DOOR IS OPEN': 'only with the stone door open',
        'WOODEN-DOOR IS OPEN': 'only with the wooden door open',
        'SECRET-DOOR IS OPEN': 'only once the old man has shown you the secret door and you have opened it',
        'CP-FLAG': 'only once the book has paid the puzzle\'s exit fee',
        'ROPE-FLAG': 'only while the rope hangs down the cliff',
        'COVER-MOVED': 'only once the manhole cover has been moved',
        'AQ-FLAG': 'only before the earthquake collapses the aqueduct',
        'DUNGEON-DOOR IS OPEN': 'only once the Dungeon Master has opened the great door',
        'CELL-DOOR IS OPEN': 'only with the cell door open',
        'BRONZE-DOOR IS OPEN': 'only with the bronze door unlocked and open',
        'EMPTY-HANDED': 'only if you carry almost nothing',
    },
};

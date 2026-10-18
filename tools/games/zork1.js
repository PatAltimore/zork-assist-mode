'use strict';
// Zork I specifics for tools/build-map.js.
module.exports = {
    start: 'WEST-OF-HOUSE',

    // The Frigid River is entered by launching/inflating a boat, an action
    // routine (RIVER-LAUNCH table in 1actions.zil), not a normal room exit --
    // so it has no "TO" reference anywhere in 1dungeon.zil. Add the real
    // launch points manually so it isn't stranded off-map.
    patchRooms(rooms) {
        rooms['DAM-BASE'].exits.push({ dir: 'DOWN', target: 'RIVER-1' });
        rooms['WHITE-CLIFFS-NORTH'].exits.push({ dir: 'DOWN', target: 'RIVER-3' });
        rooms['WHITE-CLIFFS-SOUTH'].exits.push({ dir: 'DOWN', target: 'RIVER-4' });
    },

    // FALSE-FLAG is a permanently-false joke global (Kitchen's chimney:
    // "Only Santa Claus climbs down chimneys."), so that exit is flat-out
    // impossible and dropped from the map.
    impossibleConditions: ['FALSE-FLAG'],

    conditionNotes: {
        'WON-FLAG': "only after you've already won the game",
        'KITCHEN-WINDOW IS OPEN': 'only with the kitchen window open',
        'MAGIC-FLAG': "only after saying \"Odysseus\" or \"Ulysses\" to scare off the cyclops",
        'CYCLOPS-FLAG': "only after saying \"Odysseus\" or \"Ulysses\" to scare off the cyclops",
        'LLD-FLAG': 'only after completing the exorcism ritual (bell, candles, book)',
        'TRAP-DOOR IS OPEN': 'only if the trap door is propped open',
        'DEFLATE': 'only with the boat deflated',
        'RAINBOW-FLAG': 'only after waving the sceptre at the rainbow',
    },
};

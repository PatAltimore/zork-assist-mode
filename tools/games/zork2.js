'use strict';
// Zork II specifics for tools/build-map.js.
module.exports = {
    start: 'INSIDE-BARROW',

    // Exits the ZIL source gives as routines ("PER ...") rather than "TO"
    // clauses, so extract-rooms.js can't see them.
    patchRooms(rooms) {
        // The Safety Depository's doorways go back out to the tellers' rooms,
        // but an alarm bars the way if you're carrying the bills or portrait.
        rooms['DEPOSITORY'].exits.push({ dir: 'WEST', target: 'TELLER-WEST', condition: 'NO-LOOT' });
        rooms['DEPOSITORY'].exits.push({ dir: 'EAST', target: 'TELLER-EAST', condition: 'NO-LOOT' });
        // The Low Room (MAGNET-ROOM-EXIT): east to the Machine Room, southeast
        // (or out) back to the Tea Room.
        rooms['MAGNET-ROOM'].exits.push({ dir: 'EAST', target: 'MACHINE-ROOM' });
        rooms['MAGNET-ROOM'].exits.push({ dir: 'SE', target: 'TEA-ROOM' });
        // Falling into the Room of Black Mist's far end sends you back to the Barrow.
        rooms['DEAD-PALANTIR-4'].exits.push({ dir: 'OUT', target: 'INSIDE-BARROW', condition: 'RETURNED' });
        // Exits that only happen through an action: riding the bucket up the
        // well, the "Eat Me"/"Enlarge" cakes, the balloon in the volcano.
        rooms['WELL-BOTTOM'].exits.push({ dir: 'UP', target: 'WELL-TOP', condition: 'BUCKET' });
        rooms['WELL-TOP'].exits.push({ dir: 'DOWN', target: 'WELL-BOTTOM', condition: 'BUCKET' });
        rooms['TEA-ROOM'].exits.push({ dir: 'EAST', target: 'POSTS-ROOM', condition: 'EAT-ME' });
        rooms['POSTS-ROOM'].exits.push({ dir: 'WEST', target: 'TEA-ROOM', condition: 'ENLARGE' });
        rooms['VOLCANO-BOTTOM'].exits.push({ dir: 'UP', target: 'VAIR-1', condition: 'BALLOON' });
        rooms['VAIR-1'].exits.push({ dir: 'UP', target: 'VAIR-2', condition: 'BALLOON' });
        rooms['VAIR-2'].exits.push({ dir: 'UP', target: 'VAIR-3', condition: 'BALLOON' });
        rooms['VAIR-3'].exits.push({ dir: 'UP', target: 'VAIR-4', condition: 'BALLOON' });
        rooms['VAIR-1'].exits.push({ dir: 'DOWN', target: 'VOLCANO-BOTTOM', condition: 'BALLOON' });
    },

    impossibleConditions: [],

    conditionNotes: {
        'SECRET-DOOR': 'only once the princess has opened the secret door in the marble wall',
        'ICE-MELTED': 'only after the ice has melted (the dragon has to see its reflection in the glacier)',
        'CERBERUS-LEASHED': 'only once the three-headed dog is wearing the collar',
        'CRYPT-DOOR IS OPEN': 'only with the crypt door open',
        'DIM-DOOR-FLAG': 'only with the secret door in the crypt open',
        'MENHIR-POSITION': 'only once the menhir has been moved out of the way',
        'WIZ-DOOR IS OPEN': "only with the Wizard's door unlocked and open",
        'RIDDLE-DOOR IS OPEN': 'only after answering the riddle on the stone door',
        'PDOOR IS OPEN': 'only with the oak door unlocked and open',
        'GNOME-DOOR-FLAG': 'only after giving the volcano gnome a treasure',
        'NO-LOOT': 'only if you are not carrying the bank\'s money or portrait (an alarm bars the way)',
        'BUCKET': 'only by riding the wooden bucket (it rises when water is poured into it)',
        'EAT-ME': 'only by eating the cake marked "Eat Me" -- it shrinks you into the Posts Room',
        'ENLARGE': 'only by eating the cake that enlarges you',
        'BALLOON': 'only in the balloon, once it is inflated',
        'RETURNED': 'only after the face in the mist has let you go',
    },
};

(function (root, factory) {
    'use strict';
    // Loaded as a plain <script> in the browser (window.ZorkStoryPatches) and
    // require()d by tools/play.js, so the page and the headless verifier run
    // exactly the same bytes.
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ZorkStoryPatches = factory();
    }
}(this, function () {
    'use strict';

    // Fixes to the original compiled story files -- one per bug that the
    // original interpreters shrugged off but ifvms.js (rightly) cannot.
    //
    // Each patch overwrites `expect` with `replace` at `offset`, and is only
    // applied if the bytes there really are `expect`, so a different build of
    // the story file is left untouched rather than corrupted.
    var PATCHES = {
        zork2: [
            {
                // The Wizard's "Fantasize" spell makes room descriptions
                // occasionally add "There is a <something silly> here.",
                // picked with the PICK-ONE routine. PICK-ONE expects its table
                // to start with a spare counter slot after the length (the
                // other tables it is used on do: "LTABLE 0 ..."), but the
                // FANTASIES table was written without one. So PICK-ONE took the
                // first fantasy's string address as its counter and read far
                // outside the game's memory -- harmless garbage on a 1980s
                // interpreter, a fatal "offset is outside the bounds of the
                // DataView" here. Zeroing that first slot turns it into the
                // counter PICK-ONE wants (at the cost of one of the eight
                // fantasies, "a pile of jewels", which never gets mentioned).
                offset: 11751,
                expect: [0xB4, 0x93],
                replace: [0x00, 0x00]
            }
        ]
    };

    // bytes: Uint8Array of the story file (modified in place and returned).
    function apply(gameId, bytes) {
        (PATCHES[gameId] || []).forEach(function (patch) {
            for (var i = 0; i < patch.expect.length; i++) {
                if (bytes[patch.offset + i] !== patch.expect[i]) {
                    return;
                }
            }
            for (var j = 0; j < patch.replace.length; j++) {
                bytes[patch.offset + j] = patch.replace[j];
            }
        });
        return bytes;
    }

    return { apply: apply };
}));

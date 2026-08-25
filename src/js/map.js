// LEARNING NOTE: this whole file is wrapped in an "IIFE" -- an Immediately
// Invoked Function Expression, `(function () { ... })()`. Wrapping the file
// in a function and then calling it right away creates a private scope:
// every `var` declared inside (mapData, visited, all the helper functions)
// lives only in this function's closure and is invisible from outside the
// file. Without this, every `var` here would become a global variable,
// and since this project loads several plain <script> files into one page
// (no bundler, no ES modules), two files both declaring e.g. `var render`
// would silently stomp on each other. This is the classic "module pattern"
// from before JavaScript had real modules.
(function () {
    'use strict';

    var VISITED_KEY = 'zork-assist-map-visited-v1';
    var CURRENT_KEY = 'zork-assist-map-current-v1';
    var TREE_DEPTH = 3;

    // LEARNING NOTE: mapData, nameToId, visited, currentId (and the other
    // `var`s below) are this module's shared state -- not local to any one
    // function. Every function defined inside this IIFE can read and write
    // them directly because of *closures*: a function defined inside
    // another function keeps a live reference to its outer function's
    // variables, even after the outer function (this IIFE) has already
    // run. That's what lets, say, checkRoom() update `currentId` and have
    // render() immediately see the new value, with no need to pass it
    // around as a parameter or return value.
    var mapData = null; // { start, rawToCanonical, rawExits, rooms: { id: {name, blob, exits:[{dir,target,note?}], memberIds?} } }
    var nameToId = {};
    // LEARNING NOTE: Set is a built-in collection of unique values (adding
    // the same value twice is a no-op) with fast `.has(x)` membership
    // checks -- both properties matter here: a room can only be "visited"
    // once no matter how many times you re-enter it, and checking "have we
    // been here before" needs to be cheap since it happens on every move.
    // An array would technically work too, but `.includes()` on an array
    // has to scan every element; Set is built to answer "is x in here?"
    // in roughly constant time regardless of how many rooms you've visited.
    var visited = new Set();
    var currentId = null;

    // Best guess at which *specific* real room the player is standing in,
    // when currentId is a blob -- see resolveSpecificId. Null whenever the
    // canonical name alone doesn't tell us (including for any non-blob
    // room, where the canonical id already IS the specific room, so this
    // only ever needs to hold a value while genuinely inside a blob).
    var currentSpecificId = null;
    var blobsWithInternalEdges = null; // Set, computed once mapData loads

    // The direction of the last command the player actually submitted,
    // consumed (and cleared) the next time checkRoom runs -- see
    // predictedRawTarget and initCommandTracking. Null whenever the last
    // input wasn't a recognized single-direction move (or has already been
    // consumed), so a leftover guess never gets applied to some unrelated
    // later change.
    var pendingDir = null;

    var levelsEl = document.getElementById('map-levels');
    var DIR_LABELS = {
        NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
        NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
        UP: 'Up', DOWN: 'Down', IN: 'In', OUT: 'Out', ENTER: 'Enter', LAND: 'Land'
    };
    var DIR_ORDER = ['NORTH', 'NE', 'EAST', 'SE', 'SOUTH', 'SW', 'WEST', 'NW', 'UP', 'DOWN', 'IN', 'OUT', 'ENTER', 'LAND'];

    // Plain-English commands that map to one of the direction tokens above.
    // Only single-word moves (after stripping a leading "go"/"walk"/"climb")
    // are recognized -- anything else (multi-word, or a verb this doesn't
    // know) is deliberately left unrecognized rather than guessed at, since
    // an unrecognized command just falls back to the name-based resolution
    // this map already had, while a *wrong* guess could assert a specific
    // room that isn't actually the one the player is in.
    var DIR_WORDS = {
        n: 'NORTH', north: 'NORTH',
        s: 'SOUTH', south: 'SOUTH',
        e: 'EAST', east: 'EAST',
        w: 'WEST', west: 'WEST',
        ne: 'NE', northeast: 'NE',
        nw: 'NW', northwest: 'NW',
        se: 'SE', southeast: 'SE',
        sw: 'SW', southwest: 'SW',
        u: 'UP', up: 'UP',
        d: 'DOWN', down: 'DOWN',
        in: 'IN', enter: 'IN', inside: 'IN',
        out: 'OUT', exit: 'OUT', outside: 'OUT',
        land: 'LAND'
    };
    var DIR_PREFIX_VERBS = { go: true, walk: true, run: true, move: true, climb: true };

    function sortDirs(dirSet) {
        return DIR_ORDER.filter(function (d) { return dirSet.has(d); });
    }

    // Normalizes a submitted command line to one of the DIR tokens above, or
    // null if it isn't (confidently) a single-direction move.
    function parseDirection(text) {
        if (!text) {
            return null;
        }
        // LEARNING NOTE: /[.,!]+$/ is a regular expression -- a pattern for
        // matching text. Reading it piece by piece: `[.,!]` is a character
        // class meaning "any one of these three characters", `+` means "one
        // or more of the previous thing", and `$` anchors the match to the
        // very end of the string. So this whole pattern matches "a run of
        // period/comma/exclamation-point characters at the end of the
        // string" -- e.g. the "." in "north." -- and .replace(pattern, '')
        // deletes whatever it matches. Below, /\s+/ (`\s` = whitespace,
        // `+` = one or more) is used with .split() to break the remaining
        // text into words on any run of spaces/tabs.
        var words = text.trim().toLowerCase().replace(/[.,!]+$/, '').split(/\s+/);
        if (words.length > 1 && DIR_PREFIX_VERBS[words[0]]) {
            words = words.slice(1);
        }
        return words.length === 1 ? (DIR_WORDS[words[0]] || null) : null;
    }

    // The Z-machine's own status-line opcode (not this page) formats the
    // room name to fit whatever width the game window currently has, so on
    // a narrow/mobile screen a long name like "North of House" can arrive
    // here already cut down to "North of Ho". An exact-match lookup would
    // just silently fail in that case, so fall back to treating it as a
    // truncated prefix -- but only when exactly one known room name starts
    // with it, so a genuinely ambiguous or garbled reading still resolves
    // to nothing rather than the wrong room.
    function resolveRoomId(name) {
        if (!name) {
            return null;
        }
        if (nameToId[name]) {
            return nameToId[name];
        }
        // LEARNING NOTE: .filter() is one of JavaScript's "array methods
        // that take a function" -- instead of writing a for-loop and
        // manually building up a result array, you hand .filter() a
        // function that returns true/false for each element, and it hands
        // back a new array containing only the elements where that
        // function returned true. Object.keys(obj) turns an object's own
        // property names into a plain array first, since .filter() only
        // works on arrays. fullName.indexOf(name) === 0 means "name occurs
        // starting at position 0 of fullName" -- i.e. fullName starts with
        // name.
        var candidates = Object.keys(nameToId).filter(function (fullName) {
            return fullName.indexOf(name) === 0;
        });
        return candidates.length === 1 ? nameToId[candidates[0]] : null;
    }

    // The canonical id a raw room id displays as. Non-blob rooms are their
    // own canonical id already; blob members are looked up in the table
    // build-map.js emits specifically for this.
    function canonicalOf(rawId) {
        return (mapData.rawToCanonical && mapData.rawToCanonical[rawId]) || rawId;
    }

    // A raw room's own real exits (real target ids, not merged into any
    // blob's union view) -- build-map.js keeps this for every room, since
    // even a non-blob room's normal `exits` field has already had its
    // targets rewritten to canonical ids by the time it reaches map.json.
    function rawExitsOf(rawId) {
        return (mapData.rawExits && mapData.rawExits[rawId]) || null;
    }

    // Does any real room behind this blob have an exit to *another* real
    // room of the same blob? (e.g. rowing down the Frigid River, or
    // wandering deeper into the Maze, never changes the displayed name.)
    // Precomputed once so checkRoom can cheaply decide whether "the name
    // didn't change" might still mean "you moved" for a given blob.
    function computeBlobsWithInternalEdges() {
        var result = new Set();
        // LEARNING NOTE: .forEach() runs a function once per array element,
        // purely for its side effects (here, populating `result`) -- unlike
        // .filter()/.map(), it doesn't build a new array for you. `return;`
        // inside the callback just skips to the next element, the same way
        // `continue` would in a for-loop; it does NOT exit computeBlobsWithInternalEdges
        // itself.
        Object.keys(mapData.rooms).forEach(function (canonId) {
            var room = mapData.rooms[canonId];
            if (!room.blob || !room.memberIds) {
                return;
            }
            // .some() is like .filter() but stops at the first match and
            // returns just true/false, instead of collecting every match
            // into an array -- exactly "does at least one element satisfy
            // this?", which is all that's needed here.
            var hasInternal = room.memberIds.some(function (rawId) {
                var exits = rawExitsOf(rawId) || [];
                return exits.some(function (e) { return canonicalOf(e.target) === canonId; });
            });
            if (hasInternal) {
                result.add(canonId);
            }
        });
        return result;
    }

    // Figure out which specific real room is behind a blob's name, given
    // where the player was standing just before (also a raw id, or null if
    // that was unknown too). The real rooms behind a blob are completely
    // deterministic -- the game just never tells you which one you're in --
    // so if the room you *left* has only one exit into the blob you just
    // entered, that's provably which one you're in now, regardless of
    // which of its equally-named siblings it might otherwise be confused
    // with. If the previous room reaches more than one member of this
    // blob, or fromRawId itself isn't known, there's genuinely not enough
    // information and this correctly gives up rather than guessing.
    function resolveSpecificId(newCanonicalId, fromRawId) {
        var newRoom = mapData.rooms[newCanonicalId];
        if (!newRoom.blob) {
            return newCanonicalId;
        }
        if (!fromRawId) {
            return null;
        }
        var fromExits = rawExitsOf(fromRawId);
        if (!fromExits) {
            return null;
        }
        var matches = new Set();
        fromExits.forEach(function (e) {
            if (canonicalOf(e.target) === newCanonicalId) {
                matches.add(e.target);
            }
        });
        return matches.size === 1 ? Array.from(matches)[0] : null;
    }

    // The one deterministic raw room a direction command leads to from a
    // known raw room, if any. Every real ZIL room's own exits are fully
    // deterministic (the Maze and Coal Mine included -- see checkRoom's
    // caller for how this gets verified against what the game actually did
    // before it's ever trusted), so this is exact whenever it returns
    // non-null: null only means "can't predict" (unknown starting room, no
    // recognized direction, or -- vanishingly rare in this dungeon -- more
    // than one exit sharing the same direction), never "predicted wrong".
    function predictedRawTarget(direction, fromRawId) {
        if (!direction || !fromRawId) {
            return null;
        }
        var exits = rawExitsOf(fromRawId);
        if (!exits) {
            return null;
        }
        var matches = exits.filter(function (e) { return e.dir === direction; });
        return matches.length === 1 ? matches[0].target : null;
    }

    // Group exits by direction. A "blob" room (Cave, Maze, Mirror Room...)
    // stands in for more than one *real*, fully deterministic ZIL room that
    // just happens to print the exact same name -- so movement here isn't
    // actually random, it's just that the game never tells you which real
    // room you're in. Most directions still agree across every real room
    // behind the blob (e.g. every "Forest" room's UP exit is blocked the
    // same way), and those can be shown with total confidence; a direction
    // only needs a "varies" treatment when the real rooms genuinely
    // disagree about where it leads.
    function groupExitsByDir(exits) {
        var byDir = {};
        exits.forEach(function (e) {
            var list = byDir[e.dir] || (byDir[e.dir] = []);
            if (!list.some(function (x) { return x.target === e.target; })) {
                list.push(e);
            }
        });
        return byDir;
    }

    // LEARNING NOTE: localStorage is a browser API for storing small bits of
    // text that survive a page reload (and even closing the browser) --
    // unlike a normal `var`, which resets to nothing every time the page
    // loads fresh. It only stores strings, which is why saveState() below
    // calls JSON.stringify() to turn the `visited` Set into a plain array
    // and then into a string, and loadState() calls JSON.parse() to reverse
    // that. It's wrapped in try/catch because some browser settings (like
    // Safari in private browsing) make localStorage throw an error on
    // every access instead of just failing quietly.
    function loadState() {
        try {
            var raw = localStorage.getItem(VISITED_KEY);
            if (raw) {
                JSON.parse(raw).forEach(function (id) { visited.add(id); });
            }
            currentId = localStorage.getItem(CURRENT_KEY) || null;
        } catch (e) {
            // localStorage unavailable (private browsing, etc.) -- map still
            // works for the current page load, it just won't persist.
        }
    }

    function saveState() {
        try {
            localStorage.setItem(VISITED_KEY, JSON.stringify(Array.from(visited)));
            if (currentId) {
                localStorage.setItem(CURRENT_KEY, currentId);
            }
        } catch (e) {
            // Ignore -- non-critical.
        }
    }

    // A badge for one exit: the direction, and where it leads -- the
    // destination room name if you've already been there, or a plain "?"
    // if you haven't (so this doesn't spoil unexplored rooms). `candidates`
    // is normally a single exit, but can hold more than one when the real
    // rooms behind a blob genuinely disagree about where this direction
    // leads -- in that case we say so plainly instead of picking one.
    // A handful of Zork's exits only go one way (the coal mine slide, the
    // trap door once it swings shut...) -- if the target has no exit back
    // to where this edge started, there's no walking back the way you
    // came. Known even for an unvisited "?" target, since it's a fact
    // about the exit's shape, not about what's actually in the room.
    // Skipped for a "varies" (multi-candidate) exit, since which real room
    // it leads to -- and so whether it's one-way -- isn't known yet either.
    function isOneWayExit(candidates, fromId) {
        if (!fromId || candidates.length !== 1) {
            return false;
        }
        var candidate = candidates[0];
        // When this edge came from the root's own fully-resolved specific
        // room (see exitsForNode), rawTarget names the exact real room it
        // leads to -- check that real room's own raw exits for a way back
        // to the exact real room we're leaving, rather than the canonical
        // merged view. The merged view silently drops self-loop and other
        // same-blob edges (see blobExitsForDisplay's own comment on why),
        // which would otherwise misreport plenty of genuinely two-way
        // Maze/Coal-Mine edges as one-way now that exact tracking makes it
        // through more than one hop into a blob with internal edges.
        if (candidate.rawTarget && currentSpecificId) {
            var rawExits = rawExitsOf(candidate.rawTarget);
            if (rawExits) {
                return !rawExits.some(function (e) { return e.target === currentSpecificId; });
            }
        }
        var target = mapData.rooms[candidate.target];
        if (!target) {
            return false;
        }
        return !target.exits.some(function (e) { return e.target === fromId; });
    }

    function exitBadge(dir, candidates) {
        var badge = document.createElement('span');
        badge.className = 'map-exit-badge';

        var dirPart = document.createElement('span');
        dirPart.className = 'map-exit-dir';
        dirPart.textContent = DIR_LABELS[dir] || dir;
        badge.appendChild(dirPart);

        var destPart = document.createElement('span');
        destPart.className = 'map-exit-dest';

        if (candidates.length === 1) {
            var candidate = candidates[0];
            var target = mapData.rooms[candidate.target];
            if (target && visited.has(candidate.target)) {
                destPart.textContent = target.blob ? target.name + ' (varies)' : target.name;
            } else {
                destPart.textContent = '?';
                destPart.classList.add('map-exit-dest-unknown');
                badge.title = 'Not yet visited -- go ' + (DIR_LABELS[dir] || dir) + ' to find out what\'s here.';
            }
            // Some exits in Zork only exist once a specific flag or object
            // state is true (the trap door propped open, the window open,
            // the cyclops scared off...). This map only ever watches the
            // status line's room name -- it has no way to see object or
            // flag state, so it can't tell whether that condition is
            // already met. Flag these so they never read as a guaranteed
            // way through, but say so honestly rather than asserting a
            // "locked" status this map can't actually verify.
            if (candidate.note) {
                badge.classList.add('map-exit-conditional');
                badge.title = 'This exit exists ' + candidate.note + ' -- this map can\'t tell whether that\'s already true, so check with the game before counting on it.';
            }
            // A blob's real rooms don't all necessarily share this
            // direction at all (see blobExitsForDisplay) -- even though
            // the ones that do all agree on where it leads, trying it from
            // a real room that doesn't have it will just fail.
            if (candidate.unreliable) {
                badge.classList.add('map-exit-unreliable');
                badge.title = (badge.title ? badge.title + ' ' : '') +
                    'Not every real room behind this name has this exit -- it may not work from wherever you actually are.';
            }
        } else {
            destPart.textContent = 'varies';
            destPart.classList.add('map-exit-dest-unknown');
            var names = candidates.map(function (e) {
                var t = mapData.rooms[e.target];
                var label = !t ? 'somewhere unknown'
                    : !visited.has(e.target) ? 'somewhere unexplored'
                        : (t.blob ? t.name + ' (varies)' : t.name);
                return e.note ? label + ' (' + e.note + ')' : label;
            }).filter(function (n, i, arr) { return arr.indexOf(n) === i; });
            badge.title = 'Depends exactly which room this really is -- could be: ' + names.join(', ') + '.';
        }
        badge.appendChild(destPart);

        return badge;
    }

    // The exits to use when building a tree node for `id`. Only the root
    // (the room the player is actually standing in) can ever have a
    // resolved currentSpecificId, so only it gets the fully deterministic
    // "which real room is this" treatment; every deeper node uses the
    // room's plain merged exits, same as anywhere else this map shows a
    // blob it hasn't (and structurally can't, at that remove) disambiguated.
    // map.json's precomputed room.exits is a *union* of every real member's
    // exits, deduped by direction+target -- but it doesn't track which
    // members actually have each direction. A blob's real rooms usually
    // don't all share the same exits (Zork's Forest is the extreme case:
    // none of its 4 real rooms has all 5 directions the union shows), so
    // that union alone can present a direction as a normal exit when it
    // simply doesn't exist from whichever real room the player is actually
    // in. This rebuilds the exit list straight from every member's own raw
    // exits so each direction can be marked unreliable if even one member
    // lacks it -- including a member's own exit back into a different real
    // room of the *same* blob (a self-loop map.json's canonical merge
    // silently drops, since that's a real duplicate for line-drawing
    // purposes but a real, working exit for a player standing there).
    function blobExitsForDisplay(canonId) {
        var room = mapData.rooms[canonId];
        var memberIds = room.memberIds || [];
        var byDir = {}; // dir -> { presentIn: Set(memberId), targets: { canonTargetId: exit } }
        memberIds.forEach(function (memberId) {
            (rawExitsOf(memberId) || []).forEach(function (e) {
                var canonTarget = canonicalOf(e.target);
                var entry = byDir[e.dir] || (byDir[e.dir] = { presentIn: new Set(), targets: {} });
                entry.presentIn.add(memberId);
                if (!entry.targets[canonTarget]) {
                    var exit = { dir: e.dir, target: canonTarget };
                    if (e.note) exit.note = e.note;
                    entry.targets[canonTarget] = exit;
                }
            });
        });

        var result = [];
        Object.keys(byDir).forEach(function (dir) {
            var entry = byDir[dir];
            var reliable = entry.presentIn.size === memberIds.length;
            Object.keys(entry.targets).forEach(function (targetId) {
                var exit = entry.targets[targetId];
                if (!reliable) {
                    exit.unreliable = true;
                }
                result.push(exit);
            });
        });
        return result;
    }

    function exitsForNode(id, isRoot) {
        var room = mapData.rooms[id];
        if (!room) {
            return [];
        }
        if (isRoot && room.blob && currentSpecificId) {
            var raw = rawExitsOf(currentSpecificId);
            if (raw) {
                return raw.map(function (e) {
                    var out = { dir: e.dir, target: canonicalOf(e.target), rawTarget: e.target };
                    if (e.note) out.note = e.note;
                    return out;
                });
            }
        }
        if (room.blob && room.memberIds) {
            return blobExitsForDisplay(id);
        }
        return room.exits;
    }

    // Builds the "N levels deep" hierarchy rooted at the room the player
    // is actually standing in. Unlike a fixed grid, a tree has no trouble
    // representing loops or one-way shortcuts (the same room can simply
    // appear again down a different branch), so every exit is shown
    // directly here -- there's nothing structurally "hidden" the way a
    // straight grid line could fail to reach a non-adjacent room.
    function renderTree(container, rootId) {
        var rootRoom = mapData.rooms[rootId];
        if (!rootRoom) {
            return;
        }

        var rootLine = document.createElement('div');
        rootLine.className = 'map-tree-line map-tree-root';
        rootLine.textContent = rootRoom.blob ? rootRoom.name + ' (varies)' : rootRoom.name;
        container.appendChild(rootLine);

        if (rootRoom.blob) {
            var blobNote = document.createElement('div');
            blobNote.className = 'map-tree-note';
            blobNote.textContent = currentSpecificId
                ? "this name covers more than one real room, but based on how you got here, the exits below are for the specific one you're actually in."
                : "this name covers more than one real room -- exits marked “varies” depend on exactly which one you're in, and a dotted border means that direction doesn't exist from every one of them, so it might not work at all from here.";
            container.appendChild(blobNote);
        }

        if (exitsForNode(rootId, true).length === 0) {
            var none = document.createElement('div');
            none.className = 'map-tree-note';
            none.textContent = 'No exits known yet.';
            container.appendChild(none);
            return;
        }

        // LEARNING NOTE: walk() is recursive -- it calls itself (see the
        // `walk(candidates[0].target, level + 1, ...)` call near the
        // bottom) to build each deeper level of the tree from the level
        // above it. `level` is what stops it going forever: TREE_DEPTH
        // caps how many times it's allowed to recurse, so the function
        // keeps calling a slightly-modified version of itself on a
        // smaller/deeper piece of the problem until that stopping
        // condition is hit, then unwinds. This is a natural fit for a
        // tree shape, where "the rest of the tree below this node" is
        // itself just another (smaller) tree.
        function walk(id, level, prefix, parentId) {
            var dirGroups = groupExitsByDir(exitsForNode(id, level === 1));
            var dirs = sortDirs(new Set(Object.keys(dirGroups))).filter(function (d) {
                var candidates = dirGroups[d];
                // Skip the trivial "straight back where you came from" edge
                // one level up -- everything further back (a longer loop)
                // still shows, since that's genuinely useful to see.
                if (parentId && candidates.length === 1 && candidates[0].target === parentId) {
                    return false;
                }
                // Only the root's own exits (level 1) show where you could
                // go next, including "?" unknowns, "varies" guesses, and
                // conditional/unreliable exits with their dashed or dotted
                // border -- that's the point of showing them at all.
                // Levels 2 and 3 exist to show the *known, trustworthy* map
                // around you, so a branch only continues there if it leads
                // somewhere you've actually already found *and* nothing
                // about it is in question -- otherwise a real but
                // unreliable exit (say, a blob room's shortcut that only
                // exists in one of the real rooms behind that name) would
                // look exactly as solid as a guaranteed one once it's
                // nested a level or two deep, which is worse than not
                // showing it at all.
                if (level > 1) {
                    return candidates.length === 1
                        && visited.has(candidates[0].target)
                        && !candidates[0].unreliable
                        && !candidates[0].note;
                }
                return true;
            });

            dirs.forEach(function (d, i) {
                var isLast = i === dirs.length - 1;
                var candidates = dirGroups[d];

                var line = document.createElement('div');
                line.className = 'map-tree-line';
                var prefixSpan = document.createElement('span');
                prefixSpan.className = 'map-tree-prefix';
                prefixSpan.textContent = prefix + (isLast ? '└─ ' : '├─ ');
                line.appendChild(prefixSpan);

                if (isOneWayExit(candidates, id)) {
                    var oneWayMark = document.createElement('span');
                    oneWayMark.className = 'map-exit-oneway';
                    oneWayMark.textContent = '->';
                    oneWayMark.title = 'One-way -- there\'s no exit back this way.';
                    line.appendChild(oneWayMark);
                }

                line.appendChild(exitBadge(d, candidates));
                container.appendChild(line);

                if (candidates.length === 1 && visited.has(candidates[0].target) && level < TREE_DEPTH) {
                    var childPrefix = prefix + (isLast ? '   ' : '│  ');
                    walk(candidates[0].target, level + 1, childPrefix, id);
                }
            });
        }

        walk(rootId, 1, '', null);
    }

    function render() {
        levelsEl.innerHTML = '';

        if (!mapData) {
            return;
        }

        if (visited.size === 0 || !currentId || !mapData.rooms[currentId]) {
            var empty = document.createElement('p');
            empty.className = 'assist-note';
            empty.textContent = 'Nothing explored yet -- step outside and the map will start filling in.';
            levelsEl.appendChild(empty);
            return;
        }

        var treeContainer = document.createElement('div');
        treeContainer.className = 'map-tree';
        renderTree(treeContainer, currentId);
        levelsEl.appendChild(treeContainer);
    }

    function getStatusRoomName() {
        var line = document.querySelector('.GridWindow .GridLine');
        if (!line) {
            return null;
        }
        var text = line.textContent || '';
        return text.replace(/\s*Score:.*$/i, '').trim();
    }

    // LEARNING NOTE: this is the "debounce" pattern. The game's output can
    // mutate the DOM many times in quick succession for a single turn
    // (the echoed command, then the response, possibly line by line), and
    // each mutation would otherwise trigger a separate checkRoom() call.
    // Debouncing coalesces a burst of calls into just one: the first call
    // sets a timer and every call after it (while checkTimer is still set)
    // just returns early and does nothing, so only when the timer actually
    // *fires* -- 60ms after the last burst of activity settled -- does the
    // real work (checkRoom) run. setTimeout(fn, ms) schedules fn to run
    // once, after at least ms milliseconds, without blocking the rest of
    // the page in the meantime.
    var checkTimer = null;
    function scheduleCheck() {
        if (checkTimer) {
            return;
        }
        checkTimer = setTimeout(function () {
            checkTimer = null;
            checkRoom();
        }, 60);
    }

    // The raw (specific-real-room) id behind wherever the player currently
    // is, if knowable: currentSpecificId when we've resolved it, or
    // currentId itself when that's already a non-blob room (raw and
    // canonical are the same thing there) -- null only when standing in a
    // blob whose specific member genuinely isn't known.
    function currentRawId() {
        if (currentSpecificId) {
            return currentSpecificId;
        }
        if (currentId && mapData.rooms[currentId] && !mapData.rooms[currentId].blob) {
            return currentId;
        }
        return null;
    }

    function checkRoom() {
        if (!mapData) {
            return;
        }
        // Consumed once per check, whether or not it ends up usable below,
        // so a stale direction never lingers to be misapplied to some
        // later, unrelated change.
        var direction = pendingDir;
        pendingDir = null;

        // A recognized direction that the exact room we're in simply has no
        // exit for is a guaranteed no-op -- Zork's parser rejects it
        // outright ("You can't go that way") without attempting a move, so
        // there's nothing to verify against the status line and nothing to
        // lose track of. Handled before even reading the status line, since
        // this is already certain either way.
        var fromRawId = currentRawId();
        if (direction && fromRawId) {
            var fromExits = rawExitsOf(fromRawId);
            if (fromExits && !fromExits.some(function (e) { return e.dir === direction; })) {
                return;
            }
        }

        var name = getStatusRoomName();
        if (!name) {
            return;
        }
        var id = resolveRoomId(name);
        if (!id) {
            return;
        }

        // Try the exact, command-driven prediction first: if the player's
        // last move was a recognized direction from a known specific raw
        // room, and that room's real exit for it lands somewhere whose
        // canonical name matches what the status line actually now shows,
        // that's proof the prediction was right -- including the cases the
        // name-only fallback below genuinely can't handle, like moving to a
        // same-named sibling room inside the Maze or Coal Mine (where the
        // status line doesn't change at all) or resolving a blob's specific
        // member the instant it's first entered. A mismatch just means the
        // move didn't go as expected (a blocked exit, a conditional exit
        // whose flag isn't set yet, the bat's random drop in the mines...)
        // -- in that case this simply falls through to the honest
        // name-based handling further down, same as if no prediction had
        // been attempted at all.
        var predictedRaw = predictedRawTarget(direction, fromRawId);
        if (predictedRaw && canonicalOf(predictedRaw) === id) {
            if (predictedRaw !== currentSpecificId || id !== currentId) {
                currentSpecificId = predictedRaw;
                currentId = id;
                visited.add(id);
                saveState();
                render();
            }
            return;
        }

        if (id === currentId) {
            // The status line alone can't tell "stayed put" apart from
            // "moved to a same-named sibling room" for a blob with
            // internal exits (e.g. rowing further down the Frigid River)
            // -- so once that's possible, stop trusting a previously
            // resolved specific room rather than risk showing exits for
            // the wrong one.
            if (currentSpecificId && blobsWithInternalEdges.has(id)) {
                currentSpecificId = null;
                render();
            }
            return;
        }
        currentSpecificId = resolveSpecificId(id, fromRawId);
        currentId = id;
        visited.add(id);
        saveState();
        render();
    }

    // Watches the player's own typed commands so checkRoom can predict
    // exact movement (see predictedRawTarget) instead of only ever
    // comparing room names. A 'keydown' listener -- rather than 'keypress',
    // which is what both GlkOte's own input handling and js/undo.js's
    // "undo" interception key off -- guarantees this always reads the
    // command text first: keydown for Enter fires before keypress for the
    // same keystroke no matter what order listeners were attached in, so
    // there's no race with GlkOte clearing the field or undo.js diverting
    // the keystroke entirely. Delegated on document (rather than bound once
    // to a specific input element) since it keeps working even if GlkOte
    // ever recreates that element.
    function initCommandTracking() {
        // LEARNING NOTE: this is "event delegation". Instead of finding the
        // game's text input and attaching a listener directly to it, the
        // listener is attached once to `document` -- the whole page. Key
        // events on ANY element "bubble" up through their ancestors (input
        // -> its containers -> ... -> document), so a listener on document
        // still fires for every keypress anywhere. `ev.target` tells you
        // which actual element the event started on, so the `.matches(...)`
        // check filters that down to just the game's input. The payoff:
        // this keeps working even if GlkOte destroys and recreates that
        // input element between turns (which it does) -- a listener
        // attached directly to the old element would silently stop
        // firing the moment that element was replaced.
        document.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter') {
                return;
            }
            var target = ev.target;
            if (!target || typeof target.matches !== 'function' || !target.matches('#windowport input.Input')) {
                return;
            }
            pendingDir = parseDirection(target.value);
        });

        // Save/Load submit their command via a synthetic event this
        // listener never sees (see app.js's sendGameCommand), and a
        // restore can jump to a completely different room than any
        // direction predicts. Clearing defensively here means a stale
        // pendingDir from just before the click can never get misapplied
        // to wherever the restored game turns out to be.
        ['save-game', 'load-game', 'new-game'].forEach(function (id) {
            var button = document.getElementById(id);
            if (button) {
                button.addEventListener('click', function () { pendingDir = null; });
            }
        });
    }

    // LEARNING NOTE: MutationObserver is a browser API that watches part of
    // the page and calls your function whenever the DOM changes inside it
    // -- no polling ("check every N ms whether anything changed") needed.
    // `childList: true` means "tell me about elements being added/removed",
    // `subtree: true` extends that to descendants at any depth (not just
    // direct children of #windowport), and `characterData: true` covers
    // plain text changes. This is how the map knows a new turn just
    // happened: the game engine (GlkOte) is the one actually writing text
    // into #windowport, and this file has no direct hook into it, so
    // watching the DOM it produces is the only way to notice.
    function initObserver() {
        var target = document.getElementById('windowport');
        if (!target) {
            return;
        }
        var observer = new MutationObserver(scheduleCheck);
        observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    function initTabs() {
        // Generic over however many .assist-tab buttons exist -- each one's
        // aria-controls points at the panel it activates.
        var tabs = Array.prototype.slice.call(document.querySelectorAll('.assist-tab'));

        function activate(target) {
            tabs.forEach(function (tab) {
                var isActive = tab === target;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', String(isActive));
                var panel = document.getElementById(tab.getAttribute('aria-controls'));
                if (panel) {
                    panel.hidden = !isActive;
                }
            });
        }

        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () { activate(tab); });
        });
    }

    initTabs();
    initCommandTracking();
    loadState();

    // LEARNING NOTE: fetch() starts an HTTP request and returns a Promise --
    // an object representing "a value that will exist later, once this
    // finishes" -- rather than the actual response, since network requests
    // take time and JavaScript doesn't pause and wait for them. .then()
    // registers a callback to run once that Promise resolves, and itself
    // returns a new Promise, which is why these chain: the first .then()
    // takes the raw HTTP response and asks it to parse its body as JSON
    // (response.json() is ALSO async, so it returns its own Promise, and
    // returning a Promise from inside a .then() callback makes the *next*
    // .then() wait for it too, rather than firing early with the still-
    // pending Promise object itself). .catch() at the end catches an error
    // from the fetch or from either .then() -- e.g. no network, or the file
    // being missing.
    fetch('data/map.json')
        .then(function (response) { return response.json(); })
        .then(function (data) {
            mapData = data;
            Object.keys(data.rooms).forEach(function (id) {
                nameToId[data.rooms[id].name] = id;
            });
            blobsWithInternalEdges = computeBlobsWithInternalEdges();
            // Drop any persisted ids that no longer exist in the current map data.
            visited.forEach(function (id) {
                if (!mapData.rooms[id]) visited.delete(id);
            });
            render();
            initObserver();
            checkRoom();
        })
        .catch(function (err) {
            levelsEl.textContent = 'Could not load map data (' + err.message + ').';
            console.error(err);
        });
})();

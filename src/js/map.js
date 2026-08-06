(function () {
    'use strict';

    var VISITED_KEY = 'zork-assist-map-visited-v1';
    var CURRENT_KEY = 'zork-assist-map-current-v1';
    var TREE_DEPTH = 2;

    var mapData = null; // { start, rawToCanonical, rawExits, rooms: { id: {name, blob, exits:[{dir,target,note?}], memberIds?} } }
    var nameToId = {};
    var visited = new Set();
    var currentId = null;

    // Best guess at which *specific* real room the player is standing in,
    // when currentId is a blob -- see resolveSpecificId. Null whenever the
    // canonical name alone doesn't tell us (including for any non-blob
    // room, where the canonical id already IS the specific room, so this
    // only ever needs to hold a value while genuinely inside a blob).
    var currentSpecificId = null;
    var blobsWithInternalEdges = null; // Set, computed once mapData loads

    var levelsEl = document.getElementById('map-levels');
    var DIR_LABELS = {
        NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
        NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
        UP: 'Up', DOWN: 'Down', IN: 'In', OUT: 'Out', ENTER: 'Enter', LAND: 'Land'
    };
    var DIR_ORDER = ['NORTH', 'NE', 'EAST', 'SE', 'SOUTH', 'SW', 'WEST', 'NW', 'UP', 'DOWN', 'IN', 'OUT', 'ENTER', 'LAND'];

    function sortDirs(dirSet) {
        return DIR_ORDER.filter(function (d) { return dirSet.has(d); });
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
        Object.keys(mapData.rooms).forEach(function (canonId) {
            var room = mapData.rooms[canonId];
            if (!room.blob || !room.memberIds) {
                return;
            }
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
    function exitBadge(dir, candidates, fromId) {
        var badge = document.createElement('span');
        badge.className = 'map-exit-badge';

        var dirPart = document.createElement('span');
        dirPart.className = 'map-exit-dir';
        dirPart.textContent = DIR_LABELS[dir] || dir;
        badge.appendChild(dirPart);

        var destPart = document.createElement('span');
        destPart.className = 'map-exit-dest';

        var isOneWay = false;

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
            // A handful of Zork's exits only go one way (the coal mine
            // slide, the trap door once it swings shut...) -- if the
            // target has no exit back to where this edge started, there's
            // no walking back the way you came. Known even for an
            // unvisited "?" target, since it's a fact about the exit's
            // shape, not about what's actually in the room.
            if (fromId && target) {
                isOneWay = !target.exits.some(function (e) { return e.target === fromId; });
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

        if (isOneWay) {
            var oneWayMark = document.createElement('span');
            oneWayMark.className = 'map-exit-oneway';
            oneWayMark.textContent = '->';
            badge.appendChild(oneWayMark);
            badge.title = (badge.title ? badge.title + ' ' : '') + 'One-way -- there\'s no exit back this way.';
        }

        return badge;
    }

    // The exits to use when building a tree node for `id`. Only the root
    // (the room the player is actually standing in) can ever have a
    // resolved currentSpecificId, so only it gets the fully deterministic
    // "which real room is this" treatment; every deeper node uses the
    // room's plain merged exits, same as anywhere else this map shows a
    // blob it hasn't (and structurally can't, at that remove) disambiguated.
    function exitsForNode(id, isRoot) {
        var room = mapData.rooms[id];
        if (!room) {
            return [];
        }
        if (isRoot && room.blob && currentSpecificId) {
            var raw = rawExitsOf(currentSpecificId);
            if (raw) {
                return raw.map(function (e) {
                    var out = { dir: e.dir, target: canonicalOf(e.target) };
                    if (e.note) out.note = e.note;
                    return out;
                });
            }
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
                : "this name covers more than one real room -- exits marked “varies” depend on exactly which one you're in.";
            container.appendChild(blobNote);
        }

        if (exitsForNode(rootId, true).length === 0) {
            var none = document.createElement('div');
            none.className = 'map-tree-note';
            none.textContent = 'No exits known yet.';
            container.appendChild(none);
            return;
        }

        function walk(id, level, prefix, parentId) {
            var dirGroups = groupExitsByDir(exitsForNode(id, level === 1));
            var dirs = sortDirs(new Set(Object.keys(dirGroups))).filter(function (d) {
                var candidates = dirGroups[d];
                // Skip the trivial "straight back where you came from" edge
                // one level up -- everything further back (a longer loop)
                // still shows, since that's genuinely useful to see.
                return !(parentId && candidates.length === 1 && candidates[0].target === parentId);
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
                line.appendChild(exitBadge(d, candidates, id));
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
        var name = getStatusRoomName();
        if (!name) {
            return;
        }
        var id = resolveRoomId(name);
        if (!id) {
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
        currentSpecificId = resolveSpecificId(id, currentRawId());
        currentId = id;
        visited.add(id);
        saveState();
        render();
    }

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
    loadState();

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

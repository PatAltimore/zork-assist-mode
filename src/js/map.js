(function () {
    'use strict';

    var VISITED_KEY = 'zork-assist-map-visited-v1';
    var CURRENT_KEY = 'zork-assist-map-current-v1';

    var mapData = null; // { start, rawToCanonical, rooms: { id: {name, blob, level, x, y, exits:[{dir,target}], members?} } }
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
    var clearButton = document.getElementById('map-clear');
    var currentExitsEl = document.getElementById('map-current-exits');

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

    // Is there a real exit between these two rooms (either direction)? Used
    // to decide whether to draw a connector line -- deliberately direction-
    // agnostic, since Zork's own map has cases where an exit's *declared*
    // compass direction doesn't match where the room ended up on the grid
    // (see BUILD.md/tools/build-map.js); what matters here is just "can you
    // walk between these two adjacent cells".
    function connected(idA, idB) {
        var roomA = mapData.rooms[idA];
        var roomB = mapData.rooms[idB];
        if (!roomA || !roomB) return false;
        return roomA.exits.some(function (e) { return e.target === idB; }) ||
            roomB.exits.some(function (e) { return e.target === idA; });
    }

    // Is the exit relationship between two connected rooms one-way? Used to
    // draw an arrowhead on the connector line instead of a plain bar --
    // Zork's real geography has a handful of these (the coal mine slide,
    // the trapdoor, etc).
    function connectorDirectionClass(fromId, toId) {
        var fromRoom = mapData.rooms[fromId];
        var toRoom = mapData.rooms[toId];
        var forward = fromRoom.exits.some(function (e) { return e.target === toId; });
        var backward = toRoom.exits.some(function (e) { return e.target === fromId; });
        if (forward && backward) return '';
        if (forward) return ' one-way one-way-forward';
        if (backward) return ' one-way one-way-backward';
        return '';
    }

    // Exits whose target isn't the room's immediate N/S/E/W grid neighbor --
    // genuine shortcuts/loops (or a diagonal step) that the straight grid
    // connectors below can't draw as a line without crossing other rooms.
    // Surfaced instead as a "Hidden exits" row under Exits Here (see
    // renderCurrentExits) so they're not silently lost.
    function extraExits(room, exits) {
        return (exits || room.exits).filter(function (e) {
            var target = mapData.rooms[e.target];
            if (!target || target.level !== room.level) {
                return false; // level change -- already shown via Up/Down, not a grid line either way
            }
            var dx = target.x - room.x, dy = target.y - room.y;
            return Math.abs(dx) + Math.abs(dy) !== 1;
        });
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

    function buildTracks(count) {
        var tracks = [];
        for (var i = 0; i < count; i++) {
            if (i > 0) tracks.push('0.6em');
            tracks.push('1fr');
        }
        return tracks.join(' ');
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

    function levelLabel(level) {
        if (level === 0) return 'Surface';
        if (level > 0) return 'Above Ground (+' + level + ')';
        return 'Underground ' + level;
    }

    function frontierFor(level) {
        // Rooms not yet visited, but directly reachable from a visited room
        // on this level -- shown as "N ?" / "E ?" etc (the direction you'd
        // type to head that way) so players see there's more to find, and
        // which way, without spoiling what's actually there.
        var dirsByFrontier = {}; // id -> Set of raw direction strings
        visited.forEach(function (id) {
            var room = mapData.rooms[id];
            if (!room) return;
            room.exits.forEach(function (exit) {
                var target = mapData.rooms[exit.target];
                if (target && target.level === level && !visited.has(exit.target)) {
                    if (!dirsByFrontier[exit.target]) {
                        dirsByFrontier[exit.target] = new Set();
                    }
                    dirsByFrontier[exit.target].add(exit.dir);
                }
            });
        });
        return dirsByFrontier;
    }

    // A badge for one exit: the direction, and where it leads -- the
    // destination room name if you've already been there, or a plain "?"
    // if you haven't (so this doesn't spoil unexplored rooms). `candidates`
    // is normally a single exit, but can hold more than one when the real
    // rooms behind a blob genuinely disagree about where this direction
    // leads -- in that case we say so plainly instead of picking one.
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
            // the cyclops scared off...) -- flag those visually so this
            // never reads as a guaranteed way through before that's true,
            // regardless of whether the destination itself is known yet.
            if (candidate.note) {
                badge.classList.add('map-exit-conditional');
                badge.title = 'Not always open -- ' + candidate.note + '.';
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

    function exitsRow(labelText) {
        var row = document.createElement('div');
        row.className = 'map-exits-row';
        var label = document.createElement('span');
        label.className = 'map-exits-label';
        label.textContent = labelText;
        row.appendChild(label);
        return row;
    }

    function renderCurrentExits() {
        if (!currentExitsEl) {
            return;
        }
        currentExitsEl.innerHTML = '';
        if (!mapData || !currentId || !mapData.rooms[currentId]) {
            return;
        }

        var room = mapData.rooms[currentId];
        var mainRow = exitsRow('Exits here:');
        currentExitsEl.appendChild(mainRow);

        // If we've worked out exactly which real room is behind a blob's
        // name (see resolveSpecificId), use its own real exits instead of
        // the merged "could be any of them" view -- every direction
        // becomes deterministic at that point, since the ambiguity was
        // only ever about which real room this is, not about what that
        // real room's own exits are.
        var specificId = room.blob ? currentSpecificId : null;
        var rawExits = specificId ? rawExitsOf(specificId) : null;
        var effectiveExits = rawExits
            ? rawExits.map(function (e) { return { dir: e.dir, target: canonicalOf(e.target) }; })
            : room.exits;

        if (effectiveExits.length === 0) {
            var none = document.createElement('span');
            none.className = 'map-exits-note';
            none.textContent = room.blob
                ? "this name covers more than one real room, and none of them have a known exit yet."
                : 'none known yet.';
            mainRow.appendChild(none);
            return;
        }

        // Exits that only exist once some flag or object state is true
        // (the trap door propped open, the window open...) don't belong in
        // the plain "Exits here" list at all -- listed there, they read as
        // just as usable as every other exit, which is exactly the
        // confusion a dashed badge in the same row didn't fix. Pull them
        // out into their own row instead, so this list only ever contains
        // exits that work right now.
        var unconditionalExits = effectiveExits.filter(function (e) { return !e.note; });
        var conditionalExits = effectiveExits.filter(function (e) { return e.note; });

        var dirGroups = groupExitsByDir(unconditionalExits);
        var dirs = Object.keys(dirGroups);
        if (dirs.length === 0) {
            var noneOpen = document.createElement('span');
            noneOpen.className = 'map-exits-note';
            noneOpen.textContent = 'none open right now.';
            mainRow.appendChild(noneOpen);
        } else {
            sortDirs(new Set(dirs)).forEach(function (d) {
                mainRow.appendChild(exitBadge(d, dirGroups[d]));
            });
        }

        if (room.blob) {
            var blobNote = document.createElement('span');
            blobNote.className = 'map-exits-note';
            blobNote.textContent = specificId
                ? "this name covers more than one real room, but based on how you got here, these exits are for the specific one you're actually in."
                : "this name covers more than one real room -- exits marked “varies” depend on exactly which one you're in.";
            mainRow.appendChild(blobNote);
        }

        // A row for exits that exist in the source but need something done
        // first -- shown separately, with the requirement, rather than
        // mixed into the exits that just work.
        var lockedGroups = groupExitsByDir(conditionalExits);
        var lockedDirs = Object.keys(lockedGroups);
        if (lockedDirs.length > 0) {
            var lockedRow = exitsRow('Locked exits (not open yet):');
            sortDirs(new Set(lockedDirs)).forEach(function (d) {
                lockedRow.appendChild(exitBadge(d, lockedGroups[d]));
            });
            currentExitsEl.appendChild(lockedRow);
        }

        // A row for exits that loop or shortcut somewhere not adjacent to
        // this room on the grid -- there's no straight line to draw for
        // these, so without calling them out separately here they'd be
        // invisible on the map entirely. Locked exits already got their
        // own row above regardless of adjacency, so they're excluded here.
        var hiddenGroups = groupExitsByDir(extraExits(room, unconditionalExits));
        var hiddenDirs = Object.keys(hiddenGroups);
        if (hiddenDirs.length > 0) {
            var hiddenRow = exitsRow('Hidden exits (not drawn as lines):');
            sortDirs(new Set(hiddenDirs)).forEach(function (d) {
                hiddenRow.appendChild(exitBadge(d, hiddenGroups[d]));
            });
            currentExitsEl.appendChild(hiddenRow);
        }
    }

    function render() {
        levelsEl.innerHTML = '';
        renderCurrentExits();

        if (!mapData) {
            return;
        }

        if (visited.size === 0) {
            var empty = document.createElement('p');
            empty.className = 'assist-note';
            empty.textContent = 'Nothing explored yet -- step outside and the map will start filling in.';
            levelsEl.appendChild(empty);
            return;
        }

        var levelsUsed = {};
        visited.forEach(function (id) {
            var room = mapData.rooms[id];
            if (room) levelsUsed[room.level] = true;
        });

        var sortedLevels = Object.keys(levelsUsed).map(Number).sort(function (a, b) { return b - a; });

        sortedLevels.forEach(function (level) {
            var frontierDirs = frontierFor(level);
            var frontierIds = Object.keys(frontierDirs);
            var cellIds = Array.from(visited).filter(function (id) {
                return mapData.rooms[id] && mapData.rooms[id].level === level;
            }).concat(frontierIds);

            if (cellIds.length === 0) return;

            var xs = cellIds.map(function (id) { return mapData.rooms[id].x; });
            var ys = cellIds.map(function (id) { return mapData.rooms[id].y; });
            var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
            var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);

            var section = document.createElement('div');
            section.className = 'map-level';

            var heading = document.createElement('h3');
            heading.textContent = levelLabel(level);
            section.appendChild(heading);

            var cols = maxX - minX + 1;
            var rows = maxY - minY + 1;

            var grid = document.createElement('div');
            grid.className = 'map-grid';
            grid.style.gridTemplateColumns = buildTracks(cols);
            grid.style.gridTemplateRows = buildTracks(rows);

            // Doubled coordinates: rooms sit on odd tracks (1, 3, 5, ...),
            // connector lines sit on the even tracks between them -- so a
            // room at logical (x,y) lands on grid track (2*(x-minX)+1).
            var posToId = {};
            cellIds.forEach(function (id) {
                var room = mapData.rooms[id];
                posToId[room.x + ',' + room.y] = id;
            });

            cellIds.forEach(function (id) {
                var room = mapData.rooms[id];
                var cell = document.createElement('div');
                var isFrontier = !visited.has(id);
                cell.className = 'map-room' + (isFrontier ? ' frontier' : '') + (id === currentId ? ' current' : '');
                cell.style.gridColumn = String(2 * (room.x - minX) + 1);
                cell.style.gridRow = String(2 * (room.y - minY) + 1);

                if (isFrontier) {
                    var frontierDirLabels = sortDirs(frontierDirs[id]).map(function (d) {
                        return DIR_LABELS[d] || d;
                    });
                    var dirLabel = document.createElement('span');
                    dirLabel.className = 'dir-label';
                    dirLabel.textContent = frontierDirLabels.join('/');
                    var qMark = document.createElement('span');
                    qMark.className = 'q-mark';
                    qMark.textContent = '?';
                    cell.title = 'Not visited yet -- go ' + frontierDirLabels.join(' or ') + ' from where you are to find out what\'s here.';
                    cell.appendChild(dirLabel);
                    cell.appendChild(qMark);
                } else {
                    cell.textContent = room.name;
                    cell.title = room.blob ? room.name + ' (an area the game itself can\'t pin down further)' : room.name;
                }
                grid.appendChild(cell);

                // Draw a connector to the east/south neighbor only (each
                // adjacent pair gets visited exactly once this way).
                var eastId = posToId[(room.x + 1) + ',' + room.y];
                if (eastId && connected(id, eastId)) {
                    var hLine = document.createElement('div');
                    hLine.className = 'map-connector horizontal' +
                        (isFrontier || !visited.has(eastId) ? ' frontier-link' : '') +
                        connectorDirectionClass(id, eastId);
                    hLine.style.gridColumn = String(2 * (room.x - minX) + 2);
                    hLine.style.gridRow = String(2 * (room.y - minY) + 1);
                    grid.appendChild(hLine);
                }

                var southId = posToId[room.x + ',' + (room.y + 1)];
                if (southId && connected(id, southId)) {
                    var vLine = document.createElement('div');
                    vLine.className = 'map-connector vertical' +
                        (isFrontier || !visited.has(southId) ? ' frontier-link' : '') +
                        connectorDirectionClass(id, southId);
                    vLine.style.gridColumn = String(2 * (room.x - minX) + 1);
                    vLine.style.gridRow = String(2 * (room.y - minY) + 2);
                    grid.appendChild(vLine);
                }
            });

            section.appendChild(grid);
            levelsEl.appendChild(section);
        });
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

    if (clearButton) {
        clearButton.addEventListener('click', function () {
            visited.clear();
            currentId = null;
            try {
                localStorage.removeItem(VISITED_KEY);
                localStorage.removeItem(CURRENT_KEY);
            } catch (e) { /* ignore */ }
            render();
            checkRoom(); // Re-add wherever the player is currently standing.
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

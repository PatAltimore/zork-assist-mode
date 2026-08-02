(function () {
    'use strict';

    var VISITED_KEY = 'zork-assist-map-visited-v1';
    var CURRENT_KEY = 'zork-assist-map-current-v1';

    var mapData = null; // { start, rooms: { id: {name, blob, level, x, y, exits:[{dir,target}]} } }
    var nameToId = {};
    var visited = new Set();
    var currentId = null;

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

    function renderCurrentExits() {
        if (!currentExitsEl) {
            return;
        }
        currentExitsEl.innerHTML = '';
        if (!mapData || !currentId || !mapData.rooms[currentId]) {
            return;
        }

        var room = mapData.rooms[currentId];
        var label = document.createElement('span');
        label.className = 'map-exits-label';
        label.textContent = 'Exits here:';
        currentExitsEl.appendChild(label);

        if (room.blob) {
            var note = document.createElement('span');
            note.className = 'map-exits-note';
            note.textContent = "varies room to room here -- go by what the game tells you.";
            currentExitsEl.appendChild(note);
            return;
        }

        var dirs = sortDirs(new Set(room.exits.map(function (e) { return e.dir; })));
        if (dirs.length === 0) {
            var none = document.createElement('span');
            none.className = 'map-exits-note';
            none.textContent = 'none known yet.';
            currentExitsEl.appendChild(none);
            return;
        }
        dirs.forEach(function (d) {
            var badge = document.createElement('span');
            badge.className = 'map-exit-badge';
            badge.textContent = DIR_LABELS[d] || d;
            currentExitsEl.appendChild(badge);
        });
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
                    var dirLabel = document.createElement('span');
                    dirLabel.className = 'dir-label';
                    dirLabel.textContent = sortDirs(frontierDirs[id]).map(function (d) {
                        return DIR_LABELS[d] || d;
                    }).join('/');
                    var qMark = document.createElement('span');
                    qMark.className = 'q-mark';
                    qMark.textContent = '?';
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
                        (isFrontier || !visited.has(eastId) ? ' frontier-link' : '');
                    hLine.style.gridColumn = String(2 * (room.x - minX) + 2);
                    hLine.style.gridRow = String(2 * (room.y - minY) + 1);
                    grid.appendChild(hLine);
                }

                var southId = posToId[room.x + ',' + (room.y + 1)];
                if (southId && connected(id, southId)) {
                    var vLine = document.createElement('div');
                    vLine.className = 'map-connector vertical' +
                        (isFrontier || !visited.has(southId) ? ' frontier-link' : '');
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

    function checkRoom() {
        if (!mapData) {
            return;
        }
        var name = getStatusRoomName();
        if (!name) {
            return;
        }
        var id = nameToId[name];
        if (!id || id === currentId) {
            return;
        }
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

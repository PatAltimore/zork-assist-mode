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
        // on this level -- shown as an unlabeled "?" so players see there's
        // more to find without spoiling what it is.
        var frontier = new Set();
        visited.forEach(function (id) {
            var room = mapData.rooms[id];
            if (!room) return;
            room.exits.forEach(function (exit) {
                var target = mapData.rooms[exit.target];
                if (target && target.level === level && !visited.has(exit.target)) {
                    frontier.add(exit.target);
                }
            });
        });
        return frontier;
    }

    function render() {
        levelsEl.innerHTML = '';
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
            var frontier = frontierFor(level);
            var cellIds = Array.from(visited).filter(function (id) {
                return mapData.rooms[id] && mapData.rooms[id].level === level;
            }).concat(Array.from(frontier));

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

            var grid = document.createElement('div');
            grid.className = 'map-grid';
            grid.style.gridTemplateColumns = 'repeat(' + (maxX - minX + 1) + ', 1fr)';
            grid.style.gridTemplateRows = 'repeat(' + (maxY - minY + 1) + ', 1fr)';

            cellIds.forEach(function (id) {
                var room = mapData.rooms[id];
                var cell = document.createElement('div');
                var isFrontier = frontier.has(id) && !visited.has(id);
                cell.className = 'map-room' + (isFrontier ? ' frontier' : '') + (id === currentId ? ' current' : '');
                cell.style.gridColumn = (room.x - minX + 1);
                cell.style.gridRow = (room.y - minY + 1);
                cell.textContent = isFrontier ? '?' : room.name;
                if (!isFrontier) {
                    cell.title = room.blob ? room.name + ' (an area the game itself can\'t pin down further)' : room.name;
                }
                grid.appendChild(cell);
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
        var tabHints = document.getElementById('tab-hints');
        var tabMap = document.getElementById('tab-map');
        var viewHints = document.getElementById('hints-view');
        var viewMap = document.getElementById('map-view');

        function activate(tab) {
            var showMap = tab === 'map';
            tabHints.classList.toggle('active', !showMap);
            tabMap.classList.toggle('active', showMap);
            tabHints.setAttribute('aria-selected', String(!showMap));
            tabMap.setAttribute('aria-selected', String(showMap));
            viewHints.hidden = showMap;
            viewMap.hidden = !showMap;
        }

        tabHints.addEventListener('click', function () { activate('hints'); });
        tabMap.addEventListener('click', function () { activate('map'); });
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

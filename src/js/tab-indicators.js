(function () {
    'use strict';

    // Puts a small flashing indicator on the Hints/Map/Code tab buttons
    // whenever there's curated content for the room the player is
    // currently standing in and that tab isn't the one already open --
    // most useful while the Map tab stays open most of the time, so a
    // relevant Code Museum link or hint doesn't go unnoticed. Tracks the
    // current room independently via its own status-line watcher, the same
    // pattern map.js/codemuseum.js/undo.js each already use, since none of
    // these files share a module system to hook into each other directly.

    var mapData = null;
    var hintTopics = null; // [{id, rooms?}]
    var codeLinksData = null; // { byRoom: { roomId: [bookmarkKey, ...] } }
    var nameToRoomId = {};

    var hintTab = document.getElementById('tab-hints');
    var codeTab = document.getElementById('tab-code');

    // Mirrors map.js's resolveRoomId: the status line can arrive already
    // truncated to fit a narrow window, so fall back to an unambiguous
    // prefix match rather than failing outright.
    function resolveRoomId(name) {
        if (!name) {
            return null;
        }
        if (nameToRoomId[name]) {
            return nameToRoomId[name];
        }
        var candidates = Object.keys(nameToRoomId).filter(function (fullName) {
            return fullName.indexOf(name) === 0;
        });
        return candidates.length === 1 ? nameToRoomId[candidates[0]] : null;
    }

    function getStatusRoomName() {
        var line = document.querySelector('.GridWindow .GridLine');
        if (!line) {
            return null;
        }
        return (line.textContent || '').replace(/\s*Score:.*$/i, '').trim();
    }

    function setAlert(tab, on) {
        if (!tab) {
            return;
        }
        // Never flash a tab that's already open -- there's nothing to draw
        // attention to when you're already looking at it.
        var isActive = tab.classList.contains('active');
        tab.classList.toggle('tab-alert', !!on && !isActive);
    }

    function update(roomId) {
        if (!hintTopics || !codeLinksData) {
            return;
        }
        var hasHint = !!roomId && hintTopics.some(function (topic) {
            return topic.rooms && topic.rooms.indexOf(roomId) !== -1;
        });
        var hasCode = !!roomId && codeLinksData.byRoom && codeLinksData.byRoom[roomId] &&
            codeLinksData.byRoom[roomId].length > 0;
        setAlert(hintTab, hasHint);
        setAlert(codeTab, hasCode);
    }

    var currentRoomId = null;

    function recheckRoom() {
        currentRoomId = resolveRoomId(getStatusRoomName());
        update(currentRoomId);
    }

    var checkTimer = null;
    function scheduleCheck() {
        if (checkTimer) {
            return;
        }
        checkTimer = setTimeout(function () {
            checkTimer = null;
            recheckRoom();
        }, 90);
    }

    function initObserver() {
        var target = document.getElementById('windowport');
        if (!target) {
            return;
        }
        new MutationObserver(scheduleCheck).observe(target, { childList: true, subtree: true, characterData: true });
    }

    // Re-evaluate on every tab click so a tab's own alert clears the moment
    // it becomes active, and a still-relevant alert on another tab reflects
    // the new active tab correctly. Attached after map.js's own tab-click
    // listener (this script loads later in index.html), so by the time
    // this runs, the .active classes map.js just set are already in place.
    function initTabWatch() {
        Array.prototype.slice.call(document.querySelectorAll('.assist-tab')).forEach(function (tab) {
            tab.addEventListener('click', function () {
                update(currentRoomId);
            });
        });
    }

    Promise.all([
        fetch('data/map.json').then(function (r) { return r.json(); }),
        fetch('data/hints.json').then(function (r) { return r.json(); }),
        fetch('data/code-museum-links.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
        mapData = results[0];
        hintTopics = results[1];
        codeLinksData = results[2];
        Object.keys(mapData.rooms).forEach(function (id) {
            nameToRoomId[mapData.rooms[id].name] = id;
        });
        initTabWatch();
        initObserver();
        recheckRoom();
    }).catch(function (err) {
        console.error('Tab indicators: could not load data', err);
    });
})();

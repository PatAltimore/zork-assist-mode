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
    var hintTopicSelect = document.getElementById('hint-topic');

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

    // Every topic id tagged with this room, in hints.json's own order.
    function matchingTopicsForRoom(roomId) {
        if (!roomId || !hintTopics) {
            return [];
        }
        return hintTopics.filter(function (topic) {
            return topic.rooms && topic.rooms.indexOf(roomId) !== -1;
        }).map(function (topic) { return topic.id; });
    }

    function selectHintTopic(id) {
        if (!hintTopicSelect || hintTopicSelect.value === id) {
            return;
        }
        hintTopicSelect.value = id;
        // hints.js listens for this to reset the revealed tiers and
        // re-render; custom-select.js listens for it too, to keep the
        // visible dropdown button in sync with a change it didn't itself
        // originate from a click.
        hintTopicSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Jumps the hint picker to a topic for the room you're standing in, but
    // only right when you switch onto the Hints tab (see the click handler
    // below) -- not continuously while you're already reading it, since
    // that would yank the selection out from under you and reset your
    // revealed tiers just for walking somewhere. If more than one topic
    // covers this room (a handful of puzzles all touch the Living Room, for
    // instance), the one already selected wins if it's still one of the
    // matches -- so this never overrides a choice you've already made that
    // still applies -- and otherwise this falls back to the first match in
    // hints.json's own order.
    function jumpToRoomTopicIfAny() {
        var matches = matchingTopicsForRoom(currentRoomId);
        if (matches.length === 0) {
            return;
        }
        if (hintTopicSelect && matches.indexOf(hintTopicSelect.value) !== -1) {
            return;
        }
        selectHintTopic(matches[0]);
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
                if (tab === hintTab) {
                    jumpToRoomTopicIfAny();
                }
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

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
    var hintRoomSection = document.getElementById('hint-room-section');
    var hintRoomNameEl = document.getElementById('hint-room-name');
    var hintRoomTopicsEl = document.getElementById('hint-room-topics');

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

    // LEARNING NOTE: update() calls renderHintRoomSection() even though
    // that function is defined further down this file, below update()
    // itself. This works because of "function hoisting": a `function foo()
    // {}` declaration (unlike `var foo = function () {}`) is fully set up
    // before any code in its scope runs, so it can be called from code
    // written above it in the file. It only reads oddly if you're used to
    // languages that require strict top-to-bottom definition order.
    function update(roomId) {
        if (!hintTopics || !codeLinksData) {
            return;
        }
        // `!!roomId` -- two `!` in a row -- converts any value to a real
        // boolean: the first `!` negates it (so a truthy roomId becomes
        // `false`, a falsy one becomes `true`), and the second `!`
        // negates that back, landing on `true`/`false` instead of
        // whatever roomId's original type was (a string or `null`).
        // Written out longhand, `!!roomId && x.some(...)` is just "only
        // bother checking .some() if roomId is actually set".
        var hasHint = !!roomId && hintTopics.some(function (topic) {
            return topic.rooms && topic.rooms.indexOf(roomId) !== -1;
        });
        var hasCode = !!roomId && codeLinksData.byRoom && codeLinksData.byRoom[roomId] &&
            codeLinksData.byRoom[roomId].length > 0;
        setAlert(hintTab, hasHint);
        setAlert(codeTab, hasCode);
        renderHintRoomSection(roomId);
    }

    // Every topic tagged with this room, in hints.json's own order.
    function topicsForRoom(roomId) {
        if (!roomId || !hintTopics) {
            return [];
        }
        return hintTopics.filter(function (topic) {
            return topic.rooms && topic.rooms.indexOf(roomId) !== -1;
        });
    }

    // Same list, just ids -- what jumpToRoomTopicIfAny needs.
    function matchingTopicsForRoom(roomId) {
        return topicsForRoom(roomId).map(function (topic) { return topic.id; });
    }

    // Mirrors codemuseum.js's own "Here: <room>" section -- a standing,
    // always-current list of whatever hint topics apply to wherever the
    // player actually is right now, kept in sync on every room change
    // (unlike jumpToRoomTopicIfAny, which deliberately only fires on a tab
    // switch). Each entry is just a button rather than a real link, since
    // picking one selects that topic in the picker below instead of
    // navigating anywhere -- clicking one you're already on is a harmless
    // no-op via selectHintTopic's own guard.
    function renderHintRoomSection(roomId) {
        if (!hintRoomSection || !hintRoomTopicsEl || !mapData) {
            return;
        }
        var topics = topicsForRoom(roomId);
        if (topics.length === 0) {
            hintRoomSection.hidden = true;
            return;
        }
        hintRoomSection.hidden = false;
        var room = mapData.rooms[roomId];
        hintRoomNameEl.textContent = room ? room.name : roomId;
        hintRoomTopicsEl.innerHTML = '';
        topics.forEach(function (topic) {
            var li = document.createElement('li');
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'hint-room-topic-button';
            button.textContent = topic.title;
            button.addEventListener('click', function () { selectHintTopic(topic.id); });
            li.appendChild(button);
            hintRoomTopicsEl.appendChild(li);
        });
    }

    function selectHintTopic(id) {
        if (!hintTopicSelect || hintTopicSelect.value === id) {
            return;
        }
        hintTopicSelect.value = id;
        // LEARNING NOTE: setting .value on a <select> directly, the way
        // the line above does, does NOT fire the browser's own "change"
        // event -- that only happens automatically when a *user* picks an
        // option. So this manually constructs and dispatches one: `new
        // Event('change', { bubbles: true })` creates an event object of
        // the same kind the browser would have fired, and `bubbles: true`
        // means it propagates up through ancestor elements the normal way,
        // so any listener anywhere (not just one attached directly to this
        // element) sees it. hints.js listens for this to reset the
        // revealed tiers and re-render; custom-select.js listens for it
        // too, to keep the visible dropdown button in sync with a change
        // it didn't itself originate from a click.
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
        // LEARNING NOTE: document.querySelectorAll() returns a NodeList,
        // which looks and acts a lot like an array (it has a .length and
        // you can index into it with []) but is missing most real array
        // methods -- notably .forEach() used below didn't even exist on
        // NodeList in older browsers. `Array.prototype.slice.call(list)`
        // is the classic pre-ES6 trick for converting any "array-like"
        // object into a genuine Array: it borrows Array's own .slice()
        // method and runs it with `list` standing in for the array it
        // would normally operate on, which works because .slice() only
        // actually cares that its target has a .length and numbered
        // properties, not that it's really an Array. Modern code would
        // more often write `Array.from(list)` for the same result.
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

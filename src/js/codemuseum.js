(function () {
    'use strict';

    // Surfaces links to Code Museum (github.com/PatAltimore/code-museum),
    // which annotates the *original* 1977 MIT MDL mainframe source Zork was
    // written in -- a different codebase than the ZIL/Infocom port this
    // game runs (different routine/file names), but the same rooms and
    // puzzles. The mapping in data/code-museum-links.json is hand-curated
    // for that reason -- there's no automatic way to derive it from either
    // source tree.

    var linksData = null; // { base, bookmarks, general, byRoom, byHintTopic }
    var roomIdToName = {};
    var nameToRoomId = {};
    var hintTopics = []; // [{id, title}]

    var roomSection = document.getElementById('code-room-section');
    var roomNameEl = document.getElementById('code-room-name');
    var roomLinksEl = document.getElementById('code-room-links');
    var topicSelect = document.getElementById('code-topic');
    var topicLinksEl = document.getElementById('code-topic-links');
    var generalLinksEl = document.getElementById('code-general-links');

    function bookmarkUrl(key) {
        var bm = linksData.bookmarks[key];
        if (!bm) return null;
        return linksData.base + bm.path;
    }

    function renderLinks(container, keys) {
        container.innerHTML = '';
        if (!keys || keys.length === 0) {
            var li = document.createElement('li');
            li.className = 'code-links-empty';
            li.textContent = 'No Code Museum notes here yet.';
            container.appendChild(li);
            return;
        }
        keys.forEach(function (key) {
            var bm = linksData.bookmarks[key];
            var url = bookmarkUrl(key);
            if (!bm || !url) return;
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = bm.title + ' ↗';
            li.appendChild(a);
            if (bm.blurb) {
                var blurb = document.createElement('span');
                blurb.className = 'code-link-blurb';
                blurb.textContent = bm.blurb;
                li.appendChild(blurb);
            }
            container.appendChild(li);
        });
    }

    function renderGeneral() {
        renderLinks(generalLinksEl, linksData.general);
    }

    function renderTopic() {
        var topicId = topicSelect.value;
        renderLinks(topicLinksEl, linksData.byHintTopic[topicId]);
    }

    function renderRoom(roomId) {
        var keys = roomId && linksData.byRoom[roomId];
        if (!keys || keys.length === 0) {
            roomSection.hidden = true;
            return;
        }
        roomSection.hidden = false;
        roomNameEl.textContent = roomIdToName[roomId] || roomId;
        renderLinks(roomLinksEl, keys);
    }

    function populateTopicSelect() {
        topicSelect.innerHTML = '';
        hintTopics.forEach(function (topic) {
            var option = document.createElement('option');
            option.value = topic.id;
            option.textContent = topic.title;
            topicSelect.appendChild(option);
        });
    }

    // --- Track the current room independently, the same way map.js and
    //     undo.js each watch the status line -- simplest way to react to
    //     room changes without coupling this file to map.js's internals.
    function getStatusRoomName() {
        var line = document.querySelector('.GridWindow .GridLine');
        if (!line) return null;
        return (line.textContent || '').replace(/\s*Score:.*$/i, '').trim();
    }

    // The Z-machine's own status-line opcode sizes the room name to fit the
    // current window, so on a narrow screen it can arrive here already cut
    // down to a prefix (e.g. "North of Ho"). Fall back to matching that
    // prefix, but only when it's unambiguous -- see map.js's identical
    // resolveRoomId, which this mirrors since the two files don't share a
    // module system.
    function resolveRoomId(name) {
        if (!name) return null;
        if (nameToRoomId[name]) return nameToRoomId[name];
        var candidates = Object.keys(nameToRoomId).filter(function (fullName) {
            return fullName.indexOf(name) === 0;
        });
        return candidates.length === 1 ? nameToRoomId[candidates[0]] : null;
    }

    var lastRoomName = null;
    var checkTimer = null;
    function scheduleRoomCheck() {
        if (checkTimer) return;
        checkTimer = setTimeout(function () {
            checkTimer = null;
            var name = getStatusRoomName();
            if (!name || name === lastRoomName) return;
            lastRoomName = name;
            renderRoom(resolveRoomId(name));
        }, 80);
    }

    function initObserver() {
        var target = document.getElementById('windowport');
        if (!target) return;
        var observer = new MutationObserver(scheduleRoomCheck);
        observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    if (topicSelect) {
        topicSelect.addEventListener('change', renderTopic);
    }

    Promise.all([
        fetch('data/code-museum-links.json').then(function (r) { return r.json(); }),
        fetch('data/map.json').then(function (r) { return r.json(); }),
        fetch('data/hints.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
        linksData = results[0];
        var mapData = results[1];
        hintTopics = results[2].map(function (t) { return { id: t.id, title: t.title }; });

        Object.keys(mapData.rooms).forEach(function (id) {
            roomIdToName[id] = mapData.rooms[id].name;
            nameToRoomId[mapData.rooms[id].name] = id;
        });

        populateTopicSelect();
        renderGeneral();
        renderTopic();
        renderRoom(resolveRoomId(getStatusRoomName()));
        initObserver();
    }).catch(function (err) {
        generalLinksEl.textContent = 'Could not load Code Museum links (' + err.message + ').';
        console.error(err);
    });
})();

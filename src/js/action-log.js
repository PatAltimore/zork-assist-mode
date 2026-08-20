(function () {
    'use strict';

    // A small "recent actions" log in the Code tab -- Zork's version of the
    // action-logging instrumentation built for the Prince of Persia Assist
    // project (see that repo's web/src/emulator/ActionLog.ts and its call
    // sites). That version polls specific 6502 RAM addresses every emulator
    // tick, since apple2js is a real CPU emulator with directly addressable
    // memory. There's no equivalent here: vendor/zvm.min.js is a Z-machine
    // interpreter, not something this page can peek raw memory out of, and
    // even if it were, Z-machine global-variable numbers aren't standardized
    // -- they're whatever Infocom's own compiler happened to assign when
    // zork1.z3 was built, decades ago, with no debug symbols shipped. So
    // this watches the same *rendered text* every other file in this
    // project already watches (the status line, the game's own output)
    // instead of memory -- a different, higher layer, but the same
    // event-driven idea: notice something notable happened, log it once
    // (deduped by category, like the original), link it to the source that
    // explains it.
    //
    // Deliberately reuses data/code-museum-links.json's existing byRoom and
    // byHintTopic tables for the actual source links, rather than curating
    // a separate list -- those are already verified against this project's
    // ZIL source, and reusing them means a room or puzzle only ever needs
    // to be mapped to its explainer article in one place.

    var mapData = null;
    var codeLinksData = null; // { base, bookmarks, byRoom, byHintTopic }
    var nameToRoomId = {};

    var WINDOW_MS = 5 * 60 * 1000;
    var entries = new Map(); // category -> { category, timestamp, label, filenameKeys }

    function logAction(category, label, filenameKeys) {
        entries.set(category, { category: category, timestamp: Date.now(), label: label, filenameKeys: filenameKeys || [] });
        render();
    }

    function getRecentActions() {
        var cutoff = Date.now() - WINDOW_MS;
        var list = [];
        entries.forEach(function (entry, category) {
            if (entry.timestamp < cutoff) {
                entries.delete(category);
            } else {
                list.push(entry);
            }
        });
        list.sort(function (a, b) { return b.timestamp - a.timestamp; });
        return list;
    }

    // --- Room resolution (same pattern as map.js/codemuseum.js/etc.) ------

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

    function getStatusScore() {
        var line = document.querySelector('.GridWindow .GridLine');
        if (!line) {
            return null;
        }
        var match = (line.textContent || '').match(/Score:\s*(-?\d+)/i);
        return match ? parseInt(match[1], 10) : null;
    }

    var currentRoomId = null;

    function recheckRoom() {
        var id = resolveRoomId(getStatusRoomName());
        if (!id || id === currentRoomId) {
            return;
        }
        currentRoomId = id;
        var keys = codeLinksData.byRoom[id];
        // Only logged when there's real curated content for this room --
        // matching codemuseum.js's own "Here" section, which hides itself
        // for the same reason: most rooms have nothing specific to link,
        // and a room-change entry with no working links would break the
        // whole point of this list.
        if (keys && keys.length > 0) {
            var room = mapData.rooms[id];
            logAction('room:' + id, 'Entered ' + (room ? room.name : id), keys);
        }
    }

    // One slot, always overwritten on change (like PoP's own 'level'
    // category) rather than one entry per score value -- score climbs
    // steadily over a session as treasures get cased, so a history of
    // every past bump would just crowd out everything else; only the most
    // recent change is actually "recent."  lastScore starting null (rather
    // than the game's real starting score of 0) is deliberate: it means
    // the very first reading only baselines silently instead of logging a
    // nonsense "rose from nothing" entry the moment the page loads.
    var lastScore = null;

    function recheckScore() {
        var score = getStatusScore();
        if (score === null) {
            return;
        }
        if (lastScore !== null && score !== lastScore) {
            var delta = score - lastScore;
            var label = delta > 0
                ? 'Score rose to ' + score + ' (+' + delta + ')'
                : 'Score dropped to ' + score + ' (' + delta + ')';
            // No dedicated Code Museum article about the scoring/TVALUE
            // mechanism exists in the curated set -- this is hints.json's
            // own pre-existing "scoring" topic mapping, reused as-is rather
            // than inventing a closer-sounding link that isn't actually
            // there.
            var keys = codeLinksData.byHintTopic.scoring;
            if (keys && keys.length > 0) {
                logAction('score', label, keys);
            }
        }
        lastScore = score;
    }

    // --- Command-driven detection (combat, puzzle solves, inventory) ------

    // Keyed by every word that should resolve to it (see OBJECT LAMP's own
    // (SYNONYM LAMP LANTERN LIGHT) in 1dungeon.zil) -- a real gap until now,
    // since "take lantern" (a completely reasonable, verified-real synonym)
    // silently matched nothing at all.
    var ITEMS = {
        sword: 'sword', knife: 'knife', wrench: 'wrench', screwdriver: 'screwdriver',
        egg: 'egg', bell: 'bell', candles: 'candles', book: 'book', rope: 'rope',
        coal: 'coal', sceptre: 'sceptre', garlic: 'garlic',
        lamp: 'lamp', lantern: 'lamp'
    };
    var TAKE_VERBS = ['take', 'get', 'grab', 'pick up', 'carry'];
    var DROP_VERBS = ['drop', 'put down', 'discard'];

    // Puzzle/combat commands worth calling out, each tied to an existing
    // hints.json/code-museum-links.json topic id for its source links.
    // Deliberately matched on the *command itself* (like the original
    // project's fight-button logging, which also doesn't verify a fight
    // actually landed) rather than the game's own response text: Zork's
    // combat/puzzle prose is heavily randomized (see 1actions.zil's
    // PICK-ONE/RANDOM-ELEMENT remark tables), which would make exact-text
    // matching fragile in a way command-matching isn't.
    var COMMAND_RULES = [
        { pattern: /^(kill|attack|fight)\s+troll\b/, category: 'combat:troll', label: 'Fought the troll', topic: 'troll', room: 'TROLL-ROOM' },
        { pattern: /^(kill|attack|fight)\s+thief\b/, category: 'combat:thief', label: 'Fought the thief', topic: 'thief' },
        { pattern: /^say\s+(ulysses|odysseus)$/, category: 'puzzle:cyclops', label: 'Said the magic word', topic: 'cyclops', room: 'CYCLOPS-ROOM' },
        { pattern: /^echo$/, category: 'puzzle:echo', label: 'Said "echo"', topic: 'echo-room', room: 'LOUD-ROOM' },
        { pattern: /^turn\s+bolt\s+with\s+wrench$/, category: 'puzzle:dam', label: 'Turned the dam control bolt', topic: 'dam', room: 'DAM-ROOM' },
        { pattern: /^rub\s+mirror$/, category: 'puzzle:mirror', label: 'Rubbed the mirror', topic: 'mirror-room', room: 'GROUP-MIRROR-ROOM' },
        { pattern: /^(unlock\s+grate\s+with\s+key|open\s+grate)$/, category: 'puzzle:grate', label: 'Opened the grate', topic: 'maze', room: 'GRATING-ROOM' },
        // Same category for both -- they're the two halves of one puzzle
        // (move the rug to find the trap door, then open it), so whichever
        // one the player just did should refresh a single entry rather than
        // showing two near-duplicate lines.
        { pattern: /^move\s+rug$/, category: 'puzzle:trapdoor', label: 'Moved the rug', topic: 'trapdoor', room: 'LIVING-ROOM' },
        { pattern: /^open\s+trap\s*door$/, category: 'puzzle:trapdoor', label: 'Opened the trap door', topic: 'trapdoor', room: 'LIVING-ROOM' },
        { pattern: /^turn\s+on\s+lamp$/, category: 'puzzle:light', label: 'Turned on the lamp', topic: 'light' }
    ];

    // A small queue, not a single slot: checkPendingAction only runs on the
    // debounced MutationObserver callback (see scheduleCheck), which can
    // legitimately lag behind real typing -- most dramatically right after
    // this tab comes back from being backgrounded (e.g. the player opened
    // a Code Museum link in a new tab), since browsers throttle a hidden
    // tab's timers. A single-slot design confirmed live to lose actions in
    // exactly that situation: type "take lantern", then "move rug" before
    // the first check ever runs, and the second command's bookkeeping
    // silently overwrote the first's before it was ever verified -- the
    // lantern take just vanished. Queueing means every recent attempt gets
    // its own chance to be confirmed against the text that actually
    // resulted, not just whichever was typed last. Capped and aged out
    // (see checkPendingAction) so a typo or an attempt that never
    // succeeds doesn't sit around indefinitely, ready to falsely match
    // some unrelated "Taken." several turns later.
    var pendingActions = [];
    var MAX_PENDING = 5;
    var MAX_PENDING_AGE = 3;

    function matchItem(word) {
        return ITEMS[word] || null;
    }

    function recordPendingAction(raw) {
        var text = raw.trim().toLowerCase().replace(/[.,!]+$/, '');
        for (var i = 0; i < COMMAND_RULES.length; i++) {
            var rule = COMMAND_RULES[i];
            if (rule.pattern.test(text) && (!rule.room || rule.room === currentRoomId)) {
                var keys = codeLinksData.byHintTopic[rule.topic];
                if (keys && keys.length > 0) {
                    logAction(rule.category, rule.label, keys);
                }
                return;
            }
        }

        var words = text.split(/\s+/);
        var verb = words[0];
        var rest = words.slice(1).join(' ');
        if (words.length > 1 && (verb === 'pick' || verb === 'put') && words[1] === (verb === 'pick' ? 'up' : 'down')) {
            verb = verb + ' ' + words[1];
            rest = words.slice(2).join(' ');
        }
        var itemId = matchItem(rest.split(/\s+/).pop());
        if (!itemId) {
            return;
        }
        var type = TAKE_VERBS.indexOf(verb) !== -1 ? 'take' : DROP_VERBS.indexOf(verb) !== -1 ? 'drop' : null;
        if (!type) {
            return;
        }
        pendingActions.push({ type: type, item: itemId, age: 0 });
        if (pendingActions.length > MAX_PENDING) {
            pendingActions.shift();
        }
    }

    // Confirmed against the game's own next response, same as
    // command-suggestions.js's identical check -- a typed "take X" can
    // still fail (wrong room, not actually present, over capacity), so
    // this only logs once the game actually says so. Note this can't tell
    // *which* pending "Taken." belongs to which queued attempt if more than
    // one is waiting at once (e.g. two takes both still unresolved) -- a
    // known, accepted best-effort limitation, same spirit as the rest of
    // this project's inventory tracking, which already leans on the
    // player's own next "inventory" check to resync anything this misses.
    function checkPendingAction(newText) {
        if (pendingActions.length === 0) {
            return;
        }
        pendingActions = pendingActions.filter(function (action) {
            var verified = action.type === 'take'
                ? newText.indexOf('Taken.') !== -1
                : newText.indexOf('Dropped.') !== -1;
            if (verified) {
                var label = (action.type === 'take' ? 'Took the ' : 'Dropped the ') + action.item;
                // "How the game looks up a room or object by name" --
                // genuinely the relevant explainer for what just happened
                // (resolving the typed object name), not a stretch tie-in.
                logAction('item:' + action.item, label, ['find-room-and-find-obj']);
                return false; // resolved, drop from the queue
            }
            action.age += 1;
            return action.age < MAX_PENDING_AGE; // drop once stale, never matched
        });
    }

    // --- Wiring -----------------------------------------------------------

    function isGameInput(el) {
        return !!el && typeof el.matches === 'function' && el.matches('#windowport input.Input');
    }

    function onKeyDown(ev) {
        if (ev.key !== 'Enter' || !isGameInput(ev.target)) {
            return;
        }
        var trimmed = ev.target.value.trim();
        if (trimmed) {
            recordPendingAction(trimmed);
        }
    }

    var lastSeenTextLength = 0;

    function getAllBufferText() {
        var lines = document.querySelectorAll('.BufferWindow .BufferLine');
        var text = '';
        lines.forEach(function (line) { text += line.textContent + '\n'; });
        return text;
    }

    var checkTimer = null;
    function scheduleCheck() {
        if (checkTimer) {
            return;
        }
        checkTimer = setTimeout(function () {
            checkTimer = null;
            var fullText = getAllBufferText();
            recheckRoom(); // before checkPendingAction, so a room-gated rule sees the *new* room
            recheckScore();
            if (fullText.length > lastSeenTextLength) {
                checkPendingAction(fullText.slice(lastSeenTextLength));
            }
            lastSeenTextLength = fullText.length;
        }, 90);
    }

    function initObserver() {
        var target = document.getElementById('windowport');
        if (!target) {
            return;
        }
        target.addEventListener('keydown', onKeyDown, true);
        new MutationObserver(scheduleCheck).observe(target, { childList: true, subtree: true, characterData: true });
    }

    // --- Rendering ----------------------------------------------------

    function formatRelativeTime(timestamp) {
        var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
        if (seconds < 5) {
            return 'just now';
        }
        if (seconds < 60) {
            return seconds + 's ago';
        }
        return Math.round(seconds / 60) + 'm ago';
    }

    function bookmarkUrl(key) {
        var bm = codeLinksData.bookmarks[key];
        return bm ? codeLinksData.base + bm.path : null;
    }

    var listEl = document.getElementById('action-log-list');
    var emptyEl = document.getElementById('action-log-empty');
    var rowsByCategory = new Map();

    function buildRow(entry) {
        var item = document.createElement('li');

        var time = document.createElement('span');
        time.className = 'action-log-time';

        var label = document.createElement('span');
        label.className = 'action-log-label';

        var links = document.createElement('span');
        links.className = 'action-log-links';
        entry.filenameKeys.forEach(function (key) {
            var bm = codeLinksData.bookmarks[key];
            var url = bookmarkUrl(key);
            if (!bm || !url) {
                return;
            }
            var a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = bm.title;
            links.appendChild(a);
        });

        item.appendChild(time);
        item.appendChild(label);
        item.appendChild(links);
        return { item: item, time: time, label: label };
    }

    // In-place reconciliation rather than a full rebuild on every render --
    // ported directly from the Prince of Persia project's own version of
    // this section, where a naive rebuild on every update was confirmed
    // live to break mid-click link interaction and hover state. Zork
    // updates far less often (once per submitted command, not 60 times a
    // second), so the odds of hitting that exact failure are lower here,
    // but the fix costs nothing and there's no reason to reintroduce a bug
    // that's already been found and fixed once.
    function render() {
        if (!listEl || !codeLinksData) {
            return;
        }
        var actions = getRecentActions(); // newest-updated first
        emptyEl.hidden = actions.length > 0;

        var seen = new Set();
        actions.forEach(function (entry) {
            seen.add(entry.category);
            var row = rowsByCategory.get(entry.category);
            if (!row) {
                row = buildRow(entry);
                rowsByCategory.set(entry.category, row);
            }
            row.time.textContent = formatRelativeTime(entry.timestamp);
            row.label.textContent = entry.label;
            listEl.appendChild(row.item); // re-attaching an attached node just moves it
        });

        rowsByCategory.forEach(function (row, category) {
            if (!seen.has(category)) {
                row.item.remove();
                rowsByCategory.delete(category);
            }
        });
    }

    // Relative timestamps ("2m ago") go stale without a re-render even when
    // nothing new has happened.
    setInterval(render, 30000);

    Promise.all([
        fetch('data/map.json').then(function (r) { return r.json(); }),
        fetch('data/code-museum-links.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
        mapData = results[0];
        codeLinksData = results[1];
        Object.keys(mapData.rooms).forEach(function (id) {
            nameToRoomId[mapData.rooms[id].name] = id;
        });
        lastSeenTextLength = getAllBufferText().length;
        initObserver();
        recheckRoom();
        recheckScore();
        render();
    }).catch(function (err) {
        console.error('Action log: could not load data', err);
    });
})();

(function () {
    'use strict';

    // Suggests commands, cycled into the input box with Tab (Shift+Tab goes
    // back) or a double-tap. Two modes, switched with the Walkthrough /
    // Suggestions buttons at the top of the Hints tab:
    //
    //  - Walkthrough: the next step of data/walkthrough.json comes first --
    //    the game has no on-screen checklist, so progress is worked out from
    //    what the page can already see (the room name, what's been picked
    //    up, distinctive text in the game's replies). See walkthrough-logic.js,
    //    which this file and tools/verify-walkthrough.js share.
    //  - Suggestions: just ideas for the current room -- a mix of genuinely useful
    //    commands for whatever puzzle it holds and a few that show off the
    //    game's own sense of humor.
    //
    // Either way, room and inventory are tracked via passive observation of
    // the page, the same pattern map.js/codemuseum.js/tab-indicators.js each
    // already use, since none of these files share a module system to hook
    // into each other directly.
    //
    // Up/Down are deliberately left alone: they belong to GlkOte's own
    // command history (vendor/glkote.js, win.history/historypos).

    var Walkthrough = window.ZorkWalkthrough;

    var STORAGE_KEY_PROGRESS = 'zork-assist-walkthrough-v1';
    var STORAGE_KEY_MODE = 'zork-assist-suggest-mode';

    var mapData = null;
    var commandsData = null; // { items: {id: {match, aliases?, inv?}}, general: [...], byRoom: {...} }
    var steps = []; // data/walkthrough.json's steps
    var resolveRoomId = null;
    var tracker = null; // what's held / put in the trophy case

    var currentRoomId = null;
    var mode = 'walkthrough'; // or 'hints'

    var doneSteps = {}; // step id -> true; sticky, so undo/dropping never un-completes a step
    // Commands typed since the last check, for steps that can only be
    // recognized by what was typed (see walkthrough-logic.js's "cmd").
    var submitted = [];

    var suggestions = [];
    var suggestionIndex = -1; // -1 = not currently browsing a suggestion
    var lastProgrammaticValue = null;

    function getStatusRoomName() {
        var line = document.querySelector('.GridWindow .GridLine');
        if (!line) {
            return null;
        }
        return (line.textContent || '').replace(/\s*Score:.*$/i, '').trim();
    }

    function getStatusScore() {
        var line = document.querySelector('.GridWindow .GridLine');
        var match = line && /Score:\s*(-?\d+)/i.exec(line.textContent || '');
        return match ? parseInt(match[1], 10) : null;
    }

    // --- Persistence -----------------------------------------------------

    // Which steps are done survives a page reload (the game itself already
    // autosaves, so the walkthrough shouldn't start over from step one).
    // Cleared by app.js's New Game button.
    function saveProgress() {
        try {
            localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify({ n: steps.length, done: Object.keys(doneSteps) }));
        } catch (e) {
            // Storage unavailable (private browsing...) -- progress just
            // won't outlive this page load.
        }
    }

    function loadProgress() {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY_PROGRESS));
            // A different step count means walkthrough.json was edited since
            // this was saved, so the saved ids no longer line up.
            if (saved && saved.n === steps.length) {
                saved.done.forEach(function (id) { doneSteps[id] = true; });
            }
        } catch (e) {
            // Missing or corrupt -- start from the beginning.
        }
    }

    function loadMode() {
        try {
            if (localStorage.getItem(STORAGE_KEY_MODE) === 'hints') {
                mode = 'hints';
            }
        } catch (e) {
            // Default stays.
        }
    }

    function saveMode() {
        try {
            localStorage.setItem(STORAGE_KEY_MODE, mode);
        } catch (e) {
            // Not persisted.
        }
    }

    // --- Walkthrough -----------------------------------------------------

    function nextStep() {
        if (mode !== 'walkthrough') {
            return null;
        }
        var i = Walkthrough.nextStepIndex(steps, doneSteps);
        return i === -1 ? null : steps[i];
    }

    // First move of the shortest route from one room to another, using
    // only unconditional exits (an exit with a "note" depends on some game
    // state we can't see, so it's never trusted). null if no such route.
    function firstMoveToward(fromId, toId) {
        if (!mapData || !fromId || fromId === toId || !mapData.rooms[fromId]) {
            return null;
        }
        var firstMove = {};
        firstMove[fromId] = null;
        var queue = [fromId];
        while (queue.length) {
            var id = queue.shift();
            var exits = mapData.rooms[id].exits || [];
            for (var i = 0; i < exits.length; i++) {
                var exit = exits[i];
                if (exit.note || !mapData.rooms[exit.target] || exit.target in firstMove) {
                    continue;
                }
                firstMove[exit.target] = id === fromId ? exit.dir.toLowerCase() : firstMove[id];
                if (exit.target === toId) {
                    return firstMove[toId];
                }
                queue.push(exit.target);
            }
        }
        return null;
    }

    // What to actually type for a step right now, plus the placeholder
    // text describing it: the step's own command if we're in the right
    // room, otherwise the first move toward it.
    function guidance(step) {
        if (!currentRoomId || step.at === currentRoomId) {
            return { cmd: step.cmd, hint: step.why };
        }
        var move = firstMoveToward(currentRoomId, step.at);
        if (!move) {
            return { cmd: step.cmd, hint: step.why };
        }
        return { cmd: move, hint: 'head to ' + mapData.rooms[step.at].name + ' (' + step.why + ')' };
    }

    // Called after each debounced check of the page. roomChanged: whether
    // the room differs from the previous check.
    function updateWalkthrough(freshText, roomChanged) {
        var typed = submitted;
        submitted = [];
        if (!steps.length) {
            return;
        }
        var ctx = {
            roomId: currentRoomId,
            roomChanged: roomChanged,
            heldItems: tracker.held,
            placedItems: tracker.placed,
            justTaken: tracker.justTaken,
            justPlaced: tracker.justPlaced,
            freshText: freshText,
            submitted: typed
        };
        if (Walkthrough.advance(steps, doneSteps, ctx)) {
            saveProgress();
            refreshSuggestions();
            refreshInputHint();
            refreshWalkthroughButtons();
        }
    }

    // For when a step can't be recognized as done -- the thief stole the
    // thing it needed, say -- or the player simply wants to move on.
    function skipStep() {
        var i = Walkthrough.nextStepIndex(steps, doneSteps);
        if (i === -1) {
            return;
        }
        doneSteps[steps[i].id] = true;
        saveProgress();
        refreshSuggestions();
        refreshInputHint();
        refreshWalkthroughButtons();
    }

    // For a player who went off and played on their own for a while: works
    // out which step they've most likely got to from the room they're in and
    // their score (see findResyncIndex), after asking first, since it can
    // mark a lot of steps done at once.
    function resyncWalkthrough() {
        var score = getStatusScore();
        var index = currentRoomId === null || score === null ? -1 : Walkthrough.findResyncIndex(steps, currentRoomId, score);
        if (index === -1) {
            window.alert("Couldn't match your room and score to a step in the walkthrough. Try Skip, or head back toward somewhere on the route.");
            return;
        }
        var first = Walkthrough.nextStepIndex(steps, doneSteps);
        if (index === first) {
            window.alert('The walkthrough is already on the right step for where you are.');
            return;
        }
        var effect = index > first
            ? 'The steps before it will count as done.'
            : 'Steps from there on will count as not done yet.';
        var ok = window.confirm('Pick the walkthrough up at step ' + (index + 1) + ' of ' + steps.length + ' ("' + steps[index].why + '")? ' + effect);
        if (!ok) {
            return;
        }
        doneSteps = {};
        for (var i = 0; i < index; i++) {
            doneSteps[steps[i].id] = true;
        }
        saveProgress();
        refreshSuggestions();
        refreshInputHint();
    }

    function setMode(newMode) {
        mode = newMode;
        saveMode();
        refreshSuggestions();
        refreshInputHint();
        refreshWalkthroughButtons();
    }

    function refreshWalkthroughButtons() {
        var walkthroughButton = document.getElementById('suggest-mode-walkthrough');
        var ideasButton = document.getElementById('suggest-mode-ideas');
        if (walkthroughButton && ideasButton) {
            walkthroughButton.setAttribute('aria-checked', mode === 'walkthrough' ? 'true' : 'false');
            ideasButton.setAttribute('aria-checked', mode === 'hints' ? 'true' : 'false');
        }
        var step = nextStep();
        var status = document.getElementById('suggest-mode-status');
        if (status) {
            if (mode !== 'walkthrough') {
                status.textContent = 'Tab offers ideas for the room you are in.';
            } else if (step) {
                status.textContent = 'Next: ' + guidance(step).hint + '.';
            } else {
                status.textContent = 'You have reached the end of the walkthrough.';
            }
        }
        var actions = document.getElementById('walkthrough-actions');
        if (actions) {
            actions.hidden = mode !== 'walkthrough';
        }
    }

    function initWalkthroughButtons() {
        var walkthroughButton = document.getElementById('suggest-mode-walkthrough');
        var ideasButton = document.getElementById('suggest-mode-ideas');
        if (walkthroughButton) {
            walkthroughButton.addEventListener('click', function () { setMode('walkthrough'); });
        }
        if (ideasButton) {
            ideasButton.addEventListener('click', function () { setMode('hints'); });
        }
        var skipButton = document.getElementById('walkthrough-skip');
        if (skipButton) {
            skipButton.addEventListener('click', skipStep);
        }
        var resyncButton = document.getElementById('walkthrough-resync');
        if (resyncButton) {
            resyncButton.addEventListener('click', resyncWalkthrough);
        }
        refreshWalkthroughButtons();
    }

    // The list to cycle through for right now: in walkthrough mode, the
    // next step first; then whatever's tagged for this room (filtered to
    // only the item-gated ones we're confident about -- no item tag at all
    // means always show it), then the general pool. Capped well short of
    // exhausting; this is a quick handful of ideas.
    var MAX_SUGGESTIONS = 8;

    function computeSuggestions() {
        var list = [];
        var step = nextStep();
        if (step) {
            list.push(guidance(step).cmd);
        }
        var roomEntries = (currentRoomId && commandsData.byRoom[currentRoomId]) || [];
        roomEntries.forEach(function (entry) {
            if (entry.item && !tracker.held.has(entry.item)) {
                return;
            }
            if (list.indexOf(entry.cmd) === -1) {
                list.push(entry.cmd);
            }
        });
        commandsData.general.forEach(function (entry) {
            if (list.length >= MAX_SUGGESTIONS) {
                return;
            }
            if (list.indexOf(entry.cmd) === -1) {
                list.push(entry.cmd);
            }
        });
        return list.slice(0, MAX_SUGGESTIONS);
    }

    function refreshSuggestions() {
        suggestions = computeSuggestions();
        suggestionIndex = -1;
    }

    function setInputValue(input, value) {
        lastProgrammaticValue = value;
        input.value = value;
        // Put the caret at the end -- some browsers leave it at position 0
        // after a programmatic .value assignment, which looks wrong for a
        // freshly-filled command.
        try {
            input.setSelectionRange(value.length, value.length);
        } catch (e) {
            // Some input states (e.g. mid-composition) can throw; harmless
            // to just skip caret placement in that case.
        }
    }

    function cycleForward(input) {
        if (suggestions.length === 0) {
            return;
        }
        suggestionIndex = suggestionIndex + 1 >= suggestions.length ? 0 : suggestionIndex + 1;
        setInputValue(input, suggestions[suggestionIndex]);
    }

    function cycleBackward(input) {
        if (suggestionIndex <= 0) {
            suggestionIndex = -1;
            setInputValue(input, '');
            return false; // signal: caller should hand this back to GlkOte
        }
        suggestionIndex -= 1;
        setInputValue(input, suggestions[suggestionIndex]);
        return true;
    }

    // --- Room tracking ---------------------------------------------------

    // Returns true if the room changed. Suggestions are refreshed here
    // (not by the caller) since a new room means a new list.
    function recheckRoom() {
        var id = resolveRoomId(getStatusRoomName());
        if (id && id !== currentRoomId) {
            currentRoomId = id;
            refreshSuggestions();
            return true;
        }
        return false;
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
            var freshText = fullText.slice(lastSeenTextLength);
            lastSeenTextLength = fullText.length;
            // Always called, even with nothing new: it also clears the
            // "just taken" sets the walkthrough check below relies on.
            var itemsChanged = tracker.observe(freshText);
            var roomChanged = recheckRoom();
            if (itemsChanged) {
                refreshSuggestions();
            }
            updateWalkthrough(freshText, roomChanged);
        }, 90);
    }

    function initObserver() {
        var target = document.getElementById('windowport');
        if (!target) {
            return;
        }
        new MutationObserver(scheduleCheck).observe(target, { childList: true, subtree: true, characterData: true });
    }

    // --- Input interaction -------------------------------------------

    function isGameInput(el) {
        return !!el && typeof el.matches === 'function' && el.matches('#windowport input.Input');
    }

    // LEARNING NOTE: a DOM event travels through the page in two stages --
    // "capture" (from the document down to the exact element clicked/typed
    // in) and then "bubble" (back up from that element to the document).
    // addEventListener's third argument (see initInputHandlers's call to
    // `windowport.addEventListener('keydown', onKeyDown, true)`) chooses
    // which stage this listener fires on: `true` means capture. GlkOte's
    // own keydown listener is attached directly to the input element,
    // which only ever runs during the bubble stage (or effectively "at
    // the target", since capture and target-phase listeners on the same
    // element still run before that element's bubble-phase ones). Using
    // capture here guarantees this code sees the keystroke -- and can
    // decide whether to preventDefault()/stopPropagation() it away, see
    // below -- before GlkOte's own handler ever gets a turn.
    //
    // Capture phase, ahead of GlkOte's own keydown handler on the input
    // itself (vendor/glkote.js, evhan_input_keydown). Up/Down are left
    // entirely to GlkOte's command history; Tab / Shift+Tab are the only
    // keys this file claims.
    function onKeyDown(ev) {
        if (!isGameInput(ev.target)) {
            return;
        }
        var input = ev.target;

        if (ev.key === 'Enter') {
            var trimmed = input.value.trim();
            if (trimmed && trimmed.toLowerCase() !== 'undo') {
                tracker.record(trimmed);
                submitted.push({ cmd: Walkthrough.normalizeCommand(trimmed), roomId: currentRoomId });
            }
            suggestionIndex = -1;
            return;
        }

        if (ev.key === 'Tab') {
            if (ev.shiftKey) {
                if (suggestionIndex === -1) {
                    // Not browsing suggestions -- leave Shift+Tab alone so
                    // normal keyboard focus movement still works.
                    return;
                }
                ev.preventDefault();
                ev.stopPropagation();
                cycleBackward(input);
                return;
            }
            // LEARNING NOTE: preventDefault() cancels whatever the browser
            // would normally do for this key (for Tab, moving keyboard focus
            // to the next element). stopPropagation() stops the event from
            // continuing on to the next phase/listener at all, which keeps
            // GlkOte's own bubble-phase handler on the input from also
            // seeing this keystroke.
            ev.preventDefault();
            ev.stopPropagation();
            if (suggestions.length === 0) {
                refreshSuggestions();
            }
            cycleForward(input);
        }
    }

    // A real user keystroke landing in the input (not our own programmatic
    // fill) means they've deviated from whatever suggestion was showing --
    // drop out of browsing mode so the next Tab starts a fresh cycle rather
    // than continuing from a now-stale index. Setting .value via script
    // never fires a native "input" event, so this only ever sees genuine
    // typing/paste/cut, never our own cycleForward/cycleBackward calls.
    function onInput(ev) {
        if (!isGameInput(ev.target)) {
            return;
        }
        if (ev.target.value === lastProgrammaticValue) {
            return;
        }
        suggestionIndex = -1;
    }

    var DOUBLE_TAP_MS = 350;
    var lastTapTime = 0;

    function onPossibleDoubleTap(ev) {
        if (!isGameInput(ev.target)) {
            return;
        }
        // LEARNING NOTE: Date.now() returns the current time as a plain
        // number (milliseconds since Jan 1 1970 -- the "Unix epoch"), which
        // makes measuring elapsed time as simple as subtracting two
        // readings, as below. Double-tap detection here is just "was the
        // previous tap on this element less than 350ms ago?"; there's no
        // built-in browser "doubletap" event for touch, so this is the
        // standard manual way to detect one.
        var now = Date.now();
        var isDouble = now - lastTapTime < DOUBLE_TAP_MS;
        lastTapTime = now;
        if (!isDouble) {
            return;
        }
        lastTapTime = 0;
        if (suggestions.length === 0) {
            refreshSuggestions();
        }
        cycleForward(ev.target);
    }

    function initInputHandlers() {
        var windowport = document.getElementById('windowport');
        if (!windowport) {
            return;
        }
        windowport.addEventListener('keydown', onKeyDown, true);
        windowport.addEventListener('input', onInput);
        windowport.addEventListener('touchend', onPossibleDoubleTap);
        windowport.addEventListener('dblclick', function (ev) {
            if (!isGameInput(ev.target)) {
                return;
            }
            if (suggestions.length === 0) {
                refreshSuggestions();
            }
            cycleForward(ev.target);
        });
    }

    // Sets a discoverability hint on whatever input element currently
    // exists -- GlkOte may recreate this element between turns, so this is
    // re-applied every time the observer fires rather than assumed to
    // stick from a one-time setup.
    function refreshInputHint() {
        var input = document.querySelector('#windowport input.Input');
        if (!input) {
            return;
        }
        var step = nextStep();
        input.placeholder = step
            ? 'Tab: ' + guidance(step).hint
            : 'Tab or double-tap for suggestions';
        refreshWalkthroughButtons(); // the Hints tab's status line follows the room too
    }

    // LEARNING NOTE: this needs three separate files before it can do
    // anything, so all the fetches are kicked off together (not one, then
    // the next afterward) and Promise.all() waits for the whole array of
    // Promises to finish. Its own result is an array in the same order as
    // the input, which is why results[0] below is map.json's parsed data
    // and results[1] is commands.json's -- even though whichever request
    // actually finishes first over the network isn't guaranteed. This is
    // faster than awaiting them one at a time, since the downloads
    // happen in parallel instead of each waiting for the one before it.
    Promise.all([
        fetch('data/map.json').then(function (r) { return r.json(); }),
        fetch('data/commands.json').then(function (r) { return r.json(); }),
        fetch('data/walkthrough.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
        mapData = results[0];
        commandsData = results[1];
        steps = results[2].steps;
        resolveRoomId = Walkthrough.createRoomResolver(mapData.rooms);
        tracker = Walkthrough.createTracker(commandsData.items);
        loadMode();
        loadProgress();
        initInputHandlers();
        initObserver();
        initWalkthroughButtons();
        lastSeenTextLength = getAllBufferText().length;
        recheckRoom();
        refreshSuggestions();
        refreshInputHint();
        var hintObserver = new MutationObserver(refreshInputHint);
        var windowport = document.getElementById('windowport');
        if (windowport) {
            hintObserver.observe(windowport, { childList: true, subtree: true });
        }
    }).catch(function (err) {
        console.error('Command suggestions: could not load data', err);
    });
})();

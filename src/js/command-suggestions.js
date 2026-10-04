(function () {
    'use strict';

    // Suggests commands worth trying right now -- a mix of genuinely useful
    // ones for whatever puzzle the current room represents, and a few that
    // just show off the game's own sense of humor -- cycled into the input
    // box with Tab (Shift+Tab goes back) or a double-tap. Tracks room and
    // inventory independently via their own passive observation, the same
    // pattern map.js/codemuseum.js/tab-indicators.js each already use, since
    // none of these files share a module system to hook into each other
    // directly.
    //
    // Up/Down are deliberately left alone: they belong to GlkOte's own
    // command history (vendor/glkote.js, win.history/historypos).

    var mapData = null;
    var commandsData = null; // { items: {id: {match, aliases?}}, general: [...], byRoom: {...} }
    var walkthroughData = null; // { steps: [{id, cmd, at, why, gate?, done: {arrive?, item?, text?}}] }
    var doneSteps = {}; // step id -> true; sticky, so undo/dropping never un-completes a step
    var nameToRoomId = {};

    var currentRoomId = null;
    var heldItems = new Set();

    var suggestions = [];
    var suggestionIndex = -1; // -1 = not currently browsing a suggestion
    var lastProgrammaticValue = null;

    // What recently-submitted commands were trying to do, so the next bit
    // of game output can be checked for whether each actually worked --
    // see recordPendingAction / checkPendingAction. A queue, not a single
    // slot: checkPendingAction only runs on the debounced MutationObserver
    // callback, which can lag behind real typing -- most dramatically right
    // after this tab returns from being backgrounded (browsers throttle a
    // hidden tab's timers), where a single-slot design was confirmed live
    // to lose an action entirely (a second command typed before the first
    // was ever checked silently overwrote it). Capped and aged out in
    // checkPendingAction so a typo or a command that never succeeds
    // doesn't sit around ready to falsely match some unrelated later text.
    var pendingActions = []; // [{ type: 'take'|'drop'|'inventory', item?: id, age }]
    var MAX_PENDING = 5;
    var MAX_PENDING_AGE = 3;

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

    // --- Walkthrough ----------------------------------------------------
    //
    // data/walkthrough.json is an ordered list of steps. The "next" step is
    // the first one not yet done; it's offered first in the Tab cycle (and
    // named in the input's placeholder). There's no way to read the game's
    // own state, so each step declares how to recognize it's done from
    // what this file can already see: standing in a room, holding an item,
    // or distinctive text in the game's output (see stepDone).

    function nextStep() {
        if (!walkthroughData) {
            return null;
        }
        var steps = walkthroughData.steps;
        for (var i = 0; i < steps.length; i++) {
            if (!doneSteps[steps[i].id]) {
                return steps[i];
            }
        }
        return null;
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

    function stepDone(step, freshText) {
        var done = step.done;
        if (done.arrive && done.arrive === currentRoomId) {
            return true;
        }
        if (done.item && heldItems.has(done.item)) {
            return true;
        }
        if (done.text && freshText) {
            var lower = freshText.toLowerCase();
            return done.text.some(function (t) { return lower.indexOf(t.toLowerCase()) !== -1; });
        }
        return false;
    }

    function updateWalkthrough(freshText) {
        if (!walkthroughData) {
            return;
        }
        var steps = walkthroughData.steps;
        var changed = false;
        steps.forEach(function (step, i) {
            if (doneSteps[step.id] || !stepDone(step, freshText)) {
                return;
            }
            doneSteps[step.id] = true;
            changed = true;
            if (step.gate) {
                // A gate proves everything before it is moot (e.g. you
                // can't be in the kitchen without having opened the
                // window), even if we never saw those steps happen.
                for (var j = 0; j < i; j++) {
                    doneSteps[steps[j].id] = true;
                }
            }
        });
        if (changed) {
            refreshSuggestions();
            refreshInputHint();
        }
    }

    // The list to cycle through for right now: the walkthrough's next step
    // first, then whatever's tagged for this room (filtered to only the
    // item-gated ones we're confident about -- no item tag at all means
    // always show it), then the general pool. Capped well short of
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
            if (entry.item && !heldItems.has(entry.item)) {
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

    // --- Inventory tracking -------------------------------------------

    function itemWords(id) {
        var item = commandsData.items[id];
        return [item.match].concat(item.aliases || []);
    }

    function matchItem(word) {
        var ids = Object.keys(commandsData.items);
        for (var i = 0; i < ids.length; i++) {
            if (itemWords(ids[i]).indexOf(word) !== -1) {
                return ids[i];
            }
        }
        return null;
    }

    var TAKE_VERBS = ['take', 'get', 'grab', 'pick up', 'carry'];
    var DROP_VERBS = ['drop', 'put down', 'discard'];

    // Best-effort parse of a just-submitted command line into "this might
    // change whether we're holding a tracked item" -- confirmed (or not)
    // against the game's own next response in checkPendingAction, never
    // assumed just because the command was typed (it might fail: wrong
    // room, over capacity, not actually present...).
    function pushPendingAction(action) {
        action.age = 0;
        pendingActions.push(action);
        if (pendingActions.length > MAX_PENDING) {
            pendingActions.shift();
        }
    }

    function recordPendingAction(raw) {
        var text = raw.trim().toLowerCase().replace(/[.,!]+$/, '');
        if (text === 'inventory' || text === 'i') {
            pushPendingAction({ type: 'inventory' });
            return;
        }
        var words = text.split(/\s+/);
        var verb = words[0];
        var rest = words.slice(1).join(' ');
        // "put down X" / "pick up X" -- two-word verbs.
        if (words.length > 1 && (verb === 'pick' || verb === 'put') && words[1] === (verb === 'pick' ? 'up' : 'down')) {
            verb = verb + ' ' + words[1];
            rest = words.slice(2).join(' ');
        }
        var itemId = matchItem(rest.split(/\s+/).pop());
        if (!itemId) {
            return;
        }
        // LEARNING NOTE: `a ? b : c` is the ternary operator -- a compact
    // if/else that evaluates to a value: "if a is truthy, the whole
    // expression is b, otherwise it's c". These can be chained, as here:
    // read it as "if this verb is a take-verb, 'take'; otherwise, if it's
    // a drop-verb, 'drop'; otherwise, null" -- equivalent to a longer
    // if/else-if/else, just written as one assignment.
    var type = TAKE_VERBS.indexOf(verb) !== -1 ? 'take' : DROP_VERBS.indexOf(verb) !== -1 ? 'drop' : null;
        if (type) {
            pushPendingAction({ type: type, item: itemId });
        }
    }

    // Checked against the newest text the game just printed, once per
    // debounced check (not necessarily once per submitted command -- see
    // pendingActions' own comment). Deliberately simple substring checks
    // rather than strict line-boundary parsing -- worst case on a false
    // match is a suggestion's availability is briefly wrong, which
    // self-corrects the next time the player checks their own inventory.
    // Can't tell *which* queued attempt a given "Taken." belongs to when
    // more than one is still pending at once -- an accepted best-effort
    // limitation, same spirit as the rest of this project's inventory
    // tracking.
    function checkPendingAction(newText) {
        if (pendingActions.length === 0) {
            return;
        }
        // LEARNING NOTE: reassigning `pendingActions = pendingActions.filter(...)`
        // is a common idiom for "remove some items from an array in place"
        // -- .filter() itself doesn't modify the original array (arrays
        // methods like .filter/.map never mutate their input), it builds a
        // brand new one containing only the elements whose callback
        // returned true, and here that new array is immediately assigned
        // back over the old variable. Each action below returns false
        // (drop it) once it's been resolved one way or another, or true
        // (keep it for next time) while it's still waiting to be verified.
        pendingActions = pendingActions.filter(function (action) {
            if (action.type === 'take') {
                if (newText.indexOf('Taken.') !== -1) {
                    heldItems.add(action.item);
                    refreshSuggestions();
                    return false;
                }
            } else if (action.type === 'drop') {
                if (newText.indexOf('Dropped.') !== -1) {
                    heldItems.delete(action.item);
                    refreshSuggestions();
                    return false;
                }
            } else if (action.type === 'inventory') {
                if (newText.indexOf('empty-handed') !== -1) {
                    heldItems.clear();
                    refreshSuggestions();
                    return false;
                } else if (newText.indexOf('You are carrying') !== -1) {
                    var ids = Object.keys(commandsData.items);
                    var lowerText = newText.toLowerCase();
                    ids.forEach(function (id) {
                        var found = itemWords(id).some(function (word) {
                            return lowerText.indexOf(word) !== -1;
                        });
                        if (found) {
                            heldItems.add(id);
                        }
                    });
                    refreshSuggestions();
                    return false;
                }
            }
            action.age += 1;
            return action.age < MAX_PENDING_AGE;
        });
    }

    // --- Room tracking ---------------------------------------------------

    function recheckRoom() {
        var id = resolveRoomId(getStatusRoomName());
        if (id && id !== currentRoomId) {
            currentRoomId = id;
            refreshSuggestions();
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
            var freshText = fullText.slice(lastSeenTextLength);
            if (freshText) {
                checkPendingAction(freshText);
            }
            lastSeenTextLength = fullText.length;
            recheckRoom();
            updateWalkthrough(freshText);
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
                recordPendingAction(trimmed);
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
    }

    // LEARNING NOTE: this needs two separate files before it can do
    // anything, so both fetches are kicked off together (not one, then
    // the other afterward) and Promise.all() waits for the whole array of
    // Promises to finish. Its own result is an array in the same order as
    // the input, which is why results[0] below is map.json's parsed data
    // and results[1] is commands.json's -- even though whichever request
    // actually finishes first over the network isn't guaranteed. This is
    // faster than awaiting them one at a time, since both downloads
    // happen in parallel instead of one waiting for the other to finish
    // first.
    Promise.all([
        fetch('data/map.json').then(function (r) { return r.json(); }),
        fetch('data/commands.json').then(function (r) { return r.json(); }),
        fetch('data/walkthrough.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
        mapData = results[0];
        commandsData = results[1];
        walkthroughData = results[2];
        Object.keys(mapData.rooms).forEach(function (id) {
            nameToRoomId[mapData.rooms[id].name] = id;
        });
        initInputHandlers();
        initObserver();
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

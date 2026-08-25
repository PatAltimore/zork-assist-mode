(function () {
    'use strict';

    // Suggests commands worth trying right now -- a mix of genuinely useful
    // ones for whatever puzzle the current room represents, and a few that
    // just show off the game's own sense of humor -- cycled into the input
    // box with the Up arrow or a double-tap, the same way a terminal's own
    // command history works. Tracks room and inventory independently via
    // their own passive observation, the same pattern map.js/codemuseum.js/
    // tab-indicators.js each already use, since none of these files share a
    // module system to hook into each other directly.
    //
    // Deliberately layered on TOP of GlkOte's own real command history
    // (vendor/glkote.js, win.history/historypos, bound to the same Up/Down
    // keys) rather than replacing it: this only ever takes over once GlkOte's
    // own history has nothing left to recall, so pressing Up still recalls
    // what you actually typed first, same as always.

    var mapData = null;
    var commandsData = null; // { items: {id: {match}}, general: [...], byRoom: {...} }
    var nameToRoomId = {};

    var currentRoomId = null;
    var heldItems = new Set();

    // Shadow of GlkOte's own win.history/win.historypos (see the big
    // comment on the keydown handler below for why this has to be a
    // best-effort mirror rather than a real read of GlkOte's internal
    // state, which isn't exposed to us).
    var shadowHistory = [];
    var shadowHistoryPos = 0;

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

    // The list to cycle through for right now: whatever's tagged for this
    // room (filtered to only the item-gated ones we're confident about --
    // no item tag at all means always show it), then the general pool.
    // Capped well short of exhausting; this is meant to be a quick handful
    // of ideas, not a walkthrough.
    var MAX_SUGGESTIONS = 8;

    function computeSuggestions() {
        var list = [];
        var roomEntries = (currentRoomId && commandsData.byRoom[currentRoomId]) || [];
        roomEntries.forEach(function (entry) {
            if (entry.item && !heldItems.has(entry.item)) {
                return;
            }
            list.push(entry.cmd);
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

    function matchItem(word) {
        var ids = Object.keys(commandsData.items);
        for (var i = 0; i < ids.length; i++) {
            if (commandsData.items[ids[i]].match === word) {
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
                    ids.forEach(function (id) {
                        var word = commandsData.items[id].match;
                        if (newText.toLowerCase().indexOf(word) !== -1) {
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
            if (fullText.length > lastSeenTextLength) {
                checkPendingAction(fullText.slice(lastSeenTextLength));
            }
            lastSeenTextLength = fullText.length;
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
    // itself (vendor/glkote.js, evhan_input_keydown), so this always gets
    // first look at Up/Down. shadowHistoryPos mirrors GlkOte's own
    // win.historypos as best it can from the outside -- there's no public
    // API into GlkOte's internal window state, so this is rebuilt from the
    // same submitted-command events this file already needs to watch for
    // inventory tracking. It won't always match perfectly (typing "undo",
    // or Save/Load's synthetic submission, don't go through the same path
    // GlkOte's own history bookkeeping does -- see the Enter handler below)
    // but those are rare, self-correcting edge cases, not a functional
    // problem: worst case Up recalls one extra/fewer blank history step
    // before switching over to suggestions.
    function onKeyDown(ev) {
        if (!isGameInput(ev.target)) {
            return;
        }
        var input = ev.target;

        if (ev.key === 'Enter') {
            var raw = input.value;
            var trimmed = raw.trim();
            if (trimmed && trimmed.toLowerCase() !== 'undo') {
                var last = shadowHistory[shadowHistory.length - 1];
                if (trimmed !== last) {
                    shadowHistory.push(trimmed);
                    if (shadowHistory.length > 20) {
                        shadowHistory.shift();
                    }
                }
                shadowHistoryPos = shadowHistory.length;
                recordPendingAction(trimmed);
            }
            suggestionIndex = -1;
            return;
        }

        if (ev.key === 'ArrowUp') {
            if (suggestionIndex === -1 && shadowHistoryPos > 0) {
                // GlkOte's own history will handle this one -- just stay in
                // sync with what it's about to do to its own position.
                shadowHistoryPos -= 1;
                return;
            }
            // LEARNING NOTE: preventDefault() cancels whatever the browser
            // would normally do for this key (here, that matters less --
            // Up in a text field has no default browser behavior to
            // block, but it's included for safety/clarity). stopPropagation()
            // is the important one: it stops the event from continuing on
            // to the next phase/listener at all, which is what actually
            // keeps GlkOte's own bubble-phase handler on the input from
            // ever seeing this keystroke and doing its own (wrong, in this
            // moment) thing with it.
            ev.preventDefault();
            ev.stopPropagation();
            if (suggestions.length === 0) {
                refreshSuggestions();
            }
            cycleForward(input);
            return;
        }

        if (ev.key === 'ArrowDown') {
            if (suggestionIndex === -1) {
                // Not browsing suggestions -- let GlkOte's own forward-
                // history handling proceed untouched, just mirroring
                // whatever it's about to do to its own position.
                if (shadowHistoryPos < shadowHistory.length) {
                    shadowHistoryPos += 1;
                }
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            cycleBackward(input);
        }
    }

    // A real user keystroke landing in the input (not our own programmatic
    // fill) means they've deviated from whatever suggestion was showing --
    // drop out of browsing mode so the next Up starts a fresh cycle rather
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
        if (input && !input.placeholder) {
            input.placeholder = '↑ or double-tap for suggestions';
        }
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
        fetch('data/commands.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
        mapData = results[0];
        commandsData = results[1];
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

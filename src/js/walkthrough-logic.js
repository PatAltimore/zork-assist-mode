(function (root, factory) {
    'use strict';
    // Loaded as a plain <script> in the browser (exposes window.ZorkWalkthrough)
    // and require()d by tools/verify-walkthrough.js, so the page and the
    // verifier share one definition of "is this step done".
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ZorkWalkthrough = factory();
    }
}(this, function () {
    'use strict';

    // How many steps, counting from the first one not yet done, are checked
    // against what the player just did. Anything further down the list is
    // never completed early -- the route revisits the same rooms and items
    // many times, so something the player happens to be doing now must not
    // finish a step that's still far off.
    var WINDOW = 6;

    // Game replies that mean a typed command did not actually work. Only used
    // for steps with no better completion signal ("done": {"cmd": true}).
    var FAILURE_RE = /can't go that way|you can't|can't see any|don't have|too heavy|too dark|not here|don't understand|don't know the word|isn't|aren't|nothing happens|no such|you must|that's not|you used the word/i;

    function normalizeCommand(text) {
        return String(text).trim().toLowerCase().replace(/[.,!]+$/, '').replace(/\s+/g, ' ');
    }

    // ctx: { roomId, roomChanged:bool, heldItems:Set, placedItems:Set,
    //        justTaken:Set, justPlaced:Set (items picked up / put in the case
    //        by the commands being checked now), freshText:string,
    //        submitted:[{cmd, roomId}] }
    //        (submitted is consumed in place)
    // arriveOk: whether "you are standing in the arrive room" may count for
    // this step -- see advance() for why that can't hold for every step.
    function stepDone(step, ctx, arriveOk, isFirst) {
        var done = step.done || {};
        if (arriveOk && done.arrive && done.arrive === ctx.roomId) {
            return true;
        }
        // Holding something only finishes a step that is next in line -- the
        // route picks up and puts down the same torch, the same treasures,
        // several times, so an item already in hand from earlier must not
        // finish a later "take it" step. A step further down finishes only
        // if the item was picked up (or put in the case) just now.
        if (done.item && (isFirst ? ctx.heldItems.has(done.item) : ctx.justTaken && ctx.justTaken.has(done.item))) {
            return true;
        }
        if (done.placed && (isFirst ? ctx.placedItems.has(done.placed) : ctx.justPlaced && ctx.justPlaced.has(done.placed))) {
            return true;
        }
        if (done.text && ctx.freshText) {
            var lower = ctx.freshText.toLowerCase();
            for (var i = 0; i < done.text.length; i++) {
                if (lower.indexOf(done.text[i].toLowerCase()) !== -1) {
                    return true;
                }
            }
        }
        if (done.cmd && ctx.submitted.length && !FAILURE_RE.test(ctx.freshText || '')) {
            var want = normalizeCommand(step.cmd);
            for (var j = 0; j < ctx.submitted.length; j++) {
                var sub = ctx.submitted[j];
                if (sub.cmd === want && (!sub.roomId || !step.at || sub.roomId === step.at)) {
                    ctx.submitted.splice(j, 1); // one typed command finishes at most one step
                    return true;
                }
            }
        }
        return false;
    }

    function nextStepIndex(steps, doneSteps) {
        for (var i = 0; i < steps.length; i++) {
            if (!doneSteps[steps[i].id]) {
                return i;
            }
        }
        return -1;
    }

    // Marks whatever just got finished as done (mutating doneSteps) and
    // returns true if anything changed.
    function advance(steps, doneSteps, ctx) {
        var first = nextStepIndex(steps, doneSteps);
        if (first === -1) {
            return false;
        }
        var changed = false;
        var end = Math.min(steps.length, first + WINDOW);
        // Walking forward from the first pending step, "arrive" may count
        // for the first step itself (the player may already be standing
        // there), or for a later step only when the player has just moved
        // into that room *and* every step skipped on the way is a plain move
        // (two moves typed faster than the page re-checks the room).
        var onlyMovesSoFar = true;
        var arrived = false; // a single room change finishes at most one step
        for (var i = first; i < end; i++) {
            var step = steps[i];
            if (doneSteps[step.id]) {
                continue;
            }
            var d = step.done || {};
            var isMove = !!(d.arrive && !d.item && !d.placed && !d.text && !d.cmd);
            var arriveOk = !arrived && (i === first || (ctx.roomChanged && onlyMovesSoFar));
            if (stepDone(step, ctx, arriveOk, i === first)) {
                if (isMove) {
                    arrived = true;
                    // Plain moves skipped on the way (typed faster than the
                    // page re-checks the room) are finished too.
                    for (var k = first; k < i; k++) {
                        doneSteps[steps[k].id] = true;
                    }
                }
                doneSteps[step.id] = true;
                changed = true;
                if (step.gate) {
                    // A gate proves everything before it is moot (you can't
                    // be in the kitchen without having got through the
                    // window), even if we never saw those steps happen.
                    for (var j = 0; j < i; j++) {
                        doneSteps[steps[j].id] = true;
                    }
                }
            } else if (!isMove) {
                onlyMovesSoFar = false;
            }
        }
        return changed;
    }


    // --- Inventory tracking ---------------------------------------------
    //
    // There's no way to read the game's own state, so what the player is
    // holding / has put in the trophy case is worked out from what they
    // typed and how the game replied. A typed command only ever creates a
    // *pending* action; it counts once the game's next output confirms it
    // ("Taken." / "Dropped." / "Done."), never just because it was typed --
    // it might fail (wrong room, too heavy, not actually present...).
    var TAKE_VERBS = ['take', 'get', 'grab', 'pick up', 'carry'];
    var DROP_VERBS = ['drop', 'put down', 'discard'];
    var PUT_VERBS = ['put', 'place', 'insert'];
    var PUT_PREPS = ['in', 'into', 'inside'];

    function itemWords(item) {
        return [item.match].concat(item.aliases || []);
    }

    // What the item looks like in the game's own "You are carrying:" list.
    function itemInventoryWords(item) {
        return item.inv || itemWords(item);
    }

    // items: { id: {match, aliases?, inv?} } (data/commands.json "items")
    function createTracker(items) {
        var held = new Set();
        var placed = new Set();
        var justTaken = new Set(); // changed by the latest observe() only
        var justPlaced = new Set();
        // A queue, not a single slot: observe() only runs on a debounced
        // callback, which can lag behind real typing -- most dramatically
        // right after a backgrounded tab comes back (browsers throttle a
        // hidden tab's timers), where a single-slot design was confirmed
        // live to lose an action entirely. Capped and aged out so a typo or
        // a command that never succeeds doesn't sit around ready to
        // falsely match some unrelated later text.
        var pending = []; // [{ type: 'take'|'drop'|'put'|'inventory', item?, toCase?, age }]
        var MAX_PENDING = 5;
        var MAX_PENDING_AGE = 3;

        function matchItem(word) {
            var ids = Object.keys(items);
            for (var i = 0; i < ids.length; i++) {
                if (itemWords(items[ids[i]]).indexOf(word) !== -1) {
                    return ids[i];
                }
            }
            return null;
        }

        function push(action) {
            action.age = 0;
            pending.push(action);
            if (pending.length > MAX_PENDING) {
                pending.shift();
            }
        }

        function lastWord(words) {
            return words.length ? words[words.length - 1] : '';
        }

        function record(raw) {
            var text = normalizeCommand(raw);
            if (text === 'inventory' || text === 'i') {
                push({ type: 'inventory' });
                return;
            }
            var words = text.split(' ');
            var verb = words[0];
            var rest = words.slice(1);
            // "put down X" / "pick up X" -- two-word verbs.
            if (words.length > 1 && (verb === 'pick' || verb === 'put') && words[1] === (verb === 'pick' ? 'up' : 'down')) {
                verb = verb + ' ' + words[1];
                rest = words.slice(2);
            }
            if (PUT_VERBS.indexOf(verb) !== -1) {
                var prepAt = -1;
                for (var i = 0; i < rest.length && prepAt === -1; i++) {
                    if (PUT_PREPS.indexOf(rest[i]) !== -1) {
                        prepAt = i;
                    }
                }
                if (prepAt > 0) {
                    var putId = matchItem(lastWord(rest.slice(0, prepAt)));
                    if (putId) {
                        push({ type: 'put', item: putId, toCase: rest.slice(prepAt + 1).indexOf('case') !== -1 });
                    }
                }
                return;
            }
            var itemId = matchItem(lastWord(rest));
            if (!itemId) {
                return;
            }
            if (TAKE_VERBS.indexOf(verb) !== -1) {
                push({ type: 'take', item: itemId });
            } else if (DROP_VERBS.indexOf(verb) !== -1) {
                push({ type: 'drop', item: itemId });
            }
        }

        // Checked against the newest text the game just printed. Deliberately
        // simple substring checks rather than strict line-boundary parsing
        // -- worst case on a false match is a suggestion's availability
        // being briefly wrong, which self-corrects the next time the player
        // checks their own inventory. Can't tell *which* queued attempt a
        // given "Taken." belongs to when more than one is still pending at
        // once -- an accepted best-effort limitation.
        //
        // Returns true if anything was resolved.
        function observe(newText) {
            justTaken.clear();
            justPlaced.clear();
            if (!pending.length) {
                return false;
            }
            var changed = false;
            // LEARNING NOTE: reassigning `pending = pending.filter(...)` is
            // a common idiom for "remove some items from an array" --
            // .filter() never modifies its input, it builds a brand new
            // array of only the elements whose callback returned true, and
            // that new array is assigned straight back over the old
            // variable. Each action below returns false (drop it) once
            // resolved one way or another, or true (keep it for next time)
            // while it's still waiting to be verified.
            pending = pending.filter(function (action) {
                if (action.type === 'take') {
                    if (newText.indexOf('Taken.') !== -1) {
                        held.add(action.item);
                        justTaken.add(action.item);
                        placed.delete(action.item); // taken back out of the case
                        changed = true;
                        return false;
                    }
                } else if (action.type === 'drop') {
                    if (newText.indexOf('Dropped.') !== -1) {
                        held.delete(action.item);
                        changed = true;
                        return false;
                    }
                } else if (action.type === 'put') {
                    if (newText.indexOf('Done.') !== -1) {
                        held.delete(action.item);
                        if (action.toCase) {
                            placed.add(action.item);
                            justPlaced.add(action.item);
                        }
                        changed = true;
                        return false;
                    }
                } else if (action.type === 'inventory') {
                    if (newText.indexOf('empty-handed') !== -1) {
                        held.clear();
                        changed = true;
                        return false;
                    } else if (newText.indexOf('You are carrying') !== -1) {
                        var lowerText = newText.toLowerCase();
                        Object.keys(items).forEach(function (id) {
                            var found = itemInventoryWords(items[id]).some(function (word) {
                                return lowerText.indexOf(word) !== -1;
                            });
                            if (found) {
                                held.add(id);
                            }
                        });
                        changed = true;
                        return false;
                    }
                }
                action.age += 1;
                return action.age < MAX_PENDING_AGE;
            });
            return changed;
        }

        return { held: held, placed: placed, justTaken: justTaken, justPlaced: justPlaced, record: record, observe: observe };
    }

    // Status-line room name -> map.json room id. The status line truncates
    // long names, so a unique prefix match counts too.
    function createRoomResolver(rooms) {
        var nameToId = {};
        Object.keys(rooms).forEach(function (id) {
            nameToId[rooms[id].name] = id;
        });
        return function (name) {
            if (!name) {
                return null;
            }
            if (nameToId[name]) {
                return nameToId[name];
            }
            var candidates = Object.keys(nameToId).filter(function (fullName) {
                return fullName.indexOf(name) === 0;
            });
            return candidates.length === 1 ? nameToId[candidates[0]] : null;
        };
    }

    return {
        createRoomResolver: createRoomResolver,
        createTracker: createTracker,
        WINDOW: WINDOW,
        FAILURE_RE: FAILURE_RE,
        normalizeCommand: normalizeCommand,
        stepDone: stepDone,
        nextStepIndex: nextStepIndex,
        advance: advance
    };
}));

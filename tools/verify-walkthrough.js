// Replays src/data/<game>/walkthrough.json against the real game (tools/play.js)
// and checks that every step's "done" condition actually fires -- using the very
// same tracking code the page uses (src/js/walkthrough-logic.js).
//
//   (add --game zork2 to any of these; default zork1)
//   node tools/verify-walkthrough.js --seed 13       (verbose, one run)
//   node tools/verify-walkthrough.js --seeds 1-200   (which seeds play clean)
//   node tools/verify-walkthrough.js --resync 1      (check the page's Resync button)
//
// The games' random events (Zork I's thief and combat, Zork II's Wizard and
// the Carousel Room) mean a run only passes for some seeds. The verifier
// behaves like a player following the page's suggestions: it always types
// the walkthrough's *next* step, first walking back to the step's room if
// something moved it, and it waits out the few Wizard spells that merely
// freeze or float you. For each step it checks that
//   1. the step is marked done by the game's reply to that command, and
//   2. nothing was left hanging when the next step is due.
// A passing run also ends with the game's full score (and its win text,
// where the game has one).

'use strict';
const fs = require('fs');
const path = require('path');
const { createGame } = require('./play');
const W = require('../src/js/walkthrough-logic.js');

const cfg = require('./games').config();
const DATA = cfg.dataDir;
function loadSteps() {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'walkthrough.json'), 'utf8')).steps;
}
const items = JSON.parse(fs.readFileSync(path.join(DATA, 'commands.json'), 'utf8')).items;
const mapData = JSON.parse(fs.readFileSync(path.join(DATA, 'map.json'), 'utf8'));
const rooms = mapData.rooms;
const resolveRoom = W.createRoomResolver(rooms);

// Replies that mean "not now, wait a moment" rather than "that didn't work":
// the Wizard's Float / Freeze / Fence spells (Zork II).
const SPELL_WAIT_RE = /flapping your arms|frozen solid|invisible fence of magical force|can't reach that/i;
// Zork II only lets you hold a few things reliably; past that, picking
// something up fails at random.
const RETRY_RE = /holding too many things/i;
// ...and the Wizard's Feeble spell caps what you can carry for a while, then
// Feeble and Fumble make you drop things; a player just waits and picks them up.
const WEAK_RE = /your load is too heavy/i;
// Ferment and Fear send you stumbling off in a random direction; the next
// step walks you back (routeBack), so just try the step again.
const STUMBLE_RE = /a little unsteady|screaming in terror|tripped on an invisible cord/i;
const DROPPED_RE = /(?:you drop|you dropped) the ([a-z ]+?)[.!]/i;

// stepList defaults to the shipped walkthrough.json; tools/build-walkthrough.js
// passes freshly parsed steps. scoreBefore[i] / roomBefore[i] record the game's
// score and the room id just before step i is typed.
function run(seed, verbose, stepList) {
    const steps = stepList || loadSteps();
    const game = createGame(seed, cfg.id);
    const scoreBefore = [];
    const roomBeforeStep = [];
    const tracker = W.createTracker(items);
    const done = {};
    const problems = [];
    let roomId = resolveRoom(game.status().room);
    let last = { text: '', score: 0 };

    function send(cmd) {
        if (game.isFinished()) { return last; }
        tracker.record(cmd);
        const roomBefore = roomId;
        const r = game.send(cmd);
        if (process.env.TRACE) { console.log('> ' + cmd + '  [' + r.room + ' ' + r.score + '] ' + r.text.replace(/\s+/g, ' ').slice(0, Number(process.env.TRACE) > 1 ? 900 : 110)); }
        last = r;
        roomId = resolveRoom(r.room);
        tracker.observe(r.text);
        const ctx = {
            roomId: roomId,
            roomChanged: roomId !== roomBefore,
            heldItems: tracker.held,
            placedItems: tracker.placed,
            justTaken: tracker.justTaken,
            justPlaced: tracker.justPlaced,
            freshText: r.text,
            submitted: [{ cmd: W.normalizeCommand(cmd), roomId: roomBefore }]
        };
        W.advance(steps, done, ctx);
        const dropped = DROPPED_RE.exec(r.text);
        if (dropped && !/^(VAIR|WELL)/.test(roomId || '') && !cmd.startsWith('take ')) {
            send('take ' + dropped[1].replace(/^(a|an|the) /, ''));
        }
        return r;
    }

    // What the page does when something has moved the player off the route:
    // suggest the first move toward the step's room.
    function routeBack(step) {
        for (let n = 0; n < 25 && roomId && roomId !== step.at; n++) {
            const move = W.firstMoveToward(mapData, roomId, step.at);
            if (!move) {
                return;
            }
            const before = roomId;
            send(move);
            if (roomId === before) {
                return;
            }
        }
    }

    function doStep(step) {
        const v = step.verify;
        let r;
        for (let tries = 1; tries <= 120; tries++) {
            routeBack(step);
            if (v && v.guard) {
                // Only do this when the room's indicator reads as wanted.
                for (let w = 0; w < 30; w++) {
                    if (send('examine indicator').text.indexOf(v.guard) !== -1) { break; }
                    send('wait');
                }
            }
            r = send(step.cmd);
            if (done[step.id]) {
                if (v && v.until && r.text.toLowerCase().indexOf(v.until.toLowerCase()) === -1) {
                    continue; // fight/repeat steps: "done" may fire before the outcome
                }
                return r;
            }
            if (v && v.fight && /don't have that|don't have the sword|sword goes flying|knocked from your hand/i.test(r.text)) {
                send('take sword');
                continue;
            }
            if (v && v.try) {
                // Several commands might be the right one (which way leads
                // out of a maze room?): try each in turn.
                for (let k = 0; k < v.try.length && !done[step.id]; k++) {
                    if (v.try[k] !== step.cmd) {
                        r = send(v.try[k]);
                    }
                }
                if (done[step.id]) {
                    return r;
                }
            }
            if (SPELL_WAIT_RE.test(r.text) && !/^VAIR/.test(roomId || '')) {
                // (Never in the balloon: waiting there would let it drift away.)
                send('wait');
                continue;
            }
            if (STUMBLE_RE.test(r.text)) {
                continue;
            }
            if (WEAK_RE.test(r.text) && tries < 40) {
                send('wait');
                continue;
            }
            if (RETRY_RE.test(r.text) || (v && (v.wander || (v.until && r.text.toLowerCase().indexOf(v.until.toLowerCase()) === -1)))) {
                continue;
            }
            return r;
        }
        return r;
    }

    for (let guard = 0; guard < steps.length * 3; guard++) {
        const i = W.nextStepIndex(steps, done);
        if (i === -1) {
            break;
        }
        const step = steps[i];
        scoreBefore[i] = game.status().score;
        roomBeforeStep[i] = roomId;
        const r = doStep(step);
        if (!done[step.id]) {
            problems.push('step ' + (i + 1) + ' (' + step.cmd + ' @ ' + step.at + ') not completed; got: ' + r.text.replace(/\s+/g, ' ').slice(0, 160) + ' [' + r.room + ']');
            if (problems.length > 12) { break; }
            done[step.id] = true; // keep going
        }
        if (verbose && (i % 25 === 0)) {
            console.log('step ' + (i + 1) + '/' + steps.length + ' ' + r.room + ' score ' + r.score);
        }
        if (game.isFinished()) { break; }
    }
    // Steps that finished early (typed ahead, or by walking back) never
    // got their own "before" reading: borrow the previous step's.
    for (let i = 0; i < steps.length; i++) {
        if (scoreBefore[i] === undefined) {
            scoreBefore[i] = i ? scoreBefore[i - 1] : 0;
            roomBeforeStep[i] = i ? roomBeforeStep[i - 1] : roomId;
        }
    }
    const won = (!cfg.winText || cfg.winText.test(last.text)) && last.score === cfg.maxScore;
    return { seed: seed, problems: problems, won: won, score: last.score, room: last.room, scoreBefore: scoreBefore, roomBefore: roomBeforeStep };
}

module.exports = { run, loadSteps };

if (require.main === module) {
    const args = require('./games').stripGameArg(process.argv.slice(2));
    if (args[0] === '--seeds') {
        const [from, to] = args[1].split('-').map((n) => parseInt(n, 10));
        const good = [];
        for (let s = from; s <= to; s++) {
            const r = run(s, false);
            if (r.problems.length === 0 && r.won) { good.push(s); }
        }
        console.log('clean seeds in ' + from + '-' + to + ': ' + (good.length ? good.join(', ') : '(none)'));
    } else if (args[0] === '--resync') {
        // Where would Resync put a player standing at each step? It must never
        // land past that step (that would silently skip real work); how far
        // before it lands is how many steps they might be asked to repeat.
        const seed = parseInt(args[1] || '1', 10);
        const steps = loadSteps();
        const r = run(seed, false, steps);
        let past = 0, none = 0, exact = 0, repeated = 0;
        steps.forEach((step, i) => {
            const found = W.findResyncIndex(steps, r.roomBefore[i], r.scoreBefore[i]);
            if (found === -1) { none++; } else if (found > i) { past++; } else { repeated += i - found; if (found === i) { exact++; } }
        });
        console.log('resync over ' + steps.length + ' positions: ' + exact + ' exact, ' + past + ' past the true step (must be 0), ' + none + ' unmatched, ' + (repeated / steps.length).toFixed(1) + ' steps repeated on average');
        process.exitCode = past || none ? 1 : 0;
    } else {
        const seed = args[0] === '--seed' ? parseInt(args[1], 10) : 13;
        const r = run(seed, true);
        console.log(r.problems.length ? r.problems.join('\n') : 'no step problems');
        console.log('seed ' + seed + ': ' + (r.won ? 'WON with ' + cfg.maxScore : 'did not win') + ' (score ' + r.score + ', ending in ' + r.room + ')');
        process.exitCode = r.problems.length || !r.won ? 1 : 0;
    }
}

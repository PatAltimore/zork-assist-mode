// Replays src/data/walkthrough.json against the real game (tools/play.js) and
// checks that every step's "done" condition actually fires -- using the very
// same tracking code the page uses (src/js/walkthrough-logic.js).
//
//   node tools/verify-walkthrough.js --seed 13       (verbose, one run)
//   node tools/verify-walkthrough.js --seeds 1-200   (which seeds play clean)
//   node tools/verify-walkthrough.js --resync 1      (check the page's Resync button)
//
// Zork's thief and combat are random, so a run only passes for some seeds.
// For each step the verifier checks that
//   1. the step is the walkthrough's *next* step when it is about to be
//      typed (nothing earlier is left hanging), and
//   2. it is marked done by the game's reply to that command.
// A passing run also ends on the win screen with all 350 points.

'use strict';
const fs = require('fs');
const path = require('path');
const { createGame } = require('./play');
const W = require('../src/js/walkthrough-logic.js');

const DATA = path.join(__dirname, '..', 'src', 'data');
function loadSteps() {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'walkthrough.json'), 'utf8')).steps;
}
const items = JSON.parse(fs.readFileSync(path.join(DATA, 'commands.json'), 'utf8')).items;
const rooms = JSON.parse(fs.readFileSync(path.join(DATA, 'map.json'), 'utf8')).rooms;
const resolveRoom = W.createRoomResolver(rooms);

// stepList defaults to the shipped walkthrough.json; tools/build-walkthrough.js
// passes freshly parsed steps. scoreBefore[i] / roomBefore[i] record the game's
// score and the room id just before step i is typed.
function run(seed, verbose, stepList) {
    const steps = stepList || loadSteps();
    const game = createGame(seed);
    const scoreBefore = [];
    const roomBeforeStep = [];
    const tracker = W.createTracker(items);
    const done = {};
    const problems = [];
    let roomId = resolveRoom(game.status().room);
    let last = { text: '', score: 0 };

    function send(cmd) {
        tracker.record(cmd);
        const roomBefore = roomId;
        const r = game.send(cmd);
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
        return r;
    }

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        scoreBefore.push(game.status().score);
        roomBeforeStep.push(roomId);
        const expected = W.nextStepIndex(steps, done);
        if (expected !== i) {
            problems.push('step ' + (i + 1) + ' (' + step.cmd + ') typed while step ' + (expected + 1) + ' (' + steps[expected].cmd + ') is still pending');
            // Catch up so one stale step doesn't hide every later problem.
            for (let j = expected; j < i; j++) { done[steps[j].id] = true; }
        }
        let r = send(step.cmd);
        const v = step.verify;
        if (v && v.fight && /don't have that|don't have the sword/i.test(r.text)) {
            send('take sword');
            r = send(step.cmd);
        }
        if (v) {
            let tries = 1;
            while (r.text.toLowerCase().indexOf(v.until.toLowerCase()) === -1 && tries < 80) {
                if (v.fight && /sword goes flying|don't have the sword|don't have that|knocked from your hand/i.test(r.text)) {
                    send('take sword');
                }
                r = send(step.cmd);
                tries++;
            }
        }
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
    const won = /completed a great and perilous/i.test(last.text) && last.score === 350;
    return { seed: seed, problems: problems, won: won, score: last.score, room: last.room, scoreBefore: scoreBefore, roomBefore: roomBeforeStep };
}

module.exports = { run, loadSteps };

if (require.main === module) {
    const args = process.argv.slice(2);
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
        console.log('seed ' + seed + ': ' + (r.won ? 'WON with 350' : 'did not win') + ' (score ' + r.score + ', ending in ' + r.room + ')');
        process.exitCode = r.problems.length || !r.won ? 1 : 0;
    }
}

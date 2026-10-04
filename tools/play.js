// Headless Zork runner: plays the real zork1.z3 through the same vendored
// Z-machine (zvm.min.js) and Glk layer (glkapi.js) the web app uses, with a
// fake GlkOte that just collects text. Used to verify the walkthrough in
// src/data/walkthrough.json against the game's actual output.
//
// Usage:
//   node tools/play.js "open mailbox" "take leaflet" ...      (commands as args)
//   node tools/play.js --file cmds.txt                        (one command per line)
//   SEED=7 node tools/play.js ...     (the game's randomness -- combat, the
//                                      thief -- is reproducible per seed)
//
// As a module: const { createGame } = require('./play'); const g = createGame();
//   g.send('open mailbox') -> { text, room, score }

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

// Seeded PRNG (mulberry32) so combat/thief randomness is reproducible.
function seededMath(seed) {
    const m = Object.create(Math);
    let a = seed >>> 0;
    m.random = function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return m;
}

function createGame(seed) {
    let acceptFn = null;
    let lineInput = null; // { id, gen }
    let pendingText = [];
    let statusText = '';
    let finished = false;

    const GlkOte = {
        init(opts) {
            acceptFn = opts.accept;
            acceptFn({
                type: 'init', gen: 0, support: [],
                metrics: { width: 80, height: 24, charwidth: 1, charheight: 1,
                    buffercharwidth: 1, buffercharheight: 1, gridcharwidth: 1, gridcharheight: 1,
                    outspacingx: 0, outspacingy: 0, inspacingx: 0, inspacingy: 0 },
            });
        },
        update(data) {
            if (data.disable) { finished = true; }
            (data.content || []).forEach((c) => {
                if (c.lines) { // grid window: status line
                    c.lines.forEach((l) => {
                        if (l.line === 0) {
                            statusText = flatten(l.content);
                        }
                    });
                }
                if (c.text) { // buffer window
                    c.text.forEach((p) => {
                        if (p.append && pendingText.length) {
                            pendingText[pendingText.length - 1] += flatten(p.content);
                        } else {
                            pendingText.push(flatten(p.content));
                        }
                    });
                }
            });
            lineInput = null;
            (data.input || []).forEach((i) => {
                if (i.type === 'line') { lineInput = { id: i.id, gen: data.gen }; }
            });
        },
        log() {}, warning() {}, error(m) { throw new Error('GlkOte error: ' + m); },
        getlibrary() { return null; }, save_allstate() { return null; },
        getdomcontext() { return null; }, setdomcontext() {},
        extevent() {}, getinterface() { return {}; },
        getdomid() { return null; },
    };

    // GlkOte content arrives either as {style, text} objects or as a flat
    // [style, text, style, text, ...] list of strings.
    function flatten(content) {
        if (!content) { return ''; }
        let out = '';
        content.forEach((c, i) => {
            if (typeof c === 'string') {
                if (i % 2 === 1) { out += c; }
            } else if (c && typeof c.text === 'string') {
                out += c.text;
            }
        });
        return out;
    }

    const sandbox = {
        console,
        document: { createElement: () => ({ getContext: undefined }), getElementById: () => null },
        navigator: { userAgent: 'node' },
        setTimeout, clearTimeout, Date, Math: seededMath(seed === undefined ? 1 : seed), JSON, Uint8Array, Array, Object, String, Number, RegExp,
        Error, parseInt, parseFloat, isNaN, Infinity, NaN, undefined,
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.jQuery = undefined;
    vm.createContext(sandbox);
    ['vendor/glkapi.js', 'vendor/zvm.min.js', 'vendor/gidispa-zvm.js'].forEach((f) => {
        vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
    });

    const game = new sandbox.ZVM();
    const options = {
        vm: game, Glk: sandbox.Glk, Dialog: { }, GlkOte,
        GiDispa: new sandbox.GiDispaZVM(),
    };
    game.prepare(new Uint8Array(fs.readFileSync(path.join(SRC, 'data', 'zork1.z3'))), options);
    sandbox.Glk.init(options);

    function drain() {
        const text = pendingText.join('\n');
        pendingText = [];
        return text;
    }

    function parseStatus() {
        const m = /^(.*?)\s+Score:\s*(-?\d+)/i.exec(statusText);
        return m ? { room: m[1].trim(), score: parseInt(m[2], 10) } : { room: statusText.trim(), score: null };
    }

    const intro = drain();
    return {
        intro,
        status: parseStatus,
        isFinished: () => finished,
        send(cmd) {
            pendingText = [];
            if (!lineInput) { throw new Error('game is not waiting for input'); }
            acceptFn({ type: 'line', gen: lineInput.gen, window: lineInput.id, value: cmd });
            const text = drain();
            return Object.assign({ text }, parseStatus());
        },
    };
}

module.exports = { createGame };

if (require.main === module) {
    let cmds = process.argv.slice(2);
    if (cmds[0] === '--file') {
        cmds = fs.readFileSync(cmds[1], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    const g = createGame(process.env.SEED ? parseInt(process.env.SEED, 10) : 1);
    console.log(g.intro);
    // A line may end in "@until some text" -- repeat the command (up to 80
    // times) until the reply contains that text, for random-outcome steps
    // like combat -- or "@fight some text", the same but retaking the sword
    // whenever the enemy knocks it away. Lines starting with # are comments.
    cmds.forEach((line) => {
        if (line.startsWith('#')) {
            return;
        }
        const m = /^(.*?)\s+@(until|fight)\s+(.*)$/.exec(line);
        const cmd = m ? m[1] : line;
        let r = g.send(cmd);
        let tries = 1;
        while (m && r.text.toLowerCase().indexOf(m[3].toLowerCase()) === -1 && tries < 80) {
            if (m[2] === 'fight' && /sword goes flying|don't have the sword|don't have that|knocked from your hand/i.test(r.text)) {
                g.send('take sword');
            }
            r = g.send(cmd);
            tries++;
        }
        console.log('> ' + cmd + (tries > 1 ? '  (x' + tries + ')' : '') + '\n' + r.text + '\n[' + r.room + ' | Score ' + r.score + ']\n');
    });
}

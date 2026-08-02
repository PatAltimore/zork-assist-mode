(function () {
    'use strict';

    // Zork I here is compiled for Z-machine v3, which has no native UNDO
    // opcode (that arrived in v5) -- so "undo" is implemented at this
    // level instead: snapshot the VM's own memory/stack (the same Quetzal
    // format used by save/restore and autosave) after every completed
    // turn, and roll back to the previous one on request. Unlike the
    // autosave/autorestore path in app.js, this runs mid-session against
    // already-live Glk windows, so it only needs vm.save_file/restore_file
    // -- no Glk window-state serialization (GiDispa/restore_allstate) is
    // involved here.

    var MAX_UNDO_DEPTH = 100;
    var MAIN_WINDOW_ROCK = 201; // see gidispa-zvm.js / ifvms.js's own convention

    var undoStack = [];
    var lastStatusText = null;

    function getVM() { return window.ZorkAssistVM; }
    function getGlk() { return window.ZorkAssistGlk; }

    // Printing via the real Glk API (glk_put_string_stream) is a dead end
    // here: Glk forbids writing to a window's stream while it has a
    // pending line request ("window has pending line request"), and the
    // window we want to print to is *always* in that state when the
    // player types "undo" -- that's the whole point, it's waiting for the
    // next command. Canceling the pending request to work around that
    // would desync ZVM's own suspended glk_select from what GlkOte expects
    // next. Inserting a DOM node directly is safer: it never touches Glk's
    // request/response state machine, so the original pending input
    // request (and everything ZVM is waiting on) is left completely
    // undisturbed -- only the display gains a line.
    function findMainWindowElement() {
        return document.querySelector('.BufferWindow.WindowRock_' + MAIN_WINDOW_ROCK)
            || document.querySelector('.BufferWindow');
    }

    function getBufferLines(win) {
        return Array.prototype.filter.call(win.children, function (el) {
            return el.classList.contains('BufferLine');
        });
    }

    function makeLine(text, styleClass) {
        var lineDiv = document.createElement('div');
        lineDiv.className = 'BufferLine';
        var span = document.createElement('span');
        span.className = styleClass;
        span.textContent = text;
        lineDiv.appendChild(span);
        return lineDiv;
    }

    function printSystemMessage(text, echoText) {
        var win = findMainWindowElement();
        if (!win) return;
        var lines = getBufferLines(win);
        var promptLine = lines[lines.length - 1];
        var insertBefore = (promptLine && promptLine.parentElement === win) ? promptLine : null;

        if (echoText) {
            win.insertBefore(makeLine('>' + echoText, 'Style_input'), insertBefore);
        }
        win.insertBefore(makeLine(text, 'Style_note'), insertBefore);
        win.scrollTop = win.scrollHeight;
    }

    function takeSnapshot() {
        var vm = getVM();
        if (!vm) return;
        try {
            undoStack.push(vm.save_file(vm.pc, 1));
            if (undoStack.length > MAX_UNDO_DEPTH) {
                undoStack.shift();
            }
        } catch (e) {
            console.error('Undo: snapshot failed', e);
        }
    }

    // Set right before we auto-submit "look" below, so the turn it causes
    // isn't itself pushed as a new undo point -- otherwise a second undo
    // would just undo our own refresh step instead of the player's last
    // real action.
    var suppressNextSnapshot = false;

    function submitLook() {
        var input = document.querySelector('#windowport input.Input');
        if (!input) return;
        input.value = 'look';
        var ev = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        input.dispatchEvent(ev);
    }

    function performUndo() {
        if (undoStack.length < 2) {
            printSystemMessage("You can't undo any further.", 'undo');
            return;
        }
        var vm = getVM();
        undoStack.pop(); // the state we're at right now
        var target = undoStack[undoStack.length - 1];
        try {
            vm.restore_file(target, 1);
            printSystemMessage('(Undone.)', 'undo');
            // The restore above doesn't refresh the status line or reprint
            // the room -- nothing told the interpreter to redraw, since we
            // skipped its normal turn-processing entirely. A real "look",
            // submitted the same way any other command is, forces both:
            // it's a genuine turn, so it costs one (the turn counter won't
            // visibly decrease the way undo alone would suggest), but it's
            // the simplest reliable way to get the game's own code to
            // redraw correctly rather than hand-reconstructing status-line
            // text ourselves from raw VM memory.
            suppressNextSnapshot = true;
            submitLook();
        } catch (e) {
            console.error('Undo: restore failed', e);
            printSystemMessage('Undo failed.', 'undo');
        }
    }

    function getStatusText() {
        var line = document.querySelector('.GridWindow .GridLine');
        return line ? (line.textContent || '') : null;
    }

    var checkTimer = null;
    function scheduleTurnCheck() {
        if (checkTimer) return;
        checkTimer = setTimeout(function () {
            checkTimer = null;
            var text = getStatusText();
            if (text === null || text === lastStatusText) {
                return;
            }
            lastStatusText = text;
            if (suppressNextSnapshot) {
                suppressNextSnapshot = false;
                return;
            }
            takeSnapshot();
        }, 80);
    }

    function initInputInterceptor() {
        var windowport = document.getElementById('windowport');
        if (!windowport) return;
        // Capturing-phase listener on an ancestor runs before GlkOte's own
        // keypress handler (bound directly on the input element), so
        // returning after stopImmediatePropagation() here keeps "undo"
        // from ever reaching the Z-machine parser, which wouldn't
        // recognize it as a word anyway.
        windowport.addEventListener('keypress', function (ev) {
            if (ev.keyCode !== 13 && ev.which !== 13) {
                return;
            }
            var target = ev.target;
            if (!target || !target.matches || !target.matches('input.Input')) {
                return;
            }
            if ((target.value || '').trim().toLowerCase() !== 'undo') {
                return;
            }
            ev.preventDefault();
            ev.stopImmediatePropagation();
            target.value = '';
            performUndo();
        }, true);
    }

    function initObserver() {
        var target = document.getElementById('windowport');
        if (!target) return;
        var observer = new MutationObserver(scheduleTurnCheck);
        observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    function init() {
        initInputInterceptor();
        initObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

(function () {
    'use strict';

    // GlkOte gives the line-input <input> a native text caret, but a thin
    // line doesn't read as "retro terminal." caret-shape:block would do
    // this in CSS alone, but browser support is still too patchy to rely
    // on. Instead we hide the native caret and draw our own blinking block,
    // positioned by measuring the typed text in an invisible mirror span --
    // both siblings live inside .InvisibleCursor, which GlkOte already
    // makes a position:relative anchor for the input itself.

    var TYPING_PAUSE_MS = 500;

    function attach(input) {
        if (input.dataset.blockCursorAttached) {
            return;
        }
        input.dataset.blockCursorAttached = '1';
        input.classList.add('has-block-cursor');

        var mirror = document.createElement('span');
        mirror.className = 'fake-cursor-mirror';
        var cursor = document.createElement('span');
        cursor.className = 'fake-block-cursor';

        var parent = input.parentNode;
        parent.insertBefore(mirror, input);
        parent.insertBefore(cursor, input.nextSibling);

        var typingTimer = null;

        function update() {
            mirror.textContent = input.value;
            cursor.style.left = mirror.offsetWidth + 'px';
        }

        function onInput() {
            update();
            cursor.classList.add('typing');
            if (typingTimer) {
                clearTimeout(typingTimer);
            }
            typingTimer = setTimeout(function () {
                cursor.classList.remove('typing');
            }, TYPING_PAUSE_MS);
        }

        input.addEventListener('input', onInput);
        update();
    }

    function scan() {
        var input = document.querySelector('#windowport input.Input');
        if (input) {
            attach(input);
        }
    }

    function init() {
        var target = document.getElementById('windowport');
        if (!target) {
            return;
        }
        var observer = new MutationObserver(scan);
        observer.observe(target, { childList: true, subtree: true });
        scan();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

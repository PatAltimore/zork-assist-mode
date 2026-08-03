(function () {
    'use strict';

    var NEW_GAME_FLAG_KEY = 'zork-assist-new-game-requested';
    var MAP_VISITED_KEY = 'zork-assist-map-visited-v1';
    var MAP_CURRENT_KEY = 'zork-assist-map-current-v1';
    var FONT_SIZE_KEY = 'zork-assist-font-size-px';
    var THEME_KEY = 'zork-assist-theme';

    var DEFAULT_FONT_SIZE = 16;
    var MIN_FONT_SIZE = 12;
    var MAX_FONT_SIZE = 24;
    var FONT_SIZE_STEP = 2;

    function showError(message) {
        var pane = document.getElementById('loadingpane');
        if (pane) {
            pane.innerHTML = '<em>' + message + '</em>';
        }
        console.error(message);
    }

    function boot() {
        var startFresh = false;
        try {
            startFresh = localStorage.getItem(NEW_GAME_FLAG_KEY) === '1';
            if (startFresh) {
                localStorage.removeItem(NEW_GAME_FLAG_KEY);
            }
        } catch (e) {
            // localStorage unavailable -- just boot normally each time.
        }

        fetch('data/zork1.z3')
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.arrayBuffer();
            })
            .then(function (buffer) {
                var vm = new ZVM();
                var options = {
                    vm: vm,
                    Glk: Glk,
                    Dialog: Dialog,
                    GlkOte: GlkOte,
                    GiDispa: new GiDispaZVM(),
                    do_vm_autosave: true,
                    clear_vm_autosave: startFresh
                };
                // Exposed for js/undo.js, which needs direct access to the
                // VM's own save_file/restore_file (Quetzal) and to Glk for
                // printing its own messages -- kept as a small shared
                // handle rather than restructuring app.js around events.
                window.ZorkAssistVM = vm;
                window.ZorkAssistGlk = Glk;
                vm.prepare(new Uint8Array(buffer), options);
                Glk.init(options);
            })
            .catch(function (err) {
                showError('Could not load the game data (' + err.message + '). Try reloading the page.');
            });
    }

    function initHintToggle() {
        var toggle = document.getElementById('hint-toggle');
        var panel = document.getElementById('assist-panel');
        if (!toggle || !panel) {
            return;
        }

        function setCollapsed(collapsed) {
            panel.classList.toggle('collapsed', collapsed);
            toggle.textContent = collapsed ? 'Show Hints' : 'Hide Hints';
            toggle.setAttribute('aria-expanded', String(!collapsed));
        }

        toggle.addEventListener('click', function () {
            setCollapsed(!panel.classList.contains('collapsed'));
        });

        initMobileAutoHide(setCollapsed);
    }

    var MOBILE_QUERY = '(max-width: 760px)';

    function initMobileAutoHide(setHintsCollapsed) {
        // On narrow (mobile) screens the assist panel sits below the game
        // text and the header sits above it, both eating into the limited
        // vertical space available to read the adventure text. Earlier
        // versions tried to hide these automatically -- on scroll, then on
        // focusing the command line for the on-screen keyboard -- but both
        // caused more problems than they solved on real devices (fighting
        // with the keyboard, iOS viewport quirks). This is now purely
        // manual: each has its own small tab, always present on mobile
        // right where the element would be, that just toggles it. Desktop
        // is unaffected, and the header's own Hide/Show Hints button still
        // works at any width.
        var header = document.getElementById('app-header');
        var headerPeek = document.getElementById('header-peek');
        var hintsPeek = document.getElementById('hints-peek');
        var mobileQuery = window.matchMedia(MOBILE_QUERY);
        var hintsHidden = false;

        function setHeaderHidden(v) {
            if (!header) {
                return;
            }
            header.classList.toggle('header-hidden', v);
            if (headerPeek) {
                headerPeek.textContent = v ? '▾ Menu' : '▴ Hide Menu';
                headerPeek.setAttribute('aria-label', v ? 'Show header' : 'Hide header');
            }
        }

        function setHintsHidden(v) {
            hintsHidden = v;
            setHintsCollapsed(v);
            if (hintsPeek) {
                hintsPeek.textContent = v ? '▴ Hints' : '▾ Hide Hints';
                hintsPeek.setAttribute('aria-label', v ? 'Show hints panel' : 'Hide hints panel');
            }
        }

        if (headerPeek) {
            headerPeek.addEventListener('click', function () {
                setHeaderHidden(!header.classList.contains('header-hidden'));
            });
        }

        if (hintsPeek) {
            hintsPeek.addEventListener('click', function () {
                setHintsHidden(!hintsHidden);
            });
        }

        mobileQuery.addEventListener('change', function (ev) {
            if (!ev.matches) {
                setHeaderHidden(false);
                setHintsHidden(false);
            }
        });
    }

    function initKeyboardViewportFix() {
        // The actual bug reports (iPhone: history disappears, the prompt
        // scrolls out of view after a command; Kindle Silk: only a few
        // lines show above a big dead area) both come from the same root
        // cause -- the on-screen keyboard covers part of the screen without
        // our height:100% layout knowing to shrink, so the game panel keeps
        // claiming space that isn't actually visible, and whatever the
        // browser's own "scroll the focused input into view" heuristic
        // decides often lands somewhere unhelpful. window.visualViewport
        // reports the space that's actually visible (keyboard excluded) on
        // both iOS Safari and Chromium-based browsers like Silk, so we use
        // it to size #app for real, and separately force the game text
        // back to its own bottom (where the prompt is) whenever the
        // keyboard is likely up.
        var app = document.getElementById('app');
        var gameport = document.getElementById('gameport');
        var mobileQuery = window.matchMedia(MOBILE_QUERY);
        if (!app) {
            return;
        }

        function syncHeight() {
            if (!mobileQuery.matches) {
                app.style.height = '';
                return;
            }
            var vv = window.visualViewport;
            app.style.height = (vv ? vv.height : window.innerHeight) + 'px';
        }

        syncHeight();
        window.addEventListener('resize', syncHeight);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', syncHeight);
        }

        if (!gameport) {
            return;
        }

        function isInputFocused() {
            var active = document.activeElement;
            return !!(active && active.tagName === 'INPUT' && gameport.contains(active));
        }

        function scrollToBottom() {
            var buf = document.querySelector('.BufferWindow');
            if (buf) {
                buf.scrollTop = buf.scrollHeight;
            }
        }

        gameport.addEventListener('focusin', function (ev) {
            if (mobileQuery.matches && ev.target && ev.target.tagName === 'INPUT') {
                // The keyboard's own appearance animation, and the
                // browser's competing scroll-into-view attempt, both take
                // a moment -- correct the scroll position a few times as
                // things settle rather than trusting a single attempt.
                scrollToBottom();
                setTimeout(scrollToBottom, 50);
                setTimeout(scrollToBottom, 350);
            }
        });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function () {
                if (mobileQuery.matches && isInputFocused()) {
                    scrollToBottom();
                }
            });
        }

        // The game's response to your last command can print while the
        // keyboard is still up -- keep the prompt in view as it arrives.
        var observer = new MutationObserver(function () {
            if (mobileQuery.matches && isInputFocused()) {
                scrollToBottom();
            }
        });
        observer.observe(gameport, { childList: true, subtree: true, characterData: true });
    }

    function sendGameCommand(cmd) {
        var input = document.querySelector('#windowport input.Input');
        if (!input) {
            return false;
        }
        input.focus();
        input.value = cmd;
        var ev = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        input.dispatchEvent(ev);
        return true;
    }

    function initSaveLoadButtons() {
        var saveButton = document.getElementById('save-game');
        var loadButton = document.getElementById('load-game');
        if (saveButton) {
            saveButton.addEventListener('click', function () {
                sendGameCommand('save');
            });
        }
        if (loadButton) {
            loadButton.addEventListener('click', function () {
                sendGameCommand('load');
            });
        }
    }

    function applyFontSize(px) {
        document.documentElement.style.fontSize = px + 'px';
        try {
            localStorage.setItem(FONT_SIZE_KEY, String(px));
        } catch (e) {
            // Ignore -- just won't persist across reloads.
        }
    }

    function initFontSizeButtons() {
        var decreaseButton = document.getElementById('font-size-decrease');
        var increaseButton = document.getElementById('font-size-increase');
        if (!decreaseButton || !increaseButton) {
            return;
        }

        var size = DEFAULT_FONT_SIZE;
        try {
            var stored = parseInt(localStorage.getItem(FONT_SIZE_KEY), 10);
            if (!isNaN(stored)) {
                size = stored;
            }
        } catch (e) {
            // Ignore -- use the default.
        }
        size = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
        applyFontSize(size);
        updateFontSizeButtons();

        function updateFontSizeButtons() {
            decreaseButton.disabled = size <= MIN_FONT_SIZE;
            increaseButton.disabled = size >= MAX_FONT_SIZE;
        }

        decreaseButton.addEventListener('click', function () {
            size = Math.max(MIN_FONT_SIZE, size - FONT_SIZE_STEP);
            applyFontSize(size);
            updateFontSizeButtons();
        });

        increaseButton.addEventListener('click', function () {
            size = Math.min(MAX_FONT_SIZE, size + FONT_SIZE_STEP);
            applyFontSize(size);
            updateFontSizeButtons();
        });
    }

    function initThemeToggle() {
        var toggle = document.getElementById('theme-toggle');
        if (!toggle) {
            return;
        }

        var modern = false;
        try {
            modern = localStorage.getItem(THEME_KEY) === 'modern';
        } catch (e) {
            // Ignore -- default to the retro CRT look.
        }

        function apply() {
            document.body.classList.toggle('theme-modern', modern);
            toggle.textContent = modern ? 'Retro' : 'Modern';
        }
        apply();

        toggle.addEventListener('click', function () {
            modern = !modern;
            try {
                localStorage.setItem(THEME_KEY, modern ? 'modern' : 'crt');
            } catch (e) {
                // Ignore -- just won't persist across reloads.
            }
            apply();
        });
    }

    function initNewGameButton() {
        var button = document.getElementById('new-game');
        if (!button) {
            return;
        }
        button.addEventListener('click', function () {
            var ok = window.confirm('Start a new game? This erases your current saved progress and map.');
            if (!ok) {
                return;
            }
            try {
                localStorage.setItem(NEW_GAME_FLAG_KEY, '1');
                localStorage.removeItem(MAP_VISITED_KEY);
                localStorage.removeItem(MAP_CURRENT_KEY);
            } catch (e) {
                // Ignore -- the reload will still restart the VM fresh
                // even if we couldn't persist the "clear autosave" flag,
                // it just won't discard the old autosave first.
            }
            window.location.reload();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            boot();
            initHintToggle();
            initSaveLoadButtons();
            initFontSizeButtons();
            initThemeToggle();
            initNewGameButton();
            initKeyboardViewportFix();
        });
    } else {
        boot();
        initHintToggle();
        initSaveLoadButtons();
        initFontSizeButtons();
        initThemeToggle();
        initNewGameButton();
        initKeyboardViewportFix();
    }
})();

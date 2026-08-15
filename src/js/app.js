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

    // Two corrections needed every time the header or hints panel is
    // shown/hidden, since both change #gameport's actual size on screen:
    //
    // 1. iOS Safari/Edge (WebKit) can leave the game text's own
    //    touch-scrolling "stuck" after its container is resized. Briefly
    //    toggling overflow off and back on is a well-known way to make
    //    WebKit recompute the scrollable region instead of trusting a
    //    stale one.
    // 2. GlkOte's own on-screen-keyboard handling (vendor/glkote.js,
    //    evhan_viewport_resize) measures gameport's margins exactly once
    //    at startup and never again, on the assumption that a host page
    //    never moves gameport around. Toggling our header/hints panel
    //    breaks that assumption, so GlkOte's keyboard math goes stale --
    //    which shows up as a chunk of dead space where gameport didn't
    //    grow back to fill the screen after the keyboard closes. We
    //    patched a small recompute function into our vendored copy (see
    //    THIRD_PARTY_NOTICES.md) specifically so we can re-arm it here,
    //    right when we're the ones causing the resize.
    //
    // Neither of these is an ongoing scroll/resize listener -- just a
    // one-time correction fired at the exact moment we change the layout.
    function correctGameportAfterToggle() {
        var buf = document.querySelector('.BufferWindow');
        if (buf) {
            buf.style.overflow = 'hidden';
            void buf.offsetHeight; // force a reflow before restoring
            buf.style.overflow = '';
        }
        if (window.GlkOte && typeof window.GlkOte.recompute_gameport_margins === 'function') {
            window.GlkOte.recompute_gameport_margins();
        }
    }

    // Safety net for GlkOte's own on-screen-keyboard handling
    // (vendor/glkote.js, evhan_viewport_resize), which sets #gameport's
    // top/height directly to carve out the space above the keyboard. That
    // math can end up stale -- e.g. if the keyboard closes right after the
    // hints panel was toggled while it was still open, or a device rotates
    // -- leaving gameport stuck with a leftover inline top/height even
    // though no keyboard is actually up any more. Depending on which way
    // it's stale, that shows up as either a dead black band at the bottom
    // that isn't part of any scrollable content, or (rotating to landscape)
    // the buffer window's text pushed up out of view at the top with
    // nothing to scroll back to it. Rather than trying to out-guess
    // GlkOte's calculation for every case, this just checks the one thing
    // that's unambiguous: whether there's currently any real gap between
    // the window and the visible viewport at all. If there isn't (no
    // keyboard up), gameport should simply fill its container -- so clear
    // whatever inline top/height GlkOte left behind and let our own CSS
    // (inset: 0) take back over, instead of trusting its last calculation.
    function initGameportKeyboardSafetyNet() {
        if (!window.visualViewport) {
            return;
        }
        var gameport = document.getElementById('gameport');
        if (!gameport) {
            return;
        }
        // Gates this to touchscreens specifically -- an on-screen-keyboard
        // correction has no business running on a desktop trackpad/mouse
        // setup. Deliberately NOT a viewport-width check (e.g.
        // max-width: 760px, which the mobile layout breakpoint elsewhere
        // uses): "coarse pointer" describes the input device, not the
        // current orientation, so it still matches a phone turned
        // landscape -- where most current iPhones (13 mini and up) report
        // a viewport well over 760px wide, which silently skipped this
        // entire correction and was exactly why landscape got stuck.
        var mobileQuery = window.matchMedia('(pointer: coarse)');

        function maybeResetGameport() {
            if (!mobileQuery.matches) {
                return;
            }
            var gap = window.innerHeight - window.visualViewport.height;
            if (gap < 50) {
                gameport.style.top = '';
                gameport.style.height = '';
                if (window.GlkOte && typeof window.GlkOte.recompute_gameport_margins === 'function') {
                    window.GlkOte.recompute_gameport_margins();
                }
            }
        }

        window.visualViewport.addEventListener('resize', function () {
            // Deferred so this runs after GlkOte's own (synchronous)
            // handler for the same event has already had its say --
            // we're a correction on top of it, not a competing one.
            setTimeout(maybeResetGameport, 50);
        });

        // Belt and suspenders: visualViewport's own "resize" already fires
        // on rotation and should be sufficient on its own, but rotation is
        // exactly the case this safety net exists for, so this also reruns
        // the same check directly off the rotation event itself -- cheap,
        // idempotent (maybeResetGameport is a no-op once nothing's stale),
        // and one less thing to depend on iOS getting the timing of the
        // other event exactly right.
        window.addEventListener('orientationchange', function () {
            setTimeout(maybeResetGameport, 150);
        });
    }

    function initHintToggle() {
        var toggle = document.getElementById('hint-toggle');
        var panel = document.getElementById('assist-panel');
        if (!toggle || !panel) {
            return;
        }
        // Present on mobile only (see .edge-peek in style.css) -- a second,
        // always-reachable manual toggle for the hints panel, since the
        // header (and the button above) can itself be hidden via its own
        // peek tab. Routing both through this one setCollapsed keeps them
        // from ever disagreeing about the current state.
        var hintsPeek = document.getElementById('hints-peek');

        function setCollapsed(collapsed) {
            panel.classList.toggle('collapsed', collapsed);
            toggle.textContent = collapsed ? 'Show Hints' : 'Hide Hints';
            toggle.setAttribute('aria-expanded', String(!collapsed));
            if (hintsPeek) {
                hintsPeek.textContent = collapsed ? '▴ Hints' : '▾ Hide Hints';
                hintsPeek.setAttribute('aria-label', collapsed ? 'Show hints panel' : 'Hide hints panel');
                // Only float (pin to the real visual viewport, see
                // .floating in style.css) while collapsed -- when the
                // panel is open it's back in normal document flow, right
                // above the panel where it visually belongs.
                hintsPeek.classList.toggle('floating', collapsed);
            }
            correctGameportAfterToggle();
        }

        toggle.addEventListener('click', function () {
            setCollapsed(!panel.classList.contains('collapsed'));
        });

        if (hintsPeek) {
            hintsPeek.addEventListener('click', function () {
                setCollapsed(!panel.classList.contains('collapsed'));
            });
        }

        initHeaderPeek();
    }

    // Plain manual show/hide for the header on mobile -- no scroll, focus,
    // or viewport handling of any kind. Several rounds of trying to
    // automate this around the on-screen keyboard all made real devices
    // (iPhone, Kindle Fire) behave worse than doing nothing, so this is
    // deliberately just a tab, always present on mobile, that toggles
    // visibility on tap and nothing else.
    function initHeaderPeek() {
        var header = document.getElementById('app-header');
        var headerPeek = document.getElementById('header-peek');
        if (!headerPeek || !header) {
            return;
        }
        headerPeek.addEventListener('click', function () {
            var hidden = !header.classList.contains('header-hidden');
            header.classList.toggle('header-hidden', hidden);
            headerPeek.textContent = hidden ? '▾ Menu' : '▴ Hide Menu';
            headerPeek.setAttribute('aria-label', hidden ? 'Show header' : 'Hide header');
            correctGameportAfterToggle();
        });
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
            initGameportKeyboardSafetyNet();
        });
    } else {
        boot();
        initHintToggle();
        initSaveLoadButtons();
        initFontSizeButtons();
        initThemeToggle();
        initNewGameButton();
        initGameportKeyboardSafetyNet();
    }
})();

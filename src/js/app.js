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
    var MOBILE_SCROLL_THRESHOLD = 12;
    var MOBILE_EDGE_TOLERANCE = 8;
    var MOBILE_SUPPRESS_MS = 250;

    function initMobileAutoHide(setHintsCollapsed) {
        // On narrow (mobile) screens the assist panel sits below the game
        // text and the header sits above it, both eating into the limited
        // vertical space available to read the adventure text. Each is tied
        // to the game text's own edge on its side: the hints panel slides in
        // once you're caught up at the bottom (latest text) and hides as
        // soon as you scroll away from it; the header slides in once you've
        // scrolled all the way back to the top of the transcript and hides
        // as soon as you scroll away from that. Scrolling around in the
        // middle of the history touches neither. Desktop is unaffected, and
        // the manual Hide/Show Hints button still works at any width.
        var gameport = document.getElementById('gameport');
        var header = document.getElementById('app-header');
        var mobileQuery = window.matchMedia(MOBILE_QUERY);
        var lastScrollTop = null;
        var lastScrollHeight = null;
        var suppressUntil = 0;
        var hintsHidden = false;
        var headerHidden = false;

        function setHeaderHidden(v) {
            if (header) {
                header.classList.toggle('header-hidden', v);
            }
        }

        if (gameport) {
            gameport.addEventListener('scroll', function (ev) {
                if (!mobileQuery.matches) {
                    return;
                }
                var target = ev.target;
                if (!target || typeof target.scrollTop !== 'number') {
                    return;
                }
                var current = target.scrollTop;
                var currentHeight = target.scrollHeight;
                if (lastScrollTop === null) {
                    // First scroll event we've ever seen -- just record a
                    // baseline. Without this the very first event would
                    // diff against a bogus lastScrollTop of 0 and register
                    // as a huge (fake) scroll.
                    lastScrollTop = current;
                    lastScrollHeight = currentHeight;
                    return;
                }
                var contentChanged = currentHeight !== lastScrollHeight;
                var delta = current - lastScrollTop;
                var previous = lastScrollTop;
                lastScrollTop = current;
                lastScrollHeight = currentHeight;

                // New game text (a turn, or the autosave restoring on load)
                // grows the buffer and GlkOte auto-scrolls to follow it --
                // that jump looks just like a fast user scroll but isn't
                // one, and comparing scrollTop across two different content
                // heights isn't meaningful anyway, so skip it entirely.
                if (contentChanged) {
                    return;
                }

                // Ignore scroll events caused by our own hide/show just
                // changing the game panel's height (the browser can clamp
                // scrollTop when that happens, which would otherwise look
                // like a user scroll and flip things right back).
                if (Date.now() < suppressUntil) {
                    return;
                }
                if (Math.abs(delta) < MOBILE_SCROLL_THRESHOLD) {
                    return;
                }

                // Gate on the scroll edge, not just the resting position:
                // either end of this movement being near an edge counts, so
                // both "scrolling away from it" and "scrolling back to it"
                // register, while scrolling around further within the
                // history (neither end near an edge) does not.
                var maxScroll = target.scrollHeight - target.clientHeight;
                var nearBottom = (maxScroll - previous) <= MOBILE_EDGE_TOLERANCE ||
                    (maxScroll - current) <= MOBILE_EDGE_TOLERANCE;
                var nearTop = previous <= MOBILE_EDGE_TOLERANCE || current <= MOBILE_EDGE_TOLERANCE;
                if (!nearBottom && !nearTop) {
                    return;
                }

                var scrollingDown = delta > 0;
                var changed = false;

                if (nearBottom) {
                    var wantHintsHidden = !scrollingDown; // away from the bottom
                    if (wantHintsHidden !== hintsHidden) {
                        hintsHidden = wantHintsHidden;
                        setHintsCollapsed(hintsHidden);
                        changed = true;
                    }
                }

                if (nearTop) {
                    var wantHeaderHidden = scrollingDown; // away from the top
                    if (wantHeaderHidden !== headerHidden) {
                        headerHidden = wantHeaderHidden;
                        setHeaderHidden(headerHidden);
                        changed = true;
                    }
                }

                if (changed) {
                    suppressUntil = Date.now() + MOBILE_SUPPRESS_MS;
                }
            }, true);
        }

        mobileQuery.addEventListener('change', function (ev) {
            if (!ev.matches) {
                hintsHidden = false;
                headerHidden = false;
                setHintsCollapsed(false);
                setHeaderHidden(false);
            }
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
        });
    } else {
        boot();
        initHintToggle();
        initSaveLoadButtons();
        initFontSizeButtons();
        initThemeToggle();
        initNewGameButton();
    }
})();

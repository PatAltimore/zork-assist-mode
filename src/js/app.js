(function () {
    'use strict';

    var NEW_GAME_FLAG_KEY = 'zork-assist-new-game-requested';
    var MAP_VISITED_KEY = 'zork-assist-map-visited-v1';
    var MAP_CURRENT_KEY = 'zork-assist-map-current-v1';
    var FONT_SIZE_KEY = 'zork-assist-font-size-px';
    var FONT_STYLE_KEY = 'zork-assist-font-style';

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
        toggle.addEventListener('click', function () {
            var collapsed = panel.classList.toggle('collapsed');
            toggle.textContent = collapsed ? 'Show Hints' : 'Hide Hints';
            toggle.setAttribute('aria-expanded', String(!collapsed));
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

    function initFontStyleToggle() {
        var toggle = document.getElementById('font-style-toggle');
        if (!toggle) {
            return;
        }

        var modern = false;
        try {
            modern = localStorage.getItem(FONT_STYLE_KEY) === 'modern';
        } catch (e) {
            // Ignore -- default to retro.
        }

        function apply() {
            document.body.classList.toggle('font-modern', modern);
            toggle.textContent = modern ? 'Retro Font' : 'Modern Font';
        }
        apply();

        toggle.addEventListener('click', function () {
            modern = !modern;
            try {
                localStorage.setItem(FONT_STYLE_KEY, modern ? 'modern' : 'retro');
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
            initFontStyleToggle();
            initNewGameButton();
        });
    } else {
        boot();
        initHintToggle();
        initSaveLoadButtons();
        initFontSizeButtons();
        initFontStyleToggle();
        initNewGameButton();
    }
})();

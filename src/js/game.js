(function () {
    'use strict';

    // Which Zork is being played. Loaded first, before every other script,
    // because they all ask it where their data lives and what to call their
    // localStorage keys. Adding a game (Zork III...) is: a data/<id>/ folder
    // (story.z3, map.json, hints.json, commands.json, walkthrough.json) plus
    // one entry here.
    //
    //   title / roman   shown in the header and page title
    //   maxScore        the game's top score (the walkthrough ends on it)
    //   codeMuseum      whether the Code tab has links (data/<id>/code-museum-links.json;
    //                   Code Museum covers Zork I's MDL ancestor and Zork II/III's ZIL)
    var GAMES = {
        zork1: { id: 'zork1', title: 'Zork I', subtitle: 'The Great Underground Empire', maxScore: 350, codeMuseum: true },
        zork2: { id: 'zork2', title: 'Zork II', subtitle: 'The Wizard of Frobozz', maxScore: 400, codeMuseum: true },
        zork3: { id: 'zork3', title: 'Zork III', subtitle: 'The Dungeon Master', maxScore: 7, codeMuseum: true }
    };
    var DEFAULT_GAME = 'zork1';
    var GAME_KEY = 'zork-assist-game';

    function chooseGame() {
        var wanted = null;
        try {
            // A ?game=zork2 link wins (and is remembered); otherwise
            // whatever was played last.
            var m = /[?&]game=([a-z0-9]+)/.exec(window.location.search);
            if (m && GAMES[m[1]]) {
                wanted = m[1];
                localStorage.setItem(GAME_KEY, wanted);
            } else {
                wanted = localStorage.getItem(GAME_KEY);
            }
        } catch (e) {
            // localStorage unavailable -- the ?game= link still works for
            // this page load, it just isn't remembered.
        }
        return GAMES[wanted] ? wanted : DEFAULT_GAME;
    }

    var def = GAMES[chooseGame()];

    var api = {
        id: def.id,
        title: def.title,
        subtitle: def.subtitle,
        maxScore: def.maxScore,
        hasCodeMuseum: def.codeMuseum,
        games: GAMES,

        // 'map.json' -> 'data/zork2/map.json'
        dataUrl: function (name) {
            return 'data/' + def.id + '/' + name;
        },

        // Per-game localStorage key. Zork I keeps its original, unsuffixed
        // keys so progress saved before there was a game choice still loads.
        key: function (base) {
            return def.id === DEFAULT_GAME ? base : base + '-' + def.id;
        },

        // The Code tab has nothing for games Code Museum doesn't cover; give
        // the modules that expect its data an empty, valid stand-in.
        loadData: function (name) {
            if (name === 'code-museum-links.json' && !def.codeMuseum) {
                return Promise.resolve({ base: '', bookmarks: {}, general: [], byRoom: {}, byHintTopic: {} });
            }
            return fetch(api.dataUrl(name)).then(function (r) {
                if (!r.ok) {
                    throw new Error(name + ': HTTP ' + r.status);
                }
                return r.json();
            });
        },

        // Switching reloads on the other game's own saved state.
        switchTo: function (id) {
            if (!GAMES[id] || id === def.id) {
                return;
            }
            try {
                localStorage.setItem(GAME_KEY, id);
            } catch (e) {
                // Fall through -- the ?game= param below still selects it.
            }
            window.location.href = window.location.pathname + '?game=' + id;
        }
    };
    window.ZorkGame = api;

    // Page chrome that names the game.
    document.title = def.title + ' — Assist Mode';
    document.documentElement.setAttribute('data-game', def.id);
    document.addEventListener('DOMContentLoaded', function () {
        document.body.classList.toggle('no-code-tab', !def.codeMuseum);
        var heading = document.getElementById('game-title');
        if (heading) {
            heading.textContent = def.title.toUpperCase();
        }
        var loading = document.getElementById('loading-title');
        if (loading) {
            loading.textContent = def.title;
        }
        var noscript = document.getElementById('noscript-title');
        if (noscript) {
            noscript.textContent = def.title;
        }
        var appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
        if (appTitle) {
            appTitle.setAttribute('content', def.title);
        }
    });
})();

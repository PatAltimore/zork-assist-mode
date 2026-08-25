(function () {
    'use strict';

    // Some Android/Fire OS browsers (observed on Kindle Fire Silk) pop the
    // on-screen keyboard when a native <select> with many options is
    // focused, apparently treating it as a searchable/type-ahead combo box.
    // The topic pickers in the hints and code-museum tabs are populated
    // dynamically (see hints.js / codemuseum.js), so it's safe to fully
    // replace their interactive surface with a plain button + listbox that
    // a touchscreen never has reason to treat as text entry, while leaving
    // the original <select> in the DOM (hidden) as the single source of
    // truth those other scripts already read via .value and listen to via
    // "change". The value isn't only ever set by a click here anymore,
    // though (see js/tab-indicators.js, which jumps the hint topic to match
    // the current room), so this also listens for a "change" it didn't
    // originate itself and re-syncs the visible button/list to match.
    // LEARNING NOTE: this file builds a fake dropdown out of a <button> and
    // a <ul>, since a real <select> is what's causing the keyboard-popping
    // problem described above -- but a screen reader or other assistive
    // tech has no idea a plain button+list is *supposed* to behave like a
    // dropdown unless it's told so explicitly. That's what the
    // `role="listbox"`/`role="option"` and `aria-*` attributes sprinkled
    // through this function are for (ARIA = Accessible Rich Internet
    // Applications): they don't change how anything looks or behaves for a
    // mouse/keyboard user, but they tell assistive tech "treat this button
    // as a dropdown trigger", "treat this list as the dropdown's options",
    // "this option is currently selected", and so on.
    function enhanceSelect(select) {
        if (!select || select.dataset.customSelectApplied) {
            return;
        }
        // LEARNING NOTE: `.dataset` is how JS reads/writes an element's
        // custom `data-*` HTML attributes -- `select.dataset.customSelectApplied`
        // corresponds to an attribute named `data-custom-select-applied`
        // (dataset automatically converts between camelCase in JS and
        // dash-case in HTML). It's a convenient, standard place to stash
        // small bits of state directly on an element, like this flag
        // marking "don't set this select up twice".
        select.dataset.customSelectApplied = '1';

        var nativeId = select.id;
        select.removeAttribute('id');
        select.style.display = 'none';
        select.tabIndex = -1;

        var button = document.createElement('button');
        button.type = 'button';
        button.id = nativeId;
        button.className = 'fake-select-button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');

        var label = document.createElement('span');
        label.className = 'fake-select-label';
        var arrow = document.createElement('span');
        arrow.className = 'fake-select-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '▾';
        button.appendChild(label);
        button.appendChild(arrow);

        var list = document.createElement('ul');
        list.className = 'fake-select-list';
        list.setAttribute('role', 'listbox');
        list.hidden = true;

        select.parentNode.insertBefore(button, select);
        select.parentNode.insertBefore(list, select);

        var highlightedIndex = -1;

        function optionEls() {
            return Array.prototype.slice.call(list.querySelectorAll('.fake-select-option'));
        }

        function syncButtonLabel() {
            var opt = select.options[select.selectedIndex];
            label.textContent = opt ? opt.textContent : '';
        }

        function rebuildList() {
            list.innerHTML = '';
            Array.prototype.forEach.call(select.options, function (opt, index) {
                var item = document.createElement('li');
                item.className = 'fake-select-option';
                item.setAttribute('role', 'option');
                item.dataset.value = opt.value;
                item.textContent = opt.textContent;
                if (index === select.selectedIndex) {
                    item.setAttribute('aria-selected', 'true');
                    item.classList.add('selected');
                }
                item.addEventListener('click', function () {
                    choose(index);
                });
                list.appendChild(item);
            });
            syncButtonLabel();
        }

        function setHighlighted(index) {
            var items = optionEls();
            items.forEach(function (item) {
                item.classList.remove('highlighted');
            });
            if (index >= 0 && index < items.length) {
                items[index].classList.add('highlighted');
                items[index].scrollIntoView({ block: 'nearest' });
            }
            highlightedIndex = index;
        }

        function choose(index) {
            if (select.selectedIndex !== index) {
                select.selectedIndex = index;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            optionEls().forEach(function (item, i) {
                item.classList.toggle('selected', i === index);
                if (i === index) {
                    item.setAttribute('aria-selected', 'true');
                } else {
                    item.removeAttribute('aria-selected');
                }
            });
            syncButtonLabel();
            close();
        }

        function positionList() {
            // LEARNING NOTE: getBoundingClientRect() returns an element's
            // current size and position on screen (left/top/right/bottom/
            // width/height), measured relative to the browser viewport --
            // this is how the fake dropdown list knows exactly where to
            // place itself so it lines up under the button, since the list
            // is positioned independently (see the CSS) rather than
            // sitting in normal document flow right after the button.
            var rect = button.getBoundingClientRect();
            list.style.left = rect.left + 'px';
            list.style.width = rect.width + 'px';
            var spaceBelow = window.innerHeight - rect.bottom;
            // LEARNING NOTE: Math.min/Math.max are a common combo for
            // "clamping" a number between a floor and a ceiling. Reading
            // inside-out: Math.min(300, spaceBelow - 8) never lets the
            // height exceed 300px, and wrapping that in Math.max(120, ...)
            // never lets it drop below 120px either -- so maxHeight always
            // ends up somewhere in the [120, 300] range, adapting to
            // however much real screen space is actually available.
            var maxHeight = Math.max(120, Math.min(300, spaceBelow - 8));
            if (spaceBelow < 120 && rect.top > spaceBelow) {
                // More room above the button than below -- open upward.
                maxHeight = Math.max(120, Math.min(300, rect.top - 8));
                list.style.top = '';
                list.style.bottom = (window.innerHeight - rect.top) + 'px';
            } else {
                list.style.bottom = '';
                list.style.top = rect.bottom + 'px';
            }
            list.style.maxHeight = maxHeight + 'px';
        }

        function open() {
            if (!list.hidden) {
                return;
            }
            rebuildList();
            positionList();
            list.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            setHighlighted(select.selectedIndex);
            document.addEventListener('click', onOutsideClick, true);
            window.addEventListener('resize', positionList);
        }

        function close() {
            if (list.hidden) {
                return;
            }
            list.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onOutsideClick, true);
            window.removeEventListener('resize', positionList);
        }

        function onOutsideClick(ev) {
            if (!list.contains(ev.target) && ev.target !== button) {
                close();
            }
        }

        button.addEventListener('click', function () {
            if (list.hidden) {
                open();
            } else {
                close();
            }
        });

        button.addEventListener('keydown', function (ev) {
            if (ev.key === 'ArrowDown' || ev.key === 'Down') {
                ev.preventDefault();
                if (list.hidden) {
                    open();
                } else {
                    setHighlighted(Math.min(highlightedIndex + 1, optionEls().length - 1));
                }
            } else if (ev.key === 'ArrowUp' || ev.key === 'Up') {
                ev.preventDefault();
                if (list.hidden) {
                    open();
                } else {
                    setHighlighted(Math.max(highlightedIndex - 1, 0));
                }
            } else if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                if (list.hidden) {
                    open();
                } else if (highlightedIndex >= 0) {
                    choose(highlightedIndex);
                }
            } else if (ev.key === 'Escape') {
                close();
            }
        });

        // The topic lists are fetched asynchronously (see hints.js /
        // codemuseum.js), so <option> elements typically don't exist yet
        // when this runs -- rebuild whenever the underlying select's
        // options change instead of assuming a one-time population.
        new MutationObserver(rebuildList).observe(select, { childList: true });

        // choose() below already updates the button/list directly for a
        // click, so this only has real work left to do when something else
        // changed .value+dispatched "change" itself -- rebuildList's own
        // selected-item bookkeeping makes re-running it here harmless
        // either way.
        select.addEventListener('change', function () {
            rebuildList();
        });

        rebuildList();
    }

    function init() {
        enhanceSelect(document.getElementById('hint-topic'));
        enhanceSelect(document.getElementById('code-topic'));
    }

    // LEARNING NOTE: this handles a timing race that comes up whenever a
    // script needs to touch elements from the HTML. `document.readyState`
    // is `'loading'` while the browser is still parsing the HTML document
    // -- if this script tag happened to run before the rest of the page
    // (e.g. it was placed in <head>), `document.getElementById('hint-topic')`
    // above could return null because that element doesn't exist in the
    // DOM yet. `DOMContentLoaded` is an event that fires once the full
    // HTML document has been parsed, so waiting for it guarantees the
    // elements exist. Since this project's script tags are all placed at
    // the end of <body> (after the elements they need), readyState is
    // typically already past 'loading' by the time this runs, and init()
    // just runs immediately -- but checking first makes this file safe
    // to move or load differently without silently breaking.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

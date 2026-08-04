(function () {
    'use strict';

    // Some Android/Fire OS browsers (observed on Kindle Fire Silk) pop the
    // on-screen keyboard when a native <select> with many options is
    // focused, apparently treating it as a searchable/type-ahead combo box.
    // The topic pickers in the hints and code-museum tabs are populated
    // dynamically (see hints.js / codemuseum.js) and never have their value
    // set by anything other than user choice, so it's safe to fully replace
    // their interactive surface with a plain button + listbox that a
    // touchscreen never has reason to treat as text entry, while leaving
    // the original <select> in the DOM (hidden) as the single source of
    // truth those other scripts already read via .value and listen to via
    // "change" -- neither of them needs to change at all.
    function enhanceSelect(select) {
        if (!select || select.dataset.customSelectApplied) {
            return;
        }
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
            var rect = button.getBoundingClientRect();
            list.style.left = rect.left + 'px';
            list.style.width = rect.width + 'px';
            var spaceBelow = window.innerHeight - rect.bottom;
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

        rebuildList();
    }

    function init() {
        enhanceSelect(document.getElementById('hint-topic'));
        enhanceSelect(document.getElementById('code-topic'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

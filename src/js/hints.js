(function () {
    'use strict';

    var TIER_LABELS = ['Nudge', 'Stronger hint', 'Answer'];

    var topics = [];
    var revealedCount = 0;

    var topicSelect = document.getElementById('hint-topic');
    var levelsContainer = document.getElementById('hint-levels');
    var revealButton = document.getElementById('hint-reveal');

    function currentTopic() {
        var id = topicSelect.value;
        for (var i = 0; i < topics.length; i++) {
            if (topics[i].id === id) {
                return topics[i];
            }
        }
        return null;
    }

    function render() {
        levelsContainer.innerHTML = '';
        var topic = currentTopic();
        if (!topic) {
            return;
        }
        for (var i = 0; i < revealedCount && i < topic.hints.length; i++) {
            var div = document.createElement('div');
            div.className = 'hint-level';
            div.setAttribute('role', 'listitem');

            var label = document.createElement('span');
            label.className = 'hint-tier-label';
            label.textContent = TIER_LABELS[i] || ('Hint ' + (i + 1));
            div.appendChild(label);

            var text = document.createElement('span');
            text.textContent = topic.hints[i];
            div.appendChild(text);

            levelsContainer.appendChild(div);
        }

        var topicMax = topic.hints.length;
        revealButton.disabled = revealedCount >= topicMax;
        revealButton.textContent = revealedCount >= topicMax
            ? 'No further hints'
            : 'Reveal next hint (' + (revealedCount + 1) + '/' + topicMax + ')';
    }

    function populateTopics(data) {
        topics = data;
        topicSelect.innerHTML = '';
        topics.forEach(function (topic) {
            var option = document.createElement('option');
            option.value = topic.id;
            option.textContent = topic.title;
            topicSelect.appendChild(option);
        });
        revealedCount = 0;
        render();
    }

    topicSelect.addEventListener('change', function () {
        // Picking a topic -- whether from this dropdown, the "Here" section
        // (see js/tab-indicators.js), or the auto-jump on switching to this
        // tab -- all fire this same event, so revealing the first tier
        // immediately here covers all three the same way: you asked for
        // this topic, so lead with its first hint rather than an empty pane
        // you'd have to click into.
        var topic = currentTopic();
        revealedCount = topic && topic.hints.length ? 1 : 0;
        render();
    });

    revealButton.addEventListener('click', function () {
        var topic = currentTopic();
        if (!topic) {
            return;
        }
        if (revealedCount < topic.hints.length) {
            revealedCount++;
            render();
        }
    });

    fetch('data/hints.json')
        .then(function (response) {
            return response.json();
        })
        .then(populateTopics)
        .catch(function (err) {
            levelsContainer.textContent = 'Could not load hints (' + err.message + ').';
            console.error(err);
        });
})();

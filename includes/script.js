/* script.js — CSSFontFace UAF exploit UI controller */

var jeilbrekBtn  = document.getElementById('jeilbrek');
var UAElement    = document.getElementById('UA');
var UASubElement = document.getElementById('UA-sub');
var netctrlRadio = document.getElementById('netctrl-exploit');
var lapseRadio   = document.getElementById('lapse-exploit');
var kexForm      = document.getElementById('kernel-options');

/* ── User-agent display ── */
(function() {
    var ua = navigator.userAgent;
    UAElement.textContent = ua.length > 70 ? ua.slice(0, 70) + '\u2026' : ua;
    var m = ua.match(/OS ([\d_]+)/);
    if (UASubElement && m) {
        UASubElement.textContent = 'iOS\u00a0' + m[1].replace(/_/g, '.');
    }
})();

/* ── Kernel selection — persisted to localStorage ── */
var exploitChain = localStorage.getItem('exploitChain') || 'lapse';

kexForm.addEventListener('change', function(e) {
    exploitChain = e.target.value;
    localStorage.setItem('exploitChain', exploitChain);
    appendLine('> kernel set: ' + exploitChain, 'console-line-dim');
});

/* ── Execute button ── */
var _running = false;

jeilbrekBtn.addEventListener('click', function() {
    if (_running) return;

    _running = true;
    jeilbrekBtn.disabled = true;
    jeilbrekBtn.classList.add('running');
    jeilbrekBtn.textContent = 'Running\u2026';

    setStatus('running', 'Running');
    clearConsole();
    appendLine('> kernel: ' + exploitChain, 'console-line-dim');
    appendLine('> initiating exploit chain\u2026', 'console-line-dim');

    doJb();
});

/* ── Called by main.js when the exploit finishes ── */
window.exploitFinished = function(success, message) {
    _running = false;
    jeilbrekBtn.disabled = false;
    jeilbrekBtn.classList.remove('running');
    jeilbrekBtn.textContent = 'Execute';

    if (success) {
        setStatus('success', 'Done');
        if (message) appendLine('> ' + message, 'console-line-ok');
    } else {
        setStatus('error', 'Failed');
        if (message) appendLine('> ' + message, 'console-line-err');
    }
};

/* ── Cache progress (applicationCache) ── */
function cacheProgress(e) {
    var pct = Math.round(e.loaded / e.total * 100);
    document.title = 'Caching: ' + pct + '%';
    appendLine('cache: ' + pct + '%', 'console-line-dim');
}

function displayCacheProgress() {
    setTimeout(function() { document.title = '\u2713'; }, 1000);
    setTimeout(function() { document.title = 'CSSFontFace UAF'; }, 3000);
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', function() {
    // Restore kernel selection
    if (exploitChain === 'netctrl') {
        netctrlRadio.checked = true;
    } else {
        lapseRadio.checked = true;
    }

    // applicationCache listeners
    if (window.applicationCache) {
        window.applicationCache.addEventListener('progress', cacheProgress, false);
        window.applicationCache.oncached    = function() { displayCacheProgress(); };
        window.applicationCache.onupdateready = function() { displayCacheProgress(); };
    }
});

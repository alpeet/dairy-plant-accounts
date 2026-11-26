/**
 * Theme switcher — "White" (light) and "Dark" mode.
 *
 * Loaded in <head> so the saved theme is applied before the first paint
 * (no white flash). The choice is per user and stored in localStorage.
 * The top-bar button is declarative: CSS shows the sun or moon icon from
 * the <html data-theme> attribute, this file only sets that attribute.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'prarambha.theme';
    var THEMES = { light: 'White', dark: 'Dark' };
    var root = document.documentElement;

    function stored() {
        try {
            var value = localStorage.getItem(STORAGE_KEY);
            return THEMES[value] ? value : null;
        } catch (err) {
            return null;
        }
    }

    function current() {
        return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function syncButtons(theme) {
        var buttons = document.querySelectorAll('.theme-toggle');
        for (var i = 0; i < buttons.length; i += 1) {
            var next = theme === 'dark' ? 'White' : 'Dark';
            var label = 'Switch to ' + next + ' mode';
            buttons[i].setAttribute('aria-label', label);
            buttons[i].setAttribute('title', label);
            buttons[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        }
    }

    function apply(theme) {
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
        syncButtons(theme);
    }

    function setTheme(theme, persist) {
        var next = THEMES[theme] ? theme : 'light';
        if (persist !== false) {
            try { localStorage.setItem(STORAGE_KEY, next); } catch (err) { /* storage disabled */ }
        }
        apply(next);
        return next;
    }

    function toggleTheme() {
        return setTheme(current() === 'dark' ? 'light' : 'dark');
    }

    window.setTheme = setTheme;
    window.toggleTheme = toggleTheme;

    apply(stored() || 'light');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { syncButtons(current()); });
    } else {
        syncButtons(current());
    }
})();

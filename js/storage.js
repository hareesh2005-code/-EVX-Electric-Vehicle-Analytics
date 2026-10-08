/* =====================================================================
   EVX storage  (js/storage.js)
   A thin wrapper around localStorage. If the browser blocks storage or
   the saved data is corrupted, EVX keeps working with in-memory values.
   To add a backend later, only this file needs to change.
   ===================================================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.EVXStorage = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    "use strict";

    const PREFIX = "evx.v1.";
    const memory = {};
    let persistent = false;

    try {
        const probe = PREFIX + "probe";
        localStorage.setItem(probe, "1");
        localStorage.removeItem(probe);
        persistent = true;
    } catch (e) {
        persistent = false;
    }

    function get(key, fallback) {
        try {
            const raw = persistent ? localStorage.getItem(PREFIX + key) : memory[key];
            if (raw === null || raw === undefined) { return fallback; }
            return JSON.parse(raw);
        } catch (e) {
            return fallback;            // corrupted entry: ignore it
        }
    }

    function set(key, value) {
        const raw = JSON.stringify(value);
        memory[key] = raw;
        if (!persistent) { return false; }
        try {
            localStorage.setItem(PREFIX + key, raw);
            return true;
        } catch (e) {
            return false;
        }
    }

    function remove(key) {
        delete memory[key];
        if (persistent) {
            try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
        }
    }

    return Object.freeze({ get, set, remove, isPersistent: () => persistent });

}));

/* ==========================================================================
   FEAR TAKES SHAPE — persistence.js
   LocalStorage for the in-progress creature (so it is never lost) and
   the viewer's preferences (sound, motion). Nothing else is stored.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;
  const KEYS = { session: 'fts.v2.session', prefs: 'fts.v2.prefs' };

  const Store = {
    get(k, def) {
      try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (_) { return def; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return { ok: true }; }
      catch (e) { return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'quota' : 'unavailable' }; }
    },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  FTS.Persist = {
    saveSession(state) { return Store.set(KEYS.session, state); },
    loadSession() { return Store.get(KEYS.session, null); },
    clearSession() { Store.del(KEYS.session); },
    prefs(p) { if (p) Store.set(KEYS.prefs, Object.assign(Store.get(KEYS.prefs, {}), p)); return Store.get(KEYS.prefs, {}); },
    KEYS,
  };
})();

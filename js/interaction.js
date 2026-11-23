/* ==========================================================================
   FEAR TAKES SHAPE — interaction.js
   Unified mouse / pen / touch handling via Pointer Events.
   Tracks position, smoothed speed, stillness, recent path (for gesture
   detection), presses, pinch and wheel, and forwards events to the stage.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;

  class PointerInput {
    constructor(el) {
      this.el = el;
      this.x = innerWidth / 2; this.y = innerHeight / 2;
      this.present = false;
      this.down = false;
      this.kind = 'mouse';
      this.speed = 0;          // px / s, smoothed
      this.speedN = 0;         // screen-diagonals / s
      this.still = 0;          // seconds without significant motion
      this.history = [];       // {x,y,t}
      this.pointers = new Map();
      this.handlers = {};
      this.mods = { alt: false, shift: false };
      this._acc = 0;
      this._pinchD = 0;
      this.enabled = true;

      const opt = { passive: false };
      el.addEventListener('pointerdown', (e) => this._down(e), opt);
      window.addEventListener('pointermove', (e) => this._move(e), opt);
      window.addEventListener('pointerup', (e) => this._up(e), opt);
      window.addEventListener('pointercancel', (e) => this._up(e), opt);
      el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.present = false; });
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.present = true; });
      el.addEventListener('wheel', (e) => { e.preventDefault(); if (this.enabled) this._emit('wheel', { x: e.clientX, y: e.clientY, delta: e.deltaY * (e.deltaMode === 1 ? 30 : 1) }); }, opt);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', (e) => { this.mods.alt = e.altKey; this.mods.shift = e.shiftKey; });
      window.addEventListener('keyup', (e) => { this.mods.alt = e.altKey; this.mods.shift = e.shiftKey; });
      window.addEventListener('blur', () => { this.pointers.clear(); if (this.down) { this.down = false; this._emit('up', { x: this.x, y: this.y, cancelled: true }); } });
    }
    on(evt, fn) { this.handlers[evt] = fn; }
    off(evt) { delete this.handlers[evt]; }
    clearHandlers() { this.handlers = {}; }
    _emit(evt, d) { const h = this.handlers[evt]; if (h) h(d); }

    _down(e) {
      if (!this.enabled) return;
      e.preventDefault();
      try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.kind = e.pointerType;
      this.mods.alt = e.altKey; this.mods.shift = e.shiftKey;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this._pinchD = Math.hypot(a.x - b.x, a.y - b.y);
        this._pinching = true;
        if (this.down) { this.down = false; this._emit('up', { x: this.x, y: this.y, cancelled: true }); }
        this._emit('pinchstart', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        return;
      }
      if (this.pointers.size > 2) return;
      this.primary = e.pointerId;
      this.x = e.clientX; this.y = e.clientY;
      this.present = true;
      this.down = true;
      this.downAt = performance.now();
      this.still = 0;
      this._emit('down', { x: this.x, y: this.y });
    }
    _move(e) {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinchD > 0 && this.enabled) this._emit('pinch', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ratio: d / this._pinchD });
        this._pinchD = d;
        return;
      }
      if (e.pointerType !== 'mouse' && e.pointerId !== this.primary) return;
      if (e.pointerType === 'mouse') this.present = true;
      this.kind = e.pointerType;
      const dx = e.clientX - this.x, dy = e.clientY - this.y;
      this._acc += Math.hypot(dx, dy);
      this.x = e.clientX; this.y = e.clientY;
      if (this.enabled) this._emit('move', { x: this.x, y: this.y, dx, dy });
    }
    _up(e) {
      this.pointers.delete(e.pointerId);
      if (this._pinching) {
        if (this.pointers.size < 2) { this._pinching = false; this._emit('pinchend', {}); }
        if (e.pointerType !== 'mouse') this.present = this.pointers.size > 0;
        return;
      }
      if (e.pointerId !== this.primary) return;
      if (!this.down) return;
      this.down = false;
      if (e.pointerType !== 'mouse') this.present = false;
      this._emit('up', { x: this.x, y: this.y, held: (performance.now() - this.downAt) / 1000 });
    }

    update(dt, metrics) {
      const inst = this._acc / Math.max(dt, 1e-3);
      this._acc = 0;
      this.speed = this.speed + (inst - this.speed) * (1 - Math.exp(-10 * dt));
      const diag = Math.hypot(innerWidth, innerHeight);
      this.speedN = this.speed / diag;
      if (this.speed < 22) this.still += dt; else this.still = 0;
      const now = performance.now() / 1000;
      if (this.present) this.history.push({ x: this.x, y: this.y, t: now });
      while (this.history.length && now - this.history[0].t > 1.6) this.history.shift();
      if (metrics && this.present && this.enabled) {
        if (this.speed > 4) { metrics.speedSum += this.speedN; metrics.speedSamples++; }
        if (this.speedN > 2.4) { if (!this._fast) { metrics.fastMoves++; this._fast = true; } } else if (this.speedN < 1) this._fast = false;
      }
    }
    clearHistory() { this.history.length = 0; }
  }

  /* Circular-gesture detector: returns {cx, cy, r, sweep, period} or null.
     Works on the recent path transformed by `toLocal`. */
  function detectCircle(history, toLocal) {
    if (history.length < 12) return null;
    const pts = history.map((h) => toLocal(h.x, h.y));
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    let r = 0; for (const p of pts) r += Math.hypot(p.x - cx, p.y - cy);
    r /= pts.length;
    if (r < 0.05 || r > 0.75) return null;
    let sweep = 0, prev = Math.atan2(pts[0].y - cy, pts[0].x - cx), spread = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = Math.atan2(pts[i].y - cy, pts[i].x - cx);
      sweep += FTS.M.angDiff(a, prev);
      prev = a;
      spread += Math.abs(Math.hypot(pts[i].x - cx, pts[i].y - cy) - r);
    }
    spread /= pts.length;
    if (spread > r * 0.55) return null;
    const period = (history[history.length - 1].t - history[0].t) / (Math.abs(sweep) / FTS.TAU);
    return { cx, cy, r, sweep, period };
  }

  FTS.PointerInput = PointerInput;
  FTS.detectCircle = detectCircle;
})();

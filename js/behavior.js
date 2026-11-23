/* ==========================================================================
   FEAR TAKES SHAPE — behavior.js
   Animation and autonomous behaviour. One Behavior instance ("life") is
   created in stage 4 and carried through stages 4–8, so the creature keeps
   its position, rhythm and character. Modes:

     free        stage 4   — roams the screen, retreats / approaches / defends
     calm        stage 5   — settles, turns its attention toward the viewer
     contained   stage 6–7 — lives inside the terrarium; reacts to the glass
     released    stage 8   — out of the enclosure, in the foreground

   Motion character comes from how the creature was made, expressed only as
   physical parameters (tempo, amplitude, tremor, wariness, curiosity).
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;
  const { clamp, damp, angDiff, lerp, gauss } = FTS.M;
  const TAU = FTS.TAU;

  function temperament(m, creature) {
    const avg = m.speedSamples ? m.speedSum / m.speedSamples : 0.3;
    let cov = 0;
    if (creature) { for (const e of creature.exposure) cov += e; cov /= creature.exposure.length; }
    return {
      tempo: clamp(0.62 + avg * 0.75, 0.55, 1.75),
      amplitude: clamp(0.55 + Math.sqrt(m.manipulation || 0) * 0.16 + (m.stretches || 0) * 0.015, 0.5, 1.7),
      tremor: clamp((m.earlyReleases || 0) * 0.14 + (m.fastMoves || 0) * 0.03, 0, 1),
      wariness: clamp(0.4 + (m.fastMoves || 0) * 0.035 + (1 - cov) * 0.4, 0.3, 1),
      curiosity: clamp(0.3 + (m.dwellEvents || 0) * 0.07 + (m.circles || 0) * 0.05, 0.2, 1),
    };
  }

  // per-mode body scale and eye openness
  const SCALE = { defend: 0.82, retreat: 0.92, investigate: 1.04, approach: 1, idle: 1, attend: 1.03, observe: 1.02, follow: 1, startle: 0.93, present: 1, hesitate: 0.95 };
  const OPEN = { defend: 0.3, retreat: 1, investigate: 0.78, approach: 0.92, idle: 0.85, attend: 0.96, observe: 0.95, follow: 0.9, startle: 1, present: 0.9, hesitate: 0.7 };
  const DIL = { defend: 0.55, retreat: 1.35, investigate: 1.2, approach: 1, idle: 0.95, attend: 1.3, observe: 1.25, follow: 1.1, startle: 1.4, present: 1.05, hesitate: 1.15 };

  class Behavior {
    constructor(creature, temp, view) {
      this.c = creature;
      this.temp = temp;
      this.t = 0;
      this.pos = { x: view.cx, y: view.cy };
      this.vel = { x: 0, y: 0 };
      this.rot = 0;
      this.scale = 1;
      this.zoom = 1; this.zoomT = 1;
      this.mode = 'free';
      this.state = 'idle';
      this.stateTime = 0;
      this.phase = 0;
      this.lastBreathSign = 0;
      this.pause = 0;
      this.nextEvent = 3 + Math.random() * 4;
      this.stretch = null;
      this.anim = new Map();
      this.eyes = new Map();
      this.events = null;
      this.reduced = false;
      this.intro = 0;
      // containment / focus
      this.box = null; this.boxSoft = false; this.lastBox = null;
      this.attend = 0; this.attendT = 0; this.attendPoint = null;
      this.home = null; this.hold = false;
      this.tapT = 0; this.tapPt = null;
      this.depth = 0; this.depthT = 0; this.approach = 1; this.front = null; this.zBack = 1; this.zFront = 1;
      this.weights = new Float32Array(FTS.Creature.N);
      for (let i = 0; i < this.weights.length; i++) {
        const th = (i / this.weights.length) * TAU;
        this.weights[i] = 0.55 + 0.9 * (creature.noise.noise(Math.cos(th) * 1.3 + 20, Math.sin(th) * 1.3, 0.5) + 0.5);
      }
      const self = this;
      this.anim.bristle = (f, k) => Math.sin(self.t * 2.6 * self.temp.tempo + k * 1.7 + f.seed) * 0.16 * self.temp.amplitude * (self.reduced ? 0.4 : 1);
      this.lookLocal = { x: 0, y: 0 };
      this.refresh();
    }
    refresh() {
      const bb = this.c.bounds();
      this.ext = { x: Math.max(1, Math.max(-bb.x0, bb.x1) * 0.8), y: Math.max(1, Math.max(-bb.y0, bb.y1) * 0.8) };
      this.rext = this.c.maxExtent();
    }
    emit(e) { if (this.events) this.events(e); }
    setState(s) {
      if (this.state === s) return;
      this.state = s; this.stateTime = 0;
      this.emit(s);
    }
    setMode(m) { this.mode = m; this.stateTime = 0; if (m !== 'free') this.intro = 1; }
    tap(x, y) { this.tapT = 3; this.tapPt = { x, y }; this.setState('startle'); }

    /* ---------------- per-mode decisions → desired velocity ---------------- */
    decide(ptr, view, S, maxS) {
      const T = this.temp, has = ptr.present, nz = this.c.noise;
      const dx = ptr.x - this.pos.x, dy = ptr.y - this.pos.y;
      const dist = Math.hypot(dx, dy) / S;
      const ux = dist > 0.001 ? dx / (dist * S) : 0, uy = dist > 0.001 ? dy / (dist * S) : 0;
      const wander = () => [nz.noise(this.t * 0.15, 3.3, 0) * maxS * 0.5, nz.noise(this.t * 0.15, 7.7, 1) * maxS * 0.5];
      let tx = 0, ty = 0;
      this.focus = has ? { x: ptr.x, y: ptr.y } : null;
      if (this.forced) { this.setState(this.forced); return [0, 0]; }

      if (this.mode === 'free') {
        const near = 1.7 + T.wariness * 0.9;
        if (this.intro >= 1) {
          if (has && ptr.speedN > 1.7 / T.wariness && dist < 7) this.setState('defend');
          else if (this.state === 'defend' && this.stateTime < 1.1 + T.tremor * 0.6) { /* hold */ }
          else if (has && dist < near) this.setState('retreat');
          else if (this.state === 'retreat' && this.stateTime < 0.8 && dist < near + 0.6) { /* hold */ }
          else if (has && ptr.still > 1.5 - T.curiosity * 0.6) this.setState('investigate');
          else if (has && dist > 4.2) this.setState('approach');
          else if (this.state !== 'investigate' || !has || ptr.still < 0.2) this.setState('idle');
        }
        switch (this.state) {
          case 'defend': tx = -ux * maxS * 0.9; ty = -uy * maxS * 0.9; break;
          case 'retreat': tx = -ux * maxS * (0.55 + T.wariness * 0.5); ty = -uy * maxS * (0.55 + T.wariness * 0.5); break;
          case 'investigate': {
            const k = clamp((dist - (2.3 - T.curiosity * 0.5)) * 0.6, -1, 1);
            const hes = 0.5 + 0.5 * Math.sin(this.t * 1.7 * T.tempo);
            tx = ux * maxS * 0.32 * k * hes; ty = uy * maxS * 0.32 * k * hes; break;
          }
          case 'approach': tx = ux * maxS * 0.45; ty = uy * maxS * 0.45; break;
          default: [tx, ty] = wander(); tx += (view.cx - this.pos.x) * 0.15; ty += (view.cy - this.pos.y) * 0.15;
        }
        tx *= this.intro; ty *= this.intro;
        // soft screen walls sized to the creature's own body
        const mx = Math.min(S * this.ext.x + 20, view.W * 0.5), my = Math.min(S * this.ext.y + 20, view.H * 0.5);
        if (this.pos.x < mx) tx += (mx - this.pos.x) * 4;
        if (this.pos.x > view.W - mx) tx -= (this.pos.x - (view.W - mx)) * 4;
        if (this.pos.y < my + 30) ty += (my + 30 - this.pos.y) * 4;
        if (this.pos.y > view.H - my) ty -= (this.pos.y - (view.H - my)) * 4;
      } else if (this.mode === 'calm') {
        this.setState(this.attend > 0.35 ? 'attend' : 'idle');
        const h = this.home || { x: view.cx, y: view.cy };
        const [wx, wy] = wander();
        tx = (h.x - this.pos.x) * 1.4 + wx * 0.18; ty = (h.y - this.pos.y) * 1.4 + wy * 0.18;
        if (this.attendPoint) {
          const fx = has ? lerp(ptr.x, this.attendPoint.x, this.attend) : this.attendPoint.x;
          const fy = has ? lerp(ptr.y, this.attendPoint.y, this.attend) : this.attendPoint.y;
          this.focus = { x: fx, y: fy };
        }
      } else if (this.mode === 'contained') {
        const b = this.box;
        const nearGlass = has && b && ptr.x > b.x0 - 120 && ptr.x < b.x1 + 120 && ptr.y > b.y0 - 120 && ptr.y < b.y1 + 120;
        if (this.tapT > 0) {
          this.tapT -= this._dt;
          if (this.tapT > 2.3) this.setState('startle'); else this.setState('investigate');
        } else if (has && ptr.speedN > 2.2 / T.wariness && nearGlass) this.setState('startle');
        else if (this.state === 'startle' && this.stateTime < 0.7) { /* hold */ }
        else if (nearGlass && ptr.still > 1.4 - T.curiosity * 0.5) this.setState('observe');
        else if (nearGlass) this.setState('follow');
        else this.setState('idle');
        const tp = this.tapPt;
        switch (this.state) {
          case 'startle': {
            const ax = tp ? this.pos.x - tp.x : -dx, ay = tp ? this.pos.y - tp.y : -dy, m = Math.hypot(ax, ay) || 1;
            tx = (ax / m) * maxS * 0.45; ty = (ay / m) * maxS * 0.3;
            if (tp) this.focus = tp;
            break;
          }
          case 'investigate': {
            this.focus = tp;
            const ax = tp.x - this.pos.x, ay = tp.y - this.pos.y, m = Math.hypot(ax, ay) || 1;
            const k = clamp((m / S - 1.2) * 0.8, 0, 1);
            tx = (ax / m) * maxS * 0.35 * k; ty = (ay / m) * maxS * 0.35 * k; break;
          }
          case 'follow': {
            const k = clamp((Math.abs(dx) / S - 0.4) * 0.8, 0, 1);
            tx = Math.sign(dx) * maxS * 0.85 * k; ty = clamp(dy / S, -1, 1) * maxS * 0.2; break;
          }
          case 'observe': tx = ux * maxS * 0.05; ty = uy * maxS * 0.05; break;
          default: {
            const [wx, wy] = wander(); tx = wx * 0.7; ty = wy * 0.5;
            if (b) { tx += ((b.x0 + b.x1) / 2 - this.pos.x) * 0.08; ty += ((b.y0 + b.y1) / 2 - this.pos.y) * 0.12; }
          }
        }
      } else if (this.mode === 'released') {
        const sR = this.rext * S * this.scale;            // creature's screen reach
        const close = has && dist * S < sR * 1.05;
        if (has && ptr.speedN > 2.2 / T.wariness && dist * S < sR * 2.2) this.setState('startle');
        else if (this.state === 'startle' && this.stateTime < 1.0) { /* hold */ }
        else if (close) this.setState('retreat');
        else if (this.state === 'retreat' && this.stateTime < 0.9) { /* hold */ }
        else if (has && ptr.still > 1.4) this.setState('observe');
        else this.setState('present');
        const dT = { startle: 0.35, retreat: 0.5, observe: 1, present: 0.8 }[this.state];
        this.depthT = Math.min(dT, this.approach);
        const f = this.front || { x: view.cx, y: view.cy };
        const ax = has ? f.x + clamp(ptr.x - f.x, -view.W * 0.25, view.W * 0.25) * 0.3 : f.x;
        let ay = f.y;
        let px = ax, py = ay;
        if (this.state === 'retreat' || this.state === 'startle') { px = this.pos.x - ux * sR * 0.6; py = this.pos.y - uy * sR * 0.3; }
        tx = (px - this.pos.x) * 1.1; ty = (py - this.pos.y) * 1.1;
        const sp = Math.hypot(tx, ty), lim = maxS * (this.state === 'startle' ? 0.9 : 0.45);
        if (sp > lim) { tx *= lim / sp; ty *= lim / sp; }
      }
      if (this.hold) { tx = 0; ty = 0; }
      return [tx, ty];
    }

    update(dt, ptr, view) {
      dt = Math.min(dt, 1 / 30);
      this._dt = dt;
      const T = this.temp, red = this.reduced ? 0.45 : 1;
      this.t += dt; this.stateTime += dt;
      if (this.mode === 'released') {
        this.depth = damp(this.depth, this.depthT, this.state === 'startle' ? 3 : 0.7, dt);
        this.zoomT = lerp(this.zBack, this.zFront, this.depth);
      }
      this.zoom = damp(this.zoom, this.zoomT, this.mode === 'released' ? 3 : 1.6, dt);
      this.attend = damp(this.attend, this.attendT, 2, dt);
      const S = view.S * this.zoom;
      const maxS = S * 1.25 * T.tempo * (this.reduced ? 0.6 : 1);

      /* ---- spontaneous variations ---- */
      this.nextEvent -= dt;
      if (this.nextEvent <= 0 && this.intro >= 1) {
        const r = Math.random();
        if (r < 0.3) this.pause = 0.6 + Math.random() * 1.4;
        else if (r < 0.65) { this.stretch = { a: Math.random() * TAU, amp: 0.12 + Math.random() * 0.14, t: 0, dur: 1.6 + Math.random() }; this.emit('stretch'); }
        else if (r < 0.85) { this.emit('click'); this.twitch = 0.35; }
        else for (const e of this.eyes.values()) e.blinkAt = this.t + Math.random() * 0.15;
        this.nextEvent = (3 + Math.random() * 6) / T.tempo;
      }
      if (this.pause > 0) this.pause -= dt;
      if (this.twitch > 0) this.twitch -= dt;

      /* ---- locomotion ---- */
      let [tx, ty] = this.decide(ptr, view, S, maxS);
      if (this.pause > 0 && !['defend', 'startle', 'retreat'].includes(this.state)) { tx *= 0.05; ty *= 0.05; }
      const quick = this.state === 'defend' || this.state === 'startle';
      const resp = (quick ? 6 : 2.2) * T.tempo;
      this.vel.x = damp(this.vel.x, tx, resp, dt);
      this.vel.y = damp(this.vel.y, ty, resp, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      const vN = Math.hypot(this.vel.x, this.vel.y) / Math.max(maxS, 1);

      /* ---- body ---- */
      let scaleT = SCALE[this.state] || 1;
      if (this.mode === 'calm') scaleT += this.attend * 0.03;
      if (this.mode !== 'free' && this.state === 'defend') scaleT = 0.9;
      this.scale = damp(this.scale, scaleT, quick ? 9 : 3, dt);
      const breathRate = 0.2 * T.tempo * (this.state === 'defend' ? 2.2 : (this.state === 'retreat' || this.state === 'startle') ? 1.5 : this.mode === 'calm' ? 0.85 : 1);
      this.phase += dt * breathRate * TAU;
      const sgn = Math.sin(this.phase) >= 0 ? 1 : -1;
      if (sgn > 0 && this.lastBreathSign < 0) this.emit('breath');
      this.lastBreathSign = sgn;

      const sc = S * this.scale;
      const lx0 = (ptr.x - this.pos.x) / sc, ly0 = (ptr.y - this.pos.y) / sc;
      let rotT = clamp(this.vel.x / Math.max(maxS, 1) * 0.22, -0.3, 0.3) + Math.sin(this.t * 0.31) * 0.05 * red;
      // body orientation turns subtly toward whatever holds its attention
      let lean = clamp(vN, 0, 1) * 0.09 * red, leanA = Math.atan2(this.vel.y, this.vel.x);
      if (this.focus && this.mode !== 'free') {
        const fx = this.focus.x - this.pos.x, fy = this.focus.y - this.pos.y;
        const fa = Math.atan2(fy, fx);
        const k = this.state === 'observe' || this.state === 'attend' ? 0.07 : 0.04;
        lean = Math.max(lean, k * red); leanA = fa;
        rotT += clamp(fx / (view.W * 0.5), -1, 1) * 0.1 * red;
      }
      this.rot = damp(this.rot, rotT * this.intro, 2.5, dt);
      leanA -= this.rot;

      if (this.stretch) { this.stretch.t += dt; if (this.stretch.t > this.stretch.dur) this.stretch = null; }
      const breathAmp = (0.03 + 0.02 * T.amplitude) * red;
      const st = this.stretch, w = this.weights, ph = this.phase, tt = this.t;
      const shiver = (this.state === 'defend' ? 0.035 : this.state === 'startle' ? 0.012 : 0.006 * T.tremor) * red + (this.twitch > 0 ? 0.03 * red : 0);
      this.radiusMod = (i, th, v) => {
        let out = v * (1 + breathAmp * Math.sin(ph + w[i] * 0.8) * w[i]);
        out += lean * Math.cos(th - leanA);
        if (st) out += st.amp * Math.sin((st.t / st.dur) * Math.PI) * gauss(angDiff(th, st.a), 0.45) * red;
        if (shiver) out += Math.sin(tt * 47 + i * 1.3) * shiver;
        return out;
      };

      /* ---- local focus ---- */
      const cr = Math.cos(-this.rot), sr = Math.sin(-this.rot);
      const fpx = this.focus ? this.focus.x : ptr.x, fpy = this.focus ? this.focus.y : ptr.y;
      const fx0 = (fpx - this.pos.x) / sc, fy0 = (fpy - this.pos.y) / sc;
      const lfx = fx0 * cr - fy0 * sr, lfy = fx0 * sr + fy0 * cr;
      this.lookLocal = { x: lfx, y: lfy };
      const hasFocus = !!this.focus;

      /* ---- limbs ---- */
      const reaching = ['investigate', 'observe', 'attend'].includes(this.state) && hasFocus;
      let nearest = null, nd = Infinity;
      if (reaching) {
        for (const f of this.c.features) {
          if (f.type !== 'tendril') continue;
          const p = this.c.rimPoint(f.angle);
          const d = Math.hypot(p.x - lfx, p.y - lfy);
          if (d < nd) { nd = d; nearest = f; }
        }
      }
      const nz = this.c.noise;
      for (const f of this.c.features) {
        if (f.type !== 'tendril') continue;
        let a = this.anim.get(f.id);
        if (!a) { a = { bend: 0, curl: 0, len: 1, ph: Math.random() * TAU, fq: 0.6 + Math.random() * 0.8 }; this.anim.set(f.id, a); }
        let bT = (Math.sin(tt * a.fq * T.tempo + a.ph) * 0.3 + nz.noise(tt * 0.4 * T.tempo, a.ph, 2) * 0.35) * T.amplitude * red;
        let cT = 0, lT = 1 + Math.sin(tt * a.fq * 0.7 + a.ph) * 0.05 * red;
        if (this.state === 'defend') { cT = 2.4 * Math.sign(f.curl || 1); lT = 0.72; bT *= 0.3; }
        else if (this.state === 'retreat' || this.state === 'startle') { cT = 0.8 * Math.sign(f.curl || 1); lT = 0.9; }
        else if (this.state === 'hesitate') { cT = 0.5 * Math.sign(f.curl || 1); lT = 0.92; bT *= 0.4; }
        if (f === nearest) {
          const base = this.c.rimPoint(f.angle);
          const want = Math.atan2(lfy - base.y, lfx - base.x);
          bT = clamp(angDiff(want, this.c.normalAngle(f.angle) + f.bend), -1.3, 1.3);
          cT = -f.curl * 0.8; lT = this.mode === 'calm' ? 1.12 : 1.2;
        }
        const k = this.state === 'defend' ? 10 : 3.5;
        a.bend = damp(a.bend, bT * this.intro, k, dt);
        a.curl = damp(a.curl, cT * this.intro, k, dt);
        a.len = damp(a.len, lerp(1, lT, this.intro), k, dt);
      }

      /* ---- eyes ---- */
      const openT = OPEN[this.state] || 0.85;
      for (const f of this.c.features) {
        if (f.type !== 'eye') continue;
        let e = this.eyes.get(f.id);
        if (!e) { e = { open: 0.8, blinkAt: tt + 1 + Math.random() * 4, blink: 0, lx: 0, ly: 0, lag: 3 + Math.random() * 9, wander: 0, wx: 0, wy: 0 }; this.eyes.set(f.id, e); }
        if (tt > e.blinkAt) { e.blink = 0.17; e.blinkAt = tt + 2 + Math.random() * 6; }
        if (e.blink > 0) e.blink -= dt;
        const blinkF = e.blink > 0 ? Math.abs(e.blink / 0.17 * 2 - 1) : 1;
        e.open = damp(e.open, openT * (0.92 + nz.noise(tt * 0.3, f.seed % 50, 4) * 0.2), 5, dt);
        e.shown = e.open * blinkF;
        const focused = this.state === 'observe' || this.state === 'attend';
        if (!focused && e.wander <= 0 && Math.random() < dt * 0.08) { e.wander = 0.5 + Math.random() * 0.9; e.wx = Math.random() * 2 - 1; e.wy = Math.random() * 2 - 1; }
        if (e.wander > 0) e.wander -= dt;
        const p = this.c.featurePos(f);
        let vx = lfx - p.x, vy = lfy - p.y;
        const m2 = Math.hypot(vx, vy);
        const mag = ptr.present || this.focus ? Math.min(1, m2 / 1.5) : 0.2;
        vx = m2 > 0 ? (vx / m2) * mag : 0; vy = m2 > 0 ? (vy / m2) * mag : 0;
        if (this.mode === 'calm') { vx *= 1 - this.attend * 0.35; vy *= 1 - this.attend * 0.35; }  // toward the viewer
        if (e.wander > 0 && !focused) { vx = e.wx; vy = e.wy; }
        const rr = -(f.tilt + f.angle * 0.15);
        const rx = vx * Math.cos(rr) - vy * Math.sin(rr), ry = vx * Math.sin(rr) + vy * Math.cos(rr);
        e.lx = damp(e.lx, rx, focused ? e.lag * 1.5 : e.lag, dt); e.ly = damp(e.ly, ry, focused ? e.lag * 1.5 : e.lag, dt);
      }
      this.dil = damp(this.dil || 1, (DIL[this.state] || 1) + this.attend * 0.15, 4, dt);

      this.contain(view, dt);
    }

    /* Physical boundary: the full pose (body + every appendage) is kept
       inside this.box. Hard when the enclosure is complete. */
    contain(view, dt) {
      const k = view.S * this.zoom * this.scale;
      this.c.computeRadii(this.radiusMod);
      const e = this.c.poseExtent(this.anim, this.rot, k, this.t);
      this.extentPx = e;
      const b = this.box;
      if (!b) { this.lastBox = { x0: this.pos.x + e.x0, y0: this.pos.y + e.y0, x1: this.pos.x + e.x1, y1: this.pos.y + e.y1 }; return; }
      const pad = 3;
      let sx = 0, sy = 0;
      if (e.x1 - e.x0 > b.x1 - b.x0 - 2 * pad) sx = (b.x0 + b.x1) / 2 - (this.pos.x + (e.x0 + e.x1) / 2);
      else if (this.pos.x + e.x0 < b.x0 + pad) sx = b.x0 + pad - (this.pos.x + e.x0);
      else if (this.pos.x + e.x1 > b.x1 - pad) sx = b.x1 - pad - (this.pos.x + e.x1);
      if (e.y1 - e.y0 > b.y1 - b.y0 - 2 * pad) sy = (b.y0 + b.y1) / 2 - (this.pos.y + (e.y0 + e.y1) / 2);
      else if (this.pos.y + e.y0 < b.y0 + pad) sy = b.y0 + pad - (this.pos.y + e.y0);
      else if (this.pos.y + e.y1 > b.y1 - pad) sy = b.y1 - pad - (this.pos.y + e.y1);
      const kk = this.boxSoft ? Math.min(1, dt * 4) : 1;
      this.pos.x += sx * kk; this.pos.y += sy * kk;
      if (sx * this.vel.x < 0) this.vel.x *= 0.2;
      if (sy * this.vel.y < 0) this.vel.y *= 0.2;
      this.touching = Math.abs(sx) + Math.abs(sy) > 0.5;
      this.lastBox = { x0: this.pos.x + e.x0, y0: this.pos.y + e.y0, x1: this.pos.x + e.x1, y1: this.pos.y + e.y1 };
    }

    drawOpts(view) {
      const self = this;
      return {
        x: this.pos.x, y: this.pos.y, S: view.S * this.zoom, scale: this.scale, rot: this.rot, t: this.t,
        anim: this.anim, radiusMod: this.radiusMod,
        eyeOpen: (f) => { const e = self.eyes.get(f.id); return e ? e.shown : 0.8; },
        look: (f) => { const e = self.eyes.get(f.id); return e ? { x: e.lx, y: e.ly } : { x: 0, y: 0 }; },
        dilation: () => self.dil || 1,
      };
    }
  }

  FTS.temperament = temperament;
  FTS.Behavior = Behavior;
})();

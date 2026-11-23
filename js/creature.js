/* ==========================================================================
   FEAR TAKES SHAPE — creature.js
   The persistent creature data model and its geometry.
   One instance travels through all five stages; every stage edits it.

   Local space: the body is centred at (0,0); 1 unit ≈ mean body radius.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;
  const { lerp, clamp, damp, wrapAngle, angDiff, dampAngle, gauss } = FTS.M;
  const TAU = FTS.TAU;

  const N = 128;      // outline resolution
  const SECT = 32;    // exploration sectors around the perimeter
  const LIMITS = { eye: 9, tendril: 14, texture: 8, nodule: 16 };

  class Creature {
    constructor(seed) {
      this.seed = seed != null ? seed >>> 0 : Math.floor(Math.random() * 4294967295) >>> 0;
      this.noise = new FTS.Noise3(this.seed);
      this.rng = FTS.mulberry32(this.seed ^ 0x9e3779b9);
      this.createdAt = Date.now();
      this.base = new Float32Array(N).fill(1);
      this.deform = new Float32Array(N);
      this.deformV = new Float32Array(N);
      this.deformT = new Float32Array(N);
      this.exposure = new Float32Array(SECT);
      this.visits = new Uint16Array(SECT);
      this.features = [];
      this.captured = false;
      this.name = '';
      this.snapshots = {};
      this.metrics = {
        holdAttempts: 0, earlyReleases: 0, perceptionTime: 0,
        speedSum: 0, speedSamples: 0, fastMoves: 0,
        discoveryTime: 0, dwellEvents: 0, drags: 0, circles: 0, revisits: 0,
        manipulation: 0, stretches: 0, duplications: 0, swells: 0,
        presenceTime: 0, defends: 0, retreats: 0, investigations: 0, breaths: 0,
      };
      this._r = new Float32Array(N);
      this.computeRadii();
    }

    /* ---------- outline ---------- */
    computeRadii(mod) {
      const r = this._r, feats = this.features;
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU;
        let v = this.base[i] + this.deform[i];
        for (let k = 0; k < feats.length; k++) {
          const f = feats[k];
          if (f.type === 'nodule' && f.kind === 'bump') {
            v += f.size * f.scale * f.grow * gauss(angDiff(th, f.angle), f.width);
          }
        }
        if (mod) v = mod(i, th, v);
        r[i] = v < 0.22 ? 0.22 : v;
      }
      return r;
    }
    radiusAt(th) {
      const x = (wrapAngle(th) / TAU) * N;
      const i0 = Math.floor(x) % N, i1 = (i0 + 1) % N;
      return lerp(this._r[i0], this._r[i1], x - Math.floor(x));
    }
    rimPoint(th, k = 1) {
      const r = this.radiusAt(th) * k;
      return { x: Math.cos(th) * r, y: Math.sin(th) * r };
    }
    normalAngle(th) {
      const d = 0.06;
      const a = this.rimPoint(th - d), b = this.rimPoint(th + d);
      const tx = b.x - a.x, ty = b.y - a.y;
      let nx = ty, ny = -tx;
      if (nx * Math.cos(th) + ny * Math.sin(th) < 0) { nx = -nx; ny = -ny; }
      return Math.atan2(ny, nx);
    }
    featurePos(f) {
      const r = this.radiusAt(f.angle) * f.depth;
      return { x: Math.cos(f.angle) * r, y: Math.sin(f.angle) * r };
    }

    /* ---------- limbs ---------- */
    tendrilSpine(f, anim, t = 0) {
      const bend = f.bend + (anim ? anim.bend : 0);
      const curl = f.curl + (anim ? anim.curl : 0);
      const lenMul = anim && anim.len ? anim.len : 1;
      const L = Math.max(0.04, f.length * f.scale * (0.15 + 0.85 * f.grow) * lenMul);
      const n = 18, step = L / n;
      const inset = 0.86;
      const r0 = this.radiusAt(f.angle) * inset;
      let x = Math.cos(f.angle) * r0, y = Math.sin(f.angle) * r0;
      let dir = this.normalAngle(f.angle) + bend;
      const w0 = f.width * Math.sqrt(f.scale) * (0.55 + 0.45 * f.grow);
      const pts = [];
      const nz = this.noise;
      const hookBoost = f.tip === 'hook' ? 2.4 : 0;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        let w = w0 * Math.pow(1 - u, 0.85) + w0 * 0.04;
        if (k < 3) w *= 1 + (3 - k) * 0.32;                 // organic fillet into the body
        if (f.tip === 'bulb' && u > 0.78) w += w0 * 0.55 * Math.sin(((u - 0.78) / 0.22) * Math.PI);
        pts.push({ x, y, w, dir });
        const wig = nz.noise(u * 2.2 + (f.seed % 97), t * 0.35, f.seed % 13) * f.wave;
        dir += (curl * (0.35 + u) + wig * 1.6 + (u > 0.7 ? hookBoost * (u - 0.7) * 3 : 0)) * step;
        x += Math.cos(dir) * step;
        y += Math.sin(dir) * step;
      }
      return pts;
    }

    /* ---------- feature lifecycle ---------- */
    count(type) { let c = 0; for (const f of this.features) if (f.type === type) c++; return c; }
    canAdd(type) { return this.count(type) < LIMITS[type]; }
    add(f) { this.features.push(f); return f; }
    nearest(type, x, y, maxD) {
      let best = null, bd = maxD;
      for (const f of this.features) {
        if (f.type !== type) continue;
        const p = this.featurePos(f);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    }

    update(dt, opts = {}) {
      dt = Math.min(dt, 1 / 30);
      // soft-body springs on the outline
      const k = opts.stiff || 70, c = opts.dampC || 9;
      for (let i = 0; i < N; i++) {
        const a = (this.deformT[i] - this.deform[i]) * k - this.deformV[i] * c;
        this.deformV[i] += a * dt;
        this.deform[i] += this.deformV[i] * dt;
      }
      for (const f of this.features) {
        f.grow = damp(f.grow, 1, 1.6, dt);
        f.scale = damp(f.scale, f.scaleT, 7, dt);
        f.angle = wrapAngle(dampAngle(f.angle, f.angleT, 8, dt));
        f.depth = damp(f.depth, f.depthT, 8, dt);
        if (f.type === 'tendril') {
          f.length = damp(f.length, f.lengthT, 5, dt);
          f.bend = damp(f.bend, f.bendT, 6, dt);
        }
      }
      this.computeRadii();
    }

    /* smooth neighbouring deformation targets to keep tissue continuous */
    relaxTargets(strength = 0.25) {
      const t = this.deformT, tmp = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        tmp[i] = (t[(i + N - 1) % N] + t[i] * 2 + t[(i + 1) % N]) / 4;
      }
      for (let i = 0; i < N; i++) t[i] = lerp(t[i], tmp[i], strength);
    }
    clampTargets() {
      for (let i = 0; i < N; i++) {
        let total = this.base[i] + this.deformT[i];
        // soft limits: tissue resists as it approaches its extremes
        if (total > 1.7) total = 1.7 + 0.85 * Math.tanh((total - 1.7) / 0.85);
        if (total < 0.45) total = 0.45 - 0.13 * Math.tanh((0.45 - total) / 0.13);
        this.deformT[i] = total - this.base[i];
      }
    }

    /* ---------- hit testing (local coords) ---------- */
    hitFeature(x, y) {
      let best = null, bd = Infinity;
      for (const f of this.features) {
        if (f.type === 'tendril') {
          const sp = this.tendrilSpine(f);
          for (let k = 2; k < sp.length; k++) {
            const d = Math.hypot(sp[k].x - x, sp[k].y - y) - Math.max(sp[k].w, 0.07);
            const score = d - (k > sp.length - 5 ? 0.04 : 0);
            if (d < 0.05 && score < bd) {
              bd = score;
              best = { f, part: k < 4 ? 'base' : k > sp.length - 6 ? 'tip' : 'mid', index: k };
            }
          }
        } else {
          const p = this.featurePos(f);
          const rad = f.type === 'eye' ? f.size * f.scale * 1.3
            : f.type === 'texture' ? f.radius * f.scale * 0.8
            : 0.12 * f.scale;
          const d = Math.hypot(p.x - x, p.y - y) - rad;
          if (d < 0.02 && d - 0.05 < bd) { bd = d - 0.05; best = { f, part: 'body', index: 0 }; }
        }
      }
      return best;
    }
    contains(x, y, k = 1) {
      return Math.hypot(x, y) < this.radiusAt(Math.atan2(y, x)) * k;
    }

    /* ---------- analysis for documentation ---------- */
    bounds(anim) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const acc = (x, y, pad = 0) => {
        if (x - pad < x0) x0 = x - pad; if (y - pad < y0) y0 = y - pad;
        if (x + pad > x1) x1 = x + pad; if (y + pad > y1) y1 = y + pad;
      };
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU;
        acc(Math.cos(th) * this._r[i], Math.sin(th) * this._r[i], 0.05);
      }
      for (const f of this.features) {
        if (f.type === 'tendril') for (const p of this.tendrilSpine(f, anim && anim.get ? anim.get(f.id) : null)) acc(p.x, p.y, p.w);
        if (f.type === 'nodule' && f.kind === 'bristle') {
          const p = this.rimPoint(f.angle); acc(p.x * 1.3, p.y * 1.3);
        }
      }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }

    /* Rotation-independent reach of the whole organism, in local units:
       the furthest any point can get from the centre across every pose the
       behaviour system can produce (bends, curls, reaching, breathing,
       stretch events). Each appendage is sampled over those poses. */
    maxExtent() {
      this.computeRadii();
      let maxR = 0;
      for (let i = 0; i < N; i++) if (this._r[i] > maxR) maxR = this._r[i];
      const bodyMargin = 0.36;                          // breathing + lean + stretch events
      let m = maxR * 1.07 + bodyMargin;
      const bends = [-1.4, -0.7, 0, 0.7, 1.4], ts = [0, 7.3, 19.1];
      for (const f of this.features) {
        if (f.type === 'tendril') {
          const curls = [-2.4, -0.8, 0, 0.8, 2.4, -f.curl * 0.8];
          const saved = { length: f.length, scale: f.scale, grow: f.grow, bend: f.bend, angle: f.angle };
          f.length = Math.max(f.length, f.lengthT); f.scale = Math.max(f.scale, f.scaleT); f.grow = 1; f.angle = f.angleT; f.bend = f.bendT;
          for (const bd of bends) for (const cu of curls) for (const t of ts) {
            for (const p of this.tendrilSpine(f, { bend: bd, curl: cu, len: 1.25 }, t)) {
              const d = Math.hypot(p.x, p.y) + p.w + 0.2;
              if (d > m) m = d;
            }
          }
          Object.assign(f, saved);
        } else if (f.type === 'nodule' && f.kind === 'bristle') {
          m = Math.max(m, this.radiusAt(f.angle) * 1.07 + bodyMargin + f.size * Math.max(f.scale, f.scaleT) * 1.2);
        }
      }
      this.computeRadii();
      return m;
    }

    /* Exact extent of the current pose (after rotation and scale k),
       relative to the creature centre, in px. Includes every appendage. */
    poseExtent(anim, rot, k, t = 0) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const acc = (x, y, pad) => {
        const X = (x * cr - y * sr) * k, Y = (x * sr + y * cr) * k, P = pad * k;
        if (X - P < x0) x0 = X - P; if (X + P > x1) x1 = X + P;
        if (Y - P < y0) y0 = Y - P; if (Y + P > y1) y1 = Y + P;
      };
      for (let i = 0; i < N; i += 2) {
        const th = (i / N) * TAU;
        acc(Math.cos(th) * this._r[i], Math.sin(th) * this._r[i], 0.02);
      }
      for (const f of this.features) {
        if (f.type === 'tendril') {
          for (const p of this.tendrilSpine(f, anim ? anim.get(f.id) : null, t)) acc(p.x, p.y, p.w + 0.01);
        } else if (f.type === 'nodule' && f.kind === 'bristle') {
          for (const da of [-f.width * 1.1, 0, f.width * 1.1]) {
            const a = f.angle + da, r = this.radiusAt(a) + f.size * f.scale * f.grow * 1.15;
            acc(Math.cos(a) * r, Math.sin(a) * r, 0.02);
          }
        }
      }
      return { x0, y0, x1, y1 };
    }

    /* ---------- persistence ---------- */
    toJSON() {
      const round = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
      const feats = this.features.map((f) => {
        const o = {};
        for (const k in f) o[k] = typeof f[k] === 'number' ? Math.round(f[k] * 1000) / 1000 : f[k];
        o.grow = 1; o.scale = o.scaleT; o.angle = o.angleT; o.depth = o.depthT;
        if (o.type === 'tendril') { o.length = o.lengthT; o.bend = o.bendT; }
        return o;
      });
      return {
        v: 2, seed: this.seed, createdAt: this.createdAt, captured: this.captured,
        name: this.name, base: round(this.base), deformT: round(this.deformT),
        exposure: round(this.exposure), visits: Array.from(this.visits),
        features: feats, metrics: this.metrics, snapshots: this.snapshots,
      };
    }
    static fromJSON(o) {
      const c = new Creature(o.seed);
      c.createdAt = o.createdAt; c.captured = !!o.captured; c.name = o.name || '';
      c.base.set(o.base); c.deformT.set(o.deformT); c.deform.set(o.deformT);
      c.exposure.set(o.exposure); c.visits.set(o.visits || []);
      c.features = o.features || [];
      Object.assign(c.metrics, o.metrics || {});
      c.snapshots = o.snapshots || {};
      for (let i = 0; i < c.features.length; i++) c.rng();
      c.computeRadii();
      return c;
    }
  }

  Creature.N = N;
  Creature.SECT = SECT;
  Creature.LIMITS = LIMITS;
  FTS.Creature = Creature;
})();

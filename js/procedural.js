/* ==========================================================================
   FEAR TAKES SHAPE — procedural.js
   Seeded randomness, noise, math helpers and feature generators.
   Everything organic in the piece grows out of these functions.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = (window.FTS = window.FTS || {});
  const TAU = Math.PI * 2;

  /* ---------- seeded RNG ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- improved Perlin noise (seeded, 3D) ---------- */
  class Noise3 {
    constructor(seed) {
      const r = mulberry32(seed >>> 0);
      const perm = new Uint8Array(256);
      for (let i = 0; i < 256; i++) perm[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
      }
      this.p = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    }
    static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    static grad(h, x, y, z) {
      h &= 15;
      const u = h < 8 ? x : y;
      const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    noise(x, y, z) {
      const p = this.p;
      let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      x -= X; y -= Y; z -= Z;
      X &= 255; Y &= 255; Z &= 255;
      const u = Noise3.fade(x), v = Noise3.fade(y), w = Noise3.fade(z);
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
      const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      const g = Noise3.grad, l = lerp;
      return l(
        l(l(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u),
          l(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u), v),
        l(l(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u),
          l(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u), v),
        w
      );
    }
    fbm(x, y, z, oct = 3) {
      let a = 1, f = 1, s = 0, n = 0;
      for (let i = 0; i < oct; i++) {
        s += a * this.noise(x * f, y * f, z * f);
        n += a; a *= 0.5; f *= 2.03;
      }
      return s / n;
    }
  }

  /* ---------- math ---------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
  function wrapAngle(a) { a %= TAU; return a < 0 ? a + TAU : a; }
  function angDiff(a, b) { // shortest signed a-b
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function dampAngle(a, b, lambda, dt) { return a - angDiff(a, b) * (1 - Math.exp(-lambda * dt)); }
  function gauss(x, s) { return Math.exp(-(x * x) / (2 * s * s)); }
  function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function range(rng, a, b) { return a + (b - a) * rng(); }

  let uidCounter = 0;
  function uid() { uidCounter++; return 'f' + Date.now().toString(36).slice(-4) + uidCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  /* ---------- feature generators ----------
     Every generated part is a small bag of numbers. Geometry is derived
     from them at draw time, so they can be interpolated, stretched,
     duplicated and serialised freely. */
  const Gen = {
    eye(rng, angle, depth, opts = {}) {
      return {
        id: uid(), type: 'eye', seed: Math.floor(rng() * 1e9),
        angle, angleT: angle, depth, depthT: depth,
        scale: 0.2, scaleT: opts.scale || 1, grow: 0,
        size: opts.size || range(rng, 0.09, 0.17),
        aspect: range(rng, 0.38, 0.62),           // height / width of the opening
        skew: range(rng, -0.35, 0.35),            // asymmetric lids
        tilt: range(rng, -0.7, 0.7),
        pupil: pick(rng, ['round', 'slit', 'slit', 'split', 'void', 'pinhole']),
        iris: range(rng, 0.5, 0.72),
        open: 0,
      };
    },
    tendril(rng, angle, length, bend, opts = {}) {
      return {
        id: uid(), type: 'tendril', seed: Math.floor(rng() * 1e9),
        angle, angleT: angle, depth: 1, depthT: 1,
        scale: 1, scaleT: 1, grow: 0,
        length: 0.05, lengthT: length,
        bend: 0, bendT: bend,
        curl: opts.curl != null ? opts.curl : range(rng, -0.9, 0.9),
        width: opts.width || range(rng, 0.1, 0.19),
        wave: range(rng, 0.2, 0.9),
        rings: rng() < 0.55,
        tip: pick(rng, ['taper', 'taper', 'bulb', 'fork', 'hook']),
      };
    },
    texture(rng, angle, depth, radius, kind) {
      return {
        id: uid(), type: 'texture', seed: Math.floor(rng() * 1e9),
        angle, angleT: angle, depth, depthT: depth,
        scale: 0.1, scaleT: 1, grow: 0,
        radius, kind, dir: range(rng, 0, TAU),
        density: range(rng, 0.7, 1.2),
      };
    },
    nodule(rng, angle, kind) {
      return {
        id: uid(), type: 'nodule', seed: Math.floor(rng() * 1e9),
        angle, angleT: angle, depth: 1, depthT: 1,
        scale: 0.1, scaleT: 1, grow: 0,
        kind,                                    // 'bump' | 'bristle'
        size: kind === 'bump' ? range(rng, 0.08, 0.18) : range(rng, 0.12, 0.28),
        width: range(rng, 0.09, 0.2),
        count: 5 + Math.floor(rng() * 9),
      };
    },
    clone(f, rng) {
      const c = JSON.parse(JSON.stringify(f));
      c.id = uid();
      c.seed = Math.floor(rng() * 1e9);
      c.grow = 0.35;
      return c;
    },
  };

  /* ---------- grain tile (shared texture) ---------- */
  function makeGrainCanvas(size = 220, seed = 7) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const r = mulberry32(seed);
    for (let i = 0; i < size * size; i++) {
      const v = r();
      const g = v > 0.5 ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = Math.floor(Math.pow(Math.abs(v - 0.5) * 2, 2.2) * 120);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  FTS.TAU = TAU;
  FTS.mulberry32 = mulberry32;
  FTS.Noise3 = Noise3;
  FTS.M = { lerp, clamp, damp, wrapAngle, angDiff, dampAngle, gauss, smoothstep, pick, range };
  FTS.uid = uid;
  FTS.Gen = Gen;
  FTS.makeGrainCanvas = makeGrainCanvas;
})();

/* ==========================================================================
   FEAR TAKES SHAPE — render.js
   Procedural drawing of the creature: ink, charcoal, membrane, eyes.
   Works on any CanvasRenderingContext2D (p5's main canvas, p5.Graphics,
   or a detached canvas used for evolution snapshots).
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;
  const { clamp, gauss, angDiff, lerp } = FTS.M;
  const TAU = FTS.TAU;
  const N = FTS.Creature.N, SECT = FTS.Creature.SECT;

  const INK = (a) => `rgba(234,229,219,${a})`;
  const SOOT = (a) => `rgba(4,4,4,${a})`;
  const texCache = new Map();
  const xs = new Float32Array(N), ys = new Float32Array(N);

  function trace(ctx, X, Y, n, k = 1) {
    const mx = (i) => (X[i] + X[(i + 1) % n]) * 0.5 * k;
    const my = (i) => (Y[i] + Y[(i + 1) % n]) * 0.5 * k;
    ctx.moveTo(mx(n - 1), my(n - 1));
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(X[i] * k, Y[i] * k, mx(i), my(i));
    ctx.closePath();
  }

  /* ---------- tendrils ---------- */
  function drawTendril(ctx, c, f, o, px, alpha) {
    const anim = o.anim ? o.anim.get(f.id) : null;
    const sp = c.tendrilSpine(f, anim, o.t || 0);
    const L = [], R = [];
    for (const p of sp) {
      const a = p.dir + Math.PI / 2;
      L.push([p.x + Math.cos(a) * p.w, p.y + Math.sin(a) * p.w]);
      R.push([p.x - Math.cos(a) * p.w, p.y - Math.sin(a) * p.w]);
    }
    const tip = sp[sp.length - 1];
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (let k = 1; k < L.length - 1; k++) {
      const nx = (L[k][0] + L[k + 1][0]) / 2, ny = (L[k][1] + L[k + 1][1]) / 2;
      ctx.quadraticCurveTo(L[k][0], L[k][1], nx, ny);
    }
    ctx.lineTo(tip.x + Math.cos(tip.dir) * tip.w, tip.y + Math.sin(tip.dir) * tip.w);
    for (let k = R.length - 1; k > 0; k--) {
      const nx = (R[k][0] + R[k - 1][0]) / 2, ny = (R[k][1] + R[k - 1][1]) / 2;
      ctx.quadraticCurveTo(R[k][0], R[k][1], nx, ny);
    }
    ctx.lineTo(R[0][0], R[0][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(sp[0].x, sp[0].y, tip.x, tip.y);
    g.addColorStop(0, `rgba(40,38,35,${alpha})`);
    g.addColorStop(0.6, `rgba(27,26,24,${alpha})`);
    g.addColorStop(1, `rgba(16,15,14,${alpha})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.1 * px;
    ctx.strokeStyle = INK(0.26 * alpha);
    ctx.stroke();

    // light catching one flank
    ctx.beginPath();
    for (let k = 1; k < sp.length - 1; k++) {
      const p = sp[k], a = p.dir - Math.PI / 2;
      const x = p.x + Math.cos(a) * p.w * 0.55, y = p.y + Math.sin(a) * p.w * 0.55;
      k === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1.4 * px;
    ctx.strokeStyle = INK(0.07 * alpha);
    ctx.stroke();

    // segment rings
    if (f.rings) {
      ctx.lineWidth = 0.9 * px;
      ctx.strokeStyle = SOOT(0.55 * alpha);
      for (let k = 3; k < sp.length - 2; k += 2) {
        const p = sp[k], a = p.dir + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * p.w * 0.9, p.y + Math.sin(a) * p.w * 0.9);
        ctx.quadraticCurveTo(p.x + Math.cos(p.dir) * p.w * 0.35, p.y + Math.sin(p.dir) * p.w * 0.35,
          p.x - Math.cos(a) * p.w * 0.9, p.y - Math.sin(a) * p.w * 0.9);
        ctx.stroke();
      }
    }
    if (f.tip === 'fork') {
      ctx.lineWidth = 1.6 * px;
      ctx.strokeStyle = INK(0.3 * alpha);
      const l = f.width * 1.3 * f.scale;
      for (const s of [-0.55, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.quadraticCurveTo(tip.x + Math.cos(tip.dir + s * 0.5) * l * 0.6, tip.y + Math.sin(tip.dir + s * 0.5) * l * 0.6,
          tip.x + Math.cos(tip.dir + s) * l, tip.y + Math.sin(tip.dir + s) * l);
        ctx.stroke();
      }
    }
    if (f.tip === 'bulb') {
      const p = sp[sp.length - 3];
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(p.w * 0.35, 0.01), 0, TAU);
      ctx.fillStyle = SOOT(0.6 * alpha);
      ctx.fill();
    }
    return sp;
  }

  /* ---------- eyes ---------- */
  function drawEye(ctx, c, f, o, px) {
    const p = c.featurePos(f);
    const s = f.size * f.scale * (0.3 + 0.7 * f.grow);
    if (s < 0.005) return;
    const open = clamp(o.eyeOpen ? o.eyeOpen(f) : 0.9, 0, 1) * clamp(f.grow * 1.4, 0, 1);
    const look = o.look ? o.look(f, p.x, p.y) : { x: 0, y: 0 };
    const dil = o.dilation ? o.dilation(f) : 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(f.tilt + (f.angle * 0.15));
    const h = s * f.aspect;

    // socket / fold
    const sg = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 1.7);
    sg.addColorStop(0, SOOT(0.75)); sg.addColorStop(0.6, SOOT(0.35)); sg.addColorStop(1, SOOT(0));
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 1.7, h * 2.4 + s * 0.3, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 0.9 * px;
    ctx.strokeStyle = INK(0.1);
    for (let k = 1; k <= 2; k++) {
      ctx.beginPath();
      ctx.ellipse(f.skew * s * 0.2, -h * 0.2 * k, s * (1 + k * 0.18), h * (1.1 + k * 0.45), 0, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }

    const ho = Math.max(h * open, 0.0001);
    const sk = f.skew * s;
    const opening = () => {
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(sk, -ho * 2, s, 0);
      ctx.quadraticCurveTo(-sk * 0.6, ho * 1.7, -s, 0);
      ctx.closePath();
    };
    if (open > 0.04) {
      ctx.save();
      opening();
      const eg = ctx.createRadialGradient(-s * 0.2, -h * 0.3, 0, 0, 0, s * 1.1);
      eg.addColorStop(0, 'rgba(214,209,198,1)');
      eg.addColorStop(0.7, 'rgba(150,145,136,1)');
      eg.addColorStop(1, 'rgba(70,67,62,1)');
      ctx.fillStyle = eg;
      ctx.fill();
      ctx.clip();
      const lx = clamp(look.x, -1, 1) * s * 0.42, ly = clamp(look.y, -1, 1) * h * 0.5;
      const ir = s * f.iris;
      // iris
      ctx.beginPath(); ctx.arc(lx, ly, ir, 0, TAU);
      const ig = ctx.createRadialGradient(lx, ly, ir * 0.2, lx, ly, ir);
      ig.addColorStop(0, '#2c2a27'); ig.addColorStop(0.8, '#45423d'); ig.addColorStop(1, '#151413');
      ctx.fillStyle = ig; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.7 * px;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * TAU + f.seed;
        ctx.beginPath();
        ctx.moveTo(lx + Math.cos(a) * ir * 0.35, ly + Math.sin(a) * ir * 0.35);
        ctx.lineTo(lx + Math.cos(a + 0.2) * ir * 0.95, ly + Math.sin(a + 0.2) * ir * 0.95);
        ctx.stroke();
      }
      // pupil
      ctx.fillStyle = '#030303';
      const pr = ir * 0.48 * dil;
      ctx.beginPath();
      switch (f.pupil) {
        case 'slit': ctx.ellipse(lx, ly, pr * 0.22, ir * 0.92, 0, 0, TAU); break;
        case 'split':
          ctx.ellipse(lx - pr * 0.35, ly, pr * 0.32, pr * 0.8, 0.3, 0, TAU);
          ctx.ellipse(lx + pr * 0.45, ly + pr * 0.1, pr * 0.28, pr * 0.65, -0.2, 0, TAU); break;
        case 'void': ctx.arc(lx, ly, ir * 0.96, 0, TAU); break;
        case 'pinhole': ctx.arc(lx, ly, pr * 0.32, 0, TAU); break;
        default: ctx.arc(lx, ly, pr, 0, TAU);
      }
      ctx.fill();
      // wet highlight
      ctx.fillStyle = INK(0.75);
      ctx.beginPath(); ctx.arc(lx - ir * 0.35, ly - ir * 0.4, Math.max(ir * 0.12, 0.6 * px), 0, TAU); ctx.fill();
      // lid shadow
      const lg = ctx.createLinearGradient(0, -ho * 1.2, 0, ho * 0.2);
      lg.addColorStop(0, SOOT(0.7)); lg.addColorStop(1, SOOT(0));
      ctx.fillStyle = lg; ctx.fillRect(-s, -ho * 2, s * 2, ho * 2.2);
      ctx.restore();
      opening();
      ctx.lineWidth = 1.3 * px;
      ctx.strokeStyle = SOOT(0.9);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(sk, s * 0.05, s, 0);
      ctx.lineWidth = 1.4 * px;
      ctx.strokeStyle = SOOT(0.95);
      ctx.stroke();
      ctx.strokeStyle = INK(0.12);
      ctx.lineWidth = 0.8 * px;
      ctx.beginPath(); ctx.moveTo(-s * 0.9, px * 2); ctx.quadraticCurveTo(sk, s * 0.08 + px * 2, s * 0.9, px * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- surface textures ---------- */
  function textureElements(f) {
    const key = f.id + ':' + f.kind;
    if (texCache.has(key)) return texCache.get(key);
    const r = FTS.mulberry32(f.seed);
    const els = [];
    if (f.kind === 'pores') {
      const n = Math.floor(26 * f.density);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * 0.95;
        els.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: (0.03 + r() * 0.07) * (1.1 - d * 0.6), a: r() * TAU, e: 0.5 + r() * 0.5 });
      }
    } else if (f.kind === 'ridges') {
      const n = Math.floor(9 * f.density);
      for (let i = 0; i < n; i++) els.push({ o: (i / (n - 1) - 0.5) * 1.8, w: r() * 0.4, ph: r() * TAU, l: 0.6 + r() * 0.4 });
    } else {
      const n = Math.floor(30 * f.density);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * 0.9;
        els.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: 0.09 + r() * 0.09, a: f.dir + (r() - 0.5) * 0.6 });
      }
    }
    texCache.set(key, els);
    return els;
  }
  function drawTexture(ctx, c, f, px) {
    const p = c.featurePos(f);
    const R = f.radius * f.scale * (0.2 + 0.8 * f.grow);
    const a = clamp(f.grow * 1.2, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.3);
    hg.addColorStop(0, SOOT(0.32 * a)); hg.addColorStop(1, SOOT(0));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, TAU); ctx.fill();
    const els = textureElements(f);
    if (f.kind === 'pores') {
      for (const e of els) {
        const s = e.s * R;
        ctx.beginPath(); ctx.ellipse(e.x * R, e.y * R, s, s * e.e, e.a, 0, TAU);
        ctx.fillStyle = SOOT(0.75 * a); ctx.fill();
        ctx.beginPath(); ctx.ellipse(e.x * R, e.y * R + s * 0.3, s * 1.05, s * e.e, e.a, Math.PI * 0.1, Math.PI * 0.9);
        ctx.lineWidth = 0.8 * px; ctx.strokeStyle = INK(0.2 * a); ctx.stroke();
      }
    } else if (f.kind === 'ridges') {
      ctx.rotate(f.dir);
      for (const e of els) {
        ctx.beginPath();
        const oy = e.o * 0.5;
        const half = Math.sqrt(Math.max(0.02, 1 - oy * oy)) * e.l;
        for (let k = 0; k <= 16; k++) {
          const u = (k / 16 - 0.5) * 2 * half;
          const y = (oy + Math.sin(u * 2.4 + e.ph) * 0.05 * (1 + e.w) + u * u * 0.12) * R;
          k === 0 ? ctx.moveTo(u * R, y) : ctx.lineTo(u * R, y);
        }
        ctx.lineWidth = 1.6 * px; ctx.strokeStyle = SOOT(0.7 * a); ctx.stroke();
        ctx.save(); ctx.translate(0, -1.4 * px);
        ctx.lineWidth = 0.8 * px; ctx.strokeStyle = INK(0.16 * a); ctx.stroke();
        ctx.restore();
      }
    } else {
      for (const e of els) {
        const s = e.s * R;
        ctx.beginPath();
        ctx.arc(e.x * R, e.y * R, s, e.a - 1.1, e.a + 1.1);
        ctx.lineWidth = 1 * px; ctx.strokeStyle = INK(0.18 * a); ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.x * R - Math.cos(e.a) * px * 1.5, e.y * R - Math.sin(e.a) * px * 1.5, s, e.a - 1.0, e.a + 1.0);
        ctx.strokeStyle = SOOT(0.6 * a); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------- whole creature ---------- */
  function drawCreature(ctx, c, o) {
    const S = o.S * (o.scale || 1);
    const px = 1 / S;
    const alpha = o.alpha == null ? 1 : o.alpha;
    const t = o.t || 0;
    const r = c.computeRadii(o.radiusMod);
    let maxR = 0;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU;
      xs[i] = Math.cos(th) * r[i]; ys[i] = Math.sin(th) * r[i];
      if (r[i] > maxR) maxR = r[i];
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot || 0);
    ctx.scale(S, S);
    if (o.squash) ctx.scale(1 + o.squash, 1 - o.squash);

    // ground shadow
    if (o.shadow !== false) {
      const gy = maxR * 0.95;
      ctx.save(); ctx.scale(1, 0.22);
      const sh = ctx.createRadialGradient(0, gy / 0.22 + 0.4, 0, 0, gy / 0.22 + 0.4, maxR * 1.6);
      sh.addColorStop(0, SOOT(0.55)); sh.addColorStop(1, SOOT(0));
      ctx.fillStyle = sh;
      ctx.beginPath(); ctx.arc(0, gy / 0.22 + 0.4, maxR * 1.6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // limbs (behind body)
    for (const f of c.features) if (f.type === 'tendril') drawTendril(ctx, c, f, o, px, 1);

    // body fill
    const L = o.light || { x: -0.4, y: -0.55 };
    ctx.beginPath(); trace(ctx, xs, ys, N);
    const bg = ctx.createRadialGradient(L.x * maxR * 0.7, L.y * maxR * 0.7, 0, 0, 0, maxR * 1.25);
    bg.addColorStop(0, '#4c4945');
    bg.addColorStop(0.42, '#2b2926');
    bg.addColorStop(0.85, '#141312');
    bg.addColorStop(1, '#0c0b0a');
    ctx.fillStyle = bg;
    ctx.fill();

    // interior (clipped)
    ctx.save();
    ctx.beginPath(); trace(ctx, xs, ys, N); ctx.clip();
    // topographic membrane contours
    const nz = c.noise;
    ctx.lineWidth = 1 * px;
    const levels = [0.88, 0.74, 0.6, 0.45, 0.3];
    for (let li = 0; li < levels.length; li++) {
      const k = levels[li];
      ctx.beginPath();
      for (let i = 0; i <= N; i += 2) {
        const ii = i % N, th = (ii / N) * TAU;
        const w = 1 + nz.noise(Math.cos(th) * 1.5 + li, Math.sin(th) * 1.5, li * 3.1 + t * 0.05) * 0.16;
        const x = xs[ii] * k * w + 0.06 * (1 - k), y = ys[ii] * k * w + 0.05 * (1 - k);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = INK(0.035 + 0.02 * (li % 2));
      ctx.stroke();
    }
    // veins: organic connections from a core to every part
    const core = { x: 0.08, y: 0.05 };
    for (const f of c.features) {
      let p;
      if (f.type === 'tendril') { const a = f.angle; const rr = c.radiusAt(a) * 0.86; p = { x: Math.cos(a) * rr, y: Math.sin(a) * rr }; }
      else if (f.type === 'nodule') continue;
      else p = c.featurePos(f);
      const mx = (core.x + p.x) / 2 + Math.sin(f.seed) * 0.25, my = (core.y + p.y) / 2 + Math.cos(f.seed) * 0.25;
      ctx.beginPath(); ctx.moveTo(core.x, core.y); ctx.quadraticCurveTo(mx, my, p.x, p.y);
      ctx.lineWidth = (f.type === 'tendril' ? 4.5 : 3) * px * f.grow;
      ctx.strokeStyle = SOOT(0.4 * f.grow); ctx.stroke();
      ctx.lineWidth = 1 * px; ctx.strokeStyle = INK(0.05 * f.grow); ctx.stroke();
    }
    for (const f of c.features) if (f.type === 'texture') drawTexture(ctx, c, f, px);
    // bump pustules
    for (const f of c.features) {
      if (f.type !== 'nodule' || f.kind !== 'bump') continue;
      const rr = c.radiusAt(f.angle) * 0.82;
      const x = Math.cos(f.angle) * rr, y = Math.sin(f.angle) * rr, s = f.size * f.scale * f.grow * 0.65;
      const pg = ctx.createRadialGradient(x - s * 0.35, y - s * 0.35, 0, x, y, s);
      pg.addColorStop(0, INK(0.12)); pg.addColorStop(0.5, INK(0.03)); pg.addColorStop(0.85, SOOT(0.35)); pg.addColorStop(1, SOOT(0));
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(x, y, Math.max(s, 0.001), 0, TAU); ctx.fill();
    }
    for (const f of c.features) if (f.type === 'eye') drawEye(ctx, c, f, o, px);
    // inner edge darkening
    ctx.beginPath(); trace(ctx, xs, ys, N);
    ctx.lineWidth = 0.16; ctx.strokeStyle = SOOT(0.22); ctx.stroke();
    ctx.lineWidth = 0.06; ctx.strokeStyle = SOOT(0.25); ctx.stroke();
    ctx.restore();

    // rim ink, per sector so unexplored regions stay unresolved
    const per = N / SECT;
    for (let s = 0; s < SECT; s++) {
      const clar = o.ambiguity ? clamp(c.exposure[s] * 1.15, 0, 1) : 1;
      const crisp = o.crisp == null ? 1 : o.crisp;
      ctx.beginPath();
      for (let k = 0; k <= per; k++) {
        const i = (s * per + k) % N;
        k === 0 ? ctx.moveTo(xs[i], ys[i]) : ctx.lineTo(xs[i], ys[i]);
      }
      ctx.lineWidth = (1 + crisp * 0.5) * px;
      ctx.strokeStyle = INK((0.08 + 0.42 * clar) * (0.4 + 0.6 * crisp));
      ctx.stroke();
      // charcoal drag
      ctx.lineWidth = 2.6 * px;
      ctx.strokeStyle = INK(0.035 * clar);
      ctx.stroke();
    }
    if (o.ambiguity) {
      for (let s = 0; s < SECT; s++) {
        const clar = clamp(c.exposure[s] * 1.15, 0, 1);
        if (clar > 0.7) continue;
        const th = ((s + 0.5) / SECT) * TAU, rr = c.radiusAt(th);
        const x = Math.cos(th) * rr, y = Math.sin(th) * rr;
        const hz = ctx.createRadialGradient(x, y, 0, x, y, 0.42);
        hz.addColorStop(0, `rgba(9,9,8,${0.75 * (1 - clar / 0.7)})`);
        hz.addColorStop(1, 'rgba(9,9,8,0)');
        ctx.fillStyle = hz; ctx.beginPath(); ctx.arc(x, y, 0.42, 0, TAU); ctx.fill();
        // faint smeared outline guesses
        ctx.lineWidth = 1 * px; ctx.strokeStyle = INK(0.05 * (1 - clar));
        for (let j = 0; j < 2; j++) {
          ctx.beginPath();
          for (let k = -2; k <= per + 2; k++) {
            const i = ((s * per + k) % N + N) % N;
            const j1 = 1 + nz.noise(i * 0.2, j * 5, t * 0.4) * 0.12;
            k === -2 ? ctx.moveTo(xs[i] * j1, ys[i] * j1) : ctx.lineTo(xs[i] * j1, ys[i] * j1);
          }
          ctx.stroke();
        }
      }
    }

    // bristles
    for (const f of c.features) {
      if (f.type !== 'nodule' || f.kind !== 'bristle') continue;
      const rng = FTS.mulberry32(f.seed);
      const na = c.normalAngle(f.angle);
      ctx.lineWidth = 0.9 * px;
      for (let k = 0; k < f.count; k++) {
        const a = f.angle + (rng() - 0.5) * f.width * 2.2;
        const rr = c.radiusAt(a) * 0.98;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        const len = f.size * f.scale * f.grow * (0.5 + rng() * 0.6);
        const sway = o.anim && o.anim.bristle ? o.anim.bristle(f, k) : 0;
        const d = na + (rng() - 0.5) * 0.9 + sway;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(d) * len * 0.5, y + Math.sin(d) * len * 0.5,
          x + Math.cos(d + 0.35) * len, y + Math.sin(d + 0.35) * len);
        ctx.strokeStyle = INK(0.32); ctx.stroke();
      }
    }

    // ghosts (stage 1 temporal smear)
    if (o.ghosts && o.ghosts.length) {
      ctx.lineWidth = 1 * px;
      o.ghosts.forEach((gr, gi) => {
        ctx.beginPath();
        const gx = new Float32Array(N), gy = new Float32Array(N);
        for (let i = 0; i < N; i++) { const th = (i / N) * TAU; gx[i] = Math.cos(th) * gr[i]; gy[i] = Math.sin(th) * gr[i]; }
        trace(ctx, gx, gy, N);
        ctx.strokeStyle = INK(o.ghostAlpha * (1 - gi / o.ghosts.length));
        ctx.stroke();
      });
    }

    // interaction feedback
    if (o.highlight || o.bud) {
      for (const f of c.features) {
        if (f.id !== o.highlight && f.id !== o.bud) continue;
        const isBud = f.id === o.bud;
        ctx.setLineDash([3 * px, 4 * px]);
        ctx.lineWidth = 1 * px;
        ctx.strokeStyle = INK(isBud ? 0.55 : 0.25);
        if (f.type === 'tendril') {
          const sp = c.tendrilSpine(f, o.anim ? o.anim.get(f.id) : null, t);
          const tp = sp[sp.length - 1];
          ctx.beginPath(); ctx.arc(tp.x, tp.y, 0.1 + (isBud ? Math.sin(t * 20) * 0.02 : 0), 0, TAU); ctx.stroke();
        } else {
          const p = f.type === 'nodule' ? c.rimPoint(f.angle) : c.featurePos(f);
          const rr = f.type === 'eye' ? f.size * f.scale * 1.6 : f.type === 'texture' ? f.radius * f.scale : 0.16;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr + (isBud ? Math.sin(t * 20) * 0.02 : 0), 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  /* ---------- environment ---------- */
  let grainCanvas = null, grainPattern = null, grainCtx = null;
  function drawBackdrop(ctx, W, H, o = {}) {
    const cx = o.cx != null ? o.cx : W / 2, cy = o.cy != null ? o.cy : H / 2;
    const g = ctx.createRadialGradient(cx, cy - H * 0.08, 0, cx, cy, Math.max(W, H) * 0.75);
    const lift = o.lift == null ? 1 : o.lift;
    g.addColorStop(0, `rgb(${Math.round(24 * lift)},${Math.round(23 * lift)},${Math.round(21 * lift)})`);
    g.addColorStop(0.55, `rgb(${Math.round(12 * lift)},${Math.round(12 * lift)},${Math.round(11 * lift)})`);
    g.addColorStop(1, '#040404');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  function drawGrain(ctx, W, H, alpha = 0.06, moving = true) {
    if (!grainCanvas) grainCanvas = FTS.makeGrainCanvas(220, 11);
    if (grainCtx !== ctx) { grainPattern = ctx.createPattern(grainCanvas, 'repeat'); grainCtx = ctx; }
    ctx.save();
    ctx.globalAlpha = alpha;
    const ox = moving ? Math.floor(Math.random() * 220) : 0, oy = moving ? Math.floor(Math.random() * 220) : 0;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, W + 220, H + 220);
    ctx.restore();
  }
  function drawVignette(ctx, W, H, strength = 0.75) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- offscreen render of the creature (snapshots) ---------- */
  function renderSpecimen(c, size, opts = {}) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    drawBackdrop(ctx, size, size, { lift: 1.15 });
    const b = c.bounds(opts.anim);
    const S = (size * (opts.fill || 0.78)) / Math.max(b.w, b.h, 2.2);
    const lookAt = opts.lookAt || { x: 0.3, y: 0.15 };
    drawCreature(ctx, c, {
      x: size / 2 - b.cx * S, y: size / 2 - b.cy * S, S, t: opts.t || 0,
      anim: opts.anim, eyeOpen: opts.eyeOpen || (() => 0.92),
      look: (f) => lookAt, ambiguity: opts.ambiguity !== false, crisp: 1,
    });
    drawVignette(ctx, size, size, 0.6);
    drawGrain(ctx, size, size, opts.grain == null ? 0.05 : opts.grain, false);
    return cv;
  }

  FTS.Render = { drawCreature, drawBackdrop, drawGrain, drawVignette, renderSpecimen, INK, SOOT, trace };
})();

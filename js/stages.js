/* ==========================================================================
   FEAR TAKES SHAPE — stages.js
   Stage management, UI shell and the five stages.
   Every stage reads and writes the same FTS.App.creature.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;
  const { clamp, damp, lerp, angDiff, gauss, wrapAngle } = FTS.M;
  const TAU = FTS.TAU;
  const R = FTS.Render;
  const N = FTS.Creature.N, SECT = FTS.Creature.SECT;
  const $ = (id) => document.getElementById(id);

  /* =====================================================================
     UI helpers
     ===================================================================== */
  const UI = {
    _timers: {},
    later(key, ms, fn) { clearTimeout(this._timers[key]); this._timers[key] = setTimeout(fn, ms); },
    instruction(text) {
      const el = $('instruction');
      el.classList.remove('show', 'settle');
      el.textContent = text || '';
      if (!text) return;
      this.later('ins1', 1400, () => el.classList.add('show'));
      this.later('ins2', 8000, () => { el.classList.add('settle'); });
    },
    hint(text) {
      const el = $('hint');
      el.classList.remove('show');
      el.textContent = text || '';
      if (text) this.later('hint', 2600, () => el.classList.add('show'));
    },
    title(n, name) {
      $('titleNum').textContent = '0' + n;
      $('titleName').textContent = name;
      const el = $('stageTitle');
      el.classList.add('show');
      this.later('title', 2200, () => el.classList.remove('show'));
    },
    next(label, fn) {
      const b = $('btnNext');
      if (!label) { b.classList.remove('show'); b.hidden = true; b.onclick = null; return; }
      b.textContent = label; b.hidden = false; b.onclick = fn;
      requestAnimationFrame(() => b.classList.add('show'));
    },
    toast(msg, ms = 2400) {
      const el = $('toast'); el.textContent = msg; el.classList.add('show');
      this.later('toast', ms, () => el.classList.remove('show'));
    },
    confirm(msg, okLabel = 'continue', cancelLabel = 'stay') {
      return new Promise((res) => {
        const d = $('dialog');
        $('dialogMsg').textContent = msg;
        $('dialogOk').textContent = okLabel; $('dialogCancel').textContent = cancelLabel;
        d.hidden = false;
        const done = (v) => { d.hidden = true; $('dialogOk').onclick = $('dialogCancel').onclick = null; res(v); };
        $('dialogOk').onclick = () => done(true);
        $('dialogCancel').onclick = () => done(false);
        $('dialogOk').focus();
      });
    },
    nav(cur, max) {
      document.querySelectorAll('#stageNav button').forEach((b) => {
        const s = +b.dataset.s;
        b.classList.toggle('current', s === cur);
        b.classList.toggle('visited', s !== cur && s <= max && s !== 8);
      });
    },
  };

  /* =====================================================================
     Shared drawing helpers
     ===================================================================== */
  let darkG = null;
  function darkness(app, ctx, lx, ly, radius, alpha) {
    // Canvas masking: an offscreen layer of darkness with a soft hole
    // cut by 'destination-out' at the light position.
    const W = app.W, H = app.H;
    if (!darkG || darkG.width !== W || darkG.height !== H) {
      if (darkG) darkG.remove();
      darkG = app.p.createGraphics(W, H);
      darkG.pixelDensity(1);
    }
    const g = darkG.drawingContext;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = `rgba(2,2,2,${alpha})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const grd = g.createRadialGradient(lx, ly, 0, lx, ly, radius);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.92)');
    grd.addColorStop(0.75, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(lx, ly, radius, 0, TAU); g.fill();
    g.restore();
    ctx.drawImage(darkG.elt, 0, 0, W, H);
  }

  function cursorRing(app, ctx, progress) {
    const p = app.ptr;
    if (!p.present) return;
    ctx.save();
    ctx.strokeStyle = R.INK(0.5);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fillStyle = R.INK(0.8); ctx.fill();
    ctx.strokeStyle = R.INK(0.18);
    ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, TAU); ctx.stroke();
    if (progress > 0) {
      ctx.strokeStyle = R.INK(0.75);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, -Math.PI / 2, -Math.PI / 2 + progress * TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* =====================================================================
     STAGE 1 — PERCEPTION
     ===================================================================== */
  const Perception = {
    id: 1, name: 'Perception',
    enter(app) {
      const c = app.creature;
      this.s = 0; this.t = Math.random() * 100; this.holding = false; this.captured = c.captured;
      this.live = new Float32Array(N).fill(1);
      this.ghosts = []; this.gTimer = 0; this.flash = 0; this.after = 0; this.elapsed = 0;
      this.fx = Math.random() * 50;
      this.compute(app, 0, true);
      app.ptr.on('down', () => { if (this.captured) return; this.holding = true; c.metrics.holdAttempts++; FTS.audio.click(0.5); });
      app.ptr.on('up', () => {
        if (!this.captured && this.s > 0.08) c.metrics.earlyReleases++;
        this.holding = false;
      });
      UI.instruction('Give the unknown a shape.');
      UI.hint('move near it · press and hold to still it');
      app.cursor('none');
    },
    compute(app, dt, instant) {
      const c = app.creature, nz = c.noise, p = app.ptr;
      const lx = (p.x - app.cx) / app.S, ly = (p.y - app.cy) / app.S;
      const pd = Math.hypot(lx, ly), pa = Math.atan2(ly, lx);
      const prox = p.present ? clamp(1 - (pd - 0.6) / 2.6, 0, 1) : 0;
      const pulse = 1 + Math.sin(this.elapsed * 1.3) * 0.03 * (1 - this.s);
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU;
        const cx = Math.cos(th), sy = Math.sin(th);
        let r = 1 + 0.5 * nz.fbm(cx * 1.05 + this.fx, sy * 1.05, this.t, 3)
          + 0.22 * nz.noise(cx * 0.5 + 9, sy * 0.5, this.t * 0.45);
        r -= 0.38 * prox * gauss(angDiff(th, pa), 0.62);            // recoils from the cursor
        r += 0.2 * prox * gauss(angDiff(th, pa + Math.PI), 0.9);     // swells away from it
        r *= pulse * (1 + prox * 0.06);
        const target = Math.max(r, 0.3);
        this.live[i] = instant ? target : damp(this.live[i], target, 9, dt);
      }
    },
    update(app, dt) {
      const c = app.creature, p = app.ptr;
      this.elapsed += dt;
      if (!this.captured) {
        if (this.holding) this.s = Math.min(1, this.s + dt / 2.0);
        else this.s = Math.max(0, this.s - dt * 0.9);
        FTS.audio.hum(this.s);
        const speed = (0.32 + Math.min(p.speedN, 2) * 0.55) * (1 - this.s * 0.97) * (app.reduced ? 0.4 : 1);
        this.t += dt * speed;
        this.compute(app, dt);
        this.gTimer += dt;
        if (this.gTimer > 0.07) {
          this.gTimer = 0;
          this.ghosts.unshift(Float32Array.from(this.live));
          if (this.ghosts.length > (app.reduced ? 2 : 4)) this.ghosts.pop();
        }
        c.base.set(this.live);
        c.computeRadii();
        if (this.s >= 1) this.capture(app);
      } else {
        this.after += dt;
        if (this.after > 1.8 && !app.transitioning && app.stage === 1) app.go(2);
      }
      this.flash = Math.max(0, this.flash - dt * 1.4);
      c.metrics.perceptionTime += dt;
    },
    capture(app) {
      const c = app.creature;
      let mean = 0; for (let i = 0; i < N; i++) mean += this.live[i]; mean /= N;
      for (let i = 0; i < N; i++) c.base[i] = this.live[i] / mean;
      c.captured = true;
      this.captured = true; this.flash = 1; this.after = 0; this.ghosts = [];
      c.computeRadii();
      FTS.audio.capture();
      app.snapshot(1);
      UI.hint('');
      app.save();
    },
    draw(app, ctx) {
      R.drawBackdrop(ctx, app.W, app.H, { lift: 0.9 + this.s * 0.25 });
      const c = app.creature;
      R.drawCreature(ctx, c, {
        x: app.cx, y: app.cy, S: app.S, t: this.elapsed,
        ghosts: this.ghosts, ghostAlpha: 0.2 * (1 - this.s), crisp: this.captured ? 1 : 0.25 + this.s * 0.75,
        ambiguity: false, shadow: true,
      });
      if (this.flash > 0) {
        const g = ctx.createRadialGradient(app.cx, app.cy, 0, app.cx, app.cy, app.S * 4);
        g.addColorStop(0, `rgba(233,229,219,${0.22 * this.flash})`); g.addColorStop(1, 'rgba(233,229,219,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, app.W, app.H);
      }
      if (!this.captured) cursorRing(app, ctx, this.s);
    },
    exit() {},
  };

  /* =====================================================================
     STAGE 2 — DISCOVERY
     ===================================================================== */
  const Discovery = {
    id: 2, name: 'Discovery',
    enter(app) {
      const c = app.creature, p = app.ptr;
      this.lx = p.x; this.ly = p.y; this.dwell = 0; this.anchor = null;
      this.drag = null; this.pulses = []; this.cool = 0; this.elapsed = 0;
      this.lit = new Uint8Array(SECT); this.unlit = new Float32Array(SECT).fill(9);
      p.clearHistory();
      p.on('down', (e) => {
        const l = app.toLocal(e.x, e.y);
        const a = Math.atan2(l.y, l.x);
        this.drag = { a, len: 0, circle: false, sx: l.x, sy: l.y, path: 0 };
      });
      p.on('move', () => {
        if (!this.drag) return;
        const l = app.toLocal(p.x, p.y);
        const base = c.rimPoint(this.drag.a, 0.92);
        const outside = !c.contains(l.x, l.y, 0.95);
        this.drag.len = outside ? Math.hypot(l.x - base.x, l.y - base.y) : 0;
        this.drag.ex = l.x; this.drag.ey = l.y;
      });
      p.on('up', () => {
        const d = this.drag; this.drag = null;
        if (!d || d.circle || d.cancel || d.len < 0.3) return;
        this.spawnTendril(app, d);
      });
      UI.instruction('Discover what is hiding.');
      UI.hint(p.kind === 'touch' ? 'rest a finger · drag outward · trace small circles' : 'linger · drag outward · trace small circles');
      this.updateNext(app);
      app.cursor('none');
    },
    updateNext(app) {
      if (app.creature.features.length >= 1 && !this._nextShown) {
        this._nextShown = true;
        UI.next('continue →', () => app.go(3));
      }
    },
    pulse(x, y, kind, size = 0.3) { this.pulses.push({ x, y, t: 0, kind, size }); },

    spawnEye(app, l) {
      const c = app.creature;
      const near = c.nearest('eye', l.x, l.y, 0.3);
      if (near) {
        if (near.scaleT < 1.6) near.scaleT = Math.min(1.6, near.scaleT * 1.22);
        else if (c.canAdd('eye')) {
          const a = near.angle + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2);
          c.add(FTS.Gen.eye(c.rng, a, clamp(near.depth + (Math.random() - 0.5) * 0.2, 0.15, 0.82), { scale: 0.6, size: near.size * 0.6 }));
        }
      } else if (c.canAdd('eye')) {
        const a = Math.atan2(l.y, l.x);
        const depth = clamp(Math.hypot(l.x, l.y) / c.radiusAt(a), 0.1, 0.8);
        c.add(FTS.Gen.eye(c.rng, a, depth));
      } else { UI.toast('it will not open more eyes'); return; }
      c.metrics.dwellEvents++;
      this.pulse(l.x, l.y, 'eye', 0.35);
      FTS.audio.spawn('eye');
      this.updateNext(app);
    },
    spawnTendril(app, d) {
      const c = app.creature;
      if (!c.canAdd('tendril')) { UI.toast('no room for another extension'); return; }
      let a = d.a;
      for (const f of c.features) if (f.type === 'tendril' && Math.abs(angDiff(f.angle, a)) < 0.16) a += 0.22;
      const base = c.rimPoint(a, 0.92);
      const dir = Math.atan2(d.ey - base.y, d.ex - base.x);
      const bend = clamp(angDiff(dir, c.normalAngle(a)), -1.2, 1.2);
      const f = FTS.Gen.tendril(c.rng, wrapAngle(a), clamp(d.len * 1.05, 0.35, 2.8), bend);
      c.add(f);
      c.metrics.drags++;
      this.pulse(base.x, base.y, 'tendril', 0.4);
      FTS.audio.spawn('tendril');
      this.updateNext(app);
    },
    spawnTexture(app, circ) {
      const c = app.creature;
      const kind = circ.period < 0.5 ? 'scales' : circ.sweep > 0 ? 'ridges' : 'pores';
      const near = c.nearest('texture', circ.cx, circ.cy, 0.28);
      if (near) { near.scaleT = Math.min(1.8, near.scaleT * 1.2); }
      else if (c.canAdd('texture')) {
        const a = Math.atan2(circ.cy, circ.cx);
        const depth = clamp(Math.hypot(circ.cx, circ.cy) / c.radiusAt(a), 0.05, 0.8);
        c.add(FTS.Gen.texture(c.rng, a, depth, clamp(circ.r * 1.3, 0.14, 0.42), kind));
      } else { UI.toast('the surface is already full'); return; }
      c.metrics.circles++;
      this.pulse(circ.cx, circ.cy, 'texture', circ.r * 1.4);
      FTS.audio.spawn('texture');
      this.updateNext(app);
    },
    spawnNodule(app, s) {
      const c = app.creature;
      const a = ((s + 0.5) / SECT) * TAU;
      const existing = c.features.find((f) => f.type === 'nodule' && Math.abs(angDiff(f.angle, a)) < 0.25);
      if (existing) existing.scaleT = Math.min(1.9, existing.scaleT * 1.25);
      else if (c.canAdd('nodule')) c.add(FTS.Gen.nodule(c.rng, a + (Math.random() - 0.5) * 0.1, (c.visits[s] / 3) % 2 === 1 ? 'bump' : 'bristle'));
      else return;
      const rp = c.rimPoint(a);
      this.pulse(rp.x, rp.y, 'nodule', 0.25);
      FTS.audio.spawn('nodule');
      this.updateNext(app);
    },

    update(app, dt) {
      const c = app.creature, p = app.ptr;
      this.elapsed += dt;
      c.metrics.discoveryTime += dt;
      const k = p.present ? 14 : 2;
      this.lx = damp(this.lx, p.present ? p.x : app.cx + Math.cos(this.elapsed * 0.3) * app.S * 2.4, k, dt);
      this.ly = damp(this.ly, p.present ? p.y : app.cy + Math.sin(this.elapsed * 0.4) * app.S * 1.4, k, dt);
      this.lightR = app.S * 1.05 + 40;
      this.nodCool = (this.nodCool || 0) - dt;
      FTS.audio.light(p.speedN);
      const L = app.toLocal(this.lx, this.ly);
      const Lr = this.lightR / app.S;

      // exposure & repeated visits
      for (let s = 0; s < SECT; s++) {
        const th = ((s + 0.5) / SECT) * TAU;
        const rp = c.rimPoint(th);
        const d = Math.hypot(rp.x - L.x, rp.y - L.y) / Lr;
        const lit = p.present && d < 0.8;
        if (lit) {
          c.exposure[s] = Math.min(1, c.exposure[s] + dt * 1.1 * (1 - d));
          if (!this.lit[s] && this.unlit[s] > 0.6) {
            c.visits[s]++; c.metrics.revisits++;
            if (c.visits[s] >= 3 && c.visits[s] % 3 === 0 && this.nodCool <= 0) { this.spawnNodule(app, s); this.nodCool = 1.6; }
          }
          this.unlit[s] = 0;
        } else this.unlit[s] += dt;
        this.lit[s] = lit ? 1 : 0;
      }

      // lingering → eyes
      const l = app.toLocal(p.x, p.y);
      const lingering = p.present && p.speed < 30 && c.contains(l.x, l.y, 0.92) && (p.kind === 'mouse' || p.down);
      if (lingering) {
        if (!this.anchor || Math.hypot(l.x - this.anchor.x, l.y - this.anchor.y) > 0.14) { this.anchor = { x: l.x, y: l.y }; this.dwell = Math.min(this.dwell, 0); }
        this.dwell += dt;
        if (this.dwell >= 1.25) {
          this.spawnEye(app, this.anchor);
          this.dwell = -0.7;
          if (this.drag) this.drag.cancel = true;
        }
      } else if (this.dwell > 0) this.dwell = Math.max(0, this.dwell - dt * 3);
      else this.dwell = Math.min(0, this.dwell + dt);

      // circles → textures
      this.cool -= dt;
      if (this.cool <= 0 && p.history.length > 14) {
        const circ = FTS.detectCircle(p.history, (x, y) => app.toLocal(x, y));
        if (circ && Math.abs(circ.sweep) > TAU * 0.88 && c.contains(circ.cx, circ.cy, 0.95)) {
          this.spawnTexture(app, circ);
          p.clearHistory(); this.cool = 0.6;
          if (this.drag) this.drag.circle = true;
        }
      }
      for (const q of this.pulses) q.t += dt;
      this.pulses = this.pulses.filter((q) => q.t < 1.6);
      c.update(dt);
    },
    draw(app, ctx) {
      const c = app.creature;
      R.drawBackdrop(ctx, app.W, app.H, { lift: 0.6 });
      const L = app.toLocal(this.lx, this.ly);
      const Lr = this.lightR / app.S;
      R.drawCreature(ctx, c, {
        x: app.cx, y: app.cy, S: app.S, t: this.elapsed, ambiguity: true,
        eyeOpen: (f) => { const q = c.featurePos(f); const lit = clamp(1 - Math.hypot(q.x - L.x, q.y - L.y) / Lr, 0, 1); return 0.95 - lit * 0.55; },
        look: (f) => { const q = c.featurePos(f); const vx = L.x - q.x, vy = L.y - q.y, m = Math.hypot(vx, vy) || 1; const rr = -(f.tilt + f.angle * 0.15); const ux = vx / m, uy = vy / m; return { x: ux * Math.cos(rr) - uy * Math.sin(rr), y: ux * Math.sin(rr) + uy * Math.cos(rr) }; },
        dilation: (f) => { const q = c.featurePos(f); const lit = clamp(1 - Math.hypot(q.x - L.x, q.y - L.y) / Lr, 0, 1); return 1.35 - lit * 0.8; },
      });
      // feedback (masked by darkness → only visible in the light)
      ctx.save();
      for (const q of this.pulses) {
        const x = app.cx + q.x * app.S, y = app.cy + q.y * app.S;
        const u = q.t / 1.6;
        ctx.strokeStyle = R.INK(0.45 * (1 - u)); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, (q.size * 0.4 + u * q.size) * app.S, 0, TAU); ctx.stroke();
      }
      if (this.dwell > 0 && this.anchor) {
        const x = app.cx + this.anchor.x * app.S, y = app.cy + this.anchor.y * app.S;
        const u = this.dwell / 1.25;
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = R.INK(0.22 * u * (1 - k * 0.3)); ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(x, y, (6 + k * 7) * (0.5 + u) + Math.sin(this.elapsed * 30 + k) * u * 1.5, (3 + k * 4) * (0.5 + u), 0.3, 0, TAU);
          ctx.stroke();
        }
      }
      if (this.drag && this.drag.len > 0.05 && !this.drag.cancel) {
        const b = c.rimPoint(this.drag.a, 0.92);
        const bx = app.cx + b.x * app.S, by = app.cy + b.y * app.S;
        const ex = app.cx + this.drag.ex * app.S, ey = app.cy + this.drag.ey * app.S;
        ctx.strokeStyle = R.INK(0.22); ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.quadraticCurveTo((bx + ex) / 2 + Math.sin(this.elapsed * 6) * 8, (by + ey) / 2 + Math.cos(this.elapsed * 5) * 8, ex, ey);
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
      darkness(app, ctx, this.lx, this.ly, this.lightR, 0.965);
      // flashlight halo
      const hg = ctx.createRadialGradient(this.lx, this.ly, 0, this.lx, this.ly, this.lightR);
      hg.addColorStop(0, 'rgba(240,235,225,0.045)'); hg.addColorStop(1, 'rgba(240,235,225,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(this.lx, this.ly, this.lightR, 0, TAU); ctx.fill();
    },
    exit(app) { app.snapshot(2); FTS.audio.tension(0); },
  };

  /* =====================================================================
     STAGE 3 — DISTORTION
     ===================================================================== */
  const Distortion = {
    id: 3, name: 'Distortion',
    enter(app) {
      const c = app.creature, p = app.ptr;
      this.rev = app.prevStage === 4 || app.prevStage === 5 ? 1 : 0;
      this.grab = null; this.hover = null; this.elapsed = 0; this.pinch = null;
      p.on('down', (e) => this.down(app, e));
      p.on('move', () => this.move(app));
      p.on('up', () => this.up(app));
      p.on('wheel', (e) => { const l = app.toLocal(e.x, e.y); this.swell(app, l, Math.exp(-e.delta * 0.0008)); });
      p.on('pinchstart', (e) => { this.grab = null; this.pinch = app.toLocal(e.x, e.y); });
      p.on('pinch', (e) => { const l = app.toLocal(e.x, e.y); this.swell(app, l, e.ratio); });
      p.on('pinchend', () => { this.pinch = null; });
      UI.instruction('Transform the familiar into something unknown.');
      UI.hint(p.kind === 'touch'
        ? 'pull the body · drag limbs and eyes · pinch to swell · hold a part, then drag, to split it'
        : 'pull the body · drag limbs and eyes · scroll to swell · hold a part, then drag, to split it');
      UI.later('next3', 2500, () => { if (app.stage === 3) UI.next('release it →', () => app.go(4)); });
    },
    down(app, e) {
      const c = app.creature;
      const l = app.toLocal(e.x, e.y);
      const hit = c.hitFeature(l.x, l.y);
      if (hit) {
        const f = hit.f;
        this.grab = { kind: 'feature', f, part: hit.part, sx: l.x, sy: l.y, hold: 0, moved: false, bud: app.ptr.mods.alt || app.ptr.mods.shift };
        if (this.grab.bud) FTS.audio.bud();
      } else if (Math.hypot(l.x, l.y) < c.radiusAt(Math.atan2(l.y, l.x)) * 1.35) {
        this.grab = { kind: 'body', a: Math.atan2(l.y, l.x), r0: Math.max(0.15, Math.hypot(l.x, l.y)), start: Float32Array.from(c.deformT), last: 0 };
      } else this.grab = null;
      app.cursor(this.grab ? 'grabbing' : 'default');
    },
    move(app) {
      const g = this.grab; if (!g) return;
      const c = app.creature;
      const l = app.toLocal(app.ptr.x, app.ptr.y);
      const pa = Math.atan2(l.y, l.x), pd = Math.hypot(l.x, l.y);
      if (g.kind === 'body') {
        const delta = pd - g.r0;
        for (let i = 0; i < N; i++) {
          const th = (i / N) * TAU;
          const wob = 1 + 0.3 * c.noise.noise(Math.cos(th) * 2.2 + g.a, Math.sin(th) * 2.2, 7.7);
          c.deformT[i] = g.start[i] + gauss(angDiff(th, g.a), 0.36) * delta * wob;
        }
        c.relaxTargets(0.2); c.clampTargets();
        c.metrics.manipulation += Math.abs(delta - g.last) * 0.6;
        g.last = delta;
        FTS.audio.tension(Math.min(1, Math.abs(delta) * 0.9));
        return;
      }
      if (!g.moved && Math.hypot(l.x - g.sx, l.y - g.sy) > 0.06) {
        g.moved = true;
        if (g.bud && !g.dup) {
          if (c.canAdd(g.f.type)) {
            const cl = FTS.Gen.clone(g.f, c.rng);
            if (cl.type === 'tendril') { cl.length = cl.lengthT * 0.4; }
            c.add(cl);
            g.f = cl; g.dup = true; g.part = cl.type === 'tendril' ? 'tip' : 'body';
            c.metrics.duplications++;
            FTS.audio.spawn(cl.type === 'eye' ? 'eye' : 'tendril');
          } else UI.toast('it cannot hold another');
          g.bud = false;
        }
      }
      if (!g.moved) return;
      const f = g.f;
      if (f.type === 'tendril') {
        if (g.part === 'base' && !g.dup) {
          f.angleT = wrapAngle(pa);
        } else {
          if (g.dup) f.angleT = wrapAngle(lerp(0, angDiff(pa, f.angleT), 0.06) + f.angleT);
          const b = c.rimPoint(f.angle, 0.86);
          const L = Math.hypot(l.x - b.x, l.y - b.y);
          f.lengthT = clamp(L / Math.max(f.scale, 0.3) * 1.04, 0.22, 3.4);
          f.bendT = clamp(angDiff(Math.atan2(l.y - b.y, l.x - b.x), c.normalAngle(f.angle)) - f.curl * f.lengthT * 0.4, -1.6, 1.6);
        }
      } else if (f.type === 'nodule') {
        f.angleT = wrapAngle(pa);
        f.scaleT = clamp(1 + (pd - c.radiusAt(pa)) * 3, 0.4, 2.4);
      } else {
        f.angleT = wrapAngle(pa);
        f.depthT = clamp(pd / c.radiusAt(pa), 0.08, 0.86);
      }
      c.metrics.manipulation += 0.01;
      FTS.audio.tension(0.25);
    },
    up(app) {
      const g = this.grab; this.grab = null;
      FTS.audio.tension(0);
      app.cursor('default');
      if (!g) return;
      const c = app.creature;
      if (g.kind === 'body' && Math.abs(g.last) > 0.04) c.metrics.stretches++;
      if (g.kind === 'feature' && g.moved) c.metrics.stretches++;
      app.dirty = true;
    },
    swell(app, l, factor) {
      const c = app.creature;
      if (!isFinite(factor) || factor === 1) return;
      factor = clamp(factor, 0.8, 1.25);
      const hit = c.hitFeature(l.x, l.y);
      if (hit) hit.f.scaleT = clamp(hit.f.scaleT * factor, 0.35, 2.6);
      else if (Math.hypot(l.x, l.y) < c.radiusAt(Math.atan2(l.y, l.x)) * 1.5) {
        const a = Math.atan2(l.y, l.x);
        for (let i = 0; i < N; i++) {
          const th = (i / N) * TAU;
          c.deformT[i] += gauss(angDiff(th, a), 0.5) * (c.base[i] + c.deformT[i]) * (factor - 1);
        }
        c.relaxTargets(0.1); c.clampTargets();
      } else return;
      c.metrics.swells++;
      c.metrics.manipulation += Math.abs(factor - 1) * 2;
      FTS.audio.tension(Math.min(1, Math.abs(factor - 1) * 8));
      UI.later('swellQuiet', 180, () => { if (!this.grab) FTS.audio.tension(0); });
      app.dirty = true;
    },
    update(app, dt) {
      const c = app.creature, p = app.ptr;
      this.elapsed += dt;
      this.rev = Math.min(1, this.rev + dt / (app.reduced ? 0.8 : 2.4));
      const g = this.grab;
      if (g && g.kind === 'feature' && !g.moved && !g.bud) {
        g.hold += dt;
        if (g.hold > 0.65) { g.bud = true; FTS.audio.bud(); if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) { /* ignore */ } }
      }
      if (!g && p.present) {
        const l = app.toLocal(p.x, p.y);
        const hit = c.hitFeature(l.x, l.y);
        this.hover = hit ? hit.f.id : null;
        app.cursor(hit || c.contains(l.x, l.y, 1.25) ? 'grab' : 'default');
      } else if (!g) this.hover = null;
      c.update(dt, { stiff: 55, dampC: 6 });
    },
    draw(app, ctx) {
      const c = app.creature;
      R.drawBackdrop(ctx, app.W, app.H, { lift: lerp(0.6, 1, this.rev) });
      const g = this.grab;
      R.drawCreature(ctx, c, {
        x: app.cx, y: app.cy, S: app.S, t: this.elapsed, ambiguity: true,
        eyeOpen: () => 0.88, look: () => ({ x: 0, y: 0 }), dilation: () => 0.9,
        highlight: g && g.kind === 'feature' ? g.f.id : this.hover, bud: g && g.bud ? g.f.id : null,
      });
      if (g && g.kind === 'body') {
        const a = g.a, rr = c.radiusAt(a);
        const x0 = app.cx + Math.cos(a) * rr * app.S, y0 = app.cy + Math.sin(a) * rr * app.S;
        ctx.save(); ctx.strokeStyle = R.INK(0.2); ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(app.ptr.x, app.ptr.y); ctx.stroke(); ctx.restore();
      }
      if (this.rev < 1) {
        const diag = Math.hypot(app.W, app.H);
        const e = this.rev * this.rev;
        darkness(app, ctx, app.ptr.present ? app.ptr.x : app.cx, app.ptr.present ? app.ptr.y : app.cy, lerp(app.S * 1.05 + 40, diag * 1.2, e), 0.965 * (1 - e));
      }
    },
    exit(app) { this.grab = null; FTS.audio.tension(0); app.snapshot(3); app.cursor('default'); },
  };

  /* =====================================================================
     STAGE 4 — PRESENCE
     ===================================================================== */
  const Presence = {
    id: 4, name: 'Presence',
    enter(app) {
      const c = app.creature;
      // settle any in-flight deformation into its resting state
      for (let i = 0; i < N; i++) { c.deform[i] = c.deformT[i]; c.deformV[i] = 0; }
      for (const f of c.features) {
        f.grow = 1; f.scale = f.scaleT; f.angle = f.angleT; f.depth = f.depthT;
        if (f.type === 'tendril') { f.length = f.lengthT; f.bend = f.bendT; }
      }
      c.computeRadii();
      const fresh = !app.life || app.life.c !== c || app.prevStage < 4;
      if (fresh) app.life = null;
      const b = app.ensureLife();
      b.mode = 'free'; b.box = null; b.zoomT = 1; b.hold = false; b.forced = null; b.attendT = 0;
      if (fresh) { b.pos = { x: app.cx, y: app.cy }; b.intro = 0; }
      this.temp = b.temp;
      this.it = fresh ? 0 : 6;
      this.snapped = !fresh;
      this.firstBreath = !fresh;
      UI.instruction('It no longer needs you.');
      UI.hint('');
      app.cursor('none');
      UI.later('next4', fresh ? 9000 : 1200, () => { if (app.stage === 4) UI.next('continue →', () => app.go(5)); });
      UI.later('hint4', fresh ? 5200 : 100, () => { if (app.stage === 4) UI.hint('approach · withdraw · keep still · move suddenly'); });
    },
    update(app, dt) {
      const c = app.creature, b = app.life;
      this.it += dt;
      c.metrics.presenceTime += dt;
      if (!this.snapped && this.it > 1.5) { this.snapped = true; FTS.audio.click(1.4); FTS.audio.transition(); }
      if (!this.firstBreath && this.it > 2.4) { this.firstBreath = true; FTS.audio.breath(1.4, 0.8); }
      b.intro = clamp((this.it - 2.8) / 2.2, 0, 1);
      b.reduced = app.reduced;
      b.update(dt, app.ptr, app);
    },
    draw(app, ctx) {
      const c = app.creature, b = app.life;
      R.drawBackdrop(ctx, app.W, app.H, { cx: lerp(app.W / 2, b.pos.x, 0.5), cy: lerp(app.H / 2, b.pos.y, 0.5), lift: 1.05 });
      const o = b.drawOpts(app);
      o.ambiguity = true;
      if (this.it < 4.2) {
        const base = o.eyeOpen;
        const it = this.it;
        const closed = it < 1.6 ? lerp(0.88, 0, it / 1.6) : it < 2.8 ? 0 : clamp((it - 2.8) / 1.4, 0, 1);
        o.eyeOpen = (f) => (it < 2.8 ? closed : lerp(0, base(f), closed));
        if (it < 2.8) o.look = () => ({ x: 0, y: 0 });
      }
      if (this.it > 2.2 && this.it < 4.2) o.scale = (o.scale || 1) * (1 + Math.sin(((this.it - 2.2) / 2) * Math.PI) * 0.06);
      R.drawCreature(ctx, c, o);
      // the thread between the hand and the creature, which breaks
      const p = app.ptr;
      if (this.it < 2.4 && p.present) {
        ctx.save();
        const u = clamp(this.it / 1.5, 0, 1);
        if (this.it < 1.5) {
          ctx.strokeStyle = R.INK(0.35 * (1 - u * 0.5)); ctx.lineWidth = 1 - u * 0.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
          ctx.quadraticCurveTo((p.x + b.pos.x) / 2, (p.y + b.pos.y) / 2 + 30 * u, b.pos.x, b.pos.y); ctx.stroke();
        } else {
          const k = clamp((this.it - 1.5) / 0.9, 0, 1);
          ctx.strokeStyle = R.INK(0.3 * (1 - k)); ctx.lineWidth = 0.6;
          const mx = (p.x + b.pos.x) / 2, my = (p.y + b.pos.y) / 2 + 40;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(lerp(mx, p.x, k), lerp(my, p.y, k) + 20 * k); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(b.pos.x, b.pos.y); ctx.lineTo(lerp(mx, b.pos.x, k), lerp(my, b.pos.y, k) + 20 * k); ctx.stroke();
        }
        ctx.restore();
      }
      cursorRing(app, ctx, 0);
    },
    exit(app) {
      const cv = R.renderSpecimen(app.creature, 240, { anim: app.life.anim, eyeOpen: () => 0.85, grain: 0.04 });
      app.creature.snapshots[4] = cv.toDataURL('image/jpeg', 0.8);
      app.cursor('default');
    },
  };

  /* =====================================================================
     STAGE 5 — ACKNOWLEDGMENT
     ===================================================================== */
  const Acknowledgment = {
    id: 5, name: 'Acknowledgment',
    enter(app) {
      const c = app.creature;
      const life = app.ensureLife();
      life.setMode('calm'); life.box = null; life.hold = false; life.forced = null;
      life.attendT = 0; life.attendPoint = null;
      this.relayout(app);
      this.t = 0; this.confirmed = false; this.nameA = 0; this.lastType = -99;
      const input = $('nameInput');
      input.value = c.name || '';
      $('naming').classList.add('on');
      $('nameLine1').classList.remove('show', 'gone'); $('nameLine2').classList.remove('show', 'gone');
      $('nameForm').classList.remove('show');
      const quick = !!c.name;
      UI.later('n1', quick ? 300 : 900, () => $('nameLine1').classList.add('show'));
      UI.later('n2', quick ? 900 : 3000, () => $('nameLine2').classList.add('show'));
      UI.later('n3', quick ? 1500 : 4600, () => {
        if (app.stage !== 5 || this.confirmed) return;
        $('nameForm').classList.add('show');
        if (app.ptr.kind === 'mouse') { try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); } }
      });
      UI.instruction(''); UI.hint('');
      app.cursor('default');
    },
    relayout(app) {
      const life = app.life;
      const reach = life.rext * app.S;
      life.zoomT = clamp(Math.min((app.H * 0.25) / reach, (app.W * 0.4) / reach), 0.12, 1.1);
      life.home = { x: app.W / 2, y: app.H * (app.W < 700 ? 0.36 : 0.37) };
    },
    typed(app) {
      if (this.confirmed) return;
      this.lastType = this.t;
      app.life.attendT = Math.min(1, app.life.attendT + 0.16);
      if (Math.random() < 0.35) FTS.audio.click(0.15);
    },
    confirm(app) {
      if (this.confirmed || app.stage !== 5 || app.transitioning) return;
      const input = $('nameInput');
      const v = input.value.replace(/\s+/g, ' ').trim().slice(0, 32);
      if (!v) {
        const f = $('nameForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
        return;
      }
      this.confirmed = true;
      app.creature.name = v;
      input.blur();
      FTS.audio.named();
      $('nameForm').classList.remove('show');
      $('nameLine1').classList.add('gone'); $('nameLine2').classList.add('gone');
      app.life.attendT = 1;
      app.save();
      UI.later('to6', 4200, () => { if (app.stage === 5) app.go(6); });
    },
    update(app, dt) {
      const life = app.life;
      this.t += dt;
      const r = $('nameInput').getBoundingClientRect();
      if (!this.confirmed) {
        life.attendPoint = r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: app.W / 2, y: app.H * 0.85 };
        if (this.t - this.lastType > 2.5) life.attendT = Math.max($('nameInput').value ? 0.45 : 0, life.attendT - dt * 0.15);
      } else {
        // after naming, it looks back toward the one who named it
        life.attendPoint = { x: app.W / 2, y: app.H * 0.6 };
        life.attendT = 0.85;
        this.nameA = Math.min(1, this.nameA + dt * 0.6);
      }
      life.reduced = app.reduced;
      life.update(dt, app.ptr, app);
    },
    draw(app, ctx) {
      const life = app.life;
      R.drawBackdrop(ctx, app.W, app.H, { lift: 0.85, cx: life.pos.x, cy: life.pos.y });
      const o = life.drawOpts(app); o.ambiguity = true;
      R.drawCreature(ctx, app.creature, o);
      if (this.nameA > 0 && app.creature.name) {
        const y = Math.min((life.lastBox ? life.lastBox.y1 : app.H * 0.6) + 46, app.H * 0.72);
        ctx.save();
        ctx.globalAlpha = this.nameA;
        ctx.font = 'italic 300 32px "Cormorant Garamond", "Iowan Old Style", Georgia, serif';
        ctx.textAlign = 'center'; ctx.fillStyle = R.INK(0.9);
        ctx.fillText(app.creature.name, app.W / 2, y);
        ctx.restore();
      }
    },
    exit() {
      $('naming').classList.remove('on');
      $('nameForm').classList.remove('show');
      $('nameLine1').classList.remove('show'); $('nameLine2').classList.remove('show');
      ['n1', 'n2', 'n3', 'to6'].forEach((k) => clearTimeout(UI._timers[k]));
    },
  };

  /* =====================================================================
     Shared terrarium scene (stages 6, 7 and the start of 8)
     ===================================================================== */
  function enclose(app, fresh) {
    const life = app.ensureLife();
    if (!app.terr) { app.terr = new FTS.Terrarium(); fresh = true; }
    const T = app.terr;
    if (fresh || T.open > 0) T.reset();
    T.layout(app, app.creature);
    life.setMode('contained');
    life.box = T.interior; life.boxSoft = !T.sealed;
    life.zoomT = T.zoom; life.hold = false; life.forced = null;
    life.attendT = 0; life.attendPoint = null; life.tapT = 0;
    return T;
  }
  function glassHandlers(app) {
    app.ptr.on('down', (e) => {
      const T = app.terr;
      if (!T || !T.hitGlass(e.x, e.y) || app.stage < 6 || app.stage > 7) return;
      T.tap(e.x, e.y, app.reduced);
      app.life.tap(e.x, e.y);
      FTS.audio.glassTap(clamp((e.x - (T.cx - T.halfW)) / (2 * T.halfW), 0, 1));
      app.creature.metrics.taps = (app.creature.metrics.taps || 0) + 1;
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* ignore */ } }
    });
  }
  function stepEnclosure(app, dt) {
    const T = app.terr, life = app.life;
    if (T.form < 1) T.form = Math.min(1, T.form + dt / (app.reduced ? 2 : 4.2));
    T.update(dt);
    life.boxSoft = !T.sealed;
    life.reduced = app.reduced;
    life.update(dt, app.ptr, app);
  }
  function drawEnclosure(app, ctx, lift = 0.85) {
    const T = app.terr, life = app.life;
    R.drawBackdrop(ctx, app.W, app.H, { lift, cx: T.cx, cy: T.cy });
    T.drawBack(ctx);
    T.drawShadow(ctx, life);
    const o = life.drawOpts(app); o.ambiguity = true; o.shadow = false;
    R.drawCreature(ctx, app.creature, o);
    T.drawFront(ctx);
    T.nameplate(ctx, app.creature.name);
    // the viewer's fingertip on the glass
    const p = app.ptr;
    if (p.present) {
      const onGlass = T.hitGlass(p.x, p.y);
      ctx.save();
      ctx.fillStyle = R.INK(0.8); ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fill();
      ctx.strokeStyle = R.INK(onGlass ? 0.35 : 0.16);
      ctx.beginPath(); ctx.arc(p.x, p.y, onGlass ? 9 : 16, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  /* =====================================================================
     STAGE 6 — CONTAINMENT
     ===================================================================== */
  const Containment = {
    id: 6, name: 'Containment',
    enter(app) {
      enclose(app, app.prevStage !== 7);
      app.decided = false;
      this.obs = 0;
      glassHandlers(app);
      if (app.terr.form < 1) FTS.audio.glassSlide();
      UI.instruction('');
      UI.hint('');
      UI.later('hint6', 4800, () => { if (app.stage === 6) UI.hint(app.ptr.kind === 'touch' ? 'come close to the glass · tap it · keep still' : 'approach the glass · tap it · keep still'); });
      app.cursor('none');
    },
    relayout(app) { const T = app.terr; T.layout(app, app.creature); app.life.box = T.interior; app.life.zoomT = T.zoom; },
    update(app, dt) {
      stepEnclosure(app, dt);
      if (app.terr.sealed) this.obs += dt;
      if (this.obs > 11 && app.stage === 6 && !app.transitioning) app.go(7, { seamless: true });
    },
    draw(app, ctx) { drawEnclosure(app, ctx); },
    exit() {},
  };

  /* =====================================================================
     STAGE 7 — THE DECISION
     ===================================================================== */
  const Decision = {
    id: 7, name: 'The Decision',
    enter(app) {
      const continuing = app.prevStage === 6 && app.terr && app.terr.open === 0;
      enclose(app, !continuing);
      app.decided = false;
      this.t = 0; this.shown = false; this.deferred = false;
      const rb = $('btnReady');
      rb.disabled = false; rb.style.setProperty('--p', 0); rb.classList.remove('holding');
      $('decision').classList.remove('show');
      $('btnAsk').hidden = true; $('btnAsk').classList.remove('show');
      glassHandlers(app);
      UI.instruction('');
      UI.hint('');
      app.cursor('none');
    },
    relayout: Containment.relayout,
    show() {
      this.shown = true; this.deferred = false;
      $('btnAsk').classList.remove('show'); $('btnAsk').hidden = true;
      $('decision').classList.add('show');
      $('holdHint').textContent = 'press and hold';
    },
    notYet(app) {
      if (app.stage !== 7 || app.decided) return;
      this.deferred = true;
      $('decision').classList.remove('show');
      FTS.audio.click(0.25);
      UI.later('ask', 1600, () => {
        if (app.stage !== 7 || !this.deferred) return;
        const a = $('btnAsk'); a.hidden = false; requestAnimationFrame(() => a.classList.add('show'));
      });
    },
    ready(app) {
      if (app.decided || app.stage !== 7 || app.transitioning) return;
      app.decided = true;
      $('btnReady').disabled = true;
      app.creature.metrics.releases = (app.creature.metrics.releases || 0) + 1;
      app.go(8, { seamless: true });
    },
    update(app, dt) {
      stepEnclosure(app, dt);
      this.t += dt;
      if (!this.shown && !this.deferred && app.terr.sealed && this.t > 1.2) this.show();
    },
    draw(app, ctx) { drawEnclosure(app, ctx, 0.78); },
    exit() {
      $('btnAsk').classList.remove('show'); $('btnAsk').hidden = true;
      clearTimeout(UI._timers.ask);
    },
  };

  /* =====================================================================
     STAGE 8 — CONFRONTATION
     ===================================================================== */
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const Confrontation = {
    id: 8, name: 'Confrontation',
    enter(app) {
      const life = app.ensureLife();
      if (!app.terr) enclose(app, true);
      const T = app.terr;
      T.form = 1;
      life.box = T.interior; life.boxSoft = false;
      this.t = 0; this.presence = 0; this.flags = {};
      $('decision').classList.remove('show');           // the question fades away
      ['final1', 'final2'].forEach((id) => $(id).classList.remove('show'));
      $('finaleActions').classList.remove('show');
      $('finale').classList.add('on');
      this.relayout(app);
      UI.instruction(''); UI.hint('');
      app.cursor('none');
    },
    relayout(app) {
      const life = app.life;
      const mobile = app.W < 700;
      // A comfortable but intimate distance, from the creature's actual
      // footprint per unit of zoom: large, but never filling the view.
      const e = life.extentPx, unit = life.zoom * life.scale;
      const w = e ? (e.x1 - e.x0) / unit : life.rext * app.S * 2, h = e ? (e.y1 - e.y0) / unit : life.rext * app.S * 2;
      const zt = app.terr ? app.terr.zoom : 0.5;
      const fit = Math.min((app.H * (mobile ? 0.5 : 0.6)) / h, (app.W * 0.72) / w);
      const hard = Math.min((app.H * 0.82) / h, (app.W * 0.92) / w);
      this.zFront = Math.min(hard, 3.2, Math.max(fit, zt * 1.35));
      this.front = { x: app.W / 2, y: app.H * (mobile ? 0.4 : 0.41) };
      if (life.mode === 'released') {
        life.zFront = this.zFront; life.front = this.front;
        life.box = { x0: 10, y0: mobile ? 96 : 66, x1: app.W - 10, y1: app.H - 14 };
      }
    },
    update(app, dt) {
      const T = app.terr, life = app.life, F = this.flags;
      this.t += dt;
      const t = this.t;
      // 1–2: the sound recedes (setStage 8) and the question fades (CSS)
      // 3: the walls retract into the floor, the lid lifts away
      if (t > 1.5 && !F.slide) { F.slide = true; FTS.audio.glassSlide(); }
      T.open = clamp((t - 1.5) / 3, 0, 1);
      // 4: it hesitates
      if (t > 4.4 && !F.hes) { F.hes = true; life.forced = 'hesitate'; life.hold = true; }
      // 5: released from its boundaries
      if (t > 6.6 && !F.rel) {
        F.rel = true;
        life.forced = null; life.hold = false;
        life.setMode('released');
        life.zBack = life.zoom; life.depth = 0; life.depthT = 0; life.approach = 0;
        this.relayout(app);
        life.boxSoft = true;
        FTS.audio.setStage(9);
        FTS.audio.breath(1, 0.8);
      }
      // 6–8: it slowly comes forward, growing through perspective, and stops
      if (F.rel) {
        life.approach = ease((t - 6.6) / (app.reduced ? 5 : 7));
        T.floorA = 1 - clamp((t - 7.5) / 4, 0, 1);
      }
      // 9: it observes and responds; the light rises while you stay
      if (t > 13) this.presence += dt;
      if (this.presence > 9 && !F.f1) { F.f1 = true; $('final1').classList.add('show'); }
      if (this.presence > 12.5 && !F.f2) { F.f2 = true; $('final2').classList.add('show'); }
      if (this.presence > 16 && !F.act) { F.act = true; $('finaleActions').classList.add('show'); }
      T.update(dt);
      life.reduced = app.reduced;
      life.update(dt, app.ptr, app);
    },
    draw(app, ctx) {
      const T = app.terr, life = app.life;
      const light = Math.min(this.presence / 45, 1);
      R.drawBackdrop(ctx, app.W, app.H, { lift: 0.82 + light * 1.1, cx: lerp(T.cx, life.pos.x, ease(this.t / 12)), cy: lerp(T.cy, life.pos.y, ease(this.t / 12)) });
      if (light > 0) {
        const g = ctx.createRadialGradient(app.W / 2, -app.H * 0.2, 0, app.W / 2, -app.H * 0.2, app.H * 1.3);
        g.addColorStop(0, R.INK(0.07 * light)); g.addColorStop(1, R.INK(0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, app.W, app.H);
      }
      if (T.floorA > 0.001) { T.drawBack(ctx); T.drawShadow(ctx, life); }
      const o = life.drawOpts(app); o.ambiguity = true; o.shadow = T.floorA < 0.6;
      R.drawCreature(ctx, app.creature, o);
      if (T.floorA > 0.001) T.drawFront(ctx);
      // the name stays with it
      const name = app.creature.name;
      if (name) {
        const k = ease((this.t - 9) / 3);
        if (k < 1) T.nameplate(ctx, name, 1 - k);
        if (k > 0 && life.lastBox) {
          ctx.save(); ctx.globalAlpha = k * 0.85;
          ctx.font = 'italic 300 24px "Cormorant Garamond", "Iowan Old Style", Georgia, serif';
          ctx.textAlign = 'center'; ctx.fillStyle = R.INK(0.8);
          ctx.fillText(name, life.pos.x, Math.min(life.lastBox.y1 + 34, app.H * 0.74));
          ctx.restore();
        }
      }
      cursorRing(app, ctx, 0);
    },
    exit(app) {
      $('finale').classList.remove('on');
      ['final1', 'final2'].forEach((id) => $(id).classList.remove('show'));
      $('finaleActions').classList.remove('show');
      if (app.life) { app.life.forced = null; app.life.hold = false; }
      if (app.terr) app.terr.floorA = 1;
      app.decided = false;
    },
  };

  /* =====================================================================
     App / stage manager
     ===================================================================== */
  const STAGES = { 1: Perception, 2: Discovery, 3: Distortion, 4: Presence, 5: Acknowledgment, 6: Containment, 7: Decision, 8: Confrontation };

  const App = {
    stage: 0, maxStage: 0, cur: null, transitioning: false, dirty: false, saveTimer: 0,
    life: null, terr: null, decided: false,
    init(p, canvas) {
      this.p = p; this.canvas = canvas; this.ctx = p.drawingContext;
      this.ptr = new FTS.PointerInput(canvas);
      const prefs = FTS.Persist.prefs();
      const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reduced = prefs.reduced != null ? prefs.reduced : !!(mq && mq.matches);
      FTS.audio.muted = !!prefs.muted;
      this.layout();
      this.creature = new FTS.Creature();
      this.bindUI();
      this.syncToggles();
      this.showIntro();
      this.last = performance.now();
      this.slow = 0;
    },
    layout() {
      this.W = window.innerWidth; this.H = window.innerHeight;
      const m = Math.min(this.W, this.H);
      this.S = m * (this.W < 700 ? 0.19 : 0.15);
      this.cx = this.W / 2; this.cy = this.H / 2 + this.H * 0.01;
      if (this.cur && this.cur.relayout && this.life) this.cur.relayout(this);
    },
    toLocal(x, y) { return { x: (x - this.cx) / this.S, y: (y - this.cy) / this.S }; },
    cursor(c) { this.canvas.style.cursor = c; },

    /* The living creature (one Behavior) persists from stage 4 to 8. */
    ensureLife() {
      const c = this.creature;
      if (!this.life || this.life.c !== c) {
        this.life = new FTS.Behavior(c, FTS.temperament(c.metrics, c), this);
        this.life.intro = 1;
      } else this.life.refresh();
      this.life.reduced = this.reduced;
      this.life.events = (e) => this.lifeEvent(e);
      return this.life;
    },
    lifeEvent(e) {
      const m = this.creature.metrics, A = FTS.audio;
      switch (e) {
        case 'breath': m.breaths++; A.breath(this.stage >= 5 ? 0.5 : 0.7, this.life.temp.tempo); break;
        case 'defend': m.defends++; A.hiss(); break;
        case 'retreat': m.retreats++; if (this.stage === 4) A.click(0.6); break;
        case 'investigate': m.investigations++; break;
        case 'click': A.click(this.stage >= 5 ? 0.45 : 0.8); break;
        case 'stretch': A.spawn('nodule'); break;
        case 'startle': A.click(0.35); break;
        default: break;
      }
    },

    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.perf(dt);
      const ctx = (this.ctx = this.p.drawingContext);
      this.ptr.update(dt, this.cur && this.stage < 5 ? this.creature.metrics : null);
      if (this.cur) { this.cur.update(this, dt); this.cur.draw(this, ctx); }
      else { R.drawBackdrop(ctx, this.W, this.H, { lift: 0.7 }); this.idleDraw(ctx, dt); }
      R.drawVignette(ctx, this.W, this.H, 0.7);
      R.drawGrain(ctx, this.W, this.H, 0.055, !this.reduced);
      this.saveTimer += dt;
      if (this.saveTimer > 4) { this.saveTimer = 0; if (this.creature.captured && (this.dirty || this.stage === 2 || this.stage === 3)) this.save(); }
    },
    idleDraw(ctx, dt) {
      this._it = (this._it || 0) + dt * (this.reduced ? 0.2 : 0.5);
      const c = this._ghost || (this._ghost = new FTS.Creature());
      for (let i = 0; i < N; i++) {
        const th = (i / N) * TAU;
        c.base[i] = 1 + 0.5 * c.noise.fbm(Math.cos(th), Math.sin(th), this._it, 3);
      }
      R.drawCreature(ctx, c, { x: this.cx, y: this.cy, S: this.S, alpha: 0.35, crisp: 0.2, ambiguity: false, shadow: false });
    },
    perf(dt) {
      if (dt > 0.03) this.slow++; else this.slow = Math.max(0, this.slow - 1);
      if (this.slow > 90 && this.p.pixelDensity() > 1) { this.p.pixelDensity(1); this.slow = 0; }
    },

    snapshot(s) {
      const cv = R.renderSpecimen(this.creature, 240, { grain: 0.04, eyeOpen: () => 0.85, ambiguity: s !== 1 });
      this.creature.snapshots[s] = cv.toDataURL('image/jpeg', 0.8);
    },
    save() {
      if (!this.creature.captured) return;
      const r = FTS.Persist.saveSession({ stage: this.stage, maxStage: this.maxStage, creature: this.creature.toJSON() });
      this.dirty = false;
      return r;
    },

    _swap(n, opts) {
      try { if (this.cur) this.cur.exit(this); } catch (err) { console.error(err); }
      this.prevStage = this.stage;
      this.stage = n;
      this.maxStage = Math.max(this.maxStage, n);
      this.cur = STAGES[n];
      STAGES[n]._nextShown = false;
      this.ptr.clearHandlers();
      this.ptr.enabled = true;
      this.cur.enter(this);
      UI.nav(n, this.maxStage);
      if (!opts.seamless && n <= 6) UI.title(n, this.cur.name);
      FTS.audio.setStage(n);
      this.save();
    },
    go(n, opts = {}) {
      if (this.transitioning || (n === this.stage && !opts.force)) return false;
      this.transitioning = true;
      UI.next(null); UI.instruction(''); UI.hint('');
      if (opts.seamless) {
        this._swap(n, opts);
        setTimeout(() => { this.transitioning = false; }, 400);
        return true;
      }
      const veil = $('veil');
      const fade = this.reduced ? 250 : 800;
      veil.classList.add('on');
      FTS.audio.transition();
      setTimeout(() => {
        this._swap(n, opts);
        veil.classList.remove('on');
        setTimeout(() => { this.transitioning = false; }, fade * 0.6);
      }, fade);
      return true;
    },

    resetAll() {
      FTS.Persist.clearSession();
      if (this.cur) { try { this.cur.exit(this); } catch (err) { console.error(err); } }
      this.cur = null; this.stage = 0; this.maxStage = 0;
      this.creature = new FTS.Creature();
      this.life = null; this.terr = null; this.decided = false;
      ['naming', 'finale'].forEach((id) => $(id).classList.remove('on'));
      $('decision').classList.remove('show');
      $('btnAsk').hidden = true;
    },
    async restart(ask = true) {
      if (this.transitioning) return;
      if (ask && this.creature.captured) {
        const ok = await UI.confirm('Let this creature dissolve and begin again?', 'begin again', 'stay');
        if (!ok) return;
      }
      this.resetAll();
      this.go(1, { force: true });
    },

    showIntro() {
      const sess = FTS.Persist.loadSession();
      const has = sess && sess.creature && sess.creature.captured;
      $('btnResume').hidden = !has;
      $('btnBegin').textContent = has ? 'begin anew' : 'begin';
      $('intro').classList.add('show');
      $('hud').classList.add('hidden');
    },
    hideIntro() { $('intro').classList.remove('show'); $('hud').classList.remove('hidden'); },

    syncToggles() {
      $('btnSound').textContent = FTS.audio.muted ? 'sound off' : 'sound on';
      $('btnSound').setAttribute('aria-pressed', String(!FTS.audio.muted));
      $('btnMotion').textContent = this.reduced ? 'motion reduced' : 'motion full';
      $('btnMotion').setAttribute('aria-pressed', String(this.reduced));
      document.documentElement.classList.toggle('reduced', this.reduced);
    },

    bindUI() {
      $('btnBegin').onclick = async () => {
        const sess = FTS.Persist.loadSession();
        if (sess && sess.creature && sess.creature.captured) {
          if (!(await UI.confirm('A creature is still waiting. Let it dissolve?', 'begin anew', 'stay'))) return;
        }
        FTS.audio.init();
        this.resetAll();
        this.hideIntro();
        this.go(1, { force: true });
      };
      $('btnResume').onclick = () => {
        const sess = FTS.Persist.loadSession();
        FTS.audio.init();
        try {
          this.creature = FTS.Creature.fromJSON(sess.creature);
          this.maxStage = Math.min(sess.maxStage || 2, 7);
          this.life = null; this.terr = null;
          this.hideIntro();
          // a released creature is resumed inside its terrarium: release is always a choice
          this.go(clamp(sess.stage === 8 ? 7 : sess.stage || 2, 2, 7), { force: true });
        } catch (err) {
          console.error(err); UI.toast('the creature could not be recovered');
        }
      };
      $('btnSound').onclick = () => {
        FTS.audio.init();
        FTS.audio.setMuted(!FTS.audio.muted);
        FTS.Persist.prefs({ muted: FTS.audio.muted });
        this.syncToggles();
      };
      $('btnMotion').onclick = () => {
        this.reduced = !this.reduced;
        FTS.Persist.prefs({ reduced: this.reduced });
        this.syncToggles();
      };
      $('btnRestart').onclick = () => this.restart(true);

      // stage 5 — naming
      $('nameForm').addEventListener('submit', (e) => { e.preventDefault(); Acknowledgment.confirm(this); });
      $('nameInput').addEventListener('input', () => Acknowledgment.typed(this));

      // stage 7 — press-and-hold to release (guards against accidental release)
      const rb = $('btnReady');
      const HOLD = 1300;
      let holdStart = 0, raf = 0;
      const stop = (reset) => { cancelAnimationFrame(raf); holdStart = 0; rb.classList.remove('holding'); if (reset) rb.style.setProperty('--p', 0); };
      const tick = () => {
        const p = Math.min(1, (performance.now() - holdStart) / HOLD);
        rb.style.setProperty('--p', p);
        if (p >= 1) { stop(false); Decision.ready(this); } else raf = requestAnimationFrame(tick);
      };
      const start = (e) => {
        if (e) e.preventDefault();
        if (rb.disabled || this.decided || this.stage !== 7 || holdStart) return;
        holdStart = performance.now(); rb.classList.add('holding');
        $('holdHint').textContent = 'keep holding';
        raf = requestAnimationFrame(tick);
      };
      rb.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => rb.addEventListener(ev, () => {
        if (holdStart) { stop(true); if (!this.decided) $('holdHint').textContent = 'press and hold'; }
      }));
      rb.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) start(); } });
      rb.addEventListener('keyup', (e) => { if ((e.key === ' ' || e.key === 'Enter') && holdStart) { stop(true); $('holdHint').textContent = 'press and hold'; } });
      rb.addEventListener('click', (e) => e.preventDefault());
      rb.addEventListener('contextmenu', (e) => e.preventDefault());
      $('btnNotYet').onclick = () => Decision.notYet(this);
      $('btnAsk').onclick = () => { if (this.stage === 7) Decision.show(); };

      // stage 8 — after the encounter
      $('btnBack').onclick = () => { if (this.stage === 8) this.go(6); };
      $('btnAgain').onclick = () => this.restart(true);

      document.querySelectorAll('#stageNav button').forEach((b) => {
        b.addEventListener('click', async () => {
          const s = +b.dataset.s;
          // 08 is only ever reached by choosing it in 07
          if (this.transitioning || s === this.stage || s > this.maxStage || !this.stage || s === 8) return;
          if (s === 1) {
            if (this.creature.captured && !(await UI.confirm('Return to 01? The shape will dissolve, along with everything that grew on it.', 'dissolve it', 'stay'))) return;
            this.resetAll();
            this.maxStage = 1;
            this.go(1, { force: true });
            return;
          }
          this.go(s);
        });
      });
      window.addEventListener('beforeunload', () => { if (this.creature && this.creature.captured) this.save(); });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.save(); if (FTS.audio.ctx) FTS.audio.ctx.suspend(); }
        else if (FTS.audio.ctx && this.stage) FTS.audio.ctx.resume();
      });
    },
  };

  FTS.App = App;
  FTS.UI = UI;
  FTS.Stages = STAGES;
})();

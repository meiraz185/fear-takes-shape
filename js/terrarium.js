/* ==========================================================================
   FEAR TAKES SHAPE — terrarium.js
   A pseudo-3D glass enclosure, sized to the creature that lives in it.

   Geometry: a box seen slightly from above. The front face is a screen
   rectangle; the back face is the front projected toward a vanishing point
   above the box (k = 0.84). The creature lives on the mid plane (k = 0.92),
   whose inset rectangle is the containment boundary.

   form  0→1  floor appears, walls rise, lid settles
   open  0→1  walls retract into the floor, lid lifts away (release)
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;
  const { clamp, lerp } = FTS.M;
  const INK = (a) => `rgba(234,229,219,${Math.max(0, a)})`;
  const SOOT = (a) => `rgba(3,3,3,${Math.max(0, a)})`;
  const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const KB = 0.84, KM = 0.92;

  class Terrarium {
    constructor() { this.reset(); }
    reset() {
      this.form = 0; this.open = 0; this.floorA = 1;
      this.ripples = []; this.shake = 0; this.t = 0; this.active = true;
    }
    get formed() { return this.form >= 1 && this.open <= 0; }
    get sealed() { return this.form >= 0.999 && this.open <= 0.001; }

    /* Fit the enclosure and the creature's display zoom to the viewport and
       to the creature's full reach (body + appendages at full extension). */
    layout(app, creature) {
      const W = app.W, H = app.H, mobile = W < 700;
      const top = mobile ? 112 : 80, bottom = mobile ? 262 : 236;
      const availH = Math.max(160, H - top - bottom);
      const halfH = availH / 2.4;
      const halfW = Math.min(W * (mobile ? 0.44 : 0.4), Math.max(halfH * 1.7, W * 0.3));
      const cx = W / 2, cy = top + halfH * 0.4 + halfH;
      this.vp = { x: cx, y: cy - halfH * 3.4 };
      Object.assign(this, { cx, cy, halfW, halfH, W, H });
      // containment rectangle on the creature's plane
      const a = this.proj(cx - halfW, cy - halfH, KM), b = this.proj(cx + halfW, cy + halfH, KM);
      this.interior = { x0: a.x + 10, y0: a.y + 10, x1: b.x - 10, y1: b.y - 6 };
      const iw = this.interior.x1 - this.interior.x0, ih = this.interior.y1 - this.interior.y0;
      const reach = creature.maxExtent() * app.S;          // px at zoom 1
      this.zoom = clamp(Math.min((ih * 0.5 * 0.94) / reach, (iw * 0.5 * 0.8) / reach), 0.12, 1.15);
      this.floorMidY = this.proj(cx, cy + halfH, KM).y;
      this.plateY = cy + halfH + (mobile ? 30 : 36);
      return this;
    }
    proj(x, y, k) { return { x: this.vp.x + (x - this.vp.x) * k, y: this.vp.y + (y - this.vp.y) * k }; }

    hitGlass(x, y) {
      if (!this.formed) return false;
      return x > this.cx - this.halfW - 14 && x < this.cx + this.halfW + 14 && y > this.cy - this.halfH - 14 && y < this.cy + this.halfH + 8;
    }
    tap(x, y, reduced) {
      this.ripples.push({ x, y, t: 0 });
      if (this.ripples.length > 6) this.ripples.shift();
      this.shake = reduced ? 0.25 : 1;
    }
    update(dt) {
      this.t += dt;
      for (const r of this.ripples) r.t += dt;
      this.ripples = this.ripples.filter((r) => r.t < 1.8);
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    offset() { return this.shake > 0 ? Math.sin(this.t * 70) * 3 * this.shake * this.shake : 0; }

    /* ---------------- back layers: floor, back & side panes, light ---------------- */
    drawBack(ctx, alpha = 1) {
      const { cx, cy, halfW, halfH } = this;
      const f1 = ease(this.form / 0.32), f2 = ease((this.form - 0.25) / 0.45);
      const op = ease(this.open);
      ctx.save();
      ctx.translate(this.offset(), 0);
      const fy = cy + halfH, ty = cy - halfH;
      const FL = { x: cx - halfW * f1, y: fy }, FR = { x: cx + halfW * f1, y: fy };
      const BL = this.proj(FL.x, fy, KB), BR = this.proj(FR.x, fy, KB);
      const fa = f1 * this.floorA * alpha;

      // atmospheric light from above
      if (f2 > 0) {
        const lt = this.proj(cx, ty, KB);
        const lg = ctx.createLinearGradient(0, lt.y - 40, 0, fy);
        lg.addColorStop(0, INK(0.05 * f2 * (1 - op) * alpha)); lg.addColorStop(1, INK(0));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(cx - halfW * 0.25, lt.y - 40); ctx.lineTo(cx + halfW * 0.25, lt.y - 40);
        ctx.lineTo(cx + halfW * 0.95, fy); ctx.lineTo(cx - halfW * 0.95, fy); ctx.closePath(); ctx.fill();
      }
      if (fa > 0.001) {
        // floor plane
        ctx.beginPath(); ctx.moveTo(FL.x, FL.y); ctx.lineTo(FR.x, FR.y); ctx.lineTo(BR.x, BR.y); ctx.lineTo(BL.x, BL.y); ctx.closePath();
        const g = ctx.createLinearGradient(0, BL.y, 0, fy);
        g.addColorStop(0, `rgba(30,29,27,${fa})`); g.addColorStop(1, `rgba(16,15,14,${fa})`);
        ctx.fillStyle = g; ctx.fill();
        // light pool
        ctx.save(); ctx.clip();
        const my = (BL.y + fy) / 2;
        const pg = ctx.createRadialGradient(cx, my, 0, cx, my, halfW * 0.8);
        pg.addColorStop(0, INK(0.08 * fa)); pg.addColorStop(1, INK(0));
        ctx.fillStyle = pg; ctx.fillRect(FL.x, BL.y, FR.x - FL.x, fy - BL.y);
        // fine grain lines on the floor (substrate)
        ctx.strokeStyle = INK(0.025 * fa); ctx.lineWidth = 1;
        for (let i = 1; i < 7; i++) {
          const y = lerp(BL.y, fy, (i / 7) ** 1.4);
          ctx.beginPath(); ctx.moveTo(FL.x - 10, y); ctx.lineTo(FR.x + 10, y); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = INK(0.14 * fa); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(BL.x, BL.y); ctx.lineTo(BR.x, BR.y); ctx.stroke();
      }
      // back pane + side panes
      const wa = f2 * (1 - op) * alpha;
      if (wa > 0.001) {
        const h = halfH * 2 * f2;
        const bTop = this.proj(cx, fy - h, KB).y, bBot = this.proj(cx, fy, KB).y;
        const bl = this.proj(cx - halfW, fy, KB).x, br = this.proj(cx + halfW, fy, KB).x;
        ctx.fillStyle = INK(0.012 * wa);
        ctx.fillRect(bl, bTop, br - bl, bBot - bTop);
        ctx.strokeStyle = INK(0.12 * wa); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bl, bBot); ctx.lineTo(bl, bTop); ctx.lineTo(br, bTop); ctx.lineTo(br, bBot); ctx.stroke();
        const slide = op * halfW * 0.3;
        for (const s of [-1, 1]) {
          const fx = cx + s * (halfW + slide), bx = s < 0 ? bl - slide * KB : br + slide * KB;
          const sg = ctx.createLinearGradient(fx, 0, bx, 0);
          sg.addColorStop(0, INK(0.035 * wa)); sg.addColorStop(1, INK(0.01 * wa));
          ctx.fillStyle = sg;
          ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - h); ctx.lineTo(bx, bTop); ctx.lineTo(bx, bBot); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = INK(0.1 * wa);
          ctx.beginPath(); ctx.moveTo(fx, fy - h); ctx.lineTo(bx, bTop); ctx.stroke();
        }
      }
      ctx.restore();
    }

    /* shadow beneath the creature, on the floor of its plane */
    drawShadow(ctx, life, alpha = 1) {
      const e = life.lastBox; if (!e) return;
      const w = (e.x1 - e.x0) * 0.42;
      const gap = Math.max(0, this.floorMidY - e.y1);
      const a = 0.55 * clamp(1 - gap / (this.halfH * 1.4), 0.15, 1) * this.floorA * ease(this.form / 0.32) * alpha;
      ctx.save(); ctx.translate(life.pos.x + this.offset(), this.floorMidY); ctx.scale(1, 0.16);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
      g.addColorStop(0, SOOT(a)); g.addColorStop(1, SOOT(0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    /* ---------------- front layers: front glass, edges, lid, ripples ---------------- */
    drawFront(ctx, alpha = 1) {
      const { cx, cy, halfW, halfH } = this;
      const f1 = ease(this.form / 0.32), f2 = ease((this.form - 0.25) / 0.45), f3 = ease((this.form - 0.65) / 0.35);
      const op = ease(this.open);
      ctx.save();
      ctx.translate(this.offset(), 0);
      const fy = cy + halfH;
      const x0 = cx - halfW, x1 = cx + halfW;
      // floor slab (front edge, with thickness)
      const fa = f1 * this.floorA * alpha;
      if (fa > 0.001) {
        const sx0 = cx - halfW * f1, sx1 = cx + halfW * f1;
        const sg = ctx.createLinearGradient(0, fy, 0, fy + 14);
        sg.addColorStop(0, `rgba(24,23,21,${fa})`); sg.addColorStop(1, `rgba(8,8,8,${fa})`);
        ctx.fillStyle = sg; ctx.fillRect(sx0, fy, sx1 - sx0, 14);
        ctx.strokeStyle = INK(0.32 * fa); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx0, fy + 0.5); ctx.lineTo(sx1, fy + 0.5); ctx.stroke();
      }
      // front pane: rises while forming, sinks into the floor when opening
      const wa = f2 * alpha;
      const paneH = halfH * 2 * f2 * (1 - op);
      const pTop = fy - paneH;
      if (wa > 0.001 && paneH > 1) {
        const gg = ctx.createLinearGradient(x0, pTop, x1, fy);
        gg.addColorStop(0, INK(0.05 * wa)); gg.addColorStop(0.5, INK(0.018 * wa)); gg.addColorStop(1, INK(0.04 * wa));
        ctx.fillStyle = gg; ctx.fillRect(x0, pTop, x1 - x0, paneH);
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, pTop, x1 - x0, paneH); ctx.clip();
        // reflections: two soft diagonal sheets and a thin specular streak
        const H2 = halfH * 2;
        const sheet = (u, w, a) => {
          const bx = x0 + (x1 - x0) * u;
          ctx.beginPath(); ctx.moveTo(bx, fy - H2 - 10); ctx.lineTo(bx + w, fy - H2 - 10);
          ctx.lineTo(bx + w - H2 * 0.45, fy + 10); ctx.lineTo(bx - H2 * 0.45, fy + 10); ctx.closePath();
          const rg = ctx.createLinearGradient(bx - H2 * 0.2, 0, bx + w, 0);
          rg.addColorStop(0, INK(0)); rg.addColorStop(0.5, INK(a * wa)); rg.addColorStop(1, INK(0));
          ctx.fillStyle = rg; ctx.fill();
        };
        sheet(0.2, halfW * 0.22, 0.05); sheet(0.36, halfW * 0.07, 0.04); sheet(0.78, halfW * 0.16, 0.025);
        ctx.strokeStyle = INK(0.09 * wa); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * 0.86, pTop + 14); ctx.lineTo(x0 + (x1 - x0) * 0.86 - 22, pTop + Math.min(paneH * 0.35, 120)); ctx.stroke();
        // ripples from taps
        for (const r of this.ripples) {
          const u = r.t / 1.8;
          for (let k = 0; k < 3; k++) {
            const rr = 6 + (u * 140 + k * 16) * (1 - k * 0.12);
            ctx.strokeStyle = INK(0.28 * (1 - u) * (1 - k * 0.3) * wa);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.ellipse(r.x, r.y, rr, rr * 0.82, 0, 0, Math.PI * 2); ctx.stroke();
          }
          const hg = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 30);
          hg.addColorStop(0, INK(0.12 * (1 - u) * wa)); hg.addColorStop(1, INK(0));
          ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(r.x, r.y, 30, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        // edges: bright hairline with a faint glow — the glass is visible by its edges
        for (const x of [x0, x1]) {
          ctx.strokeStyle = INK(0.05 * wa); ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(x, pTop); ctx.stroke();
          ctx.strokeStyle = INK(0.5 * wa); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(x, pTop); ctx.stroke();
        }
        ctx.strokeStyle = INK(0.38 * wa); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, pTop + 0.5); ctx.lineTo(x1, pTop + 0.5); ctx.stroke();
      }
      // lid
      const la = f3 * (1 - op) * alpha;
      if (la > 0.001) {
        const lift = (1 - f3) * 60 + op * 90;
        const ty = cy - halfH - lift;
        const A = { x: x0, y: ty }, B = { x: x1, y: ty }, C = this.proj(x1, cy - halfH, KB), D = this.proj(x0, cy - halfH, KB);
        C.y -= lift; D.y -= lift;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath();
        ctx.fillStyle = INK(0.035 * la); ctx.fill();
        ctx.strokeStyle = INK(0.32 * la); ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = INK(0.07 * la); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      ctx.restore();
    }

    nameplate(ctx, name, alpha = 1) {
      if (!name) return;
      ctx.save();
      ctx.globalAlpha = alpha * ease(this.form / 0.4) * this.floorA;
      ctx.font = 'italic 300 22px "Cormorant Garamond", "Iowan Old Style", Georgia, serif';
      ctx.textAlign = 'center'; ctx.fillStyle = INK(0.75);
      ctx.fillText(name, this.cx + this.offset(), this.plateY);
      ctx.restore();
    }
  }

  FTS.Terrarium = Terrarium;
})();

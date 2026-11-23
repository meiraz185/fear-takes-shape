/* ==========================================================================
   FEAR TAKES SHAPE — audio.js
   Generated organic ambience (Web Audio API). No samples.
   Drone + breathing noise bed + whisper band, and one-shot organic events.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;

  const A = {
    ctx: null, master: null, muted: false, ready: false,
    nodes: {},

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(comp); comp.connect(ctx.destination);

      // noise buffers
      const len = ctx.sampleRate * 3;
      const brown = ctx.createBuffer(1, len, ctx.sampleRate), white = ctx.createBuffer(1, len, ctx.sampleRate);
      const bd = brown.getChannelData(0), wd = white.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        wd[i] = w;
        last = (last + 0.02 * w) / 1.02; bd[i] = last * 3.5;
      }
      this.brown = brown; this.white = white;
      const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; };
      const N = this.nodes;

      // drone
      N.droneGain = ctx.createGain(); N.droneGain.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 2;
      [[41.2, 'sine', 0.5], [61.9, 'sine', 0.35], [82.7, 'triangle', 0.12], [55.1, 'sine', 0.2]].forEach(([f, t, g]) => {
        const o = ctx.createOscillator(); o.type = t; o.frequency.value = f; o.detune.value = Math.random() * 12 - 6;
        const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(lp); o.start();
      });
      lp.connect(N.droneGain); N.droneGain.connect(this.master);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = ctx.createGain(); lfoG.gain.value = 60; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
      N.droneFilter = lp;

      // breathing bed
      N.bedGain = ctx.createGain(); N.bedGain.gain.value = 0;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.8;
      loop(brown).connect(bp); bp.connect(N.bedGain); N.bedGain.connect(this.master);
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.045;
      const lfo2G = ctx.createGain(); lfo2G.gain.value = 110; lfo2.connect(lfo2G); lfo2G.connect(bp.frequency); lfo2.start();

      // whisper band (follows the light / cursor)
      N.whisperGain = ctx.createGain(); N.whisperGain.gain.value = 0;
      N.whisperBP = ctx.createBiquadFilter(); N.whisperBP.type = 'bandpass'; N.whisperBP.frequency.value = 2200; N.whisperBP.Q.value = 7;
      loop(white).connect(N.whisperBP); N.whisperBP.connect(N.whisperGain); N.whisperGain.connect(this.master);

      // creak (tension during manipulation)
      N.creakGain = ctx.createGain(); N.creakGain.gain.value = 0;
      N.creakBP = ctx.createBiquadFilter(); N.creakBP.type = 'bandpass'; N.creakBP.frequency.value = 500; N.creakBP.Q.value = 18;
      const am = ctx.createGain(); am.gain.value = 0.5;
      const amO = ctx.createOscillator(); amO.type = 'square'; amO.frequency.value = 23;
      const amG = ctx.createGain(); amG.gain.value = 0.5; amO.connect(amG); amG.connect(am.gain); amO.start();
      N.creakOsc = amO;
      loop(brown).connect(N.creakBP); N.creakBP.connect(am); am.connect(N.creakGain); N.creakGain.connect(this.master);

      // glass resonance (containment): two inharmonic partials with slow tremolo
      N.glassGain = ctx.createGain(); N.glassGain.gain.value = 0;
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      [[1046.5, 0.5], [1571.3, 0.3], [2093.9, 0.12]].forEach(([f, g]) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = Math.random() * 6 - 3;
        const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(trem); o.start();
      });
      const tl = ctx.createOscillator(); tl.frequency.value = 0.18;
      const tlg = ctx.createGain(); tlg.gain.value = 0.4; tl.connect(tlg); tlg.connect(trem.gain); tl.start();
      trem.connect(N.glassGain); N.glassGain.connect(this.master);

      this.ready = true;
      if (this._stage) this.setStage(this._stage);
    },

    set(param, v, tc = 0.6) { if (!this.ctx) return; param.setTargetAtTime(v, this.ctx.currentTime, tc); },

    setStage(n) {
      this._stage = n;
      if (!this.ready) return;
      const N = this.nodes;
      // [drone, breathing bed, whisper, glass resonance, drone filter]
      const lv = {
        0: [0.05, 0.03, 0, 0, 160], 1: [0.16, 0.06, 0.004, 0, 160], 2: [0.1, 0.035, 0.012, 0, 120],
        3: [0.13, 0.05, 0.004, 0, 160], 4: [0.18, 0.09, 0.003, 0, 210],
        5: [0.1, 0.05, 0.001, 0, 180],              // acknowledgment: quieter, closer
        6: [0.12, 0.045, 0, 0.0055, 150],           // containment: glass resonance enters
        7: [0.075, 0.03, 0.002, 0.004, 120],        // decision: everything draws in
        8: [0.02, 0.012, 0, 0.0012, 100],           // release, step 1: ambient falls away
        9: [0.14, 0.075, 0, 0, 300],                // released: open, warmer
      }[n] || [0.08, 0.03, 0, 0, 160];
      const tc = n === 8 ? 1.4 : n === 9 ? 3 : 1.2;
      this.set(N.droneGain.gain, lv[0], tc);
      this.set(N.bedGain.gain, lv[1], tc);
      this.set(N.whisperGain.gain, lv[2], tc);
      this.set(N.glassGain.gain, lv[3], tc);
      this.set(N.droneFilter.frequency, lv[4], 2);
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.set(this.master.gain, m ? 0 : 0.85, 0.15);
    },

    /* continuous controls */
    light(speedN) {
      if (!this.ready || this._stage !== 2) return;
      this.set(this.nodes.whisperGain.gain, 0.008 + Math.min(speedN, 2) * 0.02, 0.2);
      this.set(this.nodes.whisperBP.frequency, 1600 + Math.min(speedN, 2) * 900, 0.3);
    },
    tension(v) { // 0..1
      if (!this.ready) return;
      this.set(this.nodes.creakGain.gain, Math.min(v, 1) * 0.22, 0.08);
      this.set(this.nodes.creakBP.frequency, 300 + v * 900, 0.1);
      this.set(this.nodes.creakOsc.frequency, 14 + v * 30, 0.1);
    },
    hum(v) { // stabilisation in stage 1: drone opens up
      if (!this.ready) return;
      this.set(this.nodes.droneFilter.frequency, 140 + v * 260, 0.15);
    },

    /* one-shots */
    _noiseShot(dur, type, f0, f1, q, peak, attack = 0.01, buf) {
      const ctx = this.ctx, t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = buf || this.white;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
    },
    _tone(dur, f0, f1, peak, type = 'sine') {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    },
    click(intensity = 1) {
      if (!this.ready) return;
      const f = 1200 + Math.random() * 2600;
      this._noiseShot(0.03 + Math.random() * 0.04, 'bandpass', f, f * 0.7, 9, 0.12 * intensity, 0.002);
    },
    capture() {
      if (!this.ready) return;
      this._tone(1.2, 78, 34, 0.5);
      this._noiseShot(0.6, 'lowpass', 400, 60, 1, 0.35, 0.005, this.brown);
    },
    spawn(kind) {
      if (!this.ready) return;
      if (kind === 'eye') {
        this.click(1.2); setTimeout(() => this.click(0.8), 70);
        this._tone(0.35, 190, 85, 0.12);
      } else if (kind === 'tendril') {
        this._noiseShot(0.7, 'bandpass', 260, 1300, 4, 0.16, 0.12, this.brown);
        this._tone(0.6, 70, 120, 0.06, 'triangle');
      } else if (kind === 'texture') {
        for (let i = 0; i < 10; i++) setTimeout(() => this.click(0.6), i * 35 + Math.random() * 40);
      } else {
        this._noiseShot(0.25, 'bandpass', 700, 300, 3, 0.1, 0.02, this.brown);
      }
    },
    bud() { if (this.ready) { this._tone(0.5, 140, 220, 0.08, 'triangle'); this.click(0.7); } },
    breath(strength = 1, rate = 1) {
      if (!this.ready) return;
      const d = 1.3 / rate;
      this._noiseShot(d, 'bandpass', 420, 950, 1.3, 0.07 * strength, d * 0.55, this.brown);
      setTimeout(() => { if (this.ready) this._noiseShot(d * 1.2, 'bandpass', 900, 380, 1.1, 0.05 * strength, d * 0.2, this.brown); }, d * 1000);
    },
    hiss() {
      if (!this.ready) return;
      this._noiseShot(0.65, 'highpass', 3200, 2000, 0.7, 0.16, 0.03);
      this._tone(0.4, 120, 60, 0.12, 'sawtooth');
    },
    named() {   // soft, low chime when the creature is named
      if (!this.ready) return;
      [[392, 0.05, 2.6], [587.3, 0.03, 2.2], [784, 0.018, 1.8]].forEach(([f, g, d], i) => {
        setTimeout(() => this.ready && this._tone(d, f, f * 0.995, g), i * 90);
      });
      this.breath(0.5, 0.8);
    },
    glassTap(x = 0.5) {
      if (!this.ready) return;
      const k = 0.9 + x * 0.2;
      [[2210 * k, 0.045, 0.9], [3390 * k, 0.025, 0.6], [5160 * k, 0.012, 0.35]].forEach(([f, g, d]) => this._tone(d, f, f * 0.998, g));
      this._tone(0.35, 150, 95, 0.07);
      this.click(0.5);
    },
    glassSlide() {
      if (!this.ready) return;
      this._noiseShot(2.8, 'bandpass', 2400, 500, 6, 0.035, 0.8);
      this._tone(3, 82, 62, 0.05);
    },
    shimmer() { if (this.ready) this._noiseShot(0.5, 'bandpass', 3000, 1800, 12, 0.05, 0.1); },
    transition() { if (this.ready) this._noiseShot(1.6, 'lowpass', 900, 80, 0.7, 0.12, 0.4, this.brown); },
  };

  FTS.audio = A;
})();

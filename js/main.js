/* ==========================================================================
   FEAR TAKES SHAPE — main.js
   p5.js bootstrap (instance mode). The sketch owns the canvas and the
   frame loop; FTS.App owns everything else.
   ========================================================================== */
(function () {
  'use strict';
  const FTS = window.FTS;

  new p5((p) => {
    p.setup = () => {
      const cnv = p.createCanvas(window.innerWidth, window.innerHeight);
      cnv.parent('stage');
      p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      p.frameRate(60);
      FTS.App.init(p, cnv.elt);
    };
    p.draw = () => {
      // p5 resets the transform to the pixel-density scale every frame;
      // all drawing happens in CSS pixels on the 2D context.
      FTS.App.frame();
    };
    p.windowResized = () => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      FTS.App.layout();
    };
  });
})();

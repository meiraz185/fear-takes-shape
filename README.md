# FEAR TAKES SHAPE — v2: Facing the Monster

An experimental interactive piece about the fear of the unknown. You give a shapeless thing a body, discover and distort it, and watch it come alive. Then you name it, contain it, and decide whether to face it.

v2 keeps stages 01–04 of v1 as they are. The v1 Documentation stage and its specimen archive are gone, replaced by four new stages. v1 stays untouched in `../v1`.

## Run

- **GitHub Pages:** push this folder and enable Pages. All paths are relative, and p5.js is bundled.
- **Locally:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.

## Stages

| | Stage | |
|---|---|---|
| 01 | Perception | Hold for about 2 s to still the morphing mass and capture its silhouette. |
| 02 | Discovery | Flashlight exploration. Linger → eyes. Drag outward → limbs. Small circles → skin textures. Sweeping the same edge repeatedly → nodules and bristles. |
| 03 | Distortion | Pull, bend, swell (scroll or pinch). Hold a part, then drag, to split it. |
| 04 | Presence | The creature becomes autonomous. |
| 05 | Acknowledgment | *"You gave it a shape. / Now give it a name."* It turns its attention toward you while you type. The name is stored on the creature, confirmed with a soft chime and shown beneath it. |
| 06 | Containment | A glass terrarium forms around it: floor, then walls, then lid. It follows you along the glass, watches when you keep still, and reacts to a tap with a ripple, a vibration and a sound. The cursor can no longer touch it. |
| 07 | The Decision | *"Are you ready to face your monster?"* **Not yet** keeps it contained, and the question stays reachable from a discreet link. **I'm ready** must be pressed and held for about 1.3 s, so a stray click can't release it, and it can only fire once. |
| 08 | Confrontation | The sound recedes, the question fades, and the walls sink into the floor while the lid lifts away. The creature hesitates, then slowly comes forward and grows through perspective until it stops at an intimate distance. It watches, backs away if you come close, and edges closer when you keep still, while the light slowly rises. *"The monster hasn't changed. / But the unknown is no longer unknown."* You can then return to the terrarium or begin again. |

## Structure

```
js/procedural.js   seeded RNG, noise, feature generators
js/creature.js     persistent creature model (geometry, features, name) + reach / pose extent
js/render.js       ink / charcoal / membrane rendering
js/interaction.js  pointer, touch, pinch, wheel, gestures
js/behavior.js     temperament + autonomous behaviour: free / calm / contained / released, containment physics
js/terrarium.js    pseudo-3D glass enclosure: formation, release, reflections, ripples, shadow
js/audio.js        generated sound; separate states for containment, decision and release
js/persistence.js  saves the creature in progress and your sound / motion settings
js/stages.js       the eight stages, transitions, UI
js/main.js         p5.js bootstrap
```

## Containment

The terrarium and the creature's display scale come from the creature's full **reach**. That is the furthest any part can travel across every bend, curl, reach, breath and stretch the behaviour system can produce, so creatures of any size or limb count fit. Every frame, the exact pose (body plus every appendage, after rotation and scale) is held inside the glass. The boundary only comes off at step 5 of the release.

## Safeguards

- Progress is autosaved. A creature that was resumed always comes back inside its terrarium, because release is always a choice.
- Restarting or returning to 01 asks for confirmation first.
- Stage 08 can't be reached from the indicator; you have to choose it in stage 07.
- Mute and reduced-motion settings are remembered.

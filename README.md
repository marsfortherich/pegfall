# PEGFALL

A plinko **roguelite** that runs in the browser. No build step, no dependencies.

```
open index.html
```

Double-click `index.html`, or serve the folder (`python -m http.server 8123`) and visit
<http://localhost:8123>.

## The loop

Each **floor** is a peg board with a **score target**. You draw a hand of balls from your bag and
drop them one at a time, aiming the drop point yourself.

```
ballScore = ballValue x slotMultiplier
```

A ball starts at its type's value and *grows as it falls* — every peg it clips adds value, gold pegs
add a lot, charged pegs add to its slot multiplier. Where it lands decides what that accumulated
value is worth: the outer slots pay 10x, the centre pays 0.8x.

Clear the target and you reach the shop. Miss it and the run is over.

## What makes it a roguelite

- **Bag building.** You start with 6 Standards, a Bouncy and a Heavy. The shop sells stranger balls —
  Splitter (becomes two balls mid-fall), Bomb (shatters pegs for value), Ghost (phases past the first
  six pegs), Magnet (drifts toward the best-paying slot), Void (worthless until it hits pegs).
- **22 relics** that rewrite the rules and stack with each other: gold pegs, bumpers, momentum that
  makes each peg worth more than the last, slot-multiplier surgery, multiball, revives.
- **Floor modifiers** from floor 3 on: void slots, fog over the payouts, slick pegs, closing walls,
  rust, extra peg rows.
- **Boss floors** every 5th floor — THE INVERSION flips the payout curve, THE GAUNTLET gives you three
  balls and triple pegs, THE CAGE fills the board with bumpers and voids every third slot.
- **Seeded runs.** Every run has a seed; type one on the menu to replay it exactly.
- **Meta progression** in localStorage: reaching floors 3/5/7/9 unlocks the Bomb, Ghost, Magnet and
  Void balls for future runs.

## Controls

| | |
|---|---|
| Click the board | aim and drop |
| Space | drop again at the same spot |
| Arrow keys | nudge the aim (hold Shift for fine) |
| Enter | bank a cleared floor early (unused balls pay gold) |

Once a floor's target falls you do **not** have to drop the rest of your hand.
The hand bar turns green and every unused ball converts to gold when you bank.
Keep dropping only if you want the overspill bonus, which scales the shop payout
with how far past the target you finish.

## Code map

| File | What's in it |
|---|---|
| `js/rng.js` | seeded mulberry32 RNG + weighted picks |
| `js/content.js` | every ball, peg, relic, modifier and boss — all as data with hook functions |
| `js/board.js` | board geometry and peg lattice generation |
| `js/physics.js` | gravity, walls, circle-vs-peg collisions, substepping |
| `js/game.js` | run state machine, scoring, shop, relic hook dispatch |
| `js/render.js` | canvas drawing, trails, particles, popups |
| `js/ui.js` | DOM HUD, shop, overlays, tooltips |
| `js/save.js` | localStorage meta progression |
| `js/settings.js` | sound and volume preferences, kept apart from run state |
| `js/audio.js` | every sound, synthesised at runtime — no audio files |
| `js/main.js` | canvas sizing, input, fixed-timestep loop |

### Adding content

Relics are plain objects in `js/content.js`. They opt into any of these hooks:

```js
{
  id: 'peg_collector', name: 'Peg Collector', rarity: 'common', cost: 5,
  desc: 'Every peg is worth +2 extra value.',
  onPegHit: function (G, ball) { ball.value += 2; }
}
```

`handSize(G, n)`, `slotMults(G, mults)`, `onFloorStart(G, board, api)`, `onBallSpawn(G, ball, api)`,
`onPegHit(G, ball, peg, api)`, `onSlot(G, ball, slot, ctx)`, `onBallScored(G, ball, ctx)`,
`onFloorEnd(G, ctx)`. Add the object to the `RELICS` array and it enters the shop pool immediately.

## Balance

Tuned against a headless harness that plays whole runs (see `DESIGN.md`). A greedy bot that aims at
the best-paying slot dies around floor 8–10; aiming well beats aiming at the centre by roughly two
floors, and floor 1 is cleared ~95% of the time even playing badly.

## Part of the Roguelike Arcade

PEGFALL shares a design system, a sign-in and a leaderboard with the other games
in the arcade. That layer lives in `shared/` and is a synced copy — edit the
canonical one at the arcade root and run `python tools/sync-shared.py`. See
`ARCADE.md` at the arcade root for the full picture, including Firebase setup.

Without a Firebase config the arcade reports "Offline" and the game plays exactly
as it always has, entirely from `localStorage`.

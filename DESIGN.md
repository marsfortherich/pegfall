# PEGFALL — a Plinko Roguelite

## Core loop
1. **Floor** — a board with pegs, slots, and (later) modifiers. It has a **target score**.
2. You **draw a hand** of balls from your **bag**, and drop them one at a time, aiming the x-position.
3. Balls bounce down, collecting value from pegs, and land in a slot which **multiplies** that value.
4. Beat the target -> earn gold -> **shop** -> next floor (higher target).
5. Miss the target -> run ends (unless a relic saves you).

## Scoring
```
ballScore = round(ballValue * slotMultiplier * globalMultiplier)
```
- `ballValue` starts from the ball type and grows during the fall (pegs, gold pegs, relics).
- `slotMultiplier` is the slot's printed value, modified by relics/floor modifiers.
- `globalMultiplier` comes from relics.

## Board
- 11 rows of staggered pegs (11/10 alternating), 11 slots at the bottom.
- Base slot multipliers: `10 5 2.5 1.2 0.8 0.5 0.8 1.2 2.5 5 10` (edges pay, center is safe-but-poor).
- Peg types: **normal**, **gold** (+value), **charged** (+slot mult for that ball), **bumper** (big bounce, big value), **brittle** (breaks, pays out).

## Balls (bag / deckbuilding)
You start with 6 Standard balls. The shop sells more; each floor you draw `handSize` from the shuffled bag,
so the bag's composition is the build. Types: Standard, Heavy, Bouncy, Splitter, Bomb, Ghost, Magnet, Lucky.

## Relics
Passive rule-rewrites (extra draws, gold pegs, momentum stacking, edge bonuses, multiball, revives, ...).
Owned relics are always active and stack.

## Floors
- `target(f) = round(90 * 1.4^(f-1))`, boss floors (every 5th) are +30% and always carry a modifier.
- From floor 3, each floor rolls a **modifier** (void slot, slick pegs, fog, narrow walls, tax...).

## Economy
- Round payout: base 4 gold + 1 per unused ball + up to 4 overkill bonus.
- Shop: 3 offers, reroll costs 2 gold, prices 4-10.

## Meta progression
localStorage: best floor, total runs, lifetime score. Milestones unlock extra starting relics/ball types.

## Files
- `index.html` / `css/style.css` — shell + UI
- `js/rng.js` — seeded RNG (mulberry32)
- `js/content.js` — balls, relics, peg types, floor modifiers, shop tables
- `js/physics.js` — ball simulation & collisions
- `js/board.js` — board generation
- `js/game.js` — run state machine, scoring, shop logic
- `js/render.js` — canvas drawing, particles, popups
- `js/ui.js` — DOM HUD, shop, tooltips, overlays
- `js/save.js` — localStorage meta
- `js/main.js` — bootstrap + game loop

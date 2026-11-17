# Nimble Initiative (Owlbear Rodeo extension)

Initiative tracker for Nimble 2e in Owlbear Rodeo.

- 3 action pips per entry: ready, spent, reaction, and "not yet" for heroes who rolled low.
- Hero initiative: Hesitant (1-9, 1 action), Ready (10-19, 2 actions), Vigilant (20+, 3 actions). Monsters always start with 3.
- Drag to reorder (GM). Heroes go first by default.
- Right-click tokens: Add to Nimble Initiative, Add as Minion Group, Mark as Hero (remembered by token image across scenes).
- Auto movement: when the token whose turn it is moves on the map, the spaces are taken off its movement, and a new Move action is spent automatically when it runs out. Minion groups count their furthest minion. Shoves and GM repositioning off-turn don't count.
- Manual control: Move button, -/+ to adjust spaces left, and a speed box per entry for spaces per Move. Auto movement can be switched off.
- End turn refills actions; reactions taken off-turn stay spent until the end of your next turn.

Install in Owlbear: Profile > Extensions > Add Custom Extension, and paste
`https://sefiaaty.github.io/nimble-initiative/manifest.json`

Build: `npm install && ./build.sh`
Icons: game-icons.net (CC BY 3.0).

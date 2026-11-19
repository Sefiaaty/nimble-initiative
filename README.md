# Nimble Initiative (Owlbear Rodeo extension)

Initiative tracker for Nimble 2e in Owlbear Rodeo.

## Turns
- Heroes act in any order: click **Take turn** on whoever is ready, or let the GM press **Next** (heroes first, then monsters).
- The GM can let a monster **Act now** at any point, for an ambush or a monster that has to go first.
- Heroes: 3 action pips, starting with Hesitant (1-9, 1 action), Ready (10-19, 2) or Vigilant (20+ or a natural 20, 3).
- Reactions: Defend, Interpose, Opportunity Attack and Help markers. Each is once per round, and using one spends an action from that hero's next turn. They reset when the hero's own turn ends.
- Monsters follow the book: they move up to their Speed and use their stat block's actions (1-3 pips), with no reactions.
- Legendary monsters act after **each** hero's turn: the tracker pauses on a "Legendary acts" step with a **Done** button.
- Minion groups act together. The GM sees a coloured ring under each minion and dashed lines linking the group (only the GM sees them).

## Monsters from nimble.nexus
- **Monster Library** tab (GM): load the Game Master's Guide monsters from nimble.nexus in one click, or paste any nimble.nexus monster link.
- Right-click a token > **Link Nimble Monster**, or select tokens and press **Link** / **Link + Add** in the library. The stat block is saved on the token, so copies of the token are linked too.
- Linked monsters fill in HP (legendary HP per hero scales with the party), armor, Speed, number of actions, and minion/legendary type. Click ≡ for the stat block.
- HP tracking with Bloodied and Last Stand markers. The library lives in the GM's browser; Export/Import moves it between computers.

## Also
- Right-click tokens: Add to Nimble Initiative, Add as Minion Group, Mark as Hero (remembered by token image across scenes).
- Auto movement measures moves for whoever is acting. Heroes spend Move actions automatically when they run out.
- Drag to reorder (GM).

Install in Owlbear: Profile > Extensions > Add Custom Extension, and paste
`https://sefiaaty.github.io/nimble-initiative/manifest.json`

Build: `npm install && ./build.sh`
Icons: game-icons.net (CC BY 3.0). Monster data: nimble.nexus (read live from its public API).

# UX pattern palette — Data Forge edition

Mined 2026-07-13 from seven mobile todo/note apps (Notion, Todoist, Google
Tasks, Google Keep, Obsidian, TickTick, Capacities), extracted into named
patterns, and judged against Data Forge's TEMPERED identity by a fresh-eyes
review seat. Full evidence chain: `.claude/output/20260713-app-ux-research/`
(dossiers → patterns.md → review.md). A generalized, app-agnostic copy lives
in gcc: `~/.claude/conventions/mobile-ux-pattern-palette.md`.

How to use: this is a pick-list. Each entry carries its verdict — ADOPT and
ADAPT items are the build menu; ALREADY items are guards against regression;
ANTI items are standing refusals.

## Workflow blocks (patterns composed into a way of working)

1. **Two-speed data entry** — capture parses, editing picks. The fast lane
   (capture ▮) accepts typed `#tag` / dates / priority and renders each as a
   dashed tap-to-un-parse chip; the slow lane (editor) keeps pickers. Never
   let a required decision into the fast lane. [A2 ADOPT · A4/A5/A7 ALREADY]
2. **The triage economy** — the two highest-frequency decisions (done,
   later) get single-motion gestures; everything else can afford a picker.
   Swipe left = archive, right = snooze-with-presets, glyph+word action
   backgrounds, undo net instead of confirm. Two fixed verbs, no config
   matrix. [C1 ADOPT · C2/C7 ALREADY]
3. **Overdue as a ritual, not a pile** — a guided one-at-a-time "Plan" walk
   over overdue+today reusing the snooze presets; the pile becomes a
   designed moment. [C3 ADOPT · D3 ALREADY]
4. **Capture from anywhere** — Web Share Target + manifest shortcuts now
   (share-sheet + long-press-icon capture without the app open); native
   widgets that DO (inline check-off, inline capture) at the Android
   milestone. [A1 ADAPT · H1/H2 LATER]
5. **The trust spine** — sync state always visible and named (readout),
   capture never blocked or degraded offline, conflicts preserved whole and
   presented with preview + copy-out. [G1/G3 ALREADY · G2 ADAPT]
6. **Bursty capture** — quick-add stays open after save: ● Saved flash,
   field clears, focus and axes stay. [A3 ADOPT]
7. **Batch as a mode** — long-press → multi-select → a contextual command
   bar (archive/tag/delete); same selection model drives desktop
   shift-select + the j/k loop. [C4 ADOPT]

## Display patterns

- **State rides the action affordance** — priority/status colors the
  completion control itself, not a separate badge. [B1 ADAPT — importance
  tint on DF's complete box, color never sole carrier]
- **Previews render state, not text** — ☐/☑ glyphs, struck-done items
  demoted, canvas size shown. [B2 ALREADY — §6d]
- **Done is a counted, collapsed receipt** — completed items in a demoted
  expandable group with a count. [B3 ADOPT for agenda/done rows]
- **One color, one alarm** — the fewer hues speak, the louder overdue-red
  is. [B4 ALREADY — TEMPERED contract 1]
- **The clock outranks importance in day views** — timed items sort above
  high-priority undated ones today. [B5 ADAPT — verify agenda ordering]
- **Views are cheap, chrome is expensive** — saved queries as first-class
  chips with show-if-not-empty visibility. [B6 ADOPT · X2 guard: never bury
  a first-class structure behind a favoriting gate]
- **Kind shows as a mark, not a schema** — ▨ CANVAS-style glyphs; refuse
  per-type object schemas that fight files-as-truth. [B7 ADAPT]

## Interaction patterns

- **Completion is a micro-moment** — check-draw + `navigator.vibrate()`;
  the most-repeated interaction rewards the loop's end. [C6 ADOPT]
- **Slash-insertion on touch** — a `/` menu for blocks + canvas insert;
  power syntax and touch coexist. [E4 ADOPT]
- **Second tap deepens** — re-tapping the active tab jumps deeper
  (Agenda→Today, Notes→top). [F5 ADOPT]
- **Home surface is a setting** — cold-launch view (Agenda/Capture/Notes)
  chosen by the user, synced. [F3 ADOPT]
- **Keyboard-adjacent strip is the mobile command surface** — and later,
  remappable. [E2 ADAPT — in progress via §6 meta-collapse]
- **Caret-line raw reveal** — Obsidian's one-continuous-mode editor feel;
  the documented aspirational upgrade over DF's raw-mode toggle. [E1 ADAPT,
  revisit when editor feel is the focus]
- **Recurrence needs two anchors** — due-anchored ships; add
  completion-anchored ("3 days after I actually did it") for chores.
  [D2 ADAPT]
- **"Won't do" is a real ending** — a cancelled terminal status with its
  own muted voice, so stats stay honest. [D5 ADAPT · pairs with E5 LATER]

## Standing refusals (ANTI / guards)

- **No gamification scorekeeping** — karma, decay, confetti, streak-shame:
  engagement machinery violates the anti-slop stance. [X6 ANTI]
- **No noun without its verbs** — a new field ships with row display +
  notification + agenda presence together, or not at all. [X5 — governs D1]
- **No backend swaps under a stable UI** — files-as-truth + roundtrip-
  stable serializer is the structural guarantee; keep it. [X4]
- **No full-parity webview weight** — the <250KB gz entry budget is the
  law that prevents Notion's cold-start fate. [X1]

## Build queue (review's Top 7, pain ÷ cost, gripe-weighted)

1. A2 capture parsing with dashed un-parse chips
2. C1 swipe triage, two fixed verbs + undo
3. A1 Web Share Target + manifest shortcuts
4. C6 completion haptic
5. F3+F5 home-surface setting + second-tap-deepens
6. C3 overdue "Plan" ritual
7. A3 quick-add stays open

Deferred with named gates: D1 plan-vs-deadline (felt need + X5), D4
notification actions (Android M3), H1/H2 widgets that DO (M3), A6 voice
capture (after A2), F4 pull-down palette (after ⌘K), D6/D7 subtasks/habits
(only if DF turns task-manager-y).

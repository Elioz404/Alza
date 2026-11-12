# Alza

Alza is a floor-plan studio that a person and an agent edit together, on one live page.

A floor plan is coordinates, not buttons, so an agent cannot use one by pretending to be a
mouse. Alza does not ask it to. It publishes the plan itself as typed tools through
**WebMCP** (`document.modelContext.registerTool`), on the same page a person is drawing on.
Both of them change one model, through one command path, with one undo history.

You draw walls, rooms, doors, windows, stairs, columns and furniture in a metric 2D editor,
or trace over a photo of a plan. The agent works the same model with the same actions: it
checks its work against a constraint engine, places products from a partner shop on another
origin, and raises the plan into a 3D model you can walk through. Several storeys, curved
walls and free room outlines are all part of the model, and the whole plan exports as an
IFC4 building model.

Everything runs in the browser. There is no backend and no account, and the plan does not
leave the machine. Built for the [WebMCP Challenge](https://webmcp.devpost.com/).

---

## Contents

- [Try it](#try-it)
- [Why WebMCP](#why-webmcp)
- [The agent's tools](#the-agents-tools)
- [Approvals](#approvals)
- [Two origins, one plan](#two-origins-one-plan)
- [The shared session](#the-shared-session)
- [The plan model](#the-plan-model)
- [The constraint engine](#the-constraint-engine)
- [The 3D view](#the-3d-view)
- [IFC4 export](#ifc4-export)
- [The Studio UI](#the-studio-ui)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [First load and deferred loading](#first-load-and-deferred-loading)
- [Security model](#security-model)
- [Develop, test and build](#develop-test-and-build)
- [Project structure](#project-structure)
- [Notes on the WebMCP spec](#notes-on-the-webmcp-spec)
- [Limitations](#limitations)
- [License](#license)

## Try it

1. Open the studio: <https://alza-dev.pages.dev>.
2. Use a browser with a WebMCP runtime. In Chrome 149 or later, enable
   `chrome://flags/#enable-webmcp-testing` and restart (or launch Chromium with
   `--enable-features=WebMCP`, as the end-to-end scripts do). The status in the top bar reads
   **Agent tools on** once the runtime has taken the tools (46 at load).
3. Ask the agent, for example:
   - "Add a 3 x 2.5 m study next to the bedroom, with a door and a window."
   - "Check the plan and fix any issues."
   - "Add a second storey with a stair up from the hall."
   - "Build the 3D and give me a walkthrough."
4. Without a WebMCP runtime the app is still complete. **Activity > Developer tools** runs
   every tool by hand, through the same wrapper the runtime uses, and every call is logged.

### Trace a plan from an image

1. Upload the image in **Properties > Blueprint underlay** (with nothing selected), and give
   the same image to the agent in the conversation so it can see it.
2. Give the agent one real dimension, such as "this wall is 4.6 m". It calls
   `calibrate_underlay` with two points on the image and that distance, and the underlay is
   scaled to true metres.
3. Ask it to trace walls, openings and rooms, furnish the plan and check it. It draws with
   `add_wall`, `add_door`, `add_window` and `add_room`, verifies with `measure` and
   `get_issues`, and leaves notes about anything it could not be sure of.
4. Correct anything by hand. You and the agent share the same model.

## Why WebMCP

Canvas geometry is where agent actuation by clicking breaks down: you cannot drag a wall
reliably, and there is no DOM to read. Alza publishes structured tools instead, and every tool
that changes the plan dispatches the same commands the UI does (`src/model/commands.ts`).

```js
document.modelContext.registerTool({
  name: "add_wall",
  title: "Add a wall",
  description: "Add a wall segment from (ax,ay) to (bx,by) in meters...",
  inputSchema: { /* derived from a zod schema */ },
  execute: async (input) => { /* the same command the Draw walls tool dispatches */ },
});
```

Design points:

- **One store, two users.** A vanilla zustand store serves the React UI and the tools, so
  actions, validation and undo are the same for both.
- **Validated input.** Each tool's arguments are a zod schema built from the ranges in
  `src/model/limits.ts`. The published `inputSchema` is derived from it, and every call is
  validated before anything else. Invalid input returns `ok: false` with the list of
  problems, and nothing changes.
- **Names or ids.** Arguments accept an exact id, or a name that matches exactly one entity
  ("bedroom", "sofa"). An ambiguous name is refused with the candidates.
- **Visible calls.** Every call, from the person or the agent, is logged in the Activity feed
  with its source.
- **Annotations.** Every tool has a `title`. `readOnlyHint` and `untrustedContentHint` are
  set where they apply. Text that came from the partner origin travels in a separate
  `untrusted` field and never inside a summary the page writes.
- **Registration and retirement.** Tools are registered with
  `registerTool(descriptor, { signal, exposedTo })` and retired by aborting that signal, which
  is the spec's unregistration path and makes the runtime emit `toolchange`.

## The agent's tools

46 tools are registered at load (`TOOLS` in `src/mcp/tools.ts`, including the two from
`src/mcp/presenceTools.ts`). One more, `extend_selected_wall`, is registered only while the
person has a wall selected. "Approval" marks the 8 destructive tools, which wait for the person
when the approval gate is on, and `export_ifc`, which always waits.

| Tool | What it does | Approval |
|---|---|---|
| **Read** | | |
| `get_model` | The whole plan, or one level of it, with each upper floor's supports | |
| `get_issues` | Run the constraint engine on the plan or one level | |
| `get_item_catalog` | The furniture catalogue: built-in kinds and the plan's own | |
| `get_editor_state` | The person's view and camera mode, active level, selection and draw mode | |
| `measure` | Distance between two points or entities | |
| `get_underlay` | The underlay's placement, scale mapping and the tracing protocol | |
| **Blueprint** | | |
| `calibrate_underlay` | Scale the underlay to metres from one known dimension | |
| **Walls** | | |
| `add_wall` | Add a straight wall, or an arc (by bulge, sagitta or a point it passes) | |
| `edit_wall` | Move its ends, change thickness or height, bend or straighten it | |
| `remove_wall` | Remove a wall and its doors and windows | Yes |
| **Openings** | | |
| `add_door` | Add a swing door, or `style: "garage"` for a sectional garage door | |
| `set_door_swing` | Change a door's hinge side and swing direction | |
| `add_window` | Add a window | |
| `move_opening` | Slide a door or window along its wall | |
| `remove_opening` | Remove a door or window | Yes |
| **Rooms** | | |
| `add_room` | A rectangle, an outline of 3 to 100 points with arcs, or `fit` to the walls round a point; `open: true` for an open space | |
| `update_room` | Reshape, move, resize, relabel, refit or change the floor finish | |
| `remove_room` | Remove a room | Yes |
| **Furniture** | | |
| `place_item` | Place a catalogue piece | |
| `define_item_kind` | Model a new kind from primitive parts when the catalogue has no match | |
| `move_item` | Move or rotate a piece | |
| `remove_item` | Remove a piece | Yes |
| **Levels and stairs** | | |
| `list_levels` | The storeys, their heights, elevations and contents | |
| `add_level` | Add a storey | |
| `update_level` | Rename, change the floor-to-floor height (walls that met the slab follow unless `walls: "keep"`), or move it in the stack | |
| `remove_level` | Remove a storey and everything on it | Yes |
| `set_active_level` | Switch the storey being worked on | |
| `add_stair` | Add a straight or L-shaped stair; risers and going come from the storey height | |
| `update_stair` | Move, turn, resize or reshape a stair | |
| `remove_stair` | Remove a stair; its stairwell closes | Yes |
| **Structure** | | |
| `add_column` | A square, rectangular or round column at a point, centred in a room, or a grid | |
| `update_column` | Move, turn, resize, reshape or set its height | |
| `remove_column` | Remove a column | Yes |
| **Plan and view** | | |
| `set_plan_name` | Rename the plan | |
| `clear_model` | Erase the whole plan | Yes |
| `build_3d` | Switch to the 3D view and build the model | |
| `set_camera` | Orbit, top or walk camera | |
| `set_3d_style` | Ink edges on or off, and the cutaway and its height | |
| `set_doors` | Open, shut or toggle every door in 3D | |
| **Export** | | |
| `export_ifc` | Write the plan as IFC4 and download it; the agent gets a summary, not the file | Always |
| **Cross-origin** | | |
| `get_supplier_catalog` | Read the partner shop's catalogue through its own WebMCP tools | |
| `place_supplier_product` | Place a partner product at its real size | |
| **Notes** | | |
| `leave_note` | Leave a note on the plan | |
| `get_notes` | Read the notes left by the person and by agents | |
| **Shared session** | | |
| `get_presence` | What the person is doing now: level, view, selection, what they are editing, pointer, visible area | |
| `point_at` | Show the person a marker with a short message on an entity, in plan and 3D | |
| **Dynamic** | | |
| `extend_selected_wall` | Extend the wall the person selected; exists only while one is selected | |

`get_model`, `get_issues`, `add_wall`, `edit_wall`, `add_room`, `update_room`, `place_item`,
`move_item`, `place_supplier_product`, `add_stair`, `update_stair`, `add_column` and
`update_column` take an optional `level` (an id, or a name no other level shares). Without it
they read or draw on the level the person is working on.

## Approvals

The WebMCP explainer lists per-call user confirmation as an open question. Alza answers it in
the page (`src/mcp/registry.ts`, `executeWrapped`).

- A tool annotated `destructiveHint` is first resolved against the model: every reference must
  name exactly one entity. The call then becomes a request card on the plan, next to what it
  would remove, with that target hatched, and the request is listed under **Waiting for you**
  in Activity.
- The agent's `execute()` stays pending until the person answers. **Esc** keeps the plan,
  **Ctrl+Enter** confirms. A refusal comes back as a failure the agent can act on ("the human
  declined ... ask them what to do instead").
- Before it runs, the call is resolved again. If what it acts on changed or vanished while the
  request waited, nothing is done and the agent is told why.
- The `AbortSignal` WebMCP passes to `execute()` withdraws the request if the agent gives up.
- At most 5 requests wait at once; past that a call is refused rather than queued.
- The gate is a switch in **Properties** with nothing selected, on by default, and the policy
  is stated in words under the queue in Activity. It also guards **Developer tools**, since
  both paths use the same wrapper.
- `export_ifc` carries the page's own `consentHint` and always waits for the person, whatever
  the policy: a file written to their machine is not something undo can take back.

`destructiveHint` is in MCP's `ToolAnnotations` but not in WebMCP's, which defines only
`readOnlyHint` and `untrustedContentHint`. Alza keeps it in its own descriptors and enforces it
in the page, so the gate never depends on the browser passing it on.

## Two origins, one plan

**Nordika** is a separate site on its own origin (`partner/`). It knows nothing about Alza. It
publishes its stock as its own WebMCP tools, `nordika_list_products` and
`nordika_get_product`, and shares them with the studio through
`registerTool(descriptor, { exposedTo })`.

The studio embeds it in an iframe with `allow="tools"` (the `tools` Permissions Policy),
discovers those tools with `getTools({ fromOrigins })` and calls them with `executeTool()`. An
agent on the studio page can read a supplier's real catalogue and place its products at their
true dimensions, where the constraint engine judges them like anything else. No server sits in
between.

Where a runtime does not resolve cross-origin tools, the same two calls run over
`postMessage`, and the result says which transport was used.

In production the studio is on Cloudflare Pages (`https://alza-dev.pages.dev`) and the partner
on Netlify (`https://alza-dev.netlify.app`), named in `.env.production` as
`VITE_STUDIO_ORIGIN` and `VITE_SUPPLIER_ORIGIN`. Locally they are two ports,
`http://localhost:5199` and `http://localhost:5200` (`config/origins.js`); a different port is a
different origin, which is all the exchange needs.

## The shared session

The person, the agent and every open tab of the studio work on one plan at the same time, and
each sees the others.

- **The agent is seen at work.** While a tool call runs, a marker in the agent's colour moves to
  what it touches, the entity is highlighted, and a label says what it is doing ("Agent ·
  moving Sofa"), on the plan and over the 3D model. This follows from `dispatch()` and the tool
  runner, not from each tool, so every tool is covered.
- **The agent sees the person.** `get_presence` returns the person's level, view and camera,
  selection, what they are editing, their pointer and what it is over, and the plan area on
  their screen. `point_at` puts a marker with a short message (up to 160 characters, shown for
  6 seconds) on a wall, door, window, room, piece or stair. The message is also announced
  through a polite live region and kept in the feed.
- **No edit under the person's hand.** While the person drags, nudges or types into something,
  an agent's change to that same thing is refused with `conflict.code: "person_editing"`,
  the entity ids and `retryAfterMs` (1200 ms). Nothing changes, and the page shows "Agent ·
  waiting for you". The call is refused, not queued, so it never hangs.
- **Privacy switch.** The presence indicator in the top bar switches off sharing the pointer
  and view. The choice is kept per browser (`localStorage`, `alza.presence.sharing`) and every
  open tab follows it. With sharing off, `get_presence` reports `sharing: false` and no
  pointer, hover, viewport or look.
- **Tabs of one browser.** Tabs of the same origin share one plan over a `BroadcastChannel`
  (`alza-session`). A tab that opens later takes up the plan the others hold. A change travels
  as entity writes stamped with a Lamport clock; the last writer wins per entity, so every tab
  converges on the same plan whatever order writes arrive in. Undo stays local: it takes back
  the tab's own changes, never another tab's. Each tab shows the others' pointers ("Tab 2",
  and so on).
- **Checked messages.** Every message is checked against a zod schema
  (`src/session/messages.ts`). Anything malformed, foreign, or in another protocol version
  (`SESSION.protocol`, currently 3) is ignored, so a tab running an older build does not
  exchange changes until it is reloaded.

There is no server: the session lives in the browser. `src/session/transport.ts` defines a
small `Transport` interface (send, subscribe, close). A network relay between machines would be
one more implementation of it; the messages, their checks and the merge would stay as they are.

## The plan model

### Storeys and stairs

A plan is a stack of up to 12 **levels**, listed from the ground up, each with a
floor-to-floor height (2.2 to 10 m, 2.9 m by default) and a 0.2 m slab. Every wall, room,
piece, stair and column names the level it stands on, and each floor's elevation follows from
the heights below it.

The 2D plan shows one level at a time over a ghost of the one below (PageUp and PageDown, or the
level switcher). The 3D view stacks the storeys on their slabs, opens a stairwell over every
stair, and lets the walker climb it.

A stair stores only where it starts, which way it climbs, its width and shape (straight or L
with a left or right turn). Its risers, going, landing, walking line and clear zones are worked
out from the storey height (`src/model/stairs.ts`), the same way for the plan, the 3D model,
the walker and the checker. The rules (`STAIR` in `src/model/limits.ts`):

| Rule | Value |
|---|---|
| Clear width | 0.6 to 3 m (0.9 m by default) |
| Riser height | 0.15 to 0.19 m |
| Going | 0.25 to 0.34 m (may be set from 0.1 to 0.6 m when traced; the checker reports it) |
| Comfort rule, 2R + G | 0.60 to 0.65 m, target 0.63 m |
| Risers | 2 to 60 |
| Headroom | 2.0 m above every tread |
| Clear floor at each end | 0.8 m |

By default a stair has the fewest risers that keep each under 0.19 m, and the going the comfort
rule asks for.

### Free shapes

- **Rooms are outlines.** A room is a polygon of 3 to 100 corners, and any edge may be an arc.
  The room tool draws a rectangle by dragging, or any outline corner by corner (click the first
  corner, double-click or press Enter to close it). A selected room shows handles for its
  corners and edges: drag a corner, double-click to remove it, drag an edge's middle to bend it,
  or Shift-drag to add a corner. **Properties > Shape** does the same from the keyboard.
- **Walls may be arcs.** A wall's bend is stored as its bulge (tan of a quarter of the included
  angle, from -1 to 1, a half circle at most). Dragging a selected wall's middle bends it, and
  dragging it back onto the straight line straightens it. A curved wall may not bend tighter
  than a centreline radius of its thickness.
- **Walls at any angle.** Each wall's footprint is mitred against the walls it meets at any
  angle (`src/model/joints.ts`), for the plan's poché, the floors, the 3D view and the IFC
  joints.
- **Fit to walls.** `add_room` and `update_room` with `fit` take the outline the walls close
  off round a point, to their inner faces (`src/model/enclose.ts`, loaded when first used).

### Structure

- **Columns** are square, rectangular or round, 0.25 to 0.6 m, at most 200 per plan. They are
  placed at a point, centred in a room, or as a grid of up to 12 x 12 at 1 to 12 m spacing. A
  column stands to the underside of the slab over its level unless given a height, and carries
  the floor above as a wall does. The plan draws columns in solid poché like the walls they
  stand in, snapped to wall corners, wall axes and other columns' axes.
- **Open spaces.** `open: true` makes a room an open space, such as a carport or a porch under
  a storey. It needs no walls or door, and is floored in concrete unless told otherwise.
- **Garage doors.** `add_door` with `style: "garage"` adds a sectional overhead door, 2.4 to
  5.5 m wide and 2.0 to 2.5 m tall, with no swing. The plan draws its panels and its raised
  position dashed; the 3D view runs its sections along their track. The checker asks that it
  lead from an enclosed garage out to a drive: one in an open space opens nothing, and one
  into another room or facing a wall has nowhere for a car to come from.
- **A car.** The catalogue includes a mid-size car (1.8 x 4.5 x 1.5 m) as a reference object,
  so you can see whether it fits its garage or carport. Selected, it shows its parking
  clearance. The checker asks that it can be driven in: from one of its ends, a straight lane
  as wide as the car plus 0.3 m a side (`PARKING` in `src/model/limits.ts`) to a garage door
  that spans it or an open side of its space, and on past that exit over the drive for the
  car's length and 0.4 m more, with no wall, column or furniture in it, and not into an
  enclosed room. A second car parked in line on that drive is a tandem and allowed; one
  parked across it is in the way. A car shut in is told what would let it out: a garage door
  ahead that is off its line (by how much, and where to centre the car) or too narrow, or a
  garage door in a wall beside it.

### The catalogue

33 built-in kinds (`src/model/catalog.ts`), plus up to 100 kinds a plan defines for itself with
`define_item_kind` (up to 64 primitive parts each), plus partner products placed from Nordika.

### Demos

- **Sunset Loft**, the default plan, loads at start and from the Plan menu.
- **Crescent House** (Plan menu), a two-storey family house laid out to its site: the street
  to the south, the drive up the east side, the garden to the north. A living room under a roof
  terrace, its garden wall one glazed arc; an open dining area and L-shaped kitchen; a stair
  hall with a guest WC and a coats cupboard that opens into it; a utility room between the
  kitchen and an enclosed single garage. Upstairs, three bedrooms round one landing, the main
  suite over the garage, and a gallery beside the stairwell whose window lights the stair, over
  a high light in the hall. The main bedroom projects over the drive on two columns: a car
  drives straight between them and through the sectional garage door, a second parks in line
  under the bedroom, and the front door is a few steps away under the same slab. The street and
  east facades are ordered: the bedroom's windows even about its front, each east opening under
  one upstairs. Take a column away and the checker reports the floor unsupported. A plan saved
  with the earlier Crescent House, whose garage door stood in an open carport, now loads with a
  `garage_door_no_garage` warning.

Loading a demo replaces the current plan; Undo brings it back. Both are audited to 0 issues by
regression tests (`tests/issues.test.ts`,
`tests/rules.test.ts`, `tests/crescent.test.ts`).

### Plan format and migration

The plan format is version **4** (`PLAN_FORMAT_VERSION` in `src/model/limits.ts`; the shapes and
migration are in `src/model/planFormat.ts`).

| Format | Added |
|---|---|
| 1 | One storey: walls, openings, rectangular rooms, items |
| 2 | Levels and stairs; every wall, room and item names its level |
| 3 | Free shapes: a room is an outline (`points`, each corner with the bulge of the edge it starts); a wall may carry a `bulge` |
| 4 | Structure: `columns` (each on its level), a room's `kind` (`"enclosed"` or `"open"`), a door's `style` (`"swing"` or `"garage"`) |

Older plans load without loss:

- A format-1 plan first becomes a single "Ground floor" holding everything.
- A format-1 or format-2 room's rectangle becomes its four corners, and every wall stays
  straight.
- A plan before format 4 gets no columns, and its rooms stay enclosed and its doors swinging.
- A bow too slight to be an arc (its middle under 0.01 mm off its chord, the IFC export's
  precision) is stored straight.

The shape is checked before anything is migrated: types and references, not ranges. A plan that
breaks a range still loads and the checker reports it, so a drawing is never lost because one
wall is too short. A plan from a newer format, or one that names a level it does not have, is
refused and the current plan stays.

Every plan has an `id` of 128 random bits, given when it is started (a demo loaded, a plan
cleared); a plan saved without one gets one as it loads.

## The constraint engine

`get_issues` and the Issues tab run the checker in `src/model/issues.ts`, which reports 53 kinds
of issue in metres. Agents call it after editing and fix what it finds. Rules are checked level
by level, so walls on different floors are never compared.

| Family | What it reports |
|---|---|
| Walls | Too short; a loose end (T-junctions count as connected); collinear overlap, total or partial; a mid-span crossing; an arc tighter than its thickness allows |
| Openings | Not fully inside its wall; overlapping openings; sill plus height above the wall; a wall ending inside another wall's opening; an opening too wide for the straight leaf or pane across a curved wall's chord |
| Doors | Two door leaves that swing into each other; a garage door out of size or too wide for its wall with its jambs |
| Rooms | Floating; overlapping (by real outlines); no door; too small; an outline that crosses itself, has an edge under 5 cm, or is otherwise invalid. An open space is never asked for walls or a door |
| Furniture | Oriented-rectangle (SAT) tests against walls (leaning is fine, crossing is an error); blocking a door swing or a window (with a sill-height nuance); piece against piece (rugs exempt); outside every room; on a stair or over a stairwell; in a column; an unknown kind |
| Storeys | A wall under a level above that stops short of its slab or runs up through it |
| Stairs | No level above; risers or going out of range; the 2R + G rule; headroom under the slab; a wall in the stair or over its stairwell; a blocked landing at either end; a stairwell outside every room; overlapping stairs |
| Structure | An upper floor with no wall or column within half of a 6 m span (sampled every 25 cm, coarser on a floor that would need over 40,000 samples, each unsupported zone reported with its bounds); a column short of its slab or through it; a column with nothing under it on the level below; a column off every room and wall, in a door's swing, a garage door's drive or a window, on a stair, or on another column |
| Parking | A car without 0.6 m clear at its sides and 0.4 m at its ends, or with a column in it, a wall through it, or past its garage's walls; a car with no straight lane in, or with a column or piece in its lane or on the drive past it; a garage door that opens no enclosed garage, or leads into another room or faces a wall |

The structural checks are a sanity check, not engineering: only walls and columns that reach the
slab's underside carry it.

## The 3D view

The 3D view is built from the plan on demand (`src/three/`); the 2D editor's first load contains
no three.js.

- **Studio look.** A warm backdrop, a soft sun shadow (PCF), baked contact shading in place of
  screen-space ambient occlusion, and Khronos PBR Neutral tone mapping so surfaces read in their
  token colours. No post-processing. Frames are rendered on demand, not in a constant loop.
- **Ink edges.** Outlines like the plan's, on by default (`set_3d_style` or **View**).
- **Dollhouse cutaway.** Slices the walls at a height from 0.3 to 4 m (1.2 m by default, in
  5 cm steps), with the cut drawn in poché, to look into the rooms.
- **Labels.** Room names float over the model, kept off a parked car.
- **Selection sync.** Clicking a wall, room or piece selects it as on the plan; a selection on
  the plan is outlined in 3D, and a pending removal is hatched on the model. Delete and Ctrl+Z
  work in 3D too.
- **Camera modes.** Orbit (1), Top (2) and Walk (3), with eased camera moves that become instant
  under reduced motion.
- **Walk.** WASD or the arrow keys, drag to look, at a 1.6 m eye height, with collision against
  walls, columns, furniture and the car. The walker climbs stairs between storeys. Click a door
  to open or close it, or swing every door from the hint bar.
- **Storeys.** Slabs between floors, open over each stairwell, with treads, risers, stringers,
  handrails, landing and the stairwell's balustrade.
- **Procedural furniture.** Every built-in kind is modelled to its catalogue box from soft
  cushions, turned and lathed parts and cut plates, baked to one mesh per surface and shared
  per kind. Pieces an agent defines are assembled from their parts on the same surfaces;
  partner products are a tidy block-out.
- **Materials.** A short list of named surfaces (oak, fabric, brushed metal, plaster, the floor
  finishes and others) in colours from the design tokens, textured with procedural patterns
  (wood grain, weave, planks, tiles) computed into textures at plan scale. No image files are
  fetched.
- **Exports from the view.** OBJ and a PNG snapshot (Export menu, in 3D).

## IFC4 export

**Export > Building model (IFC)**, or `export_ifc`, writes the whole plan, every level, as an
IFC4 file (ISO 10303-21 STEP, schema `IFC4`, view definition `DesignTransferView_V1.0`), so it
opens in CAD and BIM tools as a building rather than a mesh. It is written from the plan, so it
works from either view. Nothing leaves the browser, and the writer (`src/export/ifc/`) is a
chunk of about 35 kB (13 kB gzip) fetched the first time someone exports.

| In the plan | In the IFC file |
|---|---|
| The plan | `IfcProject` (metres, radians; a 3D Model context with Body and Axis, a 2D Plan context with FootPrint) > `IfcSite` > `IfcBuilding`, named after the plan |
| A level | `IfcBuildingStorey` at its elevation, on one `IfcSlab` `FLOOR` under its rooms and walls, opened by an `IfcOpeningElement` where a stair from below rises through it |
| A wall | `IfcWall` `STANDARD`: an Axis (a line, or an arc as `IfcIndexedPolyCurve`) and an extruded Body, butt-jointed to the walls it meets so no two bodies overlap; one plaster `IfcMaterialLayerSetUsage`; `Pset_WallCommon.IsExternal` where the rooms tell; `Qto_WallBaseQuantities` |
| A door or window | An `IfcOpeningElement` voiding its wall (on a curved wall, the stretch between two radial cuts), filled by an `IfcDoor` or `IfcWindow`. A door's placement faces the way its leaf swings and its `OperationType` names the hinge side |
| A garage door | `IfcDoor` with `OperationType` `USERDEFINED` and `UserDefinedOperationType` `SECTIONAL` (IFC4 has no sectional door type) |
| A room | `IfcSpace` (`LongName` is the room's name), its FootPrint and Body its real outline, with `Pset_SpaceCommon` and `Qto_SpaceBaseQuantities`; its floor finish as an `IfcCovering` `FLOORING` (4 cm) on the slab, with `IfcRelCoversSpaces` |
| An open space | `IfcSpace` `EXTERNAL` (`PARKING` where a car is parked in it), `IsExternal` true |
| A column | `IfcColumn` `COLUMN`: a rectangle or circle profile extruded to its height, in concrete, with `Pset_ColumnCommon` (`LoadBearing` true) and `Qto_ColumnBaseQuantities`. A wall a column stands in is written less the column, as a CSG difference |
| A stair | `IfcStair` of `IfcStairFlight`s with risers, treads, riser height and going; an L-stair's landing as an `IfcSlab` `LANDING`; `Pset_StairCommon` |
| A piece of furniture | `IfcFurniture` named from the catalogue, its kind in `ObjectType`; a Nordika product carries its sku and vendor in `Alza_Product` |

Every element is contained in its storey and placed relative to it. GlobalIds are derived from
the plan's id and each element's own, so exporting the same plan again gives the same GlobalIds,
and two plans never share one. Names are cleaned of control and invisible formatting characters,
capped at 255 characters (`STRING(255)`), and encoded in STEP's `\X2\` form where not ASCII. A
plan holding a number outside the editor's ranges is not exported: the menu and the tool name
the values to fix, and no file is written.

**What is simplified.** Walls, slabs, openings and furniture are extruded solids (furniture is
its catalogue box, not its 3D model). Walls are butt-jointed by their bodies, not connected with
`IfcRelConnectsPathElements`. The ground floor stands on a slab like the floors above. A stair's
flights are stacked solid treads. There is no site geometry, roof, ceiling or owner history. A
wall's `LoadBearing` is never stated, because the plan does not know it. Supplier prices are not
in the file.

The tests read every exported file back with a STEP reader and an IFC4 checker written apart
from the exporter (`tests/support/ifcCheck.ts`): references and their entity types, attribute
counts against IFC4 ADD2 TC1, required attributes, enumerations, labels, property-set prefixes,
GlobalIds, containment, voids and fills, and placements. They also rebuild the solids and check
that no two wall bodies overlap, every joint is filled once, the floor under every wall is
closed, every void passes the faces it cuts, and every door swings and hangs as the plan draws
it.

## The Studio UI

The interface is a quiet drafting studio: a top bar, a tool rail, the canvas, and a side panel
with **Properties**, **Library**, **Issues** and **Notes** tabs over an **Activity** feed. It
works as a drawer and as a bottom sheet on narrow screens, with larger touch targets on coarse
pointers.

- **Design tokens.** Every colour, size, type step, radius, shadow, duration and layer is
  written once in `src/ui/theme/tokens.ts`, in OKLCH. `tokenSheet.ts` renders them at build
  time into a static stylesheet (`@layer alza-tokens`), so the strict CSP holds. The 2D editor
  and the 3D view read the same values from script (`PLAN_HEX`, `src/ui/theme/sceneTokens.ts`). The chrome is
  a cool graphite; the person's colour is a drafting cobalt and the agent's a verdigris, used
  only as roles. A dark token set exists; the shipped page renders the light theme.
- **Type.** IBM Plex Sans and IBM Plex Mono, with Barlow Semi Condensed, bundled as fonts.
- **Native first-paint controls.** The panel's tabs, segmented controls (Plan/3D and others),
  the approval switch, tooltips and shortcut chips are the studio's own components
  (`src/ui/primitives/`), drawn on the tokens. Astryx supplies dialogs, menus, popovers,
  notices and number fields, and arrives only when one of them is needed.
- **The plan sheet.** Poché walls, dimension chains, plan symbols for furniture and stairs,
  numbered revision marks for the agent's changes, live room areas, and a 5 cm snap.
- **Reduced motion.** Movement driven from script drops to zero under
  `prefers-reduced-motion`.

## Keyboard shortcuts

The full sheet opens with **?** (`src/ui/shell/shortcuts.ts`). The main keys:

| Key | Does |
|---|---|
| V | Select |
| H | Pan (Space-drag pans with any tool) |
| W | Draw walls (hold Shift to keep them straight) |
| R | Draw a room |
| D | Add a door |
| N | Add a window |
| S | Add a stair |
| P | Add a column |
| F | Place furniture (opens the Library) |
| 1 / 2 / 3 | Orbit / Top / Walk, in 3D |
| W A S D, arrows | Walk, in Walk view |
| ? | Show the shortcut sheet |
| Esc | Back to Select, or clear the selection; while drawing a room, drop the outline |
| Enter | Close a room's outline; place a stair, column or piece at the cross or view centre |
| Backspace | Take back the last corner of a room's outline |
| C | With Draw a room, put a corner down at the cross |
| Arrows | Nudge the selection 5 cm (25 cm with Shift); move the room or column cross |
| Delete / Backspace | Remove the selected wall, room, item, stair or column |
| Ctrl+Z | Undo |
| + / - | Zoom in / out |
| Shift+1 | Fit the plan |
| PageUp / PageDown | The level above / below (in 3D too) |
| Ctrl+Enter / Esc | On an approval card: confirm / keep the plan |

Shortcuts stand aside while you type in a field, inside a dialog, menu or popover, and for
chords the editor or the browser own.

## First load and deferred loading

First paint needs only the shell, the plan and the plan's Properties. Everything else loads after
it (`src/ui/deferred.tsx`): the other tabs, the selection inspectors, Activity's details and
Developer tools, the menus, notices, the first-run state, the approval card, the dialogs, the
plan's handles and marks, and the session runtime. They are fetched once the browser is idle,
so the first click finds its code already there. three.js and the 3D code arrive only with the
3D view, the IFC writer only with the first export.

Sizes are held by budgets in `config/budgets.js`: each is what the site shipped when last set,
plus a 2% margin, and the build fails over it, naming the chunk and its size.

| What | Shipped (minified / gzip) |
|---|---|
| Studio first-load script | 599.6 kB / 196.5 kB |
| Studio first-load stylesheet | 115.3 kB / 19.5 kB |
| Partner script | 9.0 kB / 4.2 kB |
| Partner stylesheet | 4.8 kB / 1.4 kB |
| three.js (lazy) | 517.9 kB / 130.1 kB |
| Studio 3D code (lazy) | 144.5 kB / 55.3 kB |

The build also fails if any Astryx module, or a package only Astryx uses, reaches a site's first
load (`config/firstLoad.js`), naming the chain of static imports that brought it in. Unused
Astryx style rules are dropped, and only its reset, theme and tokens stay in the render-blocking
stylesheet; its component rules are a stylesheet of their own, linked with the first chunk that
needs them, in ordered sub-layers so the cascade is unchanged (`config/purgeAtomicCss.js`).

## Security model

- **Headers.** Both sites' headers come from `config/headers.js`: a strict CSP (`script-src
  'self'`, `connect-src 'self'`), `Permissions-Policy` for `tools`, HSTS,
  `Cross-Origin-Opener-Policy: same-origin`, `nosniff` and a referrer policy. The studio may
  frame only the partner (`frame-src`) and is framable only by itself; the partner frames
  nothing and is framable only by the studio. The studio delegates `tools` to the partner
  origin and nobody else.
- **Every path.** The build writes one directory per site (`dist/studio`, `dist/partner`), each
  with a `_headers` file whose policy sits on every path, so no answer a host gives (a page, its
  single-page fallback, a directory index, an error page) leaves without it. `serve:local`
  sends the same sets.
- **Origins are configuration.** `.env.production` names both origins as bare `https://`
  origins, and `npm run build` fails if either is missing or malformed. In a development build
  `?supplier=` may override the partner; a production build ignores it, and the partner trusts
  only the studio origin it was built for. Origins are compared after URL parsing, never by
  prefix, and an opaque origin matches nothing.
- **Untrusted text.** Partner text never enters a summary the page writes; it travels in a
  separate `untrusted` field, flagged with `untrustedContentHint`. Plan text written out (IFC,
  file names) is cleaned of control and invisible formatting characters.
- **Test hook.** Playwright drives the page through `window.__alza`, which only development
  builds carry. A production build has it only with `VITE_ALZA_TEST_HOOK=1`
  (`npm run build:local -- --test-hook`), which the build refuses for any origin that is not
  loopback, and such a build goes to `dist-local/`, never to the `dist/` the deploy scripts
  publish.

## Develop, test and build

```bash
npm install
npm run dev          # the studio          -> http://localhost:5199
npm run partner      # the partner origin  -> http://localhost:5200 (second terminal)
npm run typecheck    # tsc -b over the app, the tests and vite.config.ts
npm run lint         # ESLint (typescript-eslint + react-hooks)
npm test             # unit tests (vitest, happy-dom)
npm run build        # production build: dist/studio and dist/partner
npm run e2e          # Playwright battery (run both dev servers first)
npm run build:local  # production build for the two local origins, into dist-local/
npm run serve:local  # serve dist-local/ on two origins with the production headers
npm run shots        # screenshot set into shots/devpost/ (not tracked)
npm run deploy:studio   # build, then Cloudflare Pages (wrangler)
npm run deploy:partner  # build, then Netlify
```

**Unit tests.** 1571 tests in 65 files (`npx vitest run`). They cover the geometry, the checker
and its rules, the commands and undo, levels and stairs, free shapes and joints, columns and
supports, the 3D scene and furniture, the IFC export, the tools and their validation, the
approval gate, untrusted partner text, the session (convergence, hostile messages, the
person-editing rule), the UI shell and panels, and the build: headers, sites, budgets, first
load and CSS purge.

**End-to-end.** `scripts/e2e-full.mjs` drives the real app in Chromium with WebMCP enabled, by
mouse and keyboard: drawing, selection, shortcuts, every tool, the approval card, the 3D view
(camera modes, cutaway, picking, a pending removal hatched on the model), the drawer and
bottom-sheet layouts, the shared session (the agent's marker, `get_presence`, an edit held for
the person, two tabs syncing), and structure (a carport under a storey built by the tools, a
format-3 plan loaded). It asserts zero console errors. It runs about 300 checks (296 at the time of writing): 2 skip on builds
without `navigator.modelContextTesting` and 3 when the partner origin does not answer; with
either present, a failure is a failure, never a skip.

The Playwright scripts run against `npm run dev` (and `npm run partner`), or against
`npm run build:local -- --test-hook` followed by `npm run serve:local`. They launch Playwright's
Chromium (`npx playwright install chromium`); set `ALZA_CHROMIUM_PATH` to use any Chromium or
Chrome already installed instead.

**CI.** `.github/workflows/ci.yml` runs `npm ci`, typecheck, lint, unit tests, `npx vite build`
and `npm audit --audit-level=high` on every push and pull request.

Stack: Vite 7, React 19, TypeScript (strict), zustand, zod, Three.js, SVG for the plan, Astryx
for dialogs, menus, popovers, notices and number fields, vitest and Playwright. Both sites
deploy as static files.

## Project structure

```
config/          build configuration shared by Vite, the scripts and the tests
                 origins.js (both origins, dev ports) · sites.js (one output dir per site)
                 headers.js (CSP and the rest) · budgets.js (size budgets)
                 firstLoad.js (no Astryx on the first load) · purgeAtomicCss.js · flags.js
partner/         the Nordika partner site: its page, its WebMCP tools, the postMessage protocol
public/          favicon and app icon
scripts/         e2e-full.mjs (Playwright battery) · browser.mjs · studio.mjs (finds the UI by
                 role and name) · build-local.mjs · serve-local.mjs · partner-dev.mjs
                 trace.mjs (a traced demo plan as data) · shots.mjs · record6.mjs · paths.mjs
                 static-server.mjs · test-hook.mjs (finds window.__alza)
src/
  main.tsx       boot: seed the plan, mount the shell, register the tools
  model/         the domain, free of React and the DOM
                 types · limits (every range) · store (actions, undo, approvals) · commands
                 (dispatch, the one change path) · issues (the checker) · geometry · shapes
                 (arcs and outlines) · joints (mitred footprints) · enclose (fit to walls)
                 levels · stairs · stairGuard · floors (slab outlines) · region · columns
                 columnCuts · supports (span check) · catalog · planFormat (format 4 and
                 migration) · planRanges · resolve (id or name lookup) · presence · presenceShows · touch
                 places · provenance · assets (underlay images) · text · ids · seed
                 demoCrescent · sceneBus · schemas
  mcp/           tools.ts (the tools) · presenceTools.ts · presenceAnswers.ts · registry.ts
                 (validation, resolution, approval gate, logging) · bootstrap.ts (runtime
                 detection, the dynamic tool) · supplier.ts (cross-origin catalogue)
  session/       runtime.ts (join, send, merge) · replica.ts (last-writer-wins, Lamport
                 clocks) · messages.ts (zod schemas) · transport.ts (BroadcastChannel, in-page,
                 the relay seam)
  editor/        Editor.tsx (the SVG plan) · canvasState · drawing · symbols · roomDraft
                 ShapeHandles · WallPoche · StairDrawing · stairSymbol · ColumnShape
                 ColumnMarks · SlabMarks · PlanPresence · selectionKeys
  three/         Scene3D · viewport (renderer, cameras, picking, OBJ/PNG) · build · wallSolids
                 triangulate · planScene (per-entity reconciliation) · slabs · stairs
                 furniture · furnitureShapes · furnitureStyle · surfaces · materials · edges
                 screenLines · cutaway · labels · marks · levelView · transitions · walk
                 frames · thumbnails · config · overlays/
  export/        download.ts · ifcExport.ts · ifc/ (step, guid, entities, model, config, index)
  ui/            App · shell/ (top bar, rail, canvas region, side panel, menus, shortcuts)
                 theme/ (tokens, token sheet, sceneTokens, fonts) · primitives/ (buttons, fields, tabs,
                 segmented, switch, tips, icons) · inspector/ · library/ · issues/ · notes/
                 activity/ · approvals/ · canvas/ · session/ · firstRun/ · deferred.tsx
                 LazyLayer · LazyView · SupplierBridge · keys · underlay
tests/           vitest suites, one per area, and support/ (an independent IFC4 checker)
.github/         CI workflow
```

## Notes on the WebMCP spec

Several of the explainer's
[open questions](https://github.com/webmachinelearning/webmcp#open-questions) came up as real
problems while building this.

**User confirmation** ([#165](https://github.com/webmachinelearning/webmcp/issues/165),
[#50](https://github.com/webmachinelearning/webmcp/issues/50)). A tool that clears a plan cannot
just run because it was called. The answer here is the page's approval gate. It works, but every
site must build its own, and the confirmation is only as trustworthy as the page drawing it. If
the browser is to mediate confirmation, it needs a way to know which tools are destructive, and
`destructiveHint` is not in WebMCP's annotations today.

**Multimodal input** ([#41](https://github.com/webmachinelearning/webmcp/issues/41),
[#86](https://github.com/webmachinelearning/webmcp/issues/86),
[#81](https://github.com/webmachinelearning/webmcp/issues/81)). Tracing needs the agent to see a
drawing, and a tool result is text. The page's copy is also not the agent's copy: the uploader
re-encodes to at most 1600 px. So `get_underlay` returns no pixels. It says the image must arrive
through both channels, and it returns a mapping in fractions of the image
(`u = x_px / image_width`, then `world_x = rect.x + u * rect.w`), which survives a resize.

**Skills** ([#161](https://github.com/webmachinelearning/webmcp/issues/161)). Tracing a plan is
a procedure, not a call: establish scale, read the drawing, lay walls, cut openings, check,
annotate what was ambiguous. It ships as `TRACING_PROTOCOL`, embedded in tool descriptions,
because that is the only place a page can put it today.

**Testing.** `navigator.modelContextTesting` lets the end-to-end battery drive real tool
execution. It exists only in some Chrome builds, so 2 of the checks skip elsewhere.

**What worked as written.** Unregistering by aborting the registration signal:
`extend_selected_wall` appears when a wall is selected and disappears when it is not, and the
runtimes tested tracked it with no special handling.

**A runtime gap, not a spec gap.** Cross-origin discovery with `exposedTo` and
`getTools({ fromOrigins })` is correct per the spec, but not every runtime resolves
`fromOrigins` yet. The `postMessage` transport behind the same interface keeps the partner
catalogue working there, and the feed says which transport ran.

## Limitations

- **No saving yet.** There is no save or open of a plan file, and nothing is stored between
  visits: a reload starts from the Sunset Loft demo, unless another open tab holds the plan.
  Exports (IFC, OBJ, PNG) are one-way.
- **No redo.** Ctrl+Z undoes; there is no redo command.
- **One browser only.** The shared session joins tabs of one browser on one origin. Working
  across machines needs a network relay behind `transport.ts`, plus accounts or invitations,
  none of which exist.
- **No IFC import.** The export is one-way, and simplified as described above (no roof, ceiling,
  site geometry or wall connectivity relationships).
- **Structure is a sanity check.** The span and support rules are not structural engineering.
  There are no beams, roofs or foundations.
- **Light theme only.** A dark token set is defined, but the page ships in light mode.
- **Runtime support varies.** WebMCP is behind a flag in Chrome, `navigator.modelContextTesting`
  exists only in some builds, and cross-origin discovery depends on the runtime.

## License

MIT. See [LICENSE](./LICENSE).

# VR World Builder (Meta Quest 2 / 3)

A 3D modeling / world-building tool that runs **in the Meta Quest browser** using WebXR and three.js.
No install, no build step, no app store — open a URL on the headset and press **Enter VR**.
It also works on a desktop browser (mouse + gizmo) so you can edit the same scene on a PC.

## Running it

WebXR requires **HTTPS** (or `localhost`).

**Easiest — GitHub Pages:** merge to `main`, then in the repo go to *Settings → Pages → Source: GitHub Actions*.
The included workflow publishes the site to `https://<user>.github.io/VR-3D-Interface/`. Open that in the Quest Browser.

**Local dev with the headset plugged in by USB:**

```bash
python3 -m http.server 8080
```

```bash
adb reverse tcp:8080 tcp:8080
```

Then open `http://localhost:8080` in the Quest Browser.

## VR controls (Quest Touch controllers)

| Input | Action |
|---|---|
| Right trigger (aim at object) | Select & grab — move/rotate it with your hand |
| Right trigger (aim at palette) | Press tool button |
| Right stick ↑/↓ while grabbing | Push / pull object along the ray |
| Left grip while grabbing | Two-handed scale (spread / pinch hands) |
| Left stick | Fly in look direction |
| Right stick ↑/↓ (not grabbing) | Fly up / down |
| Right stick ←/→ | Snap turn 30° |
| **X** | Show / hide the tool palette (on left hand) |
| **Y** | Undo |
| **A** | Duplicate selection |
| **B** | Delete selection |

Palette: Box, Sphere, Cylinder, Cone, Torus, Plane, Light, color cycle, snap toggle, duplicate, delete, undo, **Export GLB**, clear.

## Desktop controls

Toolbar to add shapes, color picker, W/E/R = move/rotate/scale gizmo, D = duplicate, Del = delete, Ctrl+Z = undo.
Save/Import JSON, Export GLB.

## Features

- Scene autosaves to the browser (`localStorage`) after every change
- Grid snapping (5 cm / 15°) on release, toggleable
- 100-step undo
- **Export to .glb** — import your world straight into Blender, Unity or Unreal

## Code layout

- `index.html` — page, desktop toolbar, import map (three.js from CDN)
- `src/editor.js` — scene model: create, select, duplicate, delete, snap, undo, (de)serialize
- `src/palette.js` — the in-VR wrist tool palette
- `src/main.js` — renderer, environment, desktop controls, VR controller input

## Roadmap ideas

Vertex/face editing (real mesh modeling), CSG booleans, texture/material library, importing .glb assets,
terrain sculpting, play mode with physics and simple scripting, multi-select, hand-tracking, multiplayer co-editing.

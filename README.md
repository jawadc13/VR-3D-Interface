# VR World Builder (Meta Quest 2 / 3)

A 3D modeler and world builder that runs on the **Meta Quest 2 and 3**, either in the Quest Browser (WebXR) or as an
installable **Android app (APK)**. It also runs in a desktop browser, so you can edit the same world on a PC.

Features:
- **Shapes**: cube, sphere, cylinder, cone, torus, slab, point lights
- **Mesh editing**: drag individual **vertices** or **faces**, and **extrude** faces (Blender-style)
- **Booleans**: union / subtract / intersect two objects
- **Textures**: built-in procedural textures (brick, wood, stone, grass, tiles, metal, sand, checker) or your own image (desktop)
- **Import models**: `.glb` files (desktop / Quest 2D browser); converts to editable mesh when you edit it
- **Terrain**: 10×10 m terrain with raise / lower / smooth / flatten brushes
- **Play mode**: physics (static / dynamic bodies, throw objects in VR) and per-object **JavaScript scripts**
- **Hand tracking**: pinch works like the trigger; left-hand pinch teleports
- Undo, grid snapping, autosave (IndexedDB), save/open `.vrworld.json` files, **export `.glb`** for Blender / Unity / Unreal
- Works offline once loaded (service worker); all libraries are vendored in `vendor/`

## 1. Run it in the Quest Browser (web version)

WebXR needs **HTTPS**. The repo includes a GitHub Pages workflow:
merge to `main` → *Settings → Pages → Source: GitHub Actions*. The site appears at
`https://<user>.github.io/VR-3D-Interface/`. Open it on the Quest and press **Enter VR**.

Local testing with the headset on USB:

```bash
python3 -m http.server 8080
```

```bash
adb reverse tcp:8080 tcp:8080
```

then open `http://localhost:8080` in the Quest Browser.

## 2. Install the Android app (APK) on Quest 2 / 3

The APK is a Meta Quest **PWA package** generated with Meta's official Bubblewrap tool (`tools/generate-android.js`).
It shows up in your Quest app library with its own icon and opens the app in its own window; press **Enter VR** inside it.
It loads the GitHub Pages site (then caches it for offline use), so **set up step 1 first**.

**Get the APK:** GitHub → *Actions* → **Build Quest APK** → latest run → download the `VRWorldBuilder-apk` artifact
(or attach it automatically by publishing a GitHub Release).

**Sideload it:**
1. Turn on Developer Mode for your headset (Meta Horizon phone app → Devices → Headset settings → Developer Mode).
2. Plug the Quest into your PC, accept the USB debugging prompt in the headset.
3. Install with [SideQuest](https://sidequestvr.com) (drag the APK onto it), or:

```bash
adb install -r VRWorldBuilder.apk
```

4. In the headset: *App Library → filter "Unknown Sources" → VR World Builder*.

**Stable signing key (recommended):** without one, CI signs each build with a throwaway key, so you must uninstall
before installing a new build (your worlds are kept by the site only if you saved them to a file). To fix that, once:

```bash
keytool -genkeypair -keystore release.keystore -alias android -keyalg RSA -keysize 2048 -validity 10000
```

```bash
base64 -w0 release.keystore
```

Add repo secrets `ANDROID_KEYSTORE_BASE64` (the base64 output) and `ANDROID_KEYSTORE_PASSWORD`. Keep the keystore safe.

If you host the site under a different URL, regenerate the Android project:

```bash
npm i --no-save @meta-quest/bubblewrap-core@1.24.1
```

```bash
python3 -m http.server 8123 &
```

```bash
node tools/generate-android.js https://YOUR-HOST/PATH/
```

## VR controls (Touch controllers)

| Input | Action |
|---|---|
| **X** | Show / hide the tool palette (on left hand) — tabs: Create, Edit, Paint, World |
| Right trigger | Press palette buttons · grab objects · drag vertex/face handles · sculpt terrain |
| Right stick ↑/↓ | Push/pull held object · brush size while sculpting · otherwise fly up/down |
| Right stick ←/→ | Snap turn |
| Left stick | Fly |
| Left trigger | Teleport to where the blue ray points |
| Left grip while holding an object | Two-hand scale |
| **A** / **B** / **Y** | Duplicate / Delete / Undo |

Hands: pinch = trigger (left pinch = teleport); the palette stays on your left hand.

**Booleans:** select object B → *Set B* (magenta box) → select A → Union / Subtract / Intersect.
**Extrude:** Edit → Faces → aim at an orange face point and click → Extrude → grab the face and pull.
**Play:** World → ▶ Play. Dynamic objects fall and can be thrown; Stop restores the scene.

## Desktop controls

Toolbar for everything; right panel for color, texture, physics, mass and scripts.
W/E/R move/rotate/scale · 1/2 vertex/face mode · X extrude · D duplicate · Del delete · Ctrl+Z undo · P play.
While sculpting, left-drag sculpts and right-drag orbits.

## Scripting

Each object can have a script that runs every frame in Play mode. Available variables:
`obj` (three.js object), `body` (cannon-es body or null), `dt`, `time`, `state` (per-object storage), `THREE`, `scene`,
`input` (`input.keys` on desktop, `input.axes` = thumbsticks in VR). Presets: spin, bob, hop, orbit, pulse.
Scripts are ordinary JavaScript running in the page — only open world files from people you trust.

## Code layout

| File | Purpose |
|---|---|
| `src/main.js` | App wiring: renderer, desktop UI, VR input, palette pages |
| `src/editor.js` | Scene model, selection, undo, (de)serialize, save/load, model import |
| `src/meshedit.js` | Vertex/face handles and extrude |
| `src/csg.js` | Booleans (three-bvh-csg) |
| `src/terrain.js` | Sculpt brushes |
| `src/play.js` | Physics (cannon-es) and scripts |
| `src/textures.js` | Procedural / image textures |
| `src/palette.js` | In-VR tabbed tool palette |
| `src/store.js` | IndexedDB storage |
| `android/` | Generated Meta Quest Android project |

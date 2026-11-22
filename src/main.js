import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Editor, PRIMITIVES } from './editor.js';
import { Palette } from './palette.js';
import { MeshEdit, toEditable } from './meshedit.js';
import { boolean } from './csg.js';
import { sculpt, makeBrushRing, SCULPT_TOOLS } from './terrain.js';
import { Play, SCRIPT_PRESETS } from './play.js';
import { TEXTURES, imageFileToTextureName } from './textures.js';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8c8);
scene.fog = new THREE.Fog(0x87a8c8, 20, 80);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 300);
camera.position.set(0, 1.6, 2);
const rig = new THREE.Group(); // camera + controllers; moved by locomotion
rig.add(camera);
scene.add(rig);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 10, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x5c6b5a }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(40, 160, 0x334433, 0x4a584a);
grid.position.y = 0.001;
scene.add(grid);

const editor = new Editor(scene);
const meshEdit = new MeshEdit(editor);
const play = new Play(editor);
const brushRing = makeBrushRing();
scene.add(brushRing);
let brushRadius = 1.2;

// ---------- State ----------
let tool = 'translate';     // translate | rotate | scale | vertex | face | sculpt
let sculptTool = 'raise';
const $ = (id) => document.getElementById(id);

let statusTimer;
function status(msg) {
  if (!msg) return;
  const el = $('status'); el.textContent = msg; el.style.display = 'block';
  clearTimeout(statusTimer); statusTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
  palette.setStatus(msg);
}

let saveTimer;
editor.onChange(() => {
  // Undo/load recreate objects: keep mesh-edit mode attached to the (new) selection.
  if (meshEdit.mode && meshEdit.obj && !meshEdit.obj.parent) {
    const m = meshEdit.mode, o = editor.selected;
    meshEdit.exit();
    const e = o && toEditable(o);
    if (e) { meshEdit.obj = e; meshEdit.mode = m; editor.selected = e; meshEdit.rebuild(); } else tool = 'translate';
  }
  editor.updateSelBox();
  syncUI();
  if (!play.active) { clearTimeout(saveTimer); saveTimer = setTimeout(() => editor.save(), 400); }
});
play.onError = status;

function setTool(t) {
  if (play.active) return;
  if (t === 'vertex' || t === 'face') {
    const err = meshEdit.enter(editor.selected, t);
    if (err) { status(err); return; }
  } else meshEdit.exit();
  tool = t;
  status(t === 'vertex' ? 'Vertex mode: drag the white points' : t === 'face' ? 'Face mode: drag orange points, Extrude pulls out a face' : '');
  syncUI();
}
function setSculpt(name) {
  if (play.active) return;
  meshEdit.exit();
  if (!editor.objects.some((o) => o.userData.type === 'terrain')) editor.add('terrain', new THREE.Vector3(0, 0, 0));
  tool = 'sculpt'; sculptTool = name;
  status(`Sculpt: ${name}`);
  syncUI();
}
function doBoolean(op) { status(boolean(editor, op) || `${op} done`); setTool('translate'); }
function doExtrude() { if (tool !== 'face') { status('Switch to Faces first'); return; } status(meshEdit.extrude() || 'Extruded — drag the face to pull it'); syncUI(); }
function togglePlay() {
  if (play.active) { play.stop(); status('Stopped — scene restored'); }
  else { meshEdit.exit(); tool = 'translate'; play.start(); status('Playing — press Stop to return to editing'); }
  syncUI();
}
function cycle(list, cur) { return list[(list.indexOf(cur) + 1) % list.length]; }

// ---------- Files ----------
const downloadBlob = (blob, name) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
function pickFile(accept) {
  return new Promise((res) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => res(inp.files[0]); inp.click();
  });
}
function exportGLB() {
  meshEdit.exit(); tool = tool === 'vertex' || tool === 'face' ? 'translate' : tool;
  new GLTFExporter().parse(editor.world, (glb) => downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'world.glb'),
    (e) => status('Export failed: ' + e.message), { binary: true });
  syncUI();
}
async function importModel() {
  const f = await pickFile('.glb,.gltf,model/gltf-binary');
  if (!f) return;
  try { await editor.importModel(await f.arrayBuffer(), orbit.target.clone().setY(0)); status(`Imported ${f.name}`); }
  catch (e) { status(e.message + ' (use a single-file .glb)'); }
}

// ---------- Desktop UI ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.8, 0); orbit.update();
const gizmo = new TransformControls(camera, renderer.domElement);
scene.add(gizmo);
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  const o = gizmo.object;
  if (!o) return;
  if (o.userData.handle) { if (e.value) meshEdit.begin(o); else meshEdit.end(); return; }
  if (e.value) editor.checkpoint(); else { editor.applySnap(o); editor.emit(); }
});
gizmo.addEventListener('objectChange', () => { if (gizmo.object?.userData.handle) meshEdit.move(gizmo.object); editor.updateSelBox(); });

function syncGizmo() {
  let target = null;
  if (!play.active && !renderer.xr.isPresenting) {
    if (['translate', 'rotate', 'scale'].includes(tool)) { gizmo.setMode(tool); target = editor.selected; }
    else if (tool === 'vertex' || tool === 'face') { gizmo.setMode('translate'); target = meshEdit.active; }
  }
  if (target && target.parent) gizmo.attach(target); else gizmo.detach();
}

// Panel / toolbar state
$('texture').innerHTML = TEXTURES.map((t) => `<option>${t}</option>`).join('');
$('preset').innerHTML = '<option value="">Script presets…</option>' + Object.keys(SCRIPT_PRESETS).map((k) => `<option>${k}</option>`).join('');
function syncUI() {
  const s = editor.selected;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  document.querySelectorAll('[data-sculpt]').forEach((b) => b.classList.toggle('on', tool === 'sculpt' && b.dataset.sculpt === sculptTool));
  $('snap').classList.toggle('on', editor.snap);
  $('play').classList.toggle('on', play.active); $('play').textContent = play.active ? '■ Stop' : '▶ Play';
  $('selName').textContent = s ? `Selected: ${s.userData.type}` + (editor.secondary ? ' (B is set)' : '') : (editor.secondary ? 'B is set — now select A' : 'Nothing selected');
  if (s) {
    $('color').value = editor.colorOf(s);
    $('texture').value = s.userData.texture?.startsWith('image:') ? 'none' : (s.userData.texture || 'none');
    $('physics').value = s.userData.physics; $('mass').value = s.userData.mass;
    if (document.activeElement !== $('script')) $('script').value = s.userData.script || '';
  }
  for (const id of ['texture', 'uploadTex', 'physics', 'mass', 'script', 'applyScript', 'preset']) $(id).disabled = !s;
  orbit.mouseButtons.LEFT = tool === 'sculpt' ? null : THREE.MOUSE.ROTATE;
  orbit.mouseButtons.RIGHT = tool === 'sculpt' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  brushRing.visible = false;
  syncGizmo();
  palette.setStatus(statusLine());
}
function statusLine() {
  const s = editor.selected;
  return `${play.active ? 'PLAYING' : 'Tool: ' + (tool === 'sculpt' ? 'sculpt ' + sculptTool : tool === 'translate' ? 'move' : tool)}  |  ${s ? s.userData.type : 'no selection'}${editor.secondary ? '  |  B set' : ''}`;
}

document.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
  if (play.active) return;
  const type = b.dataset.add;
  const p = type === 'terrain' ? new THREE.Vector3() : orbit.target.clone().setY(Math.max(orbit.target.y, 0.3));
  if (type !== 'terrain') p.x += (editor.objects.length % 5 - 2) * 0.4;
  setTool('translate'); editor.add(type, p);
});
document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
document.querySelectorAll('[data-sculpt]').forEach((b) => b.onclick = () => setSculpt(b.dataset.sculpt));
document.querySelectorAll('[data-bool]').forEach((b) => b.onclick = () => doBoolean(b.dataset.bool));
$('setB').onclick = () => { editor.markSecondary(); status('B set. Now select A and choose Union / Subtract / Intersect'); };
$('extrude').onclick = doExtrude;
$('importModel').onclick = importModel;
$('color').oninput = () => editor.setColor($('color').value);
$('texture').onchange = () => editor.setTexture($('texture').value);
$('uploadTex').onclick = async () => { const f = await pickFile('image/*'); if (f) editor.setTexture(await imageFileToTextureName(f)); };
$('physics').onchange = () => editor.setProp('physics', $('physics').value);
$('mass').onchange = () => editor.setProp('mass', parseFloat($('mass').value) || 1);
$('preset').onchange = () => { $('script').value = SCRIPT_PRESETS[$('preset').value] ?? ''; $('preset').value = ''; };
$('applyScript').onclick = () => { editor.setProp('script', $('script').value); status('Script saved — press Play to run it'); };
$('dup').onclick = () => editor.duplicate();
$('del').onclick = () => { meshEdit.exit(); tool = tool === 'sculpt' ? tool : 'translate'; editor.remove(); };
$('undo').onclick = () => editor.undo();
$('snap').onclick = () => { editor.snap = !editor.snap; syncUI(); };
$('play').onclick = togglePlay;
$('saveFile').onclick = () => downloadBlob(new Blob([JSON.stringify(editor.exportFile())], { type: 'application/json' }), 'world.vrworld.json');
$('openFile').onclick = async () => {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try { meshEdit.exit(); tool = 'translate'; editor.importFile(JSON.parse(await f.text())); status(`Opened ${f.name}`); }
  catch (e) { status('Could not open file: ' + e.message); }
};
$('export').onclick = exportGLB;
$('clear').onclick = () => { meshEdit.exit(); tool = 'translate'; editor.clear(); };

// Mouse picking / sculpting
const mouseRay = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let downAt = null, mouseSculpting = false;
const terrains = () => editor.objects.filter((o) => o.userData.type === 'terrain');
const notHandle = (h) => !h.object.userData.handle && !h.object.parent?.userData.isHandleGroup;
function pickObject(ray) { return ray.intersectObjects(editor.objects, true).find(notHandle) || null; }
function setMouse(e) { mouse.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); mouseRay.setFromCamera(mouse, camera); }

const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  setMouse(e);
  if (tool === 'sculpt' && e.button === 0 && mouseRay.intersectObjects(terrains())[0]) { mouseSculpting = true; editor.checkpoint(); }
});
cv.addEventListener('pointermove', (e) => setMouse(e));
cv.addEventListener('pointerup', (e) => {
  if (mouseSculpting) { mouseSculpting = false; editor.emit(); return; }
  if (!downAt || e.button !== 0 || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo.dragging) return;
  setMouse(e);
  if (play.active) { // poke dynamic objects
    let o = pickObject(mouseRay)?.object; while (o && !o.userData.editable) o = o.parent;
    const b = o && play.bodyOf(o);
    if (b && b.mass > 0) { const d = mouseRay.ray.direction; b.wakeUp(); b.velocity.x += d.x * 4; b.velocity.y += d.y * 4 + 2; b.velocity.z += d.z * 4; }
    return;
  }
  if (tool === 'sculpt') return;
  if (tool === 'vertex' || tool === 'face') {
    const h = meshEdit.pick(mouseRay);
    if (h) { meshEdit.active = h; meshEdit.highlight(h); syncGizmo(); return; }
    const hit = pickObject(mouseRay);
    if (hit) { editor.select(hit.object); setTool(tool); } else setTool('translate');
    return;
  }
  const hit = pickObject(mouseRay);
  editor.select(hit?.object);
  editor.emit();
});
const keys = new Set();
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase(); keys.add(k);
  if (play.active) { if (k === 'p' || k === 'escape') togglePlay(); return; }
  if (k === 'w') setTool('translate'); else if (k === 'e') setTool('rotate'); else if (k === 'r') setTool('scale');
  else if (k === '1') setTool('vertex'); else if (k === '2') setTool('face'); else if (k === 'x') doExtrude();
  else if (k === 'p') togglePlay();
  else if (k === 'd') editor.duplicate();
  else if (k === 'delete' || k === 'backspace') $('del').onclick();
  else if (k === 'z' && (e.ctrlKey || e.metaKey)) editor.undo();
  else if (k === 'escape') setTool('translate');
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- VR palette ----------
const SWATCHES = ['#4f8cff', '#ff5a5a', '#5ad26b', '#ffd24a', '#b36bff', '#ffffff', '#333333', '#ff9f43', '#8b5a2b'];
let swatch = 0;
const sel = () => editor.selected;
const palette = new Palette();
const cap = (s) => s[0].toUpperCase() + s.slice(1);
palette.build({
  Create: [
    ...PRIMITIVES.map((t) => ({ label: cap(t), action: () => { setTool('translate'); vrSpawn(t); } })),
    { label: 'Light', action: () => vrSpawn('light') },
    { label: 'Terrain', action: () => { setTool('translate'); editor.add('terrain', new THREE.Vector3()); } },
    { label: 'Duplicate', action: () => editor.duplicate(), color: '#2f5a3a' },
    { label: 'Delete', action: () => $('del').onclick(), color: '#6a2f2f' },
    { label: 'Undo', action: () => editor.undo(), color: '#4a4a2f' },
    { label: () => `Snap ${editor.snap ? 'on' : 'off'}`, action: () => { editor.snap = !editor.snap; } },
  ],
  Edit: [
    { label: 'Object', active: () => tool === 'translate', action: () => setTool('translate') },
    { label: 'Vertices', active: () => tool === 'vertex', action: () => setTool('vertex') },
    { label: 'Faces', active: () => tool === 'face', action: () => setTool('face') },
    { label: 'Extrude', action: doExtrude, color: '#5a3f7a' },
    { label: 'Set B', action: () => { editor.markSecondary(); status('B set — now grab A'); }, color: '#7a2f6a' },
    { label: 'Union', action: () => doBoolean('union') },
    { label: 'Subtract', action: () => doBoolean('subtract') },
    { label: 'Intersect', action: () => doBoolean('intersect') },
    { label: 'Undo', action: () => editor.undo(), color: '#4a4a2f' },
  ],
  Paint: [
    { label: 'Color ▶', color: () => SWATCHES[swatch], action: () => { swatch = (swatch + 1) % SWATCHES.length; editor.setColor(SWATCHES[swatch]); } },
    { label: () => `Tex: ${editor.texture.startsWith('image:') ? 'image' : editor.texture}`, action: () => editor.setTexture(cycle(TEXTURES, sel()?.userData.texture ?? editor.texture)) },
    { label: () => `Phys: ${sel()?.userData.physics ?? '-'}`, action: () => sel() && editor.setProp('physics', cycle(['none', 'static', 'dynamic'], sel().userData.physics)) },
    { label: () => `Mass ${sel()?.userData.mass ?? '-'}`, action: () => sel() && editor.setProp('mass', cycle([0.2, 1, 5, 20], sel().userData.mass)) },
    { label: () => `Script: ${Object.keys(SCRIPT_PRESETS).find((k) => SCRIPT_PRESETS[k] === (sel()?.userData.script ?? '')) ?? 'custom'}`,
      action: () => { if (!sel()) return; const ks = Object.keys(SCRIPT_PRESETS); const cur = ks.find((k) => SCRIPT_PRESETS[k] === sel().userData.script) ?? 'none'; editor.setProp('script', SCRIPT_PRESETS[cycle(ks, cur)]); } },
  ],
  World: [
    ...SCULPT_TOOLS.map((s) => ({ label: cap(s), active: () => tool === 'sculpt' && sculptTool === s, action: () => setSculpt(s) })),
    { label: () => (play.active ? '■ Stop' : '▶ Play'), color: () => (play.active ? '#2e9e4f' : '#2f5a3a'), action: togglePlay },
    { label: 'Export GLB', action: exportGLB, color: '#2f4a6a' },
    { label: 'Clear All', action: () => $('clear').onclick(), color: '#6a2f2f' },
  ],
});

// ---------- VR input ----------
const modelFactory = new XRControllerModelFactory();
const handFactory = new XRHandModelFactory();
const hands = {}; // 'left' | 'right' -> hand record

function makeLine(color) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
}
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i), handSpace = renderer.xr.getHand(i);
  grip.add(modelFactory.createControllerModel(grip));
  handSpace.add(handFactory.createHandModel(handSpace, navigator.onLine ? 'mesh' : 'spheres'));
  rig.add(ctrl, grip, handSpace);
  const h = { ctrl, grip, line: makeLine(0xffffff), gamepad: null, prev: [], held: false };
  ctrl.add(h.line);
  ctrl.addEventListener('connected', (e) => {
    h.handedness = e.data.handedness; h.gamepad = e.data.gamepad || null; h.isHand = !!e.data.hand;
    hands[h.handedness] = h;
    if (h.handedness === 'left') { grip.add(palette.group); h.line.material.color.set(0x55ddff); }
  });
  ctrl.addEventListener('disconnected', () => { if (hands[h.handedness] === h) delete hands[h.handedness]; });
  ctrl.addEventListener('selectstart', () => { h.held = true; onTrigger(h); });
  ctrl.addEventListener('selectend', () => { h.held = false; onTriggerEnd(h); });
  ctrl.addEventListener('squeezestart', () => onSqueeze(h, true));
  ctrl.addEventListener('squeezeend', () => onSqueeze(h, false));
}

const ray = new THREE.Raycaster();
const tmpM = new THREE.Matrix4();
function setRay(h) {
  tmpM.identity().extractRotation(h.ctrl.matrixWorld);
  ray.ray.origin.setFromMatrixPosition(h.ctrl.matrixWorld);
  ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
}
function floorHit() { return ray.intersectObjects([...terrains(), floor])[0] || null; }

let grab = null;   // {hand, obj, offset, scale, prev, vel} or {hand, handle, local}
let vrSculpt = null; // hand that is sculpting

function vrSpawn(type) {
  const h = hands.right || hands.left;
  const p = new THREE.Vector3(0, 0, -0.5).applyMatrix4(h.ctrl.matrixWorld);
  editor.add(type, p);
}

function onTrigger(h) {
  setRay(h);
  if (h.handedness === 'left') { // teleport
    const hit = floorHit(); if (!hit) return;
    const cam = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
    rig.position.x += hit.point.x - cam.x; rig.position.z += hit.point.z - cam.z; rig.position.y = hit.point.y;
    return;
  }
  if (palette.group.parent) { const b = ray.intersectObjects(palette.buttons)[0]; if (b) { palette.press(b.object); return; } }
  if (tool === 'sculpt' && !play.active) { editor.checkpoint(); vrSculpt = h; return; }
  if (tool === 'vertex' || tool === 'face') {
    const hd = meshEdit.pick(ray);
    if (hd) { meshEdit.begin(hd); grab = { hand: h, handle: hd, local: h.ctrl.worldToLocal(hd.getWorldPosition(new THREE.Vector3())) }; return; }
    const hit = pickObject(ray);
    if (hit) { editor.select(hit.object); setTool(tool); }
    return;
  }
  const hit = pickObject(ray);
  if (!play.active) { editor.select(hit?.object); editor.emit(); }
  let obj = hit?.object; while (obj && !obj.userData.editable) obj = obj.parent;
  if (!obj) return;
  if (play.active) play.hold(obj); else editor.checkpoint();
  obj.updateMatrixWorld();
  grab = { hand: h, obj, offset: h.ctrl.matrixWorld.clone().invert().multiply(obj.matrixWorld), scale: null,
    prev: obj.getWorldPosition(new THREE.Vector3()), vel: new THREE.Vector3() };
}

function onTriggerEnd(h) {
  if (vrSculpt === h) { vrSculpt = null; editor.emit(); }
  if (!grab || grab.hand !== h) return;
  if (grab.handle) meshEdit.end();
  else if (play.active) play.release(grab.obj, grab.vel);
  else { editor.applySnap(grab.obj); editor.emit(); }
  grab = null;
}

function handDist() {
  return new THREE.Vector3().setFromMatrixPosition(hands.left.ctrl.matrixWorld)
    .distanceTo(new THREE.Vector3().setFromMatrixPosition(hands.right.ctrl.matrixWorld));
}
function onSqueeze(h, down) {
  if (h.handedness !== 'left' || !grab?.obj || !hands.right) return;
  if (down) grab.scale = { d0: handDist(), s0: grab.obj.scale.clone() };
  else { grab.scale = null; grab.obj.updateMatrixWorld(); grab.offset = grab.hand.ctrl.matrixWorld.clone().invert().multiply(grab.obj.matrixWorld); }
}

function pressed(h, i) { // xr-standard: 4 = A/X, 5 = B/Y
  const now = !!h.gamepad?.buttons[i]?.pressed, was = h.prev[i]; h.prev[i] = now;
  return now && !was;
}

let turnReady = true;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const vrInput = { axes: [0, 0, 0, 0], keys };
function updateVR(dt) {
  const L = hands.left, R = hands.right;
  const dead = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  if (L?.gamepad) {
    if (pressed(L, 4)) palette.group.parent ? L.grip.remove(palette.group) : L.grip.add(palette.group);
    if (pressed(L, 5)) editor.undo();
    const ax = dead(L.gamepad.axes[2] || 0), ay = dead(L.gamepad.axes[3] || 0);
    vrInput.axes[0] = ax; vrInput.axes[1] = ay;
    if (ax || ay) {
      renderer.xr.getCamera().getWorldDirection(fwd);
      right.crossVectors(fwd, up).normalize();
      rig.position.addScaledVector(fwd, -ay * 2.5 * dt).addScaledVector(right, ax * 2.5 * dt);
    }
  }
  if (R?.gamepad) {
    if (pressed(R, 4) && !play.active) editor.duplicate();
    if (pressed(R, 5) && !play.active) { grab = null; $('del').onclick(); }
    const rx = dead(R.gamepad.axes[2] || 0), ry = dead(R.gamepad.axes[3] || 0);
    vrInput.axes[2] = rx; vrInput.axes[3] = ry;
    if (grab?.obj) { if (ry) grab.offset.premultiply(tmpM.makeTranslation(0, 0, ry * 1.5 * dt)); }
    else if (tool === 'sculpt' && ry) { brushRadius = THREE.MathUtils.clamp(brushRadius - ry * dt * 2, 0.2, 5); }
    else rig.position.y = Math.max(-50, rig.position.y - ry * 1.5 * dt);
    if (!grab?.obj) {
      if (Math.abs(rx) > 0.7 && turnReady) {
        turnReady = false;
        const pivot = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
        const ang = -Math.sign(rx) * Math.PI / 6;
        rig.position.sub(pivot).applyAxisAngle(up, ang).add(pivot); rig.rotateY(ang);
      } else if (Math.abs(rx) < 0.3) turnReady = true;
    }
  }

  rig.updateMatrixWorld(true);
  if (grab?.handle) {
    const w = grab.hand.ctrl.localToWorld(grab.local.clone());
    grab.handle.position.copy(grab.handle.parent.worldToLocal(w));
    meshEdit.move(grab.handle); editor.updateSelBox();
  } else if (grab?.obj) {
    const m = grab.hand.ctrl.matrixWorld.clone().multiply(grab.offset);
    m.premultiply(tmpM.copy(editor.world.matrixWorld).invert());
    const s = new THREE.Vector3();
    m.decompose(grab.obj.position, grab.obj.quaternion, s);
    grab.obj.scale.copy(grab.scale && L ? grab.scale.s0.clone().multiplyScalar(Math.max(0.05, handDist() / grab.scale.d0)) : s);
    const p = grab.obj.getWorldPosition(new THREE.Vector3());
    grab.vel.lerp(p.clone().sub(grab.prev).divideScalar(Math.max(dt, 1e-3)), 0.5); grab.prev.copy(p);
    if (play.active) play.follow(grab.obj);
    editor.updateSelBox();
  }

  // Rays, palette hover, sculpt brush
  brushRing.visible = false;
  if (L) { setRay(L); const hit = floorHit(); L.line.scale.z = hit ? hit.distance : 3; L.line.visible = true; }
  if (R) {
    setRay(R);
    let len = 5, btn = null;
    if (palette.group.parent) { const b = ray.intersectObjects(palette.buttons)[0]; if (b) { btn = b.object; len = b.distance; } }
    let color = 0xffffff;
    if (btn) color = 0x66ccff;
    else if (tool === 'sculpt' && !play.active) {
      const hit = ray.intersectObjects(terrains())[0];
      if (hit) {
        len = hit.distance; color = 0xffee55;
        brushRing.visible = true; brushRing.position.copy(hit.point).y += 0.03; brushRing.scale.setScalar(brushRadius);
        if (vrSculpt === R) sculpt(hit.object, sculptTool, hit.point, dt, brushRadius);
      }
    } else {
      const hit = pickObject(ray);
      if (hit) { len = hit.distance; color = 0xffcc00; }
    }
    R.line.material.color.set(color);
    R.line.scale.z = grab?.obj ? Math.max(0.05, -grab.offset.elements[14]) : len;
    palette.hover(btn);
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  rig.position.set(0, 0, 2); camera.position.set(0, 0, 0); syncUI();
});
renderer.xr.addEventListener('sessionend', () => {
  grab = null; vrSculpt = null;
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  camera.position.set(0, 1.6, 2); orbit.update(); syncUI();
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) updateVR(dt);
  else if (tool === 'sculpt' && !play.active) {
    const hit = mouseRay.intersectObjects(terrains())[0];
    brushRing.visible = !!hit;
    if (hit) {
      brushRing.position.copy(hit.point).y += 0.03; brushRing.scale.setScalar(brushRadius);
      if (mouseSculpting) sculpt(hit.object, sculptTool, hit.point, dt, brushRadius);
    }
  }
  if (play.active) play.step(dt, renderer.xr.isPresenting ? vrInput : { axes: [0, 0, 0, 0], keys });
  renderer.render(scene, camera);
});

editor.load().then(() => { editor.undoStack.length = 0; syncUI(); });
syncUI();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__app = { editor, meshEdit, play, THREE, setTool, setSculpt, doBoolean, palette, sculpt }; // for debugging in devtools

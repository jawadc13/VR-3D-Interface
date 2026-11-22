import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Editor, PRIMITIVES } from './editor.js';
import { Palette } from './palette.js';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8c8);
scene.fog = new THREE.Fog(0x87a8c8, 15, 60);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 200);
camera.position.set(0, 1.6, 1.5);

// The rig holds the camera + controllers so locomotion moves the whole player.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x5c6b5a }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(40, 160, 0x334433, 0x4a584a);
grid.position.y = 0.001;
scene.add(grid);

const editor = new Editor(scene);
editor.load(); editor.undoStack.length = 0;

// ---------- Shared actions ----------
const downloadBlob = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
function exportGLB() {
  editor.selBox.visible = false;
  new GLTFExporter().parse(editor.world, (glb) => {
    downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'world.glb');
    editor.updateSelBox();
  }, (e) => console.error(e), { binary: true });
}
function exportJSON() {
  downloadBlob(new Blob([JSON.stringify(editor.serialize(), null, 2)], { type: 'application/json' }), 'world.json');
}
function importJSON() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    editor.checkpoint();
    editor.deserialize(JSON.parse(await f.text()));
  };
  inp.click();
}
editor.onChange(() => editor.save()); // autosave

// ---------- Desktop UI ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1, 0); orbit.update();
const gizmo = new TransformControls(camera, renderer.domElement);
scene.add(gizmo);
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (e.value) editor.checkpoint();
  else { editor.applySnap(gizmo.object); editor.emit(); }
});
gizmo.addEventListener('objectChange', () => editor.updateSelBox());
editor.onChange(() => {
  if (editor.selected && editor.selected.parent) gizmo.attach(editor.selected); else gizmo.detach();
  editor.updateSelBox();
});

const $ = (id) => document.getElementById(id);
const colorInput = $('color');
document.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
  const p = orbit.target.clone(); p.y = Math.max(p.y, 0.3);
  p.x += (editor.objects.length % 5 - 2) * 0.4; // spread new objects out
  editor.add(b.dataset.add, p);
});
document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => gizmo.setMode(b.dataset.mode));
colorInput.oninput = () => editor.setColor(colorInput.value);
$('dup').onclick = () => editor.duplicate();
$('del').onclick = () => editor.remove();
$('undo').onclick = () => editor.undo();
$('snap').onclick = () => { editor.snap = !editor.snap; $('snap').textContent = `Snap: ${editor.snap ? 'on' : 'off'}`; };
$('save').onclick = exportJSON;
$('load').onclick = () => editor.load();
$('import').onclick = importJSON;
$('export').onclick = exportGLB;
$('clear').onclick = () => editor.clear();

const mouseRay = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || gizmo.dragging) return;
  mouseRay.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1), camera);
  const hit = mouseRay.intersectObjects(editor.objects, true)[0];
  editor.select(hit?.object);
  if (editor.selected) colorInput.value = editor.colorOf(editor.selected);
  editor.emit();
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'w') gizmo.setMode('translate');
  else if (k === 'e') gizmo.setMode('rotate');
  else if (k === 'r') gizmo.setMode('scale');
  else if (k === 'd') editor.duplicate();
  else if (k === 'delete' || k === 'backspace') editor.remove();
  else if (k === 'z' && (e.ctrlKey || e.metaKey)) editor.undo();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- VR ----------
const SWATCHES = ['#4f8cff', '#ff5a5a', '#5ad26b', '#ffd24a', '#b36bff', '#ffffff', '#333333', '#ff9f43', '#8b5a2b'];
const palette = new Palette();
let swatchIdx = 0;
palette.build([
  ...PRIMITIVES.map((t) => ({ label: t[0].toUpperCase() + t.slice(1), action: () => vrSpawn(t) })),
  { label: 'Light', action: () => vrSpawn('light') },
  { label: 'Color', getLabel: () => 'Color ▶', get color() { return SWATCHES[swatchIdx]; },
    action: () => { swatchIdx = (swatchIdx + 1) % SWATCHES.length; editor.setColor(SWATCHES[swatchIdx]); } },
  { label: 'Snap', getLabel: () => `Snap ${editor.snap ? 'ON' : 'OFF'}`, action: () => { editor.snap = !editor.snap; } },
  { label: 'Duplicate', action: () => editor.duplicate(), color: '#2f5a3a' },
  { label: 'Delete', action: () => editor.remove(), color: '#6a2f2f' },
  { label: 'Undo', action: () => editor.undo(), color: '#4a4a2f' },
  { label: 'Export GLB', action: exportGLB, color: '#2f4a6a' },
  { label: 'Clear All', action: () => editor.clear(), color: '#6a2f2f' },
]);
// Color button tint must track the current swatch.
const colorBtn = palette.buttons[PRIMITIVES.length + 1];
const origRefresh = palette.refresh.bind(palette);
palette.refresh = () => { colorBtn.userData.bg = SWATCHES[swatchIdx]; origRefresh(); };
palette.refresh();

const modelFactory = new XRControllerModelFactory();
const hands = {}; // 'left' | 'right' -> {ctrl, grip, line, gamepad, prev buttons}

function makeLine() {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff }));
  l.scale.z = 5;
  return l;
}

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(modelFactory.createControllerModel(grip));
  rig.add(ctrl, grip);
  const h = { ctrl, grip, line: makeLine(), gamepad: null, prev: [] };
  ctrl.add(h.line);
  ctrl.addEventListener('connected', (e) => {
    h.handedness = e.data.handedness;
    h.gamepad = e.data.gamepad;
    hands[h.handedness] = h;
    if (h.handedness === 'left') { grip.add(palette.group); h.line.visible = false; }
  });
  ctrl.addEventListener('disconnected', () => { if (hands[h.handedness] === h) delete hands[h.handedness]; });
  ctrl.addEventListener('selectstart', () => onTrigger(h));
  ctrl.addEventListener('selectend', () => onTriggerEnd(h));
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

let grab = null; // {hand, obj, offset: Matrix4, scale: {d0, s0}|null}

function vrSpawn(type) {
  const h = hands.right || hands.left;
  const p = new THREE.Vector3(0, 0, -0.5).applyMatrix4(h.ctrl.matrixWorld);
  editor.add(type, p);
}

function onTrigger(h) {
  if (h.handedness === 'left') return;
  setRay(h);
  if (palette.group.parent) {
    const b = ray.intersectObjects(palette.buttons)[0];
    if (b) { palette.press(b.object); return; }
  }
  const hit = ray.intersectObjects(editor.objects, true)[0];
  editor.select(hit?.object);
  editor.emit();
  if (!editor.selected) return;
  editor.checkpoint();
  const obj = editor.selected;
  obj.updateMatrixWorld();
  grab = { hand: h, obj, offset: h.ctrl.matrixWorld.clone().invert().multiply(obj.matrixWorld), scale: null };
}

function onTriggerEnd(h) {
  if (!grab || grab.hand !== h) return;
  editor.applySnap(grab.obj);
  grab = null;
  editor.emit();
}

function handDist() {
  const a = new THREE.Vector3().setFromMatrixPosition(hands.left.ctrl.matrixWorld);
  return a.distanceTo(new THREE.Vector3().setFromMatrixPosition(hands.right.ctrl.matrixWorld));
}
function onSqueeze(h, down) {
  if (h.handedness !== 'left' || !grab || !hands.right) return;
  if (down) grab.scale = { d0: handDist(), s0: grab.obj.scale.clone() };
  else {
    grab.scale = null;
    grab.obj.updateMatrixWorld();
    grab.offset = grab.hand.ctrl.matrixWorld.clone().invert().multiply(grab.obj.matrixWorld);
  }
}

// Button indices on Quest Touch (xr-standard): 4 = A/X, 5 = B/Y
function pressed(h, i) {
  const now = !!h.gamepad?.buttons[i]?.pressed;
  const was = h.prev[i]; h.prev[i] = now;
  return now && !was;
}

let turnReady = true;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
function updateVR(dt) {
  const L = hands.left, R = hands.right;
  const dead = (v) => Math.abs(v) < 0.15 ? 0 : v;

  if (L?.gamepad) {
    if (pressed(L, 4)) palette.group.parent ? L.grip.remove(palette.group) : L.grip.add(palette.group);
    if (pressed(L, 5)) editor.undo();
    // Fly in the direction you're looking.
    const ax = dead(L.gamepad.axes[2] || 0), ay = dead(L.gamepad.axes[3] || 0);
    if (ax || ay) {
      const xrCam = renderer.xr.getCamera();
      xrCam.getWorldDirection(fwd);
      right.crossVectors(fwd, up).normalize();
      rig.position.addScaledVector(fwd, -ay * 2.5 * dt).addScaledVector(right, ax * 2.5 * dt);
    }
  }
  if (R?.gamepad) {
    if (pressed(R, 4)) editor.duplicate();
    if (pressed(R, 5)) { if (grab) grab = null; editor.remove(); }
    const rx = dead(R.gamepad.axes[2] || 0), ry = dead(R.gamepad.axes[3] || 0);
    if (grab) {
      // Push / pull the held object along the ray.
      if (ry) grab.offset.premultiply(tmpM.makeTranslation(0, 0, ry * 1.5 * dt));
    } else {
      rig.position.y = Math.max(0, rig.position.y - ry * 1.5 * dt);
      if (Math.abs(rx) > 0.7 && turnReady) {
        turnReady = false;
        const pivot = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
        const ang = -Math.sign(rx) * Math.PI / 6;
        rig.position.sub(pivot).applyAxisAngle(up, ang).add(pivot);
        rig.rotateY(ang);
      } else if (Math.abs(rx) < 0.3) turnReady = true;
    }
  }

  rig.updateMatrixWorld(true);
  if (grab) {
    const m = grab.hand.ctrl.matrixWorld.clone().multiply(grab.offset);
    m.premultiply(tmpM.copy(editor.world.matrixWorld).invert());
    const s = new THREE.Vector3();
    m.decompose(grab.obj.position, grab.obj.quaternion, s);
    grab.obj.scale.copy(grab.scale && L ? grab.scale.s0.clone().multiplyScalar(Math.max(0.05, handDist() / grab.scale.d0)) : s);
    editor.updateSelBox();
  }

  // Ray feedback & palette hover.
  if (R) {
    setRay(R);
    let len = 5, btn = null;
    if (palette.group.parent) {
      const b = ray.intersectObjects(palette.buttons)[0];
      if (b) { btn = b.object; len = b.distance; }
    }
    if (!btn) {
      const hit = ray.intersectObjects(editor.objects, true)[0];
      if (hit) len = hit.distance;
      R.line.material.color.set(hit ? 0xffcc00 : 0xffffff);
    } else R.line.material.color.set(0x66ccff);
    R.line.scale.z = grab ? grab.offset.elements[14] * -1 || 0.5 : len;
    palette.hover(btn);
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  gizmo.detach(); gizmo.visible = false;
  rig.position.set(0, 0, 1.5);
  camera.position.set(0, 0, 0);
});
renderer.xr.addEventListener('sessionend', () => {
  grab = null; gizmo.visible = true;
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  camera.position.set(0, 1.6, 1.5); orbit.update();
  editor.emit();
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) updateVR(dt);
  renderer.render(scene, camera);
});

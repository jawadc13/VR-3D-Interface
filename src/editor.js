// Core scene model: creating, serializing, undo, selection, persistence.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTexture } from './textures.js';
import * as store from './store.js';

const GEOMETRIES = {
  box: () => new THREE.BoxGeometry(0.3, 0.3, 0.3),
  sphere: () => new THREE.SphereGeometry(0.18, 16, 12),
  cylinder: () => new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16),
  cone: () => new THREE.ConeGeometry(0.17, 0.35, 16),
  torus: () => new THREE.TorusGeometry(0.15, 0.05, 10, 24),
  plane: () => new THREE.BoxGeometry(1, 0.02, 1),
  terrain: () => {
    const g = new THREE.PlaneGeometry(10, 10, 64, 64);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; // tile the texture across the terrain
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 10);
    return g;
  },
};
export const PRIMITIVES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'];

const round = (a) => Array.from(a, (v) => Math.round(v * 1e4) / 1e4);
export function geometryToJSON(g) {
  return { position: round(g.attributes.position.array), uv: g.attributes.uv ? round(g.attributes.uv.array) : null,
    index: g.index ? Array.from(g.index.array) : null };
}
export function geometryFromJSON(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.position, 3));
  if (d.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  if (d.index) g.setIndex(d.index);
  g.computeVertexNormals();
  return g;
}

const gltfLoader = new GLTFLoader();
const parsedAssets = new Map(); // assetId -> Promise<THREE.Object3D>

export class Editor {
  constructor(scene) {
    this.scene = scene;
    this.world = new THREE.Group();
    this.world.name = 'World';
    scene.add(this.world);
    this.selected = null;
    this.secondary = null; // "B" object for booleans
    this.color = '#4f8cff';
    this.texture = 'none';
    this.snap = true;
    this.undoStack = [];
    this.assets = new Map(); // assetId -> ArrayBuffer (.glb)
    this.listeners = new Set();
    this.selBox = new THREE.BoxHelper(undefined, 0xffcc00);
    this.bBox = new THREE.BoxHelper(undefined, 0xff44ff);
    this.selBox.visible = this.bBox.visible = false;
    scene.add(this.selBox, this.bBox);
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach((f) => f()); }
  get objects() { return this.world.children; }

  create(type, o = {}) {
    let obj;
    const color = o.color || this.color;
    if (type === 'light') {
      obj = new THREE.PointLight(color, 2, 6);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8), new THREE.MeshBasicMaterial({ color }));
      obj.add(bulb);
    } else if (type === 'model') {
      obj = new THREE.Group();
      obj.userData.assetId = o.assetId;
      this.loadAsset(o.assetId).then((src) => { if (src) obj.add(src.clone(true)); this.updateSelBox(); });
    } else {
      const geo = o.geometry ? geometryFromJSON(o.geometry) : GEOMETRIES[type]();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
      obj = new THREE.Mesh(geo, mat);
      obj.castShadow = obj.receiveShadow = true;
    }
    Object.assign(obj.userData, { type, editable: true, physics: o.physics || (type === 'terrain' ? 'static' : 'none'),
      mass: o.mass ?? 1, script: o.script || '', texture: 'none' });
    if (obj.isMesh) this.applyTexture(obj, o.texture ?? (type === 'terrain' ? 'grass' : this.texture));
    if (o.position) obj.position.fromArray(o.position);
    if (o.quaternion) obj.quaternion.fromArray(o.quaternion);
    if (o.scale) obj.scale.fromArray(o.scale);
    this.world.add(obj);
    return obj;
  }

  loadAsset(id) {
    if (!parsedAssets.has(id)) {
      const buf = this.assets.get(id);
      parsedAssets.set(id, buf ? gltfLoader.parseAsync(buf, '').then((g) => g.scene).catch((e) => { console.error(e); return null; })
        : Promise.resolve(null));
    }
    return parsedAssets.get(id);
  }

  async importModel(arrayBuffer, position) {
    const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.assets.set(id, arrayBuffer);
    const src = await this.loadAsset(id);
    if (!src) { this.assets.delete(id); throw new Error('Could not read that model file'); }
    this.checkpoint();
    const obj = this.create('model', { assetId: id, position: position?.toArray() });
    // Normalise huge / tiny models to ~1 m.
    const size = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()).length();
    if (size > 0) obj.scale.setScalar(1 / size);
    this.select(obj); this.emit();
    return obj;
  }

  add(type, position) {
    this.checkpoint();
    const obj = this.create(type, { position: position?.toArray() });
    this.select(obj);
    this.emit();
    return obj;
  }

  colorOf(obj) {
    if (obj.isLight) return '#' + obj.color.getHexString();
    if (obj.material) return '#' + obj.material.color.getHexString();
    return '#ffffff';
  }

  setColor(hex) {
    this.color = hex;
    const o = this.selected;
    if (!o || o.userData.type === 'model') return;
    this.checkpoint();
    if (o.isLight) { o.color.set(hex); o.children[0].material.color.set(hex); } else o.material.color.set(hex);
    this.emit();
  }

  applyTexture(obj, name) {
    obj.userData.texture = name || 'none';
    obj.material.map = getTexture(name);
    obj.material.needsUpdate = true;
  }
  setTexture(name) {
    this.texture = name;
    const o = this.selected;
    if (!o || !o.isMesh) return;
    this.checkpoint(); this.applyTexture(o, name); this.emit();
  }

  setProp(key, value) {
    if (!this.selected) return;
    this.checkpoint(); this.selected.userData[key] = value; this.emit();
  }

  select(obj) {
    while (obj && !obj.userData.editable) obj = obj.parent;
    this.selected = obj || null;
    if (this.secondary === this.selected) this.secondary = null;
    this.updateSelBox();
  }
  markSecondary() {
    this.secondary = this.selected;
    this.selected = null;
    this.updateSelBox(); this.emit();
  }

  updateSelBox() {
    for (const [box, o] of [[this.selBox, this.selected], [this.bBox, this.secondary]]) {
      if (o && o.parent) { box.setFromObject(o); box.visible = true; } else box.visible = false;
    }
  }

  duplicate() {
    const o = this.selected;
    if (!o) return;
    this.checkpoint();
    const d = this.serializeOne(o);
    const copy = this.create(d.type, d);
    copy.position.x += 0.35;
    this.select(copy);
    this.emit();
  }

  dispose(o) {
    this.world.remove(o);
    o.traverse((c) => { if (o.userData.type !== 'model') { c.geometry?.dispose(); c.material?.dispose(); } });
  }
  remove() {
    const o = this.selected;
    if (!o) return;
    this.checkpoint();
    this.dispose(o);
    this.select(null);
    this.emit();
  }
  clear(record = true) {
    if (record) this.checkpoint();
    [...this.objects].forEach((o) => this.dispose(o));
    this.secondary = null;
    this.select(null);
    this.emit();
  }

  applySnap(obj) {
    if (!this.snap) return;
    const g = 0.05;
    obj.position.set(Math.round(obj.position.x / g) * g, Math.round(obj.position.y / g) * g, Math.round(obj.position.z / g) * g);
    const step = THREE.MathUtils.degToRad(15);
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion);
    e.set(Math.round(e.x / step) * step, Math.round(e.y / step) * step, Math.round(e.z / step) * step);
    obj.quaternion.setFromEuler(e);
  }

  serializeOne(o) {
    const u = o.userData;
    const d = { type: u.type, color: this.colorOf(o), texture: u.texture, physics: u.physics, mass: u.mass, script: u.script,
      position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray() };
    if (u.type === 'mesh' || u.type === 'terrain') d.geometry = geometryToJSON(o.geometry);
    if (u.type === 'model') d.assetId = u.assetId;
    return d;
  }
  serialize() { return { version: 2, objects: this.objects.map((o) => this.serializeOne(o)) }; }
  deserialize(data) {
    const selIdx = this.objects.indexOf(this.selected);
    this.clear(false);
    (data.objects || []).forEach((d) => this.create(d.type, d));
    if (selIdx >= 0 && this.objects[selIdx]) this.select(this.objects[selIdx]);
    this.emit();
  }

  checkpoint() {
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }
  undo() {
    const s = this.undoStack.pop();
    if (s) this.deserialize(JSON.parse(s));
  }

  // ---- persistence (IndexedDB: scene JSON + model files) ----
  async save() {
    const data = this.serialize();
    await store.put('scene', data);
    const used = new Set(data.objects.filter((o) => o.assetId).map((o) => o.assetId));
    for (const id of used) if (!(await store.get('asset:' + id))) await store.put('asset:' + id, this.assets.get(id));
  }
  async load() {
    let data = await store.get('scene');
    if (!data) { const legacy = localStorage.getItem('vrwb-scene'); if (legacy) data = JSON.parse(legacy); }
    if (!data) return false;
    for (const o of data.objects) if (o.assetId && !this.assets.has(o.assetId)) {
      const buf = await store.get('asset:' + o.assetId); if (buf) this.assets.set(o.assetId, buf);
    }
    this.deserialize(data);
    return true;
  }

  // Portable file: scene + embedded model files as base64.
  exportFile() {
    const data = this.serialize();
    data.assets = {};
    for (const o of data.objects) if (o.assetId && this.assets.has(o.assetId)) {
      const bytes = new Uint8Array(this.assets.get(o.assetId)); let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      data.assets[o.assetId] = btoa(s);
    }
    return data;
  }
  importFile(data) {
    for (const [id, b64] of Object.entries(data.assets || {})) {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.assets.set(id, bytes.buffer);
    }
    this.checkpoint();
    this.deserialize(data);
  }
}

// Core scene model: creating, serializing, undo, selection.
import * as THREE from 'three';

const GEOMETRIES = {
  box: () => new THREE.BoxGeometry(0.3, 0.3, 0.3),
  sphere: () => new THREE.SphereGeometry(0.18, 32, 16),
  cylinder: () => new THREE.CylinderGeometry(0.15, 0.15, 0.3, 32),
  cone: () => new THREE.ConeGeometry(0.17, 0.35, 32),
  torus: () => new THREE.TorusGeometry(0.15, 0.05, 16, 48),
  plane: () => new THREE.BoxGeometry(1, 0.02, 1),
};
export const PRIMITIVES = Object.keys(GEOMETRIES);

export class Editor {
  constructor(scene) {
    this.world = new THREE.Group();
    this.world.name = 'World';
    scene.add(this.world);
    this.selected = null;
    this.color = '#4f8cff';
    this.snap = true;
    this.undoStack = [];
    this.listeners = new Set();
    this.selBox = new THREE.BoxHelper(undefined, 0xffcc00);
    this.selBox.visible = false;
    scene.add(this.selBox);
  }

  onChange(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach((f) => f()); }

  get objects() { return this.world.children; }

  create(type, opts = {}) {
    let obj;
    if (type === 'light') {
      obj = new THREE.PointLight(opts.color || this.color, 2, 6);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8),
        new THREE.MeshBasicMaterial({ color: opts.color || this.color }));
      bulb.userData.pickProxy = true;
      obj.add(bulb);
    } else {
      const geo = GEOMETRIES[type]();
      const mat = new THREE.MeshStandardMaterial({ color: opts.color || this.color, roughness: 0.5, metalness: 0.1 });
      obj = new THREE.Mesh(geo, mat);
      obj.castShadow = obj.receiveShadow = true;
    }
    obj.userData.type = type;
    obj.userData.editable = true;
    if (opts.position) obj.position.fromArray(opts.position);
    if (opts.quaternion) obj.quaternion.fromArray(opts.quaternion);
    if (opts.scale) obj.scale.fromArray(opts.scale);
    this.world.add(obj);
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
    return '#' + (obj.isLight ? obj.color : obj.material.color).getHexString();
  }

  setColor(hex) {
    this.color = hex;
    const o = this.selected;
    if (!o) return;
    this.checkpoint();
    if (o.isLight) { o.color.set(hex); o.children[0].material.color.set(hex); }
    else o.material.color.set(hex);
    this.emit();
  }

  select(obj) {
    // Climb from a picked child (e.g. light bulb) up to the editable root.
    while (obj && !obj.userData.editable) obj = obj.parent;
    this.selected = obj || null;
    this.updateSelBox();
  }

  updateSelBox() {
    if (this.selected) { this.selBox.setFromObject(this.selected); this.selBox.visible = true; }
    else this.selBox.visible = false;
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

  remove() {
    const o = this.selected;
    if (!o) return;
    this.checkpoint();
    this.world.remove(o);
    o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
    this.select(null);
    this.emit();
  }

  clear(record = true) {
    if (record) this.checkpoint();
    [...this.objects].forEach((o) => { this.world.remove(o); o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); }); });
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
    return { type: o.userData.type, color: this.colorOf(o),
      position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray() };
  }
  serialize() { return { version: 1, objects: this.objects.map((o) => this.serializeOne(o)) }; }
  deserialize(data) {
    this.clear(false);
    (data.objects || []).forEach((d) => this.create(d.type, d));
    this.emit();
  }

  checkpoint() {
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }
  undo() {
    const s = this.undoStack.pop();
    if (s) this.deserialize(JSON.parse(s));
  }

  save() { localStorage.setItem('vrwb-scene', JSON.stringify(this.serialize())); }
  load() {
    const s = localStorage.getItem('vrwb-scene');
    if (!s) return false;
    this.checkpoint();
    this.deserialize(JSON.parse(s));
    return true;
  }
}

// Vertex / face editing: handles you can drag, plus face extrusion.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
const handleGeo = new THREE.SphereGeometry(1, 10, 8);
const MAX_HANDLES = 1500;

// Turn any object (primitive, model) into an editable indexed 'mesh' with position + uv.
export function toEditable(obj) {
  if (obj.userData.type === 'mesh' && obj.geometry.index) return obj;
  if (obj.userData.type === 'light' || obj.userData.type === 'terrain') return null;
  let geo;
  if (obj.isMesh) geo = obj.geometry.clone();
  else { // imported model: bake all child meshes into one geometry, relative to obj
    obj.updateMatrixWorld(true);
    const inv = obj.matrixWorld.clone().invert(), parts = [];
    obj.traverse((c) => {
      if (!c.isMesh) return;
      let g = c.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'uv') g.deleteAttribute(n);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      parts.push(g);
    });
    if (!parts.length) return null;
    geo = mergeGeometries(parts);
    obj.clear();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.copy(obj.position); mesh.quaternion.copy(obj.quaternion); mesh.scale.copy(obj.scale);
    mesh.userData = { ...obj.userData };
    delete mesh.userData.assetId;
    obj.parent.add(mesh); obj.parent.remove(obj);
    obj = mesh;
  }
  for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'uv') geo.deleteAttribute(n);
  geo.clearGroups();
  if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
  geo.computeVertexNormals();
  if (obj.isMesh && obj.geometry !== geo) { obj.geometry.dispose(); obj.geometry = geo; }
  obj.userData.type = 'mesh';
  return obj;
}

export class MeshEdit {
  constructor(editor) {
    this.editor = editor;
    this.mode = null; // 'vertex' | 'face'
    this.obj = null;
    this.group = null;
    this.handles = [];
    this.active = null; // last touched handle
  }

  enter(obj, mode) {
    this.exit();
    if (!obj) return 'Select an object first';
    if (obj.userData.type === 'terrain') return 'Use the sculpt tools on terrain';
    this.editor.checkpoint();
    const e = toEditable(obj);
    if (!e) { this.editor.undoStack.pop(); return 'This object can\'t be mesh-edited'; }
    this.editor.select(e);
    this.obj = e; this.mode = mode;
    this.rebuild();
    this.editor.emit();
    return null;
  }

  exit() {
    if (this.group) { this.group.parent?.remove(this.group); this.group = null; }
    this.handles = []; this.obj = null; this.mode = null; this.active = null;
  }

  // Re-read the geometry and recreate handles.
  rebuild() {
    const obj = this.obj;
    if (this.group) obj.remove(this.group);
    this.group = new THREE.Group(); this.group.userData.isHandleGroup = true;
    obj.add(this.group);
    this.handles = [];
    const pos = obj.geometry.attributes.position, idx = obj.geometry.index.array;
    const byKey = new Map(); // position key -> [vertex indices]
    const used = new Set(idx);
    for (const i of used) {
      const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(i);
    }
    const r = 0.012 * (this.mode === 'face' ? 1.3 : 1);
    const mk = (p, indices, color, extra = {}) => {
      if (this.handles.length >= MAX_HANDLES) return;
      const h = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      h.renderOrder = 10;
      h.position.copy(p);
      h.scale.set(r / obj.scale.x, r / obj.scale.y, r / obj.scale.z);
      Object.assign(h.userData, { handle: true, indices, baseColor: color, ...extra });
      this.group.add(h); this.handles.push(h);
    };

    if (this.mode === 'vertex') {
      for (const list of byKey.values()) mk(new THREE.Vector3().fromBufferAttribute(pos, list[0]), list, 0xffffff);
    } else {
      // Faces = coplanar triangle groups.
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      const faces = new Map();
      for (let t = 0; t < idx.length; t += 3) {
        a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
        n.subVectors(c, b).cross(b.clone().sub(a)).negate();
        if (n.lengthSq() < 1e-14) continue;
        n.normalize();
        const fk = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)},${n.dot(a).toFixed(3)}`;
        if (!faces.has(fk)) faces.set(fk, { tris: [], normal: n.clone() });
        faces.get(fk).tris.push(t);
      }
      for (const f of faces.values()) {
        const keys = new Set(), centroid = new THREE.Vector3(), seen = new Set();
        for (const t of f.tris) for (let j = 0; j < 3; j++) {
          const i = idx[t + j], k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
          keys.add(k);
          if (!seen.has(k)) { seen.add(k); centroid.add(new THREE.Vector3().fromBufferAttribute(pos, i)); }
        }
        centroid.divideScalar(seen.size);
        const indices = [...keys].flatMap((k) => byKey.get(k));
        mk(centroid, indices, 0xff9933, { tris: f.tris, normal: f.normal });
      }
    }
    if (this.handles.length >= MAX_HANDLES) console.warn('Too many handles; showing first', MAX_HANDLES);
  }

  pick(raycaster) {
    if (!this.group) return null;
    // Handles are tiny; test against a slightly fattened sphere for easier VR picking.
    let best = null, bestD = Infinity;
    const p = new THREE.Vector3();
    for (const h of this.handles) {
      h.getWorldPosition(p);
      const d = raycaster.ray.distanceSqToPoint(p);
      const along = p.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction);
      const tol = 0.02 + along * 0.015;
      if (along > 0 && d < tol * tol && along < bestD) { best = h; bestD = along; }
    }
    return best;
  }

  highlight(h) {
    for (const x of this.handles) x.material.color.set(x === h ? 0xffee00 : x.userData.baseColor);
  }

  begin(h) {
    this.editor.checkpoint();
    this.active = h;
    this.highlight(h);
    const pos = this.obj.geometry.attributes.position;
    h.userData.origin = h.position.clone();
    h.userData.start = h.userData.indices.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
  }

  move(h) {
    const pos = this.obj.geometry.attributes.position;
    const d = h.position.clone().sub(h.userData.origin);
    h.userData.indices.forEach((i, j) => {
      const s = h.userData.start[j];
      pos.setXYZ(i, s.x + d.x, s.y + d.y, s.z + d.z);
    });
    pos.needsUpdate = true;
    this.obj.geometry.computeVertexNormals();
    this.obj.geometry.computeBoundingBox(); this.obj.geometry.computeBoundingSphere();
  }

  end() {
    const a = this.active;
    this.rebuild();
    // Keep the same face/vertex highlighted after rebuild (closest handle to where it ended).
    if (a) {
      let best = null, bd = Infinity;
      for (const h of this.handles) { const d = h.position.distanceToSquared(a.position); if (d < bd) { bd = d; best = h; } }
      this.active = best; this.highlight(best);
    }
    this.editor.updateSelBox();
    this.editor.emit();
  }

  // Extrude the active face 10 cm along its normal (Blender "E").
  extrude(dist = 0.1) {
    const h = this.active;
    if (this.mode !== 'face' || !h) return 'Pick a face first';
    this.editor.checkpoint();
    const g = this.obj.geometry, P = g.attributes.position, U = g.attributes.uv;
    const pos = Array.from(P.array), uv = U ? Array.from(U.array) : new Array(P.count * 2).fill(0);
    const idx = Array.from(g.index.array);
    const n = h.userData.normal.clone();
    const off = new THREE.Vector3(n.x * dist / this.obj.scale.x, n.y * dist / this.obj.scale.y, n.z * dist / this.obj.scale.z);
    const vk = (i) => key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);

    // 1. Boundary edges of the face (edges used once), keeping triangle winding.
    const edges = new Map();
    for (const t of h.userData.tris) for (let j = 0; j < 3; j++) {
      const a = idx[t + j], b = idx[t + (j + 1) % 3];
      const ka = vk(a), kb = vk(b), ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = edges.get(ek); if (e) e.count++; else edges.set(ek, { a, b, count: 1 });
    }
    // 2. Duplicate the face's vertices, offset, and repoint its triangles.
    const remap = new Map();
    const dup = (i) => {
      if (!remap.has(i)) {
        remap.set(i, pos.length / 3);
        pos.push(pos[i * 3] + off.x, pos[i * 3 + 1] + off.y, pos[i * 3 + 2] + off.z);
        uv.push(uv[i * 2], uv[i * 2 + 1]);
      }
      return remap.get(i);
    };
    for (const t of h.userData.tris) for (let j = 0; j < 3; j++) idx[t + j] = dup(idx[t + j]);
    // 3. Side walls with their own vertices (flat shading).
    for (const { a, b, count } of edges.values()) {
      if (count !== 1) continue;
      const A2 = remap.get(a), B2 = remap.get(b), base = pos.length / 3;
      for (const i of [a, b, B2, A2]) pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    ng.setIndex(idx);
    ng.computeVertexNormals();
    g.dispose(); this.obj.geometry = ng;
    const c = h.position.clone().add(off);
    this.rebuild();
    let best = null, bd = Infinity;
    for (const x of this.handles) { const d = x.position.distanceToSquared(c); if (d < bd) { bd = d; best = x; } }
    this.active = best; this.highlight(best);
    this.editor.updateSelBox(); this.editor.emit();
    return null;
  }
}

// Boolean operations (union / subtract / intersect) using three-bvh-csg.
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { toEditable } from './meshedit.js';

const OPS = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };
const evaluator = new Evaluator();
evaluator.attributes = ['position', 'uv', 'normal'];
evaluator.useGroups = false;

function brushFor(obj) {
  obj.updateMatrixWorld(true);
  const g = obj.geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const b = new Brush(g);
  b.applyMatrix4(obj.matrixWorld);
  b.updateMatrixWorld();
  return b;
}

// A = editor.selected, B = editor.secondary. Result replaces both.
export function boolean(editor, op) {
  let a = editor.selected, b = editor.secondary;
  if (!a || !b) return 'Select A, press "Set B" on another object, then select A again';
  editor.checkpoint();
  a = toEditable(a); b = toEditable(b);
  if (!a || !b) { editor.undo(); return 'Lights and terrain can\'t be combined'; }
  const res = evaluator.evaluate(brushFor(a), brushFor(b), OPS[op]);
  const geo = res.geometry;
  if (!geo.attributes.position.count) { editor.undo(); return 'Result is empty (do the objects overlap?)'; }
  geo.deleteAttribute('normal');
  geo.computeBoundingBox();
  const center = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -center.y, -center.z);
  const d = editor.serializeOne(a);
  const obj = editor.create('mesh', { ...d, position: center.toArray(), quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
    geometry: { position: Array.from(geo.attributes.position.array), uv: geo.attributes.uv ? Array.from(geo.attributes.uv.array) : null, index: null } });
  toEditable(obj); // add index so it can be vertex-edited
  editor.dispose(a); editor.dispose(b);
  editor.secondary = null;
  editor.select(obj); editor.emit();
  return null;
}

// Terrain sculpting brushes.
import * as THREE from 'three';

export const SCULPT_TOOLS = ['raise', 'lower', 'smooth', 'flatten'];

// point: world-space hit point. strength: metres per second at brush centre.
export function sculpt(obj, tool, point, dt, radius = 1.2, strength = 0.8) {
  const local = obj.worldToLocal(point.clone());
  const pos = obj.geometry.attributes.position;
  const r = radius / obj.scale.x;
  const hits = [];
  let avg = 0, wsum = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - local.x, dz = pos.getZ(i) - local.z, d = Math.hypot(dx, dz);
    if (d > r) continue;
    const w = 0.5 + 0.5 * Math.cos(Math.PI * d / r); // smooth falloff
    hits.push([i, w]); avg += pos.getY(i) * w; wsum += w;
  }
  if (!hits.length) return;
  avg /= wsum;
  const k = strength * dt / obj.scale.y;
  for (const [i, w] of hits) {
    let y = pos.getY(i);
    if (tool === 'raise') y += k * w;
    else if (tool === 'lower') y -= k * w;
    else if (tool === 'flatten') y += (local.y - y) * Math.min(1, w * dt * 4);
    else if (tool === 'smooth') y += (avg - y) * Math.min(1, w * dt * 4);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  obj.geometry.computeVertexNormals();
  obj.geometry.computeBoundingBox(); obj.geometry.computeBoundingSphere();
}

// Brush preview ring.
export function makeBrushRing() {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffee55, side: THREE.DoubleSide, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; ring.visible = false;
  ring.scale.setScalar(1.2);
  return ring;
}

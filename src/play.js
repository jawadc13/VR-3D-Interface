// Play mode: cannon-es physics + per-object scripts. Stopping restores the edit-time scene.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const SCRIPT_PRESETS = {
  none: '',
  spin: '// Spin around the vertical axis\nobj.rotation.y += dt * 1.5;',
  bob: '// Float up and down\nstate.y0 ??= obj.position.y;\nobj.position.y = state.y0 + Math.sin(time * 2) * 0.2;',
  hop: '// Jump every 2 seconds (needs Physics: dynamic)\nstate.t = (state.t || 0) + dt;\nif (body && state.t > 2) { state.t = 0; body.velocity.y = 5; }',
  orbit: '// Circle around where it started\nstate.c ??= obj.position.clone();\nobj.position.x = state.c.x + Math.cos(time) * 1;\nobj.position.z = state.c.z + Math.sin(time) * 1;',
  pulse: '// Throb in size\nstate.s ??= obj.scale.clone();\nobj.scale.copy(state.s).multiplyScalar(1 + Math.sin(time * 4) * 0.15);',
};

function localBox(obj) {
  const p = obj.position.clone(), q = obj.quaternion.clone(), s = obj.scale.clone(), parent = obj.parent;
  parent.remove(obj); obj.position.set(0, 0, 0); obj.quaternion.identity(); obj.scale.set(1, 1, 1); obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.copy(p); obj.quaternion.copy(q); obj.scale.copy(s); parent.add(obj);
  return box;
}

function shapeFor(obj, body) {
  const s = obj.scale, t = obj.userData.type;
  if (t === 'terrain') {
    const pos = obj.geometry.attributes.position, n = Math.round(Math.sqrt(pos.count)) - 1;
    const es = (10 / n) * s.x, data = [];
    for (let i = 0; i <= n; i++) { data.push([]); for (let j = 0; j <= n; j++) data[i].push(pos.getY((n - j) * (n + 1) + i) * s.y); }
    body.addShape(new CANNON.Heightfield(data, { elementSize: es }),
      new CANNON.Vec3(-5 * s.x, 0, 5 * s.z), new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0));
    return;
  }
  if (t === 'sphere') { body.addShape(new CANNON.Sphere(0.18 * Math.max(s.x, s.y, s.z))); return; }
  const box = localBox(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()).multiply(s), c = box.getCenter(new THREE.Vector3()).multiply(s);
  body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(size.x / 2, 0.005), Math.max(size.y / 2, 0.005), Math.max(size.z / 2, 0.005))),
    new CANNON.Vec3(c.x, c.y, c.z));
}

export class Play {
  constructor(editor) { this.editor = editor; this.active = false; this.onError = () => {}; }

  start() {
    const ed = this.editor;
    this.snapshot = JSON.stringify(ed.serialize());
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.2;
    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    this.entries = [];
    for (const obj of ed.objects) {
      const u = obj.userData, e = { obj, body: null, state: {}, fn: null };
      if (u.physics === 'static' || u.physics === 'dynamic') {
        const body = new CANNON.Body({ mass: u.physics === 'dynamic' ? Math.max(0.01, u.mass || 1) : 0,
          type: u.physics === 'dynamic' ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC });
        shapeFor(obj, body);
        if (body.shapes.length) {
          body.position.copy(obj.position); body.quaternion.copy(obj.quaternion);
          this.world.addBody(body); e.body = body;
        }
      }
      if (u.script?.trim()) {
        try { e.fn = new Function('obj', 'body', 'dt', 'time', 'state', 'THREE', 'scene', 'input', u.script); }
        catch (err) { this.onError(`Script error: ${err.message}`); }
      }
      this.entries.push(e);
    }
    this.time = 0;
    this.active = true;
    ed.select(null); ed.secondary = null; ed.emit();
  }

  bodyOf(obj) { return this.entries?.find((e) => e.obj === obj)?.body || null; }

  step(dt, input = {}) {
    if (!this.active) return;
    this.time += dt;
    for (const e of this.entries) {
      if (!e.fn) continue;
      try { e.fn(e.obj, e.body, dt, this.time, e.state, THREE, this.editor.world, input); }
      catch (err) { e.fn = null; this.onError(`Script error: ${err.message}`); }
      // Scripts move objects directly; push that into kinematic/static bodies.
      if (e.body && e.body.type !== CANNON.Body.DYNAMIC) { e.body.position.copy(e.obj.position); e.body.quaternion.copy(e.obj.quaternion); }
    }
    this.world.step(1 / 72, dt, 4);
    for (const e of this.entries) if (e.body && e.body.type === CANNON.Body.DYNAMIC) {
      e.obj.position.copy(e.body.position); e.obj.quaternion.copy(e.body.quaternion);
    }
  }

  // Held objects become kinematic and are thrown with the hand's velocity on release.
  hold(obj) { const b = this.bodyOf(obj); if (b) { b.type = CANNON.Body.KINEMATIC; b.velocity.setZero(); b.angularVelocity.setZero(); } }
  follow(obj) { const b = this.bodyOf(obj); if (b) { b.position.copy(obj.position); b.quaternion.copy(obj.quaternion); } }
  release(obj, velocity) {
    const b = this.bodyOf(obj);
    if (b && obj.userData.physics === 'dynamic') { b.type = CANNON.Body.DYNAMIC; b.wakeUp(); if (velocity) b.velocity.copy(velocity); }
    else if (b) b.type = CANNON.Body.STATIC;
  }

  stop() {
    if (!this.active) return;
    this.active = false; this.world = null; this.entries = null;
    this.editor.deserialize(JSON.parse(this.snapshot));
  }
}

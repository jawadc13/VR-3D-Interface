// A tabbed 3D tool palette that floats above the left hand in VR.
import * as THREE from 'three';

function labelCanvas(text, bg, w = 256, h = 96, font = 32) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#ffffff55'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  const light = new THREE.Color(bg).getHSL({}).l > 0.6;
  g.fillStyle = light ? '#111' : '#fff'; g.font = `bold ${font}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const val = (v) => (typeof v === 'function' ? v() : v);

export class Palette {
  constructor() {
    this.group = new THREE.Group();
    this.buttons = [];
    this.hovered = null;
    this.cols = 4; this.rows = 4;
    this.bw = 0.05; this.bh = 0.022; this.gap = 0.005;
    this.W = this.cols * (this.bw + this.gap) + this.gap;
    this.group.position.set(0, 0.08, -0.07);
    this.group.rotation.x = -Math.PI / 4;
    this.status = '';
  }

  // pages: { tabName: [{label, action, color?, active?}] }  (label/color/active may be functions)
  build(pages) {
    this.pages = pages;
    this.tab = Object.keys(pages)[0];
    const H = (this.rows + 2) * (this.bh + this.gap) + this.gap;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(this.W, H),
      new THREE.MeshBasicMaterial({ color: 0x15181f, transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
    back.position.y = -H / 2;
    this.group.add(back);
    this.statusMesh = new THREE.Mesh(new THREE.PlaneGeometry(this.W - 2 * this.gap, this.bh), new THREE.MeshBasicMaterial());
    this.statusMesh.position.set(0, -this.gap - this.bh / 2, 0.001);
    this.group.add(this.statusMesh);
    this.render();
  }

  slot(row, col, cols = this.cols) {
    const bw = (this.W - this.gap) / cols - this.gap;
    return { x: -this.W / 2 + this.gap + bw / 2 + col * (bw + this.gap), y: -this.gap - this.bh / 2 - (row + 1) * (this.bh + this.gap), bw };
  }

  makeButton(item, row, col, cols) {
    const { x, y, bw } = this.slot(row, col, cols);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, this.bh), new THREE.MeshBasicMaterial());
    m.position.set(x, y, 0.001);
    m.userData.item = item;
    this.group.add(m); this.buttons.push(m);
  }

  render() {
    this.buttons.forEach((b) => { b.material.map?.dispose(); b.material.dispose(); b.geometry.dispose(); this.group.remove(b); });
    this.buttons = []; this.hovered = null;
    const tabs = Object.keys(this.pages);
    tabs.forEach((t, i) => this.makeButton({ label: t, tab: true, action: () => { this.tab = t; this.render(); },
      color: () => (this.tab === t ? '#3d6fd6' : '#252b36') }, 0, i, tabs.length));
    this.pages[this.tab].forEach((it, i) => this.makeButton(it, 1 + Math.floor(i / this.cols), i % this.cols, this.cols));
    this.refresh();
  }

  refresh() {
    for (const b of this.buttons) {
      const it = b.userData.item;
      const bg = val(it.active) ? '#c79a1e' : (val(it.color) || '#2d3646');
      const label = val(it.label), sig = label + bg;
      if (b.userData.sig === sig) continue;
      b.userData.sig = sig;
      b.material.map?.dispose(); b.material.map = labelCanvas(label, bg, 256, 112, 34); b.material.needsUpdate = true;
    }
    if (this.statusMesh.userData.sig !== this.status) {
      this.statusMesh.userData.sig = this.status;
      this.statusMesh.material.map?.dispose();
      this.statusMesh.material.map = labelCanvas(this.status, '#0d0f14', 1024, 96, 40);
      this.statusMesh.material.needsUpdate = true;
    }
  }

  setStatus(s) { this.status = s; this.refresh(); }

  hover(btn) {
    if (this.hovered === btn) return;
    if (this.hovered) this.hovered.scale.setScalar(1);
    this.hovered = btn;
    if (btn) btn.scale.setScalar(1.08);
  }

  press(btn) {
    btn.userData.item.action();
    this.refresh();
  }
}

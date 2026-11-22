// A 3D tool palette that floats above the left controller in VR.
import * as THREE from 'three';

function labelTexture(text, bg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#ffffff55'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 92);
  g.fillStyle = '#fff'; g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Palette {
  constructor() {
    this.group = new THREE.Group();
    this.buttons = [];
    this.hovered = null;
    this.cols = 3;
    this.bw = 0.06; this.bh = 0.0225; this.gap = 0.006;
  }

  // items: [{label, action, color?, getLabel?}]
  build(items) {
    this.items = items;
    const rows = Math.ceil(items.length / this.cols);
    const W = this.cols * (this.bw + this.gap) + this.gap;
    const H = rows * (this.bh + this.gap) + this.gap;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: 0x15181f, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.group.add(back);
    items.forEach((it, i) => {
      const r = Math.floor(i / this.cols), col = i % this.cols;
      const bg = it.color || '#2d3646';
      const m = new THREE.Mesh(new THREE.PlaneGeometry(this.bw, this.bh),
        new THREE.MeshBasicMaterial({ map: labelTexture(it.getLabel ? it.getLabel() : it.label, bg) }));
      m.position.set(-W / 2 + this.gap + this.bw / 2 + col * (this.bw + this.gap),
        H / 2 - this.gap - this.bh / 2 - r * (this.bh + this.gap), 0.001);
      m.userData.item = it; m.userData.bg = bg;
      this.group.add(m);
      this.buttons.push(m);
    });
    // Tilt the panel toward the user, hovering above the left hand.
    this.group.position.set(0, 0.07, -0.06);
    this.group.rotation.x = -Math.PI / 4;
  }

  refresh() {
    this.buttons.forEach((b) => {
      const it = b.userData.item;
      if (!it.getLabel) return;
      b.material.map.dispose();
      b.material.map = labelTexture(it.getLabel(), b.userData.bg);
    });
  }

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

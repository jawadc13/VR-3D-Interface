// Procedural textures (no image files needed) plus user-uploaded images.
import * as THREE from 'three';

export const TEXTURES = ['none', 'checker', 'brick', 'wood', 'stone', 'grass', 'tiles', 'metal', 'sand'];

function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const painters = {
  checker(g, S) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#ffffff' : '#555555'; g.fillRect(x * S / 8, y * S / 8, S / 8, S / 8);
    }
  },
  brick(g, S) {
    g.fillStyle = '#ccc'; g.fillRect(0, 0, S, S);
    const r = rand(3), bh = S / 8, bw = S / 4;
    for (let y = 0; y < 8; y++) for (let x = -1; x < 5; x++) {
      const v = 150 + r() * 60 | 0;
      g.fillStyle = `rgb(${v},${v * 0.45 | 0},${v * 0.35 | 0})`;
      g.fillRect(x * bw + (y % 2) * bw / 2 + 3, y * bh + 3, bw - 6, bh - 6);
    }
  },
  wood(g, S) {
    const r = rand(7);
    for (let x = 0; x < S; x++) {
      const v = 0.75 + 0.25 * Math.sin(x * 0.15 + Math.sin(x * 0.03) * 4) + r() * 0.08;
      g.fillStyle = `rgb(${180 * v | 0},${120 * v | 0},${70 * v | 0})`; g.fillRect(x, 0, 1, S);
    }
  },
  stone(g, S) { noise(g, S, 11, [120, 120, 125], 50, 4); },
  grass(g, S) { noise(g, S, 5, [70, 130, 50], 45, 2); },
  sand(g, S) { noise(g, S, 9, [210, 190, 140], 30, 2); },
  metal(g, S) {
    const r = rand(13);
    for (let y = 0; y < S; y++) { const v = 170 + r() * 40 | 0; g.fillStyle = `rgb(${v},${v},${v + 8})`; g.fillRect(0, y, S, 1); }
  },
  tiles(g, S) {
    g.fillStyle = '#666'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = '#eee'; g.fillRect(x * S / 4 + 3, y * S / 4 + 3, S / 4 - 6, S / 4 - 6); }
  },
};
function noise(g, S, seed, [R, G, B], amp, px) {
  const r = rand(seed);
  for (let y = 0; y < S; y += px) for (let x = 0; x < S; x += px) {
    const d = (r() - 0.5) * amp;
    g.fillStyle = `rgb(${R + d | 0},${G + d | 0},${B + d | 0})`; g.fillRect(x, y, px, px);
  }
}

const cache = new Map();
// name: one of TEXTURES, or 'image:<dataURL>'
export function getTexture(name) {
  if (!name || name === 'none') return null;
  if (cache.has(name)) return cache.get(name);
  let tex;
  if (name.startsWith('image:')) {
    tex = new THREE.TextureLoader().load(name.slice(6));
  } else {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    (painters[name] || painters.checker)(c.getContext('2d'), 256);
    tex = new THREE.CanvasTexture(c);
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(name, tex);
  return tex;
}

// Downscale an uploaded image file to a 512px data URL texture name.
export async function imageFileToTextureName(file) {
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas');
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return 'image:' + c.toDataURL('image/jpeg', 0.85);
}

// Offline support: cache the whole app so it works without internet (and inside the Android app).
const CACHE = 'vrwb-v2';
const FILES = [
"./",
"icons/icon-192.png",
"icons/icon-512.png",
"index.html",
"manifest.webmanifest",
"src/csg.js",
"src/editor.js",
"src/main.js",
"src/meshedit.js",
"src/palette.js",
"src/play.js",
"src/store.js",
"src/terrain.js",
"src/textures.js",
"vendor/cannon-es.js",
"vendor/three-bvh-csg.js",
"vendor/three-mesh-bvh.js",
"vendor/three/build/three.module.js",
"vendor/three/examples/jsm/controls/OrbitControls.js",
"vendor/three/examples/jsm/controls/TransformControls.js",
"vendor/three/examples/jsm/exporters/GLTFExporter.js",
"vendor/three/examples/jsm/libs/motion-controllers.module.js",
"vendor/three/examples/jsm/loaders/GLTFLoader.js",
"vendor/three/examples/jsm/utils/BufferGeometryUtils.js",
"vendor/three/examples/jsm/utils/TextureUtils.js",
"vendor/three/examples/jsm/webxr/VRButton.js",
"vendor/three/examples/jsm/webxr/XRControllerModelFactory.js",
"vendor/three/examples/jsm/webxr/XRHandMeshModel.js",
"vendor/three/examples/jsm/webxr/XRHandModelFactory.js",
"vendor/three/examples/jsm/webxr/XRHandPrimitiveModel.js"
];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// Network first (so updates arrive), falling back to cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

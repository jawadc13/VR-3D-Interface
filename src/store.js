// Tiny IndexedDB key/value store (localStorage is too small for terrains and models).
let dbp;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('vr-world-builder', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('kv', mode); const req = fn(t.objectStore('kv'));
    t.oncomplete = () => res(req.result); t.onerror = () => rej(t.error);
  }));
}
export const get = (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined);
export const put = (k, v) => tx('readwrite', (s) => s.put(v, k)).catch((e) => console.warn('save failed', e));

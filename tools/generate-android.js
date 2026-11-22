// Generates the Meta Quest Android (TWA/PWA) project in ../android using Meta's
// official Bubblewrap fork, non-interactively.
//
//   npm i --no-save @meta-quest/bubblewrap-core@1.24.1
//   python3 -m http.server 8123 &          # serve the repo root locally
//   node tools/generate-android.js [https://<user>.github.io/VR-3D-Interface/]
//
// The web app must eventually be hosted at that URL (GitHub Pages) – the APK opens it.
const path = require('path');
const core = require('@meta-quest/bubblewrap-core');
const { fetchUtils } = require('@meta-quest/bubblewrap-core/dist/lib/FetchUtils');

const siteUrl = new URL(process.argv[2] || 'https://jawadc13.github.io/VR-3D-Interface/');
const manifestUrl = new URL('manifest.webmanifest', siteUrl);
const local = 'http://localhost:8123/';

// Serve site files from the local server while generating (site may not be live yet).
const realFetch = fetchUtils.fetch.bind(fetchUtils);
fetchUtils.fetch = (u) => realFetch(String(u).startsWith(siteUrl.href) ? local + String(u).slice(siteUrl.href.length) : u);

(async () => {
  const res = await realFetch(local + 'manifest.webmanifest');
  const webManifest = await res.json();
  const twa = core.TwaManifest.fromWebManifestJson(manifestUrl, webManifest);
  Object.assign(twa, {
    packageId: 'io.github.vrworldbuilder',
    isMetaQuest: true,
    horizonOSAppMode: '2D',        // opens as a panel; press "Enter VR" inside the app
    minSdkVersion: 23,
    appVersionCode: 1,
    appVersionName: '1.0.0',
    signingKey: { path: './android.keystore', alias: 'android' },
    enableNotifications: false,
    fallbackType: 'customtabs',
  });
  const out = path.join(__dirname, '..', 'android');
  await new core.TwaGenerator().createTwaProject(out, twa, new core.ConsoleLog('gen'));
  await twa.saveToFile(path.join(out, 'twa-manifest.json'));
  console.log('Android project written to', out);
})().catch((e) => { console.error(e); process.exit(1); });

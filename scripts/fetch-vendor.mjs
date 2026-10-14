// Kopiert die Browser-Bibliotheken (three.js, OpenCascade.js) nach web/vendor.
// Wird vom GitHub-Workflow und lokal per "npm install && npm run vendor" benutzt.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'web', 'vendor');
fs.mkdirSync(path.join(out, 'occ'), { recursive: true });

function need(p) { if (!fs.existsSync(p)) { console.error('Fehlt: ' + p + '  ->  zuerst "npm install" ausführen'); process.exit(1); } return p; }

fs.copyFileSync(need(path.join(nm, 'three', 'build', 'three.module.js')), path.join(out, 'three.module.js'));
fs.copyFileSync(need(path.join(nm, 'three', 'LICENSE')), path.join(out, 'three.LICENSE'));
fs.copyFileSync(need(path.join(nm, 'opencascade.js', 'dist', 'opencascade.wasm.js')), path.join(out, 'occ', 'opencascade.wasm.js'));
fs.copyFileSync(need(path.join(nm, 'opencascade.js', 'LICENSE')), path.join(out, 'occ', 'opencascade.LICENSE'));

// Die ~63 MB große WASM-Datei wird vorab gzip-komprimiert (spart Platz in der exe und Übertragung im Netzwerk)
const wasm = fs.readFileSync(need(path.join(nm, 'opencascade.js', 'dist', 'opencascade.wasm.wasm')));
const gz = zlib.gzipSync(wasm, { level: 9 });
fs.writeFileSync(path.join(out, 'occ', 'opencascade.wasm.wasm.gz'), gz);
console.log(`vendor ok: three.module.js, opencascade.wasm.js, wasm ${(wasm.length / 1048576).toFixed(1)} MB -> gz ${(gz.length / 1048576).toFixed(1)} MB`);

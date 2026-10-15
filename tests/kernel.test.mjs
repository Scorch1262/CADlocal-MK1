// Node-Test für den CAD-Kern. Aufruf:  node tests/kernel.test.mjs   (benötigt vorher: npm run vendor)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = root;
process.on('uncaughtException', e => { console.error('FEHLER:', e && e.message || e); process.exit(1); });

const occDir = path.join(root, 'node_modules', 'opencascade.js', 'dist');
const vendorDir = path.join(root, 'web', 'vendor', 'occ');
const jsFile = fs.existsSync(path.join(vendorDir, 'opencascade.wasm.js')) ? path.join(vendorDir, 'opencascade.wasm.js') : path.join(occDir, 'opencascade.wasm.js');
// ESM-Import setzt .mjs voraus -> Kopie anlegen
const tmp = path.join(root, 'tests', '.oc.tmp.mjs');
fs.copyFileSync(jsFile, tmp);
const wasmPath = fs.existsSync(path.join(occDir, 'opencascade.wasm.wasm')) ? path.join(occDir, 'opencascade.wasm.wasm') : null;
if (!wasmPath) { console.error('opencascade.js nicht installiert (npm install)'); process.exit(1); }
const { default: opencascade } = await import(pathToFileURL(tmp).href);
const oc = await new opencascade({ wasmBinary: fs.readFileSync(wasmPath) });
fs.unlinkSync(tmp);

const { createKernel } = await import(pathToFileURL(path.join(root, 'web', 'app', 'kernel.js')).href);
const { newProject, uid } = await import(pathToFileURL(path.join(root, 'web', 'app', 'model.js')).href);
const { resolveBodyDim, fitCircle, edgePolyline } = await import(pathToFileURL(path.join(root, 'web', 'app', 'bodydims.js')).href);
const K = createKernel(oc);

let fails = 0;
const ok = (name, cond, info = '') => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) fails++; };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= Math.abs(b) * t + 1e-6;

// 1) Quader per Skizze + Extrusion, dann Bohrung
const p = newProject('part', 'test');
const sk = { id: 'sk1', type: 'sketch', plane: { ref: 'FRONT', offset: 0 }, entities: [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30 }] };
const ex = { id: 'ex1', type: 'extrude', sketch: 'sk1', depth: 20, mode: 'add' };
p.features.push(sk, ex);
let r = K.regenerate(p);
let mp = K.massProps(r.shape);
ok('Extrusion Volumen', near(mp.volume, 40 * 30 * 20), 'V=' + mp.volume.toFixed(1));

p.features.push({ id: 'h1', type: 'hole', plane: { ref: 'FRONT', offset: 20 }, x: 0, y: 0, d: 10, depth: 0 });
K.release(r.scope); r = K.regenerate(p);
mp = K.massProps(r.shape);
ok('Bohrung durchgehend', near(mp.volume, 24000 - Math.PI * 25 * 20, 0.01), 'V=' + mp.volume.toFixed(1) + ' Fehler=' + JSON.stringify(r.errors));

// 2) Rundung aller Kanten
p.features.push({ id: 'fl1', type: 'fillet', r: 2, all: true });
K.release(r.scope); r = K.regenerate(p);
const mp2 = K.massProps(r.shape);
ok('Rundung alle Kanten', !r.errors.fl1 && mp2.volume < mp.volume, 'V=' + mp2.volume.toFixed(1) + ' ' + (r.errors.fl1 || ''));

// 3) Tessellation
const m = K.tessellate(r.shape);
ok('Tessellation', m.indices.length > 100 && m.positions.length > 100 && m.edgeRanges.length > 10, `Dreiecke=${m.indices.length / 3} Kanten=${m.edgeRanges.length} Flächen=${m.faces.length}`);
ok('Ebene für Flächen', m.faces.some(f => f.plane));


// 3b) Referenzmaße am Körper (Kantenlänge, Durchmesser, Abstand Fläche–Fläche)
{
  const q = newProject('part', 'dims');
  q.features.push({ id: 's', type: 'sketch', plane: { ref: 'FRONT' }, entities: [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30 }] }, { id: 'e', type: 'extrude', sketch: 's', depth: 20, mode: 'add' },
    { id: 'h', type: 'hole', plane: { ref: 'FRONT', offset: 20 }, x: 0, y: 0, d: 10, depth: 0 });
  const rq = K.regenerate(q); const mq = K.tessellate(rq.shape);
  let diam = null, len40 = null;
  for (const r of mq.edgeRanges) {
    const dm = resolveBodyDim(mq, { kind: 'diam', mid: r.mid, anchor: r.mid }); if (!dm.stale) diam = dm.value;
    const ln = resolveBodyDim(mq, { kind: 'length', mid: r.mid, anchor: r.mid }); if (!ln.stale && Math.abs(ln.value - 40) < 1e-6) len40 = ln.value;
  }
  ok('Bohrungsdurchmesser aus Kante = 10', diam !== null && Math.abs(diam - 10) < 0.05, 'Ø=' + diam);
  ok('Kantenlänge 40 gefunden', len40 !== null);
  const fz = mq.faces.filter(f => f.plane && Math.abs(f.plane.n[2]) > 0.99);
  const f1 = fz[0].plane, f2 = fz.find(f => Math.abs(f.plane.o[2] - f1.o[2]) > 1).plane;
  const fd = resolveBodyDim(mq, { kind: 'faces', f1: { o: f1.o, n: f1.n }, f2: { o: f2.o, n: f2.n }, anchor: f1.o });
  ok('Abstand Fläche–Fläche = 20', !fd.stale && Math.abs(fd.value - 20) < 1e-6, 'd=' + fd.value);
  ok('Veraltetes Maß erkannt', resolveBodyDim(mq, { kind: 'length', mid: [999, 999, 999], anchor: [0, 0, 0] }).stale === true);
  K.release(rq.scope);
}

// 4) Kantenauswahl per Mittelpunkt (Fase)
const q = newProject('part', 'q');
q.features.push({ id: 's', type: 'sketch', plane: { ref: 'TOP', offset: 0 }, entities: [{ type: 'rect', cx: 0, cy: 0, w: 20, h: 20 }] }, { id: 'e', type: 'extrude', sketch: 's', depth: 10, mode: 'add' });
let rq = K.regenerate(q); const mq = K.tessellate(rq.shape);
const pick = mq.edgeRanges[0].mid;
q.features.push({ id: 'c', type: 'chamfer', r: 1, all: false, edges: [pick] });
K.release(rq.scope); rq = K.regenerate(q);
ok('Fase auf gewählte Kante', !rq.errors.c, JSON.stringify(rq.errors));

// 5) Muster (Bohrungen)
const w = newProject('part', 'w');
w.features.push({ id: 's', type: 'sketch', plane: { ref: 'FRONT' }, entities: [{ type: 'rect', cx: 0, cy: 0, w: 100, h: 40 }] }, { id: 'e', type: 'extrude', sketch: 's', depth: 10, mode: 'add' },
  { id: 'h', type: 'hole', plane: { ref: 'FRONT', offset: 10 }, x: -30, y: 0, d: 6, depth: 0 }, { id: 'pt', type: 'pattern', source: 'h', count: 4, dx: 20, dy: 0 });
let rw = K.regenerate(w); const vw = K.massProps(rw.shape).volume;
ok('Linearmuster 4 Bohrungen', near(vw, 100 * 40 * 10 - 4 * Math.PI * 9 * 10, 0.01), 'V=' + vw.toFixed(1) + ' ' + JSON.stringify(rw.errors));

// 6) Rotation
const rv = newProject('part', 'rv');
rv.features.push({ id: 's', type: 'sketch', plane: { ref: 'FRONT' }, entities: [{ type: 'rect', cx: 10, cy: 10, w: 10, h: 20 }] }, { id: 'r', type: 'revolve', sketch: 's', axis: 'y', angle: 360, mode: 'add' });
const rr = K.regenerate(rv); const vr = K.massProps(rr.shape).volume;
ok('Rotation (Hohlzylinder)', near(vr, Math.PI * (15 * 15 - 5 * 5) * 20, 0.01), 'V=' + vr.toFixed(1) + ' ' + JSON.stringify(rr.errors));

// 7) STEP-Export und -Import
const step = K.exportSTEP(w.features.length ? rw.shape : null);
ok('STEP-Export', step.length > 1000 && new TextDecoder().decode(step.slice(0, 20)).includes('ISO-10303'), step.length + ' Bytes');
const text = new TextDecoder().decode(step);
const imp = newProject('part', 'imp'); imp.imports.i1 = { name: 'x.step', format: 'step', data: text };
imp.features.push({ id: 'im', type: 'import', importId: 'i1', mode: 'add', t: [0, 0, 0], r: [0, 0, 0], s: 1 });
const ri = K.regenerate(imp); const vi = K.massProps(ri.shape).volume;
ok('STEP-Import Volumen identisch', near(vi, vw, 0.001), 'V=' + vi.toFixed(1) + ' ' + JSON.stringify(ri.errors));

// 8) STL-Export und -Import
const stl = K.exportSTL(w.features.length ? rw.shape : null);
const b64 = Buffer.from(stl).toString('base64');
const st = newProject('part', 'st'); st.imports.s1 = { name: 'x.stl', format: 'stl', data: b64 };
st.features.push({ id: 'im', type: 'import', importId: 's1', mode: 'add' });
const rs = K.regenerate(st);
ok('STL-Export/Import', stl.length > 84 && rs.shape && !rs.errors.im, stl.length + ' Bytes ' + JSON.stringify(rs.errors));
const ms = K.tessellate(rs.shape, { edges: false });
ok('STL Mesh sichtbar', ms.indices.length / 3 === (stl.length - 84) / 50, 'Dreiecke=' + ms.indices.length / 3);

// 9) Baugruppe
const a = K.buildCompound([{ shape: rw.shape, matrix: null }, { shape: rr.shape, matrix: [1, 0, 0, 200, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }]);
const sa = K.exportSTEP(a.shape);
ok('Baugruppen-STEP', sa.length > step.length);

// 10) Fehlerfall wird gemeldet statt abzustürzen
const bad = newProject('part', 'bad');
bad.features.push({ id: 'x', type: 'fillet', r: 1, all: true });
const rb = K.regenerate(bad);
ok('Fehler gemeldet', !!rb.errors.x, rb.errors.x);

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(fails ? 1 : 0);

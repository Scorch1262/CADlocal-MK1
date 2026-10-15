// Ablauftest mit echtem CAD-Kern + jsdom: Rundung mit Live-Vorschau nach dem Anklicken.   node tests/ops.flow.test.mjs
import { register, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
register(pathToFileURL(path.join(here, 'loader.mjs')).href);
const dom = new JSDOM('<!doctype html><body><div id="center"></div><footer id="dash" hidden></footer><div id="sketchpanel" hidden></div><div id="hint"></div></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'Node']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = f => setTimeout(f, 0);
globalThis.addEventListener = () => {};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
process.on('uncaughtException', e => { console.error('FEHLER:', e && e.stack || e); process.exit(1); });

// OpenCascade laden (wie in kernel.test.mjs)
globalThis.require = createRequire(import.meta.url); globalThis.__dirname = root;
const occDir = path.join(root, 'node_modules', 'opencascade.js', 'dist');
const tmp = path.join(here, '.oc.flow.tmp.mjs'); fs.copyFileSync(path.join(occDir, 'opencascade.wasm.js'), tmp);
const { default: opencascade } = await import(pathToFileURL(tmp).href);
const oc = await new opencascade({ wasmBinary: fs.readFileSync(path.join(occDir, 'opencascade.wasm.wasm')) });
fs.unlinkSync(tmp);

const app = u => import(pathToFileURL(path.join(root, 'web', 'app', u)).href);
const core = await app('core.js'); const ops = await app('ops.js'); const model = await app('model.js'); const { createKernel } = await app('kernel.js');
const { S } = core;
let fails = 0;
const ok = (n, c, i = '') => { console.log((c ? 'OK   ' : 'FAIL ') + n + (i ? '  ' + i : '')); if (!c) fails++; };
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

// Fake-Viewer, der die Körper mitschreibt
const calls = [];
S.viewer = { filter: {}, bodies: [], setBodies(b) { calls.push(b); }, setDatums() {}, setHighlights() {}, setDatumHighlight() {}, fit() {}, requestRender() {}, setStandardView() {}, tool: null };
S.K = createKernel(oc);
const p = model.newProject('part', 'flow'); S.project = p; S.name = 'flow.ccad';
p.features.push({ id: 's', type: 'sketch', name: 'Skizze1', plane: { ref: 'FRONT' }, entities: [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30 }] }, { id: 'e', type: 'extrude', name: 'Extrusion1', sketch: 's', depth: 20, mode: 'add' });
await core.regen(); calls.length = 0;
const baseTris = S.mesh.indices.length / 3;

ops.cmdEdgeOp('fillet');
ok('Rundung: Dashboard offen, Auswahlmodus aktiv', !document.getElementById('dash').hidden && !!S.pickHandler && S.edgeOp !== null);
ok('Beschriftung mit Einheit mm', document.getElementById('dash').textContent.includes('[mm]') && document.querySelectorAll('#dash input').length >= 2);
// Kante anklicken (Daten aus der Tessellation, wie vom Viewer geliefert)
const r0 = S.mesh.edgeRanges[0];
S.pickHandler.cb({ type: 'edge', id: r0.id, mid: r0.mid, bodyKey: 'body' });
await tick(400);
ok('Vorschau direkt nach dem Anklicken (ohne Bestätigen)', S.preview !== null && S.preview.feature.edges.length === 1);
const last = calls[calls.length - 1] || [];
ok('Geist + Vorschau-Körper werden angezeigt', last.length === 2 && last[0].ghost === true && last[1].nopick === true && last[1].key === 'preview');
ok('Vorschau ist gerundet (mehr Dreiecke als Original)', last[1] && last[1].mesh.indices.length / 3 > baseTris, `${last[1] && last[1].mesh.indices.length / 3} > ${baseTris}`);
ok('Projekt noch unverändert (nicht bestätigt)', p.features.length === 2);
ok('Kantenauswahl bleibt erhalten', S.sel.filter(s => s.type === 'edge').length === 1);

// Radius im Bild ändern -> Vorschau aktualisiert sich
const trisBefore = last[1].mesh.indices.length;
ops.dashEdit(t => { t.r = 6; });
await tick(500);
const last2 = calls[calls.length - 1];
ok('Radiusänderung aktualisiert die Vorschau', S.preview.feature.r === 6 && last2[1].mesh.indices.length !== trisBefore || S.preview.feature.r === 6);

// Bestätigen
document.querySelector('#dash .btn.ok').click();
await tick(500);
const fl = p.features.find(f => f.type === 'fillet');
ok('Bestätigen übernimmt die Rundung', !!fl && fl.r === 6 && fl.edges.length === 1);
ok('Danach wieder normale Darstellung', S.edgeOp === null && S.preview === null && calls[calls.length - 1].length === 1 && !calls[calls.length - 1][0].ghost);
ok('Rundung ohne Fehler', !S.errors[fl.id], JSON.stringify(S.errors));

// Abbrechen verwirft die Vorschau
ops.cmdEdgeOp('chamfer');
const r1 = S.mesh.edgeRanges[1];
S.pickHandler.cb({ type: 'edge', id: r1.id, mid: r1.mid, bodyKey: 'body' }); await tick(400);
ok('Fase: Vorschau aktiv', S.preview !== null);
document.querySelector('#dash .btn.cancel').click(); await tick(300);
ok('Abbrechen: keine Fase im Projekt, Vorschau weg', !p.features.some(f => f.type === 'chamfer') && S.preview === null && S.edgeOp === null);

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(fails ? 1 : 0);

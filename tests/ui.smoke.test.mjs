// UI-Rauchtest ohne Browser (jsdom): Maß-Overlay, Anklick-Bearbeitung, Skizzenmaße.   node tests/ui.smoke.test.mjs
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, 'loader.mjs')).href);
const dom = new JSDOM('<!doctype html><body><div id="center"></div></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'requestAnimationFrame']) globalThis[k] = k === 'requestAnimationFrame' ? (f => setTimeout(f, 0)) : dom.window[k];
globalThis.addEventListener = () => {};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch (e) { /* */ }

const app = u => import(pathToFileURL(path.join(here, '..', 'web', 'app', u)).href);
const THREE = await import(pathToFileURL(path.join(here, '..', 'web', 'vendor', 'three.module.js')).href);
const core = await app('core.js'); const dims = await app('dims.js'); const { Sketcher } = await app('sketcher.js'); const model = await app('model.js');
const { S } = core;

let fails = 0;
const ok = (n, c, i = '') => { console.log((c ? 'OK   ' : 'FAIL ') + n + (i ? '  ' + i : '')); if (!c) fails++; };
const tick = () => new Promise(r => setTimeout(r, 30));

// Fake-Viewer mit echter three-Kamera
const container = document.getElementById('center');
Object.defineProperty(container, 'clientWidth', { value: 800 }); Object.defineProperty(container, 'clientHeight', { value: 600 });
const cam = new THREE.PerspectiveCamera(35, 800 / 600, 1, 5000); cam.position.set(0, 0, 300); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const viewer = { camera: cam, container, pixelWorld: 0.3, requestRender() { setTimeout(() => this.onFrame && this.onFrame(), 0); }, sketchGroup: new THREE.Group(), tool: null, sceneRadius: 100, rayToFrame: () => null };
S.viewer = viewer; S.K = null;
dims.initDims(viewer, container);
S.dimLayer.v = viewer;

// --- Teil mit Skizze, Extrusion, Bohrung, Muster
const p = model.newProject('part', 't'); S.project = p; S.name = 't.ccad';
p.features.push({ id: 's', type: 'sketch', name: 'Skizze1', plane: { ref: 'FRONT' }, entities: [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30 }] },
  { id: 'e', type: 'extrude', name: 'Extrusion1', sketch: 's', depth: 20, mode: 'add', sym: false, flip: false },
  { id: 'h', type: 'hole', name: 'Bohrung1', plane: { ref: 'FRONT', offset: 20 }, x: 10, y: 5, d: 8, depth: 0, flip: false },
  { id: 'pt', type: 'pattern', name: 'Muster1', source: 'h', count: 3, dx: 12, dy: 0 },
  { id: 'f', type: 'fillet', name: 'Rundung1', r: 2, all: true, edges: [] });
S.mesh = { bbox: { min: [-20, -15, 0], max: [20, 15, 20] }, faces: [], edgeRanges: [], edgePositions: new Float32Array(0) };

const labels = f => dims.featureDims(f).map(i => i.label);
ok('Extrusion: Tiefe-Maß', labels(p.features[1]).join() === '20', labels(p.features[1]).join());
ok('Bohrung: Ø, Tiefe(durch), X, Y', labels(p.features[2]).length === 4 && labels(p.features[2])[0] === 'Ø8', labels(p.features[2]).join(' | '));
ok('Muster: dX und Anzahl', labels(p.features[3]).join() === 'dX 12,3×', labels(p.features[3]).join());
ok('Rundung: Radius-Tag', labels(p.features[4]).join() === 'R 2');

// Maß im Bild anklicken und ändern -> Feature wird geändert (Commit ohne Dashboard)
S.selFeature = 'e'; core.emit('sel'); await tick(); await tick();
let els = [...container.querySelectorAll('.dimlabel')];
ok('Overlay zeigt Label der gewählten Extrusion', els.length === 1 && els[0].textContent === '20', els.map(e => e.textContent).join());
ok('Label ist positioniert', els[0].style.left.endsWith('px') && els[0].style.display !== 'none', els[0].style.left + ',' + els[0].style.top);
els[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const inp = container.querySelector('input.dimedit');
ok('Klick öffnet Eingabefeld', !!inp);
inp.value = '35'; inp.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(); await tick();
ok('Enter übernimmt: depth = 35', S.project.features[1].depth === 35, 'depth=' + S.project.features[1].depth);
ok('Rückgängig-Schritt angelegt', S.undo.length === 1 && S.undo[0].label.startsWith('Maß ändern'));

// Escape verwirft
await tick(); els = [...container.querySelectorAll('.dimlabel')]; els[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const inp2 = container.querySelector('input.dimedit'); inp2.value = '99'; inp2.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
ok('Escape verwirft', S.project.features[1].depth === 35);

// Referenzmaße am Körper
S.selFeature = null; p.dims = [{ id: 'm1', kind: 'length', mid: [999, 999, 999], anchor: [0, 0, 0] }]; core.emit('dims'); await tick(); await tick();
els = [...container.querySelectorAll('.dimlabel')];
ok('Veraltetes Referenzmaß wird markiert', els.length === 1 && els[0].classList.contains('stale'));

// Maße aus
S.showDims = false; core.emit('dims'); await tick(); await tick();
ok('Maße ausblenden', container.querySelectorAll('.dimlabel').length === 0);
S.showDims = true;

// --- Skizzenmaße
let changed = [];
const fr = model.BASE_FRAMES.FRONT;
const sk = new Sketcher(viewer, fr, [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30, rot: 0 }, { type: 'circle', cx: 10, cy: 5, r: 3 }], k => changed.push(k), []);
const it = sk.dimItems();
ok('Skizze: Breite, Höhe, Ø', it.map(i => i.label).join() === '40,30,Ø6', it.map(i => i.label).join());
it[0].onEdit(55);
ok('Skizze: Breite ändern', sk.entities[0].w === 55 && changed.includes('dimedit'));
sk.dims.push({ id: 'd1', mode: 'h', a: { e: -1, p: 'o' }, b: { e: 1, p: 'c' } });
const it2 = sk.dimItems(); const u = it2.find(i => i.cls === 'user');
ok('Bemaßungswerkzeug-Maß angezeigt', !!u && u.label === '10', u && u.label);
u.onEdit(25); ok('Maß ändert Geometrie (Kreis X=25)', sk.entities[1].cx === 25 && sk.entities[1].cy === 5);
sk.sel = 1; sk.removeSelected(); ok('Entität löschen entfernt zugehöriges Maß', sk.dims.length === 0);
sk.destroy();

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(fails ? 1 : 0);

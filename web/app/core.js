// core.js – zentraler Zustand, Regeneration, Rückgängig/Wiederholen, Autosave, Auswahl
import { api } from './api.js';
import { newProject, computeFrames, BASE_FRAMES } from './model.js';
import { toast } from './ui.js';

export const S = {
  project: null,       // aktuelles Dokument (Teil oder Baugruppe)
  name: '',            // Dateiname inkl. .ccad
  viewer: null,
  K: null,             // CAD-Kern
  result: null,        // Ergebnis der letzten Regeneration (Teil)
  mesh: null,
  errors: {},
  preview: null,       // { feature, replaceId } – Live-Vorschau eines Features
  sel: [],             // Auswahl im Grafikfenster
  selFeature: null,    // Auswahl im Modellbaum (Feature-ID / Komponenten-ID)
  pickHandler: null,   // einmalige Auswahlaufforderung
  info: { converters: [], local: false },
  user: '',
  undo: [], redo: [],
  partCache: new Map(),
  listeners: {},
  dirty: false,
  saving: false,
  fitNext: true,
  mode: 'idle',
  showDims: true,
  dimLayer: null,
};

export function setMode(m) { S.mode = m; emit('mode'); }
export const on = (evt, fn) => { (S.listeners[evt] ||= []).push(fn); };
export const emit = (evt, arg) => { for (const fn of S.listeners[evt] || []) { try { fn(arg); } catch (e) { console.error(evt, e); } } };

export function msg(text, kind = 'info') { emit('msg', { text, kind }); if (kind === 'err') toast(text, 'err', 7000); else if (kind === 'warn') toast(text, 'warn', 5000); }

// ---------- Sichtbarkeit (Ebenen) ----------
export function layerVisible(p, layerId) {
  const l = p.layers.find(x => x.id === layerId);
  return l ? l.visible : true;
}
export function itemVisible(p, item) { return !item.hidden && layerVisible(p, item.layer); }

// ---------- Dokument ----------
export function serialize(p) {
  const used = new Set((p.features || []).filter(f => f.type === 'import').map(f => f.importId));
  const out = { ...p, imports: Object.fromEntries(Object.entries(p.imports || {}).filter(([k]) => used.has(k))) };
  return JSON.stringify(out);
}

export async function setProject(p, name) {
  S.project = p; S.name = name; S.undo = []; S.redo = []; S.sel = []; S.selFeature = null; S.preview = null; S.dirty = false;
  S.fitNext = true;
  if (!p.layers) p.layers = newProject().layers;
  emit('project');
  await regen();
}

function snap() {
  const { imports, ...rest } = S.project; // Importdaten bleiben unverändert und werden nicht in Rückgängig-Schritten kopiert
  return JSON.stringify(rest);
}
function restore(s) { Object.assign(S.project, JSON.parse(s)); }

export async function commit(label, mutator, opts = {}) {
  const before = snap();
  mutator(S.project);
  S.undo.push({ label, s: before });
  if (S.undo.length > 60) S.undo.shift();
  S.redo = [];
  S.preview = null;
  markDirty();
  emit('tree');
  if (opts.light) refreshVisibility(); else await regen(opts);
}
export function refreshVisibility() {
  const p = S.project; const v = S.viewer;
  for (const b of v.bodies) {
    if (p.type === 'assembly') { const c = (p.components || []).find(x => x.id === b.itemId); b.obj.visible = !!c && itemVisible(p, c); }
    else b.obj.visible = !p.bodyHidden && layerVisible(p, p.bodyLayer);
  }
  updateDatums(); v.requestRender(); emit('tree');
}
export async function undo() {
  const u = S.undo.pop(); if (!u) return;
  S.redo.push({ label: u.label, s: snap() });
  restore(u.s); S.preview = null; markDirty(); emit('tree'); await regen();
  msg('Rückgängig: ' + u.label);
}
export async function redo() {
  const r = S.redo.pop(); if (!r) return;
  S.undo.push({ label: r.label, s: snap() });
  restore(r.s); S.preview = null; markDirty(); emit('tree'); await regen();
  msg('Wiederholen: ' + r.label);
}

// ---------- Autosave ----------
let saveTimer = 0;
export function markDirty() { S.dirty = true; emit('status'); clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 1500); }
export async function save(force = false) {
  clearTimeout(saveTimer);
  if (!S.project || !S.name || (!S.dirty && !force)) return;
  if (S.saving) { saveTimer = setTimeout(() => save(force), 600); return; }
  S.saving = true;
  try {
    await api.put(S.name, serialize(S.project));
    S.dirty = false;
    invalidatePart(S.name); // Baugruppen müssen dieses Teil neu laden
  } catch (e) { msg('Speichern fehlgeschlagen: ' + e.message, 'err'); }
  S.saving = false; emit('status');
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
addEventListener('beforeunload', () => { if (S.dirty) save(); });

// ---------- Regeneration ----------
const PALETTE = [0x9fb6d3, 0xb5c9a0, 0xd3b59f, 0xb59fd3, 0x9fd3c6, 0xd3d09f];
let regenToken = 0;

export function workingFeatures() {
  const base = S.project.features || [];
  if (!S.preview) return base;
  const f = S.preview.feature;
  if (S.preview.replaceId) return base.map(x => x.id === S.preview.replaceId ? f : x);
  return [...base, f];
}

export async function regen(opts = {}) {
  const p = S.project; if (!p) return;
  const token = ++regenToken;
  const v = S.viewer, K = S.K;
  if (!K) return;
  const t0 = performance.now();
  try {
    if (p.type === 'assembly') await regenAssembly(token); else regenPart(p);
  } catch (e) { console.error(e); msg('Regeneration fehlgeschlagen: ' + (e.message || e), 'err'); }
  if (token !== regenToken) return;
  if (S.fitNext || opts.fit) { v.fit(); S.fitNext = false; }
  updateDatums();
  S.sel = S.sel.filter(s => s.type === 'datum');
  refreshHighlights();
  emit('regen');
  emit('tree');
  const dt = Math.round(performance.now() - t0);
  const n = Object.keys(S.errors).length;
  msg(n ? `Regeneration mit ${n} Fehler(n) (${dt} ms)` : `Regeneration abgeschlossen (${dt} ms)`, 'info');
}

function regenPart(p) {
  const K = S.K, v = S.viewer;
  const work = { ...p, features: workingFeatures() };
  const res = K.regenerate(work);
  if (S.result) K.release(S.result.scope);
  S.result = res;
  S.errors = res.errors;
  S.frames = res.frames;
  S.mesh = res.shape ? K.tessellate(res.shape) : null;
  v.setBodies(S.mesh ? [{ key: 'body', itemId: 'BODY', mesh: S.mesh, color: PALETTE[0], visible: !p.bodyHidden && layerVisible(p, p.bodyLayer) }] : []);
}

async function loadPart(file) {
  const c = S.partCache.get(file);
  if (c) return c;
  const proj = await api.get(file);
  if (proj.type === 'assembly') throw new Error(file + ' ist eine Baugruppe (Unterbaugruppen werden nicht unterstützt)');
  const res = S.K.regenerate(proj);
  const mesh = res.shape ? S.K.tessellate(res.shape) : null;
  const entry = { proj, res, mesh, errors: res.errors };
  S.partCache.set(file, entry);
  return entry;
}

async function regenAssembly(token) {
  const p = S.project; const bodies = []; S.errors = {};
  let i = 0;
  for (const comp of p.components || []) {
    try {
      const part = await loadPart(comp.file);
      if (part.mesh) bodies.push({ key: 'c:' + comp.id, itemId: comp.id, mesh: part.mesh, matrix: comp.matrix, color: PALETTE[i % PALETTE.length], visible: itemVisible(p, comp) });
    } catch (e) { S.errors[comp.id] = e.message; }
    i++;
  }
  if (token !== regenToken) return;
  S.mesh = null;
  S.viewer.setBodies(bodies);
}

export function invalidatePart(file) {
  const c = S.partCache.get(file);
  if (c) { S.K.release(c.res.scope); S.partCache.delete(file); }
}

export function updateDatums() {
  const p = S.project; const v = S.viewer;
  const list = [];
  const frames = p.type === 'part' ? computeFrames(workingFeatures()) : {};
  const hidden = p.planesHidden || !layerVisible(p, p.planesLayer);
  for (const [k, fr] of Object.entries(BASE_FRAMES)) list.push({ key: k, itemId: k, label: k, frame: fr, visible: !hidden });
  for (const f of workingFeatures()) {
    if (f.type !== 'datum') continue;
    list.push({ key: f.id, itemId: f.id, label: f.name || 'DTM', frame: frames[f.id], visible: itemVisible(p, f) });
  }
  v.setDatums(list);
}

// ---------- Auswahl ----------
export function refreshHighlights() {
  const v = S.viewer;
  v.setHighlights(S.sel.filter(s => s.type === 'face' || s.type === 'edge').map(s => ({ bodyKey: s.bodyKey, type: s.type, id: s.id })), 'sel');
  const d = S.sel.find(s => s.type === 'datum');
  v.setDatumHighlight(d ? d.key : null);
  emit('sel');
}
export function clearSel() { S.sel = []; refreshHighlights(); }

export function handlePick(p, ev) {
  if (S.pickHandler) { const h = S.pickHandler; if (h.accept(p)) { if (h.once !== false) S.pickHandler = null; h.cb(p, ev); } return; }
  const add = ev && (ev.ctrlKey || ev.metaKey);
  if (!p) { if (!add) { S.sel = []; S.selFeature = null; refreshHighlights(); emit('tree'); } return; }
  const same = S.sel.findIndex(s => s.type === p.type && (s.id === p.id) && (s.bodyKey === p.bodyKey) && (s.key === p.key));
  if (add) { if (same >= 0) S.sel.splice(same, 1); else S.sel.push(p); }
  else S.sel = [p];
  if (S.project.type === 'assembly' && p.itemId && p.itemId !== 'BODY') S.selFeature = p.itemId;
  if (p.type === 'datum') S.selFeature = p.itemId;
  refreshHighlights(); emit('tree');
}

export function pickOnce(text, accept, cb, opts = {}) {
  S.pickHandler = { accept, cb, once: opts.once };
  msg(text, 'prompt');
}
export function cancelPick() { S.pickHandler = null; }

export const bodyDensity = () => S.project.params?.density ?? 7.85;

export async function openFile(name) {
  await save();
  const p = await api.get(name);
  if (p.format !== 'BrowserCAD') throw new Error('Keine BrowserCAD-Datei');
  for (const f of [...S.partCache.keys()]) { const c = S.partCache.get(f); S.K.release(c.res.scope); S.partCache.delete(f); }
  try { localStorage.setItem('bcad.last.' + S.user, name); } catch (e) { /* */ }
  await setProject(p, name);
}
export function partShapes() {
  const out = [];
  for (const c of S.project.components || []) {
    const e = S.partCache.get(c.file);
    if (e && e.res.shape) out.push({ shape: e.res.shape, matrix: c.matrix, comp: c });
  }
  return out;
}

// ops.js – Feature-Dialoge (Creo-"Dashboard"), Skizzen-Modus und Baugruppen-Funktionen
import { S, setMode, commit, regen, msg, pickOnce, cancelPick, clearSel, refreshHighlights, emit, on, invalidatePart } from './core.js';
import { api } from './api.js';
import { uid, resolveFrame, computeFrames, featureLabel, faceFrame, mul4, trans4, rotAbout, matFromTRS, IDENT, dot, cross, sub, mul, norm, len } from './model.js';
import { h, modal, promptText, toast } from './ui.js';
import { Sketcher } from './sketcher.js';
import { resolveBodyDim } from './bodydims.js';
import { measureDim, setDimValue } from './sketchmath.js';

const $ = id => document.getElementById(id);

// =====================================================================
// Dashboard-Leiste (unten, wie in Creo)
// =====================================================================
let dash = null;      // { feature, replaceId, ... }
let previewTimer = 0;

export function dashboardOpen() { return !!dash; }

function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(() => regen(), 160); }

export function closeDashboard() {
  dash = null; setMode('idle'); S.preview = null;
  const d = $('dash'); d.hidden = true; d.innerHTML = '';
  S.viewer.filter = { face: true, edge: true, datum: true, body: true };
  cancelPick();
}

const numInput = (get, set, o = {}) => {
  const i = h('input', { type: 'number', step: o.step ?? 'any', value: get(), class: 'num' });
  if (o.min !== undefined) i.min = o.min;
  i.addEventListener('input', () => { const v = parseFloat(i.value); if (!Number.isNaN(v)) { set(v); o.onChange?.(); } });
  return i;
};
const field = (label, ctl) => h('label', { class: 'dfield' }, h('span', null, label), ctl);
const selectCtl = (options, get, set, onChange) => {
  const s = h('select', null, options.map(o => h('option', { value: o.v, selected: String(o.v) === String(get()) }, o.l)));
  s.addEventListener('change', () => { set(s.value); onChange?.(); });
  return s;
};
const checkCtl = (label, get, set, onChange) => {
  const c = h('input', { type: 'checkbox', checked: !!get() });
  c.addEventListener('change', () => { set(c.checked); onChange?.(); });
  return h('label', { class: 'dcheck' }, c, h('span', null, label));
};

// Ebenenauswahl (Referenz + Versatz + "Fläche wählen")
function planeControls(f, key = 'plane', onChange = () => {}) {
  const wrap = h('span', { class: 'dgroup' });
  const build = () => {
    wrap.innerHTML = '';
    const p = f[key];
    const frames = computeFrames(S.project.features || []);
    const opts = [{ v: 'FRONT', l: 'FRONT' }, { v: 'TOP', l: 'TOP' }, { v: 'RIGHT', l: 'RIGHT' }];
    for (const d of S.project.features || []) if (d.type === 'datum' && frames[d.id]) opts.push({ v: d.id, l: d.name });
    if (p.ref === 'FACE') opts.push({ v: 'FACE', l: 'Gewählte Fläche' });
    wrap.append(
      field('Ebene', selectCtl(opts, () => p.ref, v => { p.ref = v; onChange(); }, () => {})),
      field('Versatz', numInput(() => p.offset || 0, v => { p.offset = v; }, { onChange })),
      h('button', { class: 'btn small', onclick: () => pickOnce('Ebene oder ebene Fläche im Grafikfenster wählen …', pk => pk && (pk.type === 'datum' || (pk.type === 'face' && pk.plane)), pk => {
        if (pk.type === 'datum') { f[key] = { ref: pk.key, offset: 0 }; }
        else f[key] = { ref: 'FACE', offset: 0, frame: faceFrame(pk.plane) };
        build(); onChange(); msg('Ebene gewählt');
      }) }, 'Wählen'),
    );
  };
  build();
  return wrap;
}

function openDashboard({ title, feature, replaceId, controls, preview = true, okLabel = '✔', onOk, onCancel, hint }) {
  closeDashboard();
  setMode('op');
  dash = { feature, replaceId };
  if (preview) { S.preview = { feature, replaceId }; }
  const d = $('dash'); d.hidden = false; d.innerHTML = '';
  const err = h('span', { class: 'derr' });
  const update = () => { if (preview) schedulePreview(); };
  const body = h('div', { class: 'dbody' });
  // Eingabefelder neu aufbauen (z. B. nachdem ein Maß im Bild geändert wurde)
  const rebuild = () => { body.innerHTML = ''; const ctl = typeof controls === 'function' ? controls(update) : controls; body.append(ctl, hint ? h('span', { class: 'dhint' }, hint) : null); };
  rebuild();
  d.append(
    h('div', { class: 'dtitle' }, title),
    body,
    err,
    h('div', { class: 'dbtns' },
      h('button', { class: 'btn ok', title: 'Übernehmen', onclick: async () => { if (onOk) await onOk(); else await finishFeature(feature, replaceId); } }, okLabel),
      h('button', { class: 'btn cancel', title: 'Abbrechen', onclick: () => { closeDashboard(); regen(); onCancel?.(); } }, '✖')),
  );
  dash.err = err; dash.rebuild = rebuild;
  if (preview) regen();
}
// Zugriff für das Maß-Overlay
export const getSketcher = () => sketcher;
export const dashFeature = () => (dash ? dash.feature : null);
export function dashEdit(mut) {
  if (!dash) return false;
  mut(dash.feature);
  if (dash.rebuild) dash.rebuild();
  if (S.preview) schedulePreview(); else emit('dims');
  return true;
}
on('regen', () => { if (dash && dash.err) dash.err.textContent = S.errors[dash.feature.id] || ''; });

async function finishFeature(feature, replaceId) {
  const f = JSON.parse(JSON.stringify(feature));
  closeDashboard();
  await commit((replaceId ? 'Ändern: ' : 'Einfügen: ') + f.name, p => {
    if (replaceId) p.features = p.features.map(x => x.id === replaceId ? f : x); else p.features.push(f);
  });
  if (S.errors[f.id]) msg(f.name + ': ' + S.errors[f.id], 'err');
}

function nextName(type) {
  const n = (S.project.features || []).filter(f => f.type === type).length + 1;
  return (type === 'datum' ? 'DTM' : featureLabel({ type })) + n;
}
const hasSolid = () => !!S.mesh;
const modeOptions = [{ v: 'add', l: 'Material hinzufügen' }, { v: 'cut', l: 'Material entfernen' }];

// =====================================================================
// Skizze
// =====================================================================
let sketcher = null;
let sketchRender = () => {};
export function inSketch() { return !!sketcher; }
// Bemaßungswerkzeug in der Skizze aktivieren (Ribbon)
export function startSketchDimTool() { if (!sketcher) return; sketcher.setTool('dim'); sketchRender(); }

async function choosePlane() {
  // bevorzugt aktuelle Auswahl (Fläche / Datumebene)
  const f = S.sel.find(s => s.type === 'face' && s.plane);
  if (f) return { ref: 'FACE', offset: 0, frame: faceFrame(f.plane) };
  const d = S.sel.find(s => s.type === 'datum');
  if (d) return { ref: d.key, offset: 0 };
  const frames = computeFrames(S.project.features || []);
  const opts = [{ v: 'FRONT', l: 'FRONT (XY)' }, { v: 'TOP', l: 'TOP (XZ)' }, { v: 'RIGHT', l: 'RIGHT (YZ)' }];
  for (const x of S.project.features || []) if (x.type === 'datum' && frames[x.id]) opts.push({ v: x.id, l: x.name });
  const r = await modal('Skizzenebene wählen', body => {
    const sel = selectCtl(opts, () => 'FRONT', () => {});
    const off = h('input', { type: 'number', value: 0, step: 'any', class: 'num' });
    body.append(h('p', { class: 'dim' }, 'Tipp: Wählen Sie vorher eine ebene Fläche oder Datumebene im Grafikfenster, um direkt darauf zu skizzieren.'), field('Ebene', sel), field('Versatz', off));
    return () => ({ ref: sel.value, offset: parseFloat(off.value) || 0 });
  }, [{ label: 'Abbrechen', value: null }, { label: 'Skizze starten', primary: true, value: 'form' }]);
  return r;
}

export async function startSketch({ existingId = null, after = null } = {}) {
  if (sketcher) return;
  closeDashboard();
  let sk = existingId ? S.project.features.find(f => f.id === existingId) : null;
  let plane = sk ? sk.plane : await choosePlane();
  if (!plane) return;
  const idx = sk ? S.project.features.indexOf(sk) : S.project.features.length;
  const frames = computeFrames(S.project.features.slice(0, idx));
  const frame = resolveFrame(plane, frames);
  setMode('sketch');
  clearSel();
  const v = S.viewer;
  v.lookAtFrame(frame, false);
  const panel = $('sketchpanel'); panel.hidden = false;
  // Tippen in Zahlenfeldern ('edit') baut das Panel nicht neu auf (Fokus bleibt), alle anderen Änderungen schon
  const render = kind => { sketchRender = () => renderSketchPanel(panel, finish, cancel); if (kind !== 'edit') sketchRender(); emit('dims'); };
  sketcher = new Sketcher(v, frame, sk ? sk.entities : [], render, sk ? sk.dims : []);
  const finish = async () => {
    const ents = sketcher.entities; const sdims = sketcher.dims;
    if (!ents.length) { cancel(); msg('Leere Skizze verworfen'); return; }
    const id = sk ? sk.id : uid();
    const name = sk ? sk.name : nextName('sketch');
    sketcher.destroy(); sketcher = null; panel.hidden = true; setMode('idle');
    await commit((sk ? 'Skizze ändern: ' : 'Skizze: ') + name, p => {
      const feat = { id, type: 'sketch', name, plane, entities: ents, dims: sdims, layer: 'L_SKETCH', ...(sk ? { suppressed: sk.suppressed, hidden: sk.hidden, layer: sk.layer } : {}) };
      if (sk) p.features = p.features.map(x => x.id === id ? feat : x); else p.features.push(feat);
    });
    v.setStandardView('iso');
    if (after) after(id);
  };
  const cancel = () => { sketcher.destroy(); sketcher = null; panel.hidden = true; setMode('idle'); v.setStandardView('iso'); };
  render();
  msg('Skizze: Werkzeug wählen und im Grafikfenster klicken. Rechtsklick = Auswahlwerkzeug, Doppelklick schließt eine Linienfolge.');
}

function renderSketchPanel(panel, finish, cancel) {
  const sk = sketcher; panel.innerHTML = '';
  const tool = (id, label) => h('button', { class: 'btn small' + (sk.tool === id ? ' active' : ''), onclick: () => { sk.setTool(id); renderSketchPanel(panel, finish, cancel); } }, label);
  panel.append(
    h('div', { class: 'ptitle' }, 'Skizze'),
    h('div', { class: 'prow' }, tool('select', 'Auswahl'), tool('line', 'Linien'), tool('rect', 'Rechteck'), tool('circle', 'Kreis')),
    h('div', { class: 'prow' }, tool('dim', '⟷ Bemaßung'),
      sk.tool === 'dim' ? field('Art', selectCtl([{ v: 'a', l: 'Ausgerichtet' }, { v: 'h', l: 'Horizontal' }, { v: 'v', l: 'Vertikal' }], () => sk.dimMode, v => { sk.dimMode = v; })) : null,
      checkCtl('Lagemaße', () => sk.showPos, v => { sk.showPos = v; emit('dims'); })),
    sk.tool === 'dim' ? h('div', { class: 'dim small' }, 'Zwei Punkte anklicken (Ecken, Mittelpunkte, Kreisquadranten, Ursprung). Wert im Bild anklicken, um das Maß zu ändern.') : null,
    h('div', { class: 'prow' },
      field('Raster', numInput(() => sk.snap, v => sk.setSnap(v, sk.snapOn), { step: 'any', min: 0.1 })),
      checkCtl('Einrasten', () => sk.snapOn, v => sk.setSnap(sk.snap, v))),
  );
  const list = h('div', { class: 'elist' });
  sk.entities.forEach((e, i) => {
    const row = h('div', { class: 'erow' + (i === sk.sel ? ' sel' : ''), onclick: ev => { if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'BUTTON') return; sk.sel = i; sk.redraw(); renderSketchPanel(panel, finish, cancel); } });
    const n = (key, label) => field(label, numInput(() => +(+e[key]).toFixed(4), v => sk.update(i, { [key]: v }), { step: 'any' }));
    if (e.type === 'rect') row.append(h('b', null, 'Rechteck'), n('cx', 'X'), n('cy', 'Y'), n('w', 'Breite'), n('h', 'Höhe'), n('rot', 'Winkel°'));
    else if (e.type === 'circle') row.append(h('b', null, 'Kreis'), n('cx', 'X'), n('cy', 'Y'), n('r', 'Radius'));
    else row.append(h('b', null, `Linienzug (${e.pts.length} Punkte)`));
    row.append(h('button', { class: 'btn small', title: 'Löschen', onclick: () => { sk.sel = i; sk.removeSelected(); renderSketchPanel(panel, finish, cancel); } }, '🗑'));
    list.append(row);
  });
  if (!sk.entities.length) list.append(h('div', { class: 'dim' }, 'Noch keine Geometrie. Beispiel: „Rechteck“ wählen, zwei Ecken anklicken.'));
  if (sk.dims.length) {
    list.append(h('div', { class: 'ptitle' }, 'Maße'));
    sk.dims.forEach(d => {
      const val = measureDim(sk.entities, d);
      list.append(h('div', { class: 'erow' }, h('b', null, { a: 'Abstand', h: 'Horizontal', v: 'Vertikal' }[d.mode]),
        field('Wert', numInput(() => (val === null ? 0 : +val.toFixed(4)), v => { if (setDimValue(sk.entities, d, v)) { sk.redraw(); sk.onChange('edit'); } }, { step: 'any', min: 0.0001 })),
        h('button', { class: 'btn small', title: 'Maß löschen', onclick: () => { sk.dims = sk.dims.filter(x => x !== d); sk.redraw(); sk.onChange('dims'); } }, '🗑')));
    });
  }
  panel.append(list, h('div', { class: 'prow end' },
    h('button', { class: 'btn ok', onclick: finish }, '✔ Fertig'),
    h('button', { class: 'btn cancel', onclick: cancel }, '✖ Abbrechen')));
}

// =====================================================================
// Features
// =====================================================================
export async function cmdExtrude() {
  const sel = S.selFeature && S.project.features.find(f => f.id === S.selFeature && f.type === 'sketch');
  if (sel) return dashExtrude(sel.id);
  await startSketch({ after: id => dashExtrude(id) });
}
export async function cmdRevolve() {
  const sel = S.selFeature && S.project.features.find(f => f.id === S.selFeature && f.type === 'sketch');
  if (sel) return dashRevolve(sel.id);
  await startSketch({ after: id => dashRevolve(id) });
}

const sketchOptions = () => S.project.features.filter(f => f.type === 'sketch').map(f => ({ v: f.id, l: f.name }));

export function dashExtrude(sketchId, feature, replaceId) {
  const f = feature ? JSON.parse(JSON.stringify(feature)) : { id: uid(), type: 'extrude', name: nextName('extrude'), sketch: sketchId, depth: 20, mode: hasSolid() ? 'add' : 'add', sym: false, flip: false };
  openDashboard({
    title: 'Extrusion', feature: f, replaceId,
    controls: up => [
      field('Skizze', selectCtl(sketchOptions(), () => f.sketch, v => { f.sketch = v; }, up)),
      field('Typ', selectCtl(modeOptions, () => f.mode, v => { f.mode = v; }, up)),
      field('Tiefe', numInput(() => f.depth, v => { f.depth = v; }, { onChange: up })),
      checkCtl('Symmetrisch', () => f.sym, v => { f.sym = v; }, up),
      checkCtl('Richtung umkehren', () => f.flip, v => { f.flip = v; }, up),
    ],
  });
}
export function dashRevolve(sketchId, feature, replaceId) {
  const f = feature ? JSON.parse(JSON.stringify(feature)) : { id: uid(), type: 'revolve', name: nextName('revolve'), sketch: sketchId, axis: 'y', angle: 360, mode: 'add' };
  openDashboard({
    title: 'Rotation', feature: f, replaceId,
    controls: up => [
      field('Skizze', selectCtl(sketchOptions(), () => f.sketch, v => { f.sketch = v; }, up)),
      field('Achse', selectCtl([{ v: 'y', l: 'Vertikale Skizzenachse (Y)' }, { v: 'x', l: 'Horizontale Skizzenachse (X)' }], () => f.axis, v => { f.axis = v; }, up)),
      field('Typ', selectCtl(modeOptions, () => f.mode, v => { f.mode = v; }, up)),
      field('Winkel°', numInput(() => f.angle, v => { f.angle = v; }, { onChange: up, min: 1 })),
    ],
  });
}

export function cmdHole() {
  if (!hasSolid()) { msg('Zuerst einen Grundkörper erzeugen (z. B. Extrusion).', 'warn'); return; }
  const start = pk => {
    let plane, x = 0, y = 0;
    if (pk.type === 'datum') plane = { ref: pk.key, offset: 0 };
    else {
      const fr = faceFrame(pk.plane); plane = { ref: 'FACE', offset: 0, frame: fr };
      const d = sub(pk.point.toArray ? pk.point.toArray() : pk.point, fr.o);
      x = +dot(d, fr.x).toFixed(3); y = +dot(d, fr.y).toFixed(3);
    }
    const f = { id: uid(), type: 'hole', name: nextName('hole'), plane, x, y, d: 10, depth: 0, flip: false };
    dashHole(f);
  };
  const pre = S.sel.find(s => (s.type === 'face' && s.plane) || s.type === 'datum');
  if (pre) { start(pre); return; }
  pickOnce('Bohrung: ebene Fläche oder Datumebene wählen …', pk => pk && (pk.type === 'datum' || (pk.type === 'face' && pk.plane)), start);
}
export function dashHole(feature, replaceId) {
  const f = feature;
  openDashboard({
    title: 'Bohrung', feature: f, replaceId,
    controls: up => [
      planeControls(f, 'plane', up),
      field('X', numInput(() => f.x, v => { f.x = v; }, { onChange: up })),
      field('Y', numInput(() => f.y, v => { f.y = v; }, { onChange: up })),
      field('Ø', numInput(() => f.d, v => { f.d = v; }, { onChange: up, min: 0.01 })),
      field('Tiefe (0 = durch)', numInput(() => f.depth, v => { f.depth = v; }, { onChange: up, min: 0 })),
      checkCtl('Richtung umkehren', () => f.flip, v => { f.flip = v; }, up),
    ],
  });
}

export function cmdPrimitive(kind) {
  const base = { id: uid(), name: nextName(kind), plane: { ref: 'FRONT', offset: 0 }, x: 0, y: 0, mode: hasSolid() ? 'add' : 'add' };
  const f = kind === 'sphere' ? { ...base, type: 'sphere', r: 20 } : { ...base, type: 'cone', r1: 20, r2: 0, h: 40 };
  dashPrimitive(f);
}
export function dashPrimitive(feature, replaceId) {
  const f = feature;
  openDashboard({
    title: f.type === 'sphere' ? 'Kugel' : 'Kegel', feature: f, replaceId,
    controls: up => [
      planeControls(f, 'plane', up),
      field('X', numInput(() => f.x, v => { f.x = v; }, { onChange: up })),
      field('Y', numInput(() => f.y, v => { f.y = v; }, { onChange: up })),
      ...(f.type === 'sphere' ? [field('Radius', numInput(() => f.r, v => { f.r = v; }, { onChange: up, min: 0.01 }))]
        : [field('Radius unten', numInput(() => f.r1, v => { f.r1 = v; }, { onChange: up })), field('Radius oben', numInput(() => f.r2, v => { f.r2 = v; }, { onChange: up })), field('Höhe', numInput(() => f.h, v => { f.h = v; }, { onChange: up, min: 0.01 }))]),
      field('Typ', selectCtl(modeOptions, () => f.mode, v => { f.mode = v; }, up)),
    ],
  });
}

export function cmdDatum() {
  const f = { id: uid(), type: 'datum', name: nextName('datum'), plane: { ref: 'FRONT', offset: 50 }, layer: 'L_DATUM' };
  const pre = S.sel.find(s => (s.type === 'face' && s.plane) || s.type === 'datum');
  if (pre) f.plane = pre.type === 'datum' ? { ref: pre.key, offset: 20 } : { ref: 'FACE', offset: 0, frame: faceFrame(pre.plane) };
  dashDatum(f);
}
export function dashDatum(feature, replaceId) {
  const f = feature;
  openDashboard({ title: 'Datumebene', feature: f, replaceId, controls: up => [planeControls(f, 'plane', up)] });
}

export function cmdEdgeOp(kind) {
  if (!hasSolid()) { msg('Kein Körper vorhanden.', 'warn'); return; }
  const label = kind === 'fillet' ? 'Rundung' : 'Fase';
  const f = { id: uid(), type: kind, name: nextName(kind), r: 2, all: false, edges: [] };
  closeDashboard(); clearSel();
  const info = h('span', { class: 'dhint' });
  const upd = () => { info.textContent = f.all ? 'Alle Kanten' : `${S.sel.filter(s => s.type === 'edge').length} Kante(n) gewählt (Strg+Klick für mehrere)`; };
  openDashboard({
    title: label, feature: f, preview: false,
    controls: () => [
      field('Radius / Abstand', numInput(() => f.r, v => { f.r = v; }, { min: 0.01 })),
      checkCtl('Alle Kanten', () => f.all, v => { f.all = v; upd(); }),
      info,
    ],
    onOk: async () => {
      f.edges = S.sel.filter(s => s.type === 'edge').map(s => s.mid);
      if (!f.all && !f.edges.length) { toast('Bitte Kanten auswählen oder „Alle Kanten“ aktivieren.', 'warn'); return; }
      await finishFeature(f);
    },
    onCancel: () => clearSel(),
  });
  S.viewer.filter = { face: false, edge: true, datum: false, body: false };
  pickOnce(label + ': Kanten im Grafikfenster anklicken …', pk => !!pk && pk.type === 'edge', pk => {
    const i = S.sel.findIndex(s => s.type === 'edge' && s.id === pk.id);
    if (i >= 0) S.sel.splice(i, 1); else S.sel.push(pk);
    refreshHighlights(); upd();
  }, { once: false });
  upd();
}

// Bemaßungswerkzeug am Körper: Referenzmaße (Kantenlänge, Ø/Radius einer Kreiskante, Abstand ebener Flächen)
export function cmdDimBody() {
  if (!hasSolid()) { msg('Kein Körper vorhanden.', 'warn'); return; }
  const st = { kind: 'length', first: null };
  closeDashboard(); clearSel();
  const hintEl = h('span', { class: 'dhint' });
  const add = async d => { await commit('Maß einfügen', p => { (p.dims ||= []).push({ id: uid('m'), ...d }); }, { light: true }); };
  const arm = () => {
    cancelPick(); st.first = null; clearSel();
    const faces = st.kind === 'faces';
    S.viewer.filter = faces ? { face: true, edge: false, datum: false, body: true } : { face: false, edge: true, datum: false, body: false };
    hintEl.textContent = faces ? 'Zwei parallele ebene Flächen nacheinander anklicken' : st.kind === 'length' ? 'Kante anklicken' : 'Kreiskante anklicken';
    if (faces) {
      pickOnce('Abstand: erste ebene Fläche anklicken …', pk => !!pk && pk.type === 'face' && !!pk.plane, async pk => {
        if (!st.first) { st.first = pk; S.sel = [pk]; refreshHighlights(); msg('Zweite Fläche anklicken …', 'prompt'); return; }
        const a = st.first, b = pk; st.first = null; clearSel();
        const n1 = norm(a.plane.n), n2 = norm(b.plane.n);
        if (Math.abs(dot(n1, n2)) < 0.999) { toast('Die Flächen sind nicht parallel.', 'warn'); return; }
        if (Math.abs(dot(sub(b.plane.o, a.plane.o), n1)) < 1e-9) { toast('Beide Flächen liegen in derselben Ebene.', 'warn'); return; }
        await add({ kind: 'faces', f1: { o: a.plane.o, n: n1 }, f2: { o: b.plane.o, n: n2 }, anchor: a.point.toArray ? a.point.toArray() : a.point });
        msg('Maß eingefügt. Weitere Flächen anklicken oder ✔.', 'prompt');
      }, { once: false });
    } else {
      pickOnce(st.kind === 'length' ? 'Kante anklicken …' : 'Kreiskante anklicken …', pk => !!pk && pk.type === 'edge' && !!pk.mid, async pk => {
        const d = { kind: st.kind, mid: pk.mid, anchor: pk.mid };
        if (resolveBodyDim(S.mesh, d).stale) { toast(st.kind === 'length' ? 'Kante nicht gefunden.' : 'Das ist keine Kreiskante.', 'warn'); return; }
        await add(d);
        msg('Maß eingefügt. Weitere Kante anklicken oder ✔.', 'prompt');
      }, { once: false });
    }
  };
  openDashboard({
    title: 'Bemaßung', feature: { id: 'dimtool' }, preview: false, okLabel: '✔',
    controls: () => [
      field('Art', selectCtl([{ v: 'length', l: 'Kantenlänge' }, { v: 'diam', l: 'Durchmesser (Kreiskante)' }, { v: 'radius', l: 'Radius (Kreiskante)' }, { v: 'faces', l: 'Abstand Fläche–Fläche' }], () => st.kind, v => { st.kind = v; arm(); })),
      hintEl,
    ],
    onOk: async () => { closeDashboard(); clearSel(); },
    onCancel: () => clearSel(),
  });
  arm();
}
export async function clearBodyDims() {
  if (!(S.project.dims || []).length) return;
  await commit('Alle Maße löschen', p => { p.dims = []; }, { light: true });
}

export function cmdPattern() {
  const srcs = (S.project.features || []).filter(f => ['extrude', 'hole', 'sphere'].includes(f.type));
  if (!srcs.length) { msg('Für ein Muster wird eine Extrusion, Bohrung oder Kugel benötigt.', 'warn'); return; }
  const f = { id: uid(), type: 'pattern', name: nextName('pattern'), source: S.selFeature && srcs.find(s => s.id === S.selFeature) ? S.selFeature : srcs[srcs.length - 1].id, count: 3, dx: 20, dy: 0 };
  dashPattern(f);
}
export function dashPattern(feature, replaceId) {
  const f = feature;
  const srcs = (S.project.features || []).filter(x => ['extrude', 'hole', 'sphere'].includes(x.type));
  openDashboard({
    title: 'Linearmuster', feature: f, replaceId,
    controls: up => [
      field('Quelle', selectCtl(srcs.map(s => ({ v: s.id, l: s.name })), () => f.source, v => { f.source = v; }, up)),
      field('Anzahl', numInput(() => f.count, v => { f.count = Math.max(2, Math.round(v)); }, { step: 1, min: 2, onChange: up })),
      field('Abstand X', numInput(() => f.dx, v => { f.dx = v; }, { onChange: up })),
      field('Abstand Y', numInput(() => f.dy, v => { f.dy = v; }, { onChange: up })),
    ],
    hint: 'Abstände in den Skizzenkoordinaten der Quelle',
  });
}

export function dashImport(feature, replaceId) {
  const f = feature;
  openDashboard({
    title: 'Import: ' + (S.project.imports[f.importId]?.name || ''), feature: f, replaceId,
    controls: up => [
      field('Typ', selectCtl([{ v: 'add', l: 'Hinzufügen' }, { v: 'cut', l: 'Entfernen' }], () => f.mode, v => { f.mode = v; }, up)),
      field('X', numInput(() => f.t[0], v => { f.t[0] = v; }, { onChange: up })),
      field('Y', numInput(() => f.t[1], v => { f.t[1] = v; }, { onChange: up })),
      field('Z', numInput(() => f.t[2], v => { f.t[2] = v; }, { onChange: up })),
      field('Rot X°', numInput(() => f.r[0], v => { f.r[0] = v; }, { onChange: up })),
      field('Rot Y°', numInput(() => f.r[1], v => { f.r[1] = v; }, { onChange: up })),
      field('Rot Z°', numInput(() => f.r[2], v => { f.r[2] = v; }, { onChange: up })),
      field('Maßstab', numInput(() => f.s, v => { f.s = v; }, { onChange: up, min: 0.0001 })),
      h('button', { class: 'btn small', title: 'Zoll nach mm', onclick: () => { f.s = 25.4; dashImport(f, replaceId); } }, '×25,4'),
    ],
  });
}

// Feature bearbeiten
export function editFeature(id) {
  const f = S.project.features.find(x => x.id === id); if (!f) return;
  if (S.mode === 'sketch') return;
  switch (f.type) {
    case 'sketch': return startSketch({ existingId: id });
    case 'extrude': return dashExtrude(f.sketch, f, id);
    case 'revolve': return dashRevolve(f.sketch, f, id);
    case 'hole': return dashHole(JSON.parse(JSON.stringify(f)), id);
    case 'sphere': case 'cone': return dashPrimitive(JSON.parse(JSON.stringify(f)), id);
    case 'datum': return dashDatum(JSON.parse(JSON.stringify(f)), id);
    case 'pattern': return dashPattern(JSON.parse(JSON.stringify(f)), id);
    case 'import': return dashImport(JSON.parse(JSON.stringify(f)), id);
    case 'fillet': case 'chamfer':
      return openDashboard({
        title: featureLabel(f), feature: JSON.parse(JSON.stringify(f)), replaceId: id, preview: true,
        controls: up => [field('Radius / Abstand', numInput(() => dash.feature.r, v => { dash.feature.r = v; }, { onChange: up, min: 0.01 }))],
      });
    default: return;
  }
}

export async function deleteFeature(id) {
  const f = S.project.features.find(x => x.id === id); if (!f) return;
  const deps = S.project.features.filter(x => x.sketch === id || x.source === id);
  await commit('Löschen: ' + f.name, p => { p.features = p.features.filter(x => x.id !== id); });
  if (deps.length) msg(`${deps.length} abhängige(s) Feature(s) verweisen nun auf ein gelöschtes Element.`, 'warn');
}
export async function toggleSuppress(id) {
  await commit('Unterdrücken', p => { const f = p.features.find(x => x.id === id); if (f) f.suppressed = !f.suppressed; });
}
export async function renameItem(kind, id) {
  const cur = kind === 'comp' ? S.project.components.find(c => c.id === id) : S.project.features.find(f => f.id === id);
  const n = await promptText('Umbenennen', 'Neuer Name', cur?.name || '');
  if (!n) return;
  await commit('Umbenennen', p => { const t = (kind === 'comp' ? p.components : p.features).find(x => x.id === id); if (t) t.name = n; });
}

// =====================================================================
// Baugruppe
// =====================================================================
export async function cmdAddComponent() {
  let files;
  try { files = (await api.list()).filter(f => f.type === 'part'); } catch (e) { msg(e.message, 'err'); return; }
  if (!files.length) { msg('Keine Teile vorhanden. Erst ein Teil erstellen oder eine STEP/STL-Datei importieren.', 'warn'); return; }
  const r = await modal('Komponente hinzufügen', body => {
    const sel = h('select', { size: Math.min(files.length, 10), class: 'wide' }, files.map((f, i) => h('option', { value: f.name, selected: i === 0 }, f.name)));
    body.append(h('p', { class: 'dim' }, 'Teil auswählen:'), sel);
    return () => sel.value;
  }, [{ label: 'Abbrechen', value: null }, { label: 'Hinzufügen', primary: true, value: 'form' }]);
  if (!r) return;
  await addComponent(r);
}
export async function addComponent(file) {
  const id = uid('c');
  const base = file.replace(/\.ccad$/, '');
  const n = (S.project.components || []).filter(c => c.file === file).length;
  await commit('Komponente: ' + base, p => { p.components.push({ id, file, name: n ? `${base} (${n + 1})` : base, matrix: IDENT(), layer: 'L_COMP', hidden: false }); }, { fit: (S.project.components || []).length <= 1 });
  S.selFeature = id; emit('tree');
  if (S.errors[id]) msg(S.errors[id], 'err');
}

export function dashMoveComponent(id) {
  const comp = S.project.components.find(c => c.id === id); if (!comp) return;
  const start = comp.matrix.slice();
  const d = { id: 'mv', t: [0, 0, 0], r: [0, 0, 0] };
  const apply = () => {
    const c = [start[3], start[7], start[11]];
    const R = matFromTRS([0, 0, 0], d.r, 1);
    comp.matrix = mul4(mul4(trans4([d.t[0] + c[0], d.t[1] + c[1], d.t[2] + c[2]]), R), mul4(trans4([-c[0], -c[1], -c[2]]), start));
  };
  openDashboard({
    title: 'Platzieren: ' + comp.name, feature: d, preview: false,
    controls: () => {
      const up = () => { apply(); regen(); };
      return [
        field('Δ X', numInput(() => 0, v => { d.t[0] = v; }, { onChange: up })),
        field('Δ Y', numInput(() => 0, v => { d.t[1] = v; }, { onChange: up })),
        field('Δ Z', numInput(() => 0, v => { d.t[2] = v; }, { onChange: up })),
        field('Rot X°', numInput(() => 0, v => { d.r[0] = v; }, { onChange: up })),
        field('Rot Y°', numInput(() => 0, v => { d.r[1] = v; }, { onChange: up })),
        field('Rot Z°', numInput(() => 0, v => { d.r[2] = v; }, { onChange: up })),
      ];
    },
    onOk: async () => {
      const finalM = comp.matrix.slice(); comp.matrix = start;
      closeDashboard();
      await commit('Komponente platzieren', p => { const c = p.components.find(x => x.id === id); if (c) c.matrix = finalM; });
    },
    onCancel: () => { comp.matrix = start; regen(); },
  });
}

// Fläche-auf-Fläche (Creo: "Passend" / "Bündig")
export async function cmdMate() {
  if ((S.project.components || []).length < 2) { msg('Für eine Verbindung werden mindestens zwei Komponenten benötigt.', 'warn'); return; }
  const accept = pk => !!pk && pk.type === 'face' && pk.plane && String(pk.bodyKey).startsWith('c:');
  pickOnce('Verbinden 1/2: Fläche der Komponente wählen, die bewegt werden soll …', accept, a => {
    S.sel = [a]; refreshHighlights();
    pickOnce('Verbinden 2/2: Zielfläche einer anderen Komponente wählen …', pk => accept(pk) && pk.bodyKey !== a.bodyKey, async b => {
      const r = await modal('Verbindungsart', body => {
        const sel = selectCtl([{ v: 'mate', l: 'Passend (Flächen liegen gegenüber)' }, { v: 'align', l: 'Bündig (Flächen in gleiche Richtung)' }], () => 'mate', () => {});
        const off = h('input', { type: 'number', value: 0, step: 'any', class: 'num' });
        body.append(field('Art', sel), field('Abstand', off));
        return () => ({ kind: sel.value, off: parseFloat(off.value) || 0 });
      }, [{ label: 'Abbrechen', value: null }, { label: 'OK', primary: true, value: 'form' }]);
      if (!r) { clearSel(); return; }
      const n1 = norm(a.plane.n), n2 = norm(b.plane.n);
      const want = r.kind === 'mate' ? mul(n2, -1) : n2;
      let M = IDENT();
      const c = dot(n1, want);
      if (c < 0.999999) {
        let axis = cross(n1, want);
        if (len(axis) < 1e-9) axis = Math.abs(n1[0]) < 0.9 ? cross(n1, [1, 0, 0]) : cross(n1, [0, 1, 0]);
        M = rotAbout(axis, Math.acos(Math.max(-1, Math.min(1, c))), a.plane.o);
      }
      const o1 = a.plane.o;
      const dist = dot(sub(b.plane.o, o1), n2);
      const T = trans4(mul(n2, dist + r.off));
      const cid = a.itemId;
      clearSel();
      await commit('Komponenten verbinden', p => { const comp = p.components.find(x => x.id === cid); if (comp) comp.matrix = mul4(T, mul4(M, comp.matrix)); });
    }, {});
  });
}

export async function removeComponent(id) {
  await commit('Komponente entfernen', p => { p.components = p.components.filter(c => c.id !== id); });
}

export { invalidatePart };

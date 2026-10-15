// app.js – Start der Anwendung, Ribbon (Creo-ähnlich), Import/Export, Analyse, SpaceMouse
import { S, on, emit, msg, commit, regen, undo, redo, save, setProject, openFile, handlePick, clearSel, partShapes, bodyDensity, markDirty, refreshHighlights } from './core.js';
import { api } from './api.js';
import { Viewer } from './viewer.js';
import { createKernel } from './kernel.js';
import { SpaceMouse } from './spacemouse.js';
import { newProject, uid, faceFrame, featureLabel } from './model.js';
import { h, modal, promptText, confirmBox, info, toast, ctxMenu, download, b64encode, fmt } from './ui.js';
import * as ops from './ops.js';
import { initPanels, showTab, refreshFiles } from './panels.js';
import { initDims } from './dims.js';

const $ = id => document.getElementById(id);

// ---------------- Icons (einfache Strichgrafiken) ----------------
const P = {
  new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
  asm: '<rect x="3" y="12" width="8" height="8"/><rect x="13" y="12" width="8" height="8"/><rect x="8" y="3" width="8" height="8"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z"/>',
  save: '<path d="M5 3h12l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 8h-3"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 8h3"/>',
  regen: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
  extrude: '<path d="M4 15l8 4 8-4M4 15V9l8-4 8 4v6M12 9v10M4 9l8 4 8-4"/>',
  revolve: '<ellipse cx="12" cy="12" rx="8" ry="3"/><path d="M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5M12 3v6"/>',
  hole: '<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="12" cy="12" r="4"/>',
  fillet: '<path d="M4 4v16h16"/><path d="M4 4h6a10 10 0 0 1 10 10v6"/>',
  chamfer: '<path d="M4 4v16h16"/><path d="M4 4h8l8 8v8"/>',
  pattern: '<circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="14" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="18" cy="14" r="2"/>',
  datum: '<path d="M4 16 9 6h11l-5 10z"/>',
  sketch: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/>',
  cone: '<path d="M12 4 4 18c0 1.7 3.6 3 8 3s8-1.3 8-3z"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M4 20h16"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/>',
  ortho: '<rect x="5" y="5" width="14" height="14"/><path d="M5 5l-2-2M19 5l2-2M5 19l-2 2M19 19l2 2"/>',
  shade: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="currentColor" fill-opacity=".35"/>',
  wire: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5"/>',
  planes: '<path d="M3 17 8 7h13l-5 10z"/><path d="M12 3v18"/>',
  analysis: '<path d="M3 17h18v4H3z"/><path d="M6 17v-3M10 17v-3M14 17v-3M18 17v-3"/><path d="M5 11l5-6 4 4 5-6"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v7"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  dim: '<path d="M4 7v10M20 7v10M4 12h16M4 12l3-2M4 12l3 2M20 12l-3-2M20 12l-3 2"/>',
  zip: '<path d="M5 3h10l4 4v14H5z"/><path d="M11 3v6M11 11v2M11 15v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5"/>',
  power: '<path d="M12 3v9M6.5 6.5a8 8 0 1 0 11 0"/>',
  cam: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l1.5-3h5L16 7"/>',
};
const ico = n => h('span', { html: `<svg viewBox="0 0 24 24">${P[n] || P.cube}</svg>` });

// ---------------- Meldungen / Status ----------------
on('msg', ({ text, kind }) => {
  // Kein Log mehr: nur die Statuszeile und – bei Aufforderungen – der Hinweis im Bild
  $('stmsg').textContent = text;
  const hint = $('hint');
  if (kind === 'prompt') { hint.hidden = false; hint.textContent = text; } else if (!S.pickHandler) hint.hidden = true;
});
function updateStatus() {
  const d = $('docname'); d.textContent = S.name ? S.name : '–'; d.classList.toggle('dirty', S.dirty);
  $('stsave').textContent = S.saving ? 'Speichere …' : S.dirty ? 'Ungespeicherte Änderungen (Autosave)' : S.name ? 'Gespeichert ✓' : '';
  document.title = (S.name ? S.name + ' – ' : '') + 'BrowserCAD';
}
on('status', updateStatus); on('project', updateStatus);

// ---------------- Dokumente ----------------
const safeName = n => n.replace(/[^\p{L}\p{N} _.()\-]/gu, '_').replace(/\.ccad$/i, '').slice(0, 60) || 'Unbenannt';
async function uniqueName(base) {
  const list = await api.list(); const have = new Set(list.map(f => f.name.toLowerCase()));
  let n = base, i = 1; while (have.has((n + '.ccad').toLowerCase())) n = `${base}_${++i}`;
  return n + '.ccad';
}
async function createDocument(type) {
  const label = type === 'assembly' ? 'Baugruppe' : 'Teil';
  const n = await promptText('Neues ' + label, 'Name', type === 'assembly' ? 'Baugruppe1' : 'Teil1');
  if (!n) return;
  const file = await uniqueName(safeName(n));
  const p = newProject(type, file.replace(/\.ccad$/, ''));
  await api.put(file, JSON.stringify(p));
  await save();
  await setProject(p, file);
  try { localStorage.setItem('bcad.last.' + S.user, file); } catch (e) { /* */ }
  refreshFiles();
  msg(label + ' „' + file + '“ angelegt – Änderungen werden automatisch gespeichert.');
}

// ---------------- Import ----------------
const STEP_EXT = /\.(stp|step|p21)$/i, STL_EXT = /\.stl$/i, CREO_EXT = /\.(prt|asm)(\.\d+)?$/i, SW_EXT = /\.(sldprt|sldasm)$/i;

async function importFileDialog() {
  const inp = h('input', { type: 'file', accept: '.stp,.step,.stl,.prt,.asm,.sldprt,.sldasm,.1,.2,.3', hidden: true });
  document.body.append(inp);
  inp.addEventListener('change', async () => { const f = inp.files[0]; inp.remove(); if (f) await importFile(f); });
  inp.click();
}

async function importFile(file) {
  const name = file.name;
  try {
    let format, data, label = name;
    if (STEP_EXT.test(name)) { format = 'step'; data = new TextDecoder().decode(await file.arrayBuffer()); }
    else if (STL_EXT.test(name)) { format = 'stl'; data = b64encode(new Uint8Array(await file.arrayBuffer())); }
    else if (CREO_EXT.test(name) || SW_EXT.test(name)) {
      const ext = (CREO_EXT.test(name) ? '.' + name.match(CREO_EXT)[1] : '.' + name.match(SW_EXT)[1]).toLowerCase();
      if (S.info.converters.includes(ext)) {
        msg('Konvertiere ' + name + ' über den Server-Konverter …');
        data = await api.convert(name, await file.arrayBuffer()); format = 'step'; label = name;
      } else { await explainNative(name, ext); return; }
    } else { toast('Dateityp nicht unterstützt: ' + name, 'err'); return; }
    if (S.project.type === 'assembly') await importAsComponent(name, format, data);
    else await importIntoPart(label, format, data);
  } catch (e) { msg('Import fehlgeschlagen: ' + e.message, 'err'); }
}

function explainNative(name, ext) {
  const creo = ext === '.prt' || ext === '.asm';
  return info('Native ' + (creo ? 'Creo' : 'SolidWorks') + '-Datei', [
    h('p', null, `„${name}“ ist ein proprietäres Binärformat. Es gibt keinen freien Leser dafür – der Kern von BrowserCAD (OpenCascade) kann es nicht direkt öffnen.`),
    h('p', null, [h('b', null, 'Lösung 1 (empfohlen): '), creo ? 'In Creo „Datei → Speichern unter → Kopie speichern“ und als STEP (*.stp) oder STL ablegen, dann hier importieren.' : 'In SolidWorks „Datei → Speichern unter“ und als STEP AP214 (*.step) oder STL wählen, dann hier importieren.']),
    h('p', null, [h('b', null, 'Lösung 2: '), `Einen Konverter am Server einrichten. In der config.json neben der exe unter "converters" eintragen, z. B.:`]),
    h('pre', null, `"converters": {\n  "${ext}": ["C:\\\\Tools\\\\konverter.exe", "{in}", "{out}"]\n}`),
    h('p', { class: 'dim' }, 'Der Konverter wird mit der Eingabedatei {in} aufgerufen und muss eine STEP-Datei nach {out} schreiben (z. B. FreeCAD, CAD Exchanger, Datakit, Creo/SolidWorks im Batch-Modus). Danach Server neu starten.'),
  ]);
}

async function importIntoPart(label, format, data) {
  const importId = uid('i');
  const f = { id: uid(), type: 'import', name: 'Import: ' + label, importId, mode: 'add', t: [0, 0, 0], r: [0, 0, 0], s: 1 };
  await commit('Import ' + label, p => { p.imports[importId] = { name: label, format, data }; p.features.push(f); }, { fit: true });
  if (S.errors[f.id]) { msg(S.errors[f.id], 'err'); return; }
  msg(`„${label}“ importiert.` + (format === 'stl' ? ' STL ist ein Dreiecksnetz (Schale) – Boolesche Operationen sind damit eingeschränkt.' : ''));
}

async function importAsComponent(name, format, data) {
  const base = safeName(name.replace(/\.[^.]*$/, ''));
  const file = await uniqueName(base);
  const part = newProject('part', file.replace(/\.ccad$/, ''));
  const importId = uid('i');
  part.imports[importId] = { name, format, data };
  part.features.push({ id: uid(), type: 'import', name: 'Import: ' + name, importId, mode: 'add', t: [0, 0, 0], r: [0, 0, 0], s: 1 });
  await api.put(file, JSON.stringify(part));
  refreshFiles();
  await ops.addComponent(file);
  msg(`„${name}“ als Teil „${file}“ gespeichert und in die Baugruppe eingefügt.`);
}

// ---------------- Export ----------------
const baseName = () => S.name.replace(/\.ccad$/, '');
function exportShape() {
  const K = S.K;
  if (S.project.type === 'assembly') {
    const parts = partShapes();
    if (!parts.length) return null;
    const c = K.buildCompound(parts.map(p => ({ shape: p.shape, matrix: p.matrix })));
    return { shape: c.shape, scope: c.scope };
  }
  if (!S.result || !S.result.shape) return null;
  return { shape: S.result.shape, scope: null };
}
async function exportAs(fmt) {
  const ex = exportShape();
  if (!ex) { msg('Nichts zum Exportieren vorhanden.', 'warn'); return; }
  try {
    if (fmt === 'step') { download(baseName() + '.step', S.K.exportSTEP(ex.shape), 'application/step'); }
    else {
      const q = await qualityDialog(); if (q === null) return;
      download(baseName() + '.stl', S.K.exportSTL(ex.shape, q), 'model/stl');
    }
    msg('Export ' + fmt.toUpperCase() + ' erstellt.', 'info');
  } catch (e) { msg('Export fehlgeschlagen: ' + e.message, 'err'); }
  finally { if (ex.scope) S.K.release(ex.scope); }
}
async function qualityDialog() {
  const r = await modal('STL-Export', body => {
    const s = h('select', null, [['0.5', 'Grob (kleine Datei)'], ['1', 'Normal'], ['3', 'Fein'], ['8', 'Sehr fein']].map(([v, l]) => h('option', { value: v, selected: v === '1' }, l)));
    body.append(h('label', { class: 'field' }, h('span', null, 'Netzqualität'), s));
    return () => parseFloat(s.value);
  }, [{ label: 'Abbrechen', value: null }, { label: 'Exportieren', primary: true, value: 'form' }]);
  return r;
}
async function downloadCcad() {
  await save(true);
  const j = await api.get(S.name);
  download(S.name, JSON.stringify(j), 'application/json');
}

// ---------------- Analyse ----------------
async function showAnalysis() {
  let shapes;
  if (S.project.type === 'assembly') shapes = partShapes().map(p => p.shape); else shapes = S.result && S.result.shape ? [S.result.shape] : [];
  if (!shapes.length) { msg('Kein Körper vorhanden.', 'warn'); return; }
  const compute = d => {
    let vol = 0, area = 0, mass = 0;
    for (const s of shapes) { const m = S.K.massProps(s, d); vol += m.volume; area += m.area; mass += m.mass_g; }
    return { vol, area, mass };
  };
  let single = null;
  if (S.project.type === 'part') single = S.K.massProps(shapes[0], bodyDensity());
  const box = h('div');
  const draw = d => {
    const r = compute(d);
    box.innerHTML = '';
    const rows = [['Volumen', fmt(r.vol, 2) + ' mm³'], ['Oberfläche', fmt(r.area, 2) + ' mm²'], ['Masse', fmt(r.mass, 3) + ' g (' + fmt(r.mass / 1000, 4) + ' kg)']];
    if (single) {
      const b = single.bbox; const c = single.centre;
      rows.push(['Schwerpunkt', `X ${fmt(c[0])}  Y ${fmt(c[1])}  Z ${fmt(c[2])}`]);
      rows.push(['Abmessungen', `${fmt(b.max[0] - b.min[0])} × ${fmt(b.max[1] - b.min[1])} × ${fmt(b.max[2] - b.min[2])} mm`]);
    }
    box.append(h('table', null, rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))));
  };
  await modal('Modellanalyse', body => {
    const dens = h('input', { type: 'number', step: 'any', value: bodyDensity(), class: 'num' });
    dens.addEventListener('input', () => { const d = parseFloat(dens.value); if (d > 0) { S.project.params.density = d; draw(d); markDirty(); } });
    body.append(h('label', { class: 'field' }, h('span', null, 'Dichte (g/cm³) – Stahl 7,85 · Alu 2,70 · PLA 1,24'), dens), box);
    draw(bodyDensity());
  }, [{ label: 'Schließen', primary: true, value: true }], { width: '520px' });
}

// ---------------- Ansicht ----------------
const viewBtn = (label, icon, run, opt = {}) => ({ label, icon, run, ...opt });
function setView(n) { S.viewer.setStandardView(n); }
function toggleDims() { S.showDims = !S.showDims; emit('dims'); renderRibbon(); msg(S.showDims ? 'Maße eingeblendet' : 'Maße ausgeblendet'); }

// ---------------- Ribbon ----------------
let activeTab = 'modell';
const isPart = () => S.project && S.project.type === 'part';
const isAsm = () => S.project && S.project.type === 'assembly';
const busy = () => S.mode !== 'idle';

function ribbonDefs() {
  const part = isPart(), asm = isAsm(), idle = !busy();
  return {
    datei: [
      ['Neu', [viewBtn('Teil', 'new', () => createDocument('part')), viewBtn('Baugruppe', 'asm', () => createDocument('assembly'))]],
      ['Datei', [viewBtn('Dateien', 'open', () => showTab('files')), viewBtn('Speichern', 'save', () => save(true)), viewBtn('.ccad laden', 'export', downloadCcad), viewBtn('Alle (ZIP)', 'zip', () => { location.href = '/api/download-all'; })]],
      ['Import / Export', [viewBtn('Importieren', 'import', importFileDialog, { off: !idle }), viewBtn('STEP', 'export', () => exportAs('step')), viewBtn('STL', 'export', () => exportAs('stl'))]],
      ['Sitzung', [viewBtn('Kennwort ändern', 'help', passwordDialog), viewBtn('Abmelden', 'trash', logout)]],
    ],
    modell: [
      ['Datum', [viewBtn('Ebene', 'datum', ops.cmdDatum, { off: !(part && idle) }), viewBtn('Skizze', 'sketch', () => ops.startSketch(), { off: !(part && idle) })]],
      ['Form', [viewBtn('Extrusion', 'extrude', ops.cmdExtrude, { off: !(part && idle) }), viewBtn('Rotation', 'revolve', ops.cmdRevolve, { off: !(part && idle) }), viewBtn('Kugel', 'sphere', () => ops.cmdPrimitive('sphere'), { off: !(part && idle) }), viewBtn('Kegel', 'cone', () => ops.cmdPrimitive('cone'), { off: !(part && idle) })]],
      ['Konstruktionselemente', [viewBtn('Bohrung', 'hole', ops.cmdHole, { off: !(part && idle) }), viewBtn('Rundung', 'fillet', () => ops.cmdEdgeOp('fillet'), { off: !(part && idle) }), viewBtn('Fase', 'chamfer', () => ops.cmdEdgeOp('chamfer'), { off: !(part && idle) })]],
      ['Muster', [viewBtn('Linear', 'pattern', ops.cmdPattern, { off: !(part && idle) })]],
      ['Bemaßung', [viewBtn('Skizzenmaß', 'dim', ops.startSketchDimTool, { off: !ops.inSketch(), active: ops.inSketch() && ops.getSketcher().tool === 'dim' }), viewBtn('Körper bemaßen', 'dim', ops.cmdDimBody, { off: !(part && idle) }), viewBtn('Maße ein/aus', 'dim', toggleDims, { active: S.showDims }), viewBtn('Körpermaße löschen', 'trash', ops.clearBodyDims, { off: !(part && idle) })]],
      ['Daten', [viewBtn('Importieren', 'import', importFileDialog, { off: !idle })]],
      ['Operationen', [viewBtn('Rückgängig', 'undo', undo, { off: !idle }), viewBtn('Wiederholen', 'redo', redo, { off: !idle }), viewBtn('Regenerieren', 'regen', () => regen({ fit: false }), { off: !idle })]],
    ],
    baugruppe: [
      ['Komponente', [viewBtn('Hinzufügen', 'add', ops.cmdAddComponent, { off: !(asm && idle) }), viewBtn('Platzieren', 'move', () => { const id = S.selFeature; if (id && S.project.components.some(c => c.id === id)) ops.dashMoveComponent(id); else msg('Bitte zuerst eine Komponente im Baum wählen.', 'warn'); }, { off: !(asm && idle) }), viewBtn('Entfernen', 'trash', () => { const id = S.selFeature; if (id && S.project.components.some(c => c.id === id)) ops.removeComponent(id); }, { off: !(asm && idle) })]],
      ['Verbinden', [viewBtn('Fläche/Fläche', 'link', ops.cmdMate, { off: !(asm && idle) })]],
      ['Daten', [viewBtn('Importieren', 'import', importFileDialog, { off: !(asm && idle) })]],
      ['Operationen', [viewBtn('Rückgängig', 'undo', undo, { off: !idle }), viewBtn('Wiederholen', 'redo', redo, { off: !idle })]],
    ],
    ansicht: [
      ['Orientierung', [viewBtn('Standard', 'cube', () => setView('iso')), viewBtn('Front', 'cube', () => setView('front')), viewBtn('Oben', 'cube', () => setView('top')), viewBtn('Rechts', 'cube', () => setView('right')), viewBtn('Hinten', 'cube', () => setView('back')), viewBtn('Unten', 'cube', () => setView('bottom')), viewBtn('Links', 'cube', () => setView('left'))]],
      ['Zoom', [viewBtn('Anpassen', 'fit', () => { S.viewer.fit(); }), viewBtn('Perspektive', 'ortho', () => { const o = S.viewer.toggleOrtho(); msg(o ? 'Orthogonale Ansicht' : 'Perspektivische Ansicht'); })]],
      ['Darstellung', [['shaded-edges', 'Schattiert + Kanten', 'shade'], ['shaded', 'Schattiert', 'shade'], ['wireframe', 'Drahtmodell', 'wire'], ['hidden', 'Verdeckte Linien', 'wire'], ['transparent', 'Transparent', 'wire']].map(([m, l, i]) => viewBtn(l, i, () => { S.viewer.setDisplayMode(m); renderRibbon(); }, { active: S.viewer?.displayMode === m }))],
      ['Anzeige', [viewBtn('Datumebenen', 'planes', () => { S.viewer.setShowDatums(!S.viewer.showDatums); renderRibbon(); }, { active: S.viewer?.showDatums }), viewBtn('Maße', 'dim', toggleDims, { active: S.showDims }), viewBtn('Bild', 'cam', () => download(baseName() + '.png', dataUrlToBlob(S.viewer.snapshot()), 'image/png'))]],
    ],
    analyse: [['Modell', [viewBtn('Masseneigenschaften', 'analysis', showAnalysis)]]],
    werkzeuge: [
      ['Eingabegeräte', [viewBtn('SpaceMouse', 'mouse', smDialog)]],
      ['Hilfe', [viewBtn('Tastenkürzel', 'help', showHelp), viewBtn('Info', 'help', showAbout)]],
    ],
  };
}
const dataUrlToBlob = u => { const b = u.split(',')[1]; const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: 'image/png' }); };

const TABS = [['datei', 'Datei'], ['modell', 'Modell'], ['baugruppe', 'Baugruppe'], ['ansicht', 'Ansicht'], ['analyse', 'Analyse'], ['werkzeuge', 'Werkzeuge']];
function renderRibbon() {
  const tabs = $('tabs'); tabs.innerHTML = '';
  for (const [k, l] of TABS) tabs.append(h('button', { class: k === activeTab ? 'active' : '', onclick: () => { activeTab = k; renderRibbon(); } }, l));
  const rb = $('ribbon'); rb.innerHTML = '';
  if (!S.project) return;
  for (const [title, btns] of ribbonDefs()[activeTab]) {
    rb.append(h('div', { class: 'rgroup' }, h('div', { class: 'rb' }, btns.map(b => h('button', { class: 'rbtn' + (b.active ? ' active' : ''), disabled: !!b.off, title: b.label, onclick: () => b.run() }, ico(b.icon), b.label))), h('div', { class: 'rt' }, title)));
  }
  const q = $('qbtns'); q.innerHTML = '';
  const qb = (icon, title, run) => h('button', { class: 'qb', title, onclick: run }, ico(icon));
  q.append(qb('new', 'Neues Teil', () => createDocument('part')), qb('open', 'Dateien', () => showTab('files')), qb('save', 'Speichern (Strg+S)', () => save(true)), qb('undo', 'Rückgängig (Strg+Z)', undo), qb('redo', 'Wiederholen (Strg+Y)', redo), qb('regen', 'Regenerieren', () => regen()));
}
on('project', renderRibbon);

function renderViewbar() {
  const vb = $('viewbar'); vb.innerHTML = '';
  const b = (icon, t, run) => h('button', { class: 'qb', title: t, onclick: run }, ico(icon));
  vb.append(b('fit', 'Ansicht anpassen', () => S.viewer.fit()), b('cube', 'Standardorientierung', () => setView('iso')), b('ortho', 'Perspektive / Orthogonal', () => S.viewer.toggleOrtho()),
    h('span', { class: 'sepv' }), b('shade', 'Schattiert + Kanten', () => S.viewer.setDisplayMode('shaded-edges')), b('wire', 'Drahtmodell', () => S.viewer.setDisplayMode('wireframe')), b('planes', 'Datumebenen', () => S.viewer.setShowDatums(!S.viewer.showDatums)));
}

// ---------------- Kontextmenü im Grafikfenster ----------------
function viewContext(pk, ev) {
  const items = [];
  if (pk && pk.type === 'face' && pk.plane) {
    items.push({ label: 'Skizze auf dieser Fläche', run: () => { S.sel = [pk]; ops.startSketch(); }, disabled: !isPart() });
    items.push({ label: 'Bohrung hier …', run: () => { S.sel = [pk]; ops.cmdHole(); }, disabled: !isPart() });
  }
  if (pk && pk.type === 'edge' && isPart()) {
    items.push({ label: 'Rundung …', run: () => { ops.cmdEdgeOp('fillet'); S.sel = [pk]; refreshHighlights(); ops.dashEdit(() => {}); } });
    items.push({ label: 'Fase …', run: () => { ops.cmdEdgeOp('chamfer'); S.sel = [pk]; refreshHighlights(); ops.dashEdit(() => {}); } });
  }
  if (pk && pk.type === 'datum' && isPart()) items.push({ label: 'Skizze auf dieser Ebene', run: () => { S.sel = [pk]; ops.startSketch(); } });
  if (pk && isAsm() && pk.itemId && S.project.components.some(c => c.id === pk.itemId)) {
    items.push({ label: 'Komponente platzieren …', run: () => ops.dashMoveComponent(pk.itemId) });
    items.push({ label: 'Teil öffnen', run: () => openFile(S.project.components.find(c => c.id === pk.itemId).file) });
  }
  if (items.length) items.push({ sep: 1 });
  items.push({ label: 'Ansicht anpassen', run: () => S.viewer.fit() }, { label: 'Standardorientierung', run: () => setView('iso') }, { label: 'Auswahl aufheben', run: clearSel });
  ctxMenu(ev.clientX, ev.clientY, items);
}

// ---------------- SpaceMouse ----------------
let sm = null;
function initSpaceMouse() {
  sm = new SpaceMouse(S.viewer, {
    buttons: (bits, prev) => {
      const down = bits & ~prev;
      if (down & 1) S.viewer.fit();
      if (down & 2) setView('iso');
    },
  });
  sm.onStatus = t => { $('smbtn').textContent = '🖱 ' + (t.startsWith('verbunden') ? 'verbunden' : 'SpaceMouse'); $('smbtn').title = t; msg('SpaceMouse: ' + t); };
  if (SpaceMouse.supported() && window.isSecureContext) sm.connect(true).catch(() => {});
  $('smbtn').addEventListener('click', smDialog);
}

async function smDialog() {
  const s = sm.settings;
  await modal('3Dconnexion SpaceMouse', body => {
    const status = h('p', { class: sm.dev ? '' : 'dim' }, sm.dev ? 'Verbunden: ' + (sm.dev.productName || 'SpaceMouse') : 'Nicht verbunden.');
    const warn = [];
    if (!SpaceMouse.supported()) warn.push('Dieser Browser unterstützt WebHID nicht – bitte Chrome oder Edge verwenden.');
    else if (!window.isSecureContext) warn.push('WebHID funktioniert nur über HTTPS (https://<IP>:8443, Zertifikatswarnung einmal bestätigen) oder über http://localhost.');
    const conn = h('button', { class: 'btn', onclick: async () => { try { await sm.connect(); } catch (e) { toast(e.message, 'err', 8000); } status.textContent = sm.dev ? 'Verbunden: ' + (sm.dev.productName || 'SpaceMouse') : 'Nicht verbunden.'; } }, 'SpaceMouse verbinden');
    body.append(status, ...warn.map(w => h('p', { class: 'err' }, w)), conn,
      h('p', { class: 'dim' }, 'Falls das Gerät nicht geöffnet werden kann: den 3Dconnexion-Treiber beenden (er belegt das Gerät exklusiv). Die Achsenzuordnung ist einstellbar, weil sie je nach Modell/Treiber abweichen kann – bewegen Sie die Kappe und beobachten Sie die Balken.'));
    const bars = [];
    SpaceMouse.AXES.forEach((name, i) => {
      const bar = h('div', { class: 'axbar' }, h('i'));
      bars.push(bar.firstChild);
      const act = h('select', null, SpaceMouse.ACTIONS.map((a, k) => h('option', { value: k, selected: s.map[i] === k }, a)));
      act.addEventListener('change', () => { s.map[i] = +act.value; sm.save(); });
      const inv = h('input', { type: 'checkbox', checked: s.invert[i] }); inv.addEventListener('change', () => { s.invert[i] = inv.checked; sm.save(); });
      body.append(h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr 150px 70px', gap: '8px', alignItems: 'center' } }, h('span', null, name), bar, act, h('label', { class: 'dcheck' }, inv, 'invers')));
    });
    const sens = h('input', { type: 'range', min: 0.2, max: 4, step: 0.1, value: s.sens }); sens.addEventListener('input', () => { s.sens = +sens.value; sm.save(); });
    body.append(h('label', { class: 'field' }, h('span', null, 'Empfindlichkeit'), sens));
    const timer = setInterval(() => { sm.raw.forEach((v, i) => { const x = Math.max(-1, Math.min(1, v / 350)); bars[i].style.left = x < 0 ? (50 + x * 50) + '%' : '50%'; bars[i].style.width = Math.abs(x) * 50 + '%'; }); if (!document.body.contains(body)) clearInterval(timer); }, 60);
  }, [{ label: 'Schließen', primary: true, value: true }], { width: '620px' });
}

function showHelp() {
  info('Bedienung', [
    h('table', null, [
      ['Mittlere Maustaste ziehen', 'Ansicht drehen'], ['Strg + Mitteltaste ziehen / Mausrad', 'Zoomen'], ['Umschalt + Mitteltaste ziehen', 'Verschieben'],
      ['Alt + Linke Taste', 'Drehen (ohne Mittelmaustaste); mit Umschalt = Verschieben, mit Strg = Zoom'], ['Rechte Taste ziehen', 'Verschieben'], ['Rechtsklick (ohne Ziehen)', 'Kontextmenü'],
      ['Strg + Klick', 'Mehrfachauswahl'], ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'], ['Strg+S', 'Speichern (Autosave läuft ohnehin)'],
      ['Entf', 'Gewähltes Feature löschen'], ['Esc', 'Auswahlaufforderung abbrechen'],
    ].map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b)))),
  ]);
}
function showAbout() {
  info('BrowserCAD', [h('p', null, `Version ${S.info.version || ''}`), h('p', { class: 'dim' }, 'CAD-Kern: OpenCascade (über OpenCascade.js, LGPL 2.1). 3D-Darstellung: three.js (MIT). Alle Daten liegen auf dem Server neben der Programmdatei.')]);
}

async function passwordDialog() {
  const r = await modal('Kennwort ändern', body => {
    const o = h('input', { type: 'password', autocomplete: 'current-password', class: 'wide' });
    const n = h('input', { type: 'password', autocomplete: 'new-password', class: 'wide' });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password', class: 'wide' });
    body.append(h('label', { class: 'field' }, h('span', null, 'Aktuelles Kennwort'), o), h('label', { class: 'field' }, h('span', null, 'Neues Kennwort (mind. 6 Zeichen)'), n), h('label', { class: 'field' }, h('span', null, 'Neues Kennwort wiederholen'), n2));
    return () => ({ o: o.value, n: n.value, n2: n2.value });
  }, [{ label: 'Abbrechen', value: null }, { label: 'Ändern', primary: true, value: 'form' }]);
  if (!r) return;
  if (r.n !== r.n2) { toast('Die neuen Kennwörter stimmen nicht überein.', 'err'); return; }
  try { await api.changePassword(r.o, r.n); toast('Kennwort geändert.', 'ok'); } catch (e) { toast(e.message, 'err'); }
}

async function logout() { await save(); await api.logout(); location.href = '/login'; }

// ---------------- Start ----------------
async function loadKernel() {
  const bar = $('loadbar');
  bar.style.width = '15%';
  const mod = await import('/vendor/occ/opencascade.wasm.js');
  bar.style.width = '35%';
  const oc = await new mod.default({ locateFile: p => (p.endsWith('.wasm') ? '/vendor/occ/opencascade.wasm.wasm' : p) });
  bar.style.width = '100%';
  return createKernel(oc);
}

async function boot() {
  try {
    const me = await api.me(); S.user = me.username;
    S.info = await api.info();
    S.admin = !!me.admin;
    $('username').textContent = '👤 ' + S.user + (S.admin ? ' (Admin)' : '');
    if (S.admin) { const b = $('adminbtn'); b.hidden = false; b.addEventListener('click', () => window.open('/admin', '_blank')); }
    document.querySelector('.qbrand').append(h('small', { class: 'dim', style: { fontWeight: 400, marginLeft: '4px' } }, S.info.version || ''));
  } catch (e) { return; }
  S.viewer = new Viewer($('viewport'));
  initDims(S.viewer, $('center'));
  S.viewer.onPick = handlePick;
  S.viewer.onContext = viewContext;
  S.viewer.onHover = p => { $('sthover').textContent = p ? (p.type === 'face' ? 'Fläche' : p.type === 'edge' ? 'Kante' : 'Datumebene') : ''; };
  renderViewbar();
  try { S.K = await loadKernel(); } catch (e) { $('loadtext').textContent = 'CAD-Kern konnte nicht geladen werden: ' + e.message; console.error(e); return; }
  initPanels();
  initSpaceMouse();
  $('logoutbtn').addEventListener('click', logout);
  $('pwbtn').addEventListener('click', passwordDialog);

  // zuletzt geöffnete Datei oder erste vorhandene, sonst neues Teil anlegen
  let files = [];
  try { files = await api.list(); } catch (e) { msg(e.message, 'err'); }
  const last = (() => { try { return localStorage.getItem('bcad.last.' + S.user); } catch (e) { return null; } })();
  const pick = files.find(f => f.name === last) || files[0];
  try {
    if (pick) await openFile(pick.name);
    else {
      const p = newProject('part', 'Teil1'); await api.put('Teil1.ccad', JSON.stringify(p)); await setProject(p, 'Teil1.ccad');
    }
  } catch (e) { msg('Datei konnte nicht geöffnet werden: ' + e.message, 'err'); const p = newProject('part', 'Teil1'); await setProject(p, 'Teil1.ccad'); markDirty(); }
  $('loading').remove();
  renderRibbon(); updateStatus();
  msg('Bereit. Tipp: Modell → Extrusion startet eine Skizze auf FRONT/TOP/RIGHT.');
  addEventListener('keydown', onKey);
}

function onKey(e) {
  const t = e.target.tagName;
  const typing = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); return; }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (S.mode === 'idle') undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); if (S.mode === 'idle') redo(); }
  else if (e.key === 'Escape') { if (S.pickHandler) { S.pickHandler = null; $('hint').hidden = true; } }
  else if (e.key === 'Delete' && S.mode === 'idle' && S.selFeature) {
    if (isPart() && S.project.features.some(f => f.id === S.selFeature)) ops.deleteFeature(S.selFeature);
    else if (isAsm() && S.project.components.some(c => c.id === S.selFeature)) ops.removeComponent(S.selFeature);
  }
}

on('regen', () => { renderRibbon(); });
on('mode', () => { renderRibbon(); });
boot();
void faceFrame; void featureLabel;

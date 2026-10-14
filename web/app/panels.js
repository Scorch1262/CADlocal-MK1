// panels.js – linke Seitenleiste: Modellbaum, Ebenen (wie in Creo) und Dateien
import { S, on, emit, commit, itemVisible, layerVisible, openFile, save, refreshHighlights } from './core.js';
import { api } from './api.js';
import { uid, featureLabel } from './model.js';
import { h, ctxMenu, modal, promptText, confirmBox, toast, download, fmt } from './ui.js';
import { editFeature, deleteFeature, toggleSuppress, renameItem, dashMoveComponent, removeComponent } from './ops.js';

const $ = id => document.getElementById(id);
let tab = 'tree';

const ICON = { sketch: '✎', extrude: '⬒', revolve: '◐', hole: '◉', datum: '▱', fillet: '◜', chamfer: '◢', pattern: '⁘', sphere: '●', cone: '▲', import: '⇩', comp: '⚙', planes: '▱', body: '◼' };

export function initPanels() {
  document.querySelectorAll('#ltabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  on('tree', render); on('project', render);
  // Dateiliste nicht bei jeder Auswahl/Regeneration neu vom Server laden
  on('sel', () => { if (tab !== 'files') render(); }); on('regen', () => { if (tab !== 'files') render(); });
  render();
}

export function showTab(t) { tab = t; render(); }

function render() {
  document.querySelectorAll('#ltabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const body = $('lbody'); if (!S.project) { body.innerHTML = ''; return; }
  const scroll = body.scrollTop;
  body.innerHTML = '';
  if (tab === 'tree') body.append(treeView());
  else if (tab === 'layers') body.append(layersView());
  else filesView(body);
  body.scrollTop = scroll;
}

// ---------------- Zuordnung zu Ebenen ----------------
async function assignLayer(kind, id, layerId) {
  await commit('Ebene zuordnen', p => {
    if (kind === 'planes') p.planesLayer = layerId;
    else if (kind === 'body') p.bodyLayer = layerId;
    else if (kind === 'comp') { const c = p.components.find(x => x.id === id); if (c) c.layer = layerId; }
    else { const f = p.features.find(x => x.id === id); if (f) f.layer = layerId; }
  }, { light: true });
}
const layerMenu = (kind, id) => S.project.layers.map(l => ({ label: 'Zur Ebene: ' + l.name, run: () => assignLayer(kind, id, l.id) }));

async function toggleHidden(kind, id) {
  await commit('Ein-/Ausblenden', p => {
    if (kind === 'planes') p.planesHidden = !p.planesHidden;
    else if (kind === 'body') p.bodyHidden = !p.bodyHidden;
    else if (kind === 'comp') { const c = p.components.find(x => x.id === id); if (c) c.hidden = !c.hidden; }
    else { const f = p.features.find(x => x.id === id); if (f) f.hidden = !f.hidden; }
  }, { light: true });
}

// ---------------- Modellbaum ----------------
function row({ icon, label, kind, id, hidden, layerHidden, error, suppressed, selected, onClick, onDbl, menu, indent = 0, tip }) {
  const r = h('div', { class: 'trow' + (selected ? ' sel' : '') + (suppressed ? ' supp' : '') + (error ? ' err' : ''), style: { paddingLeft: (8 + indent * 16) + 'px' }, title: error || tip || '' },
    h('span', { class: 'ticon' }, icon),
    h('span', { class: 'tlabel' }, label),
    error ? h('span', { class: 'tbadge' }, '⚠') : null,
    suppressed ? h('span', { class: 'tbadge dim' }, 'unterdrückt') : null,
    kind ? h('button', { class: 'eye' + ((hidden || layerHidden) ? ' off' : ''), title: layerHidden ? 'Durch Ebene ausgeblendet' : 'Ein-/Ausblenden', onclick: e => { e.stopPropagation(); toggleHidden(kind, id); } }, (hidden || layerHidden) ? '◌' : '◉') : null);
  r.addEventListener('click', onClick || (() => {}));
  if (onDbl) r.addEventListener('dblclick', onDbl);
  r.addEventListener('contextmenu', e => { e.preventDefault(); if (onClick) onClick(); if (menu) ctxMenu(e.clientX, e.clientY, menu); });
  return r;
}

function treeView() {
  const p = S.project; const root = h('div', { class: 'tree' });
  const ext = p.type === 'assembly' ? '.ASM' : '.PRT';
  root.append(row({ icon: p.type === 'assembly' ? '▣' : '◼', label: p.name.toUpperCase().replace(/\.CCAD$/, '') + ext, tip: S.name }));
  const planeVisHidden = !layerVisible(p, p.planesLayer);
  root.append(row({ icon: ICON.planes, label: 'Standard-Datumebenen', indent: 1, kind: 'planes', hidden: p.planesHidden, layerHidden: planeVisHidden,
    menu: [...layerMenu('planes'), { sep: 1 }, { label: p.planesHidden ? 'Einblenden' : 'Ausblenden', run: () => toggleHidden('planes') }] }));
  for (const n of ['RIGHT', 'TOP', 'FRONT']) {
    root.append(row({ icon: '▱', label: n, indent: 2, selected: S.sel.some(s => s.type === 'datum' && s.key === n),
      onClick: () => { S.sel = [{ type: 'datum', key: n, itemId: n, frame: null }]; S.selFeature = n; refreshHighlights(); } }));
  }
  if (p.type === 'part') {
    for (const f of p.features) {
      const isDatum = f.type === 'datum', isSketch = f.type === 'sketch';
      root.append(row({
        icon: ICON[f.type] || '•', label: f.name || featureLabel(f), indent: 1, id: f.id,
        kind: (isDatum || isSketch) ? 'feature' : null, hidden: f.hidden, layerHidden: !layerVisible(p, f.layer) && (isDatum || isSketch),
        error: S.errors[f.id], suppressed: f.suppressed, selected: S.selFeature === f.id,
        onClick: () => { S.selFeature = f.id; if (isDatum) S.sel = [{ type: 'datum', key: f.id, itemId: f.id, frame: null }]; else S.sel = S.sel.filter(s => s.type !== 'datum'); refreshHighlights(); },
        onDbl: () => editFeature(f.id),
        menu: [
          { label: 'Bearbeiten', run: () => editFeature(f.id) },
          { label: f.suppressed ? 'Fortsetzen' : 'Unterdrücken', run: () => toggleSuppress(f.id), disabled: isDatum || isSketch },
          (isDatum || isSketch) ? { label: f.hidden ? 'Einblenden' : 'Ausblenden', run: () => toggleHidden('feature', f.id) } : null,
          { sep: 1 }, ...((isDatum || isSketch) ? layerMenu('feature', f.id) : []), (isDatum || isSketch) ? { sep: 1 } : null,
          { label: 'Umbenennen …', run: () => renameItem('feature', f.id) },
          { label: 'Löschen', run: () => deleteFeature(f.id) },
        ],
      }));
    }
    if (S.mesh) {
      root.append(row({ icon: ICON.body, label: 'Körper (Geometrie)', indent: 1, kind: 'body', hidden: p.bodyHidden, layerHidden: !layerVisible(p, p.bodyLayer),
        menu: [...layerMenu('body'), { sep: 1 }, { label: p.bodyHidden ? 'Einblenden' : 'Ausblenden', run: () => toggleHidden('body') }] }));
    }
  } else {
    for (const c of p.components || []) {
      root.append(row({
        icon: ICON.comp, label: c.name, indent: 1, id: c.id, kind: 'comp', hidden: c.hidden, layerHidden: !layerVisible(p, c.layer),
        error: S.errors[c.id], selected: S.selFeature === c.id, tip: c.file,
        onClick: () => { S.selFeature = c.id; emit('sel'); },
        onDbl: () => dashMoveComponent(c.id),
        menu: [
          { label: 'Platzieren …', run: () => dashMoveComponent(c.id) },
          { label: 'Teil öffnen', run: async () => { try { await openFile(c.file); } catch (e) { toast(e.message, 'err'); } } },
          { label: c.hidden ? 'Einblenden' : 'Ausblenden', run: () => toggleHidden('comp', c.id) },
          { sep: 1 }, ...layerMenu('comp', c.id), { sep: 1 },
          { label: 'Umbenennen …', run: () => renameItem('comp', c.id) },
          { label: 'Entfernen', run: () => removeComponent(c.id) },
        ],
      }));
    }
    if (!(p.components || []).length) root.append(h('div', { class: 'dim pad' }, 'Keine Komponenten. Register „Baugruppe“ → „Komponente hinzufügen“.'));
  }
  return root;
}

// ---------------- Ebenen ----------------
function layersView() {
  const p = S.project; const wrap = h('div', { class: 'layers' });
  const count = id => {
    let n = 0;
    if (p.planesLayer === id) n++;
    if (p.type === 'part') { if (p.bodyLayer === id && S.mesh) n++; n += p.features.filter(f => f.layer === id).length; }
    else n += (p.components || []).filter(c => c.layer === id).length;
    return n;
  };
  wrap.append(h('div', { class: 'ltoolbar' },
    h('button', { class: 'btn small', onclick: async () => { const n = await promptText('Neue Ebene', 'Name der Ebene'); if (n) await commit('Ebene anlegen', q => { q.layers.push({ id: uid('L'), name: n.toUpperCase().replace(/\s+/g, '_'), visible: true }); }, { light: true }); } }, '＋ Neue Ebene'),
    h('button', { class: 'btn small', onclick: () => commit('Alle Ebenen einblenden', q => q.layers.forEach(l => { l.visible = true; }), { light: true }) }, 'Alle ein')));
  for (const l of p.layers) {
    const r = h('div', { class: 'lrow' },
      h('input', { type: 'checkbox', checked: l.visible, title: 'Sichtbar', onchange: e => commit('Ebene ' + (e.target.checked ? 'einblenden' : 'ausblenden'), q => { q.layers.find(x => x.id === l.id).visible = e.target.checked; }, { light: true }) }),
      h('span', { class: 'lname' }, l.name), h('span', { class: 'dim' }, `(${count(l.id)})`),
      h('span', { class: 'lspacer' }),
      h('button', { class: 'btn small', title: 'Umbenennen', onclick: async () => { const n = await promptText('Ebene umbenennen', 'Name', l.name); if (n) commit('Ebene umbenennen', q => { q.layers.find(x => x.id === l.id).name = n; }, { light: true }); } }, '✎'),
      h('button', { class: 'btn small', title: 'Löschen', disabled: p.layers.length <= 1, onclick: async () => {
        if (!(await confirmBox('Ebene löschen', `Ebene „${l.name}“ löschen? Zugeordnete Elemente wandern in die erste Ebene.`))) return;
        await commit('Ebene löschen', q => {
          const rest = q.layers.filter(x => x.id !== l.id); const to = rest[0].id;
          if (q.planesLayer === l.id) q.planesLayer = to; if (q.bodyLayer === l.id) q.bodyLayer = to;
          (q.features || []).forEach(f => { if (f.layer === l.id) f.layer = to; }); (q.components || []).forEach(c => { if (c.layer === l.id) c.layer = to; });
          q.layers = rest;
        }, { light: true });
      } }, '🗑'));
    wrap.append(r);
  }
  wrap.append(h('div', { class: 'dim pad' }, 'Elemente werden im Modellbaum per Rechtsklick → „Zur Ebene …“ einer Ebene zugeordnet. Das Ausblenden einer Ebene blendet alle ihre Elemente aus (wie in Creo).'));
  return wrap;
}

// ---------------- Dateien ----------------
export async function refreshFiles() { if (tab === 'files') render(); }

async function filesView(body) {
  const box = h('div', { class: 'files' }, h('div', { class: 'dim pad' }, 'Lade …'));
  body.append(box);
  let list = [];
  try { list = await api.list(); } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'err pad' }, e.message)); return; }
  box.innerHTML = '';
  const up = h('input', { type: 'file', accept: '.ccad', hidden: true, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const txt = await f.text(); const j = JSON.parse(txt); if (j.format !== 'BrowserCAD') throw new Error('Keine BrowserCAD-Datei');
      let name = f.name.endsWith('.ccad') ? f.name : f.name + '.ccad';
      await api.put(name, txt); toast('Hochgeladen: ' + name, 'ok'); render();
    } catch (err) { toast('Upload fehlgeschlagen: ' + err.message, 'err'); }
  } });
  box.append(h('div', { class: 'ltoolbar' },
    h('button', { class: 'btn small', onclick: () => up.click() }, '⇧ Hochladen'), up,
    h('a', { class: 'btn small', href: '/api/download-all' }, '⇩ Alle (ZIP)'),
    h('button', { class: 'btn small', onclick: () => render() }, '⟳')));
  if (!list.length) box.append(h('div', { class: 'dim pad' }, 'Noch keine Dateien.'));
  for (const f of list) {
    const cur = f.name === S.name;
    const r = h('div', { class: 'frow' + (cur ? ' sel' : ''), title: new Date(f.modified).toLocaleString('de-DE') },
      h('span', { class: 'ticon' }, f.type === 'assembly' ? '▣' : '◼'),
      h('span', { class: 'tlabel' }, f.name), h('span', { class: 'dim small' }, fmtSize(f.size)),
      h('button', { class: 'btn small', title: 'Herunterladen', onclick: async e => { e.stopPropagation(); try { const j = await api.get(f.name); download(f.name, JSON.stringify(j), 'application/json'); } catch (err) { toast(err.message, 'err'); } } }, '⇩'),
      h('button', { class: 'btn small', title: 'Löschen', onclick: async e => {
        e.stopPropagation();
        if (cur) { toast('Die geöffnete Datei kann nicht gelöscht werden.', 'warn'); return; }
        if (await confirmBox('Datei löschen', `„${f.name}“ endgültig löschen?`)) { await api.del(f.name); render(); }
      } }, '🗑'));
    r.addEventListener('dblclick', async () => { try { await openFile(f.name); } catch (err) { toast(err.message, 'err'); } });
    r.addEventListener('click', () => { document.querySelectorAll('.frow').forEach(x => x.classList.remove('hl')); r.classList.add('hl'); });
    box.append(r);
  }
  box.append(h('div', { class: 'dim pad' }, 'Doppelklick öffnet eine Datei. Änderungen werden automatisch gespeichert.'));
}
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB';
void fmt; void itemVisible; void modal; void save;

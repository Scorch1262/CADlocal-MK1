// dims.js – Maße im Grafikfenster (SVG-Linien + anklickbare Beschriftungen)
// Angezeigt wird: in der Skizze alle Größenmaße + Maße des Bemaßungswerkzeugs, bei einem Feature in Bearbeitung
// (oder im Baum gewählt) dessen Maße, außerdem die Referenzmaße am Körper. Anklicken einer Beschriftung = Wert ändern.
import * as THREE from '/vendor/three.module.js';
import { S, on, commit, workingFeatures } from './core.js';
import { resolveFrame, computeFrames, toGlobal, entityLoops, add, sub, mul, norm } from './model.js';
import { h, ctxMenu, fmt } from './ui.js';
import { resolveBodyDim } from './bodydims.js';
import * as ops from './ops.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { auto: '#ffd479', user: '#7fd1ff', ref: '#9cf0b0', stale: '#ff7b72' };

export class DimLayer {
  constructor(viewer, host) {
    this.v = viewer;
    this.root = h('div', { id: 'dimlayer' });
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'dimsvg');
    this.root.append(this.svg);
    host.append(this.root);
    this.items = []; this.els = []; this.editing = null; this.waiting = null;
    viewer.onFrame = () => this.draw();
  }

  set(items) {
    if (this.editing) { this.waiting = items; return; }   // während der Eingabe nicht neu aufbauen
    for (const e of this.els) e.remove();
    this.items = items; this.els = [];
    for (const it of items) {
      const el = h('div', { class: 'dimlabel ' + (it.cls || 'auto') + (it.onEdit ? ' editable' : '') }, it.label);
      if (it.onEdit) el.addEventListener('click', ev => { ev.stopPropagation(); this.edit(it, el); });
      el.addEventListener('contextmenu', ev => {
        ev.preventDefault(); ev.stopPropagation();
        ctxMenu(ev.clientX, ev.clientY, [it.onEdit ? { label: 'Wert bearbeiten', run: () => this.edit(it, el) } : null, it.onDelete ? { label: 'Maß löschen', run: () => it.onDelete() } : null, !it.onEdit && !it.onDelete ? { label: 'Referenzmaß (nicht änderbar)', disabled: true, run: () => {} } : null]);
      });
      this.root.append(el); this.els.push(el);
    }
    this.v.requestRender();
  }

  edit(it, el) {
    if (this.editing) return;
    const inp = h('input', { type: 'number', step: 'any', class: 'dimedit', value: +(+it.value).toFixed(4) });
    this.editing = inp;
    el.replaceChildren(inp); el.classList.add('active');
    inp.focus(); inp.select();
    const done = ok => {
      if (this.editing !== inp) return;
      this.editing = null; el.classList.remove('active');
      const val = parseFloat(inp.value);
      el.textContent = it.label;
      const waiting = this.waiting; this.waiting = null;
      if (ok && Number.isFinite(val)) it.onEdit(val);
      else if (waiting) this.set(waiting);
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(false));
    inp.addEventListener('pointerdown', e => e.stopPropagation());
  }

  draw() {
    const cam = this.v.camera;
    const W = this.v.container.clientWidth, H = this.v.container.clientHeight, pw = this.v.pixelWorld;
    this.svg.setAttribute('width', W); this.svg.setAttribute('height', H);
    const proj = p => { const q = new THREE.Vector3(p[0], p[1], p[2]).project(cam); return { x: (q.x * 0.5 + 0.5) * W, y: (-q.y * 0.5 + 0.5) * H, ok: q.z > -1 && q.z < 1 }; };
    let svg = '';
    this.items.forEach((it, i) => {
      const el = this.els[i]; if (!el) return;
      const col = COLORS[it.cls || 'auto'] || COLORS.auto;
      let lx, ly, visible = true;
      if (it.kind === 'tag') {
        const s = proj(it.at); lx = s.x; ly = s.y; visible = s.ok;
        svg += `<circle cx="${s.x}" cy="${s.y}" r="3" fill="${col}"/>`;
      } else {
        const off = mul(it.dir || [0, 0, 0], (it.offPx || 0) * pw);
        const p1 = add(it.base1, off), p2 = add(it.base2, off);
        const sa = proj(it.a), sb = proj(it.b), s1 = proj(p1), s2 = proj(p2);
        visible = s1.ok && s2.ok;
        if (visible) {
          if (it.offPx) { svg += ext(sa, s1, col) + ext(sb, s2, col); }
          svg += `<line x1="${s1.x}" y1="${s1.y}" x2="${s2.x}" y2="${s2.y}" stroke="${col}" stroke-width="1.2"/>` + arrow(s1, s2, col) + arrow(s2, s1, col);
          lx = (s1.x + s2.x) / 2; ly = (s1.y + s2.y) / 2;
          const dx = s2.x - s1.x, dy = s2.y - s1.y, l = Math.hypot(dx, dy) || 1;
          if (!it.offPx) { lx += -dy / l * 14; ly += dx / l * 14; }   // Durchmesser/Radius: Beschriftung neben die Linie
        }
      }
      el.style.display = visible ? '' : 'none';
      if (visible) { el.style.left = lx + 'px'; el.style.top = ly + 'px'; }
    });
    this.svg.innerHTML = svg;
  }
}

function ext(from, to, col) {   // Hilfslinie, 5 px über die Maßlinie hinaus
  const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy);
  if (l < 2) return '';
  return `<line x1="${from.x}" y1="${from.y}" x2="${to.x + dx / l * 5}" y2="${to.y + dy / l * 5}" stroke="${col}" stroke-width="0.8" stroke-opacity="0.7"/>`;
}
function arrow(tip, from, col) {
  const dx = tip.x - from.x, dy = tip.y - from.y, l = Math.hypot(dx, dy);
  if (l < 1) return '';
  const ux = dx / l, uy = dy / l, bx = tip.x - ux * 9, by = tip.y - uy * 9;
  return `<polygon points="${tip.x},${tip.y} ${bx - uy * 3.5},${by + ux * 3.5} ${bx + uy * 3.5},${by - ux * 3.5}" fill="${col}"/>`;
}

// ---------------------------------------------------------------------------------------------
// Maße der Features
// ---------------------------------------------------------------------------------------------
function sketchBounds(sk) {
  let minU = 1e30, maxU = -1e30, minV = 1e30, maxV = -1e30;
  for (const e of sk.entities || []) for (const loop of entityLoops(e)) for (const [u, v] of loop) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  return maxU < minU ? null : { minU, maxU, minV, maxV };
}

const lin = (a, b, dir, offPx, label, value, onEdit, extra = {}) => ({ kind: 'lin', a, b, base1: a, base2: b, dir, offPx, label, value, onEdit, ...extra });
const tag = (at, label, value, onEdit) => ({ kind: 'tag', at, label, value, onEdit });

function applyEdit(f, mut) {
  if (ops.dashEdit(mut)) return;
  commit('Maß ändern: ' + (f.name || f.type), p => { const t = p.features.find(x => x.id === f.id); if (t) mut(t); });
}
const pos = (cond, fn) => v => { if (cond(v)) fn(v); };
const gt0 = v => v > 0;

export function featureDims(f) {
  const items = [];
  const frames = computeFrames(workingFeatures());
  const feats = workingFeatures();
  const E = mut => applyEdit(f, mut);
  switch (f.type) {
    case 'extrude': case 'revolve': {
      const sk = feats.find(x => x.id === f.sketch); if (!sk) break;
      const fr = resolveFrame(sk.plane, frames); const bb = sketchBounds(sk); if (!bb) break;
      if (f.type === 'extrude') {
        const d = f.depth * (f.flip ? -1 : 1); const u = bb.maxU, v = (bb.minV + bb.maxV) / 2; const s0 = f.sym ? -d / 2 : 0;
        items.push(lin(toGlobal(fr, u, v, s0), toGlobal(fr, u, v, s0 + d), fr.x, 40, fmt(Math.abs(f.depth)), f.depth, val => E(t => { if (val < 0) { t.depth = -val; t.flip = !t.flip; } else if (val > 0) t.depth = val; })));
      } else items.push(tag(toGlobal(fr, bb.maxU, bb.maxV), `${fmt(f.angle ?? 360)}°`, f.angle ?? 360, pos(v => v > 0 && v <= 360, v => E(t => { t.angle = v; }))));
      break;
    }
    case 'hole': {
      const fr = resolveFrame(f.plane, frames); const C = toGlobal(fr, f.x, f.y);
      items.push(lin(add(C, mul(fr.x, -f.d / 2)), add(C, mul(fr.x, f.d / 2)), fr.y, 30, 'Ø' + fmt(f.d), f.d, pos(gt0, v => E(t => { t.d = v; }))));
      const ndir = f.flip ? 1 : -1;
      if (f.depth > 0) items.push(lin(C, add(C, mul(fr.n, ndir * f.depth)), fr.x, 40, 'T ' + fmt(f.depth), f.depth, pos(v => v >= 0, v => E(t => { t.depth = v; }))));
      else items.push(tag(add(C, mul(fr.y, f.d / 2 + 6)), 'Tiefe: durch', 0, pos(v => v >= 0, v => E(t => { t.depth = v; }))));
      if (Math.abs(f.x) > 1e-9) items.push(lin(fr.o, toGlobal(fr, f.x, 0), mul(fr.y, -1), 34, 'X ' + fmt(Math.abs(f.x)), Math.abs(f.x), pos(gt0, v => E(t => { t.x = (t.x < 0 ? -1 : 1) * v; }))));
      if (Math.abs(f.y) > 1e-9) items.push(lin(fr.o, toGlobal(fr, 0, f.y), mul(fr.x, -1), 34, 'Y ' + fmt(Math.abs(f.y)), Math.abs(f.y), pos(gt0, v => E(t => { t.y = (t.y < 0 ? -1 : 1) * v; }))));
      break;
    }
    case 'sphere': {
      const fr = resolveFrame(f.plane, frames); const C = toGlobal(fr, f.x || 0, f.y || 0);
      items.push(lin(C, add(C, mul(fr.x, f.r)), fr.y, 24, 'R ' + fmt(f.r), f.r, pos(gt0, v => E(t => { t.r = v; }))));
      break;
    }
    case 'cone': {
      const fr = resolveFrame(f.plane, frames); const C = toGlobal(fr, f.x || 0, f.y || 0); const T = add(C, mul(fr.n, f.h));
      items.push(lin(C, add(C, mul(fr.x, f.r1)), fr.y, 24, 'R1 ' + fmt(f.r1), f.r1, pos(gt0, v => E(t => { t.r1 = v; }))));
      items.push(lin(C, T, mul(fr.x, -1), 40, 'H ' + fmt(f.h), f.h, pos(gt0, v => E(t => { t.h = v; }))));
      items.push(lin(T, add(T, mul(fr.x, Math.max(f.r2, 0.001))), fr.y, 24, 'R2 ' + fmt(f.r2), f.r2, pos(v => v >= 0, v => E(t => { t.r2 = v; }))));
      break;
    }
    case 'datum': {
      const base = resolveFrame({ ref: f.plane.ref, frame: f.plane.frame, offset: 0 }, frames);
      if (Math.abs(f.plane.offset || 0) > 1e-9) items.push(lin(base.o, add(base.o, mul(base.n, f.plane.offset)), base.x, 40, 'Versatz ' + fmt(f.plane.offset), f.plane.offset, v => E(t => { t.plane.offset = v; })));
      break;
    }
    case 'pattern': {
      const src = feats.find(x => x.id === f.source); if (!src) break;
      let fr, u0, v0;
      if (src.type === 'extrude') { const sk = feats.find(x => x.id === src.sketch); if (!sk) break; fr = resolveFrame(sk.plane, frames); const bb = sketchBounds(sk); if (!bb) break; u0 = (bb.minU + bb.maxU) / 2; v0 = (bb.minV + bb.maxV) / 2; }
      else { fr = resolveFrame(src.plane, frames); u0 = src.x || 0; v0 = src.y || 0; }
      const P = i => toGlobal(fr, u0 + f.dx * i, v0 + f.dy * i);
      if (Math.abs(f.dx) > 1e-9) items.push(lin(P(0), toGlobal(fr, u0 + f.dx, v0), mul(fr.y, -1), 40, 'dX ' + fmt(Math.abs(f.dx)), Math.abs(f.dx), pos(gt0, v => E(t => { t.dx = (t.dx < 0 ? -1 : 1) * v; }))));
      if (Math.abs(f.dy) > 1e-9) items.push(lin(P(0), toGlobal(fr, u0, v0 + f.dy), mul(fr.x, -1), 40, 'dY ' + fmt(Math.abs(f.dy)), Math.abs(f.dy), pos(gt0, v => E(t => { t.dy = (t.dy < 0 ? -1 : 1) * v; }))));
      items.push(tag(P(Math.max((f.count || 2) - 1, 0)), `${f.count}×`, f.count, pos(v => v >= 2, v => E(t => { t.count = Math.round(v); }))));
      break;
    }
    case 'fillet': case 'chamfer': {
      const at = f.edges && f.edges[0] ? f.edges[0] : (S.mesh ? S.mesh.bbox.max : [0, 0, 0]);
      items.push(tag(at, (f.type === 'fillet' ? 'R ' : 'Fase ') + fmt(f.r), f.r, pos(gt0, v => E(t => { t.r = v; }))));
      break;
    }
    case 'import': {
      if (S.mesh) { const b = S.mesh.bbox; items.push(tag(mul(add(b.min, b.max), 0.5), '×' + fmt(f.s ?? 1, 4), f.s ?? 1, pos(gt0, v => E(t => { t.s = v; })))); }
      break;
    }
    default: break;
  }
  return items;
}

// Referenzmaße am Körper
export function bodyDims() {
  const out = [];
  if (S.project.type !== 'part' || !S.mesh) return out;
  for (const d of S.project.dims || []) {
    const r = resolveBodyDim(S.mesh, d, v => fmt(v));
    const onDelete = () => commit('Maß löschen', p => { p.dims = (p.dims || []).filter(x => x.id !== d.id); }, { light: true });
    if (r.stale) out.push({ kind: 'tag', at: r.at, label: '? veraltet', value: 0, cls: 'stale', onDelete });
    else out.push({ kind: 'lin', a: r.a, b: r.b, base1: r.a, base2: r.b, dir: r.dir, offPx: r.offPx, label: r.label, value: r.value, cls: 'ref', onDelete });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
export function refreshDims() {
  const L = S.dimLayer; if (!L || !S.project) return;
  if (!S.showDims) { L.set([]); return; }
  let items = [];
  const sk = ops.getSketcher();
  if (sk) items = sk.dimItems();
  else if (S.project.type === 'part') {
    const df = ops.dashFeature();
    const f = df || (S.selFeature ? (S.project.features || []).find(x => x.id === S.selFeature) : null);
    if (f && !(f.suppressed)) items.push(...featureDims(f));
    items.push(...bodyDims());
  }
  L.set(items);
}

export function initDims(viewer, host) {
  S.dimLayer = new DimLayer(viewer, host);
  let pending = 0;
  const schedule = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; try { refreshDims(); } catch (e) { console.error(e); } }); };
  for (const e of ['regen', 'sel', 'mode', 'tree', 'dims', 'project']) on(e, schedule);
}
void sub; void norm;

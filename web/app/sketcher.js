// sketcher.js – einfacher 2D-Skizzierer auf einer Ebene (Frame). Entitäten: rect, circle, poly.
import * as THREE from '/vendor/three.module.js';
import { toGlobal, entityLoops, uid } from './model.js';
import { pointOf, snapPoints, measureDim, setDimValue, dropEntityFromDims, autoDims, setAutoDim } from './sketchmath.js';
import { fmt } from './ui.js';

export class Sketcher {
  constructor(viewer, frame, entities, onChange, dims) {
    this.v = viewer;
    this.frame = frame;
    this.entities = JSON.parse(JSON.stringify(entities || []));
    this.dims = JSON.parse(JSON.stringify(dims || []));   // Maße des Bemaßungswerkzeugs
    this.dimMode = 'a';                                   // a = ausgerichtet, h = horizontal, v = vertikal
    this.showPos = false;                                 // Lagemaße (Abstand der Mittelpunkte vom Ursprung)
    this.onChange = onChange || (() => {});
    this.tool = 'select';
    this.snap = 5;
    this.snapOn = true;
    this.sel = -1;
    this.pending = null;   // laufende Eingabe
    this.cursor = null;
    this.group = new THREE.Group();
    this.v.sketchGroup.add(this.group);
    this.v.tool = this._handlers();
    this._buildGrid();
    this.redraw();
  }

  destroy() {
    this.v.tool = null;
    this._clear(this.group);
    this.v.sketchGroup.remove(this.group);
    this.v.requestRender();
  }

  setTool(t) { this.tool = t; this.pending = null; this.redraw(); }

  _clear(g) { for (const c of [...g.children]) { g.remove(c); c.geometry?.dispose(); } }

  _buildGrid() {
    this.grid = new THREE.Group();
    const ext = Math.max(this.v.sceneRadius * 1.5, 100);
    const step = this.snap; const n = Math.min(Math.ceil(ext / step), 120);
    const pts = [], major = [];
    for (let i = -n; i <= n; i++) {
      const target = i % 10 === 0 ? major : pts;
      target.push(...toGlobal(this.frame, -n * step, i * step, 0), ...toGlobal(this.frame, n * step, i * step, 0));
      target.push(...toGlobal(this.frame, i * step, -n * step, 0), ...toGlobal(this.frame, i * step, n * step, 0));
    }
    const mk = (arr, color) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
    };
    this.grid.add(mk(pts, 0x2b3a56), mk(major, 0x41567d));
    // Achsen der Skizze
    const ax = new THREE.BufferGeometry(); ax.setAttribute('position', new THREE.Float32BufferAttribute([...toGlobal(this.frame, -n * step, 0, 0), ...toGlobal(this.frame, n * step, 0, 0)], 3));
    const ay = new THREE.BufferGeometry(); ay.setAttribute('position', new THREE.Float32BufferAttribute([...toGlobal(this.frame, 0, -n * step, 0), ...toGlobal(this.frame, 0, n * step, 0)], 3));
    this.grid.add(new THREE.Line(ax, new THREE.LineBasicMaterial({ color: 0xd9534f })), new THREE.Line(ay, new THREE.LineBasicMaterial({ color: 0x5cb85c })));
    this.group.add(this.grid);
  }
  setSnap(step, on) {
    this.snap = Math.max(0.1, step || 1); this.snapOn = on;
    this.group.remove(this.grid); this.grid.traverse(o => o.geometry?.dispose());
    this._buildGrid(); this.v.requestRender();
  }

  _pt(ev) {
    const r = this.v.rayToFrame(ev, this.frame); if (!r) return null;
    let { u, v } = r;
    if (this.snapOn) { u = Math.round(u / this.snap) * this.snap; v = Math.round(v / this.snap) * this.snap; }
    return [+u.toFixed(4), +v.toFixed(4)];
  }

  _raw(ev) {
    const r = this.v.rayToFrame(ev, this.frame); return r ? [r.u, r.v] : null;
  }
  _nearestSnap(raw) {
    if (!raw) return null;
    let best = null, bd = this.v.pixelWorld * 16;
    for (const sp of snapPoints(this.entities)) { const d = Math.hypot(sp.u - raw[0], sp.v - raw[1]); if (d < bd) { bd = d; best = sp; } }
    return best;
  }

  _handlers() {
    return {
      down: () => {},
      up: ev => this._click(ev),
      move: ev => {
        if (this.tool === 'dim') { this.cursor = this._raw(ev); this.redraw(); return; }
        this.cursor = this._pt(ev); if (this.pending) this.redraw();
      },
      dbl: () => { if (this.tool === 'line') this._finishPoly(); },
      context: () => { if (this.pending) { this.pending = null; this.redraw(); } else this.setTool('select'), this.onChange('tool'); },
    };
  }

  _click(ev) {
    if (this.tool === 'dim') {
      const sp = this._nearestSnap(this._raw(ev)); if (!sp) return;
      if (!this.pending) this.pending = { dimA: sp.ref };
      else {
        const a = this.pending.dimA, b = sp.ref;
        if (a.e === b.e && a.p === b.p) return;
        this.dims.push({ id: uid('m'), mode: this.dimMode, a, b });
        this.pending = null; this.onChange('dims');
      }
      this.redraw(); return;
    }
    const p = this._pt(ev); if (!p) return;
    if (this.tool === 'rect') {
      if (!this.pending) this.pending = { a: p };
      else {
        const a = this.pending.a; const w = Math.abs(p[0] - a[0]), h = Math.abs(p[1] - a[1]);
        this.pending = null;
        if (w > 1e-6 && h > 1e-6) this._add({ type: 'rect', cx: (a[0] + p[0]) / 2, cy: (a[1] + p[1]) / 2, w, h, rot: 0 });
      }
    } else if (this.tool === 'circle') {
      if (!this.pending) this.pending = { c: p };
      else {
        const c = this.pending.c; const r = Math.hypot(p[0] - c[0], p[1] - c[1]);
        this.pending = null;
        if (r > 1e-6) this._add({ type: 'circle', cx: c[0], cy: c[1], r });
      }
    } else if (this.tool === 'line') {
      if (!this.pending) this.pending = { pts: [p] };
      else {
        const pts = this.pending.pts; const f = pts[0];
        if (pts.length >= 3 && Math.hypot(p[0] - f[0], p[1] - f[1]) < Math.max(this.snap * 0.6, this.v.pixelWorld * 8)) this._finishPoly();
        else if (Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 1e-9) pts.push(p);
      }
    } else if (this.tool === 'select') {
      this.sel = this._hit(p);
      this.onChange('select');
    }
    this.redraw();
  }

  _finishPoly() {
    if (this.pending && this.pending.pts.length >= 3) this._add({ type: 'poly', pts: this.pending.pts.map(p => [...p]) });
    this.pending = null; this.redraw();
  }

  _add(ent) { this.entities.push(ent); this.sel = this.entities.length - 1; this.onChange('add'); }

  _hit(p) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.type === 'circle') { if (Math.abs(Math.hypot(p[0] - e.cx, p[1] - e.cy) - e.r) < Math.max(this.snap, this.v.pixelWorld * 8)) return i; }
      else for (const loop of entityLoops(e)) {
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k], b = loop[(k + 1) % loop.length];
          if (distSeg(p, a, b) < Math.max(this.snap * 0.8, this.v.pixelWorld * 8)) return i;
        }
      }
    }
    return -1;
  }

  removeSelected() { if (this.sel >= 0) { this.dims = dropEntityFromDims(this.dims, this.sel); this.entities.splice(this.sel, 1); this.sel = -1; this.onChange('remove'); this.redraw(); } }
  update(i, patch) { Object.assign(this.entities[i], patch); this.redraw(); this.onChange('edit'); }

  // Maße für das Overlay (3D-Koordinaten); onEdit ändert die Skizze
  dimItems() {
    const fr = this.frame;
    const G = (u, v) => toGlobal(fr, u, v, 0);
    const D = (du, dv) => { const l = Math.hypot(du, dv) || 1; return [(fr.x[0] * du + fr.y[0] * dv) / l, (fr.x[1] * du + fr.y[1] * dv) / l, (fr.x[2] * du + fr.y[2] * dv) / l]; };
    const items = [];
    for (const it of autoDims(this.entities, this.showPos)) {
      items.push({
        kind: 'lin', key: it.key, a: G(...it.a), b: G(...it.b), base1: G(...it.a), base2: G(...it.b),
        dir: it.dir[0] || it.dir[1] ? D(...it.dir) : [0, 0, 0], offPx: it.kind === 'diam' ? 0 : 34,
        label: (it.kind === 'diam' ? 'Ø' : '') + fmt(it.value), value: it.value,
        onEdit: v => { if (setAutoDim(this.entities, it, v)) { this.redraw(); this.onChange('dimedit'); } },
      });
    }
    for (const d of this.dims) {
      const A = pointOf(this.entities, d.a), B = pointOf(this.entities, d.b); if (!A || !B) continue;
      let base1, base2, dir;
      if (d.mode === 'h') { const y0 = Math.max(A[1], B[1]); base1 = G(A[0], y0); base2 = G(B[0], y0); dir = D(0, 1); }
      else if (d.mode === 'v') { const x0 = Math.max(A[0], B[0]); base1 = G(x0, A[1]); base2 = G(x0, B[1]); dir = D(1, 0); }
      else { base1 = G(...A); base2 = G(...B); dir = D(-(B[1] - A[1]), B[0] - A[0]); }
      const value = measureDim(this.entities, d);
      items.push({
        kind: 'lin', key: d.id, cls: 'user', a: G(...A), b: G(...B), base1, base2, dir, offPx: 34, label: fmt(value), value,
        onEdit: v => { if (setDimValue(this.entities, d, v)) { this.redraw(); this.onChange('dimedit'); } },
        onDelete: () => { this.dims = this.dims.filter(x => x !== d); this.redraw(); this.onChange('dims'); },
      });
    }
    return items;
  }

  redraw() {
    for (const c of [...this.group.children]) if (c !== this.grid) { this.group.remove(c); c.geometry?.dispose(); }
    const addLine = (pts2, color, closed = true, dashed = false) => {
      const arr = []; pts2.forEach(p => arr.push(...toGlobal(this.frame, p[0], p[1], 0)));
      if (closed && pts2.length) arr.push(...toGlobal(this.frame, pts2[0][0], pts2[0][1], 0));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      l.renderOrder = 20; this.group.add(l);
    };
    this.entities.forEach((e, i) => {
      for (const loop of entityLoops(e)) addLine(loop, i === this.sel ? 0xff9a2e : 0xffe066, true);
    });
    // Bemaßungswerkzeug: Fangpunkt-Markierung und Vorschaulinie
    if (this.tool === 'dim') {
      const sp = this._nearestSnap(this.cursor);
      if (sp) { const k = this.v.pixelWorld * 6; addLine([[sp.u - k, sp.v - k], [sp.u + k, sp.v - k], [sp.u + k, sp.v + k], [sp.u - k, sp.v + k]], 0x7fd1ff); }
      if (this.pending && this.pending.dimA) { const A = pointOf(this.entities, this.pending.dimA); const t = sp ? [sp.u, sp.v] : this.cursor; if (A && t) addLine([A, t], 0x7fd1ff, false); }
    }
    // Vorschau
    if (this.pending && this.cursor && this.tool !== 'dim') {
      const c = this.cursor;
      if (this.tool === 'rect') {
        const a = this.pending.a; addLine([[a[0], a[1]], [c[0], a[1]], [c[0], c[1]], [a[0], c[1]]], 0x7fd1ff);
      } else if (this.tool === 'circle') {
        const o = this.pending.c; addLine(entityLoops({ type: 'circle', cx: o[0], cy: o[1], r: Math.hypot(c[0] - o[0], c[1] - o[1]) })[0], 0x7fd1ff);
      } else if (this.tool === 'line') addLine([...this.pending.pts, c], 0x7fd1ff, false);
    }
    this.v.requestRender();
  }
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

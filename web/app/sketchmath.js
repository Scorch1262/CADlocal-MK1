// sketchmath.js – Maße in Skizzen (reine Mathematik, ohne Browser/three.js)
// Skizzen-Entitäten: rect {cx,cy,w,h,rot}, circle {cx,cy,r}, poly {pts}
// Maß (Bemaßungswerkzeug): { id, mode:'a'|'h'|'v', a:{e,p}, b:{e,p} }  –  e = Entitätsindex (-1 = Ursprung), p = Punktschlüssel
//   'o' Ursprung · 'c' Mittelpunkt · 'v<i>' Eckpunkt i (Rechteck/Linienzug) · 'q<i>' Quadrantenpunkt i (Kreis)
import { entityLoops } from './model.js';

const rad = d => d * Math.PI / 180;

export function pointOf(ents, ref) {
  if (!ref) return null;
  if (ref.p === 'o') return [0, 0];
  const e = ents[ref.e]; if (!e) return null;
  if (ref.p === 'c') return e.type === 'poly' ? null : [e.cx, e.cy];
  const i = parseInt(ref.p.slice(1), 10);
  if (ref.p[0] === 'v') {
    if (e.type === 'rect') { const l = entityLoops(e)[0]; return l[i] ? [l[i][0], l[i][1]] : null; }
    if (e.type === 'poly') return e.pts[i] ? [e.pts[i][0], e.pts[i][1]] : null;
  }
  if (ref.p[0] === 'q' && e.type === 'circle') {
    return [[e.cx + e.r, e.cy], [e.cx, e.cy + e.r], [e.cx - e.r, e.cy], [e.cx, e.cy - e.r]][i] || null;
  }
  return null;
}

// alle Fangpunkte (für das Bemaßungswerkzeug)
export function snapPoints(ents) {
  const out = [{ ref: { e: -1, p: 'o' }, u: 0, v: 0 }];
  ents.forEach((e, i) => {
    if (e.type === 'rect') { out.push({ ref: { e: i, p: 'c' }, u: e.cx, v: e.cy }); entityLoops(e)[0].forEach((p, k) => out.push({ ref: { e: i, p: 'v' + k }, u: p[0], v: p[1] })); }
    else if (e.type === 'circle') { out.push({ ref: { e: i, p: 'c' }, u: e.cx, v: e.cy }); for (let k = 0; k < 4; k++) { const p = pointOf(ents, { e: i, p: 'q' + k }); out.push({ ref: { e: i, p: 'q' + k }, u: p[0], v: p[1] }); } }
    else if (e.type === 'poly') e.pts.forEach((p, k) => out.push({ ref: { e: i, p: 'v' + k }, u: p[0], v: p[1] }));
  });
  return out;
}

export function measureDim(ents, d) {
  const A = pointOf(ents, d.a), B = pointOf(ents, d.b);
  if (!A || !B) return null;
  const du = B[0] - A[0], dv = B[1] - A[1];
  return d.mode === 'h' ? Math.abs(du) : d.mode === 'v' ? Math.abs(dv) : Math.hypot(du, dv);
}

export function translateEntity(e, du, dv) {
  if (e.type === 'poly') e.pts = e.pts.map(p => [p[0] + du, p[1] + dv]);
  else { e.cx += du; e.cy += dv; }
}

// Maß ändern: die Entität des zweiten Punktes (bzw. nicht-Ursprung) wird verschoben bzw. skaliert
export function setDimValue(ents, d, val) {
  if (!(val > 0)) return false;
  let fixed = d.a, mover = d.b;
  if (mover.p === 'o' || mover.e < 0) { fixed = d.b; mover = d.a; }
  const F = pointOf(ents, fixed), M = pointOf(ents, mover);
  if (!F || !M) return false;
  const cur = measureDim(ents, d);
  if (fixed.e === mover.e && fixed.e >= 0) {
    const e = ents[fixed.e];
    if (e.type === 'rect') {
      const k = cur > 1e-12 ? val / cur : 1;
      if (d.mode === 'h') e.w *= k; else if (d.mode === 'v') e.h *= k; else { e.w *= k; e.h *= k; }
      return true;
    }
    if (e.type === 'circle') { e.r = val; return true; }
    // Linienzug: nur den bewegten Punkt verschieben
    const i = parseInt(mover.p.slice(1), 10);
    const [t0, t1] = target(F, M, d.mode, val);
    e.pts[i] = [F[0] + t0, F[1] + t1];
    return true;
  }
  const [t0, t1] = target(F, M, d.mode, val);
  translateEntity(ents[mover.e], F[0] + t0 - M[0], F[1] + t1 - M[1]);
  return true;
}
function target(F, M, mode, val) {
  const vx = M[0] - F[0], vy = M[1] - F[1];
  if (mode === 'h') return [(vx >= 0 ? 1 : -1) * val, vy];
  if (mode === 'v') return [vx, (vy >= 0 ? 1 : -1) * val];
  const l = Math.hypot(vx, vy);
  return l > 1e-9 ? [vx / l * val, vy / l * val] : [val, 0];
}

// beim Löschen einer Entität: betroffene Maße entfernen, Indizes nachziehen
export function dropEntityFromDims(dims, idx) {
  return (dims || []).filter(d => d.a.e !== idx && d.b.e !== idx).map(d => ({ ...d, a: { ...d.a, e: d.a.e > idx ? d.a.e - 1 : d.a.e }, b: { ...d.b, e: d.b.e > idx ? d.b.e - 1 : d.b.e } }));
}

// ---------- automatische Größenmaße ----------
function signedArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

// Rückgabe: [{ key, kind, e, k, label, value, a:[u,v], b:[u,v], dir:[du,dv] }]
export function autoDims(ents, showPos = false) {
  const out = [];
  ents.forEach((e, i) => {
    if (e.type === 'rect') {
      const [bl, br, tr] = entityLoops(e)[0];
      const t = norm2([br[0] - bl[0], br[1] - bl[1]]); const up = [-t[1], t[0]];
      out.push({ key: `r${i}w`, kind: 'rectW', e: i, value: e.w, a: bl, b: br, dir: [-up[0], -up[1]] });
      out.push({ key: `r${i}h`, kind: 'rectH', e: i, value: e.h, a: br, b: tr, dir: t });
    } else if (e.type === 'circle') {
      const a = rad(35), u = [Math.cos(a), Math.sin(a)];
      out.push({ key: `c${i}d`, kind: 'diam', e: i, value: e.r * 2, a: [e.cx - u[0] * e.r, e.cy - u[1] * e.r], b: [e.cx + u[0] * e.r, e.cy + u[1] * e.r], dir: [0, 0] });
    } else if (e.type === 'poly') {
      const ccw = signedArea(e.pts) >= 0;
      e.pts.forEach((p, k) => {
        const q = e.pts[(k + 1) % e.pts.length]; const dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy);
        if (l < 1e-9) return;
        const t = [dx / l, dy / l]; const n = ccw ? [t[1], -t[0]] : [-t[1], t[0]];
        out.push({ key: `p${i}s${k}`, kind: 'seg', e: i, k, value: l, a: [p[0], p[1]], b: [q[0], q[1]], dir: n });
      });
    }
    if (showPos && e.type !== 'poly') {
      if (Math.abs(e.cx) > 1e-9) out.push({ key: `x${i}`, kind: 'posx', e: i, value: Math.abs(e.cx), a: [0, 0], b: [e.cx, 0], dir: [0, -1] });
      if (Math.abs(e.cy) > 1e-9) out.push({ key: `y${i}`, kind: 'posy', e: i, value: Math.abs(e.cy), a: [0, 0], b: [0, e.cy], dir: [-1, 0] });
    }
  });
  return out;
}
const norm2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

export function setAutoDim(ents, item, val) {
  if (!(val > 0)) return false;
  const e = ents[item.e]; if (!e) return false;
  switch (item.kind) {
    case 'rectW': { const d = val - e.w; const a = rad(e.rot || 0); e.cx += Math.cos(a) * d / 2; e.cy += Math.sin(a) * d / 2; e.w = val; return true; }
    case 'rectH': { const d = val - e.h; const a = rad(e.rot || 0); e.cx += -Math.sin(a) * d / 2; e.cy += Math.cos(a) * d / 2; e.h = val; return true; }
    case 'diam': e.r = val / 2; return true;
    case 'seg': {
      const n = e.pts.length, p = e.pts[item.k], j = (item.k + 1) % n; const q = e.pts[j];
      const dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy) || 1;
      e.pts[j] = [p[0] + dx / l * val, p[1] + dy / l * val]; return true;
    }
    case 'posx': e.cx = (e.cx < 0 ? -1 : 1) * val; return true;
    case 'posy': e.cy = (e.cy < 0 ? -1 : 1) * val; return true;
    default: return false;
  }
}

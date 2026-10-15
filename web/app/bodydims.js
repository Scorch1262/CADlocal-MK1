// bodydims.js – Referenzmaße am Körper (Kantenlänge, Durchmesser/Radius, Abstand Fläche–Fläche)
// Arbeitet auf den Tessellationsdaten (mesh) des Kerns. Maße sind Referenzmaße: sie werden bei jeder
// Regeneration neu aus der Geometrie berechnet; wird das Bezugselement nicht mehr gefunden, gilt das Maß als "veraltet".
import { sub, add, mul, dot, cross, norm, len } from './model.js';

const dist = (a, b) => len(sub(a, b));
const perp = v => { const ax = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; return norm(cross(v, ax)); };

export function edgePolyline(mesh, r) {
  const p = mesh.edgePositions, pts = [];
  for (let i = r.start; i < r.start + r.count; i += 2) pts.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
  const l = r.start + r.count - 1;
  pts.push([p[l * 3], p[l * 3 + 1], p[l * 3 + 2]]);
  return pts;
}
export function findEdgeByMid(mesh, mid, tol) {
  let best = null, bd = tol;
  for (const r of mesh.edgeRanges) { if (!r.mid) continue; const d = dist(r.mid, mid); if (d < bd) { bd = d; best = r; } }
  return best;
}
export const polyLength = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; };

// Kreis durch drei Punkte (3D). Rückgabe { c, r, n } oder null
export function circumcircle(A, B, C) {
  const ab = sub(B, A), ac = sub(C, A);
  const n = cross(ab, ac); const nn = dot(n, n);
  if (nn < 1e-18) return null;
  const t1 = mul(cross(cross(ab, ac), ab), dot(ac, ac));
  const t2 = mul(cross(ac, cross(ab, ac)), dot(ab, ab));
  const off = mul(add(t1, t2), 1 / (2 * nn));
  const c = add(A, off);
  return { c, r: len(off), n: norm(n) };
}
export function fitCircle(pts) {
  if (pts.length < 4) return null;
  const n = pts.length;
  const c = circumcircle(pts[0], pts[Math.floor(n / 3)], pts[Math.floor(2 * n / 3)]);
  if (!c || !(c.r > 0)) return null;
  for (const p of pts) if (Math.abs(dist(p, c.c) - c.r) > c.r * 0.03 + 1e-6) return null; // kein Kreis
  return c;
}

// Maß -> Darstellung. d: { kind:'length'|'diam'|'radius'|'faces', mid, f1, f2, anchor }
// Rückgabe: { stale, value, label, a, b, dir, offPx, at }
export function resolveBodyDim(mesh, d, fmt = x => String(+x.toFixed(2))) {
  const diag = mesh && mesh.bbox ? len(sub(mesh.bbox.max, mesh.bbox.min)) : 100;
  const tol = Math.max(1e-3, diag * 1e-3) * 5;
  const stale = { stale: true, label: '?', at: d.anchor || [0, 0, 0] };
  if (!mesh) return stale;
  if (d.kind === 'faces') {
    const find = pl => (mesh.faces || []).find(f => f.plane && Math.abs(dot(norm(f.plane.n), pl.n)) > 0.999 && Math.abs(dot(sub(f.plane.o, pl.o), pl.n)) < tol);
    const g1 = find(d.f1), g2 = find(d.f2);
    if (!g1 || !g2) return stale;
    const n1 = norm(d.f1.n);
    const value = Math.abs(dot(sub(g2.plane.o, g1.plane.o), n1));
    const a = sub(d.anchor, mul(n1, dot(sub(d.anchor, g1.plane.o), n1))); // Ankerpunkt auf Fläche 1
    const sgn = dot(sub(g2.plane.o, g1.plane.o), n1) >= 0 ? 1 : -1;
    return { value, label: fmt(value), a, b: add(a, mul(n1, sgn * value)), dir: perp(n1), offPx: 34 };
  }
  const r = findEdgeByMid(mesh, d.mid, tol);
  if (!r) return stale;
  const pts = edgePolyline(mesh, r);
  if (d.kind === 'length') {
    const value = polyLength(pts);
    const dirE = norm(sub(pts[pts.length - 1], pts[0]));
    return { value, label: 'L ' + fmt(value), a: pts[0], b: pts[pts.length - 1], dir: perp(dirE), offPx: 30 };
  }
  const c = fitCircle(pts);
  if (!c) return stale;
  const u = norm(sub(pts[0], c.c));
  if (d.kind === 'diam') return { value: c.r * 2, label: 'Ø ' + fmt(c.r * 2), a: sub(c.c, mul(u, c.r)), b: add(c.c, mul(u, c.r)), dir: [0, 0, 0], offPx: 0 };
  return { value: c.r, label: 'R ' + fmt(c.r), a: c.c, b: add(c.c, mul(u, c.r)), dir: [0, 0, 0], offPx: 0 };
}

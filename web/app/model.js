// model.js – reines JS-Datenmodell (kein CAD-Kern nötig). Wird von UI und Kernel gemeinsam benutzt.
// Koordinatensystem wie in Creo: Y zeigt nach oben. FRONT = XY-Ebene, TOP = XZ-Ebene, RIGHT = YZ-Ebene.

export const FORMAT = 'BrowserCAD';
export const FORMAT_VERSION = 1;

export const BASE_FRAMES = {
  FRONT: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
  TOP:   { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, -1], n: [0, 1, 0] },
  RIGHT: { o: [0, 0, 0], x: [0, 0, -1], y: [0, 1, 0], n: [1, 0, 0] },
};

export const DEFAULT_LAYERS = [
  { id: 'L_DATUM',  name: 'DATUM_EBENEN', visible: true },
  { id: 'L_SKETCH', name: 'SKIZZEN',      visible: true },
  { id: 'L_GEOM',   name: 'GEOMETRIE',    visible: true },
  { id: 'L_COMP',   name: 'KOMPONENTEN',  visible: true },
];

export const uid = (p = 'f') => p + Math.random().toString(36).slice(2, 8);

export function newProject(type = 'part', name = 'neu') {
  return {
    format: FORMAT, version: FORMAT_VERSION, type, name,
    created: new Date().toISOString(),
    layers: DEFAULT_LAYERS.map(l => ({ ...l })),
    planesLayer: 'L_DATUM', bodyLayer: 'L_GEOM', planesHidden: false, bodyHidden: false,
    features: [],     // nur Teile
    components: [],   // nur Baugruppen
    imports: {},      // importId -> { name, format:'step'|'stl', data }
    params: { density: 7.85 }, // g/cm³ (Stahl)
  };
}

// ---------- kleine Vektor-Helfer ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// lokale Skizzenkoordinate -> global
export function toGlobal(fr, u, v, w = 0) {
  return [
    fr.o[0] + fr.x[0] * u + fr.y[0] * v + fr.n[0] * w,
    fr.o[1] + fr.x[1] * u + fr.y[1] * v + fr.n[1] * w,
    fr.o[2] + fr.x[2] * u + fr.y[2] * v + fr.n[2] * w,
  ];
}

// Ebene (Referenz + Versatz) -> Frame
export function resolveFrame(plane, frames = {}) {
  let base;
  if (!plane) base = BASE_FRAMES.FRONT;
  else if (plane.ref === 'FACE' && plane.frame) base = plane.frame;
  else if (BASE_FRAMES[plane.ref]) base = BASE_FRAMES[plane.ref];
  else if (frames[plane.ref]) base = frames[plane.ref];
  else base = BASE_FRAMES.FRONT;
  const off = Number(plane?.offset || 0);
  const fr = { o: base.o.slice(), x: base.x.slice(), y: base.y.slice(), n: base.n.slice() };
  if (off) fr.o = add(fr.o, mul(fr.n, off));
  return fr;
}

export function computeFrames(features) {
  const frames = {};
  for (const f of features) {
    if (f.type === 'datum') frames[f.id] = resolveFrame(f.plane, frames);
  }
  return frames;
}

// Skizzen-Entitäten -> Polylinien in lokalen Koordinaten (für Anzeige)
export function entityLoops(ent, segs = 48) {
  if (ent.type === 'rect') {
    const hw = ent.w / 2, hh = ent.h / 2, a = (ent.rot || 0) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return [[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [ent.cx + x * c - y * s, ent.cy + x * s + y * c])];
  }
  if (ent.type === 'circle') {
    const pts = [];
    for (let i = 0; i < segs; i++) { const t = i / segs * Math.PI * 2; pts.push([ent.cx + ent.r * Math.cos(t), ent.cy + ent.r * Math.sin(t)]); }
    return [pts];
  }
  if (ent.type === 'poly') return [ent.pts.map(p => [p[0], p[1]])];
  return [];
}

// Verschiebung / Drehung (Grad) / Skalierung -> 4x4-Matrix (zeilenweise)
export function matFromTRS(t = [0, 0, 0], rDeg = [0, 0, 0], s = 1) {
  const [rx, ry, rz] = rDeg.map(d => d * Math.PI / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  const r = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  return [
    r[0][0] * s, r[0][1] * s, r[0][2] * s, t[0],
    r[1][0] * s, r[1][1] * s, r[1][2] * s, t[1],
    r[2][0] * s, r[2][1] * s, r[2][2] * s, t[2],
    0, 0, 0, 1,
  ];
}

export function featureLabel(f) {
  const t = { sketch: 'Skizze', extrude: 'Extrusion', revolve: 'Rotation', hole: 'Bohrung', datum: 'Datumebene',
    fillet: 'Rundung', chamfer: 'Fase', pattern: 'Muster', sphere: 'Kugel', cone: 'Kegel', import: 'Import' };
  return t[f.type] || f.type;
}

// ---------- 4x4-Matrizen (zeilenweise, Länge 16) ----------
export const IDENT = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul4(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}
export const trans4 = v => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];
// Drehung um Achse (normiert) durch Punkt
export function rotAbout(axis, angle, pt) {
  const [x, y, z] = norm(axis), c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const R = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
  return mul4(mul4(trans4(pt), R), trans4([-pt[0], -pt[1], -pt[2]]));
}
// Frame einer ebenen Fläche (Ursprung = Projektion des Weltursprungs, Achsen an der Welt ausgerichtet)
export function faceFrame(pl) {
  const n = norm(pl.n), up = [0, 1, 0];
  let y = Math.abs(dot(n, up)) > 0.99 ? sub([0, 0, -1], mul(n, dot(n, [0, 0, -1]))) : sub(up, mul(n, dot(n, up)));
  y = norm(y);
  return { o: mul(n, dot(n, pl.o)), x: cross(y, n), y, n };
}

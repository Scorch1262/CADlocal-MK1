// kernel.js – dünner CAD-Kern auf Basis von OpenCascade.js (B-Rep, STEP, Boolesche Operationen)
// Alle Funktionen arbeiten mit einfachen Daten (Arrays/Typed Arrays) nach außen.
import { resolveFrame, computeFrames, entityLoops, toGlobal, matFromTRS, mul } from './model.js';

export function createKernel(oc) {
  const T_FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
  const T_EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const T_ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

  // ---------- Speicherverwaltung ----------
  // Objekte, die wir mit "new" erzeugen, werden in einer Liste (scope) gesammelt und später freigegeben.
  // Von .Shape() zurückgegebene Referenzen werden NICHT freigegeben (gehören dem Maker).
  let scope = [];
  const keep = o => { scope.push(o); return o; };
  function release(list) {
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) { try { list[i].delete(); } catch (e) { /* ignorieren */ } }
    list.length = 0;
  }
  function withScope(fn) {
    const prev = scope; const mine = []; scope = mine;
    try { return { value: fn(), scope: mine }; } finally { scope = prev; }
  }

  const P = a => keep(new oc.gp_Pnt_3(a[0], a[1], a[2]));
  const V = a => keep(new oc.gp_Vec_4(a[0], a[1], a[2]));
  const D = a => keep(new oc.gp_Dir_4(a[0], a[1], a[2]));

  function trsfFromMatrix(m) {
    const t = keep(new oc.gp_Trsf_1());
    t.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
    return t;
  }
  function moved(shape, m) {
    const mk = keep(new oc.BRepBuilderAPI_Transform_2(shape, trsfFromMatrix(m), true));
    return mk.Shape();
  }
  const frameMatrix = fr => [fr.x[0], fr.y[0], fr.n[0], fr.o[0], fr.x[1], fr.y[1], fr.n[1], fr.o[1], fr.x[2], fr.y[2], fr.n[2], fr.o[2], 0, 0, 0, 1];
  const transMatrix = v => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];

  // ---------- Boolesche Operationen ----------
  function bool(kind, a, b) {
    const C = { fuse: oc.BRepAlgoAPI_Fuse_3, cut: oc.BRepAlgoAPI_Cut_3, common: oc.BRepAlgoAPI_Common_3 }[kind];
    const mk = keep(new C(a, b));
    if (!mk.IsDone()) throw new Error('Boolesche Operation fehlgeschlagen');
    const s = mk.Shape();
    if (s.IsNull()) throw new Error('Boolesche Operation lieferte kein Ergebnis');
    return s;
  }
  function combine(base, tool, mode) {
    if (!base) {
      if (mode === 'cut') throw new Error('Kein Körper zum Schneiden vorhanden');
      return tool;
    }
    return bool(mode === 'cut' ? 'cut' : 'fuse', base, tool);
  }

  // ---------- Profile ----------
  function polyFace(loop, fr) {
    const mk = keep(new oc.BRepBuilderAPI_MakePolygon_1());
    for (const [u, v] of loop) mk.Add_1(P(toGlobal(fr, u, v)));
    mk.Close();
    if (!mk.IsDone()) throw new Error('Ungültiges Profil');
    return keep(new oc.BRepBuilderAPI_MakeFace_15(mk.Wire(), true)).Face();
  }
  function circleFace(cx, cy, r, fr) {
    if (!(r > 0)) throw new Error('Radius muss > 0 sein');
    const ax = keep(new oc.gp_Ax2_3(P(toGlobal(fr, cx, cy)), D(fr.n)));
    const circ = keep(new oc.gp_Circ_2(ax, r));
    const e = keep(new oc.BRepBuilderAPI_MakeEdge_8(circ));
    const w = keep(new oc.BRepBuilderAPI_MakeWire_2(e.Edge()));
    return keep(new oc.BRepBuilderAPI_MakeFace_15(w.Wire(), true)).Face();
  }
  function sketchFaces(sk, fr, shift = [0, 0]) {
    const faces = [];
    for (const ent of sk.entities || []) {
      const e = { ...ent };
      if (e.type === 'circle') { e.cx += shift[0]; e.cy += shift[1]; faces.push(circleFace(e.cx, e.cy, e.r, fr)); continue; }
      if (e.type === 'rect') { e.cx += shift[0]; e.cy += shift[1]; }
      if (e.type === 'poly') e.pts = e.pts.map(p => [p[0] + shift[0], p[1] + shift[1]]);
      for (const loop of entityLoops(e)) {
        if (loop.length < 3) throw new Error('Profil braucht mindestens 3 Punkte');
        faces.push(polyFace(loop, fr));
      }
    }
    if (!faces.length) throw new Error('Skizze enthält kein geschlossenes Profil');
    return faces;
  }

  // ---------- Feature-Operationen ----------
  function doExtrude(base, faces, fr, depth, sym, flip, mode) {
    if (!depth) throw new Error('Tiefe darf nicht 0 sein');
    const d = depth * (flip ? -1 : 1);
    let tool = null;
    for (let face of faces) {
      if (sym) face = moved(face, transMatrix(mul(fr.n, -d / 2)));
      const prism = keep(new oc.BRepPrimAPI_MakePrism_1(face, V(mul(fr.n, d)), false, true)).Shape();
      tool = tool ? bool('fuse', tool, prism) : prism;
    }
    return combine(base, tool, mode);
  }
  function doRevolve(base, faces, fr, axis, angle, mode) {
    const dir = axis === 'x' ? fr.x : fr.y;
    const ax1 = keep(new oc.gp_Ax1_2(P(fr.o), D(dir)));
    const rad = Math.min(Math.max(angle, 0.01), 360) * Math.PI / 180;
    let tool = null;
    for (const face of faces) {
      const rev = keep(new oc.BRepPrimAPI_MakeRevol_1(face, ax1, rad, false)).Shape();
      tool = tool ? bool('fuse', tool, rev) : rev;
    }
    return combine(base, tool, mode);
  }

  function bboxOf(shape) {
    const bb = keep(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(shape, bb, false);
    const a = bb.CornerMin(), b = bb.CornerMax();
    const r = { min: [a.X(), a.Y(), a.Z()], max: [b.X(), b.Y(), b.Z()] };
    a.delete(); b.delete();
    return r;
  }
  const diagOf = bb => Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);

  // Kanten eindeutig sammeln (OCC liefert jede Kante je Fläche erneut)
  function uniqueEdges(shape) {
    const buckets = new Map(); const out = [];
    const ex = keep(new oc.TopExp_Explorer_2(shape, T_EDGE, T_ANY));
    for (; ex.More(); ex.Next()) {
      const e = oc.TopoDS.Edge_1(ex.Current());
      const h = e.HashCode(1000003);
      let list = buckets.get(h);
      if (!list) { list = []; buckets.set(h, list); }
      if (list.some(o => o.IsSame(e))) continue;
      const ec = e.Oriented ? e : e; // Referenz
      list.push(ec); out.push(ec);
    }
    return out;
  }
  function edgeMid(e) {
    try {
      const c = keep(new oc.BRepAdaptor_Curve_2(e));
      const p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
      const r = [p.X(), p.Y(), p.Z()]; p.delete(); return r;
    } catch (err) { return null; }
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function doEdgeOp(kind, base, f) {
    if (!base) throw new Error('Kein Körper vorhanden');
    const edges = uniqueEdges(base);
    let chosen = [];
    if (f.all) chosen = edges;
    else {
      const tol = Math.max(1e-3, diagOf(bboxOf(base)) * 1e-3);
      const mids = edges.map(edgeMid);
      for (const m of f.edges || []) {
        let best = -1, bd = 1e30;
        mids.forEach((q, i) => { if (!q) return; const d = dist(q, m); if (d < bd) { bd = d; best = i; } });
        if (best < 0 || bd > tol * 5) throw new Error('Referenzkante nicht mehr gefunden');
        if (!chosen.includes(edges[best])) chosen.push(edges[best]);
      }
    }
    if (!chosen.length) throw new Error('Keine Kanten ausgewählt');
    const mk = kind === 'fillet'
      ? keep(new oc.BRepFilletAPI_MakeFillet(base, oc.ChFi3d_FilletShape.ChFi3d_Rational))
      : keep(new oc.BRepFilletAPI_MakeChamfer(base));
    for (const e of chosen) mk.Add_2(f.r, e);
    mk.Build();
    if (!mk.IsDone()) throw new Error((kind === 'fillet' ? 'Rundung' : 'Fase') + ' nicht möglich (Radius zu groß?)');
    return mk.Shape();
  }

  // ---------- Import ----------
  const importCache = new Map(); // importId -> { data, shape, scope }
  function readSTEP(text) {
    oc.FS.writeFile('/in.step', text);
    try {
      const r = keep(new oc.STEPControl_Reader_1());
      const st = r.ReadFile('/in.step');
      if (st.value !== 1) throw new Error('STEP-Datei konnte nicht gelesen werden');
      r.TransferRoots();
      const s = r.OneShape();
      if (s.IsNull()) throw new Error('STEP-Datei enthält keine Geometrie');
      return s;
    } finally { try { oc.FS.unlink('/in.step'); } catch (e) { /* */ } }
  }
  function readSTL(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    oc.FS.writeFile('/in.stl', bin);
    try {
      const rd = keep(new oc.StlAPI_Reader());
      const s = keep(new oc.TopoDS_Shape());
      if (!rd.Read(s, '/in.stl') || s.IsNull()) throw new Error('STL-Datei konnte nicht gelesen werden');
      return s;
    } finally { try { oc.FS.unlink('/in.stl'); } catch (e) { /* */ } }
  }
  function importShape(id, imp) {
    const c = importCache.get(id);
    if (c && c.data === imp.data) return c.shape;
    if (c) { release(c.scope); importCache.delete(id); }
    const r = withScope(() => imp.format === 'stl' ? readSTL(imp.data) : readSTEP(imp.data));
    importCache.set(id, { data: imp.data, shape: r.value, scope: r.scope });
    return r.value;
  }

  // ---------- Teil neu aufbauen ----------
  // Rückgabe: { shape, errors:{featureId:msg}, frames, scope }
  function regenerate(project) {
    const errors = {};
    const frames = computeFrames(project.features || []);
    const byId = {};
    for (const f of project.features || []) byId[f.id] = f;
    const run = withScope(() => {
      let shape = null;
      const apply = (f, shift) => {
        switch (f.type) {
          case 'extrude': case 'revolve': {
            const sk = byId[f.sketch];
            if (!sk || sk.type !== 'sketch') throw new Error('Skizze fehlt');
            const fr = resolveFrame(sk.plane, frames);
            const faces = sketchFaces(sk, fr, shift || [0, 0]);
            return f.type === 'extrude'
              ? doExtrude(shape, faces, fr, f.depth, f.sym, f.flip, f.mode)
              : doRevolve(shape, faces, fr, f.axis || 'y', f.angle ?? 360, f.mode);
          }
          case 'hole': {
            const fr = resolveFrame(f.plane, frames);
            const bb = shape ? bboxOf(shape) : null;
            const through = !(f.depth > 0);
            const depth = through ? (bb ? diagOf(bb) * 2 : 1000) : f.depth;
            const face = circleFace(f.x + (shift ? shift[0] : 0), f.y + (shift ? shift[1] : 0), f.d / 2, fr);
            return doExtrude(shape, [face], fr, depth, false, !f.flip, 'cut');
          }
          case 'sphere': {
            const fr = resolveFrame(f.plane, frames);
            const s = keep(new oc.BRepPrimAPI_MakeSphere_1(f.r)).Shape();
            return combine(shape, moved(s, transMatrix(toGlobal(fr, f.x || 0, f.y || 0))), f.mode);
          }
          case 'cone': {
            const fr = resolveFrame(f.plane, frames);
            const s = keep(new oc.BRepPrimAPI_MakeCone_1(f.r1, f.r2, f.h)).Shape();
            const m = frameMatrix({ ...fr, o: toGlobal(fr, f.x || 0, f.y || 0) });
            return combine(shape, moved(s, m), f.mode);
          }
          case 'fillet': case 'chamfer': return doEdgeOp(f.type, shape, f);
          case 'import': {
            const imp = project.imports?.[f.importId];
            if (!imp) throw new Error('Importdaten fehlen');
            let s = importShape(f.importId, imp);
            s = moved(s, matFromTRS(f.t || [0, 0, 0], f.r || [0, 0, 0], f.s || 1));
            return combine(shape, s, f.mode === 'cut' ? 'cut' : 'add');
          }
          default: return shape;
        }
      };
      for (const f of project.features || []) {
        if (f.suppressed || f.type === 'sketch' || f.type === 'datum') continue;
        try {
          if (f.type === 'pattern') {
            const src = byId[f.source];
            if (!src || !['extrude', 'hole', 'sphere'].includes(src.type)) throw new Error('Quelle des Musters ungültig');
            for (let i = 1; i < (f.count || 2); i++) shape = apply(src, [f.dx * i, f.dy * i]);
          } else shape = apply(f);
        } catch (err) { errors[f.id] = String(err && err.message || err); }
      }
      if (shape) {
        try {
          const u = keep(new oc.ShapeUpgrade_UnifySameDomain_2(shape, true, true, true));
          u.Build(); const us = u.Shape(); if (!us.IsNull()) shape = us;
        } catch (e) { /* unverändert lassen */ }
      }
      return shape;
    });
    return { shape: run.value, errors, frames, scope: run.scope };
  }

  // ---------- Tessellation ----------
  function tessellate(shape, opts = {}) {
    const res = withScope(() => {
      const bb = bboxOf(shape); const diag = diagOf(bb) || 1;
      const lin = Math.max(diag * 0.0008 / (opts.quality || 1), 0.003);
      new oc.BRepMesh_IncrementalMesh_2(shape, lin, false, 0.3, false).delete();
      const pos = [], nor = [], idx = [], faces = [];
      let fid = 0;
      const ex = keep(new oc.TopExp_Explorer_2(shape, T_FACE, T_ANY));
      for (; ex.More(); ex.Next(), fid++) {
        const face = oc.TopoDS.Face_1(ex.Current());
        const loc = new oc.TopLoc_Location_1();
        const h = oc.BRep_Tool.Triangulation(face, loc);
        if (h.IsNull()) { loc.delete(); continue; }
        const t = h.get();
        const ident = loc.IsIdentity();
        const tr = ident ? null : loc.Transformation();
        const nn = t.NbNodes();
        const start = pos.length / 3;
        for (let i = 1; i <= nn; i++) {
          const p = t.Node(i);
          let x = p.X(), y = p.Y(), z = p.Z(); p.delete();
          if (tr) {
            const X = tr.Value(1, 1) * x + tr.Value(1, 2) * y + tr.Value(1, 3) * z + tr.Value(1, 4);
            const Y = tr.Value(2, 1) * x + tr.Value(2, 2) * y + tr.Value(2, 3) * z + tr.Value(2, 4);
            const Z = tr.Value(3, 1) * x + tr.Value(3, 2) * y + tr.Value(3, 3) * z + tr.Value(3, 4);
            x = X; y = Y; z = Z;
          }
          pos.push(x, y, z); nor.push(0, 0, 0);
        }
        const rev = face.Orientation_1().value === oc.TopAbs_Orientation.TopAbs_REVERSED.value;
        const iStart = idx.length;
        const nt = t.NbTriangles();
        for (let k = 1; k <= nt; k++) {
          const tri = t.Triangle(k);
          let a = tri.Value(1) - 1, b = tri.Value(2) - 1, c = tri.Value(3) - 1; tri.delete();
          if (rev) { const q = b; b = c; c = q; }
          a += start; b += start; c += start;
          idx.push(a, b, c);
          // Flächennormale gewichtet auf die Knoten addieren (glatt innerhalb einer Fläche)
          const ax = pos[b * 3] - pos[a * 3], ay = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2];
          const bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
          const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          for (const v of [a, b, c]) { nor[v * 3] += nx; nor[v * 3 + 1] += ny; nor[v * 3 + 2] += nz; }
        }
        // planare Fläche? -> Ebene für "Skizze auf Fläche"
        let plane = null;
        try {
          const ad = new oc.BRepAdaptor_Surface_2(face, true);
          if (ad.GetType().value === oc.GeomAbs_SurfaceType.GeomAbs_Plane.value) {
            const pl = ad.Plane(); const axs = pl.Axis(); const d = axs.Direction(); const lo = axs.Location(); const xd = pl.XAxis().Direction();
            const flip = rev ? -1 : 1;
            plane = { o: [lo.X(), lo.Y(), lo.Z()], n: [d.X() * flip, d.Y() * flip, d.Z() * flip], x: [xd.X(), xd.Y(), xd.Z()] };
            d.delete(); lo.delete(); xd.delete(); axs.delete(); pl.delete();
          }
          ad.delete();
        } catch (e) { /* keine Ebene */ }
        faces.push({ id: fid, start: iStart, count: idx.length - iStart, plane });
        loc.delete(); if (tr) tr.delete();
      }
      // Normalen normieren
      for (let i = 0; i < nor.length; i += 3) {
        const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
        nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
      }
      // Kanten
      const epos = [], eranges = [];
      if (opts.edges !== false && faces.length < 4000) {
        let eid = 0;
        for (const e of uniqueEdges(shape)) {
          try {
            if (oc.BRep_Tool.Degenerated(e)) { eid++; continue; }
            const c = keep(new oc.BRepAdaptor_Curve_2(e));
            const d = keep(new oc.GCPnts_TangentialDeflection_2(c, 0.2, lin, 2, 1e-9, 1e-7));
            const n = d.NbPoints(); const start = epos.length / 3;
            let prev = null;
            for (let i = 1; i <= n; i++) {
              const p = d.Value(i); const q = [p.X(), p.Y(), p.Z()]; p.delete();
              if (prev) epos.push(prev[0], prev[1], prev[2], q[0], q[1], q[2]);
              prev = q;
            }
            eranges.push({ id: eid, start, count: epos.length / 3 - start, mid: edgeMid(e) });
          } catch (err) { /* Kante überspringen */ }
          eid++;
        }
      }
      return {
        bbox: bb,
        positions: new Float32Array(pos), normals: new Float32Array(nor),
        indices: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint32Array(idx),
        faces, edgePositions: new Float32Array(epos), edgeRanges: eranges,
      };
    });
    release(res.scope);
    return res.value;
  }

  // ---------- Eigenschaften ----------
  function massProps(shape, density = 7.85) {
    const out = withScope(() => {
      const g = keep(new oc.GProp_GProps_1());
      oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
      const vol = g.Mass(); const c = g.CentreOfMass();
      const com = [c.X(), c.Y(), c.Z()]; c.delete();
      let area = 0;
      try { const a = keep(new oc.GProp_GProps_1()); oc.BRepGProp.SurfaceProperties_1(shape, a, false, false); area = a.Mass(); } catch (e) { /* */ }
      const bb = bboxOf(shape);
      return { volume: vol, area, centre: com, bbox: bb, mass_g: vol / 1000 * density };
    });
    release(out.scope);
    return out.value;
  }

  // ---------- Export ----------
  function exportSTEP(shape) {
    const out = withScope(() => {
      const w = keep(new oc.STEPControl_Writer_1());
      w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
      w.Write('/out.step');
      const data = oc.FS.readFile('/out.step');
      oc.FS.unlink('/out.step');
      return data;
    });
    release(out.scope);
    return out.value; // Uint8Array
  }
  function exportSTL(shape, quality = 1) {
    const m = tessellate(shape, { quality, edges: false });
    const nTri = m.indices.length / 3;
    const buf = new ArrayBuffer(84 + nTri * 50);
    const dv = new DataView(buf);
    const header = 'BrowserCAD STL';
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, nTri, true);
    let o = 84; const p = m.positions;
    for (let t = 0; t < nTri; t++) {
      const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
      dv.setUint16(o, 0); o += 2;
    }
    return new Uint8Array(buf);
  }

  // ---------- Baugruppe ----------
  // parts: [{ shape, matrix }] -> Compound mit verschobenen Kopien
  function buildCompound(parts) {
    const r = withScope(() => {
      const comp = keep(new oc.TopoDS_Compound());
      const b = keep(new oc.BRep_Builder());
      b.MakeCompound(comp);
      for (const p of parts) b.Add(comp, p.matrix ? moved(p.shape, p.matrix) : p.shape);
      return comp;
    });
    return { shape: r.value, scope: r.scope };
  }

  return { regenerate, tessellate, massProps, exportSTEP, exportSTL, buildCompound, release, importShape, withScope, bboxOf, readSTEP, readSTL, oc };
}

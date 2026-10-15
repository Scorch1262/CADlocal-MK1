// viewer.js – 3D-Ansicht auf Basis von three.js (Creo-ähnliche Navigation: MMB drehen, Shift+MMB schieben, Strg+MMB / Rad zoomen)
import * as THREE from '/vendor/three.module.js';

const V3 = THREE.Vector3;

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x232a38, 0.75));
    this.key = new THREE.DirectionalLight(0xffffff, 0.9);
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0x9db8ff, 0.25);
    this.scene.add(this.fill, this.fill.target);

    this.persp = new THREE.PerspectiveCamera(35, 1, 1, 10000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
    this.isOrtho = false;
    this.target = new V3(0, 0, 0);
    this.dist = 300;
    this.q = new THREE.Quaternion();
    this.sceneRadius = 100;

    this.bodyGroup = new THREE.Group();
    this.datumGroup = new THREE.Group();
    this.sketchGroup = new THREE.Group();
    this.hiGroup = new THREE.Group();
    this.scene.add(this.bodyGroup, this.datumGroup, this.sketchGroup, this.hiGroup);

    this.bodies = [];          // { key, itemId, mesh, obj, lines, data }
    this.datums = [];          // { key, itemId, mesh, frame }
    this.displayMode = 'shaded-edges';
    this.showDatums = true;
    this.tool = null;          // Skizzen-Werkzeug (konsumiert Linksklicks)
    this.onPick = () => {};
    this.onContext = () => {};
    this.onHover = () => {};
    this.onFrame = null;       // wird nach jedem Zeichnen aufgerufen (Maß-Overlay)
    this.filter = { face: true, edge: true, datum: true, body: true };
    this.hover = null;
    this._raf = 0;
    this._bindEvents();
    this.setStandardView('iso');
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  get camera() { return this.isOrtho ? this.ortho : this.persp; }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.requestRender();
  }

  // ----- Kamera -----
  _updateCamera() {
    const cam = this.camera;
    const dir = new V3(0, 0, 1).applyQuaternion(this.q);
    cam.position.copy(this.target).addScaledVector(dir, this.dist);
    cam.quaternion.copy(this.q);
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    const far = this.dist * 60 + this.sceneRadius * 20;
    const near = Math.max(this.dist * 0.01, 0.01);
    if (this.isOrtho) {
      const hh = this.dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      this.ortho.left = -hh * w / h; this.ortho.right = hh * w / h; this.ortho.top = hh; this.ortho.bottom = -hh;
      this.ortho.near = -far; this.ortho.far = far;
    } else { this.persp.near = near; this.persp.far = far; }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.key.position.copy(cam.position).add(new V3(0.5, 0.8, 0.4).applyQuaternion(this.q).multiplyScalar(this.dist));
    this.key.target.position.copy(this.target);
    this.fill.position.copy(cam.position).add(new V3(-0.8, -0.3, 0.2).applyQuaternion(this.q).multiplyScalar(this.dist));
    this.fill.target.position.copy(this.target);
  }
  get pixelWorld() { // Weltgröße eines Pixels im Zielabstand
    const h = this.container.clientHeight || 600;
    return 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) / h;
  }

  setStandardView(name) {
    const views = {
      iso: [[1, 0.8, 1], [0, 1, 0]], front: [[0, 0, 1], [0, 1, 0]], back: [[0, 0, -1], [0, 1, 0]],
      top: [[0, 1, 0], [0, 0, -1]], bottom: [[0, -1, 0], [0, 0, 1]], right: [[1, 0, 0], [0, 1, 0]], left: [[-1, 0, 0], [0, 1, 0]],
    };
    const [d, up] = views[name] || views.iso;
    this.lookFrom(new V3(...d).normalize(), new V3(...up));
  }
  lookFrom(dir, up) {
    const m = new THREE.Matrix4().lookAt(dir.clone().multiplyScalar(10), new V3(), up);
    this.q.setFromRotationMatrix(m);
    this.requestRender();
  }
  // Blick senkrecht auf eine Ebene (für Skizzen)
  lookAtFrame(fr, keepTarget = false) {
    const n = new V3(...fr.n), y = new V3(...fr.y);
    this.lookFrom(n, y);
    if (!keepTarget) this.target.set(...fr.o);
    this.requestRender();
  }
  fit(box) {
    box = box || this.boundsAll();
    if (!box || box.isEmpty()) { this.target.set(0, 0, 0); this.dist = 300; this.sceneRadius = 100; this.requestRender(); return; }
    const c = box.getCenter(new V3()); const s = box.getSize(new V3());
    const r = Math.max(s.length() / 2, 1);
    this.target.copy(c); this.sceneRadius = r;
    this.dist = r / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2)) * 1.1;
    this.requestRender();
  }
  boundsAll() {
    const b = new THREE.Box3();
    for (const o of this.bodies) { const bb = new THREE.Box3().setFromObject(o.obj); if (!bb.isEmpty()) b.union(bb); }
    return b;
  }
  toggleOrtho() { this.isOrtho = !this.isOrtho; this.requestRender(); return this.isOrtho; }

  rotateView(dx, dy) {
    const k = 0.006;
    const qa = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), -dx * k);
    const qb = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -dy * k);
    this.q.multiply(qa).multiply(qb).normalize();
    this.requestRender();
  }
  panView(dx, dy) {
    const s = this.pixelWorld;
    const right = new V3(1, 0, 0).applyQuaternion(this.q), up = new V3(0, 1, 0).applyQuaternion(this.q);
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    this.requestRender();
  }
  zoomView(f) { this.dist = Math.min(Math.max(this.dist * f, 0.05), 1e6); this.requestRender(); }
  rollView(a) {
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), a)).normalize();
    this.requestRender();
  }

  // ----- Anzeige -----
  setBodies(list) {
    for (const b of this.bodies) {
      this.bodyGroup.remove(b.obj);
      b.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.bodies = [];
    for (const d of list) {
      const m = d.mesh; if (!m || !m.positions.length) continue;
      const obj = new THREE.Group();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      const mat = new THREE.MeshPhongMaterial({ color: d.color || 0x9fb6d3, shininess: 40, specular: 0x333844, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      obj.add(mesh);
      let lines = null;
      if (m.edgePositions.length) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(m.edgePositions, 3));
        lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x141b2b }));
        obj.add(lines);
      }
      if (d.matrix) { const mm = new THREE.Matrix4(); mm.set(...d.matrix); obj.matrixAutoUpdate = false; obj.matrix.copy(mm); obj.updateMatrixWorld(true); }
      obj.visible = d.visible !== false;
      this.bodyGroup.add(obj);
      this.bodies.push({ key: d.key, itemId: d.itemId, data: m, obj, mesh, lines, baseColor: d.color || 0x9fb6d3, matrix: d.matrix, ghost: !!d.ghost, nopick: !!d.nopick });
    }
    this._applyDisplayMode();
    this.requestRender();
  }

  setDatums(list) {
    for (const d of this.datums) { this.datumGroup.remove(d.obj); d.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); }); }
    this.datums = [];
    const size = Math.max(this.sceneRadius * 1.1, 40);
    for (const d of list) {
      const g = new THREE.Group();
      const geo = new THREE.PlaneGeometry(size, size);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x4f86d9, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x6fa0ee }));
      g.add(m, edges);
      const sp = this._label(d.label);
      sp.position.set(size / 2 - size * 0.08, size / 2 - size * 0.04, 0); sp.scale.set(size * 0.22, size * 0.055, 1);
      g.add(sp);
      const fr = d.frame;
      const mm = new THREE.Matrix4().makeBasis(new V3(...fr.x), new V3(...fr.y), new V3(...fr.n)).setPosition(new V3(...fr.o));
      g.matrixAutoUpdate = false; g.matrix.copy(mm); g.updateMatrixWorld(true);
      g.visible = d.visible !== false && this.showDatums;
      this.datumGroup.add(g);
      this.datums.push({ key: d.key, itemId: d.itemId, obj: g, mesh: m, frame: fr, label: d.label, hiddenByLayer: d.visible === false });
    }
    this.requestRender();
  }
  _label(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d'); x.font = 'bold 34px Segoe UI, Arial'; x.textAlign = 'right'; x.textBaseline = 'middle';
    x.fillStyle = '#9cc0ff'; x.fillText(text, 250, 34);
    const t = new THREE.CanvasTexture(c);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  }
  setShowDatums(v) { this.showDatums = v; for (const d of this.datums) d.obj.visible = v && !d.hiddenByLayer; this.requestRender(); }

  setDisplayMode(m) { this.displayMode = m; this._applyDisplayMode(); this.requestRender(); }
  _applyDisplayMode() {
    for (const b of this.bodies) {
      const mat = b.mesh.material;
      mat.wireframe = false; mat.transparent = false; mat.opacity = 1; mat.colorWrite = true; mat.color.setHex(b.baseColor);
      mat.depthWrite = true;
      if (b.lines) b.lines.visible = true;
      if (this.displayMode === 'shaded') { if (b.lines) b.lines.visible = false; }
      else if (this.displayMode === 'wireframe') { mat.colorWrite = false; }
      else if (this.displayMode === 'hidden') { mat.color.setHex(0xf4f6fa); mat.emissive?.setHex(0x888888); }
      else if (this.displayMode === 'transparent') { mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false; }
      if (b.lines) b.lines.material.color.setHex(this.displayMode === 'wireframe' ? 0xc9d6ee : 0x141b2b);
      if (this.displayMode !== 'hidden') mat.emissive?.setHex(0x000000);
      if (b.ghost) { mat.transparent = true; mat.opacity = 0.2; mat.depthWrite = false; }   // Originalkörper als Geist (Vorschau)
    }
  }

  // ----- Hervorhebung (Auswahl / Hover) -----
  setHighlights(items, kind = 'sel') {
    // items: [{ bodyKey, type:'face'|'edge', id }]
    const grp = kind === 'sel' ? (this._selGroup ||= new THREE.Group()) : (this._hovGroup ||= new THREE.Group());
    if (!grp.parent) this.hiGroup.add(grp);
    for (const c of [...grp.children]) { grp.remove(c); c.geometry?.dispose(); }
    const color = kind === 'sel' ? 0xff9a2e : 0x7fd1ff;
    for (const it of items) {
      const b = this.bodies.find(x => x.key === it.bodyKey); if (!b) continue;
      if (it.type === 'face') {
        const f = b.data.faces.find(x => x.id === it.id); if (!f) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', b.mesh.geometry.getAttribute('position'));
        g.setAttribute('normal', b.mesh.geometry.getAttribute('normal'));
        g.setIndex(new THREE.BufferAttribute(b.data.indices.subarray(f.start, f.start + f.count), 1));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        m.matrixAutoUpdate = false; m.matrix.copy(b.obj.matrix); m.matrixWorldNeedsUpdate = true;
        grp.add(m);
      } else if (it.type === 'edge') {
        const r = b.data.edgeRanges.find(x => x.id === it.id); if (!r) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(b.data.edgePositions.subarray(r.start * 3, (r.start + r.count) * 3), 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
        l.renderOrder = 10; l.matrixAutoUpdate = false; l.matrix.copy(b.obj.matrix);
        grp.add(l);
        // dickere Darstellung durch leicht versetzte Kopien
        const px = this.pixelWorld;
        for (const o of [[px, 0, 0], [0, px, 0], [0, 0, px]]) {
          const l2 = new THREE.LineSegments(g, l.material); l2.renderOrder = 10;
          l2.matrixAutoUpdate = false; l2.matrix.copy(b.obj.matrix);
          l2.matrix.premultiply(new THREE.Matrix4().makeTranslation(o[0], o[1], o[2]));
          grp.add(l2);
        }
      }
    }
    this.requestRender();
  }
  setDatumHighlight(key) {
    for (const d of this.datums) d.mesh.material.opacity = d.key === key ? 0.4 : 0.14;
    this.requestRender();
  }

  // ----- Picking -----
  _ndc(ev) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 };
  }
  rayFrom(ev) {
    const n = this._ndc(ev);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(n.x, n.y), this.camera);
    return rc;
  }
  rayToFrame(ev, fr) {
    const rc = this.rayFrom(ev);
    const pl = new THREE.Plane(new V3(...fr.n), -new V3(...fr.n).dot(new V3(...fr.o)));
    const p = new V3();
    if (!rc.ray.intersectPlane(pl, p)) return null;
    const d = p.clone().sub(new V3(...fr.o));
    return { u: d.dot(new V3(...fr.x)), v: d.dot(new V3(...fr.y)), point: p };
  }
  pick(ev) {
    const rc = this.rayFrom(ev);
    rc.params.Line.threshold = this.pixelWorld * 5;
    let faceHit = null, edgeHit = null, datumHit = null;
    const solids = this.bodies.filter(b => b.obj.visible && !b.nopick);
    if (this.filter.face || this.filter.body) {
      for (const b of solids) {
        const hits = rc.intersectObject(b.mesh, false);
        if (hits.length && (!faceHit || hits[0].distance < faceHit.distance)) faceHit = { ...hits[0], body: b };
      }
    }
    if (this.filter.edge) {
      for (const b of solids) {
        if (!b.lines) continue;
        const hits = rc.intersectObject(b.lines, false);
        if (hits.length && (!edgeHit || hits[0].distance < edgeHit.distance)) edgeHit = { ...hits[0], body: b };
      }
    }
    if (this.filter.datum) {
      for (const d of this.datums) {
        if (!d.obj.visible) continue;
        const hits = rc.intersectObject(d.mesh, false);
        if (hits.length && (!datumHit || hits[0].distance < datumHit.distance)) datumHit = { ...hits[0], datum: d };
      }
    }
    const tol = this.dist * 0.01;
    if (edgeHit && (!faceHit || edgeHit.distance <= faceHit.distance + tol)) {
      const b = edgeHit.body;
      const vi = edgeHit.index; // Startvertex-Index des Segments (jeweils 2 Vertices je Segment)
      const r = b.data.edgeRanges.find(x => vi >= x.start && vi < x.start + x.count);
      if (r) return { type: 'edge', bodyKey: b.key, itemId: b.itemId, id: r.id, mid: r.mid, point: edgeHit.point, distance: edgeHit.distance };
    }
    if (faceHit && (!datumHit || faceHit.distance <= datumHit.distance)) {
      const b = faceHit.body; const tri = faceHit.faceIndex * 3;
      const f = b.data.faces.find(x => tri >= x.start && tri < x.start + x.count);
      let plane = null;
      if (f && f.plane) {
        const m = new THREE.Matrix4(); if (b.matrix) m.set(...b.matrix);
        const o = new V3(...f.plane.o).applyMatrix4(m);
        const rot = new THREE.Matrix3().setFromMatrix4(m);
        const n = new V3(...f.plane.n).applyMatrix3(rot).normalize(), x = new V3(...f.plane.x).applyMatrix3(rot).normalize();
        plane = { o: o.toArray(), n: n.toArray(), x: x.toArray() };
      }
      return { type: 'face', bodyKey: b.key, itemId: b.itemId, id: f ? f.id : -1, plane, point: faceHit.point, distance: faceHit.distance };
    }
    if (datumHit) return { type: 'datum', key: datumHit.datum.key, itemId: datumHit.datum.itemId, frame: datumHit.datum.frame, point: datumHit.point, distance: datumHit.distance };
    return null;
  }

  // ----- Eingabe -----
  _bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const mode = e.button === 1 ? (e.ctrlKey ? 'zoom' : e.shiftKey ? 'pan' : 'rotate')
        : e.button === 0 && e.altKey ? (e.ctrlKey ? 'zoom' : e.shiftKey ? 'pan' : 'rotate')
        : e.button === 2 ? 'rclick' : e.button === 0 ? 'click' : null;
      if (!mode) return;
      drag = { mode, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, ev: e };
      if (mode === 'click' && this.tool && this.tool.down) this.tool.down(e);
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (!drag) {
        if (this.tool && this.tool.move) this.tool.move(e);
        else this._hoverPick(e);
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === 'rotate') this.rotateView(dx, dy);
      else if (drag.mode === 'pan' || (drag.mode === 'rclick' && drag.moved)) this.panView(dx, dy);
      else if (drag.mode === 'zoom') this.zoomView(Math.exp(dy * 0.01));
      else if (drag.mode === 'click' && this.tool && this.tool.move) this.tool.move(e);
    });
    c.addEventListener('pointerup', e => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.mode === 'click' && !d.moved) {
        if (this.tool && this.tool.up) this.tool.up(e);
        else if (!this.tool) this.onPick(this.pick(e), e);
      } else if (d.mode === 'rclick' && !d.moved) {
        if (this.tool && this.tool.context) this.tool.context(e);
        else this.onContext(this.pick(e), e);
      }
    });
    c.addEventListener('dblclick', e => { if (this.tool && this.tool.dbl) this.tool.dbl(e); });
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoomView(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }
  _hoverPick(e) {
    if (this._hoverBusy) return; this._hoverBusy = true;
    requestAnimationFrame(() => {
      this._hoverBusy = false;
      const p = this.pick(e);
      const key = p ? p.type + ':' + (p.bodyKey || p.key) + ':' + (p.id ?? '') : '';
      if (key === this._hoverKey) return;
      this._hoverKey = key;
      this.hover = p;
      this.setHighlights(p && (p.type === 'face' || p.type === 'edge') ? [{ bodyKey: p.bodyKey, type: p.type, id: p.id }] : [], 'hover');
      this.onHover(p);
    });
  }

  // 3Dconnexion-Bewegung (Werte bereits skaliert, pro Sekunde)
  applyMotion(m, dt) {
    if (m.panX || m.panY) this.panView(-m.panX * dt * 300, -m.panY * dt * 300);
    if (m.zoom) this.zoomView(Math.exp(m.zoom * dt * 1.5));
    if (m.orbitH || m.orbitV) this.rotateView(-m.orbitH * dt * 250, -m.orbitV * dt * 250);
    if (m.roll) this.rollView(m.roll * dt * 1.5);
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._updateCamera(); this.renderer.render(this.scene, this.camera); if (this.onFrame) this.onFrame(); });
  }
  snapshot() { this._updateCamera(); this.renderer.render(this.scene, this.camera); return this.canvas.toDataURL('image/png'); }
}

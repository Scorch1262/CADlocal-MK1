// spacemouse.js – 3Dconnexion SpaceMouse über WebHID (Chrome / Edge; benötigt HTTPS oder http://localhost)
// Die Achsenzuordnung ist einstellbar, weil sich die Achsenreihenfolge je nach Modell/Treiber unterscheidet.

const ACTIONS = ['Schieben X', 'Schieben Y', 'Zoom', 'Drehen horizontal', 'Drehen vertikal', 'Rollen', '–'];
const ACTION_KEYS = ['panX', 'panY', 'zoom', 'orbitH', 'orbitV', 'roll', null];
const AXES = ['Translation X', 'Translation Y', 'Translation Z', 'Rotation X', 'Rotation Y', 'Rotation Z'];

const DEFAULTS = {
  // Achse -> Aktionsindex, Invertierung
  map: [0, 2, 1, 4, 3, 5],
  invert: [false, true, false, false, false, false],
  sens: 1.0,
  dead: 0.04,
};

export class SpaceMouse {
  constructor(viewer, hooks = {}) {
    this.v = viewer;
    this.hooks = hooks;
    this.dev = null;
    this.raw = [0, 0, 0, 0, 0, 0];
    this.settings = this._load();
    this.onStatus = () => {};
    this._last = 0;
    this._loop = this._loop.bind(this);
  }

  static supported() { return !!(navigator.hid); }
  static get ACTIONS() { return ACTIONS; }
  static get AXES() { return AXES; }

  _load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('bcad.spacemouse') || '{}') }; } catch (e) { return { ...DEFAULTS }; }
  }
  save() { try { localStorage.setItem('bcad.spacemouse', JSON.stringify(this.settings)); } catch (e) { /* */ } }

  async connect(auto = false) {
    if (!SpaceMouse.supported()) throw new Error('WebHID wird von diesem Browser nicht unterstützt (Chrome/Edge verwenden).');
    if (!window.isSecureContext) throw new Error('WebHID benötigt HTTPS oder http://localhost.');
    let dev = null;
    const known = await navigator.hid.getDevices();
    dev = known.find(d => d.vendorId === 0x256f || (d.vendorId === 0x046d && d.collections?.some(c => c.usagePage === 1 && c.usage === 8)));
    if (!dev && !auto) {
      const list = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x256f }, { vendorId: 0x046d, usagePage: 0x01, usage: 0x08 }] });
      dev = list[0];
    }
    if (!dev) return false;
    if (!dev.opened) await dev.open();
    this.dev = dev;
    dev.addEventListener('inputreport', e => this._report(e));
    navigator.hid.addEventListener('disconnect', e => { if (e.device === this.dev) { this.dev = null; this.onStatus('getrennt'); } });
    this.onStatus('verbunden: ' + (dev.productName || 'SpaceMouse'));
    this._last = performance.now();
    requestAnimationFrame(this._loop);
    return true;
  }

  async disconnect() { if (this.dev) { try { await this.dev.close(); } catch (e) { /* */ } this.dev = null; this.onStatus('getrennt'); } }

  _report(e) {
    const d = e.data; const id = e.reportId;
    const rd = o => d.getInt16(o, true);
    if (id === 1) {
      if (d.byteLength >= 12) for (let i = 0; i < 6; i++) this.raw[i] = rd(i * 2);
      else if (d.byteLength >= 6) for (let i = 0; i < 3; i++) this.raw[i] = rd(i * 2);
    } else if (id === 2) {
      if (d.byteLength >= 6) for (let i = 0; i < 3; i++) this.raw[3 + i] = rd(i * 2);
    } else if (id === 3) {
      const bits = d.byteLength ? d.getUint8(0) | (d.byteLength > 1 ? d.getUint8(1) << 8 : 0) : 0;
      if (this.hooks.buttons) this.hooks.buttons(bits, this._prevBits || 0);
      this._prevBits = bits;
    }
  }

  _loop(t) {
    if (!this.dev) return;
    const dt = Math.min((t - this._last) / 1000, 0.1); this._last = t;
    const s = this.settings; const m = { panX: 0, panY: 0, zoom: 0, orbitH: 0, orbitV: 0, roll: 0 };
    let any = false;
    for (let i = 0; i < 6; i++) {
      let val = Math.max(-1, Math.min(1, this.raw[i] / 350));
      if (Math.abs(val) < s.dead) val = 0;
      if (!val) continue;
      if (s.invert[i]) val = -val;
      const key = ACTION_KEYS[s.map[i]];
      if (key) { m[key] += val * s.sens; any = true; }
    }
    if (any) this.v.applyMotion(m, dt);
    requestAnimationFrame(this._loop);
  }
}

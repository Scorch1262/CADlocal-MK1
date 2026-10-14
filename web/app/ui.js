// ui.js – kleine DOM-Hilfsfunktionen: Elemente, Dialoge, Kontextmenü, Hinweise
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = 'info', ms = 4500) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// Modaler Dialog. buttons: [{ label, primary, value }] -> Promise<value|null>; build(body) darf Elemente anhängen
export function modal(title, build, buttons = [{ label: 'OK', primary: true, value: true }], opts = {}) {
  return new Promise(resolve => {
    const body = h('div', { class: 'modal-body' });
    const getVal = build ? build(body) : null;
    const close = v => { back.remove(); resolve(v); };
    const foot = h('div', { class: 'modal-foot' }, buttons.map(b => h('button', {
      class: 'btn' + (b.primary ? ' primary' : ''),
      onclick: () => close(b.value === 'form' ? (getVal ? getVal() : true) : b.value),
    }, b.label)));
    const back = h('div', { class: 'modal-back', onkeydown: e => { if (e.key === 'Escape') close(null); } },
      h('div', { class: 'modal', style: opts.width ? { width: opts.width } : null }, h('div', { class: 'modal-head' }, title), body, foot));
    document.body.append(back);
    const first = body.querySelector('input,select,textarea,button');
    if (first) first.focus();
    body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = foot.querySelector('.primary'); if (p) p.click(); } });
  });
}

export async function promptText(title, label, value = '') {
  const r = await modal(title, body => {
    const inp = h('input', { type: 'text', value, class: 'wide' });
    body.append(h('label', { class: 'field' }, h('span', null, label), inp));
    return () => inp.value.trim();
  }, [{ label: 'Abbrechen', value: null }, { label: 'OK', primary: true, value: 'form' }]);
  return r || null;
}
export async function confirmBox(title, text) {
  return !!(await modal(title, body => body.append(h('p', null, text)), [{ label: 'Abbrechen', value: false }, { label: 'OK', primary: true, value: true }]));
}
export function info(title, nodes) { return modal(title, body => body.append(...[].concat(nodes)), [{ label: 'Schließen', primary: true, value: true }], { width: '560px' }); }

export function ctxMenu(x, y, items) {
  document.querySelectorAll('.ctx').forEach(e => e.remove());
  const m = h('div', { class: 'ctx', style: { left: x + 'px', top: y + 'px' } },
    items.filter(Boolean).map(it => it.sep ? h('div', { class: 'sep' }) : h('div', { class: 'item' + (it.disabled ? ' dis' : ''), onclick: () => { m.remove(); if (!it.disabled) it.run(); } }, it.label)));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  if (r.right > innerWidth) m.style.left = (innerWidth - r.width - 4) + 'px';
  if (r.bottom > innerHeight) m.style.top = (innerHeight - r.height - 4) + 'px';
  const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const fmt = (n, d = 2) => (Math.abs(n) >= 1e5 ? n.toExponential(3) : (+n.toFixed(d)).toString());
export function b64encode(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

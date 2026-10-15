// api.js – Zugriff auf den BrowserCAD-Server
async function req(method, url, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(url, init);
  if (r.status === 401 && !opts.noRedirect) { location.href = '/login'; throw new Error('Nicht angemeldet'); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.error || msg; } catch (e) { /* */ }
    throw new Error(msg);
  }
  return opts.text ? r.text() : r.json();
}

export const api = {
  info: () => req('GET', '/api/info', undefined, { noRedirect: true }),
  me: () => req('GET', '/api/me'),
  logout: () => req('POST', '/api/logout', undefined, { noRedirect: true }),
  list: () => req('GET', '/api/files'),
  get: name => req('GET', '/api/files/' + encodeURIComponent(name)),
  put: (name, json) => req('PUT', '/api/files/' + encodeURIComponent(name), json),
  del: name => req('DELETE', '/api/files/' + encodeURIComponent(name)),
  convert: (fileName, buf) => req('POST', '/api/convert?name=' + encodeURIComponent(fileName), buf, { text: true }),
  changePassword: (oldPw, newPw) => req('POST', '/api/account/password', { old: oldPw, new: newPw }),
};

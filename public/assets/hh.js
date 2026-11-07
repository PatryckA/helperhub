/* HelperHub shared helpers */
(function () {
  window.$ = (sel, root = document) => root.querySelector(sel);
  window.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  window.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.nl2br = s => esc(s).replace(/\n/g, '<br>');

  window.store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  window.session = {
    get() { return store.get('hh_session'); },
    set(s) { store.set('hh_session', s); },
    clear() { store.del('hh_session'); },
  };

  window.api = async function (path, { method = 'GET', body, auth } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) { const s = session.get(); if (s) headers.Authorization = 'Bearer ' + s; }
    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error('Could not connect. Please check your internet connection and try again.'), { status: 0 });
    }
    let data = {};
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok && !(res.status === 409 && data.problems)) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, data });
    return data;
  };

  window.fmtDate = (d, opts) => new Date(d + 'T12:00:00').toLocaleDateString('en-AU', opts || { weekday: 'long', day: 'numeric', month: 'long' });
  window.fmtDateShort = d => new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  window.fmtTime = t => { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`; };
  window.fmtRange = (a, b) => (!a ? '' : a === b ? fmtDate(a) : `${fmtDateShort(a)} to ${fmtDateShort(b)}`);

  window.toast = function (msg, type = 'ok') {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.className = 'toast show ' + type;
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3500);
  };

  /** Apply a group's colour, choosing dark or light text so it stays readable */
  window.applyAccent = function (hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--on-accent', lum > 0.45 ? '#1d2733' : '#ffffff');
  };

  /** Platform header (home, login, start...) */
  window.platformHeader = function (extraNav = '') {
    const h = $('#site-header');
    if (!h) return;
    h.innerHTML = `<div class="wrapline"><a href="/" class="brand"><span class="hh-mark" aria-hidden="true">🤝</span><span>HelperHub<small>Volunteer sign-ups, no ads</small></span></a>
      <nav class="nav">${extraNav || '<a href="/login">Organiser login</a>'}</nav></div>`;
  };

  /** Group-branded header */
  window.groupHeader = function (group, extraNav = '') {
    applyAccent(group.accent);
    const h = $('#site-header');
    if (!h) return;
    h.innerHTML = `<div class="wrapline"><a href="/${esc(group.slug)}" class="brand">${group.logo_url ? `<img src="${esc(group.logo_url)}" alt="">` : ''}<span>${esc(group.name)}<small>Volunteers</small></span></a>
      <nav class="nav">${extraNav}</nav></div>`;
  };

  window.siteFooter = function (group) {
    const f = document.createElement('footer');
    f.className = 'site';
    f.innerHTML = group
      ? `Free volunteer sign-ups by <a href="/">HelperHub</a>. <a href="/start">Start one for your group</a> · <a href="/privacy">Privacy</a>`
      : `HelperHub · Free volunteer sign-ups for schools, clubs and community groups · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>`;
    document.body.appendChild(f);
  };

  window.groupSlug = () => location.pathname.split('/')[1] || '';
})();

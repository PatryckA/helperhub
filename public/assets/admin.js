/* Admin console: events, slots, volunteers, emails */
(function () {
  const app = $('#app');
  const slug = groupSlug();
  const A = `/api/admin/${slug}`;
  let group = null;     // this group's settings
  let me = null;        // logged-in organiser
  let current = null;   // event being edited
  let dirty = false;
  let tab = 'setup';

  const call = (path, opts = {}) => api(path, { ...opts, auth: true }).catch(err => {
    if (err.status === 401) { session.clear(); location.replace('/login'); }
    throw err;
  });

  function logout() { session.clear(); location.replace('/login'); }

  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /** Group navigation shown on every admin screen */
  function groupNav(active) {
    return `<div class="tabs" style="margin-top:16px">
      <button data-nav="" class="${active === 'events' ? 'active' : ''}">Events</button>
      <button data-nav="settings" class="${active === 'settings' ? 'active' : ''}">Group settings</button>
      <button data-nav="organisers" class="${active === 'organisers' ? 'active' : ''}">Organisers</button>
    </div>`;
  }
  function bindNav() { $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav)); }

  /* ---------------- Routing ---------------- */
  window.addEventListener('hashchange', () => route());
  function go(hash) {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    dirty = false;
    location.hash = hash;
  }

  async function route() {
    if (!session.get()) return location.replace('/login');
    if (!group) {
      try {
        const [s, m] = await Promise.all([call(A + '/settings'), call('/api/me')]);
        group = s.group; me = m;
        renderHeader();
      } catch (err) {
        platformHeader('<a href="/login?choose=1">My groups</a>');
        app.innerHTML = `<div class="card" style="max-width:520px;margin:30px auto"><h1 style="margin-top:4px">Can't open this group</h1><div class="notice">${esc(err.message)}</div><a class="btn" href="/login?choose=1">My groups</a></div>`;
        return;
      }
    }
    applyAccent(group.accent); // undo any unsaved colour preview
    const h = location.hash.slice(1);
    dirty = false;
    if (h === 'settings') return showSettings();
    if (h === 'organisers') return showOrganisers();
    if (h === 'new') return showEditor(blankEvent());
    const m = h.match(/^event\/(\d+)(?:\/(\w+))?$/);
    if (m) {
      tab = m[2] === 'volunteers' ? 'volunteers' : 'setup';
      app.innerHTML = '<div class="spinner"></div>';
      try { const { event } = await call(A + '/events/' + m[1]); return showEditor(event); }
      catch (err) { app.innerHTML = `${groupNav('events')}<div class="error">${esc(err.message)}</div><p><a href="#">Back to events</a></p>`; bindNav(); return; }
    }
    return showList();
  }

  /* ---------------- Event list ---------------- */
  async function showList() {
    app.innerHTML = '<div class="spinner"></div>';
    let events, status;
    try { [{ events }, status] = await Promise.all([call(A + '/events'), call(A + '/status')]); }
    catch (err) { app.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter(e => !e.last_date || e.last_date >= today);
    const past = events.filter(e => e.last_date && e.last_date < today);
    const rows = list => list.map(e => `
      <tr class="click" data-id="${e.id}">
        <td><strong>${esc(e.title)}</strong>${e.location ? `<div class="small muted">${esc(e.location)}</div>` : ''}</td>
        <td class="hide-sm">${esc(fmtRange(e.first_date, e.last_date)) || '<span class="muted">No slots</span>'}</td>
        <td>${e.published ? '<span class="badge">Live</span>' : '<span class="badge draft">Draft</span>'}</td>
        <td>${e.filled} / ${e.capacity}</td>
      </tr>`).join('');
    const table = (list, empty) => list.length ? `
      <table class="list"><thead><tr><th>Event</th><th class="hide-sm">Dates</th><th>Status</th><th>Filled</th></tr></thead>
      <tbody>${rows(list)}</tbody></table>` : `<p class="muted">${empty}</p>`;

    const welcome = new URLSearchParams(location.search).has('welcome');
    if (welcome) history.replaceState(null, '', location.pathname + location.hash);
    app.innerHTML = `
      ${welcome ? `<div class="success" style="margin-top:18px"><strong>Welcome to HelperHub!</strong> Your group is live at <a href="/${esc(slug)}" target="_blank">helperhub.au/${esc(slug)}</a>. Start with <a href="#settings">Group settings</a> to add your logo and colours, then create your first event.</div>` : ''}
      ${groupNav('events')}
      <div class="toolbar">
        <h1 style="margin:0">Events</h1><span class="spacer"></span>
        <button class="btn" id="new">+ New event</button>
      </div>
      ${emailStatusHtml(status)}
      <h2>Upcoming and drafts</h2>${table(upcoming, 'No upcoming events yet. Create one, or duplicate a past event.')}
      ${past.length ? `<h2>Past</h2>${table(past, '')}` : ''}`;
    $('#new').onclick = () => go('new');
    bindNav();
    $$('tr.click').forEach(tr => tr.onclick = () => go('event/' + tr.dataset.id));
  }

  function emailStatusHtml(s) {
    const modeNote = s.email_provider === 'log' ? `<div class="notice">HelperHub is in <strong>test mode</strong>: emails are not being sent yet.</div>` : '';
    const failNote = s.failed_7d ? `<div class="error">${s.failed_7d} email(s) couldn't be sent in the last 7 days. If this keeps happening, contact HelperHub.</div>` : '';
    return `${modeNote}${failNote}
      <div class="card small" style="margin-top:14px">
        <span class="stat"><b>${s.sent_24h}</b>emails sent (24h)</span>
        <span class="stat"><b>${s.remaining_24h}</b>left today (limit ${s.daily_limit})</span>
        <span class="stat"><b>${s.queued}</b>waiting in queue</span>
        ${s.queued ? '<div class="muted" style="margin-top:6px">Queued emails send automatically each hour while under the daily limit.</div>' : ''}
      </div>`;
  }

  /* ---------------- Editor ---------------- */
  function blankEvent() {
    return { id: null, title: '', description: '', location: '', contact_name: '', contact_email: '', published: 0,
      donation_url: group.donation_url || '', donation_text: group.donation_text || '',
      slots: [{ title: '', details: '', date: '', start_time: '09:00', end_time: '10:00', capacity: 2, signups: [] }] };
  }

  function showEditor(ev) {
    current = ev;
    const saved = !!ev.id;
    const filled = ev.slots.reduce((n, s) => n + (s.signups?.length || 0), 0);
    const cap = ev.slots.reduce((n, s) => n + (+s.capacity || 0), 0);
    app.innerHTML = `
      ${groupNav('events')}
      <p style="margin:0"><a href="#" id="back">&larr; All events</a></p>
      <div class="toolbar" style="margin-top:8px">
        <h1 style="margin:0">${saved ? esc(ev.title) : 'New event'}</h1>
        ${saved ? (ev.published ? '<span class="badge">Live</span>' : '<span class="badge draft">Draft</span>') : ''}
      </div>
      ${saved ? `<div class="toolbar" style="margin-top:12px">
        <button class="btn secondary small" id="copylink">Copy volunteer link</button>
        <a class="btn secondary small" href="/${esc(slug)}/event/${ev.id}" target="_blank" rel="noopener">Preview</a>
        <button class="btn secondary small" id="dup">Duplicate event</button>
        <button class="btn secondary small" id="print">Print sign-in sheet</button>
        <button class="btn secondary small" id="mail">Email volunteers</button>
        <span class="spacer"></span>
        <button class="btn danger small" id="del">Delete event</button>
      </div>` : ''}
      ${saved ? `<div class="tabs">
        <button data-tab="setup" class="${tab === 'setup' ? 'active' : ''}">Details &amp; slots</button>
        <button data-tab="volunteers" class="${tab === 'volunteers' ? 'active' : ''}">Volunteers (${filled}/${cap})</button>
      </div>` : '<div style="height:12px"></div>'}
      <div id="tab-body"></div>`;
    $('#back').onclick = e => { e.preventDefault(); go(''); };
    bindNav();
    $$('.tabs button').forEach(b => b.onclick = () => {
      if (dirty && !window.confirm('You have unsaved changes. Switch tabs without saving?')) return;
      dirty = false;
      history.replaceState(null, '', '#event/' + ev.id + (b.dataset.tab === 'volunteers' ? '/volunteers' : ''));
      tab = b.dataset.tab; showEditor(current);
    });
    if (saved) {
      $('#copylink').onclick = () => copyLink(ev.id);
      $('#dup').onclick = () => duplicateModal(ev);
      $('#print').onclick = () => printSignIn(ev);
      $('#mail').onclick = () => emailModal(ev);
      $('#del').onclick = () => deleteModal(ev);
    }
    if (tab === 'volunteers' && saved) renderVolunteers(); else renderSetup();
  }

  function renderSetup() {
    const ev = current;
    $('#tab-body').innerHTML = `
      <form id="evform" class="card">
        <label for="f-title">Event name</label>
        <input id="f-title" data-k="title" type="text" value="${esc(ev.title)}" placeholder="e.g. Spring Fete" required>
        <div class="row">
          <div><label for="f-location">Location</label><input id="f-location" data-k="location" type="text" value="${esc(ev.location)}" placeholder="e.g. School hall"></div>
          <div><label class="check" style="margin-top:44px"><input type="checkbox" id="f-pub" ${ev.published ? 'checked' : ''}> Live (volunteers can see it)</label></div>
        </div>
        <label for="f-desc">Description <span class="opt">(shown at the top of the sign-up page)</span></label>
        <textarea id="f-desc" data-k="description" placeholder="What the event is and anything volunteers should know">${esc(ev.description)}</textarea>
        <div class="row">
          <div><label for="f-cn">Contact name <span class="opt">(optional)</span></label><input id="f-cn" data-k="contact_name" type="text" value="${esc(ev.contact_name)}"></div>
          <div><label for="f-ce">Contact email <span class="opt">(replies go here)</span></label><input id="f-ce" data-k="contact_email" type="email" value="${esc(ev.contact_email)}"></div>
        </div>
        <label for="f-du">Donation link <span class="opt">(optional: shows a "Donate instead" button, e.g. a Square link)</span></label>
        <input id="f-du" data-k="donation_url" type="url" value="${esc(ev.donation_url || '')}" placeholder="https://square.link/...">
        <label for="f-dx">Donation message <span class="opt">(optional)</span></label>
        <input id="f-dx" data-k="donation_text" type="text" value="${esc(ev.donation_text || '')}" placeholder="Can't bring something? You're welcome to donate instead.">
      </form>
      <div class="toolbar" style="margin-top:22px">
        <h2 style="margin:0">Time slots</h2><span class="spacer"></span>
        <button class="btn secondary small" id="addrun">+ Add a run of shifts</button>
        <button class="btn secondary small" id="addslot">+ Add slot</button>
      </div>
      <p class="small muted">Each slot is one task at one time. Volunteers take the whole slot.</p>
      <div id="slots" class="stack"></div>
      <div class="toolbar" style="margin-top:26px">
        <h2 style="margin:0">Things to bring</h2><span class="spacer"></span>
        <button class="btn secondary small" id="additem">+ Add item</button>
      </div>
      <p class="small muted">For bring-a-plate events, e.g. "Main dish" needing 6 people. Parents say what they'll bring and tick any dietary info.</p>
      <div id="dropoff" class="card hidden" style="margin-bottom:12px">
        <div class="row">
          <div><label for="f-dd" style="margin-top:0">Drop-off date</label><input id="f-dd" data-k="dropoff_date" type="date" value="${esc(ev.dropoff_date || '')}"></div>
          <div><label for="f-dt" style="margin-top:0">Drop off by</label><input id="f-dt" data-k="dropoff_time" type="time" step="300" value="${esc(ev.dropoff_time || '')}"></div>
        </div>
        <label for="f-dn">Where <span class="opt">(optional)</span></label>
        <input id="f-dn" data-k="dropoff_note" type="text" value="${esc(ev.dropoff_note || '')}" placeholder="e.g. Staffroom kitchen">
      </div>
      <div id="items" class="stack"></div>
      <div id="save-err"></div>
      <div class="actionbar show"><div class="inner">
        <span class="small muted" id="dirty-note">${ev.id ? 'All changes saved' : 'Not saved yet'}</span>
        <button class="btn" id="save">${ev.id ? 'Save changes' : 'Save event'}</button>
      </div></div>`;
    $$('#evform [data-k], #dropoff [data-k]').forEach(inp => inp.addEventListener('input', () => { ev[inp.dataset.k] = inp.value; markDirty(); }));
    $('#f-pub').addEventListener('change', e => { ev.published = e.target.checked ? 1 : 0; markDirty(); });
    $('#addslot').onclick = addSlot;
    $('#additem').onclick = addItem;
    $('#addrun').onclick = runModal;
    $('#save').onclick = save;
    renderSlots();
  }

  function markDirty() { dirty = true; const n = $('#dirty-note'); if (n) n.textContent = 'Unsaved changes'; }

  function renderSlots() {
    const entries = current.slots.map((s, i) => ({ s, i }));
    const shifts = entries.filter(e => e.s.kind !== 'item');
    const items = entries.filter(e => e.s.kind === 'item');
    const foot = (s, n) => `
        <div class="foot">
          <span class="muted">${n ? `${n} signed up` : ''}</span>
          <span>
            <button class="btn link" data-act="copy">Copy</button>
            <button class="btn link" data-act="remove" ${n ? 'disabled title="Remove the volunteers first"' : ''} style="color:var(--bad)">Remove</button>
          </span>
        </div>`;
    $('#slots').innerHTML = shifts.map(({ s, i }) => {
      const n = s.signups?.length || 0;
      return `
      <div class="slot-edit" data-i="${i}">
        <div class="grid">
          <div class="task"><label>Task</label><input type="text" data-k="title" value="${esc(s.title)}" placeholder="e.g. BBQ cooking"></div>
          <div><label>Date</label><input type="date" data-k="date" value="${esc(s.date)}"></div>
          <div><label>Start</label><input type="time" data-k="start_time" value="${esc(s.start_time)}" step="300"></div>
          <div><label>End</label><input type="time" data-k="end_time" value="${esc(s.end_time)}" step="300"></div>
          <div><label>People</label><input type="number" data-k="capacity" min="${Math.max(1, n)}" max="500" value="${esc(s.capacity)}"></div>
        </div>
        <textarea data-k="details" placeholder="Task details (optional): what's involved, what to bring, where to go">${esc(s.details)}</textarea>
        ${foot(s, n)}
      </div>`;
    }).join('') || '<p class="muted small">No time slots.</p>';
    $('#items').innerHTML = items.map(({ s, i }) => {
      const n = s.signups?.length || 0;
      return `
      <div class="slot-edit item" data-i="${i}">
        <div class="grid item-grid">
          <div><label>Item</label><input type="text" data-k="title" value="${esc(s.title)}" placeholder="e.g. Main dish"></div>
          <div><label>How many</label><input type="number" data-k="capacity" min="${Math.max(1, n)}" max="500" value="${esc(s.capacity)}"></div>
        </div>
        <textarea data-k="details" placeholder="Details (optional), e.g. serves 8, please bring in a disposable dish">${esc(s.details)}</textarea>
        ${foot(s, n)}
      </div>`;
    }).join('');
    $('#dropoff').classList.toggle('hidden', !items.length);
    $$('.slot-edit').forEach(el => {
      const s = current.slots[+el.dataset.i];
      $$('[data-k]', el).forEach(inp => inp.addEventListener('input', () => { s[inp.dataset.k] = inp.value; markDirty(); }));
      $('[data-act=copy]', el).onclick = () => {
        current.slots.splice(+el.dataset.i + 1, 0, { ...s, id: undefined, signups: [] });
        markDirty(); renderSlots();
      };
      $('[data-act=remove]', el).onclick = () => { current.slots.splice(+el.dataset.i, 1); markDirty(); renderSlots(); };
    });
  }

  function dropBlankStarter() {
    // a brand-new event starts with one empty time slot; drop it if unused
    const only = current.slots.length === 1 && current.slots[0];
    if (only && only.kind !== 'item' && !only.id && !only.title && !only.date) current.slots = [];
  }

  function addItem() {
    dropBlankStarter();
    current.slots.push({ kind: 'item', title: '', details: '', capacity: 4, signups: [] });
    markDirty(); renderSlots();
    const els = $$('#items .slot-edit'); const last = els[els.length - 1];
    last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('input', last).focus();
  }

  function addSlot() {
    const shiftsOnly = current.slots.filter(s => s.kind !== 'item');
    const last = shiftsOnly[shiftsOnly.length - 1];
    let next = { title: '', details: '', date: '', start_time: '09:00', end_time: '10:00', capacity: 2, signups: [] };
    if (last) {
      // continue straight after the previous slot, same length
      const mins = toMin(last.end_time) - toMin(last.start_time);
      next = { ...next, title: last.title, details: last.details, date: last.date, capacity: last.capacity,
        start_time: last.end_time, end_time: fromMin(Math.min(toMin(last.end_time) + (mins > 0 ? mins : 60), 23 * 60 + 55)) };
    }
    current.slots.push(next);
    markDirty(); renderSlots();
    const els = $$('#slots .slot-edit'); els[els.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  async function save() {
    const btn = $('#save');
    $('#save-err').innerHTML = '';
    btn.disabled = true; btn.textContent = 'Saving…';
    const body = { ...current, slots: current.slots.map(({ signups, start_utc, event_id, sort_order, ...s }) => s) };
    try {
      const { event } = current.id
        ? await call(A + '/events/' + current.id, { method: 'PUT', body })
        : await call(A + '/events', { method: 'POST', body });
      dirty = false;
      toast(event.published ? 'Saved. The event is live.' : 'Saved as a draft. Tick "Live" when it\'s ready.');
      history.replaceState(null, '', '#event/' + event.id);
      showEditor(event);
    } catch (err) {
      $('#save-err').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = current.id ? 'Save changes' : 'Save event';
    }
  }

  /* ---------------- Volunteers tab ---------------- */
  const DIET = { veg: 'Vegetarian', vegan: 'Vegan', gf: 'Gluten free', nf: 'Nut free', df: 'Dairy free' };
  const dietLabels = codes => String(codes || '').split(',').filter(c => DIET[c]).map(c => DIET[c]);
  const slotLabel = s => s.kind === 'item'
    ? `Bring: ${esc(s.title)}`
    : `${esc(fmtDateShort(s.date))}, ${fmtTime(s.start_time)} to ${fmtTime(s.end_time)} · ${esc(s.title)}`;
  function renderVolunteers() {
    const ev = current;
    $('#tab-body').innerHTML = `
      <div class="toolbar"><span class="muted small">Contact details are only visible to admins.</span><span class="spacer"></span>
        <button class="btn small" id="addvol">+ Add volunteer</button></div>
      ${ev.slots.map(s => `
        <h2 style="font-size:17px">${slotLabel(s)}
          <span class="badge ${s.signups.length >= s.capacity ? 'full' : ''}" style="margin-left:6px">${s.signups.length}/${s.capacity}</span></h2>
        ${s.signups.length ? `<table class="list roster"><thead><tr><th>Name</th>${group.question_label ? `<th>${esc(group.question_label)}</th>` : ''}${s.kind === 'item' ? '<th>Bringing</th>' : ''}<th>Mobile</th><th class="hide-sm">Email</th><th class="hide-sm">Comments</th><th></th></tr></thead><tbody>
          ${s.signups.map(g => `<tr>
            <td>${esc(g.first_name)} ${esc(g.last_name)}</td>
            ${group.question_label ? `<td>${esc(g.answer)}</td>` : ''}
            ${s.kind === 'item' ? `<td><strong>${esc(g.item_desc)}</strong>${dietLabels(g.dietary).map(d => `<span class="diet">${esc(d)}</span>`).join('')}</td>` : ''}
            <td><a href="tel:${esc(g.mobile.replace(/\s/g, ''))}">${esc(g.mobile)}</a></td>
            <td class="hide-sm"><a href="mailto:${esc(g.email)}">${esc(g.email)}</a></td>
            <td class="hide-sm">${esc(g.comments)}</td>
            <td style="text-align:right"><button class="btn danger small" data-rm="${g.id}">Remove</button></td>
          </tr>`).join('')}</tbody></table>` : '<p class="muted small">Nobody yet.</p>'}`).join('')}`;
    $('#addvol').onclick = () => addVolunteerModal();
    $$('[data-rm]').forEach(b => b.onclick = async () => {
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Confirm'; setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Remove'; }, 4000); return; }
      try { const { event } = await call(A + '/signups/' + b.dataset.rm, { method: 'DELETE' }); toast('Volunteer removed.'); showEditor(event); }
      catch (err) { toast(err.message, 'bad'); }
    });
  }

  /* ---------------- Modals ---------------- */
  function modal(html, onReady) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const close = () => (root.innerHTML = '');
    $('.modal-backdrop', root).addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
    $$('[data-close]', root).forEach(b => b.onclick = close);
    onReady && onReady($('.modal', root), close);
  }

  function runModal() {
    const shiftsOnly = current.slots.filter(s => s.kind !== 'item');
    const last = shiftsOnly[shiftsOnly.length - 1] || {};
    modal(`
      <h2>Add a run of shifts</h2>
      <p class="small muted">Creates back-to-back slots, e.g. BBQ from 9am to 1pm in 1 hour shifts.</p>
      <label>Task</label><input type="text" id="r-title" value="${esc(last.title || '')}" placeholder="e.g. BBQ cooking">
      <label>Task details <span class="opt">(optional)</span></label><textarea id="r-details">${esc(last.details || '')}</textarea>
      <div class="row"><div><label>Date</label><input type="date" id="r-date" value="${esc(last.date || '')}"></div>
        <div><label>People per shift</label><input type="number" id="r-cap" min="1" value="${esc(last.capacity || 2)}"></div></div>
      <div class="row"><div><label>From</label><input type="time" id="r-from" value="09:00" step="300"></div>
        <div><label>To</label><input type="time" id="r-to" value="13:00" step="300"></div></div>
      <label>Shift length</label>
      <select id="r-len"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select>
      <div id="r-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="r-go">Add shifts</button></div>`,
    (m, close) => {
      $('#r-go', m).onclick = () => {
        const title = $('#r-title', m).value.trim(), date = $('#r-date', m).value;
        const from = toMin($('#r-from', m).value), to = toMin($('#r-to', m).value), len = +$('#r-len', m).value;
        if (!title || !date || to <= from) { $('#r-err', m).innerHTML = '<div class="error">Please enter a task, a date, and a "To" time after "From".</div>'; return; }
        // drop a blank starter slot if that's all there is
        dropBlankStarter();
        for (let t = from; t < to; t += len) {
          current.slots.push({ title, details: $('#r-details', m).value, date, start_time: fromMin(t), end_time: fromMin(Math.min(t + len, to)), capacity: +$('#r-cap', m).value || 1, signups: [] });
        }
        close(); markDirty(); renderSlots();
      };
    });
  }

  function addVolunteerModal() {
    modal(`
      <h2>Add a volunteer</h2>
      <label>Slot</label>
      <select id="v-slot">${current.slots.map(s => `<option value="${s.id}" data-kind="${s.kind || 'shift'}">${s.kind === 'item' ? 'Bring: ' + esc(s.title) : `${esc(fmtDateShort(s.date))} ${fmtTime(s.start_time)}, ${esc(s.title)}`} (${s.signups.length}/${s.capacity})</option>`).join('')}</select>
      <div id="v-item" class="hidden">
        <label>Bringing</label><input type="text" id="v-desc" placeholder="e.g. Chicken curry">
        <div class="diet-choices">${Object.entries(DIET).map(([c, l]) => `<label class="chip"><input type="checkbox" value="${c}"> ${l}</label>`).join('')}</div>
      </div>
      <div class="row"><div><label>First name</label><input type="text" id="v-first"></div><div><label>Last name</label><input type="text" id="v-last"></div></div>
      <label>Email</label><input type="email" id="v-email">
      <label>Mobile</label><input type="tel" id="v-mobile" placeholder="0412 345 678">
      ${group.question_label ? `<label>${esc(group.question_label)}</label><input type="text" id="v-answer">` : ''}
      <label>Comments <span class="opt">(optional)</span></label><input type="text" id="v-comments">
      <label class="check" style="margin-top:14px"><input type="checkbox" id="v-send" checked> Email them a confirmation</label>
      <p class="small muted">Admins can add people even when a slot is full.</p>
      <div id="v-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="v-go">Add volunteer</button></div>`,
    (m, close) => {
      const syncKind = () => $('#v-item', m).classList.toggle('hidden', $('#v-slot', m).selectedOptions[0]?.dataset.kind !== 'item');
      $('#v-slot', m).onchange = syncKind; syncKind();
      $('#v-go', m).onclick = async () => {
        try {
          const { event } = await call(A + '/signups', { method: 'POST', body: {
            slot_id: +$('#v-slot', m).value, first_name: $('#v-first', m).value, last_name: $('#v-last', m).value,
            email: $('#v-email', m).value, mobile: $('#v-mobile', m).value, comments: $('#v-comments', m).value, send_email: $('#v-send', m).checked, answer: $('#v-answer', m)?.value || '',
            item_desc: $('#v-desc', m).value, dietary: $$('#v-item input:checked', m).map(c => c.value) } });
          close(); toast('Volunteer added.'); showEditor(event);
        } catch (err) { $('#v-err', m).innerHTML = `<div class="error">${esc(err.message)}</div>`; }
      };
    });
  }

  function duplicateModal(ev) {
    modal(`
      <h2>Duplicate event</h2>
      <p class="small muted">Copies the details and all slots (not the volunteers). The copy starts as a draft.</p>
      <label>New event name</label><input type="text" id="d-title" value="${esc(ev.title)}">
      <label>Date of the first slot (or drop-off)</label><input type="date" id="d-date" value="${esc(ev.slots[0]?.date || '')}">
      <p class="small muted">All slots move by the same number of days, so multi-day events stay in order.</p>
      <div id="d-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="d-go">Duplicate</button></div>`,
    (m, close) => {
      $('#d-go', m).onclick = async () => {
        try {
          const { event } = await call(`${A}/events/${ev.id}/duplicate`, { method: 'POST', body: { title: $('#d-title', m).value, new_date: $('#d-date', m).value } });
          close(); toast('Copy created as a draft.'); tab = 'setup'; location.hash = 'event/' + event.id;
        } catch (err) { $('#d-err', m).innerHTML = `<div class="error">${esc(err.message)}</div>`; }
      };
    });
  }

  async function emailModal(ev) {
    let status;
    try { status = await call(A + '/status'); } catch { return; }
    const people = new Set(ev.slots.flatMap(s => s.signups.map(g => g.email.toLowerCase())));
    modal(`
      <h2>Email volunteers</h2>
      <label>Send to</label>
      <select id="m-to"><option value="">Everyone signed up (${people.size} ${people.size === 1 ? 'person' : 'people'})</option>
        ${ev.slots.filter(s => s.signups.length).map(s => `<option value="${s.id}">Only: ${s.kind === 'item' ? 'Bring: ' + esc(s.title) : `${esc(fmtDateShort(s.date))} ${fmtTime(s.start_time)}, ${esc(s.title)}`} (${s.signups.length})</option>`).join('')}</select>
      <label>Subject</label><input type="text" id="m-subj" value="${esc(ev.title)}: update">
      <label>Message</label><textarea id="m-msg" style="min-height:160px" placeholder="Each email starts with 'Hi [first name],' automatically."></textarea>
      <p class="small muted">${status.remaining_24h} emails left today (limit ${status.daily_limit}). Extras wait in the queue and send automatically within the next day.${ev.contact_email ? ` Replies go to ${esc(ev.contact_email)}.` : ''}</p>
      <div id="m-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="m-go" ${people.size ? '' : 'disabled'}>Send</button></div>`,
    (m, close) => {
      $('#m-go', m).onclick = async () => {
        const slot = $('#m-to', m).value;
        try {
          const r = await call(`${A}/events/${ev.id}/email`, { method: 'POST', body: { subject: $('#m-subj', m).value, message: $('#m-msg', m).value, slot_ids: slot ? [+slot] : [] } });
          close(); toast(`Email queued for ${r.queued} ${r.queued === 1 ? 'person' : 'people'}.`);
        } catch (err) { $('#m-err', m).innerHTML = `<div class="error">${esc(err.message)}</div>`; }
      };
    });
  }

  function deleteModal(ev) {
    const n = ev.slots.reduce((a, s) => a + s.signups.length, 0);
    modal(`
      <h2>Delete "${esc(ev.title)}"?</h2>
      <p>This permanently removes the event, its ${ev.slots.length} slot(s)${n ? ` and <strong>${n} volunteer sign-up(s)</strong>` : ''}. Volunteers are not emailed.</p>
      ${n ? '<p class="small muted">Tip: print the sign-in sheet first if you want a record.</p>' : ''}
      <div class="actions"><button class="btn secondary" data-close>Keep it</button><button class="btn danger confirm" id="x-go">Delete</button></div>`,
    (m, close) => {
      $('#x-go', m).onclick = async () => {
        try { await call(A + '/events/' + ev.id, { method: 'DELETE' }); close(); dirty = false; toast('Event deleted.'); location.hash = ''; }
        catch (err) { toast(err.message, 'bad'); }
      };
    });
  }

  function printSignIn(ev) {
    // One row per volunteer (matched by email), listing every slot or item they signed up for
    const people = new Map();
    for (const s of ev.slots) {
      for (const g of s.signups) {
        const key = g.email.toLowerCase();
        if (!people.has(key)) people.set(key, { first: g.first_name, last: g.last_name, answer: g.answer, entries: [] });
        people.get(key).entries.push({ s, g });
      }
    }
    const rows = [...people.values()].sort((a, b) => (a.last + ' ' + a.first).localeCompare(b.last + ' ' + b.first, 'en', { sensitivity: 'base' }));
    const dates = [...new Set(ev.slots.map(s => s.date))].sort();
    const describe = ({ s, g }) => s.kind === 'item'
      ? `Bringing: ${esc(g.item_desc)} <span class="sub">(${esc(s.title)})</span>`
      : `${fmtTime(s.start_time)} to ${fmtTime(s.end_time)} <span class="sub">${esc(s.title)}${dates.length > 1 ? ', ' + esc(fmtDateShort(s.date)) : ''}</span>`;
    const logo = group.logo_url ? new URL(group.logo_url, location.href).href : '';
    const q = group.question_label;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in sheet: ${esc(ev.title)}</title>
      <style>
        @page { size: A4 portrait; margin: 14mm; }
        body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; }
        header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
        header img { height: 64px; width: auto; }
        h1 { font-size: 22px; margin: 0; }
        .meta { font-size: 13px; color: #444; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; border-bottom: 2px solid #111; padding: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
        td { border-bottom: 1px solid #999; padding: 8px 6px; vertical-align: top; }
        tr { page-break-inside: avoid; }
        td.name { width: 30%; font-weight: 600; }
        td.sign { width: 24%; }
        .slot + .slot { margin-top: 3px; }
        .sub { color: #555; }
        .empty td { height: 26px; }
        .noprint { margin: 12px 0; font-size: 14px; }
        @media print { .noprint { display: none; } }
      </style></head><body>
      <div class="noprint"><button onclick="print()">Print</button> ${rows.length} volunteer${rows.length === 1 ? '' : 's'}</div>
      <header>
        ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
        <div><h1>${esc(ev.title)}</h1>
          <div class="meta">${esc(group.name)} · Volunteer sign-in${dates.length ? ' · ' + esc(fmtRange(dates[0], dates[dates.length - 1])) : ''}${ev.location ? ' · ' + esc(ev.location) : ''}</div></div>
      </header>
      <table><thead><tr><th>Volunteer name</th>${q ? `<th>${esc(q)}</th>` : ''}<th>Time slot(s)</th><th>Sign in</th></tr></thead><tbody>
        ${rows.map(p => `<tr><td class="name">${esc(p.first)} ${esc(p.last)}</td>${q ? `<td>${esc(p.answer || '')}</td>` : ''}
          <td>${p.entries.sort((a, b) => (a.s.date + a.s.start_time).localeCompare(b.s.date + b.s.start_time)).map(e => `<div class="slot">${describe(e)}</div>`).join('')}</td>
          <td class="sign"></td></tr>`).join('')}
        ${`<tr class="empty"><td></td>${q ? '<td></td>' : ''}<td></td><td></td></tr>`.repeat(5)}
      </tbody></table>
      <script>window.onload = () => setTimeout(() => print(), 300);<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Please allow pop-ups for this site to print.', 'bad'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function copyLink(id) {
    const url = `${location.origin}/${slug}/event/${id}`;
    const done = () => toast('Link copied. Paste it into your newsletter or group chat.');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
    else window.prompt('Copy this link:', url);
  }


  /* ---------------- Header ---------------- */
  function renderHeader() {
    groupHeader(group, `<a href="/${esc(slug)}" target="_blank">View page</a>${me.groups.length > 1 || me.is_owner ? '<a href="/login?choose=1">My groups</a>' : ''}${me.is_owner ? '<a href="/owner">Owner</a>' : ''}<a href="#" id="hdr-logout">Log out</a>`);
    $('#hdr-logout').onclick = e => { e.preventDefault(); logout(); };
    document.title = `${group.name} | HelperHub organisers`;
  }

  /* ---------------- Group settings ---------------- */
  const SWATCHES = ['#2f7d6d', '#1f5f8b', '#2e4a9e', '#6b3fa0', '#b0306a', '#c0392b', '#d35400', '#b8860b', '#2e7d32', '#37474f'];
  const TZ_LABELS = { 'Australia/Sydney': 'NSW / ACT', 'Australia/Melbourne': 'Victoria', 'Australia/Brisbane': 'Queensland', 'Australia/Adelaide': 'South Australia',
    'Australia/Darwin': 'Northern Territory', 'Australia/Perth': 'Western Australia', 'Australia/Hobart': 'Tasmania', 'Pacific/Auckland': 'New Zealand' };

  function showSettings() {
    const g = { ...group };
    app.innerHTML = `
      ${groupNav('settings')}
      <h1 style="margin:0 0 6px">Group settings</h1>
      <p class="muted" style="margin:0 0 16px">Your volunteer page: <a href="/${esc(slug)}" target="_blank">helperhub.au/${esc(slug)}</a></p>
      <form id="sform" class="stack">
        <div class="card">
          <h2 style="margin-top:0">Look and feel</h2>
          <label for="s-name">Group name</label>
          <input id="s-name" type="text" maxlength="80" value="${esc(g.name)}">
          <label>Logo <span class="opt">(PNG or JPG, square-ish works best)</span></label>
          <div class="logo-box">
            <span id="logo-preview">${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="Current logo">` : '<span class="muted small">No logo yet</span>'}</span>
            <label class="btn secondary small" style="margin:0">Upload logo<input type="file" id="s-logo" accept="image/png,image/jpeg,image/webp" hidden></label>
            ${g.logo_url ? '<button type="button" class="btn link" id="s-logo-rm" style="color:var(--bad)">Remove logo</button>' : ''}
          </div>
          <label>Colour</label>
          <div class="swatches">${SWATCHES.map(c => `<button type="button" data-c="${c}" style="background:${c}" class="${c === g.accent ? 'on' : ''}" aria-label="${c}"></button>`).join('')}
            <input type="color" id="s-accent" value="${esc(g.accent)}" title="Pick any colour"></div>
          <div class="preview-bar" id="s-preview"></div>
          <label for="s-welcome">Welcome message <span class="opt">(top of your volunteer page)</span></label>
          <textarea id="s-welcome" maxlength="1000" placeholder="e.g. Thanks for helping our club! Every shift makes a difference.">${esc(g.welcome_text)}</textarea>
        </div>
        <div class="card">
          <h2 style="margin-top:0">Contact and reminders</h2>
          <div class="row">
            <div><label for="s-cn">Contact name</label><input id="s-cn" type="text" maxlength="100" value="${esc(g.contact_name)}"></div>
            <div><label for="s-ce">Contact email <span class="opt">(volunteers' replies go here)</span></label><input id="s-ce" type="email" maxlength="200" value="${esc(g.contact_email)}"></div>
          </div>
          <div class="row">
            <div><label for="s-rem">Reminder email</label>
              <select id="s-rem">${[[12, '12 hours before'], [24, '1 day before'], [48, '2 days before'], [72, '3 days before']].map(([v, l]) => `<option value="${v}" ${+g.reminder_hours === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label for="s-tz">Time zone</label>
              <select id="s-tz">${Object.entries(TZ_LABELS).map(([v, l]) => `<option value="${v}" ${g.timezone === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
        </div>
        <div class="card">
          <h2 style="margin-top:0">Sign-up form</h2>
          <label for="s-q">Extra question <span class="opt">(optional, asked once per sign-up)</span></label>
          <input id="s-q" type="text" maxlength="100" value="${esc(g.question_label)}" placeholder="e.g. Which team does your child play in?  or  Child's name and class">
          <label class="check" style="margin-top:10px"><input type="checkbox" id="s-qr" ${g.question_required ? 'checked' : ''}> Make it required</label>
          <label for="s-du">Default donation link <span class="opt">(pre-filled on new events; shows a "Donate instead" button)</span></label>
          <input id="s-du" type="url" maxlength="500" value="${esc(g.donation_url)}" placeholder="https://square.link/...">
          <label for="s-dx">Default donation message <span class="opt">(optional)</span></label>
          <input id="s-dx" type="text" maxlength="300" value="${esc(g.donation_text)}" placeholder="Can't help on the day? You're welcome to donate instead.">
        </div>
        <div id="s-err"></div>
      </form>
      <div class="actionbar show"><div class="inner"><span class="small muted" id="dirty-note">All changes saved</span><button class="btn" id="s-save">Save settings</button></div></div>`;
    bindNav();
    const preview = () => {
      $('#s-preview').style.background = g.accent;
      const light = getComputedStyle(document.documentElement).getPropertyValue('--on-accent');
      $('#s-preview').style.color = light;
      $('#s-preview').innerHTML = `${g.logo_url ? `<img src="${esc(g.logo_url)}" alt="">` : ''}<span>${esc($('#s-name').value || g.name)}</span>`;
    };
    const setAccent = c => { g.accent = c; applyAccent(c); $('#s-accent').value = c; $$('.swatches button').forEach(b => b.classList.toggle('on', b.dataset.c === c)); preview(); markDirty(); };
    $$('.swatches button').forEach(b => b.onclick = () => setAccent(b.dataset.c));
    $('#s-accent').oninput = e => setAccent(e.target.value);
    $$('#sform input, #sform textarea, #sform select').forEach(i => i.addEventListener('input', () => { markDirty(); if (i.id === 's-name') preview(); }));
    preview();
    $('#s-logo').onchange = e => uploadLogo(e.target.files[0]);
    if ($('#s-logo-rm')) $('#s-logo-rm').onclick = async () => {
      try { group = (await call(A + '/logo', { method: 'DELETE' })).group; renderHeader(); toast('Logo removed.'); showSettings(); }
      catch (err) { toast(err.message, 'bad'); }
    };
    $('#s-save').onclick = async () => {
      const btn = $('#s-save');
      btn.disabled = true;
      try {
        const r = await call(A + '/settings', { method: 'PUT', body: {
          name: $('#s-name').value, accent: g.accent, welcome_text: $('#s-welcome').value,
          contact_name: $('#s-cn').value, contact_email: $('#s-ce').value, reminder_hours: +$('#s-rem').value, timezone: $('#s-tz').value,
          question_label: $('#s-q').value, question_required: $('#s-qr').checked, donation_url: $('#s-du').value, donation_text: $('#s-dx').value,
        } });
        group = r.group; dirty = false; renderHeader(); toast('Settings saved.'); showSettings();
      } catch (err) {
        $('#s-err').innerHTML = `<div class="error">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
  }

  /** Shrink the logo in the browser (max 400px) so pages and emails stay fast */
  async function uploadLogo(file) {
    if (!file) return;
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file doesn't look like an image.")); i.src = URL.createObjectURL(file); });
      const scale = Math.min(1, 400 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // keep transparency for PNGs; use JPEG for photos to keep the size down
      let data = c.toDataURL('image/png');
      if (data.length > 350000) data = c.toDataURL('image/jpeg', 0.85);
      group = (await call(A + '/logo', { method: 'PUT', body: { data_url: data } })).group;
      renderHeader(); toast('Logo updated.');
      if (!dirty) showSettings(); else { $('#logo-preview').innerHTML = `<img src="${esc(group.logo_url)}" alt="">`; }
    } catch (err) { toast(err.message, 'bad'); }
  }

  /* ---------------- Organisers ---------------- */
  async function showOrganisers() {
    app.innerHTML = `${groupNav('organisers')}<div class="spinner"></div>`;
    bindNav();
    let list;
    try { ({ organisers: list } = await call(A + '/organisers')); }
    catch (err) { app.innerHTML = `${groupNav('organisers')}<div class="error">${esc(err.message)}</div>`; bindNav(); return; }
    app.innerHTML = `
      ${groupNav('organisers')}
      <div class="toolbar"><h1 style="margin:0">Organisers</h1><span class="spacer"></span><button class="btn" id="invite">+ Add organiser</button></div>
      <p class="muted">Organisers can create events, see volunteers' contact details and change settings. They log in with an emailed link.</p>
      <table class="list"><thead><tr><th>Name</th><th>Email</th><th class="hide-sm">Last login</th><th></th></tr></thead><tbody>
        ${list.map(o => `<tr><td>${esc(o.name || '')}${o.id === me.user.id ? ' <span class="badge">You</span>' : ''}</td><td>${esc(o.email)}</td>
          <td class="hide-sm">${o.last_login ? esc(new Date(o.last_login.replace(' ', 'T') + 'Z').toLocaleDateString('en-AU')) : '<span class="muted">Not yet</span>'}</td>
          <td class="actions">${list.length > 1 ? `<button class="btn danger small" data-rm="${o.id}">Remove</button>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    bindNav();
    $('#invite').onclick = () => modal(`
      <h2>Add an organiser</h2>
      <label>Their name</label><input type="text" id="i-name">
      <label>Their email</label><input type="email" id="i-email">
      <p class="small muted">We'll email them a link to open this group's organiser page.</p>
      <div id="i-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="i-go">Add and email them</button></div>`,
      (m, close) => {
        $('#i-go', m).onclick = async () => {
          try { await call(A + '/organisers', { method: 'POST', body: { name: $('#i-name', m).value, email: $('#i-email', m).value } }); close(); toast('Organiser added and emailed.'); showOrganisers(); }
          catch (err) { $('#i-err', m).innerHTML = `<div class="error">${esc(err.message)}</div>`; }
        };
      });
    $$('[data-rm]').forEach(b => b.onclick = async () => {
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Confirm'; setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Remove'; }, 4000); return; }
      try {
        await call(`${A}/organisers/${b.dataset.rm}`, { method: 'DELETE' });
        if (+b.dataset.rm === me.user.id) return location.replace('/login?choose=1');
        toast('Organiser removed.'); showOrganisers();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  route();
})();

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
  let organisers = null; // cached list for the alert recipient picker
  let teams = null;      // this group's teams (loaded with the group)
  const teamName = id => (teams || []).find(t => t.id === Number(id))?.name || '';
  const T = () => teamTerms(group); // what this group calls its teams
  const slotName = s => (teamName(s.team_id) ? teamName(s.team_id) + ': ' : '') + s.title;
  // close the event's "More" menu when tapping anywhere else
  document.addEventListener('click', e => { const m = $('#more-menu'); if (m && !e.target.closest('.menu-wrap')) m.classList.add('hidden'); });

  const call = (path, opts = {}) => api(path, { ...opts, auth: true }).catch(err => {
    if (err.status === 401) { session.clear(); location.replace('/login'); }
    throw err;
  });

  function logout() { session.clear(); location.replace('/login'); }

  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /** Group navigation shown on every admin screen */
  function groupNav(active) {
    return `<div class="tabs" style="margin-top:16px">
      <button data-nav="teams" class="${active === 'teams' ? 'active' : ''}">${esc(T().many)}</button>
      <button data-nav="" class="${active === 'events' ? 'active' : ''}">Events</button>
      <button data-nav="settings" class="${active === 'settings' ? 'active' : ''}">${esc(kindInfo(group).settings)}</button>
      <button data-nav="organisers" class="${active === 'organisers' ? 'active' : ''}">${esc(kindInfo(group).organisers)}</button>
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
        const [s, m, t] = await Promise.all([call(A + '/settings'), call('/api/me'), call(A + '/teams')]);
        group = s.group; me = m; teams = t.teams;
        renderHeader();
      } catch (err) {
        platformHeader('<a href="/login?choose=1">My groups</a>');
        app.innerHTML = `<div class="card" style="max-width:520px;margin:30px auto"><h1 style="margin-top:4px">Can't open this group</h1><div class="notice">${esc(err.message)}</div><a class="btn" href="/login?choose=1">My groups</a></div>`;
        return;
      }
    }
    applyAccent(group.accent); // undo any unsaved colour preview
    $('#modal-root').innerHTML = ''; // close any open dialog when the page changes
    const h = location.hash.slice(1);
    dirty = false;
    if (h === 'settings') return showSettings();
    if (h === 'organisers') return showOrganisers();
    if (h === 'teams') return showTeams();
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
    const active = events.filter(e => !e.archived), archived = events.filter(e => e.archived);
    const upcoming = active.filter(e => !e.last_date || e.last_date >= today);
    const past = active.filter(e => e.last_date && e.last_date < today);
    const rows = list => list.map(e => `
      <tr class="click" data-id="${e.id}">
        <td><strong>${esc(e.title)}</strong>${e.location ? `<div class="small muted">${esc(e.location)}</div>` : ''}</td>
        <td class="hide-sm">${esc(fmtRange(e.first_date, e.last_date)) || '<span class="muted">No slots</span>'}</td>
        <td>${e.archived ? '<span class="badge archived">Archived</span>' : e.published ? '<span class="badge">Live</span>' : '<span class="badge draft">Draft</span>'}</td>
        <td>${e.filled} / ${e.capacity}</td>
      </tr>`).join('');
    const table = (list, empty) => list.length ? `
      <table class="list"><thead><tr><th>Event</th><th class="hide-sm">Dates</th><th>Status</th><th>Filled</th></tr></thead>
      <tbody>${rows(list)}</tbody></table>` : `<p class="muted">${empty}</p>`;

    const welcome = new URLSearchParams(location.search).has('welcome');
    if (welcome) history.replaceState(null, '', location.pathname + location.hash);
    app.innerHTML = `
      ${welcome ? `<div class="success" style="margin-top:18px"><strong>Welcome to HelperHub!</strong> Your group is live at <a href="/${esc(slug)}" target="_blank">helperhub.au/${esc(slug)}</a>. Start with <a href="#settings">${esc(kindInfo(group).settings)}</a> to add your logo and colours, then create your first event.</div>` : ''}
      ${groupNav('events')}
      <div class="toolbar">
        <h1 style="margin:0">Events</h1><span class="spacer"></span>
        <button class="btn" id="new">+ New event</button>
        ${events.length ? '<button class="btn secondary" id="copymany">Copy event</button>' : ''}
      </div>
      ${emailWarningsHtml(status)}
      ${startedBar(events)}
      <h2>Upcoming and drafts</h2>${table(upcoming, 'No upcoming events yet. Create one, or duplicate a past event.')}
      ${past.length ? `<div class="toolbar" style="margin-top:22px"><h2 style="margin:0">Past</h2><span class="spacer"></span>
        <button class="btn secondary small" id="archive-past">Archive all past events</button></div>${table(past, '')}` : ''}
      ${archived.length ? `<details class="archived-list" style="margin-top:22px"><summary><h2 style="display:inline;margin:0">Archived (${archived.length})</h2></summary>
        <p class="small muted">Hidden from volunteers, with no reminders or updates. Open one to restore it.</p>${table(archived, '')}</details>` : ''}
      ${emailStatusHtml(status)}`;
    $('#new').onclick = () => go('new');
    if ($('#started-open')) $('#started-open').onclick = () => openHelp(true);
    if ($('#started-hide')) $('#started-hide').onclick = () => { try { localStorage.setItem('hh_started_hidden_' + slug, '1'); } catch { /* ignore */ } $('.started-bar').remove(); };
    maybeFirstHelp();
    if ($('#archive-past')) $('#archive-past').onclick = async () => {
      if (!window.confirm(`Archive ${past.length} past event${past.length === 1 ? '' : 's'}? They're kept and can be restored any time.`)) return;
      try { const r = await call(A + '/events/archive-past', { method: 'POST' }); toast(`${r.archived} event${r.archived === 1 ? '' : 's'} archived.`); showList(); }
      catch (err) { toast(err.message, 'bad'); }
    };
    if ($('#copymany')) $('#copymany').onclick = () => copyEventModal();
    bindNav();
    $$('tr.click').forEach(tr => tr.onclick = () => go('event/' + tr.dataset.id));
  }

  // problems worth seeing straight away stay at the top of the page
  function emailWarningsHtml(s) {
    const modeNote = s.email_provider === 'log' ? `<div class="notice">HelperHub is in <strong>test mode</strong>: emails are not being sent yet.</div>` : '';
    const failNote = s.failed_7d ? `<div class="error">${s.failed_7d} email(s) couldn't be sent in the last 7 days. If this keeps happening, contact HelperHub.</div>` : '';
    return modeNote + failNote;
  }

  // the routine email counts sit at the bottom of the events page
  function emailStatusHtml(s) {
    return `
      <div class="card small muted" style="margin-top:28px">
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
        ${saved ? (ev.archived ? '<span class="badge archived">Archived</span>' : ev.published ? '<span class="badge">Live</span>' : '<span class="badge draft">Draft</span>') : ''}
      </div>
      ${ev.archived ? `<div class="notice" style="margin-top:10px">This event is archived: volunteers can't see it and no reminders or updates are sent. <button class="btn small secondary" id="unarchive" style="margin-left:6px">Restore</button></div>` : ''}
      ${saved ? `<div class="toolbar" style="margin-top:12px">
        <button class="btn small wa" id="share">Post to a WhatsApp group</button>
        ${(ev.team_ids || []).length ? `<button class="btn secondary small" id="managers">Message ${esc(T().role)}s</button>` : ''}
        <button class="btn secondary small" id="mail">Email people signed up</button>
        <button class="btn secondary small" id="print">Print sign-in sheet</button>
        <div class="menu-wrap">
          <button class="btn secondary small" id="more" aria-haspopup="true" aria-expanded="false">More &#9662;</button>
          <div class="menu hidden" id="more-menu" role="menu">
            <button role="menuitem" id="copylink">Copy volunteer link</button>
            <a role="menuitem" href="/${esc(slug)}/event/${ev.id}" target="_blank" rel="noopener">Preview volunteer page</a>
            <button role="menuitem" id="dup">Copy event</button>
            <button role="menuitem" id="arch">${ev.archived ? 'Restore event' : 'Archive event'}</button>
            <button role="menuitem" id="del" class="bad">Delete event</button>
          </div>
        </div>
      </div>` : ''}
      ${saved ? `<div class="tabs sub">
        <button data-tab="setup" class="${tab === 'setup' ? 'active' : ''}">Details &amp; slots</button>
        <button data-tab="volunteers" class="${tab === 'volunteers' ? 'active' : ''}">Volunteers (${filled}/${cap})</button>
      </div>` : '<div style="height:12px"></div>'}
      <div id="tab-body"></div>`;
    $('#back').onclick = e => { e.preventDefault(); go(''); };
    bindNav();
    $$('[data-tab]').forEach(b => b.onclick = () => {
      if (dirty && !window.confirm('You have unsaved changes. Switch tabs without saving?')) return;
      dirty = false;
      history.replaceState(null, '', '#event/' + ev.id + (b.dataset.tab === 'volunteers' ? '/volunteers' : ''));
      tab = b.dataset.tab; showEditor(current);
    });
    if (saved) {
      const menu = $('#more-menu'), more = $('#more');
      const closeMenu = () => { menu.classList.add('hidden'); more.setAttribute('aria-expanded', 'false'); };
      more.onclick = e => {
        e.stopPropagation();
        const hidden = menu.classList.toggle('hidden');
        more.setAttribute('aria-expanded', String(!hidden));
        if (!hidden) {
          // keep the menu on screen: open to the right of the button if there isn't room on the left
          menu.style.left = ''; menu.style.right = '';
          const r = menu.getBoundingClientRect();
          if (r.left < 8) { menu.style.left = '0'; menu.style.right = 'auto'; }
          const r2 = menu.getBoundingClientRect();
          if (r2.right > window.innerWidth - 8) { menu.style.left = 'auto'; menu.style.right = '0'; }
        }
      };
      $$('#more-menu [role=menuitem]').forEach(i => i.addEventListener('click', closeMenu));
      $('#share').onclick = () => shareModal(ev);
      if ($('#managers')) $('#managers').onclick = () => managersModal(ev);
      $('#copylink').onclick = () => copyLink(ev.id);
      $('#dup').onclick = () => copyEventModal(ev.id);
      $('#print').onclick = () => printSignIn(ev);
      $('#mail').onclick = () => emailModal(ev);
      $('#del').onclick = () => deleteModal(ev);
      const setArchived = async on => {
        try {
          await call(`${A}/events/${ev.id}/archive`, { method: 'POST', body: { archived: on } });
          toast(on ? 'Event archived.' : 'Event restored.');
          if (on) go(''); else { const { event } = await call(`${A}/events/${ev.id}`); showEditor(event); }
        } catch (err) { toast(err.message, 'bad'); }
      };
      $('#arch').onclick = () => setArchived(!ev.archived);
      if ($('#unarchive')) $('#unarchive').onclick = () => setArchived(false);
    }
    if (tab === 'volunteers' && saved) renderVolunteers(); else renderSetup();
  }

  /* Cards with a heading become collapsible: tap the heading to open or close. openIndex = the one that starts open. */
  function foldCards(root, openIndex) {
    $$(':scope > .card', root).forEach((card, i) => {
      const h = card.querySelector(':scope > h2:first-child');
      if (!h) return;
      card.classList.add('fold-card');
      if (i === openIndex) card.classList.add('open');
      h.setAttribute('role', 'button'); h.tabIndex = 0;
      const toggle = () => card.classList.toggle('open');
      h.onclick = toggle;
      h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    });
  }

  /* Collapsible sections in the event editor. Open/closed is remembered while the event is open. */
  function foldHead(key, title) {
    const open = current._fold[key];
    return `<section class="fold${open ? ' open' : ''}" data-fold="${key}">
      <button type="button" class="fold-head" aria-expanded="${open}"><span class="fold-title">${title}</span><span class="fold-sum" id="sum-${key}"></span><span class="fold-chev" aria-hidden="true"></span></button>
      <div class="fold-body">`;
  }
  function bindFolds() {
    $$('section.fold > .fold-head').forEach(h => h.onclick = () => {
      const sec = h.parentElement, open = !sec.classList.contains('open');
      sec.classList.toggle('open', open); h.setAttribute('aria-expanded', open);
      current._fold[sec.dataset.fold] = open;
    });
  }
  // a short summary shown beside each heading, so a closed section still says what's in it
  function foldSummaries() {
    const ev = current, set = (k, t) => { const el = $('#sum-' + k); if (el) el.textContent = t; };
    if (!ev || !ev.rows) return;
    const n = ev.rows.filter(r => r.kind !== 'item').length, m = ev.rows.filter(r => r.kind === 'item').length;
    set('details', ev.title || '');
    set('slots', n ? `${n} slot${n === 1 ? '' : 's'}` : 'None');
    set('items', m ? `${m} item${m === 1 ? '' : 's'}` : 'None');
    const tk = (teams || []).filter(t => (ev.team_ids || []).includes(t.id));
    set('taking', tk.length ? tk.map(t => t.name).join(', ') : 'None ticked');
    if (ev._sched) {
      const d = k => schedDates(k).filter(Boolean).map(x => niceDate(x)).join(', ');
      const people = (ev._updateTo || []).length;
      set('updates', [d('gap') ? `Gaps: ${d('gap')}` : '', d('roster') ? `Roster: ${d('roster')}` : '', people ? `${people} ${people === 1 ? 'person' : 'people'}` : ''].filter(Boolean).join(' · ') || 'Off');
    }
  }

  function renderSetup() {
    const ev = current;
    if (!ev.rows) { ev.team_ids = ev.team_ids || []; ev.rows = collapseSlots(ev.slots, ev.team_ids); }
    if (!ev._fold) {
      // which sections start open: the ones with something in them (time slots open on a new event)
      const shifts = ev.rows.some(r => r.kind !== 'item'), items = ev.rows.some(r => r.kind === 'item');
      ev._fold = { details: true, taking: !!(teams && teams.length), updates: false, slots: shifts || !items, items };
    }
    $('#tab-body').innerHTML = `
      ${foldHead('details', 'Event details')}
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
        <label for="f-du">Donation link <span class="opt">(optional: shows a "Donate instead" button linking to your online donation or payment page)</span></label>
        <input id="f-du" data-k="donation_url" type="url" value="${esc(ev.donation_url || '')}" placeholder="https://...">
        <label for="f-dx">Donation message <span class="opt">(optional)</span></label>
        <input id="f-dx" data-k="donation_text" type="text" value="${esc(ev.donation_text || '')}" placeholder="Can't bring something? You're welcome to donate instead.">
      </form></div></section>
      ${teams && teams.length ? `${foldHead('taking', `${esc(T().many)} taking part`)}<div class="card" id="taking"></div></div></section>` : '<div id="taking" class="hidden"></div>'}
      ${foldHead('updates', 'Organiser updates')}<div class="card" id="alerts"></div></div></section>
      ${foldHead('slots', 'Time slots')}
      <div class="toolbar" style="margin:0 0 6px">
        <p class="small muted" style="margin:0">Each slot is one task at one time. Volunteers take the whole slot.</p><span class="spacer"></span>
        <button class="btn secondary small" id="addrun">+ Add a run of shifts</button>
        <button class="btn secondary small" id="addslot">+ Add slot</button>
      </div>
      <div id="slots" class="stack"></div></div></section>
      ${foldHead('items', 'Things to bring')}
      <div class="toolbar" style="margin:0 0 6px"><span class="spacer"></span>
        <button class="btn secondary small" id="additem">+ Add item</button>
      </div>
      <p class="small muted">Anything people can bring, e.g. "Main dish" for 6 people or "Raffle prizes". Volunteers can add details. Tick "This is food" to also ask for dietary info.</p>
      <div id="dropoff" class="card hidden" style="margin-bottom:12px">
        <div class="row">
          <div><label for="f-dd" style="margin-top:0">Drop-off date</label><input id="f-dd" data-k="dropoff_date" type="date" value="${esc(ev.dropoff_date || '')}"></div>
          <div><label for="f-dt" style="margin-top:0">Drop off by</label><input id="f-dt" data-k="dropoff_time" type="time" step="300" value="${esc(ev.dropoff_time || '')}"></div>
        </div>
        <label for="f-dn">Where <span class="opt">(optional)</span></label>
        <input id="f-dn" data-k="dropoff_note" type="text" value="${esc(ev.dropoff_note || '')}" placeholder="e.g. Main hall, side entrance">
      </div>
      <div id="items" class="stack"></div></div></section>
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
    if (!ev._sched) {
      const load = v => (v === null || v === undefined) ? { auto: true, dates: [] } : { auto: false, dates: v ? v.split(',') : [] };
      ev._sched = { gap: load(ev.gap_alerts), roster: load(ev.roster_alerts) };
      // who gets the updates: an exact list once chosen; older events keep contact + extras; new events start from the defaults
      const legacy = [ev.contact_email, ...(ev.gap_alert_emails ? ev.gap_alert_emails.split(',') : [])].filter(Boolean).map(e => e.toLowerCase());
      ev._updateTo = ev.update_to !== null && ev.update_to !== undefined ? ev.update_to.split(',').filter(Boolean) : ev.id ? [...new Set(legacy)] : null;
    }
    $('#f-ce').addEventListener('change', () => renderAlerts());
    $('#f-dd').addEventListener('input', () => renderAlerts());
    bindFolds();
    renderTaking();
    renderSlots();
    renderAlerts();
    $('#f-title').addEventListener('input', foldSummaries);
  }

  /* ---------------- Organiser updates: unfilled spots + who's doing what ---------------- */
  const SCHED = {
    gap: { title: 'Unfilled spot alerts', days: 3, what: "if any spots are still empty, with a button to share the gaps" },
    roster: { title: "Who's doing what", days: 1, what: "listing who signed up for each slot and item, with a button to share it" },
  };
  function firstDate() {
    return current.rows.map(s => s.kind === 'item' ? current.dropoff_date : s.date).filter(Boolean).sort()[0] || '';
  }
  function minusDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); }
  function niceDate(d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', ''); }
  function daysBefore(d, first) {
    const n = Math.round((Date.parse(first) - Date.parse(d)) / 86400e3);
    return n > 1 ? `${n} days before` : n === 1 ? '1 day before' : n === 0 ? 'Day of the event' : 'After the first slot';
  }
  function schedDates(kind) {
    const st = current._sched[kind], first = firstDate();
    return st.auto ? (first ? [minusDays(first, SCHED[kind].days)] : ['']) : st.dates;
  }

  function renderAlerts() {
    const ev = current, box = $('#alerts');
    if (!box || !ev._sched) return;
    const first = firstDate();
    const contact = (ev.contact_email || group.contact_email || '').toLowerCase();
    if (ev._updateTo === null && organisers !== null) ev._updateTo = organisers.filter(o => o.gets_updates).map(o => o.email.toLowerCase());
    const chosen = new Set(ev._updateTo || []);
    foldSummaries();
    // everyone who could get updates: the organisers, plus the event contact if they aren't one
    const people = (organisers || []).map(o => ({ email: o.email.toLowerCase(), label: o.name ? `${o.name} (${o.email})` : o.email, isContact: o.email.toLowerCase() === contact }));
    if (contact && !people.some(p => p.email === contact)) people.unshift({ email: contact, label: contact, isContact: true, outside: true });
    for (const e of chosen) if (!people.some(p => p.email === e)) people.push({ email: e, label: `${e} (no longer an organiser)`, gone: true });
    const fallback = contact ? esc(contact) + ' (the contact)' : 'every organiser';
    const block = kind => {
      const st = ev._sched[kind], dates = schedDates(kind), def = SCHED[kind].days;
      return `
      <h3 style="margin:14px 0 2px;font-size:16px">${SCHED[kind].title}</h3>
      <p class="small muted" style="margin:0 0 8px">Emailed at 9am on each date, ${SCHED[kind].what} in a WhatsApp group.</p>
      <div class="stack" style="gap:8px">
        ${dates.map((d, i) => `
          <div class="toolbar" style="gap:10px;flex-wrap:nowrap">
            <input type="date" data-sched="${kind}" data-i="${i}" value="${esc(d)}" style="max-width:200px">
            <span class="small muted">${st.auto ? (first ? `${def === 1 ? '1 day' : def + ' days'} before (default)` : 'Add a slot date first') : (d && first ? daysBefore(d, first) : '')}</span>
            <span class="spacer"></span>
            <button class="btn link" data-sched-rm="${kind}" data-i="${i}" style="color:var(--bad)">Remove</button>
          </div>`).join('') || '<p class="small muted" style="margin:0">None scheduled.</p>'}
      </div>
      ${dates.length < 3 ? `<button class="btn secondary small" data-sched-add="${kind}" style="margin-top:8px">+ Add a date</button>` : ''}`;
    };
    box.innerHTML = `
      <p class="small muted" style="margin:0">Emailed to the people you tick here. Use "Post to a WhatsApp group" at the top of the event to share any time.</p>
      <div style="margin-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line)">
        <div class="small" style="font-weight:600">Who gets these updates</div>
        ${organisers === null ? '<p class="small muted" style="margin:4px 0 0">Loading organisers…</p>'
          : people.map(p => `<label class="check small" style="margin:6px 0 0"><input type="checkbox" data-alert-to="${esc(p.email)}" ${chosen.has(p.email) ? 'checked' : ''}> ${esc(p.label)}${p.isContact ? ' <span class="badge">Contact</span>' : ''}</label>`).join('')}
        ${organisers !== null && !chosen.size ? `<p class="small muted" style="margin:6px 0 0">Nobody ticked, so they'll go to ${fallback}.</p>` : ''}
        ${(teams || []).length ? `<p class="small muted" style="margin:6px 0 0">${esc(T().role.charAt(0).toUpperCase() + T().role.slice(1))}s also get updates for their own ${esc(T().one.toLowerCase())}'s slots.</p>` : ''}
        <p class="small muted" style="margin:6px 0 0">Choose who's ticked for new events on the ${esc(kindInfo(group).organisers)} tab.</p>
      </div>
      ${block('gap')}
      ${block('roster')}`;
    const explicit = kind => { const st = ev._sched[kind]; if (st.auto) { st.dates = schedDates(kind).filter(Boolean); st.auto = false; } return st; };
    $$('[data-sched]', box).forEach(inp => inp.addEventListener('change', () => {
      explicit(inp.dataset.sched).dates[+inp.dataset.i] = inp.value; markDirty(); renderAlerts();
    }));
    $$('[data-sched-rm]', box).forEach(b => b.onclick = () => { explicit(b.dataset.schedRm).dates.splice(+b.dataset.i, 1); markDirty(); renderAlerts(); });
    $$('[data-sched-add]', box).forEach(b => b.onclick = () => { explicit(b.dataset.schedAdd).dates.push(''); markDirty(); renderAlerts(); });
    $$('[data-alert-to]', box).forEach(c => c.addEventListener('change', () => {
      const e = c.dataset.alertTo;
      ev._updateTo = (ev._updateTo || []).filter(x => x !== e);
      if (c.checked) ev._updateTo.push(e);
      markDirty(); renderAlerts();
    }));
    if (organisers === null) call(A + '/organisers').then(r => { organisers = r.organisers; renderAlerts(); }, () => { organisers = []; renderAlerts(); });
  }

  const tShort = x => { let [h, m] = x.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`; };
  const shortName = g => `${g.first_name} ${g.last_name ? g.last_name[0].toUpperCase() + '.' : ''}`.trim();
  let shareScope = null; // a team, when sharing just one team's slots
  const upcoming = ev => { const today = new Date().toISOString().slice(0, 10); return ev.slots.filter(s => (s.date || '') >= today && (!shareScope || Number(s.team_id) === shareScope.id)); };

  const eventUrl = ev => `${location.origin}/${slug}/event/${ev.id}${shareScope ? `?team=${shareScope.id}` : ''}`;
  const label = s => shareScope ? s.title : slotName(s);
  const slotLine = (s, n) => s.kind === 'item' ? `• ${label(s)} (to bring): ${n}` : `• ${label(s)}, ${niceDate(s.date)} ${tShort(s.start_time)} to ${tShort(s.end_time)}: ${n}`;
  const leftIn = s => s.capacity - (s.signups?.length || 0);

  // Each returns the ready-made message, or { empty: 'reason' } when there's nothing to say
  const SHARE = {
    ask: {
      label: 'Ask for helpers', hint: 'Invite people to sign up. Lists everything still needed.',
      text(ev) {
        const open = upcoming(ev).filter(s => leftIn(s) > 0);
        if (!open.length) return { empty: 'Every spot is already filled.' };
        const all = upcoming(ev);
        const shifts = all.filter(s => s.kind !== 'item');
        const dates = [...new Set(shifts.map(s => s.date))].sort();
        let when = '';
        if (dates.length === 1) {
          const day = shifts.filter(s => s.date === dates[0]);
          const start = day.map(s => s.start_time).sort()[0], end = day.map(s => s.end_time).sort().pop();
          when = `${niceDate(dates[0])}, ${tShort(start)} to ${tShort(end)}`;
        } else if (dates.length > 1) {
          when = `${niceDate(dates[0])} to ${niceDate(dates[dates.length - 1])}`;
        } else if (ev.dropoff_date) {
          when = `${niceDate(ev.dropoff_date)}, drop off by ${tShort(ev.dropoff_time)}`;
        }
        const need = open.map(s => slotLine(s, `${leftIn(s)} ${s.kind === 'item' ? 'needed' : leftIn(s) === 1 ? 'person' : 'people'}`));
        const details = [when ? `When: ${when}` : '', ev.location ? `Where: ${ev.location}` : ''].filter(Boolean).join('\n');
        return `Hi everyone,\n\nWe need some people${shareScope ? ` from ${shareScope.name}` : ''} to help with a few things to make sure ${ev.title} runs smoothly.${details ? '\n\n' + details : ''}\n\nHere's what we need:\n${need.join('\n')}\n\nIt only takes a minute to sign up: ${eventUrl(ev)}\nThank you!`;
      },
    },
    gaps: {
      label: 'Fill the gaps', hint: 'A follow-up for spots that are still empty.',
      text(ev) {
        const open = upcoming(ev).filter(s => leftIn(s) > 0);
        if (!open.length) return { empty: 'All spots are filled. Nice work!' };
        return `We still need helpers for ${shareScope ? `${shareScope.name} at ` : ''}${ev.title}!\n\n${open.map(s => slotLine(s, `${leftIn(s)} more`)).join('\n')}\n\nCan you help? Sign up here: ${eventUrl(ev)}`;
      },
    },
    roster: {
      label: "Who's doing what", hint: 'Thank everyone and show who signed up (first name and last initial).',
      text(ev) {
        const slots = upcoming(ev);
        if (!slots.some(s => s.signups?.length)) return { empty: 'Nobody has signed up yet.' };
        const shifts = slots.filter(s => s.kind !== 'item'), items = slots.filter(s => s.kind === 'item');
        const who = s => {
          const names = (s.signups || []).map(g => s.kind === 'item' && g.item_desc ? `${shortName(g)} (${g.item_desc})` : shortName(g));
          return [names.join(', '), leftIn(s) > 0 ? `${leftIn(s)} still needed` : ''].filter(Boolean).join('; ');
        };
        const parts = [`Here's who's helping ${shareScope ? `for ${shareScope.name} ` : ''}at ${ev.title}. Thank you!`];
        if (shifts.length) parts.push(shifts.map(s => `*${label(s)}*, ${niceDate(s.date)} ${tShort(s.start_time)} to ${tShort(s.end_time)}\n${who(s)}`).join('\n\n'));
        if (items.length) parts.push(`*Things to bring* (drop off by ${tShort(ev.dropoff_time)} ${niceDate(ev.dropoff_date)}${ev.dropoff_note ? ', ' + ev.dropoff_note : ''})\n` + items.map(s => `• ${label(s)}: ${who(s)}`).join('\n'));
        parts.push(slots.some(s => leftIn(s) > 0) ? `Spots still free: ${eventUrl(ev)}` : 'All spots are filled. See you there!');
        return parts.join('\n\n');
      },
    },
  };

  function shareModal(ev) {
    const filled = ev.slots.reduce((n, s) => n + (s.signups?.length || 0), 0);
    let kind = filled ? 'gaps' : 'ask';
    shareScope = null;
    const evTeams = (teams || []).filter(t => ev.slots.some(s => Number(s.team_id) === t.id));
    if (!ev.published) toast('This event is a draft. Tick "Live" and save so people can sign up.', 'bad');
    modal(`
      <h2>Post to a WhatsApp group</h2>
      <p class="small muted" style="margin-top:-6px">Pick a ready-made message, then choose which group chat to post it in.</p>
      ${evTeams.length ? `<label for="share-team" style="margin-top:0">Who is it for?</label>
      <select id="share-team"><option value="">Everyone (all ${esc(T().many.toLowerCase())})</option>${evTeams.map(t => `<option value="${t.id}">${esc(t.name)} only</option>`).join('')}</select>
      <p class="small muted" style="margin:4px 0 10px">Pick one to share just their jobs in their own chat. The link then shows only their slots (plus any for everyone).</p>` : ''}
      <div class="choice" role="radiogroup">${Object.entries(SHARE).map(([k, v]) => `
        <label class="choice-item"><input type="radio" name="share-kind" value="${k}" ${k === kind ? 'checked' : ''}>
          <span><strong>${v.label}</strong><br><span class="small muted">${v.hint}</span></span></label>`).join('')}
      </div>
      <label for="share-text">Message <span class="opt">(you can edit it)</span></label>
      <textarea id="share-text" style="min-height:190px"></textarea>
      <div id="share-empty"></div>
      <div class="actions" style="flex-wrap:wrap">
        <button class="btn secondary" id="share-copy">Copy text</button>
        <button class="btn wa" id="share-go">Open WhatsApp</button>
      </div>
      <p class="small muted" style="margin-bottom:0">WhatsApp opens with this message. Pick the group and press send. <a href="#" id="share-link">Copy the sign-up link only</a></p>`,
    (m, close) => {
      const fill = () => {
        const t = SHARE[kind].text(ev);
        $('#share-text', m).value = typeof t === 'string' ? t : '';
        $('#share-empty', m).innerHTML = typeof t === 'string' ? '' : `<div class="notice">${esc(t.empty)}</div>`;
      };
      $$('[name=share-kind]', m).forEach(r => r.onchange = () => { kind = r.value; fill(); });
      const ts = $('#share-team', m);
      if (ts) ts.onchange = () => { shareScope = evTeams.find(t => t.id === Number(ts.value)) || null; fill(); };
      fill();
      $('#share-go', m).onclick = () => {
        const text = $('#share-text', m).value.trim();
        if (!text) return;
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
        close();
      };
      $('#share-copy', m).onclick = () => {
        const text = $('#share-text', m).value;
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Message copied.'), () => {});
      };
      $('#share-link', m).onclick = e => { e.preventDefault(); copyLink(ev.id, shareScope?.id); };
    });
  }

  function markDirty() { dirty = true; const n = $('#dirty-note'); if (n) n.textContent = 'Unsaved changes'; }

  function renderSlots() {
    foldSummaries();
    const entries = current.rows.map((s, i) => ({ s, i }));
    const shifts = entries.filter(e => e.s.kind !== 'item');
    const items = entries.filter(e => e.s.kind === 'item');
    const foot = (s, n) => `
        <div class="foot">
          <span class="muted">${s.each_team ? `One for each of ${targetsOf(s).length} ${esc((targetsOf(s).length === 1 ? T().one : T().many).toLowerCase())}${n ? ` · ${n} signed up` : ''}` : n ? `${n} signed up` : ''}</span>
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
          <div><label>People${s.each_team ? ' <span class="opt">per ' + esc(T().one.toLowerCase()) + '</span>' : ''}</label><input type="number" data-k="capacity" min="${Math.max(1, s.each_team ? 1 : n)}" max="500" value="${esc(s.capacity)}"></div>
        </div>
        <textarea data-k="details" placeholder="Task details (optional): what's involved, what to bring, where to go">${esc(s.details)}</textarea>
        ${teamSelect(s)}
        <label class="check small" style="margin:8px 0 0"><input type="checkbox" data-wwcc ${s.needs_wwcc ? 'checked' : ''}> Needs a Working with Children Check</label>
        ${foot(s, n)}
      </div>`;
    }).join('') || '<p class="muted small">No time slots.</p>';
    $('#items').innerHTML = items.map(({ s, i }) => {
      const n = s.signups?.length || 0;
      return `
      <div class="slot-edit item" data-i="${i}">
        <div class="grid item-grid">
          <div><label>Item</label><input type="text" data-k="title" value="${esc(s.title)}" placeholder="e.g. Main dish"></div>
          <div><label>How many${s.each_team ? ' <span class="opt">per ' + esc(T().one.toLowerCase()) + '</span>' : ''}</label><input type="number" data-k="capacity" min="${Math.max(1, s.each_team ? 1 : n)}" max="500" value="${esc(s.capacity)}"></div>
        </div>
        <textarea data-k="details" placeholder="Details (optional), e.g. serves 8, please bring in a disposable dish">${esc(s.details)}</textarea>
        ${teamSelect(s)}
        <label class="check small" style="margin:8px 0 0"><input type="checkbox" data-food ${s.is_food ? 'checked' : ''}> This is food (ask for dietary info)</label>
        ${foot(s, n)}
      </div>`;
    }).join('');
    $('#dropoff').classList.toggle('hidden', !items.length);
    renderAlerts();
    $$('.slot-edit').forEach(el => {
      const s = current.rows[+el.dataset.i];
      $$('[data-k]', el).forEach(inp => inp.addEventListener('input', () => {
        s[inp.dataset.k] = inp.value; markDirty();
        if (inp.dataset.k === 'date') renderAlerts();
      }));
      const w = $('[data-wwcc]', el);
      if (w) w.addEventListener('change', () => { s.needs_wwcc = w.checked ? 1 : 0; markDirty(); });
      const mode = $('[data-team-mode]', el);
      if (mode) mode.addEventListener('change', () => {
        if (mode.value === 'teams') { s.each_team = true; s.for_teams = null; s.team_slot_ids = {}; s.id = undefined; }
        else { s.each_team = false; s.team_id = null; s.for_teams = null; s.team_slot_ids = {}; s.job_key = undefined; s.id = undefined; }
        markDirty(); renderSlots();
      });
      const all = $('[data-team-all]', el);
      if (all) all.addEventListener('change', () => { s.for_teams = all.checked ? null : []; markDirty(); renderSlots(); });
      $$('[data-team-one]', el).forEach(c => c.addEventListener('change', () => {
        const ids = $$('[data-team-one]', el).filter(x => x.checked).map(x => +x.value);
        s.for_teams = ids.length === takingTeams().length ? null : ids;
        markDirty(); renderSlots();
      }));
      const f = $('[data-food]', el);
      if (f) f.addEventListener('change', () => { s.is_food = f.checked ? 1 : 0; markDirty(); });
      $('[data-act=copy]', el).onclick = () => {
        current.rows.splice(+el.dataset.i + 1, 0, { ...s, id: undefined, job_key: undefined, team_slot_ids: {}, for_teams: s.for_teams ? [...s.for_teams] : null, signups: [] });
        markDirty(); renderSlots();
      };
      $('[data-act=remove]', el).onclick = () => { current.rows.splice(+el.dataset.i, 1); markDirty(); renderSlots(); };
    });
  }

  const takingTeams = () => (teams || []).filter(t => (current.team_ids || []).includes(t.id));
  // the teams a row is for: all teams taking part, or the ones picked
  const targetsOf = s => s.each_team ? takingTeams().filter(t => !s.for_teams || s.for_teams.includes(t.id)) : [];
  // options for the simple dropdown used when adding a run of shifts
  function teamOptions(s) {
    const taking = takingTeams(), lc = T().one.toLowerCase(), one = s.each_team && s.for_teams && s.for_teams.length === 1 ? s.for_teams[0] : null;
    return `<option value="">Everyone (whole event)</option>
      ${taking.length ? `<option value="each" ${s.each_team && !s.for_teams ? 'selected' : ''}>Each ${esc(lc)} taking part (${taking.length})</option>` : ''}
      ${taking.map(t => `<option value="${t.id}" ${one === t.id ? 'selected' : ''}>${esc(t.name)} only</option>`).join('')}`;
  }
  function teamChoice(v) {
    if (v === 'each') return { each_team: true, for_teams: null, team_id: null, team_slot_ids: {} };
    if (v) return { each_team: true, for_teams: [+v], team_id: null, team_slot_ids: {} };
    return { each_team: false, for_teams: null, team_id: null };
  }
  // per-row picker: everyone, or any mix of the teams taking part
  function teamSelect(s) {
    if (!teams || !teams.length) return '';
    const L = T(), taking = takingTeams(), picked = new Set(targetsOf(s).map(t => t.id));
    return `<div class="team-pick"><label class="small muted">For</label>
      <select data-team-mode><option value="">Everyone (whole event)</option><option value="teams" ${s.each_team ? 'selected' : ''}>${esc(L.many)}…</option></select></div>
      ${s.each_team ? (taking.length ? `<div class="chip-checks team-chips-edit">
        <label class="chip-check"><input type="checkbox" data-team-all ${!s.for_teams ? 'checked' : ''}> All taking part</label>
        ${taking.map(t => `<label class="chip-check"><input type="checkbox" data-team-one value="${t.id}" ${picked.has(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}
      </div>${!picked.size ? `<p class="small" style="color:var(--bad);margin:4px 0 0">Pick at least one ${esc(L.one.toLowerCase())}.</p>` : ''}`
        : `<p class="small muted" style="margin:4px 0 0">Tick the ${esc(L.many.toLowerCase())} taking part above first.</p>`) : ''}`;
  }
  // rows for the editor: the copies of an "each team" job show as one row
  // rows for the editor: the copies of a job for several teams show as one row
  function collapseSlots(slots, teamIds) {
    const rows = [], byKey = {};
    for (const sl of slots || []) {
      if (sl.team_id) {
        const key = sl.job_key || 'one-' + sl.id;
        let r = byKey[key];
        if (!r) { r = byKey[key] = { ...sl, id: undefined, team_id: null, each_team: true, team_slot_ids: {}, signups: [], job_key: sl.job_key || undefined }; rows.push(r); }
        r.team_slot_ids[sl.team_id] = sl.id;
        r.signups = r.signups.concat(sl.signups || []);
      } else rows.push({ ...sl });
    }
    // a job for every team taking part stays "all" (so newly ticked teams get it too); otherwise it's the teams picked
    const taking = new Set(teamIds || []);
    for (const r of rows) if (r.each_team) {
      const ids = Object.keys(r.team_slot_ids).map(Number);
      r.for_teams = taking.size && ids.length === taking.size && ids.every(i => taking.has(i)) && ids.length > 1 ? null : ids;
    }
    return rows;
  }
  function renderTaking() {
    foldSummaries();
    const box = $('#taking');
    if (!box) return;
    if (!teams || !teams.length) { box.classList.add('hidden'); return; }
    const L = T(), chosen = new Set(current.team_ids || []);
    box.classList.remove('hidden');
    box.innerHTML = `
      <p class="small muted" style="margin:0 0 10px">Tick the ${esc(L.many.toLowerCase())} at this event. Jobs set to "Each ${esc(L.one.toLowerCase())} taking part" are created for every ticked one.</p>
      <div class="chip-checks">${teams.map(t => `<label class="chip-check"><input type="checkbox" value="${t.id}" ${chosen.has(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>
      <p class="small" style="margin:10px 0 0"><a href="#" id="taking-all">Tick all</a> · <a href="#" id="taking-none">Clear</a></p>`;
    const update = () => { current.team_ids = $$('#taking input:checked').map(c => +c.value); markDirty(); renderSlots(); };
    $$('#taking input').forEach(c => c.onchange = update);
    $('#taking-all').onclick = e => { e.preventDefault(); $$('#taking input').forEach(c => { c.checked = true; }); update(); };
    $('#taking-none').onclick = e => { e.preventDefault(); $$('#taking input').forEach(c => { c.checked = false; }); update(); };
  }

  function dropBlankStarter() {
    // a brand-new event starts with one empty time slot; drop it if unused
    const only = current.rows.length === 1 && current.rows[0];
    if (only && only.kind !== 'item' && !only.id && !only.title && !only.date) current.rows = [];
  }

  function addItem() {
    dropBlankStarter();
    current.rows.push({ kind: 'item', title: '', details: '', capacity: 4, is_food: 0, signups: [] });
    markDirty(); renderSlots();
    const els = $$('#items .slot-edit'); const last = els[els.length - 1];
    last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('input', last).focus();
  }

  function addSlot() {
    const shiftsOnly = current.rows.filter(s => s.kind !== 'item');
    const last = shiftsOnly[shiftsOnly.length - 1];
    let next = { title: '', details: '', date: '', start_time: '09:00', end_time: '10:00', capacity: 2, signups: [] };
    if (last) {
      // continue straight after the previous slot, same length
      const mins = toMin(last.end_time) - toMin(last.start_time);
      next = { ...next, title: last.title, details: last.details, date: last.date, capacity: last.capacity, needs_wwcc: last.needs_wwcc ? 1 : 0,
        each_team: !!last.each_team, for_teams: last.for_teams ? [...last.for_teams] : null, team_id: null, team_slot_ids: {},
        start_time: last.end_time, end_time: fromMin(Math.min(toMin(last.end_time) + (mins > 0 ? mins : 60), 23 * 60 + 55)) };
    }
    current.rows.push(next);
    markDirty(); renderSlots();
    const els = $$('#slots .slot-edit'); els[els.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  async function save() {
    const btn = $('#save');
    $('#save-err').innerHTML = '';
    btn.disabled = true; btn.textContent = 'Saving…';
    const { _sched, _updateTo, ...rest } = current;
    const sched = k => (!_sched || _sched[k].auto) ? null : _sched[k].dates.filter(Boolean);
    const { rows, team_ids, slots: _concrete, ...rest2 } = rest;
    const body = { ...rest2, team_ids: team_ids || [], slots: rows.map(({ signups, start_utc, event_id, sort_order, ...s }) => s),
      gap_alerts: sched('gap'), roster_alerts: sched('roster'), gap_alert_emails: [], update_to: _updateTo || [] };
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
  function wwccCell(g, s) {
    if (!g.wwcc_number) return '<span class="badge draft">Not given</span>';
    const exp = g.wwcc_expiry;
    const today = new Date().toISOString().slice(0, 10);
    const flag = !exp ? '' : exp < today ? '<span class="badge draft" style="color:var(--bad)">Expired</span>'
      : exp < s.date ? '<span class="badge draft" style="color:var(--bad)">Expires before slot</span>' : '';
    return `${esc(g.wwcc_number)}${exp ? `<div class="small muted">Expires ${esc(new Date(exp + 'T12:00:00').toLocaleDateString('en-AU'))}</div>` : ''}${flag}`;
  }
  const slotLabel = s => s.kind === 'item'
    ? `Bring: ${esc(slotName(s))}`
    : `${esc(fmtDateShort(s.date))}, ${fmtTime(s.start_time)} to ${fmtTime(s.end_time)} · ${esc(slotName(s))}`;
  function renderVolunteers() {
    const ev = current;
    $('#tab-body').innerHTML = `
      <div class="toolbar"><span class="muted small">Contact details are only visible to admins.</span><span class="spacer"></span>
        <button class="btn small" id="addvol">+ Add volunteer</button></div>
      ${ev.slots.map(s => `
        <h2 style="font-size:17px">${slotLabel(s)}
          <span class="badge ${s.signups.length >= s.capacity ? 'full' : ''}" style="margin-left:6px">${s.signups.length}/${s.capacity}</span></h2>
        ${s.signups.length ? `<table class="list roster"><thead><tr><th>Name</th>${group.question_label ? `<th>${esc(group.question_label)}</th>` : ''}${s.kind === 'item' ? '<th>Bringing</th>' : ''}${s.needs_wwcc ? '<th>WWCC</th>' : ''}<th>Mobile</th><th class="hide-sm">Email</th><th class="hide-sm">Comments</th><th></th></tr></thead><tbody>
          ${s.signups.map(g => `<tr>
            <td>${esc(g.first_name)} ${esc(g.last_name)}</td>
            ${group.question_label ? `<td>${esc(g.answer)}</td>` : ''}
            ${s.needs_wwcc ? `<td>${wwccCell(g, s)}</td>` : ''}
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
    const shiftsOnly = current.rows.filter(s => s.kind !== 'item');
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
      ${teams && teams.length ? `<label>${esc(T().one)}</label><select id="r-team">${teamOptions(last)}</select>` : ''}
      <label class="check" style="margin-top:14px"><input type="checkbox" id="r-wwcc" ${last.needs_wwcc ? 'checked' : ''}> Needs a Working with Children Check</label>
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
          current.rows.push({ title, details: $('#r-details', m).value, date, start_time: fromMin(t), end_time: fromMin(Math.min(t + len, to)), capacity: +$('#r-cap', m).value || 1, needs_wwcc: $('#r-wwcc', m).checked ? 1 : 0, ...teamChoice($('#r-team', m)?.value || ''), signups: [] });
        }
        close(); markDirty(); renderSlots();
      };
    });
  }

  function addVolunteerModal() {
    modal(`
      <h2>Add a volunteer</h2>
      <label>Slot</label>
      <select id="v-slot">${current.slots.map(s => `<option value="${s.id}" data-kind="${s.kind || 'shift'}" data-food="${s.is_food ? 1 : 0}" data-wwcc="${s.needs_wwcc ? 1 : 0}">${s.kind === 'item' ? 'Bring: ' + esc(slotName(s)) : `${esc(fmtDateShort(s.date))} ${fmtTime(s.start_time)}, ${esc(slotName(s))}`} (${s.signups.length}/${s.capacity})</option>`).join('')}</select>
      <div id="v-item" class="hidden">
        <label>Bringing <span class="opt">(optional)</span></label><input type="text" id="v-desc" placeholder="Details, if any">
        <div class="diet-choices" id="v-diet">${Object.entries(DIET).map(([c, l]) => `<label class="chip"><input type="checkbox" value="${c}"> ${l}</label>`).join('')}</div>
      </div>
      <div class="row"><div><label>First name</label><input type="text" id="v-first"></div><div><label>Last name</label><input type="text" id="v-last"></div></div>
      <label>Email</label><input type="email" id="v-email">
      <label>Mobile</label><input type="tel" id="v-mobile" placeholder="0412 345 678">
      <div id="v-wwcc" class="hidden"><div class="row">
        <div><label>WWCC number <span class="opt">(optional here)</span></label><input type="text" id="v-wn"></div>
        <div><label>Expiry date</label><input type="date" id="v-we"></div></div></div>
      ${group.question_label ? `<label>${esc(group.question_label)}</label><input type="text" id="v-answer">` : ''}
      <label>Comments <span class="opt">(optional)</span></label><input type="text" id="v-comments">
      <label class="check" style="margin-top:14px"><input type="checkbox" id="v-send" checked> Email them a confirmation</label>
      <p class="small muted">Admins can add people even when a slot is full.</p>
      <div id="v-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="v-go">Add volunteer</button></div>`,
    (m, close) => {
      const syncKind = () => {
        const o = $('#v-slot', m).selectedOptions[0];
        $('#v-item', m).classList.toggle('hidden', o?.dataset.kind !== 'item');
        $('#v-diet', m).classList.toggle('hidden', o?.dataset.food !== '1');
        $('#v-wwcc', m).classList.toggle('hidden', o?.dataset.wwcc !== '1');
      };
      $('#v-slot', m).onchange = syncKind; syncKind();
      $('#v-go', m).onclick = async () => {
        try {
          const { event } = await call(A + '/signups', { method: 'POST', body: {
            slot_id: +$('#v-slot', m).value, first_name: $('#v-first', m).value, last_name: $('#v-last', m).value,
            email: $('#v-email', m).value, mobile: $('#v-mobile', m).value, comments: $('#v-comments', m).value, send_email: $('#v-send', m).checked, answer: $('#v-answer', m)?.value || '', wwcc_number: $('#v-wn', m).value, wwcc_expiry: $('#v-we', m).value,
            item_desc: $('#v-desc', m).value, dietary: $('#v-slot', m).selectedOptions[0]?.dataset.food === '1' ? $$('#v-item input:checked', m).map(c => c.value) : [] } });
          close(); toast('Volunteer added.'); showEditor(event);
        } catch (err) { $('#v-err', m).innerHTML = `<div class="error">${esc(err.message)}</div>`; }
      };
    });
  }


  /* ---------------- Message team managers ---------------- */
  function managersModal(ev) {
    const L = T(), today = new Date().toISOString().slice(0, 10), lc = L.one.toLowerCase();
    const taking = (teams || []).filter(t => (ev.team_ids || []).includes(t.id));
    const withEmail = taking.filter(t => t.manager_email), without = taking.filter(t => !t.manager_email);
    const url = id => `${location.origin}/${slug}/event/${ev.id}${id ? `?team=${id}` : ''}`;
    const role = L.role, roles = role + 's';
    const future = ev.slots.filter(s => (s.date || '') >= today);
    const mineOf = t => future.filter(s => Number(s.team_id) === t.id);
    const at = s => s.kind === 'item' ? `${s.title} (to bring)` : `${s.title} ${tShort(s.start_time)}`;
    const name = g => `${g.first_name} ${g.last_name ? g.last_name[0].toUpperCase() + '.' : ''}`.trim();

    // when and where, for the message text
    const dates = [...new Set(ev.slots.map(s => s.kind === 'item' ? ev.dropoff_date : s.date).filter(Boolean))].sort();
    const shifts = ev.slots.filter(s => s.kind !== 'item');
    let when = dates.length > 1 ? `${niceDate(dates[0])} to ${niceDate(dates[dates.length - 1])}` : dates[0] ? niceDate(dates[0]) : 'coming up';
    if (dates.length === 1 && shifts.length) when += `, ${tShort(shifts.map(s => s.start_time).sort()[0])} to ${tShort(shifts.map(s => s.end_time).sort().pop())}`;
    const where = ev.location ? ` at ${ev.location}` : '';
    const daysAway = dates[0] ? Math.round((Date.parse(dates[0]) - Date.parse(today)) / 86400e3) : 99;
    const soon = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : daysAway < 7 ? `this ${new Date(dates[0] + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' })}` : `on ${niceDate(dates[0] || today)}`;

    // each kind of message: subject, text, what the per-team details show (jobs / gaps / roster / none)
    const KINDS = {
      new: { label: 'New event', hint: 'First outreach when the event goes live', style: 'jobs',
        subject: `${ev.title}: volunteers needed`,
        text: `Hi everyone,\n\n${ev.title} is on ${when}${where}. Each ${lc} needs a few helpers to make sure the day runs smoothly.\n\nPlease share your ${lc}'s sign-up link with your parents as soon as you can.\n\nThank you!` },
      progress: { label: 'Progress update', hint: "What's filled and what's still needed", style: 'gaps',
        subject: `${ev.title}: volunteer update`,
        text: `Hi everyone,\n\nHere's where we're at with volunteers for ${ev.title}. Please follow up with your parents to fill any remaining spots.\n\nThank you!` },
      final: { label: 'Final reminder', hint: "A day or two before: who's helping, any gaps", style: 'roster',
        subject: `${ev.title}: final reminder`,
        text: `Hi everyone,\n\n${ev.title} is ${soon}. Here's who's helping from your ${lc}. Please check they're still good to go, and let me know about any gaps as soon as possible.\n\nThanks so much!` },
      thanks: { label: 'Thank you', hint: 'After the event', style: 'none',
        subject: `Thank you: ${ev.title}`,
        text: `Hi everyone,\n\nThank you for organising your ${lc}'s helpers for ${ev.title}. It made a big difference on the day. Please pass on our thanks to the parents who helped out.\n\nSee you next time!` },
    };
    const filled = ev.slots.reduce((n, s) => n + s.signups.length, 0);
    let kind = dates.length && dates[dates.length - 1] < today ? 'thanks' : !filled ? 'new' : daysAway <= 2 ? 'final' : 'progress';

    // the per-team lines added to the WhatsApp message
    const details = style => taking.map(t => {
      const mine = mineOf(t);
      if (!mine.length) return `• ${t.name}: no jobs yet`;
      const cap = mine.reduce((n, s) => n + s.capacity, 0), got = mine.reduce((n, s) => n + Math.min(s.capacity, s.signups.length), 0);
      const open = mine.filter(s => s.signups.length < s.capacity);
      if (style === 'jobs') return `• ${t.name}: ${mine.map(s => `${at(s)}${s.capacity > 1 ? ` x${s.capacity}` : ''}`).join(', ')}\n  ${url(t.id)}`;
      if (style === 'roster') return `• ${t.name}\n${mine.map(s => `  ${at(s)}: ${s.signups.length ? s.signups.map(name).join(', ') : 'nobody yet'}${s.signups.length < s.capacity && s.signups.length ? `, ${s.capacity - s.signups.length} still needed` : ''}`).join('\n')}${open.length ? `\n  ${url(t.id)}` : ''}`;
      return `• ${t.name}: ${got} of ${cap} filled${open.length ? `. Still need: ${open.map(at).join(', ')}` : '. All done, thank you!'}${open.length ? `\n  ${url(t.id)}` : ''}`;
    }).join('\n');

    modal(`
      <h2>Message ${esc(roles)}</h2>
      <p class="small muted" style="margin:-6px 0 8px">Email each ${esc(role)} their own ${esc(lc)}'s details, or post one update in your ${esc(roles)}' group chat.</p>
      <p class="small muted" style="margin-top:0">${withEmail.length} of ${taking.length} ${esc(L.many.toLowerCase())} taking part have an email for their ${esc(role)}${without.length ? ` (missing: ${esc(without.map(t => t.name).join(', '))}; add them on the ${esc(L.many)} tab)` : ''}.</p>
      <div class="choice" role="radiogroup" aria-label="What kind of message?">${Object.entries(KINDS).map(([k, v]) => `
        <label class="choice-item"><input type="radio" name="mm-kind" value="${k}" ${k === kind ? 'checked' : ''}>
          <span><strong>${v.label}</strong><br><span class="small muted">${v.hint}</span></span></label>`).join('')}
      </div>
      <label for="mm-subject">Subject <span class="opt">(email only)</span></label>
      <input id="mm-subject" type="text">
      <label for="mm-msg">Message <span class="opt">(you can edit it)</span></label>
      <textarea id="mm-msg" style="min-height:150px"></textarea>
      <label class="check"><input type="checkbox" id="mm-status"> <span id="mm-status-label"></span></label>
      <div id="mm-preview" class="small muted" style="white-space:pre-wrap;background:#f6f7f9;border-radius:10px;padding:10px 12px;margin-top:8px;max-height:170px;overflow:auto"></div>
      <div id="mm-err"></div>
      <div class="actions" style="flex-wrap:wrap">
        <button class="btn secondary" id="mm-copy">Copy text</button>
        <button class="btn wa" id="mm-wa">Open WhatsApp</button>
        <button class="btn" id="mm-email" ${withEmail.length ? '' : 'disabled'}>Email ${withEmail.length} ${esc(withEmail.length === 1 ? role : roles)}</button>
      </div>
      <p class="small muted" style="margin-bottom:0">WhatsApp: pick your ${esc(roles)}' group chat and press send. Email: each ${esc(role)} gets the message plus just their own ${esc(lc)}'s details, a WhatsApp button for their parents and their ${esc(lc)} page link. Replies come to you.</p>`,
    (m, close) => {
      const STATUS_LABEL = { jobs: `Include each ${lc}'s jobs and sign-up link`, gaps: `Include each ${lc}'s progress and what's still needed`, roster: `Include who's helping from each ${lc}` };
      const style = () => KINDS[kind].style;
      const text = () => {
        const msg = $('#mm-msg', m).value.trim();
        return $('#mm-status', m).checked && style() !== 'none' && taking.length ? `${msg}\n\n${details(style())}` : msg;
      };
      const preview = () => {
        const on = $('#mm-status', m).checked && style() !== 'none';
        $('#mm-preview', m).textContent = on ? details(style()) : 'No details included.';
      };
      const fill = () => {
        const k = KINDS[kind];
        $('#mm-subject', m).value = k.subject;
        $('#mm-msg', m).value = k.text;
        const st = $('#mm-status', m);
        st.checked = k.style !== 'none'; st.disabled = k.style === 'none';
        $('#mm-status-label', m).textContent = STATUS_LABEL[k.style] || 'No details for this kind of message';
        preview();
      };
      $$('[name=mm-kind]', m).forEach(r => r.onchange = () => {
        const changed = $('#mm-msg', m).value.trim() !== KINDS[kind].text.trim();
        if (changed && !window.confirm('Replace your edited message with the new template?')) { $(`[name=mm-kind][value=${kind}]`, m).checked = true; return; }
        kind = r.value; fill();
      });
      $('#mm-status', m).onchange = preview;
      fill();
      $('#mm-copy', m).onclick = () => navigator.clipboard && navigator.clipboard.writeText(text()).then(() => toast('Message copied.'), () => {});
      $('#mm-wa', m).onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent(text()), '_blank', 'noopener'); };
      $('#mm-email', m).onclick = async () => {
        const btn = $('#mm-email', m); btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const r = await call(`${A}/events/${ev.id}/managers`, { method: 'POST', body: {
            subject: $('#mm-subject', m).value, message: $('#mm-msg', m).value,
            include_status: $('#mm-status', m).checked && style() !== 'none', style: style() } });
          close(); toast(`Sent to ${r.queued} ${r.queued === 1 ? role : roles}.`);
        } catch (err) { $('#mm-err', m).innerHTML = `<div class="error">${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = 'Try again'; }
      };
    });
  }

  async function emailModal(ev) {
    let status;
    try { status = await call(A + '/status'); } catch { return; }
    const people = new Set(ev.slots.flatMap(s => s.signups.map(g => g.email.toLowerCase())));
    modal(`
      <h2>Email people signed up</h2>
      <p class="small muted" style="margin-top:-6px">Sends an email to the volunteers who've already signed up for this event.</p>
      <label>Send to</label>
      <select id="m-to"><option value="">Everyone signed up (${people.size} ${people.size === 1 ? 'person' : 'people'})</option>
        ${ev.slots.filter(s => s.signups.length).map(s => `<option value="${s.id}">Only: ${s.kind === 'item' ? 'Bring: ' + esc(slotName(s)) : `${esc(fmtDateShort(s.date))} ${fmtTime(s.start_time)}, ${esc(slotName(s))}`} (${s.signups.length})</option>`).join('')}</select>
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
      ? `Bringing: ${g.item_desc ? `${esc(g.item_desc)} <span class="sub">(${esc(slotName(s))})</span>` : esc(slotName(s))}`
      : `${fmtTime(s.start_time)} to ${fmtTime(s.end_time)} <span class="sub">${esc(slotName(s))}${dates.length > 1 ? ', ' + esc(fmtDateShort(s.date)) : ''}</span>`;
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

  function copyLink(id, teamId) {
    const url = `${location.origin}/${slug}/event/${id}${teamId ? `?team=${teamId}` : ''}`;
    const done = () => toast('Link copied. Paste it into your newsletter or group chat.');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
    else window.prompt('Copy this link:', url);
  }


  /* ---------------- Header ---------------- */
  // Help for whatever screen the organiser is on; opens by itself the first time they visit
  async function openHelp(first) {
    const h = location.hash.slice(1);
    const page = h === 'settings' ? 'settings' : h === 'organisers' ? 'organisers' : h === 'teams' ? 'teams'
      : h === 'new' ? 'editor' : /^event\/\d+\/volunteers$/.test(h) ? 'volunteers' : /^event\/\d+$/.test(h) ? (tab === 'volunteers' ? 'volunteers' : 'editor') : 'events';
    let events = [];
    try { ({ events } = await call(A + '/events')); } catch { /* help still works without the list */ }
    HHHelp.organiser({ group, teams, events, page, first, go: hash => go(hash) });
  }
  // a reminder on the Events page until the basics are done (can be hidden)
  function startedBar(events) {
    const p = HHHelp.progress({ group, events });
    let hidden = false;
    try { hidden = !!localStorage.getItem('hh_started_hidden_' + slug); } catch { /* ignore */ }
    if (p.done >= p.total || hidden) return '';
    return `<div class="started-bar">
      <div><strong>Getting started:</strong> ${p.done} of ${p.total} done</div>
      <div class="bar" style="max-width:none"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="started-open">Show me how</button>
        <button class="btn small link" id="started-hide">Hide</button>
      </div></div>`;
  }

  function maybeFirstHelp() {
    try {
      const k = 'hh_help_seen_' + slug;
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
      openHelp(true);
    } catch { /* storage blocked: skip */ }
  }

  function renderHeader() {
    groupHeader(group, `<a href="/${esc(slug)}" target="_blank">View page</a>${me.groups.length > 1 || me.is_owner ? '<a href="/login?choose=1">My groups</a>' : ''}${me.is_owner ? '<a href="/owner">Owner</a>' : ''}<a href="#" id="hdr-logout">Log out</a>`);
    $('#hdr-logout').onclick = e => { e.preventDefault(); logout(); };
    if (!$('#help-fab')) {
      document.body.insertAdjacentHTML('beforeend', '<button type="button" class="help-fab" id="help-fab" aria-label="Help and guidance"><span aria-hidden="true">?</span> Help</button>');
      $('#help-fab').onclick = () => openHelp(false);
    }
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
      <h1 style="margin:0 0 6px">${esc(kindInfo(g).settings)}</h1>
      <p class="muted" style="margin:0 0 16px">Your volunteer page: <a href="/${esc(slug)}" target="_blank">helperhub.au/${esc(slug)}</a></p>
      <form id="sform" class="stack">
        <div class="card">
          <h2 style="margin-top:0">Look and feel</h2>
          <label for="s-name">Name</label>
          <input id="s-name" type="text" maxlength="80" value="${esc(g.name)}">
          <label for="s-kind">Type of group</label>
          <select id="s-kind">${Object.entries(GROUP_KINDS).map(([k, v]) => `<option value="${k}" ${k === (g.kind || 'other') ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
          <label for="s-tl">What do you call your smaller groups?</label>
          <select id="s-tl">${Object.entries(TEAM_LABELS).map(([k, v]) => `<option value="${k}" ${k === (g.team_label || 'teams') ? 'selected' : ''}>${esc(v.many)}</option>`).join('')}</select>
          <p class="small muted" style="margin:4px 0 0">Used for the tab and wherever events are split up, e.g. teams, classes or stalls. Only matters if you use them.</p>
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
          <textarea id="s-welcome" maxlength="1000" placeholder="e.g. Thanks for helping out! Every shift makes a difference.">${esc(g.welcome_text)}</textarea>
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
          <input id="s-q" type="text" maxlength="100" value="${esc(g.question_label)}" placeholder="e.g. Which team or class are you with?">
          <label class="check" style="margin-top:10px"><input type="checkbox" id="s-qr" ${g.question_required ? 'checked' : ''}> Make it required</label>
          <label for="s-du">Default donation link <span class="opt">(pre-filled on new events; shows a "Donate instead" button)</span></label>
          <input id="s-du" type="url" maxlength="500" value="${esc(g.donation_url)}" placeholder="https://...">
          <label for="s-dx">Default donation message <span class="opt">(optional)</span></label>
          <input id="s-dx" type="text" maxlength="300" value="${esc(g.donation_text)}" placeholder="Can't help on the day? You're welcome to donate instead.">
        </div>
        <div id="s-err"></div>
      </form>
      <div class="actionbar show"><div class="inner"><span class="small muted" id="dirty-note">All changes saved</span><button class="btn" id="s-save">Save settings</button></div></div>`;
    bindNav();
    foldCards($('#sform'), 0);
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
          name: $('#s-name').value, kind: $('#s-kind').value, team_label: $('#s-tl').value, accent: g.accent, welcome_text: $('#s-welcome').value,
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
      <div class="toolbar"><h1 style="margin:0">${esc(kindInfo(group).organisers)}</h1><span class="spacer"></span><button class="btn" id="invite">+ Add organiser</button></div>
      <p class="muted">Organisers can create events, see volunteers' contact details and change settings. They log in with an emailed link. Tap a name to correct it.</p>
      <p class="muted small">Tick <strong>Updates</strong> for the people who should get unfilled spot and "who's doing what" emails on new events. You can still change who gets them on each event.</p>
      <table class="list"><thead><tr><th>Name</th><th class="hide-sm">Email</th><th title="Ticked to get updates on new events">Updates</th><th class="hide-sm">Last login</th><th></th></tr></thead><tbody>
        ${list.map(o => `<tr><td><input type="text" class="inline-edit" data-name="${o.id}" value="${esc(o.name || '')}" placeholder="Add a name" maxlength="80" aria-label="Name for ${esc(o.email)}">${o.id === me.user.id ? ' <span class="badge">You</span>' : ''}<div class="show-sm small muted">${esc(o.email)}</div></td><td class="hide-sm">${esc(o.email)}</td>
          <td><label class="check small" style="margin:0"><input type="checkbox" data-upd="${o.id}" ${o.gets_updates ? 'checked' : ''} aria-label="${esc(o.email)} gets updates on new events"> <span class="hide-sm">New events</span></label></td>
          <td class="hide-sm">${o.last_login ? esc(new Date(o.last_login.replace(' ', 'T') + 'Z').toLocaleDateString('en-AU')) : '<span class="muted">Not yet</span>'}</td>
          <td class="actions">${list.length > 1 ? `<button class="btn danger small" data-rm="${o.id}">Remove</button>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    bindNav();
    $$('[data-name]').forEach(inp => {
      let saved = inp.value;
      const save = async () => {
        const v = inp.value.trim();
        if (v === saved) return;
        try {
          await call(`${A}/organisers/${inp.dataset.name}`, { method: 'PUT', body: { name: v } });
          saved = inp.value = v; toast('Name saved.');
          if (+inp.dataset.name === me.user.id) me.user.name = v;
          organisers = null; // refresh the alert recipient list next time
        } catch (err) { toast(err.message, 'bad'); inp.value = saved; }
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = saved; inp.blur(); } });
    });
    $$('[data-upd]').forEach(c => c.onchange = async () => {
      try {
        await call(`${A}/organisers/${c.dataset.upd}`, { method: 'PUT', body: { gets_updates: c.checked } });
        toast(c.checked ? 'They\'ll be ticked for updates on new events.' : 'They won\'t be ticked for updates on new events.');
        organisers = null;
      } catch (err) { toast(err.message, 'bad'); c.checked = !c.checked; }
    });
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

  /* ---------------- Teams ---------------- */
  function showTeams() {
    let list = (teams || []).map(t => ({ ...t }));
    let labelKey = group.team_label || 'teams';
    const render = () => {
      const L = TEAM_LABELS[labelKey] || TEAM_LABELS.teams, lc = L.one.toLowerCase(), lcs = L.many.toLowerCase();
      const role = L.role.charAt(0).toUpperCase() + L.role.slice(1);
      app.innerHTML = `
        ${groupNav('teams')}
        <div class="toolbar"><h1 style="margin:0">${esc(L.many)}</h1><span class="spacer"></span>
          <button class="btn secondary small" id="t-bulk">+ Add several</button>
          <button class="btn small" id="t-add">+ Add ${esc(lc)}</button></div>
        <p class="muted">Optional, and only needed if your volunteers belong to smaller groups, such as teams, classes or stalls. Mark which slots belong to each one so parents see just theirs, and share a WhatsApp message with a single ${esc(lc)}.</p>
        <p class="muted small">Each ${esc(lc)} has a private page for its ${esc(L.role)}: their upcoming events, who's signed up, and ready-made WhatsApp messages. Use <strong>Share</strong> below each one to send it to them. If you change a ${esc(L.role)}'s email, they get a new link and the old one stops working. If you add a ${esc(L.role)}'s email, they'll also get the unfilled spot and "who's doing what" emails for their ${esc(lc)}'s slots, with the page link. They don't need a login and can't see anyone's contact details. You can change what these are called in ${esc(kindInfo(group).settings)}.</p>
        <div class="stack" id="t-list">${list.map((t, i) => `
          <div class="slot-edit" data-i="${i}">
            <div class="grid team-grid">
              <div><label>${esc(L.one)} name</label><input type="text" data-k="name" maxlength="60" value="${esc(t.name)}" placeholder="e.g. ${esc(L.ex[i % L.ex.length])}"></div>
              <div><label>${esc(role)} <span class="opt">(optional)</span></label><input type="text" data-k="manager_name" maxlength="100" value="${esc(t.manager_name || '')}" placeholder="Name"></div>
              <div><label>Their email <span class="opt">(optional)</span></label><input type="email" data-k="manager_email" maxlength="200" value="${esc(t.manager_email || '')}" placeholder="name@example.com"></div>
            </div>
            <div class="foot"><span>${t.id && t.manager_token ? `
              <button class="btn secondary small" data-mlink="${i}">Share ${esc(L.role)}'s page</button>` : '<span class="small muted">Save to get a page link</span>'}</span><span>
              <button class="btn link" data-up="${i}" ${i ? '' : 'disabled'}>Move up</button>
              <button class="btn link" data-rm="${i}" style="color:var(--bad)">Remove</button></span></div>
          </div>`).join('') || `<p class="muted">No ${esc(lcs)} yet.</p>`}</div>
        <div id="t-err"></div>
        <div class="actionbar show"><div class="inner"><span class="small muted" id="dirty-note">${dirty ? 'Unsaved changes' : 'All changes saved'}</span><button class="btn" id="t-save">Save</button></div></div>`;
      bindNav();
      $$('#t-list .slot-edit').forEach(el => {
        const t = list[+el.dataset.i];
        $$('[data-k]', el).forEach(inp => inp.addEventListener('input', () => { t[inp.dataset.k] = inp.value; markDirty(); }));
      });
      $$('[data-rm]').forEach(b => b.onclick = () => {
        const t = list[+b.dataset.rm];
        if (t.id && !window.confirm(`Remove ${t.name || 'this ' + lc}? Its slots stay in your events, just marked for everyone.`)) return;
        list.splice(+b.dataset.rm, 1); markDirty(); render();
      });
      $$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; markDirty(); render(); });
      $$('[data-mlink]').forEach(b => b.onclick = () => shareTeamPage(list[+b.dataset.mlink], L));
      $('#t-add').onclick = () => { list.push({ name: '', manager_name: '', manager_email: '' }); markDirty(); render(); const ins = $$('#t-list input[data-k=name]'); ins[ins.length - 1].focus(); };
      $('#t-bulk').onclick = () => modal(`
        <h2>Add several ${esc(lcs)}</h2>
        <label for="tb-names">One per line</label>
        <textarea id="tb-names" style="min-height:180px" placeholder="${esc(L.ex.join('\n'))}"></textarea>
        <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="tb-go">Add</button></div>`,
        (m, close) => {
          $('#tb-go', m).onclick = () => {
            const have = new Set(list.map(t => t.name.trim().toLowerCase()));
            for (const n of $('#tb-names', m).value.split('\n').map(x => x.trim()).filter(Boolean))
              if (!have.has(n.toLowerCase())) { list.push({ name: n.slice(0, 60), manager_name: '', manager_email: '' }); have.add(n.toLowerCase()); }
            close(); markDirty(); render();
          };
        });
      $('#t-save').onclick = async () => {
        const btn = $('#t-save'); btn.disabled = true; btn.textContent = 'Saving…'; $('#t-err').innerHTML = '';
        try {
          ({ teams } = await call(A + '/teams', { method: 'PUT', body: { teams: list } }));
          list = teams.map(t => ({ ...t })); dirty = false; render(); toast('Saved.');
        } catch (err) { $('#t-err').innerHTML = `<div class="error">${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = 'Save'; }
      };
    };
    render();
  }

  /* Send a team contact their private page: WhatsApp, email, the phone's own share options, or copy */
  function shareTeamPage(t, L) {
    const url = `${location.origin}/team?t=${t.manager_token}`;
    const first = (t.manager_name || '').trim().split(' ')[0];
    const text = `Hi${first ? ' ' + first : ''}, here's your ${L.role} page for ${t.name} on HelperHub. It shows your ${L.one.toLowerCase()}'s volunteer spots and who's signed up, with ready-made messages to send your parents. It's just for you, so please don't share it.\n\n${url}`;
    const subject = `Your ${L.role} page for ${t.name}`;
    modal(`
      <h2>Share ${esc(t.name)}'s ${esc(L.role)} page</h2>
      <p class="small muted" style="margin-top:-6px">Send ${esc(first || `the ${L.role}`)} their private page. It stays the same all season.</p>
      <div class="share-options">
        <button class="btn wa" data-way="wa">WhatsApp</button>
        <button class="btn secondary" data-way="email">Email${t.manager_email ? ` ${esc(first || '')}`.trimEnd() : ''}</button>
        <button class="btn secondary" data-way="sms">Text message</button>
        <button class="btn secondary" data-way="copy">Copy link</button>
        ${navigator.share ? '<button class="btn secondary" data-way="more">More options…</button>' : ''}
      </div>
      <p class="small muted" style="word-break:break-all">${esc(url)}</p>
      <div class="actions" style="margin-top:6px"><button class="btn secondary" data-close>Close</button></div>`,
    (m, close) => {
      const ways = {
        wa: () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'),
        email: () => { location.href = `mailto:${encodeURIComponent(t.manager_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`; },
        sms: () => { location.href = `sms:?&body=${encodeURIComponent(text)}`; },
        copy: () => navigator.clipboard
          ? navigator.clipboard.writeText(url).then(() => toast(`Link copied. Send it to the ${L.role} only.`), () => prompt('Copy this link', url))
          : prompt('Copy this link', url),
        more: () => navigator.share({ title: subject, text }).catch(() => {}),
      };
      $$('[data-way]', m).forEach(b => b.onclick = () => { ways[b.dataset.way](); if (b.dataset.way !== 'more') close(); });
    });
  }

  /* ---------------- Copy event: one event to a new date, with a new name ---------------- */
  async function copyEventModal(preselectId) {
    let events;
    try { ({ events } = await call(A + '/events')); } catch (err) { toast(err.message, 'bad'); return; }
    if (!events.length) return;
    const sorted = [...events].sort((a, b) => (b.first_date || '').localeCompare(a.first_date || '') || b.id - a.id);
    const L = T();
    modal(`
      <h2>Copy event</h2>
      <p class="small muted" style="margin-top:0">Makes a new event with the same details, slots and update schedule, moved to the new date. It starts as a draft. Volunteers aren't copied.</p>
      <label for="ce-src" style="margin-top:0">Event to copy</label>
      <select id="ce-src">${sorted.map(e => `<option value="${e.id}" ${e.id === preselectId ? 'selected' : ''}>${esc(e.title)}${e.first_date ? ` (${esc(fmtDateShort(e.first_date))})` : ''}</option>`).join('')}</select>
      <label for="ce-title">New event name</label>
      <input type="text" id="ce-title" maxlength="120" placeholder="e.g. Spring Fete 2027">
      <label for="ce-date">Date of the new event</label>
      <input type="date" id="ce-date">
      <p class="small muted" style="margin:4px 0 0">Every slot moves by the same number of days, so a multi-day event stays in order.</p>
      <div id="ce-teams"></div>
      <div id="ce-err"></div>
      <div class="actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="ce-go">Copy event</button></div>`,
    (m, close) => {
      let picked = [];
      const src = () => sorted.find(e => e.id === +$('#ce-src', m).value);
      const renderTeams = () => {
        const box = $('#ce-teams', m);
        if (!teams || !teams.length) { box.innerHTML = ''; return; }
        box.innerHTML = `<label>${esc(L.many)} taking part</label>
          <div class="chip-checks">${teams.map(t => `<label class="chip-check"><input type="checkbox" value="${t.id}" ${picked.includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>
          <p class="small muted" style="margin:6px 0 0">Jobs for every ${esc(L.one.toLowerCase())} are made for each one ticked. Jobs for one that's unticked are left out.</p>`;
        $$('input', box).forEach(c => c.onchange = () => { picked = $$('#ce-teams input:checked', m).map(x => +x.value); });
      };
      const pickSource = () => { picked = [...(src()?.team_ids || [])]; renderTeams(); };
      $('#ce-src', m).onchange = pickSource;
      pickSource();
      $('#ce-title', m).focus();
      $$('#ce-title, #ce-date', m).forEach(i => i.addEventListener('input', () => { $('#ce-err', m).innerHTML = ''; }));
      $('#ce-go', m).onclick = async () => {
        const title = $('#ce-title', m).value.trim(), date = $('#ce-date', m).value;
        const err = msg => { $('#ce-err', m).innerHTML = `<div class="error">${esc(msg)}</div>`; };
        if (!title) return err('Please give the new event a name.');
        if (title.toLowerCase() === (src()?.title || '').toLowerCase()) return err('Please give the new event a different name.');
        if (!date) return err('Please choose the date of the new event.');
        const btn = $('#ce-go', m); btn.disabled = true; btn.textContent = 'Copying…';
        try {
          const { event } = await call(`${A}/events/${src().id}/duplicate`, { method: 'POST', body: {
            title, new_date: date, ...(teams && teams.length ? { team_ids: picked } : {}) } });
          close(); toast('Copied as a draft. Check it, then tick "Live".'); tab = 'setup'; location.hash = 'event/' + event.id;
        } catch (e) { err(e.message); btn.disabled = false; btn.textContent = 'Copy event'; }
      };
    });
  }

  route();
})();

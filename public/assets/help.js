/* HelperHub help: plain-English guidance for organisers (admin) and team contacts (team page).
   Wording follows the group's own words (Teams/Classes/Stalls..., Club/P&C/Group...). */
(function () {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  // numbered steps; raw = items already laid out (e.g. with their own tick)
  const li = (items, raw) => `<ol class="help-steps">${items.map(i => `<li>${raw ? i : `<div>${i}</div>`}</li>`).join('')}</ol>`;
  const ul = items => `<ul class="help-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  const qa = pairs => pairs.map(([q, a]) => `<details class="help-qa"><summary>${q}</summary><div>${a}</div></details>`).join('');
  const section = (title, body, open) => `<details class="help-sec"${open ? ' open' : ''}><summary>${title}</summary><div class="help-body">${body}</div></details>`;

  function openPanel(html, onReady) {
    const root = document.getElementById('modal-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'modal-root' }));
    root.innerHTML = `<div class="modal-backdrop help-backdrop"><div class="modal help-panel" role="dialog" aria-modal="true" aria-label="Help">
      <div class="help-top"><h2 style="margin:0">Help</h2><button class="btn link" data-help-close aria-label="Close help">Close</button></div>${html}</div></div>`;
    const close = () => { root.innerHTML = ''; };
    root.querySelector('[data-help-close]').onclick = close;
    root.querySelector('.help-backdrop').addEventListener('click', e => { if (e.target.classList.contains('help-backdrop')) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    if (onReady) onReady(root, close);
  }

  /* ---------------- Organisers ---------------- */
  // ctx: { group, teams, events, page: 'events'|'editor'|'volunteers'|'teams'|'settings'|'organisers', go(hash), first }
  function organiser(ctx) {
    const L = teamTerms(ctx.group), K = kindInfo(ctx.group);
    const one = L.one.toLowerCase(), many = L.many.toLowerCase(), role = L.role, roles = L.role + 's';
    const events = ctx.events || [], teams = ctx.teams || [];
    const hasTeams = teams.length > 0;

    // Getting started, ticked off as they go
    const steps = [
      { done: !!(ctx.group.logo_url || ctx.group.welcome_text || ctx.group.contact_email), go: 'settings',
        text: `<strong>Make it yours.</strong> In <em>${K.settings}</em>, add your logo, colour, a welcome message and a contact email.` },
      { done: hasTeams, go: 'teams', optional: true,
        text: `<strong>Add your ${many}</strong> <span class="muted">(only if your helpers come from ${many})</span>. Add a ${role}'s email for each so they get updates for their ${one}.` },
      { done: events.length > 0, go: 'new',
        text: `<strong>Create an event.</strong> Give it a name and location, then add <em>time slots</em> (jobs at set times) and/or <em>things to bring</em>.` },
      { done: events.some(e => e.published), go: '',
        text: `<strong>Make it live.</strong> Tick <em>Live</em> at the top of the event and save. Until then it's a draft only organisers can see.` },
      { done: false, go: null,
        text: `<strong>Share it.</strong> Open the event and tap <em>Send message to everyone</em> for a ready-made message with the sign-up link.` },
    ];
    const started = `
      ${li(steps.map((s, i) => `<span class="help-tick ${s.done ? 'on' : ''}" aria-label="${s.done ? 'Done' : 'To do'}">${s.done ? '✓' : i + 1}</span>
        <span>${s.text}${s.go !== null && !s.done ? ` <a href="#${s.go}" data-help-go="${s.go}">Go there</a>` : ''}</span>`), true)}
      <p class="small muted">Volunteers don't need an account. They just tap the link, pick what they'll do, and give their name, email and mobile.</p>`;

    const PAGES = {
      events: {
        title: 'This page: Events',
        body: ul([
          `<strong>+ New event</strong> starts a blank event. <strong>Copy event</strong> copies one you've run before to a new date and name, which is the quickest way to set up something that repeats.`,
          `<strong>Draft</strong> means only organisers can see it. <strong>Live</strong> means volunteers can sign up.`,
          `<strong>Filled</strong> shows how many spots are taken out of how many are needed.`,
          `When an event is over, <strong>Archive</strong> it to tidy the list (from the event's <em>More</em> menu, or "Archive all past events"). Nothing is deleted.`,
        ]),
      },
      editor: {
        title: 'This page: setting up an event',
        body: `Work down the page, then press <strong>Save</strong>. Tap any heading to open or close that section.` + li([
          `<strong>Event details:</strong> name, location, description and the contact person (volunteers' replies go to them). Tick <strong>Live</strong> when you're ready for sign-ups.`,
          hasTeams ? `<strong>${L.many} taking part:</strong> tick the ${many} involved in this event.` : null,
          `<strong>Time slots:</strong> one slot is one job at one time, e.g. "BBQ, 10am to 11am, 2 people". <em>+ Add a run of shifts</em> makes back-to-back slots in one go.`,
          `<strong>Things to bring:</strong> e.g. "Slice, 6 needed" or "Raffle prizes". Tick "This is food" to ask about dietary needs.`,
          hasTeams ? `<strong>For:</strong> each slot or item can be for everyone, or for ${many}. Pick "All taking part" for jobs every ${one} does (e.g. a scorer each), or tick particular ${many}. New things to bring start as one per ${one}, so you can see which ${many} have brought theirs.` : null,
          `<strong>Organiser updates:</strong> choose who gets emails about empty spots (default 3 days before) and who's doing what (default the day before). Each email has a button to share it on WhatsApp.`,
        ].filter(Boolean)),
      },
      volunteers: {
        title: 'This page: Volunteers',
        body: ul([
          `Everyone who's signed up, by slot, with their contact details (only organisers can see these).`,
          `<strong>+ Add volunteer</strong> signs someone up for them, e.g. if they asked you in person. They'll get the confirmation email.`,
          `<strong>Remove</strong> takes someone off a slot. To let them know, use <em>Send message to everyone</em> → <em>Email people signed up</em>.`,
          `<strong>Print sign-in sheet</strong> gives you a list to tick off on the day.`,
        ]),
      },
      teams: {
        title: `This page: ${L.many}`,
        body: ul([
          `List the ${many} your helpers come from. <em>+ Add several</em> lets you paste a list, one per line.`,
          `Add each ${role}'s email so they get updates about their own ${one}'s spots. They don't need a login.`,
          `<strong>Share ${role}'s page</strong> sends them their private page by WhatsApp, email, text or a copied link. It shows their ${one}'s jobs, who's signed up, and buttons to message their parents. The link stays the same all season.`,
          `To call these something else (e.g. Classes or Stalls), change it in <em>${K.settings}</em>.`,
        ]),
      },
      settings: {
        title: `This page: ${K.settings}`,
        body: ul([
          `Your name, logo and colour appear on every page volunteers see.`,
          `The contact email is shown to volunteers and gets their replies.`,
          `<strong>Reminders</strong> go to volunteers automatically before their slot. Choose how far ahead.`,
          `Add an <strong>extra question</strong> if you need to ask every volunteer something, e.g. "Which ${one} is your child in?"`,
          `Tap a heading to open or close each section. Press <strong>Save settings</strong> when you're done.`,
        ]),
      },
      organisers: {
        title: `This page: ${K.organisers}`,
        body: ul([
          `Organisers can create events, see volunteers' contact details and change settings. Add helpers who run events with you.`,
          `They log in with a link emailed to them. There are no passwords.`,
          `Tap a name to fix its spelling.`,
          `Tick <strong>Updates</strong> for the people who should get the empty-spot and "who's doing what" emails on new events.`,
        ]),
      },
    };

    const timeline = li([
      `<strong>3 to 4 weeks before:</strong> create the event (or <em>Copy event</em>), tick <em>Live</em>, then <em>Send message to everyone</em> → <em>Ask for helpers</em>.${hasTeams ? ` Use <em>Send message to ${roles}</em> → <em>New event</em> so each ${role} asks their own parents.` : ''}`,
      `<strong>1 to 2 weeks before:</strong> check <em>Filled</em> on the Events page. Share <em>Fill the gaps</em>${hasTeams ? ` or send ${roles} a <em>Progress update</em>` : ''}.`,
      `<strong>3 days before:</strong> if spots are still empty, you'll get an email automatically with a button to share the gaps.`,
      `<strong>The day before:</strong> you'll get a "who's doing what" email. Volunteers get their own reminder automatically.${hasTeams ? ` A <em>Final reminder</em> to ${roles} helps catch last-minute gaps.` : ''}`,
      `<strong>On the day:</strong> <em>Print sign-in sheet</em>.`,
      `<strong>Afterwards:</strong> say thanks${hasTeams ? ` (<em>Send message to ${roles}</em> → <em>Thank you</em>)` : ''}, then archive the event.`,
    ]);

    const faq = qa([
      ['Someone can no longer help. What do they do?', `Their confirmation email has a link to change or cancel their sign-up. Or open the event, go to <em>Volunteers</em> and remove them.`],
      ['Can I change a slot after people have signed up?', `Yes, you can change the time, details or numbers. You can't delete a slot that still has volunteers, so remove them first.`],
      ['A volunteer says they didn\'t get an email.', `Ask them to check their junk or spam folder. You can always see who's signed up on the <em>Volunteers</em> tab.`],
      ['Who can see volunteers\' details?', `Only organisers. Everyone else, including ${roles}, only sees first names and last initials.`],
      ['How do I share the sign-up link?', `Open the event and tap <em>Send message to everyone</em>, or <em>More</em> → <em>Copy volunteer link</em> to paste it anywhere.`],
      [`Does every event need ${many}?`, `No. ${cap(many)} are optional. Without them, every slot is simply for everyone.`],
    ]);

    const page = PAGES[ctx.page] || PAGES.events;
    openPanel(`
      <p class="small muted" style="margin:4px 0 12px">Quick guidance for running volunteers with HelperHub. Tap a heading to open it.</p>
      ${section('Getting started', started, ctx.first || !events.length)}
      ${section(page.title, page.body, !ctx.first && !!events.length)}
      ${section('How a typical event runs', timeline, false)}
      ${section('Common questions', faq, false)}`,
    (root, close) => {
      root.querySelectorAll('[data-help-go]').forEach(a => a.onclick = e => { e.preventDefault(); close(); ctx.go(a.dataset.helpGo); });
    });
  }

  /* ---------------- Team contacts (team manager page) ---------------- */
  function manager(ctx) {
    const team = ctx.team, role = ctx.role, L = teamTerms(ctx.group), one = L.one.toLowerCase();
    openPanel(`
      <p class="small muted" style="margin:4px 0 12px">You're the ${role} for <strong>${esc(team)}</strong>. Your job is to help your ${one}'s parents fill your ${one}'s volunteer spots. This page does most of the work for you.</p>
      ${section('What to do, step by step', li([
        `<strong>When an event appears here:</strong> tap <em>Ask for helpers</em>. WhatsApp opens with a ready-made message and your ${one}'s sign-up link. Pick your ${one}'s chat and press send.`,
        `<strong>Check back every few days:</strong> this page always shows the latest numbers: who's signed up, and what's still needed.`,
        `<strong>If spots are still empty:</strong> tap <em>Fill the gaps</em> for a short follow-up listing just the empty jobs. A personal nudge to a parent often works best too.`,
        `<strong>The day before:</strong> tap <em>Who's doing what</em> to thank everyone and remind them who's on.`,
      ]), true)}
      ${section('Good to know', ul([
        `Parents sign up themselves with the link. They don't need an account, and they get a confirmation and a reminder by email.`,
        `This page link is just for you. Please don't share it, but do share the sign-up links.`,
        `It's the same link all season. Save it to your home screen: in your browser, tap Share, then <em>Add to Home Screen</em>.`,
        `You'll also get emails from the organisers with updates, and each one includes a link back here.`,
      ]), false)}
      ${section('Common questions', qa([
        ['A parent can\'t make it any more.', `Their confirmation email has a link to change or cancel. Then you can share <em>Fill the gaps</em> to find someone else.`],
        ['Can I sign someone up for them?', `Yes. Open the sign-up link and enter their name, email and mobile. They'll get the confirmation.`],
        ['An event is missing from this page.', `Events show here once the organisers have made them live and added your ${one}. Ask them to check.`],
        ['Who can see parents\' phone numbers and emails?', `Only the event organisers. Here you see first names and last initials.`],
      ]), false)}
      ${ctx.contact ? `<p class="small muted" style="margin-top:14px">Still stuck? Contact ${ctx.contact}.</p>` : ''}`);
  }

  // how far through Getting started a group is (the "share it" step can't be checked, so it isn't counted)
  function progress(ctx) {
    const checks = [
      !!(ctx.group.logo_url || ctx.group.welcome_text || ctx.group.contact_email),
      (ctx.events || []).length > 0,
      (ctx.events || []).some(e => e.published),
    ];
    return { done: checks.filter(Boolean).length, total: checks.length };
  }

  window.HHHelp = { organiser, manager, progress };
})();

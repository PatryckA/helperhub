/**
 * HelperHub: free volunteer sign-ups for schools, clubs and community groups.
 * One Cloudflare Worker serves the website (from /public) and the API (/api/*).
 *
 * Settings (wrangler.toml [vars]) and secrets (Cloudflare dashboard):
 *   DB                  D1 binding
 *   ASSETS              static assets binding (/public)
 *   SITE_URL            https://helperhub.au
 *   PLATFORM_NAME       HelperHub
 *   OWNER_EMAILS        comma-separated emails that can open /owner
 *   EMAIL_PROVIDER      brevo | resend | log
 *   FROM_EMAIL          e.g. hello@helperhub.au (must be verified with the provider)
 *   BREVO_API_KEY       secret (when EMAIL_PROVIDER=brevo)
 *   RESEND_API_KEY      secret (when EMAIL_PROVIDER=resend)
 *   DAILY_EMAIL_LIMIT   whole-platform cap per rolling 24h (Brevo free = 300, default 280)
 *   NEW_GROUP_EMAIL_LIMIT / GROUP_EMAIL_LIMIT  per-group daily caps (defaults 40 / 150)
 *   SESSION_SECRET      secret: long random text
 *   TURNSTILE_SITE_KEY  public key for the bot check on "create a group"
 *   TURNSTILE_SECRET    secret for the bot check
 */

const RESERVED = new Set(['api', 'assets', 'start', 'login', 'auth', 'manage', 'owner', 'privacy', 'terms', 'admin', 'help',
  'about', 'www', 'mail', 'email', 'support', 'helperhub', 'static', 'app', 'signup', 'sign-up', 'new', 'contact', 'blog',
  'index', 'home', 'dashboard', 'settings', 'account', 'favicon', 'robots', 'sitemap', 'status', 'docs', 'groups', 'events']);
const TIMEZONES = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Darwin',
  'Australia/Perth', 'Australia/Hobart', 'Pacific/Auckland'];
const DIETARY = { veg: 'Vegetarian', vegan: 'Vegan', gf: 'Gluten free', nf: 'Nut free', df: 'Dairy free' };
const MAX_SLOTS_PER_SIGNUP = 20;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, ctx, url);
      } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error(err.stack || err);
        return json({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message }, status);
      }
    }
    return site(request, env, url);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHourly(env));
  },
};

/* ================================================================== */
/* Website                                                             */
/* ================================================================== */

const PAGES = { '/': 'index.html', '/start': 'start.html', '/login': 'login.html', '/auth': 'auth.html',
  '/manage': 'manage.html', '/owner': 'owner.html', '/privacy': 'privacy.html', '/terms': 'terms.html' };

async function site(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let file = PAGES[path];
  let groupSlug = null, eventId = null;
  if (!file) {
    let m;
    if ((m = path.match(/^\/([a-z0-9-]{3,40})$/)) && !RESERVED.has(m[1])) { file = 'group.html'; groupSlug = m[1]; }
    else if ((m = path.match(/^\/([a-z0-9-]{3,40})\/event\/(\d+)$/)) && !RESERVED.has(m[1])) { file = 'event.html'; groupSlug = m[1]; eventId = +m[2]; }
    else if ((m = path.match(/^\/([a-z0-9-]{3,40})\/admin$/)) && !RESERVED.has(m[1])) { file = 'admin.html'; groupSlug = m[1]; }
  }
  let res;
  if (file) {
    res = await env.ASSETS.fetch(new Request(new URL('/' + file, url), request));
    if (groupSlug && res.ok && file !== 'admin.html') res = await withShareTags(res, env, groupSlug, eventId);
  } else {
    res = await env.ASSETS.fetch(request);
    if (res.status === 404) {
      const nf = await env.ASSETS.fetch(new Request(new URL('/404.html', url), request));
      res = new Response(nf.body, { status: 404, headers: nf.headers });
    }
  }
  res = new Response(res.body, res);
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', path === '/manage' || path === '/auth' ? 'no-referrer' : 'strict-origin-when-cross-origin');
  if (file) res.headers.set('Cache-Control', 'no-cache');
  return res;
}

/** Put the group or event name into the page title and link-preview tags (for WhatsApp, Facebook etc.) */
async function withShareTags(res, env, slug, eventId) {
  try {
    const g = await env.DB.prepare(`SELECT id, name, welcome_text, status, has_logo, logo_version FROM groups WHERE slug = ?`).bind(slug).first();
    if (!g || g.status !== 'active') return res;
    let title = `${g.name} | Volunteer sign-up`;
    let desc = g.welcome_text || `Volunteer with ${g.name}. Pick a time slot and sign up in under a minute.`;
    if (eventId) {
      const ev = await env.DB.prepare(`SELECT title, description FROM events WHERE id = ? AND group_id = ? AND published = 1`).bind(eventId, g.id).first();
      if (ev) { title = `${ev.title} | ${g.name}`; desc = ev.description || desc; }
    }
    desc = desc.replace(/\s+/g, ' ').slice(0, 200);
    const img = g.has_logo ? `${siteUrl(env)}/api/g/${slug}/logo?v=${g.logo_version}` : '';
    const tags = `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">` +
      `<meta name="description" content="${esc(desc)}">${img ? `<meta property="og:image" content="${esc(img)}">` : ''}`;
    return new HTMLRewriter()
      .on('title', { element(el) { el.setInnerContent(title); } })
      .on('head', { element(el) { el.append(tags, { html: true }); } })
      .transform(res);
  } catch (err) {
    console.error(err);
    return res;
  }
}

/* ================================================================== */
/* API routing                                                         */
/* ================================================================== */

async function api(request, env, ctx, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  let r;

  if (m === 'GET' && p === '/api/config') {
    return json({ platform_name: platformName(env), turnstile_site_key: env.TURNSTILE_SITE_KEY || '', timezones: TIMEZONES });
  }

  // New groups and login
  if (m === 'GET' && p === '/api/groups/check-slug') return checkSlug(env, url.searchParams.get('slug') || '');
  if (m === 'POST' && p === '/api/groups') return createGroup(request, env, ctx);
  if (m === 'POST' && p === '/api/auth/request') return requestLogin(request, env, ctx);
  if (m === 'POST' && p === '/api/auth/verify') return verifyLogin(request, env);
  if (m === 'GET' && p === '/api/me') { const user = await requireUser(request, env); return json(await meInfo(env, user)); }

  // Public group pages
  if ((r = p.match(/^\/api\/g\/([a-z0-9-]+)(\/.*)?$/))) {
    const slug = r[1], rest = r[2] || '';
    if (m === 'GET' && rest === '/logo') return groupLogo(env, slug);
    if (m === 'GET' && rest === '') return json({ group: publicGroup(env, await activeGroup(env, slug)) });
    if (m === 'GET' && rest === '/events') return listPublicEvents(env, await activeGroup(env, slug));
    let e;
    if (m === 'GET' && (e = rest.match(/^\/events\/(\d+)$/))) return getPublicEvent(env, await activeGroup(env, slug), +e[1]);
    if (m === 'POST' && rest === '/signups') return createSignups(request, env, ctx, await activeGroup(env, slug));
  }

  // Volunteer's private manage link
  if (m === 'GET' && (r = p.match(/^\/api\/manage\/([\w-]{20,})$/))) return getManage(env, r[1]);
  if (m === 'DELETE' && (r = p.match(/^\/api\/manage\/([\w-]{20,})\/(\d+)$/))) return cancelOwnSignup(env, r[1], +r[2]);

  // Organiser admin
  if ((r = p.match(/^\/api\/admin\/([a-z0-9-]+)(\/.*)?$/))) {
    const { user, group } = await requireOrganiser(request, env, r[1]);
    const rest = r[2] || '';
    let e;
    if (m === 'GET' && rest === '/status') return adminStatus(env, group);
    if (m === 'GET' && rest === '/settings') return json({ group: adminGroup(env, group) });
    if (m === 'PUT' && rest === '/settings') return saveSettings(request, env, group);
    if (m === 'PUT' && rest === '/logo') return saveLogo(request, env, group);
    if (m === 'DELETE' && rest === '/logo') return deleteLogo(env, group);
    if (m === 'GET' && rest === '/organisers') return listOrganisers(env, group);
    if (m === 'POST' && rest === '/organisers') return inviteOrganiser(request, env, ctx, group, user);
    if (m === 'DELETE' && (e = rest.match(/^\/organisers\/(\d+)$/))) return removeOrganiser(env, group, +e[1]);
    if (m === 'GET' && rest === '/events') return adminListEvents(env, group);
    if (m === 'POST' && rest === '/events') return adminSaveEvent(request, env, group, null);
    if ((e = rest.match(/^\/events\/(\d+)$/))) {
      if (m === 'GET') return adminGetEvent(env, group, +e[1]);
      if (m === 'PUT') return adminSaveEvent(request, env, group, +e[1]);
      if (m === 'DELETE') return adminDeleteEvent(env, group, +e[1]);
    }
    if (m === 'POST' && (e = rest.match(/^\/events\/(\d+)\/duplicate$/))) return adminDuplicate(request, env, group, +e[1]);
    if (m === 'POST' && (e = rest.match(/^\/events\/(\d+)\/email$/))) return adminEmailVolunteers(request, env, ctx, group, +e[1]);
    if (m === 'POST' && rest === '/signups') return adminAddSignup(request, env, ctx, group);
    if (m === 'DELETE' && (e = rest.match(/^\/signups\/(\d+)$/))) return adminRemoveSignup(env, group, +e[1]);
  }

  // Platform owner
  if (p.startsWith('/api/owner/')) {
    await requireOwner(request, env);
    if (m === 'GET' && p === '/api/owner/groups') return ownerGroups(env);
    if (m === 'POST' && (r = p.match(/^\/api\/owner\/groups\/(\d+)$/))) return ownerUpdateGroup(request, env, +r[1]);
    if (m === 'POST' && p === '/api/owner/process-queue') { await processQueue(env); return ownerGroups(env); }
  }

  throw httpError(404, 'Not found');
}

/* ================================================================== */
/* Groups: create, login                                               */
/* ================================================================== */

function normaliseSlug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
function slugProblem(slug) {
  if (slug.length < 3) return 'The web address needs at least 3 letters or numbers.';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return 'Use only lowercase letters, numbers and dashes.';
  if (RESERVED.has(slug)) return 'That web address is reserved. Please choose another.';
  return null;
}

async function checkSlug(env, raw) {
  const slug = normaliseSlug(raw);
  const problem = slugProblem(slug);
  if (problem) return json({ slug, available: false, reason: problem });
  const taken = await env.DB.prepare(`SELECT 1 FROM groups WHERE slug = ?`).bind(slug).first();
  return json({ slug, available: !taken, reason: taken ? 'That web address is already taken.' : '' });
}

async function createGroup(request, env, ctx) {
  const ip = clientIp(request);
  const body = await readJson(request);
  if (body.website) return json({ ok: true }); // honeypot
  await rateLimit(env, `newgroup:${ip}`, 3, 24 * 60, 'You have created several groups today. Please try again tomorrow.');
  await checkTurnstile(env, body.turnstile, ip);
  if (!body.agree) throw httpError(400, 'Please agree to the terms and privacy notice.');

  const name = req(body.name, 'Group name', 80);
  const slug = normaliseSlug(body.slug || name);
  const problem = slugProblem(slug);
  if (problem) throw httpError(400, problem);
  const kind = ['school', 'sport', 'community', 'other'].includes(body.kind) ? body.kind : 'other';
  const yourName = req(body.your_name, 'Your name', 80);
  const email = req(body.email, 'Email', 200).toLowerCase();
  if (!isEmail(email)) throw httpError(400, 'Please check your email address.');

  if (await env.DB.prepare(`SELECT 1 FROM groups WHERE slug = ?`).bind(slug).first())
    throw httpError(409, 'That web address is already taken. Please choose another.');

  const user = await upsertUser(env, email, yourName);
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?`).bind(user.id).first();
  if (n >= 5) throw httpError(400, 'This email already organises 5 groups. Please contact us if you need more.');

  const g = await env.DB.prepare(
    `INSERT INTO groups (slug, name, kind, contact_name, contact_email, created_ip) VALUES (?,?,?,?,?,?)`
  ).bind(slug, name, kind, yourName, email, ip).run();
  const groupId = g.meta.last_row_id;
  await env.DB.prepare(`INSERT INTO memberships (group_id, user_id) VALUES (?, ?)`).bind(groupId, user.id).run();

  const token = await makeLoginLink(env, user.id, groupId, 48 * 60);
  const link = `${siteUrl(env)}/auth?t=${token}`;
  await enqueue(env, {
    group_id: null, to: email, priority: 0,
    subject: `Confirm your email to start ${name} on ${platformName(env)}`,
    html: platformEmail(env, `
      <p>Hi ${esc(yourName)},</p>
      <p>Thanks for setting up <strong>${esc(name)}</strong> on ${esc(platformName(env))}. Please confirm your email to activate your group:</p>
      ${button(link, 'Confirm and open my group')}
      <p style="color:#555;font-size:14px">This link works for 48 hours. Your group's page will be <strong>${esc(siteUrl(env).replace(/^https?:\/\//, ''))}/${esc(slug)}</strong>.</p>
      <p style="color:#555;font-size:14px">Didn't ask for this? You can ignore this email and nothing will be set up.</p>`),
  });
  ctx.waitUntil(processQueue(env));
  return json({ ok: true, email, slug });
}

async function requestLogin(request, env, ctx) {
  const ip = clientIp(request);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!isEmail(email)) throw httpError(400, 'Please check your email address.');
  await rateLimit(env, `login:${ip}`, 10, 60, 'Too many attempts. Please wait an hour and try again.');
  await rateLimit(env, `login:${email}`, 5, 60, 'We have sent several links already. Please check your inbox (and junk folder).');
  let user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  if (!user && isOwnerEmail(env, email)) user = await upsertUser(env, email, '');
  const allowed = user && (isOwnerEmail(env, email) ||
    (await env.DB.prepare(`SELECT 1 FROM memberships WHERE user_id = ?`).bind(user.id).first()));
  if (allowed) {
    const token = await makeLoginLink(env, user.id, null, 30);
    await enqueue(env, {
      group_id: null, to: email, priority: 0, subject: `Your ${platformName(env)} login link`,
      html: platformEmail(env, `
        <p>Hi ${esc(user.name || 'there')},</p>
        <p>Here's your link to log in to ${esc(platformName(env))}:</p>
        ${button(`${siteUrl(env)}/auth?t=${token}`, 'Log in')}
        <p style="color:#555;font-size:14px">It works once, for 30 minutes. If you didn't ask for it, you can ignore this email.</p>`),
    });
    ctx.waitUntil(processQueue(env));
  }
  // Same answer either way, so the form can't be used to discover who has an account
  return json({ ok: true });
}

async function verifyLogin(request, env) {
  const body = await readJson(request);
  const token = String(body.token || '');
  if (token.length < 20) throw httpError(400, 'This link is not valid.');
  const hash = await sha256(token);
  const link = await env.DB.prepare(`SELECT * FROM login_links WHERE token_hash = ?`).bind(hash).first();
  if (!link) throw httpError(400, 'This link is not valid. Please request a new one.');
  if (link.used_at) throw httpError(400, 'This link has already been used. Please request a new one.');
  if (link.expires_at < new Date().toISOString()) throw httpError(400, 'This link has expired. Please request a new one.');
  const claim = await env.DB.prepare(`UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`)
    .bind(new Date().toISOString(), hash).run();
  if (!claim.meta.changes) throw httpError(400, 'This link has already been used. Please request a new one.');
  await env.DB.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).bind(link.user_id).run();
  let next = null;
  if (link.group_id) {
    const g = await env.DB.prepare(`SELECT slug, status FROM groups WHERE id = ?`).bind(link.group_id).first();
    if (g) {
      if (g.status === 'pending') await env.DB.prepare(`UPDATE groups SET status = 'active', activated_at = datetime('now') WHERE id = ?`).bind(link.group_id).run();
      next = g.slug;
    }
  }
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(link.user_id).first();
  const session = await makeSession(env, user.id);
  return json({ session, next, ...(await meInfo(env, user)) });
}

async function meInfo(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT g.slug, g.name, g.status FROM groups g JOIN memberships m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name`
  ).bind(user.id).all();
  return { user: { id: user.id, email: user.email, name: user.name }, groups: results, is_owner: isOwnerEmail(env, user.email) };
}

async function upsertUser(env, email, name) {
  let user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  if (!user) {
    const r = await env.DB.prepare(`INSERT INTO users (email, name) VALUES (?, ?)`).bind(email, name || '').run();
    user = { id: r.meta.last_row_id, email, name: name || '' };
  } else if (!user.name && name) {
    await env.DB.prepare(`UPDATE users SET name = ? WHERE id = ?`).bind(name, user.id).run();
    user.name = name;
  }
  return user;
}

async function makeLoginLink(env, userId, groupId, minutes) {
  const token = randomToken();
  await env.DB.prepare(`INSERT INTO login_links (token_hash, user_id, group_id, expires_at) VALUES (?,?,?,?)`)
    .bind(await sha256(token), userId, groupId, new Date(Date.now() + minutes * 60e3).toISOString()).run();
  return token;
}

/* ================================================================== */
/* Auth helpers                                                        */
/* ================================================================== */

async function makeSession(env, userId) {
  if (!env.SESSION_SECRET) throw httpError(500, 'Server is missing SESSION_SECRET.');
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + 30 * 86400e3 }));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function requireUser(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !env.SESSION_SECRET) throw httpError(401, 'Please log in.');
  if (!(await safeEqual(sig, await hmac(env.SESSION_SECRET, payload)))) throw httpError(401, 'Please log in.');
  let data;
  try { data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw httpError(401, 'Please log in.'); }
  if (!data.exp || data.exp < Date.now()) throw httpError(401, 'Your session has expired. Please log in again.');
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(data.uid).first();
  if (!user) throw httpError(401, 'Please log in.');
  return user;
}

async function requireOrganiser(request, env, slug) {
  const user = await requireUser(request, env);
  const group = await env.DB.prepare(`SELECT * FROM groups WHERE slug = ?`).bind(slug).first();
  if (!group) throw httpError(404, 'Group not found.');
  const member = await env.DB.prepare(`SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?`).bind(group.id, user.id).first();
  if (!member && !isOwnerEmail(env, user.email)) throw httpError(403, "You're not an organiser of this group.");
  if (group.status === 'suspended' && !isOwnerEmail(env, user.email))
    throw httpError(403, `This group has been suspended${group.suspended_reason ? ': ' + group.suspended_reason : ''}. Please contact us.`);
  return { user, group };
}

async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwnerEmail(env, user.email)) throw httpError(403, 'Owner access only.');
  return user;
}

function isOwnerEmail(env, email) {
  return (env.OWNER_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(String(email).toLowerCase());
}

async function checkTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return; // not configured (local testing)
  if (!token) throw httpError(400, 'Please complete the "are you human" check.');
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw httpError(400, 'The "are you human" check failed. Please try again.');
}

async function rateLimit(env, key, max, minutes, message) {
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at > datetime('now', ?)`)
    .bind(key, `-${minutes} minutes`).first();
  if (n >= max) throw httpError(429, message);
  await env.DB.prepare(`INSERT INTO rate_hits (key) VALUES (?)`).bind(key).run();
}

/* ================================================================== */
/* Public group pages                                                  */
/* ================================================================== */

async function activeGroup(env, slug) {
  const g = await env.DB.prepare(`SELECT * FROM groups WHERE slug = ?`).bind(slug).first();
  if (!g || g.status === 'pending') throw httpError(404, "We couldn't find that group. Check the link and try again.");
  if (g.status === 'suspended') throw httpError(410, 'This group is not available right now.');
  return g;
}

function publicGroup(env, g) {
  return {
    slug: g.slug, name: g.name, accent: g.accent, welcome_text: g.welcome_text,
    contact_name: g.contact_name, contact_email: g.contact_email,
    logo_url: g.has_logo ? `/api/g/${g.slug}/logo?v=${g.logo_version}` : '',
    question_label: g.question_label, question_required: !!g.question_required,
    reminder_hours: g.reminder_hours,
  };
}

function adminGroup(env, g) {
  return { ...publicGroup(env, g), kind: g.kind, status: g.status, timezone: g.timezone,
    donation_url: g.donation_url, donation_text: g.donation_text, created_at: g.created_at };
}

async function groupLogo(env, slug) {
  const row = await env.DB.prepare(
    `SELECT l.mime, l.data FROM group_logos l JOIN groups g ON g.id = l.group_id WHERE g.slug = ? AND g.status = 'active'`
  ).bind(slug).first();
  if (!row) return new Response('Not found', { status: 404 });
  const bin = Uint8Array.from(atob(row.data), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

async function listPublicEvents(env, group) {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(`
    SELECT e.id, e.title, e.description, e.location,
           MIN(s.date) AS first_date, MAX(s.date) AS last_date, SUM(s.capacity) AS capacity,
           (SELECT COUNT(*) FROM signups g JOIN slots s2 ON s2.id = g.slot_id WHERE s2.event_id = e.id AND s2.start_utc > ?1) AS filled
    FROM events e JOIN slots s ON s.event_id = e.id
    WHERE e.group_id = ?2 AND e.published = 1 AND s.start_utc > ?1
    GROUP BY e.id ORDER BY first_date ASC, e.id ASC`).bind(now, group.id).all();
  return json({ group: publicGroup(env, group), events: results.map(r => ({ ...r, open: Math.max(0, r.capacity - r.filled) })) });
}

async function getPublicEvent(env, group, id) {
  const ev = await env.DB.prepare(`
    SELECT id, title, description, location, contact_name, contact_email, dropoff_date, dropoff_time, dropoff_note,
           donation_url, donation_text
    FROM events WHERE id = ? AND group_id = ? AND published = 1`).bind(id, group.id).first();
  if (!ev) throw httpError(404, 'This event could not be found. It may have been removed.');
  const { results: slots } = await env.DB.prepare(
    `SELECT id, kind, title, details, date, start_time, end_time, capacity, start_utc, needs_wwcc FROM slots WHERE event_id = ? ORDER BY date, start_time, sort_order, id`
  ).bind(id).all();
  const { results: people } = await env.DB.prepare(
    `SELECT g.slot_id, g.first_name, g.last_name, g.item_desc, g.dietary FROM signups g JOIN slots s ON s.id = g.slot_id WHERE s.event_id = ? ORDER BY g.id`
  ).bind(id).all();
  const now = new Date().toISOString();
  const bySlot = {};
  for (const p of people) (bySlot[p.slot_id] ||= []).push(p);
  ev.slots = slots.map(s => {
    const list = bySlot[s.id] || [];
    const isItem = s.kind === 'item';
    return {
      id: s.id, kind: isItem ? 'item' : 'shift', title: s.title, details: s.details, date: s.date,
      start_time: s.start_time, end_time: s.end_time, capacity: s.capacity, filled: list.length,
      names: list.map(p => displayName(p.first_name, p.last_name)),
      entries: isItem ? list.map(p => ({ name: displayName(p.first_name, p.last_name), item: p.item_desc, dietary: dietaryList(p.dietary) })) : undefined,
      needs_wwcc: !isItem && !!s.needs_wwcc,
      closed: s.start_utc <= now,
    };
  });
  return json({ group: publicGroup(env, group), event: ev });
}

async function createSignups(request, env, ctx, group) {
  const ip = clientIp(request);
  const body = await readJson(request);
  if (body.website) return json({ ok: true, created: [], problems: [] }); // honeypot
  await rateLimit(env, `signup:${ip}`, 30, 60, 'Too many sign-ups from this connection. Please try again later.');
  const person = validatePerson(body);
  const answer = opt(body.answer, 200);
  if (group.question_label && group.question_required && !answer) throw httpError(400, `Please answer: ${group.question_label}`);
  const slotIds = [...new Set((body.slot_ids || []).map(Number).filter(Number.isInteger))];
  if (!slotIds.length) throw httpError(400, 'Please choose at least one slot or item.');
  if (slotIds.length > MAX_SLOTS_PER_SIGNUP) throw httpError(400, 'That is a lot of slots! Please choose fewer.');
  const itemInfo = body.items && typeof body.items === 'object' ? body.items : {};
  const wwcc = readWwcc(body); // validated only if a chosen slot needs it

  const token = randomToken();
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + group.reminder_hours * 3600e3).toISOString();
  const created = [], problems = [];

  for (const slotId of slotIds) {
    const slot = await env.DB.prepare(
      `SELECT s.*, e.published FROM slots s JOIN events e ON e.id = s.event_id WHERE s.id = ? AND e.group_id = ?`
    ).bind(slotId, group.id).first();
    if (!slot || !slot.published) { problems.push({ slot_id: slotId, reason: 'This slot no longer exists.' }); continue; }
    const isItem = slot.kind === 'item';
    const label = isItem ? `"${slot.title}"` : `${slot.title} (${fmtDate(slot.date)}, ${fmtTime(slot.start_time)})`;
    if (slot.start_utc <= now.toISOString()) { problems.push({ slot_id: slotId, reason: isItem ? `${label} is closed.` : `${label} has already started.` }); continue; }
    let item = { item_desc: '', dietary: '' };
    if (isItem) {
      try { item = validateItem(itemInfo[slotId] || itemInfo[String(slotId)], slot.title); }
      catch (err) { problems.push({ slot_id: slotId, reason: err.message }); continue; }
    }
    let check = { number: '', expiry: '' };
    if (!isItem && slot.needs_wwcc) {
      if (wwcc.error) { problems.push({ slot_id: slotId, reason: `${label} needs a Working with Children Check: ${wwcc.error}` }); continue; }
      if (wwcc.expiry < slot.date) { problems.push({ slot_id: slotId, reason: `Your Working with Children Check expires before ${label}. Please renew it, then sign up again.` }); continue; }
      check = wwcc;
    }
    const dup = await env.DB.prepare(`SELECT 1 FROM signups WHERE slot_id = ? AND lower(email) = lower(?)`).bind(slotId, person.email).first();
    if (dup) { problems.push({ slot_id: slotId, reason: `You are already signed up for ${label}.` }); continue; }
    const res = await env.DB.prepare(`
      INSERT INTO signups (slot_id, first_name, last_name, email, mobile, comments, answer, item_desc, dietary, manage_token, reminder_sent, wwcc_number, wwcc_expiry)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
      WHERE (SELECT COUNT(*) FROM signups WHERE slot_id = ?1) < (SELECT capacity FROM slots WHERE id = ?1)`)
      .bind(slotId, person.first_name, person.last_name, person.email, person.mobile, person.comments, answer,
        item.item_desc, item.dietary, token, slot.start_utc <= reminderCutoff ? 1 : 0, check.number, check.expiry).run();
    if (!res.meta.changes) { problems.push({ slot_id: slotId, reason: `Sorry, ${label} has just filled up.` }); continue; }
    created.push({ slot_id: slotId });
  }
  if (!created.length) return json({ ok: false, created, problems }, 409);
  await queueConfirmation(env, token);
  ctx.waitUntil(processQueue(env));
  return json({ ok: true, created, problems, manage_url: `${siteUrl(env)}/manage?t=${token}` });
}

async function getManage(env, token) {
  const rows = await signupsForToken(env, token);
  if (!rows.length) throw httpError(404, 'We could not find any current sign-ups for this link. They may have been cancelled.');
  const g = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(rows[0].group_id).first();
  const now = new Date().toISOString();
  return json({
    group: publicGroup(env, g),
    first_name: rows[0].first_name,
    signups: rows.map(r => ({
      id: r.id, event_id: r.event_id, event_title: r.event_title, location: r.location,
      kind: r.kind === 'item' ? 'item' : 'shift', title: r.title, details: r.details, date: r.date,
      start_time: r.start_time, end_time: r.end_time, item_desc: r.item_desc, dietary: dietaryList(r.dietary),
      dropoff_note: r.dropoff_note, can_cancel: r.start_utc > now,
    })),
  });
}

async function cancelOwnSignup(env, token, id) {
  const row = await env.DB.prepare(
    `SELECT g.id, s.start_utc FROM signups g JOIN slots s ON s.id = g.slot_id WHERE g.id = ? AND g.manage_token = ?`
  ).bind(id, token).first();
  if (!row) throw httpError(404, 'That sign-up was not found. It may already be cancelled.');
  if (row.start_utc <= new Date().toISOString()) throw httpError(400, 'This has already started, so it can no longer be cancelled online. Please contact the organiser.');
  await env.DB.prepare(`DELETE FROM signups WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

/* ================================================================== */
/* Organiser: group settings, logo, organisers                         */
/* ================================================================== */

async function adminStatus(env, group) {
  const g = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE group_id = ? AND status = 'sent' AND sent_at > datetime('now', '-1 day')`).bind(group.id).first();
  const q = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE group_id = ? AND status = 'queued'`).bind(group.id).first();
  const f = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE group_id = ? AND status = 'failed' AND created_at > datetime('now', '-7 days')`).bind(group.id).first();
  const cap = groupCap(env, group);
  return json({ email_provider: env.EMAIL_PROVIDER || 'log', sent_24h: g.n, daily_limit: cap, remaining_24h: Math.max(0, cap - g.n), queued: q.n, failed_7d: f.n });
}

async function saveSettings(request, env, group) {
  const b = await readJson(request);
  const s = {
    name: req(b.name, 'Group name', 80),
    accent: /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent.toLowerCase() : group.accent,
    welcome_text: opt(b.welcome_text, 1000),
    contact_name: opt(b.contact_name, 100),
    contact_email: opt(b.contact_email, 200).toLowerCase(),
    reminder_hours: [12, 24, 48, 72].includes(+b.reminder_hours) ? +b.reminder_hours : 24,
    timezone: TIMEZONES.includes(b.timezone) ? b.timezone : group.timezone,
    donation_url: opt(b.donation_url, 500),
    donation_text: opt(b.donation_text, 300),
    question_label: opt(b.question_label, 100),
    question_required: b.question_required && opt(b.question_label, 100) ? 1 : 0,
  };
  if (s.contact_email && !isEmail(s.contact_email)) throw httpError(400, 'Contact email does not look right.');
  if (s.donation_url && !isHttpsUrl(s.donation_url)) throw httpError(400, 'The donation link must start with https://');
  await env.DB.prepare(`UPDATE groups SET name=?, accent=?, welcome_text=?, contact_name=?, contact_email=?, reminder_hours=?, timezone=?,
    donation_url=?, donation_text=?, question_label=?, question_required=? WHERE id=?`)
    .bind(s.name, s.accent, s.welcome_text, s.contact_name, s.contact_email, s.reminder_hours, s.timezone,
      s.donation_url, s.donation_text, s.question_label, s.question_required, group.id).run();
  const g = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(group.id).first();
  return json({ group: adminGroup(env, g) });
}

async function saveLogo(request, env, group) {
  const b = await readJson(request);
  const m = String(b.data_url || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw httpError(400, 'Please upload a PNG, JPG or WebP image.');
  if (m[2].length > 400000) throw httpError(400, 'That image is too large. Please use a smaller logo.');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO group_logos (group_id, mime, data) VALUES (?,?,?) ON CONFLICT(group_id) DO UPDATE SET mime=excluded.mime, data=excluded.data`).bind(group.id, m[1], m[2]),
    env.DB.prepare(`UPDATE groups SET has_logo = 1, logo_version = logo_version + 1 WHERE id = ?`).bind(group.id),
  ]);
  const g = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(group.id).first();
  return json({ group: adminGroup(env, g) });
}

async function deleteLogo(env, group) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM group_logos WHERE group_id = ?`).bind(group.id),
    env.DB.prepare(`UPDATE groups SET has_logo = 0, logo_version = logo_version + 1 WHERE id = ?`).bind(group.id),
  ]);
  const g = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(group.id).first();
  return json({ group: adminGroup(env, g) });
}

async function listOrganisers(env, group) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.last_login, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.created_at`
  ).bind(group.id).all();
  return json({ organisers: results });
}

async function inviteOrganiser(request, env, ctx, group, inviter) {
  const b = await readJson(request);
  const email = req(b.email, 'Email', 200).toLowerCase();
  if (!isEmail(email)) throw httpError(400, 'Please check the email address.');
  const name = opt(b.name, 80);
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE group_id = ?`).bind(group.id).first();
  if (n >= 20) throw httpError(400, 'A group can have up to 20 organisers.');
  const user = await upsertUser(env, email, name);
  await env.DB.prepare(`INSERT OR IGNORE INTO memberships (group_id, user_id) VALUES (?, ?)`).bind(group.id, user.id).run();
  const token = await makeLoginLink(env, user.id, null, 7 * 24 * 60);
  await enqueue(env, {
    group_id: group.id, to: email, priority: 0, reply_to: inviter.email,
    subject: `You've been added as an organiser of ${group.name}`,
    html: groupEmail(env, group, `
      <p>Hi ${esc(name || 'there')},</p>
      <p>${esc(inviter.name || inviter.email)} has added you as an organiser of <strong>${esc(group.name)}</strong> on ${esc(platformName(env))}, so you can set up events and see who's volunteering.</p>
      ${button(`${siteUrl(env)}/auth?t=${token}`, 'Open the organiser page')}
      <p style="color:#555;font-size:14px">This link works once within 7 days. After that, log in any time at ${esc(siteUrl(env).replace(/^https?:\/\//, ''))}/login with this email address.</p>`),
  });
  ctx.waitUntil(processQueue(env));
  return listOrganisers(env, group);
}

async function removeOrganiser(env, group, userId) {
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE group_id = ?`).bind(group.id).first();
  if (n <= 1) throw httpError(400, 'A group needs at least one organiser.');
  await env.DB.prepare(`DELETE FROM memberships WHERE group_id = ? AND user_id = ?`).bind(group.id, userId).run();
  return listOrganisers(env, group);
}

/* ================================================================== */
/* Organiser: events                                                   */
/* ================================================================== */

async function adminListEvents(env, group) {
  const { results } = await env.DB.prepare(`
    SELECT e.id, e.title, e.location, e.published,
      (SELECT MIN(date) FROM slots WHERE event_id = e.id) AS first_date,
      (SELECT MAX(date) FROM slots WHERE event_id = e.id) AS last_date,
      (SELECT COALESCE(SUM(capacity),0) FROM slots WHERE event_id = e.id) AS capacity,
      (SELECT COUNT(*) FROM signups g JOIN slots s ON s.id = g.slot_id WHERE s.event_id = e.id) AS filled
    FROM events e WHERE e.group_id = ?
    ORDER BY (first_date IS NULL) DESC, first_date DESC, e.id DESC`).bind(group.id).all();
  return json({ events: results });
}

async function loadEvent(env, group, id) {
  const ev = await env.DB.prepare(`SELECT * FROM events WHERE id = ? AND group_id = ?`).bind(id, group.id).first();
  if (!ev) throw httpError(404, 'Event not found.');
  return ev;
}

async function adminGetEvent(env, group, id) {
  const ev = await loadEvent(env, group, id);
  const { results: slots } = await env.DB.prepare(`SELECT * FROM slots WHERE event_id = ? ORDER BY date, start_time, sort_order, id`).bind(id).all();
  const { results: signups } = await env.DB.prepare(
    `SELECT g.* FROM signups g JOIN slots s ON s.id = g.slot_id WHERE s.event_id = ? ORDER BY g.id`).bind(id).all();
  const bySlot = {};
  for (const g of signups) (bySlot[g.slot_id] ||= []).push(g);
  ev.slots = slots.map(s => ({ ...s, signups: bySlot[s.id] || [] }));
  return json({ event: ev });
}

async function adminSaveEvent(request, env, group, id) {
  const body = await readJson(request);
  const ev = {
    title: req(body.title, 'Event title', 120),
    description: opt(body.description, 4000),
    location: opt(body.location, 200),
    contact_name: opt(body.contact_name, 100),
    contact_email: opt(body.contact_email, 200),
    published: body.published ? 1 : 0,
    dropoff_date: opt(body.dropoff_date, 10),
    dropoff_time: opt(body.dropoff_time, 5),
    dropoff_note: opt(body.dropoff_note, 200),
    donation_url: opt(body.donation_url, 500),
    donation_text: opt(body.donation_text, 300),
  };
  if (ev.contact_email && !isEmail(ev.contact_email)) throw httpError(400, 'Contact email does not look right.');
  if (ev.donation_url && !isHttpsUrl(ev.donation_url)) throw httpError(400, 'The donation link must start with https://');
  const tz = group.timezone;
  const raw = Array.isArray(body.slots) ? body.slots : [];
  if (raw.length > 300) throw httpError(400, 'That is a lot of slots! Please split this into more than one event.');
  if (raw.some(s => s.kind === 'item')) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.dropoff_date)) throw httpError(400, 'Items to bring need a drop-off date.');
    if (!/^\d{2}:\d{2}$/.test(ev.dropoff_time)) throw httpError(400, 'Items to bring need a drop-off time.');
  }
  const slots = raw.map((s, i) => {
    const isItem = s.kind === 'item';
    const slot = {
      id: s.id ? Number(s.id) : null, kind: isItem ? 'item' : 'shift',
      title: req(s.title, isItem ? `Item ${i + 1} name` : `Slot ${i + 1} task name`, 120),
      details: opt(s.details, 2000),
      date: isItem ? ev.dropoff_date : s.date,
      start_time: isItem ? ev.dropoff_time : s.start_time,
      end_time: isItem ? ev.dropoff_time : s.end_time,
      capacity: Math.max(1, Math.min(500, parseInt(s.capacity, 10) || 1)), sort_order: i,
      needs_wwcc: !isItem && (s.needs_wwcc === true || s.needs_wwcc === 1 || s.needs_wwcc === '1') ? 1 : 0,
    };
    if (!isItem) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date || '')) throw httpError(400, `Slot ${i + 1} needs a date.`);
      if (!/^\d{2}:\d{2}$/.test(slot.start_time || '') || !/^\d{2}:\d{2}$/.test(slot.end_time || '')) throw httpError(400, `Slot ${i + 1} needs a start and end time.`);
      if (slot.end_time <= slot.start_time) throw httpError(400, `Slot ${i + 1}: end time must be after start time.`);
    }
    slot.start_utc = localToUtc(slot.date, slot.start_time, tz).toISOString();
    return slot;
  });
  if (!slots.length) throw httpError(400, 'Add at least one time slot or item.');

  const stmts = [];
  if (id === null) {
    const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE group_id = ?`).bind(group.id).first();
    if (n >= 500) throw httpError(400, 'This group has a lot of events. Please delete some old ones first.');
    const r = await env.DB.prepare(`INSERT INTO events (group_id, title, description, location, contact_name, contact_email, published,
      dropoff_date, dropoff_time, dropoff_note, donation_url, donation_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(group.id, ev.title, ev.description, ev.location, ev.contact_name, ev.contact_email, ev.published,
        ev.dropoff_date, ev.dropoff_time, ev.dropoff_note, ev.donation_url, ev.donation_text).run();
    id = r.meta.last_row_id;
  } else {
    await loadEvent(env, group, id);
    stmts.push(env.DB.prepare(`UPDATE events SET title=?, description=?, location=?, contact_name=?, contact_email=?, published=?,
      dropoff_date=?, dropoff_time=?, dropoff_note=?, donation_url=?, donation_text=? WHERE id=? AND group_id=?`)
      .bind(ev.title, ev.description, ev.location, ev.contact_name, ev.contact_email, ev.published,
        ev.dropoff_date, ev.dropoff_time, ev.dropoff_note, ev.donation_url, ev.donation_text, id, group.id));
    const { results: existing } = await env.DB.prepare(
      `SELECT s.id, s.title, (SELECT COUNT(*) FROM signups WHERE slot_id = s.id) AS n FROM slots s WHERE s.event_id = ?`).bind(id).all();
    const keep = new Set(slots.filter(s => s.id).map(s => s.id));
    for (const ex of existing) {
      if (keep.has(ex.id)) continue;
      if (ex.n > 0) throw httpError(400, `"${ex.title}" has ${ex.n} volunteer(s). Remove them first before deleting the slot.`);
      stmts.push(env.DB.prepare(`DELETE FROM slots WHERE id = ?`).bind(ex.id));
    }
    for (const s of slots.filter(s => s.id)) {
      const ex = existing.find(e => e.id === s.id);
      if (!ex) throw httpError(400, 'One of the slots no longer exists. Please reload and try again.');
      if (s.capacity < ex.n) throw httpError(400, `"${s.title}" already has ${ex.n} volunteers, so it can't need fewer than ${ex.n}.`);
    }
  }
  for (const s of slots) {
    if (s.id) stmts.push(env.DB.prepare(`UPDATE slots SET kind=?, title=?, details=?, date=?, start_time=?, end_time=?, capacity=?, start_utc=?, sort_order=?, needs_wwcc=? WHERE id=? AND event_id=?`)
      .bind(s.kind, s.title, s.details, s.date, s.start_time, s.end_time, s.capacity, s.start_utc, s.sort_order, s.needs_wwcc, s.id, id));
    else stmts.push(env.DB.prepare(`INSERT INTO slots (event_id, kind, title, details, date, start_time, end_time, capacity, start_utc, sort_order, needs_wwcc) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, s.kind, s.title, s.details, s.date, s.start_time, s.end_time, s.capacity, s.start_utc, s.sort_order, s.needs_wwcc));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return adminGetEvent(env, group, id);
}

async function adminDeleteEvent(env, group, id) {
  await loadEvent(env, group, id);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM signups WHERE slot_id IN (SELECT id FROM slots WHERE event_id = ?)`).bind(id),
    env.DB.prepare(`DELETE FROM slots WHERE event_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM events WHERE id = ? AND group_id = ?`).bind(id, group.id),
  ]);
  return json({ ok: true });
}

async function adminDuplicate(request, env, group, id) {
  const body = await readJson(request);
  const src = await loadEvent(env, group, id);
  const { results: slots } = await env.DB.prepare(`SELECT * FROM slots WHERE event_id = ? ORDER BY date, start_time, sort_order, id`).bind(id).all();
  let shift = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(body.new_date || '') && slots.length)
    shift = Math.round((Date.parse(body.new_date + 'T00:00:00Z') - Date.parse(slots[0].date + 'T00:00:00Z')) / 86400e3);
  const title = opt(body.title, 120) || `${src.title} (copy)`;
  const r = await env.DB.prepare(`INSERT INTO events (group_id, title, description, location, contact_name, contact_email, published,
    dropoff_date, dropoff_time, dropoff_note, donation_url, donation_text) VALUES (?,?,?,?,?,?,0,?,?,?,?,?)`)
    .bind(group.id, title, src.description, src.location, src.contact_name, src.contact_email,
      src.dropoff_date ? addDays(src.dropoff_date, shift) : '', src.dropoff_time, src.dropoff_note, src.donation_url, src.donation_text).run();
  const newId = r.meta.last_row_id;
  const stmts = slots.map(s => {
    const date = addDays(s.date, shift);
    return env.DB.prepare(`INSERT INTO slots (event_id, kind, title, details, date, start_time, end_time, capacity, start_utc, sort_order, needs_wwcc) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(newId, s.kind, s.title, s.details, date, s.start_time, s.end_time, s.capacity, localToUtc(date, s.start_time, group.timezone).toISOString(), s.sort_order, s.needs_wwcc || 0);
  });
  if (stmts.length) await env.DB.batch(stmts);
  return adminGetEvent(env, group, newId);
}

async function adminEmailVolunteers(request, env, ctx, group, id) {
  const body = await readJson(request);
  const subject = req(body.subject, 'Subject', 200);
  const message = req(body.message, 'Message', 10000);
  const ev = await loadEvent(env, group, id);
  const filter = Array.isArray(body.slot_ids) && body.slot_ids.length ? body.slot_ids.map(Number) : null;
  const { results } = await env.DB.prepare(`SELECT g.email, g.first_name, g.manage_token, s.id AS slot_id FROM signups g JOIN slots s ON s.id = g.slot_id WHERE s.event_id = ? ORDER BY g.id`).bind(id).all();
  const people = new Map();
  for (const r of results) if (!filter || filter.includes(r.slot_id)) if (!people.has(r.email.toLowerCase())) people.set(r.email.toLowerCase(), r);
  for (const p of people.values()) {
    await enqueue(env, {
      group_id: group.id, to: p.email, subject, reply_to: ev.contact_email || group.contact_email || null,
      html: groupEmail(env, group, `<p>Hi ${esc(p.first_name)},</p>${paragraphs(message)}
        <p style="color:#555;font-size:14px">You're receiving this because you signed up to help at <strong>${esc(ev.title)}</strong>.
        <a href="${siteUrl(env)}/manage?t=${p.manage_token}">View or change your sign-up</a>.</p>`),
    });
  }
  ctx.waitUntil(processQueue(env));
  return json({ ok: true, queued: people.size });
}

async function adminAddSignup(request, env, ctx, group) {
  const b = await readJson(request);
  const person = validatePerson(b);
  const slot = await env.DB.prepare(`SELECT s.* FROM slots s JOIN events e ON e.id = s.event_id WHERE s.id = ? AND e.group_id = ?`).bind(Number(b.slot_id), group.id).first();
  if (!slot) throw httpError(404, 'Slot not found.');
  if (await env.DB.prepare(`SELECT 1 FROM signups WHERE slot_id = ? AND lower(email) = lower(?)`).bind(slot.id, person.email).first())
    throw httpError(400, 'That email is already signed up for this slot.');
  const item = slot.kind === 'item' ? validateItem({ item_desc: b.item_desc, dietary: b.dietary }, slot.title) : { item_desc: '', dietary: '' };
  // Organisers may not have the volunteer's check details to hand, so these are optional here
  let check = { number: '', expiry: '' };
  if (slot.needs_wwcc && (b.wwcc_number || b.wwcc_expiry)) {
    const w = readWwcc(b);
    if (w.error) throw httpError(400, `Working with Children Check: ${w.error}`);
    check = w;
  }
  const token = randomToken();
  const cutoff = new Date(Date.now() + group.reminder_hours * 3600e3).toISOString();
  await env.DB.prepare(`INSERT INTO signups (slot_id, first_name, last_name, email, mobile, comments, answer, item_desc, dietary, manage_token, reminder_sent, wwcc_number, wwcc_expiry)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(slot.id, person.first_name, person.last_name, person.email, person.mobile, person.comments,
    opt(b.answer, 200), item.item_desc, item.dietary, token, slot.start_utc <= cutoff ? 1 : 0, check.number, check.expiry).run();
  if (b.send_email) { await queueConfirmation(env, token); ctx.waitUntil(processQueue(env)); }
  return adminGetEvent(env, group, slot.event_id);
}

async function adminRemoveSignup(env, group, id) {
  const row = await env.DB.prepare(`SELECT s.event_id FROM signups g JOIN slots s ON s.id = g.slot_id JOIN events e ON e.id = s.event_id WHERE g.id = ? AND e.group_id = ?`).bind(id, group.id).first();
  if (!row) throw httpError(404, 'Sign-up not found.');
  await env.DB.prepare(`DELETE FROM signups WHERE id = ?`).bind(id).run();
  return adminGetEvent(env, group, row.event_id);
}

/* ================================================================== */
/* Owner                                                               */
/* ================================================================== */

async function ownerGroups(env) {
  const { results } = await env.DB.prepare(`
    SELECT g.id, g.slug, g.name, g.kind, g.status, g.suspended_reason, g.email_limit, g.created_at, g.activated_at, g.created_ip,
      (SELECT group_concat(u.email, ', ') FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = g.id) AS organisers,
      (SELECT COUNT(*) FROM events e WHERE e.group_id = g.id) AS events,
      (SELECT COUNT(*) FROM signups x JOIN slots s ON s.id = x.slot_id JOIN events e ON e.id = s.event_id WHERE e.group_id = g.id) AS signups,
      (SELECT COUNT(*) FROM email_queue q WHERE q.group_id = g.id AND q.status = 'sent' AND q.sent_at > datetime('now', '-7 days')) AS emails_7d,
      (SELECT COUNT(*) FROM email_queue q WHERE q.group_id = g.id AND q.status = 'queued') AS queued
    FROM groups g ORDER BY g.created_at DESC`).all();
  const sent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE status = 'sent' AND sent_at > datetime('now', '-1 day')`).first();
  const queued = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE status = 'queued'`).first();
  const failed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE status = 'failed' AND created_at > datetime('now', '-7 days')`).first();
  const lastErr = await env.DB.prepare(`SELECT last_error FROM email_queue WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1`).first();
  return json({
    groups: results.map(g => ({ ...g, cap: groupCap(env, g) })),
    email: { provider: env.EMAIL_PROVIDER || 'log', sent_24h: sent.n, daily_limit: dailyLimit(env), queued: queued.n, failed_7d: failed.n, last_error: lastErr?.last_error || '' },
  });
}

async function ownerUpdateGroup(request, env, id) {
  const b = await readJson(request);
  const g = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(id).first();
  if (!g) throw httpError(404, 'Group not found.');
  const status = ['active', 'suspended'].includes(b.status) ? b.status : g.status;
  const limit = b.email_limit === '' || b.email_limit === null || b.email_limit === undefined ? null : Math.max(0, parseInt(b.email_limit, 10) || 0);
  await env.DB.prepare(`UPDATE groups SET status = ?, suspended_reason = ?, email_limit = ? WHERE id = ?`)
    .bind(status, status === 'suspended' ? opt(b.reason, 200) : '', limit, id).run();
  if (status === 'suspended') await env.DB.prepare(`UPDATE email_queue SET status = 'dropped' WHERE group_id = ? AND status = 'queued'`).bind(id).run();
  return ownerGroups(env);
}

/* ================================================================== */
/* Email                                                               */
/* ================================================================== */

async function signupsForToken(env, token) {
  const { results } = await env.DB.prepare(`
    SELECT g.id, g.first_name, g.email, g.item_desc, g.dietary, g.answer, s.kind, s.title, s.details, s.date, s.start_time, s.end_time, s.start_utc,
           e.id AS event_id, e.group_id, e.title AS event_title, e.location, e.contact_name, e.contact_email, e.dropoff_note
    FROM signups g JOIN slots s ON s.id = g.slot_id JOIN events e ON e.id = s.event_id
    WHERE g.manage_token = ? ORDER BY s.date, s.start_time`).bind(token).all();
  return results;
}

async function queueConfirmation(env, token) {
  const rows = await signupsForToken(env, token);
  if (!rows.length) return;
  const f = rows[0];
  const group = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(f.group_id).first();
  const when = group.reminder_hours >= 48 ? `${group.reminder_hours / 24} days before` : group.reminder_hours === 24 ? 'the day before' : `${group.reminder_hours} hours before`;
  await enqueue(env, {
    group_id: group.id, to: f.email, reply_to: f.contact_email || group.contact_email || null, ics: buildIcs(rows, group),
    subject: `You're signed up: ${[...new Set(rows.map(r => r.event_title))].join(', ')}`,
    html: groupEmail(env, group, `
      <p>Hi ${esc(f.first_name)},</p>
      <p>Thank you for volunteering with ${esc(group.name)}! Here ${rows.length === 1 ? 'is what you signed up for' : 'are the things you signed up for'}:</p>
      ${slotTable(rows)}
      <p>We'll send you a reminder ${when}.</p>
      ${button(`${siteUrl(env)}/manage?t=${token}`, 'View or cancel my sign-up', group.accent)}
      <p style="color:#555;font-size:14px">Keep this email: the button above is your private link to make changes. A calendar file is attached.</p>
      ${contactLine(f, group)}`),
  });
}

async function queueReminders(env) {
  const now = new Date();
  const { results } = await env.DB.prepare(`
    SELECT g.id, g.first_name, g.email, g.manage_token, g.item_desc, g.dietary, s.kind, s.title, s.details, s.date, s.start_time, s.end_time, s.start_utc,
           e.id AS event_id, e.group_id, e.title AS event_title, e.location, e.contact_name, e.contact_email, e.dropoff_note, gr.reminder_hours
    FROM signups g JOIN slots s ON s.id = g.slot_id JOIN events e ON e.id = s.event_id JOIN groups gr ON gr.id = e.group_id
    WHERE g.reminder_sent = 0 AND gr.status = 'active' AND s.start_utc > ?1 AND s.start_utc <= ?2
    ORDER BY s.date, s.start_time`).bind(now.toISOString(), new Date(now.getTime() + 72 * 3600e3).toISOString()).all();
  const due = results.filter(r => r.start_utc <= new Date(now.getTime() + r.reminder_hours * 3600e3).toISOString());
  if (!due.length) return 0;
  const groups = new Map();
  for (const r of due) {
    const k = `${r.email.toLowerCase()}|${r.event_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const groupCache = {};
  for (const rows of groups.values()) {
    const f = rows[0];
    const group = groupCache[f.group_id] ||= await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(f.group_id).first();
    await enqueue(env, {
      group_id: group.id, to: f.email, reply_to: f.contact_email || group.contact_email || null, subject: `Reminder: ${f.event_title}`,
      html: groupEmail(env, group, `
        <p>Hi ${esc(f.first_name)},</p>
        <p>Just a friendly reminder that you're helping at <strong>${esc(f.event_title)}</strong> soon:</p>
        ${slotTable(rows)}
        <p>Thank you, we couldn't do it without you!</p>
        <p style="color:#555;font-size:14px">Can't make it any more? Please <a href="${siteUrl(env)}/manage?t=${f.manage_token}">cancel</a> so someone else can take it.</p>
        ${contactLine(f, group)}`),
    });
  }
  await env.DB.batch(due.map(r => env.DB.prepare(`UPDATE signups SET reminder_sent = 1 WHERE id = ?`).bind(r.id)));
  return groups.size;
}

async function enqueue(env, m) {
  let fromName = platformName(env);
  if (m.group_id) {
    const g = await env.DB.prepare(`SELECT name FROM groups WHERE id = ?`).bind(m.group_id).first();
    if (g) fromName = `${g.name} via ${platformName(env)}`;
  }
  await env.DB.prepare(`INSERT INTO email_queue (group_id, to_email, from_name, reply_to, subject, html, ics, priority) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(m.group_id || null, m.to, fromName.slice(0, 120), m.reply_to || null, m.subject, m.html, m.ics || null, m.priority ?? 1).run();
}

function dailyLimit(env) { return parseInt(env.DAILY_EMAIL_LIMIT, 10) || 280; }
function groupCap(env, g) {
  if (g.email_limit !== null && g.email_limit !== undefined) return g.email_limit;
  const ageDays = (Date.now() - Date.parse((g.activated_at || g.created_at || '').replace(' ', 'T') + 'Z')) / 86400e3;
  return ageDays < 14 ? (parseInt(env.NEW_GROUP_EMAIL_LIMIT, 10) || 40) : (parseInt(env.GROUP_EMAIL_LIMIT, 10) || 150);
}

async function processQueue(env) {
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE status = 'sent' AND sent_at > datetime('now', '-1 day')`).first();
  let allowance = Math.min(dailyLimit(env) - n, 50);
  if (allowance <= 0) return;
  const { results } = await env.DB.prepare(`SELECT * FROM email_queue WHERE status = 'queued' ORDER BY priority, id LIMIT 200`).all();
  const groupState = {};
  for (const msg of results) {
    if (allowance <= 0) break;
    if (msg.group_id) {
      let st = groupState[msg.group_id];
      if (!st) {
        const g = await env.DB.prepare(`SELECT * FROM groups WHERE id = ?`).bind(msg.group_id).first();
        const s = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_queue WHERE group_id = ? AND status = 'sent' AND sent_at > datetime('now', '-1 day')`).bind(msg.group_id).first();
        st = groupState[msg.group_id] = { g, left: g ? groupCap(env, g) - s.n : 0 };
      }
      if (!st.g || st.g.status === 'suspended') {
        await env.DB.prepare(`UPDATE email_queue SET status = 'dropped' WHERE id = ?`).bind(msg.id).run();
        continue;
      }
      if (st.left <= 0 && msg.priority > 0) continue; // this group is at its daily cap; try again next hour
      st.left--;
    }
    const claim = await env.DB.prepare(`UPDATE email_queue SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'queued'`).bind(msg.id).run();
    if (!claim.meta.changes) continue;
    allowance--;
    try {
      await sendEmail(env, msg);
      await env.DB.prepare(`UPDATE email_queue SET status = 'sent', sent_at = datetime('now'), last_error = NULL WHERE id = ?`).bind(msg.id).run();
    } catch (err) {
      await env.DB.prepare(`UPDATE email_queue SET status = ?, last_error = ? WHERE id = ?`)
        .bind(msg.attempts + 1 >= 5 ? 'failed' : 'queued', String(err.message || err).slice(0, 500), msg.id).run();
    }
  }
}

async function sendEmail(env, msg) {
  const provider = env.EMAIL_PROVIDER || 'log';
  const from = env.FROM_EMAIL || 'hello@helperhub.au';
  const icsB64 = msg.ics ? btoa(unescape(encodeURIComponent(msg.ics))) : null;
  if (provider === 'log') {
    const link = (msg.html.match(/href="([^"]*\/auth\?t=[^"]+)"/) || [])[1];
    console.log(`[email:log] to=${msg.to_email} from="${msg.from_name}" subject=${msg.subject}${link ? ' link=' + link : ''}`);
    return;
  }
  if (provider === 'brevo') {
    const body = { sender: { name: msg.from_name, email: from }, to: [{ email: msg.to_email }], subject: msg.subject, htmlContent: msg.html };
    if (msg.reply_to) body.replyTo = { email: msg.reply_to };
    if (icsB64) body.attachment = [{ name: 'event.ics', content: icsB64 }];
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY || '', 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  if (provider === 'resend') {
    const body = { from: `${msg.from_name.replace(/[<>"]/g, '')} <${from}>`, to: [msg.to_email], subject: msg.subject, html: msg.html };
    if (msg.reply_to) body.reply_to = msg.reply_to;
    if (icsB64) body.attachments = [{ filename: 'event.ics', content: icsB64 }];
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
}

async function runHourly(env) {
  await queueReminders(env);
  await env.DB.prepare(`UPDATE email_queue SET status = 'queued' WHERE status = 'sending' AND created_at < datetime('now', '-30 minutes')`).run();
  await processQueue(env);
  // Housekeeping and privacy: keep only what's needed
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM rate_hits WHERE at < datetime('now', '-2 days')`),
    env.DB.prepare(`DELETE FROM login_links WHERE expires_at < ?`).bind(new Date(Date.now() - 86400e3).toISOString()),
    env.DB.prepare(`DELETE FROM email_queue WHERE created_at < datetime('now', '-30 days')`),
    // volunteer contact details are removed 12 months after the slot
    env.DB.prepare(`DELETE FROM signups WHERE slot_id IN (SELECT id FROM slots WHERE date < date('now', '-365 days'))`),
    // unconfirmed groups are removed after 7 days
    env.DB.prepare(`DELETE FROM memberships WHERE group_id IN (SELECT id FROM groups WHERE status = 'pending' AND created_at < datetime('now', '-7 days'))`),
    env.DB.prepare(`DELETE FROM groups WHERE status = 'pending' AND created_at < datetime('now', '-7 days')`),
  ]);
}

/* ---------- email templates ---------- */

function shell(inner, header, footer, accent) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2733">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="margin-bottom:12px">${header}</div>
    <div style="background:#fff;border-radius:12px;padding:20px 22px;line-height:1.5;font-size:16px;border-top:4px solid ${accent}">${inner}</div>
    <div style="color:#888;font-size:12px;margin-top:12px;text-align:center;line-height:1.5">${footer}</div>
  </div></body></html>`;
}
function platformEmail(env, inner) {
  return shell(inner, `<span style="font-weight:bold;color:#2f7d6d;font-size:18px">${esc(platformName(env))}</span>`,
    `${esc(platformName(env))} &middot; free volunteer sign-ups for community groups`, '#2f7d6d');
}
function groupEmail(env, g, inner) {
  const logo = g.has_logo ? `<img src="${siteUrl(env)}/api/g/${g.slug}/logo?v=${g.logo_version}" alt="" style="height:44px;vertical-align:middle;margin-right:10px;border-radius:6px">` : '';
  return shell(inner, `${logo}<span style="font-weight:bold;color:${g.accent};font-size:18px;vertical-align:middle">${esc(g.name)}</span>`,
    `Sent by <a href="${siteUrl(env)}" style="color:#888">${esc(platformName(env))}</a> on behalf of ${esc(g.name)}. Reply to this email to contact the organisers.`, g.accent);
}
function button(href, label, color = '#2f7d6d') {
  return `<p style="margin:24px 0"><a href="${href}" style="background:${color};color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">${esc(label)}</a></p>`;
}
function slotTable(rows) {
  const box = inner => `<div style="border-left:4px solid #ccc;padding:8px 12px;margin:10px 0;background:#f6f8fa;border-radius:4px">${inner}</div>`;
  return rows.map(r => box(r.kind === 'item' ? `
      <div style="font-weight:bold">Bringing: ${esc(r.item_desc)} <span style="font-weight:normal;color:#555">(${esc(r.title)})</span></div>
      ${dietaryList(r.dietary).length ? `<div style="color:#555;font-size:14px">${esc(dietaryList(r.dietary).join(', '))}</div>` : ''}
      <div>Drop off by ${esc(fmtTime(r.start_time))}, ${esc(fmtDate(r.date))}${r.dropoff_note ? ', ' + esc(r.dropoff_note) : ''}</div>
      <div style="color:#555">${esc(r.event_title)}${r.location ? ' &middot; ' + esc(r.location) : ''}</div>` : `
      <div style="font-weight:bold">${esc(r.title)}</div>
      <div>${esc(fmtDate(r.date))}, ${esc(fmtTime(r.start_time))} to ${esc(fmtTime(r.end_time))}</div>
      <div style="color:#555">${esc(r.event_title)}${r.location ? ' &middot; ' + esc(r.location) : ''}</div>
      ${r.details ? `<div style="color:#555;font-size:14px;margin-top:4px">${esc(r.details).replace(/\n/g, '<br>')}</div>` : ''}`)).join('');
}
function contactLine(r, g) {
  const name = r.contact_name || g.contact_name, email = r.contact_email || g.contact_email;
  if (!name && !email) return '';
  return `<p style="color:#555;font-size:14px">Questions? Contact ${email ? `<a href="mailto:${esc(email)}">${esc(name || email)}</a>` : esc(name)}.</p>`;
}
function buildIcs(rows, group) {
  const tz = group.timezone;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const e = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const evs = rows.map(r => {
    const start = localToUtc(r.date, r.start_time, tz);
    const end = r.kind === 'item' ? new Date(start.getTime() + 30 * 60e3) : localToUtc(r.date, r.end_time, tz);
    return ['BEGIN:VEVENT', `UID:helperhub-signup-${r.id}@helperhub`, `DTSTAMP:${stamp}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${e(r.kind === 'item' ? `${r.event_title}: drop off ${r.item_desc}` : `${r.event_title}: ${r.title}`)}`,
      `LOCATION:${e(r.kind === 'item' && r.dropoff_note ? r.dropoff_note : r.location)}`, `DESCRIPTION:${e(r.details)}`, 'END:VEVENT'].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HelperHub//EN', 'METHOD:PUBLISH', ...evs, 'END:VCALENDAR'].join('\r\n');
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function validatePerson(b) {
  const first_name = req(b.first_name, 'First name', 60);
  const last_name = req(b.last_name, 'Last name', 60);
  const email = req(b.email, 'Email', 200).toLowerCase();
  if (!isEmail(email)) throw httpError(400, 'Please check your email address.');
  const digits = String(b.mobile || '').replace(/[\s\-().]/g, '');
  let mobile;
  if (/^04\d{8}$/.test(digits)) mobile = digits;
  else if (/^\+?614\d{8}$/.test(digits)) mobile = '0' + digits.replace(/^\+?61/, '');
  else if (/^\+?\d{8,15}$/.test(digits) && digits.startsWith('+')) mobile = digits; // overseas numbers
  else throw httpError(400, 'Please enter a mobile number, e.g. 0412 345 678.');
  if (/^04\d{8}$/.test(mobile)) mobile = `${mobile.slice(0, 4)} ${mobile.slice(4, 7)} ${mobile.slice(7)}`;
  return { first_name, last_name, email, mobile, comments: opt(b.comments, 1000) };
}
function validateItem(info, title) {
  const item_desc = String(info?.item_desc ?? '').trim();
  if (!item_desc) throw httpError(400, `Please say what you'll bring for "${title}".`);
  if (item_desc.length > 120) throw httpError(400, `The description for "${title}" is too long.`);
  const codes = (Array.isArray(info?.dietary) ? info.dietary : String(info?.dietary || '').split(',')).map(c => String(c).trim()).filter(c => DIETARY[c]);
  return { item_desc, dietary: [...new Set(codes)].join(',') };
}
/** Working with Children Check: number (letters, digits, spaces, dashes) and an expiry date that hasn't passed */
function readWwcc(b) {
  const number = String(b.wwcc_number || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const expiry = String(b.wwcc_expiry || '').trim();
  if (!number) return { error: 'please enter your check number.' };
  if (!/^[A-Z0-9][A-Z0-9 \-\/]{4,24}$/.test(number)) return { error: 'that check number does not look right.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { error: 'please enter the expiry date.' };
  if (expiry < new Date().toISOString().slice(0, 10)) return { error: 'that check has expired.' };
  return { number, expiry };
}

function dietaryList(codes) { return String(codes || '').split(',').filter(c => DIETARY[c]).map(c => DIETARY[c]); }
function req(v, label, max) {
  const s = String(v ?? '').trim();
  if (!s) throw httpError(400, `${label} is required.`);
  if (s.length > max) throw httpError(400, `${label} is too long.`);
  return s;
}
function opt(v, max) { return String(v ?? '').trim().slice(0, max); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }
function isHttpsUrl(s) { return /^https:\/\/[^\s"'<>]+$/i.test(s); }
function displayName(first, last) { return `${first} ${last ? last[0].toUpperCase() + '.' : ''}`.trim(); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function paragraphs(t) { return String(t).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''); }
function siteUrl(env) { return (env.SITE_URL || 'https://helperhub.au').replace(/\/$/, ''); }
function platformName(env) { return env.PLATFORM_NAME || 'HelperHub'; }
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'local'; }
function fmtDate(d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function fmtTime(t) { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')}${ap}`; }
function addDays(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function localToUtc(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = asUtc - tzOffset(asUtc, tz);
  guess = asUtc - tzOffset(guess, tz);
  return new Date(guess);
}
function tzOffset(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts));
  const g = t => +parts.find(p => p.type === t).value;
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ts / 1000) * 1000;
}
function randomToken() { const b = new Uint8Array(24); crypto.getRandomValues(b); return b64urlBytes(b); }
function b64url(s) { return b64urlBytes(new TextEncoder().encode(s)); }
function b64urlBytes(bytes) { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sha256(s) { return b64urlBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const ax = new Uint8Array(x), by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}
async function readJson(request) { try { return await request.json(); } catch { throw httpError(400, 'Invalid request.'); } }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

# HelperHub

Free, ad-free volunteer sign-ups for schools, clubs and community groups, at **helperhub.au**.

- Any group can set itself up at `helperhub.au/start` and gets its own page, e.g. `helperhub.au/riverside-football-club`, with its own logo and colours.
- Volunteers sign up without an account (name, email, mobile), for time slots or "things to bring", and get a confirmation, a calendar invite and a reminder.
- Organisers log in with an emailed link (no passwords), and a group can have several organisers.
- The owner (you) has a dashboard at `helperhub.au/owner` to see every group, change email limits and suspend misuse.

## How it fits together

Everything runs on Cloudflare, on its free plan:

| Part | What it is |
|---|---|
| `src/worker.js` | The API, plus serving the pages; also the hourly job for reminders |
| `public/` | The website pages, styles and scripts |
| `schema.sql` | The database tables (Cloudflare D1) |
| `wrangler.toml` | Cloudflare settings; non-secret settings live under `[vars]` |

Once the Worker is connected to this GitHub repo, every change pushed to `main` deploys automatically.

## One-time setup

### 1. Domain on Cloudflare
In Cloudflare: **Domains > Onboard a domain**, enter `helperhub.au`, choose **Free**. At your registrar, replace the nameservers with the two Cloudflare gives you. Wait for Cloudflare to say the domain is **Active**.

### 2. Database
**Storage & databases > D1 > Create database**, name `helperhub`. Copy its **Database ID** into `wrangler.toml` (`database_id = "..."`). Then open the database's **Console** tab, paste the contents of `schema-oneline.sql` and click **Execute**. The Overview should then list tables such as `groups`, `events` and `signups`.

### 3. Connect the Worker to GitHub
**Workers & Pages > Create > Import a repository**, choose this repository, and keep the defaults (deploy command `npx wrangler deploy`). Cloudflare builds and deploys it as a Worker called `helperhub`.

### 4. Secrets
In the `helperhub` Worker: **Settings > Variables and Secrets > Add**, type **Secret**:

| Name | Value |
|---|---|
| `SESSION_SECRET` | Any long random text (40+ characters) |
| `OWNER_EMAILS` | Your email address (comma-separate several) |

### 5. Use helperhub.au for the Worker
Worker **Settings > Domains & Routes > Add > Custom domain**: `helperhub.au`. Optionally add `www.helperhub.au` too.

At this point the site works, in **test mode**: emails are not sent (they appear in the Worker's logs instead).

### 6. Receive email at hello@helperhub.au (free)
Cloudflare: your domain > **Email > Email Routing** > enable, then add a rule sending `hello@helperhub.au` to your own inbox. This is the address in the privacy notice and where misuse reports arrive.

### 7. Sending email with Brevo (free: 300 a day)
1. Create a free account at brevo.com.
2. **Senders, Domains & Dedicated IPs > Domains > Add a domain**: `helperhub.au`. Brevo lists DNS records (a Brevo code, DKIM and DMARC). Add them in Cloudflare under your domain's **DNS > Records** (Brevo can often do this automatically for Cloudflare domains). Wait until Brevo shows the domain as authenticated.
3. **Senders**: add `hello@helperhub.au` as a sender, name `HelperHub`.
4. **SMTP & API > API keys > Generate**. Add it to the Worker as a **Secret** named `BREVO_API_KEY`.
5. In `wrangler.toml` set `EMAIL_PROVIDER = "brevo"` and push.

Brevo's free plan adds a small Brevo logo to emails. To switch to another service later (e.g. Resend), set `EMAIL_PROVIDER = "resend"` and a `RESEND_API_KEY` secret.

### 8. Bot check on "Set up your group" (Turnstile, free)
Cloudflare: **Turnstile > Add widget**, hostname `helperhub.au`, mode **Managed**. Put the **Site key** in `wrangler.toml` as `TURNSTILE_SITE_KEY`, and add the **Secret key** to the Worker as a Secret named `TURNSTILE_SECRET`.

## Limits and safety

- Whole-platform email cap per rolling 24 hours: `DAILY_EMAIL_LIMIT` (280, under Brevo's free 300).
- Per-group daily caps: 40 for the first 14 days, then 150. Change one group's cap on the owner dashboard.
- Emails over a cap wait in the queue and go out in the next hourly run. Login links always go first.
- New groups must confirm their email; unconfirmed groups are deleted after 7 days. Each IP can create 3 groups a day.
- Suspending a group hides its pages, stops its emails and blocks its organisers.
- Volunteer contact details are deleted 12 months after the event (see `public/privacy.html`).

The privacy notice and terms are a plain-language starting point, not legal advice.

## Testing locally (for developers)

```
npm install
npx wrangler d1 execute helperhub --local --file=schema.sql
printf 'SESSION_SECRET=dev-secret-123456789\nOWNER_EMAILS=you@example.com\nSITE_URL=http://localhost:8788\n' > .dev.vars
npx wrangler dev --local --port 8788 --test-scheduled
```
In test mode, login links are printed in the terminal.

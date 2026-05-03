# Lead Bites Uploader

Web app for importing monthly Lead Bites CSVs into Mautic. Replaces the local Docker bot's import job — Vultr's `marketing-emails` service handles all email sending downstream.

## What it does

1. You upload a Lead Bites CSV (the monthly ~1000-row file)
2. App parses, dedupes, validates emails
3. For each row:
   - **New email** → creates contact in Mautic with `lead bites` tag
   - **Existing email** → just adds `lead bites` tag (preserves all other data)
4. Vultr's `marketing-emails` service picks up tagged contacts within 5 min and starts the 5-stage cold-outreach sequence

## Architecture

```
You upload CSV ─→ Vercel app
                    │
                    ├─ Parse + clean (papaparse)
                    ├─ Fetch existing Mautic emails (1 bulk call)
                    ├─ Split into create vs update
                    └─ POST to Mautic (Basic Auth)
                         │
                         ↓
                    Mautic on Vultr
                         │
                         ↓ (every 5 min)
                    marketing-emails scheduler
                         │
                         ↓
                    5-stage email sequence runs automatically
```

## Tech stack

- **Next.js 14** (Pages Router) on Vercel
- **TypeScript**
- **Tailwind CSS**
- **papaparse** for CSV parsing
- **iron-session** for password-gated auth (single shared password)

## Deployment to Vercel (5 minutes)

### 1. Sign in to Vercel

Use your GitHub account at https://vercel.com — easiest.

### 2. Import this repo

- Click **Add New... → Project**
- Select `Godwin-Xavier/lead-bites-excel-import`
- Framework: Next.js (auto-detected)
- Click **Deploy** (it'll build but the env vars aren't set yet — that's fine)

### 3. Set environment variables

Once the first deploy completes, go to **Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `MAUTIC_BASE_URL` | `https://mautic.dynamixsolutions.org` |
| `MAUTIC_USERNAME` | `admin` |
| `MAUTIC_PASSWORD` | `Sheilds@#2407` |
| `UPLOAD_PASSWORD` | (your chosen app password — e.g. `Sheilds@2407`) |
| `SESSION_PASSWORD` | (random 64-char hex — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `LEAD_TAG` | `lead bites` |

Apply to **Production**, **Preview**, and **Development**.

### 4. Redeploy

After env vars are set, go to **Deployments** → latest → **... → Redeploy**.

That's it. Visit your Vercel URL.

## Optional: Custom domain

In **Settings → Domains**, add e.g. `leads.dynamixsolutions.org`. You'll need to add a DNS record:

- **Type:** CNAME
- **Hostname:** `leads`
- **Value:** `cname.vercel-dns.com`

Add this in the Netlify DNS panel for `dynamixsolutions.org`.

## Local development

```bash
npm install
cp .env.local.example .env.local
# Fill in your values in .env.local
npm run dev
```

App runs on http://localhost:3000.

## CSV format

The app expects the standard Lead Bites monthly export with these columns at minimum:

- `Decision Maker Email` (required)
- `Decision Maker First Name` (required)
- `Decision Maker Last Name`
- `Organization Name`
- `Decision Maker Position`
- `Website`
- `City` / `State` / `Country`
- `Industries`
- `Description` / `Full Description`
- `Tech Stack`
- `Number of Employees`
- `Decision Maker LinkedIn URL`

Other columns are silently ignored.

## How dedupe works

1. On every upload, the app first calls `GET /api/contacts?limit=1000` (paginated) to fetch all existing emails from Mautic
2. Each CSV row is checked against this in-memory set
3. If email exists → contact gets `lead bites` tag added (existing tags preserved via fetch-merge-PATCH)
4. If email is new → contact is created via `POST /api/contacts/new`

Mautic uses `email` as a unique identifier, so accidental duplicates can't be created even if the dedupe step fails.

## Performance

- ~1000-row CSV typically completes in **15-30 seconds**
- Concurrency is capped at 5 in-flight Mautic API calls (avoids rate-limiting Apache)
- Vercel Hobby tier has a 10s timeout for serverless functions; if you hit it, upgrade to Pro ($20/mo) or split CSVs in half

## Operational notes

- The `lead bites` tag is a contract with Vultr's `marketing-emails` service. **Don't change it** unless you also update the Vultr service's `LEAD_TAG` env var.
- Vultr's `marketing-emails` service explicitly skips contacts with this tag in its Fast Pulse logic, so they only receive Lead Bites cold-outreach emails (no overlap).
- If Mautic's API is unreachable, the app fails fast with a clear error before partial writes.
- All env vars are server-side; the upload password is never sent to the client unhashed.

## Security

- Password-gated via iron-session (HTTP-only cookie, 8-hour expiry)
- Wrong password attempts return 401 with no rate limiting (good enough for a small audience; add rate limiting via Vercel middleware if needed)
- `SESSION_PASSWORD` rotates the auth — change it to invalidate all existing sessions
- Mautic credentials never leave the server

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Cannot reach Mautic` | Mautic is down or env vars wrong |
| `Unauthorized (Mautic)` | `MAUTIC_USERNAME` / `MAUTIC_PASSWORD` wrong |
| `CSV is missing required columns` | The Lead Bites export format changed; update `lib/csv.ts` |
| Many "Tag PATCH failed" errors | Mautic is rate-limiting; lower concurrency in `lib/mautic.ts` |
| `Function execution timeout` | Vercel Hobby 10s limit hit; upgrade to Pro or split CSV |

## Repo structure

```
.
├── pages/
│   ├── index.tsx          # UI (login + upload form + results)
│   ├── _app.tsx
│   └── api/
│       ├── login.ts       # POST /api/login
│       ├── logout.ts
│       └── upload.ts      # POST /api/upload (the work)
├── lib/
│   ├── auth.ts            # iron-session helpers
│   ├── csv.ts             # CSV parsing + cleaning
│   └── mautic.ts          # Mautic API client + import logic
├── styles/
│   └── globals.css        # Tailwind base
├── package.json
├── next.config.js
├── tailwind.config.ts
└── README.md
```

## Background

The original Lead Bites local Docker bot did:
- CSV ingest from Google Drive (via Apps Script webhook)
- Mautic import + tagging
- Email sending (5-stage cold sequence)
- Local SQLite tracking

The email-sending part overlapped with Vultr's `marketing-emails` service, creating a duplicate-send risk if both ran simultaneously. This app replaces only the import job — sending stays on Vultr. The local Docker bot can be retired entirely.

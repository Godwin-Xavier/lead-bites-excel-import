# Lead Bites Uploader

Web app for importing monthly Lead Bites CSVs into **listmonk**. Replaced the Mautic import path on 2026-06-14 (Mautic decommissioned). Contabo's `marketing-emails` service handles all email sending downstream.

## What it does

1. Upload a Lead Bites CSV (monthly ~1000-row export)
2. App parses, dedupes, validates emails (browser-side)
3. For each row:
   - **New email** → creates subscriber in listmonk with `lead-bites` tag
   - **Existing email, no tag** → adds `lead-bites` tag (preserves all other data)
   - **Existing email, graduated/replied** → skipped (never re-enrolled)
4. Contabo's `marketing-emails` service picks up tagged contacts within 30 min and starts the 5-stage cold-outreach sequence

## Architecture

```
You upload CSV ─→ Vercel app
                    │
                    ├─ Parse + clean (papaparse, browser)
                    ├─ Ping listmonk /api/health
                    ├─ Pause marketing-emails (VPS ops API, best-effort)
                    └─ POST /api/subscribers (listmonk, Basic Auth, batched)
                         │  200 = created | 409 = exists → GET + PUT merge
                         ↓
                    listmonk on Contabo 79.143.180.209:9000
                         │
                         ↓ (30-min Lead Bites tick)
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

## Deployment to Vercel

### 1. Import this repo

- **vercel.com → Add New → Project** → select `Godwin-Xavier/lead-bites-excel-import`
- Framework: Next.js (auto-detected)
- Click **Deploy** (env vars not set yet — that's fine)

### 2. Set environment variables

Go to **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `LISTMONK_BASE_URL` | `http://79.143.180.209:9000` |
| `LISTMONK_API_USER` | `marketing-bot` |
| `LISTMONK_API_TOKEN` | *(listmonk API token — from VPS secrets)* |
| `LISTMONK_LIST_ID` | `3` |
| `UPLOAD_PASSWORD` | *(your chosen app password)* |
| `SESSION_PASSWORD` | *(random 64-char hex — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)* |
| `VPS_OPS_API_TOKEN` | *(vps-monitor HTTP API token — optional, enables pause/resume)* |

Apply to **Production**, **Preview**, and **Development**.

### 3. Redeploy

**Deployments → latest → ... → Redeploy** after env vars are saved.

## Local development

```bash
npm install
cp .env.local.example .env.local
# Fill in your values
npm run dev
```

## CSV format

Standard Lead Bites monthly export. Required columns:

- `Decision Maker Email`
- `Decision Maker First Name`

Optional (all others silently ignored):
`Decision Maker Last Name`, `Decision Maker Position`, `Organization Name`,
`Website`, `City`, `State`, `Country`, `Industries`, `Number of Employees`,
`Decision Maker LinkedIn URL`, `Description`, `Tech Stack`

## Tag contract

The tag `lead-bites` (hyphen, lowercase) is a hard contract with the `marketing-emails` orchestrator on Contabo — it searches using a JSONB query `attribs->'tags' @> '["lead-bites"]'`. **Do not change this.** The space-form `lead bites` was a 2026-05-29 bug.

Contacts tagged `lead-bites-complete` or `lead-bites-replied` are never re-enrolled.

## Dedup / merge logic

1. `POST /api/subscribers` → **200** = new subscriber created.
2. **409** = already exists → `GET /api/subscribers?query=subscribers.email='...'`, check skip tags, then `PUT /api/subscribers/{id}` to add tag + fill empty attrib fields (never clobbers existing data).

## Security

- Password-gated via iron-session (HTTP-only cookie, 8-hour expiry)
- `LISTMONK_API_TOKEN` is server-side only — never sent to the browser
- `SESSION_PASSWORD` rotation invalidates all existing sessions

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `listmonk unreachable` | listmonk down, or `LISTMONK_BASE_URL` wrong |
| `401` on health check | `LISTMONK_API_USER` / `LISTMONK_API_TOKEN` wrong |
| `CSV is missing required columns` | Lead Bites export format changed; update `lib/csv.ts` |
| Many PUT failures | listmonk load; lower concurrency in `lib/listmonk.ts` |
| Function execution timeout | Vercel Hobby 10s limit hit; upgrade to Pro or split CSV |

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
│   ├── listmonk.ts        # listmonk API client + import logic
│   └── vps_control.ts     # pause/resume marketing-emails via vps-monitor API
├── styles/
│   └── globals.css
├── package.json
├── next.config.js
├── tailwind.config.ts
└── README.md
```

## History

Originally wrote to Mautic (Basic Auth, `/api/contacts`). Mautic decommissioned 2026-06-14; `lib/mautic.ts` replaced by `lib/listmonk.ts` with equivalent semantics (same tag contract, same dedupe/merge logic, same BatchResult shape).

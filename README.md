# SubmitHub

Assignment submission and document merge portal for a single class (~32 students).
Students upload a file; it is renamed, stored in Google Drive, and normalized to PDF.
The CR tracks who has submitted and merges everything into one ordered final PDF.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Auth.js (Google OAuth) ·
PostgreSQL + Prisma 7 · Google Drive API · pdf-lib

There is **no LibreOffice dependency** — DOCX/DOC/ODT/PPTX are converted to PDF by
Google Drive's own converter, so this runs anywhere Node runs, including serverless.

## Quick start

```bash
npm install
createdb submithub
cp .env.example .env        # then fill in the values below
npx prisma migrate dev
npx prisma db seed
npm run dev                 # http://localhost:3000
```

## Environment

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client (see below) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000` in dev |
| `ALLOWED_EMAIL_DOMAIN` | Optional. Restricts sign-in to one college domain |
| `DRIVE_ROOT_FOLDER_ID` | Optional. Defaults to auto-creating `SubmitHub` in the CR's Drive |

## Google Cloud setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **OAuth consent screen** → External → add your Google account as a test user.
4. **Credentials → Create credentials → OAuth client ID → Web application.**

   There are two boxes on this screen and they are not interchangeable:

   **Authorized JavaScript origins** — origin only, no path. Optional for this app
   (all OAuth happens server-side); leave it empty or set:
   ```
   http://localhost:3000
   ```
   > Pasting a callback URL here fails with
   > *"Invalid Origin: URIs must not contain a path or end with /"*.

   **Authorized redirect URIs** — add **both** of these (click *+ Add URI* for the second):
   ```
   http://localhost:3000/api/auth/callback/google
   http://localhost:3000/api/drive/callback
   ```
   The first handles sign-in; the second handles the CR granting offline Drive
   access. Missing either one produces a `redirect_uri_mismatch` at that step.
5. Copy the client ID and secret into `.env`.
6. Start the app, sign in as the CR, go to **Settings → Connect Google Drive**.
   That grants offline access and stores a refresh token, so all class files live
   in one Drive account the CR owns.

## Roster

The roster is the source of truth for identity. An email that is not on it cannot
sign in, and a student can only ever submit under their own enrollment number.
Edit `prisma/seed.ts` and re-run `npx prisma db seed`.

The CR is the first roster entry; override the account with `CR_EMAIL=you@gmail.com npx prisma db seed`.

## Drive layout

```
SubmitHub/
└── {Course}/
    └── {Assignment}/
        ├── submissions/   original uploads, renamed
        ├── normalized/    PDF version of every submission
        └── final/         merged output, versioned v1, v2, …
```

Filenames are `{enrollmentNo}_{lastName}_{assignment-slug}.{ext}`.

## Deploying

1. **Database** — create a Postgres instance (Neon, Supabase, or Vercel Postgres)
   and copy its connection string.
2. **Vercel** — import this repository, then set the environment variables from
   `.env.example`: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `AUTH_SECRET`, `AUTH_URL` (your production URL), `AUTH_TRUST_HOST=true`.
3. **Migrate and seed** against the production database:
   ```bash
   DATABASE_URL="<prod url>" npx prisma migrate deploy
   DATABASE_URL="<prod url>" npx prisma db seed
   ```
4. **Google OAuth** — add the production callbacks to your OAuth client:
   `https://<your-domain>/api/auth/callback/google` and
   `https://<your-domain>/api/drive/callback`.
5. Sign in as the admin and connect Google Drive in **Settings**.

## Merge behaviour

- Default order is enrollment number ascending, using a **natural sort** so
  `21BCE9` precedes `21BCE10`. The CR can reorder manually on the verify screen.
- A verification screen is mandatory — the merge never runs straight from the dashboard.
- Corrupt, encrypted, or zero-page files **block** the merge and must be explicitly
  excluded. One bad file fails the entire job with the enrollment number named,
  rather than silently producing a partial document.
- Merges are versioned and non-destructive: re-running creates v2, never overwrites v1.
- A page map records where each student's work lands in the final PDF.

## Tests

```bash
npx tsx -r dotenv/config scripts/test-merge.ts          # ordering, page map, page counts
npx tsx -r dotenv/config scripts/test-merge-failure.ts  # a bad file fails loudly
npx tsx -r dotenv/config scripts/test-merge-cancel.ts   # stopping mid-run uploads nothing
```

All three run the real merge engine against an in-memory storage seam, so they need
Postgres but not Google Drive.

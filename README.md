# ContractFlow — NJ Wholesale Contract Filler

A zero-backend web tool that fills your **purchase contract** and **assignment of contract (AOC)**
from a single deal form and exports both as PDFs. The PDF fill/export runs entirely in the browser
(via `pdf-lib`) — nothing is uploaded.

## Features
- Fills your exact templates (buyer block, 30-day inspection, vacant clause, $80,000 assignment
  basis and $5,000 EMD are baked in).
- Auto-computes balance (price − deposit) and sets Assignor = buyer entity / Assignee = cash buyer.
- Optional **smart Autofill**: paste messy deal notes and Claude extracts the fields. Falls back to a
  built-in regex parser if no API key is configured.

## Deploy on Vercel
1. Import this repo at https://vercel.com/new (no build step — it's a static site with one
   serverless function in `/api`).
2. In **Project → Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your Anthropic key (required only for smart Autofill)
   - `ANTHROPIC_MODEL` = `claude-haiku-4-5-20251001` (optional; this is the default)
   - `SIGNWELL_API_KEY` = your SignWell API key (required only for e-signature)
   - `SIGNWELL_COORD_SCALE` = `1` (optional; only change if signature boxes land off)
3. Deploy. Environment variables only apply to **new** deployments.

## E-signature

Two separate sends, because the counterparties differ:
- **Contract → seller** (seller, optional co-seller, then you countersign)
- **Assignment → cash buyer** (assignee, then you countersign)

Signature and date boxes are placed by measured coordinates from the templates.
Dates use `lock_sign_date`, so the signing service stamps the real signing date
rather than a date typed in advance.

**Test mode is on by default.** Test documents are not legally binding and don't
count toward billing. Send one to yourself, confirm the boxes land on the lines,
then untick Test mode.

SMS delivery requires an SMS-enabled SignWell workspace. If it isn't enabled the
send automatically falls back to email and returns the signing links so they can
be texted manually.

Optional: register `https://<your-domain>/api/signwell-webhook` in SignWell
(Settings → API → Webhooks, API-type hook) to log signing and completion events.

## Security
- The API key is **only** ever stored as a Vercel environment variable and used server-side in
  `api/parse.js`. It is never committed to the repo or exposed to the browser.
- Because this repo is public, do not paste keys into any file here.

## Disclaimer
This tool fills documents; it is not legal advice. Review every generated PDF before signing.

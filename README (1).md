# ParkOps server

Parking operations for downtown garages and lots, in one small Node app:

- Camera (LPR) garages and QR-code pay-by-plate lots.
- An exit desk for the booth: find the car, collect cash, card, check or Square Terminal, print the receipt.
- Every visit is a ticket with a rate snapshot, a per-day price breakdown, validations and a full history.
- Monthly parking for individuals and companies, with CSV import, waitlists, billing and Square invoices.
- Validation codes (free time, percent, dollar, flat price, full) and validation-code occupancy reports for tenant allotments.
- Valet board, VIP list, reservations, driver ratings.
- Roles (owner, manager, attendant, accountant, viewer) enforced by the server, with emailed invitations.
- 23 reports with CSV export: revenue, payments, shift close-out, waived, A/R aging, sales tax, occupancy, exits, customers & vehicles, monthly, invoices, VIP, ratings, validations, code occupancy, tenant allotments, notices, reservations, staff.
- Square payments, invoices, Terminal, Apple Pay and Google Pay. Twilio texts. Photo evidence and Zebra notice printing.

Setup:

- There are no packages to install. It needs **Node 22.13+**, which has SQLite built in.
- All data lives in `DATA_DIR`: the database, nightly backups and photos. Put it on a persistent disk.
- Run **one** instance. The live count is kept in memory and written through to the database.

## What has been verified, and what has not

Be straight with your client about this. Everything below the line is implemented to the vendors' documentation but has **not** been run against real accounts or hardware yet.

| Area | Status |
|---|---|
| Exit desk, tickets, validations, valet, reports, roles, invitations, CSV import, reservations, monthly billing, collections | Verified: 240+ automated end-to-end checks run in a browser against this server (`test/`). |
| Square card payments, saved cards, refunds, invoices, **Terminal** checkouts | Verified against a **mock** of Square's API (request shapes, idempotency keys, statuses). **Not yet run against Square's sandbox or production.** Do the sandbox test in step 2 before going live. |
| Twilio texts (receipts, reminders, text-to-pay) | Implemented and tested against a mock; not yet sent through a real Twilio account (A2P registration is required first). |
| Hikvision and Axis camera pushes | Parsers tested with sample payloads; not yet tested with a physical camera. Use the test read and `npm run simulate` to rehearse. |
| Zebra ZQ Bluetooth printing | ZPL output checked for structure; not yet printed on a physical printer. The print dialog path works with any printer. |
| Apple Pay / Google Pay | Buttons appear only where the device supports them; not yet exercised with a real wallet. |

## 1. Deploy (about 20 minutes)

**Render (about $7–8/month with a 1 GB disk)**

1. Put this folder in a GitHub repository: `GITHUB_TOKEN=<token> bash scripts/github-push.sh` creates the repository and pushes, or upload the files yourself on github.com (**Add file → Upload files**, dragging in the *contents* of this folder so that `render.yaml` and `server.js` sit at the top level, not inside a sub-folder, and not as a zip).
2. Click the **Deploy to Render** link the script prints (`https://render.com/deploy?repo=<your repository URL>`), or in Render choose **New → Blueprint** and pick the repository. `render.yaml` creates the service and the disk. For a scripted deploy use `scripts/render-deploy.sh` with a Render API key.
3. Render asks for two values: `ADMIN_EMAIL` and `ADMIN_PASSWORD` (10+ characters), the **owner** login. Invite everyone else in **Settings → People & access**.
   Everything else is optional and is added later under the service's **Environment** tab in Render:
   - Square keys (step 2). Without them, everything runs in test mode: payments are simulated and labeled as such.
   - `RESEND_API_KEY` (or `SENDGRID_API_KEY`) and `EMAIL_FROM` are for receipts, invoices, pay notices, invitations and password resets.
     Without one, emails are kept under **Settings → Recent emails** instead of sent, and staff invitations show you a link to pass on yourself.
   - Twilio keys (step 3) are optional. Without them, texts are kept under **Settings → Recent texts**.
4. Add your domain in Render (for example `parking.yourdomain.com`) and set `PUBLIC_URL` to it. Until then the Render address (`RENDER_EXTERNAL_URL`) is used automatically.
   Every link in emails, texts, QR signs and notices is built from `PUBLIC_URL`, never from the incoming request.
5. `TRUST_PROXY=1` is already set for Render. It tells the server to use Render's forwarded client address for rate limits.
6. Check it: `bash scripts/check-live.sh https://your-service.onrender.com`. Then sign in at `/login` with the owner email and password.

**Updating:** push to `main` and Render redeploys automatically (about 2 minutes, no downtime for the database). The GitHub Actions workflow runs the rules tests on every push.

**On-site PC or any other host (Docker + Caddy for HTTPS):**

```
cp .env.example .env      # fill it in
docker compose up -d      # starts ParkOps and Caddy; Caddy gets the certificate for the domain in .env
```

`docker-compose.yml` runs the app behind Caddy, which obtains and renews the HTTPS certificate automatically for `DOMAIN`.
The database, backups and photos live in the `parkops-data` volume. Set `TRUST_PROXY=1` (one proxy hop).

**Windows PC in the office:** install Node 22 from nodejs.org, copy this folder, create `.env`, and run it as a service with
[NSSM](https://nssm.cc) (`nssm install ParkOps "C:\Program Files\nodejs\node.exe" "--no-warnings server.js"`, set the startup
directory to this folder and add the `.env` values as environment variables). Put Caddy in front of it the same way for HTTPS.

**Update:** replace the files with the new version and restart. The database is upgraded automatically on start (new columns and tables are added; nothing is dropped).

**Restore a backup:** stop the app, copy the chosen `backups/parkops-….db` over `DATA_DIR/parkops.db`, delete any `parkops.db-wal` and `parkops.db-shm` files next to it, and start the app.

## 2. Connect Square

1. Sign in at developer.squareup.com and create an application.
2. **Sandbox first:**
   1. Copy the Sandbox Application ID and Access Token, and a Sandbox location ID from the Locations page.
   2. Set `SQUARE_ENVIRONMENT=sandbox` plus the three keys.
   3. Test with card `4111 1111 1111 1111`, any future date, any CVV and ZIP `94103`.
3. **Go live:** swap in the Production Application ID, Access Token and location ID, and set `SQUARE_ENVIRONMENT=production`.
4. **Square Terminal (booth card reader):**
   1. Pair the Terminal with your Square account (Square Dashboard → Devices → Terminals). Copy its **device ID**.
   2. Put it on the location in **Locations → Edit → Square Terminal device ID**, or set `SQUARE_TERMINAL_DEVICE_ID` as the default for every location.
   3. On the exit desk, **Square Terminal** sends the amount to the device; the driver taps; the ticket closes when Square reports the payment. Cancel from the desk if the driver walks away. Checkouts the desk stopped watching are still settled by a background check.
   4. In the sandbox there is no physical device: use Square's test device IDs. `9fa747a2-25ff-48ee-b078-04381f7c828f` completes, `22cd266c-6246-4c06-9983-67f0c26346b0` completes with a tip, `841100b9-ee60-4537-9bcf-e30b2ba5e215` is cancelled by the buyer, `0a956d49-619a-4530-8e5e-8eac603ffc5e` times out, `da40d603-c2ea-4a65-8cfd-f42e36dab0c7` is never picked up. Sandbox approves amounts up to $25.
   5. Terminal checkouts must be $1.00 or more; take smaller amounts in cash.
5. **Apple Pay:**
   1. In the Square Developer Dashboard, open your app, go to **Apple Pay** and add your domain.
   2. Download the domain association file and save it as `apple-developer-merchantid-domain-association` in `DATA_DIR`.
      Or point `APPLE_PAY_DOMAIN_FILE` at it.
   3. ParkOps serves the file at `/.well-known/…`.

   **Google Pay** works without extra setup. Both buttons only appear on devices that support them.
6. **Settings → System** shows which mode is active. **Payments** lists every payment (cards through Square, and cash, checks and Terminal taken at the desk) with its tax, who took it, the Square receipt and a Refund button.

What goes through Square:

- Pay to park and add time; unpaid balances and notices; reservation fees and autopay.
- Monthly parking (saved cards, charged on the 1st) and company invoices.
- Exit-desk card payments: Terminal, or the card on file of an autopay account.

Card numbers never touch this server. Square's card form turns them into a token, saved cards live on the Square customer record, and the Terminal handles card-present payments itself.
Every charge carries an idempotency key, so a retried payment is never charged or applied twice.
Card disputes (chargebacks) arrive in your Square Dashboard. Respond there with the receipt, the plate photos and the ticket history from ParkOps.

## 3. Connect Twilio (texts)

Set these values:

- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
- Either `TWILIO_FROM` (your number, like `+18175550100`) or `TWILIO_MESSAGING_SERVICE_SID`.
- `TWILIO_DISPLAY_NUMBER`: the number as it should appear on signs, like `(817) 555-0100`.

Before you send, register for A2P 10DLC in the Twilio console (brand plus a campaign for "customer care / account notifications").
Or use a verified toll-free number. US carriers block unregistered business texting.

In Twilio, open the number (or messaging service). Under "A message comes in", set the webhook to `https://your-domain/sms/inbound` (HTTP POST).
ParkOps checks Twilio's signature on every inbound text.

What gets texted, only to drivers who opt in: a receipt with an **add time** link, a reminder 15 minutes before paid time ends,
the pay link when a driver texts a lot number (**text-to-pay**), and card-declined or monthly billing alerts to account holders with a mobile number.
Twilio handles STOP, START and HELP automatically.

## 4. Locations, rates and QR lots

**Locations → Edit** sets up each location.

- **How drivers pay:** plate cameras (pay on exit, autopay, exit desk) or QR code / text-to-pay signs (pay by plate before walking away).
- **Lot number:** a short number like `4201`. It goes on the signs and is what drivers text.
- **Rates:** price per increment ($3 per 30 minutes, $2 per hour…) or a rate table (`30=3, 60=5, 120=9, 180=12`; stays past the last step pay the daily max).
- **Daily maximum and parking day:** either a day that resets at a set time (3 AM is common downtown) or a rolling 24 hours from arrival. Each day is capped at the maximum.
- **Rate snapshot:** every ticket keeps a copy of the rates it started under. Changing rates only affects new arrivals; the ticket page says when a ticket is on older rates.
- **Grace period, reserved section, valet fee, Square Terminal device, count adjustment.**

**Rates & specials** adds flat-rate specials (early bird, evening, weekend, event dates). A driver always pays the lower of the special and the regular rate. Holidays turn off specials, except event specials.

**Pay sign** (QR lots) prints a sign with the QR code, the lot number, the web address, the text-to-pay line and your rates, plus a warning about fake QR stickers and an optional tow-notice block. Print on letter paper or save as a PDF for a sign shop; download the QR as SVG.

**Texas tow signs:** tow-away signs have their own size, wording, color and placement rules (Occupations Code ch. 2308 and TDLR). Use ParkOps signs for payment and have your towing company install the separate tow-away signs.

**Sales tax:** Settings has the rate (default 8.25%, the usual Texas state + local rate) and whether posted prices include it. Receipts say "Price includes $x sales tax" (or itemise it). Texas taxes parking as a taxable service; file from **Reports → Sales tax** with your accountant.

## 5. The exit desk and tickets

**Self-parking → Exit desk** is built for the booth:

- Type the plate, ticket number, key tag or phone and press **Enter**. The car's ticket shows the amount due, arrival, time parked and the price broken down by parking day.
- **Collect** takes cash (with change due), card on an external reader, or check. **Square Terminal** pushes the amount to the paired device. **Card on file** charges an autopay account. **Validation code** applies a code. **Let out unpaid** closes the ticket and leaves the balance for collections.
- Press **Enter** again on the car on screen to open Collect; **F2** clears for the next car. Receipts print on a 3-inch printer or the print dialog, with the sales-tax line.
- If a rate increment ticks over while the driver is paying, the amount they were quoted stands.

**Tickets** lists everything with filters and a CSV export. A **ticket page** shows the visit, the bill, payments and a full history (who did what, when), and offers every action: collect, Terminal, card on file, validation apply / replace / remove, waive, adjust fee, reopen, close, correct plate, note, receipt, parking charge notice, send to plate review. Actions that change money after the fact need a reason and the manager role.

**Vehicles** shows a plate's whole history, balance and hot-list status. **VIP list** holds plates that park free or should be recognised. **New ticket** opens a manual ticket for a lost ticket or a car the cameras missed, with the arrival time the driver gives you.

## 6. Validations and tenants

- Codes have a **type** (free hours counted from the original arrival, percent off, dollars off, flat price, or full stay), a **redemption window** (valid from / until) that is separate from what the code covers, optional **usage limits**, and the **locations** they work at.
- One code per visit. Staff can **replace** a code with a reason (manager role); replacements and removals are kept in the ticket history and the Waived & adjusted report.
- **Validation-code occupancy** (Validations tab, and Reports) shows how many cars with a code were parked at the same time, per day, with the tickets behind the number. A car counts from its arrival even if the code was applied later; cars still parked count until now; visits open longer than the flag hours (Settings, default 24) are highlighted as possible missed exits.
- **Tenants** with an allotment (for example a restaurant's valet company with 30 spaces) get a daily peak, overage count and overage charge, exportable for their bill.

## 7. Monthly parking

- **Plans:** price, reserved or unreserved, spots for sale (the rest join a waitlist), vehicles per parker, where valid, sold online or not.
- **Drivers** sign up in the portal with an account and a saved card. The first month is prorated; after that the card is charged on the 1st.
- **Companies** pay by Square invoice or a company card on file, and get a private link to add and remove employees.
- **Import CSV** (Monthly tab) loads parkers from a spreadsheet with a preview: name, plates, plan (required), email, phone, company, paid through, number, notes. Plans and companies are matched by name, plates already on an active monthly are skipped, nothing is charged.
- **Office-billed** parkers are added with **Add monthly parker → Paid at the office** and **Record payment** each month.
- **Failed payments:** past due and emailed/texted, retried every two days, suspended with a late fee after the grace days; a driver can pay from their account to reactivate. An unpaid company invoice suspends that company's parkers after the same grace period.
- **Waitlist:** **Approve** when a spot opens. **Run billing now** runs the monthly billing on demand; it never charges twice.

## 8. Cameras (LPR garages)

**Hikvision ANPR:** *Configuration → Network → Advanced → HTTP Listening* (or *Alarm Server*): Host = your domain, URL = `/lpr/<lane token>`, port 443, HTTPS; turn on **Notify Surveillance Center / Upload to Center** in the ANPR event. ParkOps reads `<licensePlate>` and `<confidenceLevel>` and saves the plate picture.

**Axis License Plate Verifier:** *Settings → Integration → Push events*: HTTP POST, JSON, URL `https://your-domain/lpr/<token>`; turn on image sending for photos. Only `carState: new` is counted.

**Anything else:** `https://your-domain/lpr/<token>?plate=ABC1234`. Test with `curl`, or simulate traffic with `BASE=https://your-domain ENTRY=<token> EXIT=<token> npm run simulate -- 20`.

**Plate review** holds anything the cameras got wrong instead of billing it: exits read one character off or with look-alike characters, missed exits, exits with no entry, unreadable plates, cars on site too long, quiet cameras. Each has plain decisions (same car / different car, bill one day / no charge, set arrival / dismiss).

## 9. Driver portal, reservations, valet, ratings

- **Pay & look up:** pay by plate for any length or all day, optional text receipt and reminder, look up a plate, apply a validation code.
- **Accounts:** up to 5 plates, a saved card, autopay on exit at camera garages, monthly parking, reservations, receipts, pay everything owed. A plate added to an account only covers visits from then on.
- **Reservations:** a guaranteed spot in the reserved section for a fee; parking is billed at the normal rate on exit; cancellations before the cutoff are refunded automatically.
- **Valet:** park a car with key tag, space and vehicle; the board moves it through requested → retrieving → ready → handed over, with the runner's name and the payment at handoff. The valet fee is per location.
- **Ratings:** every receipt offers 1–5 stars and a comment; one rating per visit. See **Reports → Ratings**.

## 10. Collecting on unpaid exits

Each unpaid exit moves through these steps. The server checks every 5 minutes.

1. **Notice:** emailed right away (and texted when there's a number) to any account holding that plate, or to the reservation email.
2. **Reminder** halfway through the grace period (Settings, default 48 hours).
3. **Late fee** at the end of the grace period (default $10).
4. **Parking charge notice** after the set number of hours (default 96): the balance plus the UNPAID charge, with the camera photos attached.

Other tools: **next visit** (an autopay account's next exit also settles old balances), the **hot list** (plates owing over a set amount or with several open notices; an alert when one enters, "boot or tow eligible" in the officer view), and the **collections export** (Payments tab).
Collections agencies get the registered owner from the DMV under the federal DPPA and must follow the FDCPA. ParkOps doesn't do owner lookups.

On private property a "citation" is a **parking charge notice** under the terms posted at the entrance, not a government citation. Printed notices say so. Post the rates and the unpaid-parking charge where drivers enter, and have a Texas attorney review your wording and your booting and towing practices.

## 11. Notices: photos and Zebra printing

- Camera plate photos are attached to notices automatically. Officers add their own photos with the phone camera.
- Drivers see the photos when they look up the notice (QR code or `/c/<notice number>`). Other photos are staff-only.
- **Enforcement grace:** a car whose paid time ended within the grace minutes (default 10) shows "Expired, within grace" instead of suggesting a notice.
- **Zebra ZQ printers (ZQ320, ZQ520, ZQ620 and similar):** in **Chrome on an Android phone**, tap **Print on Zebra (Bluetooth)** and pick the printer the first time (its name is usually its serial number). Bluetooth Low Energy must be on. iPhone Safari can't reach Bluetooth printers; use **Print dialog** with an AirPrint printer.

## 12. People, roles and access

**Settings → People & access** (owner only):

| Role | Can |
|---|---|
| Owner | Everything, including staff accounts |
| Manager | Everything except staff accounts |
| Attendant | Exit desk, tickets, validations on tickets, valet, notices, reservations. Not: waive, adjust, reopen, replace validations, complimentary parking, backdated departures |
| Accountant | Reports, payments, refunds, monthly billing, exports |
| Viewer | Read-only |

- Roles are enforced by the server on every request; the console also greys out what a role can't do.
- **Invite staff** emails a link to choose a password (valid 7 days, works once). The screen says "emailed" only when the email really went out; otherwise it shows you the link to pass on. Resend from the list.
- Attendants and below never receive camera webhook tokens, company portal links or invoices (accountants see invoices).
- Sessions last 12 hours. Six failed sign-ins lock an account for 15 minutes. Passwords are hashed with scrypt.

## Reliability and security

- **Money:** per-record locks stop two payments for the same ticket from racing; idempotency keys make retries safe; a Terminal payment is applied exactly once even if two screens poll it; if the price changed since the driver saw it, the charge is refused with the new amount; a payment that succeeds but can't be saved triggers an alert email.
- **Activity log:** every staff change, payment, refund, export, billing run and sign-in, with who and when. Webhook and portal tokens are never written to it, and one-time links are redacted from the email/text outboxes.
- **Backups:** automatic daily copy of the database (last 14 kept), plus **Download a backup now**. Also turn on your host's disk snapshots and store a downloaded backup somewhere else weekly.
- **Alerts** go to the alert email in Settings when a lane camera goes quiet during operating hours, a hot-list plate enters, an invoice fails, or a backup fails.
- **Web protections:** HTTPS headers, a content security policy, a required header on every change, rate limits on sign-in, look-ups, uploads and payments, signed Twilio webhooks, private tokens for camera URLs, add-time links and company links.
- **Photos** are kept `PHOTO_RETENTION_DAYS` (default 90), except photos on notices.
- **Health check:** `/health` returns `{ok:true}`; with `HEALTH_TOKEN` set, `/health?token=…` also shows payment mode, email, texting, last backup and each camera's last read. Point an uptime monitor at it.
- **Sample data:** the first start creates two starter locations marked as samples. Remove samples in **Settings → Records** before going live.

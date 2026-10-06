# ParkOps server

Parking operations for downtown garages and lots, in one small Node app:

- Camera (LPR) garages and QR-code pay-by-plate lots.
- An exit desk for the booth: find the car, collect cash, card, check or Square Terminal, print the receipt.
- Every visit is a ticket with a rate snapshot, a per-day price breakdown, validations and a full history.
- Monthly parking for individuals and for **accounts** (a building, company or garage with its own block of parkers, plans, location and limit), with pasted-list and CSV import, waitlists, automatic renewal reminders, billing and Square invoices.
- **By day:** pick any day in the past (yesterday, last 7 or 30 days, last month, or your own dates) and see cars in and out, busiest hours, and money collected, per location.
- Validation codes (free time, percent, dollar, flat price, full) and validation-code occupancy reports for tenant allotments.
- Valet board, VIP list, reservations, driver ratings.
- Roles (owner, manager, attendant, accountant, viewer) enforced by the server, with emailed invitations.
- 23 reports with CSV export: revenue, payments, shift close-out, waived, A/R aging, sales tax, occupancy, exits, customers & vehicles, monthly, invoices, VIP, ratings, validations, code occupancy, tenant allotments, notices, reservations, staff.
- Square payments, invoices, Terminal, Apple Pay and Google Pay. Twilio texts. Photo evidence and Zebra notice printing.
- **Enforcement from an iPhone or iPad:** hold the phone over plates, ParkOps reads each one, checks it against permits, payments and open notices, and shows OK, Check or Violation. The officer confirms the plate, issues the notice and prints it on a Zebra printer (needs a plate-reading service, see section 11).
- **Patrol log:** every plate officers check is kept, so you can pick any day and location and see the violators (with their notices) and the vehicles that were fine (and why), plus the week and each officer's numbers.

Setup:

- There are no packages to install. It needs **Node 22.13+**, which has SQLite built in.
- All data lives in `DATA_DIR`: the database, daily backups and photos. Put it on a persistent disk. Every ticket, plate, payment and change is kept forever (see *Records kept forever* below).
- Run **one** instance. The live count is kept in memory and written through to the database.

## What has been verified, and what has not

Be straight with your client about this. Everything below the line is implemented to the vendors' documentation but has **not** been run against real accounts or hardware yet.

| Area | Status |
|---|---|
| Exit desk, tickets, validations, valet, reports, roles, invitations, CSV import, reservations, monthly billing, collections, accounts and their limits, the By day views, exports | Verified: 500+ automated end-to-end checks run in a browser or over the API against this server (`test/`), plus the rules tests (`test_rules*.js`). |
| Thousands of cars a day and thousands of monthly parkers | Measured on this server with pretend Square, Resend and Twilio, on a database of 272,000 tickets (details in *Scale and limits* below). **Not yet run on Render itself or with the real providers.** |
| Reminder, receipt and notice emails and texts at volume | Paced under the providers' limits and retried when they say "slow down"; tested against local stand-ins for Resend and Twilio. Your real speed depends on your Resend plan and your Twilio registration. |
| Square card payments, saved cards, refunds, invoices, **Terminal** checkouts | Verified against a **mock** of Square's API (request shapes, idempotency keys, statuses). **Not yet run against Square's sandbox or production.** Do the sandbox test in step 2 before going live. |
| Twilio texts (receipts, reminders, text-to-pay) | Implemented and tested against a mock; not yet sent through a real Twilio account (A2P registration is required first). |
| Hikvision and Axis camera pushes | Parsers tested with sample payloads; not yet tested with a physical camera. Use the test read and `npm run simulate` to rehearse. |
| Zebra ZQ Bluetooth printing | ZPL output checked for structure; not yet printed on a physical printer. The print dialog path works with any printer. |
| Live plate scanning on iPhone / iPad (camera screen, "is it a violator", issue and print) | The screen, the checking, the frame-saving rules, the notice and the printing steps are tested with a **simulated** camera, a **simulated** Zebra and a **stand-in** plate reader, at iPhone and iPad sizes (`test/e2e10.mjs`). **Not yet tried on a real iPhone, in Bluefy, with a real Zebra or with Plate Recognizer.** How well plates are read, and how many scans each car costs, can only be learned on real plates. Plan a half-day of trial patrols before relying on it. |
| Apple Pay / Google Pay | Buttons appear only where the device supports them; not yet exercised with a real wallet. |

## 1. Deploy (about 20 minutes)

**Render (about $9.50/month: $7 for the server plus $2.50 for a 10 GB disk)**

1. Put this folder in a GitHub repository: `GITHUB_TOKEN=<token> bash scripts/github-push.sh` creates the repository and pushes, or upload the files yourself on github.com (**Add file → Upload files**, dragging in the *contents* of this folder so that `render.yaml` and `server.js` sit at the top level, not inside a sub-folder, and not as a zip). If the upload lost the folders (every file at the top level), the server still runs: `server.js` looks for `lib/` and `public/` files beside itself when the folders are missing. To tidy the repository later, create `.github/workflows/tidy.yml` on GitHub with the contents of `scripts/tidy-upload.yml`: it moves everything back into place once and deletes itself.
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
- **Paying ahead online:** turn it off for a pay-on-exit garage. The garage leaves the driver page's "Pay to park" list and the server refuses prepay there; drivers are charged for the whole visit when they leave.
- **Pay buttons on the driver page:** *Hours, then All day* (default); *Hours until the daily max, then one "N+ hrs" button* that pays for the rest of the parking day (for example $10/hour with a $40 cap shows 1, 2, 3 hours, then "4+ hrs" good until the reset); or *One "All day" price* for flat-rate lots (a rate table of `1440=10` with a $10 daily max reads "$10.00 all day").
- **Status:** a location set to *Closed (hidden from drivers)* still holds monthly plans (for example a monthly-only lot) but never appears in the driver's location list.
- **Spaces available** (Overview, Occupancy) = total spaces − visitors parked − the location's active monthly parkers − count adjustment. Every active monthly parker holds a space at their plan's location (the first one when a plan covers several), parked or not; a monthly car the cameras see inside its own location is part of that hold, so it isn't counted twice. The "almost full" alert uses the same number.

**Rates & specials** adds flat-rate specials (early bird, evening, weekend, event dates). A driver pays the lower of the special and the regular rate, unless the special is set to **charge exactly this price** (the *Event* preset does this). Holidays turn off specials, except event specials.

**Event nights:** add an *Event* special per event night with its date, the time event pricing starts and the price ($25 flat, leave by the 3 AM reset the next day). A car that enters inside that window pays the flat price however short its stay; one still inside after the reset pays the regular rate for the new day on exit. At the exit desk an event-night ticket shows **Collect $25 event rate** (cash, card or Square Terminal) so attendants collect at the entrance; the ticket stays open and the exit is already paid. Validation codes are refused on event nights unless the code is marked **Works on event nights**; those stays get the code's free time, then regular rates on exit.

**Pay sign** (QR lots) prints a sign with the QR code, the lot number, the web address, the text-to-pay line and your rates, plus a warning about fake QR stickers and an optional tow-notice block. Print on letter paper or save as a PDF for a sign shop; download the QR as SVG.

**Texas tow signs:** tow-away signs have their own size, wording, color and placement rules (Occupations Code ch. 2308 and TDLR). Use ParkOps signs for payment and have your towing company install the separate tow-away signs.

**Sales tax:** Settings has the rate (default 8.25%, the usual Texas state + local rate) and whether posted prices include it. Receipts say "Price includes $x sales tax" (or itemise it). Texas taxes parking as a taxable service; file from **Reports → Sales tax** with your accountant.

## 5. The exit desk and tickets

**Self-parking → Exit desk** is built for the booth:

- Type the plate, ticket number, key tag or phone and press **Enter**. The car's ticket shows the amount due, arrival, time parked and the price broken down by parking day.
- **Collect** takes cash (with change due), card on an external reader, or check. **Square Terminal** pushes the amount to the paired device. **Card on file** charges an autopay account. **Validation code** applies a code. **Let out unpaid** closes the ticket and leaves the balance for collections; it is for managers and owners only and always needs a typed reason (kept on the ticket with their name). An attendant can close a ticket only by collecting everything owed, so a token payment can't be used to wave a car out.
- Press **Enter** again on the car on screen to open Collect; **F2** clears for the next car. Receipts print on a 3-inch printer or the print dialog, with the sales-tax line.
- If a rate increment ticks over while the driver is paying, the amount they were quoted stands.

**Tickets** lists everything with filters and a CSV export. A **ticket page** shows the visit, the bill, payments and a full history (who did what, when), and offers every action: collect, Terminal, card on file, validation apply / replace / remove, waive, adjust fee, reopen, close, correct plate, note, receipt, parking charge notice, send to plate review. Actions that change money after the fact need a reason and the manager role.

**Vehicles** shows a plate's whole history, balance and hot-list status. **VIP list** holds plates that park free or should be recognised. **New ticket** opens a manual ticket for a lost ticket or a car the cameras missed, with the arrival time the driver gives you.

## 6. Validations and tenants

- Codes have a **type** (free hours counted from the original arrival, percent off, dollars off, flat price, or full stay), a **redemption window** (valid from / until) that is separate from what the code covers, optional **usage limits**, and the **locations** they work at.
- One code per visit. Staff can **replace** a code with a reason (manager role); replacements and removals are kept in the ticket history and the Waived & adjusted report.
- **Validation-code occupancy** (Validations tab, and Reports) shows how many cars with a code were parked at the same time, per day, with the tickets behind the number. A car counts from its arrival even if the code was applied later; cars still parked count until now; visits open longer than the flag hours (Settings, default 24) are highlighted as possible missed exits.
- **Tenants** with an allotment (for example a restaurant's valet company with 30 spaces) get a daily peak, overage count and overage charge, exportable for their bill.
- **Event nights:** each code has *Works on event nights* (default no). See section 4.
- **Repeat use:** a car that uses the same code again and again (default 3 or more times in 7 days; Settings) is listed under **Repeat use to review** on the Validations tab and in Needs attention. It is a flag for review, never a refusal.

## 7. Monthly parking

- **Plans:** price, reserved or unreserved, spots for sale (the rest join a waitlist), vehicles per parker, where valid, sold online or not.
- **Drivers** sign up in the portal with an account and a saved card. The first month is prorated; after that the card is charged on the 1st.
- **Accounts (a building, company or garage):** **Monthly → Accounts → Add account**. Give it a name and contact, the location(s) its parkers use, which plans it may use, and how many parkers it may have (empty = no limit). It pays by Square invoice or a company card on file. Open an account to see its parkers, add one, **add many at once** (paste name, email, plates and phone from a spreadsheet, check the preview, then add) or send its **private link** so the account's own manager can add and remove their people. The limit, the plans and the location are enforced everywhere (the console, the pasted list, the CSV import, direct edits and the link). Waitlisted parkers don't count toward the limit.
  Parkers the office adds are "already paid for this month" unless you choose to bill the rest of the month; parkers added through the link always get the rest of the month on the next bill. A private link can add at most 500 parkers a day (`PORTAL_ADDS_PER_DAY`), so a link that gets out can't flood the lot.
- **Import CSV** (Monthly tab) loads parkers from a spreadsheet with a preview: name, plates, plan (required), email, phone, company, paid through, number, notes. Plans and companies are matched by name, plates already on an active monthly are skipped, nothing is charged. It is a migration tool: it ignores a plan's "spots for sale" limit (so you can load everyone you already have) but still respects an account's own parker limit. Every parker gets their own number.
- **Office-billed** parkers are added with **Add monthly parker → Paid at the office** and **Record payment** each month.
- **Failed payments:** past due and emailed/texted, retried every two days, suspended with a late fee after the grace days; a driver can pay from their account to reactivate. An unpaid company invoice suspends that company's parkers after the same grace period.
- **Reminders:** every 15 minutes between 8 AM and 8 PM (your time zone) the server tells monthly parkers who pay for themselves: a **renewal notice** a few days before the 1st (Settings → how many days, default 5; 0 turns it off), a **card-expiring** notice when the saved card will expire before the next charge, and a **past-due** follow-up two days after a failed charge. Email, plus a text when they gave a mobile number (Settings can turn texts off). Each notice goes once per month. People an account pays for are never sent card reminders, and someone with no email and no mobile is skipped. If nobody could be reached, it waits a day before trying again.
- **Waitlist and availability:** **Approve** when a spot opens; the Overview tells you when spaces are free and people are waiting. **Run billing now** runs the monthly billing on demand; it never charges twice.

## 8. Cameras (LPR garages)

**Connecting a camera:** add one lane camera per entry and exit lane (Cameras → Add lane camera), then press **Connect**. It shows the lane's address, the steps, and the camera's status: *Waiting for first read*, *No plate in messages* (the camera reaches ParkOps but its message has no plate ParkOps can read; the last message is shown, images removed, so you can see what it sends), or the last plate read. ParkOps never connects to the camera: the camera sends to ParkOps, so it must be able to reach your ParkOps address over the internet (HTTPS, port 443). A camera's own web page can be saved on the camera as a link for reference.

**Hikvision ANPR:** *Configuration → Network → Advanced → HTTP Listening* (or *Alarm Server*): Host = your domain, URL = `/lpr/<lane token>`, port 443, HTTPS; turn on **Notify Surveillance Center / Upload to Center** in the ANPR event. ParkOps reads `<licensePlate>` and `<confidenceLevel>` and saves the plate picture.

**Axis License Plate Verifier:** *Settings → Integration → Push events*: HTTP POST, JSON, URL `https://your-domain/lpr/<token>`; turn on image sending for photos. Only `carState: new` is counted.

**Importing a camera export** (Cameras → Import reads): drag a CSV anywhere on the Cameras page, for example an Axis License Plate Verifier export. ParkOps guesses the plate, camera and date/time columns (a separate time column works too; Axis's `20261005 140322` timestamps are understood) and shows a preview where you fix any guess and match each camera name in the file to a lane. Nothing is saved until **Import**. Reads go in oldest first, 500 at a time, so entries and exits pair into visits that occupancy, unpaid-exit tracking and enforcement see. Times without a time zone are read as the computer's local time. Reads more than 2 hours old build visits but don't charge saved cards or send hot-list alerts.

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
- **Zebra ZQ printers (ZQ220, ZQ320, ZQ520, ZQ620 and similar, with Bluetooth Low Energy):** in **Chrome on an Android phone or tablet**, or in the free **Bluefy** browser on an iPhone or iPad, tap **Print on Zebra (Bluetooth)** (or **Connect printer** on the scan screen) and pick the printer the first time (its name is usually its serial number). **Safari on iPhone and iPad cannot reach Bluetooth printers at all** (Apple doesn't allow it), so ParkOps shows a short how-to for Bluefy instead. **Print dialog** still works from Safari with an AirPrint printer, but Zebra thermal printers aren't AirPrint printers.
- Set the paper width (2, 3 or 4 inch) under Settings → Notice printer paper.

### Scanning plates from an iPhone or iPad (live camera)

**What officers do.** Open ParkOps on the phone, choose **Enforcement**, tap **Start scanning**, allow the camera, and hold the yellow-cornered box over a plate. There is no photo to take. ParkOps looks at the picture itself and only sends a frame to the plate reader when it is sharp, steady and new, so walking along a row of cars reads each one. Each plate comes up as:

- **OK** (green): monthly parker, paid, VIP, ticket open, reservation holder.
- **Check** (amber): for example paid time ran out a few minutes ago and is still inside the grace period.
- **Violation** (red): no permit or payment, expired, wrong zone, with the reason, and a note if three or more notices are open or the plate is on the hot list.

The officer taps **Issue notice**, confirms the plate (the form shows how sure the reader was and offers the other likely readings for an unsure one), and the notice is saved with the camera frame as evidence. With a printer connected the button says **Issue and print**. Typing a plate always works and costs nothing, and **Read now** and **Every second** are there for hard plates. **Done** asks first if violators haven't been dealt with.

**The officer, not the camera, decides.** A reading can be wrong (0 for O, a dirty plate, a bumper sticker). Nothing is ever issued automatically. Reads the service is unsure of are flagged, and the form asks the officer to check the plate on the vehicle.

**Printing from iPhone or iPad.** Install **Bluefy** (free, App Store), open the ParkOps address in it, sign in, switch on the Zebra, and tap **Connect printer** once per shift. The camera works inside Bluefy too, so scanning and printing happen in one app. In plain Safari scanning works but printing doesn't. On Android, Chrome does both.

**What it needs, one time (the owner):**

1. Make an account at **platerecognizer.com** and copy the API token for their cloud (Snapshot) service.
2. In Render, open the parkops service, then Environment, add `PLATE_RECOGNIZER_TOKEN` with the token, and save. The Start scanning button appears for officers and managers. The token stays on the server; phones never see it.
3. Optional: `SCAN_MONTHLY_CAP` (default 60,000 scans a month), `PLATE_REGIONS` (default `us`; `us-tx` narrows reading to Texas plates), `PLATE_CONFIG`, `PLATE_CONCURRENCY` (default 6), `PLATE_RECOGNIZER_URL` (only if you run their on-premises container instead of their cloud).

**What it costs.** The plate-reading service bills per lookup, and every frame ParkOps sends is one lookup. At Plate Recognizer's published plan prices when this was written that is roughly a tenth of a cent each (about $50 a month per 50,000 lookups on their smallest paid plan; check their pricing page, because plans change, and their free tier is meant for trying it out, not for daily patrols). ParkOps aims for about one lookup per vehicle, but expect one to three while you learn what works at your lots. Two safeguards: the **monthly cap** (scanning stops at the limit, typing keeps working) and an **email to the alert address at 80% and at 100%**. Settings shows scans used this month and the last days.

**Privacy.** The part of the picture inside the box is sent to the plate-reading service to be read; check their data and retention settings for your account. ParkOps itself keeps a frame only when an officer issues a notice, as evidence attached to that notice (like any notice photo). Frames of cars that are fine are never stored by ParkOps.

**Tips and limits (please read).**

- Not tested on a real iPhone, in Bluefy, or on real plates. How sharp a plate has to be, how still the officer must hold the phone and how different a new car looks are settings at the top of `src/scan.js` (the `TUNE` block). If it reads too rarely or too often after a day of real patrols, those numbers are the knobs, and **Every second** mode and **Read now** are the quick fixes in the field.
- Works best in daylight, 3 to 12 feet from the plate, square-on. Glare, dirt, frames around plates and very dark lots lower accuracy; tap **Light** (where the phone allows it) at night.
- The phone needs a data signal. With no signal it keeps trying and says so, and typing a plate still checks it against what the phone already has, but notices can't be saved until the connection is back.
- The list of scanned vehicles lives on the phone for the patrol and is cleared when the scanner is closed. What each check found is saved on the server for the patrol log (below), and notices are saved as always.

### Patrol log: by day and location, violators and vehicles that were fine

Every plate an officer checks is saved with what the check found: plates typed on the Enforcement screen and plates read by the phone scanner. A doubtful scanner read that looks like a violation is saved only once the officer acts on it, so misreads don't show up as violators.

Open it from **Enforcement → Patrol log**, or **Operations → Notices → Patrol log**. Pick a day (‹ Earlier, Later ›, or the date box) and a location, or leave it on all locations. You see:

- **Totals:** vehicles checked, violators (with the number of notices and the fines written), vehicles not violating (and why: monthly parker, paid, validated, pays on exit, in grace), and vehicles flagged with no notice written.
- **By location:** the same numbers for each garage and lot. Click a row to see only that location.
- **The vehicles:** violators with their notice number, amount and status; flagged vehicles with no notice; and the vehicles that were fine, with the reason, the time and the officer. **All / Violators / Not violating** narrows the list.
- **The week:** the seven days ending on the chosen day. Click a day to open it.
- **By officer:** vehicles checked and notices written by each officer.
- **CSV:** the day's vehicles as a spreadsheet.

A car checked more than once the same day at the same location counts once; if any check found a violation, that's what it shows. Notices written at the exit desk for unpaid exits count as violators too. A voided notice (including an appeal you accepted) no longer counts. Days run midnight to midnight in the time zone in Settings. The Enforcement screen also shows today's numbers for the location being patrolled. Checks made before this update weren't saved, so the log starts on the day you install it; earlier notices still show by day.
- Beeps use the phone's sound; the iPhone's side silent switch can mute them. The screen also flashes and the box changes color.
- iPhone keeps the screen awake while scanning (iOS 16.4 and newer). On older iPhones set Auto-Lock to Never for the patrol.
- "Add to Home Screen" in Safari makes ParkOps open full-screen like an app. Printing still needs Bluefy.

## 12. People, roles and access

**Settings → People & access** (owner only):

| Role | Can |
|---|---|
| Owner | Everything, including staff accounts |
| Manager | Everything except staff accounts |
| Attendant | Exit desk, tickets, validations on tickets, valet, notices, reservations. Not: let a car out with money owed, waive, adjust, reopen, replace validations, complimentary parking, backdated departures |
| Accountant | Reports, payments, refunds, monthly billing, exports |
| Viewer | Read-only |

- Roles are enforced by the server on every request; the console also greys out what a role can't do.
- **Invite staff** emails a link to choose a password (valid 7 days, works once). The screen says "emailed" only when the email really went out; otherwise it shows you the link to pass on. Resend from the list.
- Attendants and below never receive camera webhook tokens, company portal links or invoices (accountants see invoices).
- Sessions last 12 hours. Six failed sign-ins lock an account for 15 minutes. Passwords are hashed with scrypt.

## Reliability and security

- **Money:** per-record locks stop two payments for the same ticket from racing; idempotency keys make retries safe; a Terminal payment is applied exactly once even if two screens poll it; if the price changed since the driver saw it, the charge is refused with the new amount; a payment that succeeds but can't be saved triggers an alert email.
- **Activity log:** every staff change, payment, refund, export, billing run and sign-in, with who and when. Webhook and portal tokens are never written to it, and one-time links are redacted from the email/text outboxes.
- **Backups:** automatic daily copy of the database (last 7 kept; `BACKUP_KEEP`), plus **Download a backup now**. The copies sit on the same disk, so download one now and then and keep it somewhere else too. If the disk runs short of room the app keeps fewer copies and emails the alert address instead of failing.
- **Alerts** go to the alert email in Settings when a lane camera goes quiet during operating hours, a hot-list plate enters, an invoice fails, or a backup fails.
- **Web protections:** HTTPS headers, a content security policy, a required header on every change, rate limits on sign-in, look-ups, uploads and payments, signed Twilio webhooks, private tokens for camera URLs, add-time links and company links.
- **Photos** are kept `PHOTO_RETENTION_DAYS` (default 90), except photos on notices. Photos are the only thing that fills a disk quickly.
- **Health check:** `/health` returns `{ok:true}`; with `HEALTH_TOKEN` set, `/health?token=…` also shows payment mode, email, texting, last backup and each camera's last read. Point an uptime monitor at it.
- **Sample data:** the first start creates two starter locations marked as samples. Remove samples in **Settings → Records** before going live.

## 13. Records kept forever

Nothing about a ticket is ever deleted automatically: every ticket (plate, arrival, departure, charge, payments, validation, notes and the change history), every payment, every notice, every camera read and the whole activity log stay in the database until you delete them. The only automatic clean-ups are plate photos (`PHOTO_RETENTION_DAYS`, default 90, except photos on notices), old backup copies (`BACKUP_KEEP`), and expired sign-in sessions.

- **History tab** (hosted version): search every ticket ever recorded by plate (any part of it) or ticket number, filter by location, status and date, open a read-only record with its payments and history, and export the results as a CSV. The other screens load only the last `KEEP_IN_MEMORY_DAYS` days (default 90) of finished tickets so they stay fast; History reads the database directly, so a ticket from three years ago is found the same way as one from today. Attendants, managers, accountants and owners can search; exporting needs the export permission.
- **By day** (hosted version): any day in the past, per location or all together: cars in, cars out, average time parked, busiest hours, cars that left without paying, and money collected (parking, monthly, notices, refunds, sales tax, how people paid). Pick Yesterday, Today, Last 7 days, Last 30 days, Last month or your own dates; use **Summary (CSV)** for the table and **Every payment (CSV)** for each individual payment in the range (up to about two years at a time). Complimentary parking is listed but never counted as money. Whole past days are counted once and remembered, so repeat looks are instant; today is always counted fresh. Days follow your time zone.
- **How much space it uses:** about 0.7 KB per ticket. 300,000 tickets (roughly a year at 800 a day) is about 220 MB. Measured with 272,000 tickets: the History page opens in about 25 ms, a plate search takes about 2 seconds, and exporting every ticket ever takes about 25 seconds (it downloads while you wait; other screens keep working).
- **Settings → System** shows how many tickets are saved, since when, how much space the records, backups and photos use and how much of the disk is free. When free space drops below 15% of the disk or 2 GB (whichever is smaller), or under 200 MB, the alert email is sent; make the disk bigger in Render (Disks) before it fills. A disk can grow but not shrink.
- **Limits you can set** (all optional): `RETAIN_READ_DAYS` and `RETAIN_AUDIT_DAYS` cap raw camera reads and the activity log (empty = keep forever); `KEEP_IN_MEMORY_DAYS` raises or lowers how much the other screens load. On a 512 MB server keep it at 90 unless you have under about 150,000 tickets a year; each ticket on screen costs roughly 3 KB of memory.
- **Safety:** this is one database file on one disk. Download a backup from Settings regularly and keep it somewhere else too; a disk failure at the host would take the live copy and the on-disk backups together.

## 14. Scale and limits

Built for several garages and lots with thousands of plates a day and thousands of monthly parkers on one server. What was measured (this machine, a database with 272,000 tickets and 5,000 monthly permits, pretend Square / Resend / Twilio on the same machine):

| What | Result |
|---|---|
| 3,000 cars in and out (6,000 plate reads), 8 at a time | about 220 to 275 reads a second, median 25 ms, no errors. A 3,000-car day is a trickle. |
| Memory | about 170 MB idle, peak about 350 MB during the biggest possible export. Fits Render's $7 plan (512 MB). |
| By day: today / last 7 / last 30 days | 30 to 40 ms once warmed (the server counts the last 40 days in the background after each start and each night) |
| By day: a whole year, first look | about 4 seconds; the second look about 50 ms |
| Payments export, a year (262,000 payments) | about 3.5 to 8 seconds |
| Ticket history export, every ticket (272,000) | about 25 seconds |
| 1,000 monthly parkers imported, then all told their plan renews (email, plus text for a third) | about 12 seconds against the pretend providers. With real providers it takes as long as their limits allow (below). |
| 400 monthly parkers charged on the 1st, one card each, with a payment-processor hiccup on the first charge | all 400 charged, none twice, billing run again charged nobody |
| 1,000 monthly parkers in an account's pasted list | previewed and added in a few seconds |

**Busy nights: thousands of people at once.** Measured on a copy capped at Render's sizes, with 5,000 past visits on file and Square answering in 0.6 to 1.1 seconds. Each run squeezes an event night into one minute: drivers scan the lot QR signs, load the page, check prices, one in four pays and the rest look up their plate; garage cameras log an entry for every 1.3 drivers; 4 attendants collect the $25 event rate; 4 officers check plates; 12 staff screens on one office network stay live. Drivers share internet addresses the way they do downtown (venue Wi-Fi, phone carriers).

| Drivers arriving in one minute | Starter (0.5 CPU, 512 MB) | Standard (1 CPU, 2 GB) |
|---|---|---|
| 2,000 | 100% answered within a second | |
| 3,000 | 99.98% | |
| 5,000 | 99.6% (peak memory 268 MB) | 100% |
| 10,000 | 56%: falls behind, waits up to 70 s | 99.1% |
| 15,000 | | 63%: falls behind |

A real event night is far lighter: 2,000 cars over an hour is about 35 a minute. Card payments count as answered within 2 seconds, since Square itself takes about one.

What makes this work (version 5): driver limits count per plate on top of a high ceiling per address, so a crowd on one Wi-Fi isn't treated as one person; card payments from an address pause for 15 minutes only when at least 10 cards were declined there and declines were most of its attempts (card testing); driver pages don't hold a live connection, and staff screens have their own room (25 per person, none per address); tickets are indexed by plate; big staff-screen loads are compressed off the main thread; phones reuse the page they already have (ETag). **Settings → System → Visitor addresses** shows whether the server sees each visitor's own address; if it warns, set `CLIENT_IP_HEADER` as it says.

**How fast messages can go out.** Email and texts are paced so the provider never turns them away, and retried when it says "slow down". Defaults match the providers' starter limits: `EMAIL_PER_SEC=2` (Resend's default plan) and `SMS_PER_SEC=1` (one Twilio number). At those speeds 1,000 emails take about 8 minutes and 1,000 texts about 17 minutes; raise the settings when your plan allows more (a registered 10DLC campaign or a toll-free number sends faster). Anything a person is waiting for (a password reset, an invitation) goes ahead of bulk reminders. **Settings → Recent emails / texts** shows how many are waiting, sent and failed.
A message the provider might already have accepted is never sent twice: email carries a repeat-protection key, and a text is not retried after an unclear failure (a timeout or dropped connection), because a missed reminder is better than a double one.

**Other settings** (all optional, in the service's Environment tab):

| Setting | Default | What it does |
|---|---|---|
| `EMAIL_PER_SEC` / `SMS_PER_SEC` | 2 / 1 | messages a second to Resend / Twilio |
| `BILLING_CONCURRENCY` | 4 | cards charged at once on the 1st |
| `KEEP_IN_MEMORY_DAYS` / `KEEP_CLOSED_MAX` | 90 / 5000 | finished tickets the screens keep in memory (the cap wins on a very busy lot; everything stays in History and By day) |
| `PORTAL_ADDS_PER_DAY` | 500 | parkers one account link may add in 24 hours |
| `CLIENT_IP_HEADER` | (none) | a header your host puts the visitor's address in, for example `cf-connecting-ip`; only when Settings → System says it's needed |
| `RESEND_BASE_URL`, `TWILIO_BASE_URL` | the real ones | only for testing against a stand-in |

**Known limits and gaps. Read these before relying on it:**

- **Not tested on the real services.** Everything above ran against stand-ins for Square, Resend and Twilio and on a development machine, not on Render with real accounts. Run the sandbox steps in section 2 and send yourself a test reminder before real parkers depend on it.
- **One server, one database file.** If it restarts in the middle of sending a big batch, messages still waiting in memory are lost. Renewal and past-due reminders heal themselves (a notice is marked sent only after a provider accepts it, so the next 15-minute run sends what is missing), but a billing receipt that was waiting is not re-sent. Avoid deploying while the 1st's billing is running.
- **Provider limits are yours to manage.** Twilio needs A2P 10DLC registration or a toll-free number before US business texting works, and a single number is slow. Resend's free and starter plans cap daily volume.
- **Plan spots-for-sale are not enforced by the CSV import** (by design, for migrations). The console, the pasted list and the link all enforce them.
- **Money in By day comes from the payment ledger**: every card, Terminal, cash and check payment recorded through the app. Money taken any other way (outside ParkOps) isn't in it.
- **Older tickets are read-only on the other screens.** Past `KEEP_IN_MEMORY_DAYS` (or `KEEP_CLOSED_MAX` on a very busy lot) a finished ticket is opened from History. Refunds on those tickets still work and are written onto the ticket.
- **No second location server, no live failover.** A disk or host failure means restoring the latest backup (section 1); download one now and then and keep it somewhere else.

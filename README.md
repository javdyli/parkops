# Tests

Rules engine (no server needed): `node test/test_rules.js && node test/test_rules2.js && node test/test_rules3.js && node test/test_rules4.js`
(run from the folder that contains `src/`; the rules tests import `../src/rules.js` — adjust the path if you move them).

End to end (needs Playwright's Chromium: `npm i -D playwright && npx playwright install chromium`):

1. `node test/mock-square.js &` — a stand-in for Square (payments, cards, invoices, Terminal) and Twilio on port 8099.
2. `bash test/restart.sh` — starts the server on port 8092 against the mock with a fresh data directory.
3. `node test/e2e.mjs`, `node test/e2e3.mjs`, `node test/e2e4.mjs` — 49 + 66 + 127 checks; every line should say PASS and "page errors: none".

`e2e4.mjs` covers the v5 features: roles enforced on the server, invitations, the exit desk, ticket actions and audit trail,
Square Terminal checkouts and cancels, card on file, VIP plates, ratings, CSV import, reports and exports, and the review hardening.

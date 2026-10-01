/* Simulate camera traffic against a running ParkOps server, to check the live count before real cameras are connected.
   Usage: BASE=https://your-parkops.example ENTRY=<entry camera token> EXIT=<exit camera token> node scripts/simulate-cameras.js [cars]
   Tokens are the last part of each lane's URL on the LPR cameras page. */
const BASE = (process.env.BASE || 'http://localhost:8080').replace(/\/$/, '');
const ENTRY = process.env.ENTRY, EXIT = process.env.EXIT;
const CARS = +(process.argv[2] || 10);
if (!ENTRY || !EXIT) { console.error('Set ENTRY and EXIT to the camera tokens.'); process.exit(1); }
const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const plate = () => Math.floor(Math.random() * 9 + 1) + Array.from({ length: 3 }, () => L[Math.floor(Math.random() * L.length)]).join('') + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
const hik = p => `<?xml version="1.0" encoding="UTF-8"?><EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>${p}</licensePlate><confidenceLevel>${90 + Math.floor(Math.random() * 10)}</confidenceLevel></ANPR></EventNotificationAlert>`;
const send = async (token, p) => { const r = await fetch(`${BASE}/lpr/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: hik(p) }); return (await r.json()).result; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const inside = [];
  for (let i = 0; i < CARS; i++) {
    const p = plate(); inside.push(p);
    console.log('IN ', p, '→', await send(ENTRY, p)); await sleep(800);
    if (inside.length > 3 && Math.random() < 0.5) { const q = inside.shift(); console.log('OUT', q, '→', await send(EXIT, q)); await sleep(800); }
  }
  console.log(`${inside.length} simulated cars left inside. Record their exits from the Visitors page or let them stay.`);
})().catch(e => { console.error(e.message); process.exit(1); });

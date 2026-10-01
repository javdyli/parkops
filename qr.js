/* Small QR code encoder: byte mode, error correction level M, versions 1-10 (up to 213 bytes).
   Produces a boolean matrix and an SVG. Used for pay-here signs. */
(function (root) {
  'use strict';
  const EC_M = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1; let rt = 1;
    for (let i = 0; i < degree; i++) { for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], rt); if (j + 1 < r.length) r[j] ^= r[j + 1]; } rt = gmul(rt, 0x02); }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
    return r;
  }
  const utf8 = s => Array.from(unescape(encodeURIComponent(String(s)))).map(c => c.charCodeAt(0));

  function encode(text) {
    const bytes = utf8(text);
    let ver = 0;
    for (let v = 1; v <= 10; v++) {
      const cap = EC_M[v][1].reduce((a, [n, d]) => a + n * d, 0);
      if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= cap * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('Text too long for a QR code');
    const [ecLen, groups] = EC_M[ver];
    const cap = groups.reduce((a, [n, d]) => a + n * d, 0);
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let p = 0xec; data.length < cap; p ^= 0xec ^ 0x11) data.push(p);
    const div = rsDivisor(ecLen), blocks = [], ecs = [];
    let k = 0;
    for (const [n, d] of groups) for (let i = 0; i < n; i++) { const blk = data.slice(k, k + d); k += d; blocks.push(blk); ecs.push(rsRemainder(blk, div)); }
    const all = [];
    const maxD = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.length) all.push(b[i]); });
    for (let i = 0; i < ecLen; i++) ecs.forEach(e => all.push(e[i]));

    const size = ver * 4 + 17;
    const M = Array.from({ length: size }, () => new Array(size).fill(false));
    const F = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) { const dist = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, dist !== 2 && dist !== 4); } } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = ALIGN[ver], n = al.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = mask => {
      const d = (0 << 3) | mask; let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412, g = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, g(i));
      set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
    }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!F[y][x] && i < all.length * 8) { M[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => (x * y) % 2 + (x * y) % 3 === 0, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && masks[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let y = 0; y < size; y++) for (let axis = 0; axis < 2; axis++) {
        let run = 1;
        for (let x = 1; x < size; x++) { const a = axis ? M[x][y] : M[y][x], b = axis ? M[x - 1][y] : M[y][x - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      const pat = [true, false, true, true, true, false, true];
      for (let y = 0; y < size; y++) for (let x = 0; x + 7 <= size; x++) {
        if (pat.every((v, k) => M[y][x + k] === v)) p += 40;
        if (pat.every((v, k) => M[x + k][y] === v)) p += 40;
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (M[y][x]) dark++;
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return M;
  }
  function svg(text, opts) {
    const o = opts || {}, M = encode(text), q = 4, n = M.length + q * 2;
    let d = '';
    M.forEach((row, y) => row.forEach((v, x) => { if (v) d += `M${x + q},${y + q}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"${o.size ? ` width="${o.size}" height="${o.size}"` : ''} role="img" aria-label="${String(o.label || 'QR code').replace(/"/g, '')}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  const api = { encode, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ParkQR = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Demo backend. Runs entirely in the browser with made-up plants, so the app can be
// tried (and designed against) without touching the real sheet. Edits persist in
// this browser only.

const FIELDS = ['code', 'onHand', 'prevOrder', 'suggested', 'recv7', 'wks', 'soldLast', 'avgSold', 'ctAvail', 'name', 'size',
  'avail', 'future', 'ctgQty', 'picking', 'twoWks', 'crop', 'cgInv', 'feature', 'price', 'walk', 'watch', 'ast', 'zam',
  'lastZam', 'back', 'max4', 'ctCheck', 'onSale', 'special', 'neverOut', 'lowThr', 'barcode', 'part', 'listRow', 'checked',
  'count', 'recvCT', 'edited', 'by'];

const EDITABLE = new Set(['avail', 'future', 'ctgQty', 'picking', 'twoWks', 'crop', 'walk', 'watch', 'ast', 'zam', 'lastZam',
  'back', 'checked', 'count']);
const STAMP = ['avail', 'future', 'ctgQty', 'twoWks'];
const KEY = 'cg.demo.v1';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLANTS = [
  ['Aglaonema', ['Silver Bay', 'Red Gold', 'Moonlight', 'Pink Dalmatian', 'Spring Snow', 'Cutlass', 'Jubilee']],
  ['Alocasia', ['Polly', 'Frydek', 'Zebrina', 'Bambino', 'Cuprea', 'Dragon Scale']],
  ['Calathea', ['Orbifolia', 'Medallion', 'Ornata', 'Rattlesnake', 'White Fusion', 'Zebrina']],
  ['Dracaena', ['Lemon Lime', 'Warneckii', 'Janet Craig', 'Tricolor', 'Lisa']],
  ['Ficus', ['Audrey', 'Tineke', 'Burgundy', 'Ruby', 'Lyrata Bambino', 'Elastica Shivereana']],
  ['Hoya', ['Carnosa Krimson Queen', 'Kerrii', 'Pubicalyx', 'Linearis', 'Australis']],
  ['Monstera', ['Deliciosa', 'Adansonii', 'Thai Constellation', 'Albo', 'Peru']],
  ['Peperomia', ['Watermelon', 'Obtusifolia', 'Rosso', 'Hope', 'Prostrata']],
  ['Philodendron', ['Brasil', 'Birkin', 'Pink Princess', 'Micans', 'Selloum', 'Moonlight', 'Imperial Green']],
  ['Pothos', ['Marble Queen', 'Neon', 'Jade', 'Manjula', 'Cebu Blue', 'Golden']],
  ['Sansevieria', ['Moonshine', 'Laurentii', 'Whitney', 'Cylindrica', 'Black Gold']],
  ['Schefflera', ['Amate', 'Gold Capella', 'Arboricola Trinette']],
  ['Syngonium', ['Neon Robusta', 'Albo', 'Mojito', 'Pink Allusion', 'Confetti']],
  ['Tradescantia', ['Nanouk', 'Zebrina', 'Tricolor', 'Fluminensis']],
  ['Begonia', ['Maculata', 'Rex Escargot', 'Angel Wing', 'Brevirimosa']],
  ['Anthurium', ['Clarinervium', 'Crystallinum', 'Red King', 'Warocqueanum']]
];
const SIZES = ['4in', '4in', '4in', '4in', '2in', '2in', '2in', '6in', '6in', '8in', '10in'];
const USERS = ['Maria', 'Sam', 'Priya'];
const NOTES = ['', '', '', 'H4', 'H3 117', 'Bench 12', 'Front row', 'H2 shade', 'Check tags', 'H5'];
const CROPS = ['', '', '', '', '', '', '', '', '', 'sell assorted only', 'jewel orchid', 'from Nursery B 80/177', 'label assorted'];

function seedData() {
  const r = rng(20261029);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const items = [];
  const now = Date.now();
  const used = new Set();
  let row = 4;
  for (const [genus, vars] of PLANTS) {
    for (const v of vars) {
      const sizeCount = r() < 0.5 ? 2 : 1;
      for (let s = 0; s < sizeCount; s++) {
        const size = pick(SIZES);
        const name = `${genus} ${v} - ${size}`;
        if (used.has(name)) continue;
        used.add(name);
        const avail = r() < 0.27;
        const future = !avail && r() < 0.25 ? true : r() < 0.06;
        let ctgQty = null;
        if (avail) ctgQty = r() < 0.18 ? 0 : pick([10, 20, 30, 40, 60, 100, 150]);
        else if (r() < 0.5) ctgQty = 0;
        const twoWks = avail || future ? (r() < 0.5 ? pick([0, 50, 100, 200]) : 0) : (r() < 0.2 ? 0 : null);
        const code = (size.replace('in', '') + genus.slice(0, 3) + v.replace(/[^A-Za-z]/g, '').slice(0, 3)).toLowerCase();
        const age = r();
        let edited = null;
        if (age < 0.08) edited = new Date(now - Math.floor(r() * 6) * 3600000 - 600000).toISOString();
        else if (age < 0.16) edited = new Date(now - 86400000 * (1 + r()) ).toISOString();
        else if (age < 0.88) edited = new Date(now - 86400000 * (2 + Math.floor(r() * 140))).toISOString();
        const onHand = r() < 0.75 ? Math.floor(r() * 90) : null;
        items.push({
          row: row,
          v: {
            code, onHand, prevOrder: r() < 0.08 ? pick([10, 20, 50]) : null,
            suggested: r() < 0.08 ? pick([10, 20, 40]) : 0, recv7: r() < 0.2 ? pick([0, 0, 18, 40]) : 0,
            wks: r() < 0.5 ? pick([1, 3, 4]) : null, soldLast: r() < 0.5 ? Math.floor(r() * 30) : null,
            avgSold: r() < 0.5 ? Math.round(r() * 2500) / 100 : null, ctAvail: onHand === null ? null : Math.max(0, onHand - Math.floor(r() * 6)),
            name, size, avail, future, ctgQty, picking: pick(NOTES), twoWks, crop: pick(CROPS),
            cgInv: r() < 0.8 ? Math.floor(r() * 300) : null, feature: '', price: r() < 0.75 ? Math.round((8 + r() * 52) * 4) / 4 : null,
            walk: r() < 0.01, watch: r() < 0.04, ast: r() < 0.15, zam: r() < 0.1 ? pick([10, 15, 20]) : null,
            lastZam: r() < 0.1 ? pick(['10', '20', '25', '50']) : '', back: r() < 0.03 ? '11/12/26' : '',
            max4: r() < 0.12 ? Math.round(r() * 3000) / 100 : null, ctCheck: r() < 0.04, onSale: r() < 0.02,
            special: null, neverOut: r() < 0.06, lowThr: r() < 0.3 ? pick([3, 5, 9]) : null,
            barcode: r() < 0.8 ? String(860001000000 + Math.floor(r() * 999999)) : '', part: Math.floor(r() * 150),
            listRow: 2000 + Math.floor(r() * 4000), checked: r() < 0.35, count: r() < 0.01, recvCT: 0,
            edited, by: edited ? pick(USERS) : ''
          }
        });
        row += 1 + (r() < 0.18 ? 1 : 0);
      }
    }
  }
  return { items, seq: 0, log: [] };
}

let db = null;
function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { db = JSON.parse(raw); return db; }
  } catch (e) { /* fall through */ }
  db = seedData();
  persist();
  return db;
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export async function handle(body) {
  const { ApiError } = await import('./api.js');
  try {
    return await run(body);
  } catch (e) {
    throw new ApiError(e.code || 'SERVER', e.message);
  }
}

async function run(body) {
  const d = load();
  switch (body.a) {
    case 'info':
      return { ok: true, codeRequired: false };
    case 'login': {
      await wait(300);
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (name.length < 2) { const e = new Error('Please enter your name (at least 2 letters).'); e.code = 'BAD_REQUEST'; throw e; }
      d.me = name; persist();
      return { ok: true, session: { token: 'demo', exp: Math.floor(Date.now() / 1000) + 86400 * 30 }, user: { email: name, name } };
    }
    case 'ping':
      return { ok: true };
    case 'load':
      await wait(jitter(250, 600));
      return {
        ok: true, seq: d.seq, fields: FIELDS, serverTime: new Date().toISOString(),
        rows: d.items.map((it) => [it.row, ...FIELDS.map((k) => (k in it.v ? it.v[k] : null))])
      };
    case 'changes': {
      await wait(jitter(80, 200));
      const since = Number(body.since) || 0;
      if (since >= d.seq) return { ok: true, seq: d.seq, changes: [] };
      return { ok: true, seq: d.seq, changes: d.log.filter((c) => c.seq > since) };
    }
    case 'save': {
      await wait(jitter(250, 700));
      const results = [];
      for (const op of body.ops || []) {
        const it = d.items.find((x) => x.v.name === op.name);
        if (!it) { results.push({ id: op.id, ok: false, error: 'ROW_MOVED', message: `"${op.name}" can no longer be found in the sheet. Refresh and try again.` }); continue; }
        const changedKeys = [];
        const fields = {};
        const bad = Object.keys(op.set || {}).find((k) => !EDITABLE.has(k));
        if (bad) { results.push({ id: op.id, ok: false, error: 'BAD_REQUEST', message: `Field "${bad}" cannot be edited.` }); continue; }
        for (const [k, val] of Object.entries(op.set || {})) {
          if (it.v[k] !== val) changedKeys.push(k);
          fields[k] = val;
        }
        if (changedKeys.length) {
          for (const k of changedKeys) it.v[k] = fields[k];
          if (changedKeys.some((k) => STAMP.includes(k))) { it.v.edited = new Date().toISOString(); fields.edited = it.v.edited; }
          it.v.by = d.me || 'Demo'; fields.by = it.v.by;
          d.seq += 1;
          d.log.push({ seq: d.seq, row: it.row, name: it.v.name, f: fields, by: it.v.by, ts: Date.now() });
          if (d.log.length > 250) d.log.shift();
        }
        results.push({ id: op.id, ok: true, row: it.row, fields, changed: changedKeys.length > 0 });
      }
      persist();
      return { ok: true, results, seq: d.seq };
    }
    default:
      throw fail('BAD_REQUEST', 'Unknown action.');
  }
}

/** Used by the "Reset demo" link in tests. */
export function resetDemo() {
  db = null;
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

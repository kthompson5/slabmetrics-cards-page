// ESM, Node core + csv-parse
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseCSV } from 'csv-parse/sync';

const ROOT = process.cwd();
const DIRS = {
  data: path.join(ROOT, 'data'),
  public: path.join(ROOT, 'public'),
  templates: path.join(ROOT, 'templates'),
  dist: path.join(ROOT, 'dist')
};

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function copyPublic() {
  if (!exists(DIRS.public)) return;
  fs.cpSync(DIRS.public, DIRS.dist, { recursive: true });
}

/* ---------------- Helpers ---------------- */
function pctOf10(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round((v / 10) * 100)));
}
function avg(values) {
  const arr = Array.isArray(values) ? values : Object.values(values ?? {});
  const nums = arr.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
}
function oneDec(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return (Math.round(v * 10) / 10).toFixed(1);
}
function toNum(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}
function toPct0to100(n) {
  // Accept 92 or 0.92 and normalize to 0..100 integer
  if (n == null || n === '') return 0;
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}
function todayISO() {
  return new Date().toISOString().slice(0,10);
}
function toNumLoose(n, def = 0) {
  // Accept "1,234" → 1234    "  1234  " → 1234
  if (n == null || n === '') return def;
  const s = String(n).replace(/[^0-9.]/g, ''); // strip commas, spaces, etc.
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : def;
}
function toRate0to100(n, def = 0) {
  // Accept "42%" → 42, "0.42" → 42, "42" → 42
  if (n == null || n === '') return def;
  const raw = String(n).trim();
  const hadPct = raw.includes('%');
  const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(num)) return def;
  if (hadPct) return Math.max(0, Math.min(100, num));
  return num <= 1 ? Math.round(num * 100) : Math.round(num);
}
/* --------------- Loaders ----------------- */
function loadJSONCards() {
  const cardsFile = path.join(DIRS.data, 'cards.json');
  let cards = [];

  if (exists(cardsFile)) {
    try {
      cards = JSON.parse(read(cardsFile));
    } catch (e) {
      console.error('[build] Failed to parse data/cards.json\n', String(e));
      const preview = read(cardsFile).slice(0, 300);
      console.error('Preview:\n', preview);
      process.exit(1);
    }
  } else {
    // Load any *.json in data/ if cards.json missing
    if (exists(DIRS.data)) {
      const files = fs.readdirSync(DIRS.data).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try {
          const obj = JSON.parse(read(path.join(DIRS.data, f)));
          if (Array.isArray(obj)) cards.push(...obj); else cards.push(obj);
        } catch (e) {
          console.warn('[build] Skipping bad JSON:', f, String(e));
        }
      }
    }
  }

  if (!Array.isArray(cards)) cards = [cards];
  // Mark these as "json" origin so we can branch later
  return cards.map(c => ({ __origin: 'json', ...c }));
}

function loadCSVCards() {
  if (!exists(DIRS.data)) return [];
  const files = fs.readdirSync(DIRS.data).filter(f => f.toLowerCase().endsWith('.csv'));
  if (!files.length) return [];

  // Prefer your named sheet if present, else take the first CSV
  const preferName = 'slabmetrics cards sheet1.csv';
  const preferred = files.find(f => f.toLowerCase() === preferName) || files[0];
  const csvPath = path.join(DIRS.data, preferred);

  const raw = read(csvPath);
  const rows = parseCSV(raw, { columns: true, skip_empty_lines: true, trim: true });

  // Convert flat CSV rows -> internal card objects compatible with the template map below
  const cards = rows.map(r => {
    const id = (r.id || '').toString().trim() || 'UNKNOWN';

    // Build a "card" object that looks enough like your JSON structure
    const c = {
      __origin: 'csv',
      id,
      player: r.player || '',
      set: r.set || '',
      number: r.number || '',
      variant: r.variant || '',
      serial: r.serial || '',
      graded_at: r.graded_at && String(r.graded_at).trim() ? r.graded_at : todayISO(),
      team: r.team || '',
      edge_img: (r.edge_img && r.edge_img.trim())
        ? (r.edge_img.startsWith('/') ? r.edge_img
          : '/edge/' + r.edge_img.replace(/^\.?\/?edge\//,''))
        : `/edge/${id}.jpg`,

      images: {
        front: r.front_img && r.front_img.trim()
          ? r.front_img
          : 'https://via.placeholder.com/420x588?text=Front',
        back: r.back_img && r.back_img.trim()
          ? r.back_img
          : 'https://via.placeholder.com/420x588?text=Back'
      },
      links: {
        ebay_comps: r.ebay || '#'
      },

      // Overall grade (string/number ok)
      grade_overall: r.overall_grade && String(r.overall_grade).trim() ? Number(r.overall_grade) : undefined,
      // If you provided overall_pct in CSV, we’ll use it; otherwise we’ll compute from grade_overall
      overall_pct_csv: r.overall_pct,

      // Subgrades (optional in CSV)
      subgrades: {
        front: {
          surface: r.f_surface,
          centering: r.f_centering,
          // Corners/Edges averages may be given directly in CSV
          corners_avg: r.f_corners_avg,
          edges_avg: r.f_edges_avg,
          remarks: {
            surface: r.f_remarks_surface,
            centering: r.f_remarks_centering,
            corners: r.f_remarks_corners,
            edges: r.f_remarks_edges
          }
        },
        back: {
          surface: r.b_surface,
          centering: r.b_centering,
          corners_avg: r.b_corners_avg,
          edges_avg: r.b_edges_avg,
          remarks: {
            surface: r.b_remarks_surface,
            centering: r.b_remarks_centering,
            corners: r.b_remarks_corners,
            edges: r.b_remarks_edges
          }
        }
      },

      // Pcts for bars (if you supply, we’ll use; else we’ll compute from the averages)
      pcts: {
        f_surface_pct: r.f_surface_pct,
        f_centering_pct: r.f_centering_pct,
        f_corners_pct: r.f_corners_pct,
        f_edges_pct: r.f_edges_pct,
        b_surface_pct: r.b_surface_pct,
        b_centering_pct: r.b_centering_pct,
        b_corners_pct: r.b_corners_pct,
        b_edges_pct: r.b_edges_pct
      },

      // Big-4 Pop & Gem
pops: {
  psa: toNumLoose(r.psa_pop, 0),
  sgc: toNumLoose(r.sgc_pop, 0),
  cgc: toNumLoose(r.cgc_pop, 0),
  bgs: toNumLoose(r.bgs_pop, 0),
},
gemRates: {
  psa: toRate0to100(r.psa_gem_rate, 0),
  sgc: toRate0to100(r.sgc_gem_rate, 0),
  cgc: toRate0to100(r.cgc_gem_rate, 0),
  bgs: toRate0to100(r.bgs_gem_rate, 0),
},

      // comparison
      compare: { distribution: {} }
    };

    return c;
  });

  return cards;
}

/* --------------- Validation / Compute ---------------- */
function validateCard(c) {
  const errs = [];
  if (!c.id) errs.push('missing id');

  // Handle both JSON structure and CSV structure
  const front = c.images?.front || c.front_img;
  const back  = c.images?.back  || c.back_img;

  if (!front || !back) errs.push('missing images.front/back');

  const imgPaths = { front, back };
  for (const k of ['front', 'back']) {
    const val = imgPaths[k];
    if (typeof val === 'string') {
      // Only warn about path style if it looks like a local path
      const isLocal = val.startsWith('/');
      if (isLocal && !val.startsWith('/cards/')) {
        console.warn(`[build] WARN: ${c.id} image path "${val}" should start with "/cards/..."`);
      }
      const base = path.basename(val);
      if (base !== base?.toLowerCase?.()) {
        console.warn(`[build] WARN: ${c.id} image filename should be lowercase: ${base}`);
      }
    }
  }
  return errs;
}

function computeGrades(c) {
  // If averages are already provided (CSV), use them; else compute
  const f = c.subgrades?.front ?? {};
  const b = c.subgrades?.back  ?? {};

  const fCornersAvg = f.corners_avg != null ? Number(f.corners_avg) : avg(f.corners ?? {});
  const fEdgesAvg   = f.edges_avg   != null ? Number(f.edges_avg)   : avg(f.edges   ?? {});
  const bCornersAvg = b.corners_avg != null ? Number(b.corners_avg) : avg(b.corners ?? {});
  const bEdgesAvg   = b.edges_avg   != null ? Number(b.edges_avg)   : avg(b.edges   ?? {});

  const fSection = +avg([f.surface, f.centering, fCornersAvg, fEdgesAvg]);
  const bSection = +avg([b.surface, b.centering, bCornersAvg, bEdgesAvg]);

  const wf = Number(c.weights?.front ?? 0.8);
  const wb = Number(c.weights?.back  ?? 0.2);
  const overall = c.grade_overall != null
    ? Number(c.grade_overall)
    : (wf * fSection + wb * bSection);

  return {
    fCornersAvg, fEdgesAvg, bCornersAvg, bEdgesAvg,
    fSection, bSection,
    overall: oneDec(overall)
  };
}

/* ----------------- Template ----------------- */
function tpl(html, map) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => (map[k] ?? ''));
}
function safe(s) { return s == null ? '' : String(s); }

/* ----------------- Build ----------------- */
function build() {
  fs.rmSync(DIRS.dist, { recursive: true, force: true });
  fs.mkdirSync(DIRS.dist, { recursive: true });

  copyPublic();

  // Load CSV first (your current workflow), then any JSON
  const csvCards  = loadCSVCards();
  const jsonCards = loadJSONCards();
  const cards = [...csvCards, ...jsonCards];

  const cardTplPath  = path.join(DIRS.templates, 'card.html');
  const indexTplPath = path.join(DIRS.templates, 'index.html');

  if (!exists(cardTplPath)) {
    console.error(`[build] Missing template: ${cardTplPath}`);
    process.exit(1);
  }
  const cardTpl  = read(cardTplPath);
  const indexTpl = exists(indexTplPath) ? read(indexTplPath) : '<!doctype html><html><body>{{cards}}</body></html>';

  const tiles = [];
  let built = 0;

  for (const c of cards) {
    const errs = validateCard(c);
    if (errs.length) {
      console.error(`[build] ERROR in card ${c.id ?? '(no id)'}: ${errs.join(', ')}`);
      continue;
    }

    const g = computeGrades(c);

    // Prefer explicit grade_overall (CSV) else computed
    const gradeOverall = (c.grade_overall != null && c.grade_overall !== '')
      ? oneDec(c.grade_overall)
      : g.overall;

    // overall_pct: prefer CSV if provided, else compute from overall grade
    const overallPct =
      c.overall_pct_csv != null && String(c.overall_pct_csv).trim() !== ''
        ? toPct0to100(c.overall_pct_csv)
        : pctOf10(gradeOverall);

    // Resolve image fields from either structure
    const frontImg = c.images?.front || c.front_img;
    const backImg  = c.images?.back  || c.back_img;
    const edgeImg  = c.edge_img || `/edge/${c.id}.jpg`;


    // Bars %: use CSV pcts if present, else compute from averages
    const p = c.pcts || {};
    const map = {
      id: safe(c.id),
      player: safe(c.player),
      set: safe(c.set),
      number: safe(c.number),
      variant: safe(c.variant),
      serial: safe(c.serial),
      team: safe(c.team),
      sport: safe(c.card_info?.sport || c.sport),
      graded_at: safe(c.graded_at || todayISO()),
      front_img: safe(frontImg),
      back_img: safe(backImg),
      edge_img: safe(edgeImg),
      ebay: safe(c.links?.ebay_comps || c.ebay || '#'),

      // grades
      overall_grade: gradeOverall,
      f_surface: safe(c.subgrades?.front?.surface),
      f_centering: safe(c.subgrades?.front?.centering),
      f_corners_avg: oneDec(g.fCornersAvg),
      f_edges_avg: oneDec(g.fEdgesAvg),
      b_surface: safe(c.subgrades?.back?.surface),
      b_centering: safe(c.subgrades?.back?.centering),
      b_corners_avg: oneDec(g.bCornersAvg),
      b_edges_avg: oneDec(g.bEdgesAvg),

      // percents for bars/circle
      overall_pct: String(overallPct),
      f_surface_pct: String(p.f_surface_pct != null && p.f_surface_pct !== '' ? toPct0to100(p.f_surface_pct) : pctOf10(c.subgrades?.front?.surface)),
      f_centering_pct: String(p.f_centering_pct != null && p.f_centering_pct !== '' ? toPct0to100(p.f_centering_pct) : pctOf10(c.subgrades?.front?.centering)),
      f_corners_pct: String(p.f_corners_pct != null && p.f_corners_pct !== '' ? toPct0to100(p.f_corners_pct) : pctOf10(g.fCornersAvg)),
      f_edges_pct:   String(p.f_edges_pct   != null && p.f_edges_pct   !== '' ? toPct0to100(p.f_edges_pct)   : pctOf10(g.fEdgesAvg)),
      b_surface_pct: String(p.b_surface_pct != null && p.b_surface_pct !== '' ? toPct0to100(p.b_surface_pct) : pctOf10(c.subgrades?.back?.surface)),
      b_centering_pct:String(p.b_centering_pct!= null && p.b_centering_pct!== '' ? toPct0to100(p.b_centering_pct): pctOf10(c.subgrades?.back?.centering)),
      b_corners_pct: String(p.b_corners_pct != null && p.b_corners_pct !== '' ? toPct0to100(p.b_corners_pct) : pctOf10(g.bCornersAvg)),
      b_edges_pct:   String(p.b_edges_pct   != null && p.b_edges_pct   !== '' ? toPct0to100(p.b_edges_pct)   : pctOf10(g.bEdgesAvg)),

      // remarks
      f_remarks_surface: safe(c.subgrades?.front?.remarks?.surface),
      f_remarks_centering: safe(c.subgrades?.front?.remarks?.centering),
      f_remarks_corners: safe(c.subgrades?.front?.remarks?.corners),
      f_remarks_edges: safe(c.subgrades?.front?.remarks?.edges),
      b_remarks_surface: safe(c.subgrades?.back?.remarks?.surface),
      b_remarks_centering: safe(c.subgrades?.back?.remarks?.centering),
      b_remarks_corners: safe(c.subgrades?.back?.remarks?.corners),
      b_remarks_edges: safe(c.subgrades?.back?.remarks?.edges),

      // Big-4 Pop & Gem (NEW)
      psa_pop: String(c.pops?.psa ?? 0),
      sgc_pop: String(c.pops?.sgc ?? 0),
      cgc_pop: String(c.pops?.cgc ?? 0),
      bgs_pop: String(c.pops?.bgs ?? 0),
      psa_gem_rate: String(c.gemRates?.psa ?? 0),
      sgc_gem_rate: String(c.gemRates?.sgc ?? 0),
      cgc_gem_rate: String(c.gemRates?.cgc ?? 0),
      bgs_gem_rate: String(c.gemRates?.bgs ?? 0),

      // comparison (inject as JSON for client)
      compare_json: JSON.stringify(c.compare?.distribution ?? {})
    };

    const html = tpl(cardTpl, map);
    const outPath = path.join(DIRS.dist, 'cards', `${c.id}.html`);
    write(outPath, html);
    built++;

    tiles.push({
      id: c.id,
      href: `/cards/${c.id}.html`,
      img: frontImg,
      player: c.player,
      set: c.set,
      number: c.number,
      variant: c.variant ?? '',
      serial: c.serial ?? ''
    });
  }

  const cardsHtml = tiles.map((t) => `
    <a class="tile reveal" href="${t.href}" data-player="${(t.player||'').toLowerCase()}"
      data-set="${(t.set||'').toLowerCase()}" data-number="${(t.number||'').toLowerCase()}"
      data-variant="${(t.variant||'').toLowerCase()}" data-serial="${(t.serial||'').toLowerCase()}">
      <img class="thumb" src="${t.img}" alt="" loading="lazy">
      <div class="meta">
        <strong>${t.player ?? ''}</strong>
        <small>${t.set ?? ''} ${t.number ?? ''}</small>
        <small>${t.variant ? t.variant : ''}</small>
        <small class="serial">Serial: ${t.serial ?? ''}</small>
      </div>
    </a>
  `).join('\n');

  const indexHtml = tpl(indexTpl, { cards: cardsHtml, count: String(tiles.length) });
  write(path.join(DIRS.dist, 'index.html'), indexHtml);

  console.log(`Built ${built} cards → dist/`);
}

build();

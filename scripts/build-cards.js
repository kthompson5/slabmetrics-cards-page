// ESM, Node core only
import fs from 'node:fs';
import path from 'node:path';

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

function loadCards() {
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

  if (!Array.isArray(cards)) cards = [cards];
  return cards;
}

function validateCard(c) {
  const errs = [];
  if (!c.id) errs.push('missing id');
  if (!c.images || !c.images.front || !c.images.back) errs.push('missing images.front/back');
  if (c.images) {
    for (const k of ['front', 'back']) {
      const val = c.images[k];
      if (typeof val === 'string') {
        if (!val.startsWith('/cards/')) {
          console.warn(`[build] WARN: ${c.id} image path "${val}" should start with "/cards/..."`);
        }
        const base = path.basename(val);
        if (base !== base.toLowerCase()) {
          console.warn(`[build] WARN: ${c.id} image filename should be lowercase: ${base}`);
        }
      }
    }
  }
  return errs;
}

function computeGrades(c) {
  const f = c.subgrades?.front ?? {};
  const b = c.subgrades?.back  ?? {};

  const fCornersAvg = avg(f.corners ?? {});
  const fEdgesAvg   = avg(f.edges ?? {});
  const bCornersAvg = avg(b.corners ?? {});
  const bEdgesAvg   = avg(b.edges ?? {});

  const fSection = +avg([f.surface, f.centering, fCornersAvg, fEdgesAvg]);
  const bSection = +avg([b.surface, b.centering, bCornersAvg, bEdgesAvg]);

  const wf = Number(c.weights?.front ?? 0.8);
  const wb = Number(c.weights?.back  ?? 0.2);
  const overall = wf * fSection + wb * bSection;

  return {
    fCornersAvg, fEdgesAvg, bCornersAvg, bEdgesAvg,
    fSection, bSection,
    overall: oneDec(overall)
  };
}

function tpl(html, map) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => (map[k] ?? ''));
}
function safe(s) { return s == null ? '' : String(s); }

function build() {
  fs.rmSync(DIRS.dist, { recursive: true, force: true });
  fs.mkdirSync(DIRS.dist, { recursive: true });

  copyPublic();

  const cards = loadCards();
  const cardTpl  = read(path.join(DIRS.templates, 'card.html'));
  const indexTpl = read(path.join(DIRS.templates, 'index.html'));

  const tiles = [];
  let built = 0;

  for (const c of cards) {
    const errs = validateCard(c);
    if (errs.length) {
      console.error(`[build] ERROR in card ${c.id ?? '(no id)'}: ${errs.join(', ')}`);
      continue;
    }
    const g = computeGrades(c);

    const gradeOverall = c.grade_overall != null ? oneDec(c.grade_overall) : g.overall;

    const map = {
      id: safe(c.id),
      player: safe(c.player),
      set: safe(c.set),
      number: safe(c.number),
      variant: safe(c.variant),
      serial: safe(c.serial),
      team: safe(c.card_info?.team),
      sport: safe(c.card_info?.sport),
      graded_at: safe(c.graded_at),
      front_img: safe(c.images.front),
      back_img: safe(c.images.back),
      ebay: safe(c.links?.ebay_comps || '#'),
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
      overall_pct: String(pctOf10(gradeOverall)),
      f_surface_pct: String(pctOf10(c.subgrades?.front?.surface)),
      f_centering_pct: String(pctOf10(c.subgrades?.front?.centering)),
      f_corners_pct: String(pctOf10(g.fCornersAvg)),
      f_edges_pct: String(pctOf10(g.fEdgesAvg)),
      b_surface_pct: String(pctOf10(c.subgrades?.back?.surface)),
      b_centering_pct: String(pctOf10(c.subgrades?.back?.centering)),
      b_corners_pct: String(pctOf10(g.bCornersAvg)),
      b_edges_pct: String(pctOf10(g.bEdgesAvg)),
      // remarks
      f_remarks_surface: safe(c.subgrades?.front?.remarks?.surface),
      f_remarks_centering: safe(c.subgrades?.front?.remarks?.centering),
      f_remarks_corners: safe(c.subgrades?.front?.remarks?.corners),
      f_remarks_edges: safe(c.subgrades?.front?.remarks?.edges),
      b_remarks_surface: safe(c.subgrades?.back?.remarks?.surface),
      b_remarks_centering: safe(c.subgrades?.back?.remarks?.centering),
      b_remarks_corners: safe(c.subgrades?.back?.remarks?.corners),
      b_remarks_edges: safe(c.subgrades?.back?.remarks?.edges),
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
      img: c.images.front,
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

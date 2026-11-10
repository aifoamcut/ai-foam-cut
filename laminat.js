/* laminat.js — Reiter „Laminierplan" (optionales Feature `laminat`, Tab `lam`)
 *
 * Für die aktive Tragfläche (App.wing.cuts): Lagenaufbau der Schale (Gewebe je Lage mit Seite,
 * Spannweiten- und Profilbereich, Faserrichtung), daraus
 *   - Zuschnitte als Abwicklung (Spannweite × Bogenlänge des Profils ab Nase) mit Zugabe,
 *   - Verschachtelung auf die Rollenbreite (Regalverfahren, ±45° gedreht) → Meter je Gewebe,
 *   - Gewebe-/Harzmasse, Abreißgewebe/Saugvlies/Vakuumsack,
 *   - Zeitplan gegen die Topfzeit des Harzes.
 * Holmgurte (UD) und Schalenlagen lassen sich aus der Holmauslegung (window.Holm.compute) übernehmen.
 * Export: Zuschnitt-DXF (Lage auf der Rolle, mm) und Zuschnittliste CSV.
 * Daten je Tragfläche in state.cfg.lam (WING_CFG_KEYS). Andere Module rufen nur geschützt (window.Laminat).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f0 = v => String(Math.round(v)), f1 = v => (Math.round(v * 10) / 10).toFixed(1), f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isOpen = () => state.activeTab === 'lam';
  const SIDES = { top: 'Oberseite', bot: 'Unterseite', both: 'beide Seiten' };

  const FAB_FALLBACK = [
    { id: 'gf25', name: 'Glasgewebe 25 g/m²', gsm: 25 }, { id: 'gf49', name: 'Glasgewebe 49 g/m²', gsm: 49 },
    { id: 'gf80', name: 'Glasgewebe 80 g/m²', gsm: 80 }, { id: 'gf163', name: 'Glasgewebe 163 g/m²', gsm: 163 },
    { id: 'cf_fab93', name: 'Kohlegewebe 93 g/m² (Leinwand)', gsm: 93 }, { id: 'cf_fab160', name: 'Kohlegewebe 160 g/m² (Köper)', gsm: 160 },
    { id: 'cf_fab200', name: 'Kohlegewebe 200 g/m²', gsm: 200 }, { id: 'af61', name: 'Aramidgewebe 61 g/m²', gsm: 61 }
  ];
  function fabrics() {
    const h = (state.cfg.holmMats || []).filter(m => m && (m.kind === 'fab' || m.kind === 'ud') && m.gsm > 0).map(m => ({ id: m.id, name: m.name, gsm: m.gsm, ud: m.kind === 'ud' }));
    const out = h.slice();
    FAB_FALLBACK.forEach(f => { if (!out.some(o => o.id === f.id)) out.push(f); });
    return out;
  }
  const fabById = id => fabrics().find(f => f.id === id) || { id, name: id, gsm: 80 };

  function cfg() {
    let c = state.cfg.lam;
    if (!c || typeof c !== 'object') c = state.cfg.lam = {};
    const d = { over: 20, roll: 1000, gap: 10, resin: 0.9, waste: 10, pot: 45, minM2: 25, setup: 15, halves: 0, peel: true, breather: true, caps: [] };
    for (const k in d) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(d[k]));
    if (!Array.isArray(c.layers)) c.layers = [
      { mat: 'gf25', side: 'both', from: 0, to: 100, cf: 0, ct: 100, ori: '0', n: 1, note: T('Decklage') },
      { mat: 'cf_fab93', side: 'both', from: 0, to: 100, cf: 0, ct: 100, ori: '45', n: 1, note: T('Torsionslage') }
    ];
    return c;
  }
  const halves = c => Math.max(1, Math.round(+c.halves || +state.cfg.wtCount || 2));

  // ---------- Geometrie: Bogenlängen der Profilseiten je Station ----------
  function arcs(P) {
    let iLE = 0; P.forEach((p, i) => { if (p.x < P[iLE].x) iLE = i; });
    const len = (a, b) => { let s = 0; for (let i = a + 1; i <= b; i++) s += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return s; };
    const my = (a, b) => { let s = 0; for (let i = a; i <= b; i++) s += P[i].y; return s / (b - a + 1); };
    const A = len(0, iLE), B = len(iLE, P.length - 1), up = my(0, iLE) >= my(iLE, P.length - 1);
    return up ? { top: A, bot: B } : { top: B, bot: A };
  }
  function stations() {
    const W = App.wing; if (!W || !W.cuts || !W.cuts.length) return null;
    const S = []; let z = 0;
    W.cuts.forEach((c, k) => {
      if (!k) S.push(Object.assign({ z: 0 }, arcs(c.root.pts)));
      z += +c.span || 0; S.push(Object.assign({ z }, arcs(c.tip.pts)));
    });
    return S[S.length - 1].z > 0 ? S : null;
  }
  function arcAt(S, z, side) {
    for (let i = 1; i < S.length; i++) if (z <= S[i].z + 1e-9) { const a = S[i - 1], b = S[i], t = b.z > a.z ? (z - a.z) / (b.z - a.z) : 0; return a[side] + (b[side] - a[side]) * t; }
    return S[S.length - 1][side];
  }
  const area = P => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };

  // Zuschnitt einer Lage auf einer Seite: Polygon (u = Spannweite, v = Bogen ab Nase), mit Zugabe
  function piece(S, L, ly, side, over) {
    const za = clamp(+ly.from || 0, 0, 100) / 100 * L, zb = clamp(+ly.to || 0, 0, 100) / 100 * L;
    if (zb - za < 1) return null;
    const zs = [za].concat(S.map(s => s.z).filter(z => z > za + 1e-6 && z < zb - 1e-6)).concat([zb]);
    const cf = clamp(+ly.cf || 0, 0, 100) / 100, ct = clamp(+ly.ct || 0, 0, 100) / 100;
    if (ct - cf < 0.01) return null;
    const lo = zs.map(z => [z - za, arcAt(S, z, side) * cf]), hi = zs.map(z => [z - za, arcAt(S, z, side) * ct]);
    const net = lo.concat(hi.slice().reverse());
    // Zugabe: Enden ±over, Längskanten ±over (an der Nase nur, wenn der Bereich nicht dort beginnt — dort umschlagen)
    const n = zs.length, o = +over || 0;
    const P = lo.map((p, i) => [p[0] + (i === 0 ? -o : i === n - 1 ? o : 0), p[1] - o])
      .concat(hi.slice().reverse().map((p, j) => { const i = n - 1 - j; return [p[0] + (i === 0 ? -o : i === n - 1 ? o : 0), p[1] + o]; }));
    const sh = P.map(p => [p[0] + o, p[1] + o]);
    return { P: sh, net: area(net), cut: area(sh), len: zb - za + 2 * o, z0: za };
  }
  const rot = (P, deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return P.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]); };
  const bbox = P => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; P.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };

  // ---------- Rechnung ----------
  function compute() {
    const c = cfg(), S = stations();
    if (!S) return { err: T('Keine Tragfläche — zuerst im Tragflächendesigner anlegen.') };
    const L = S[S.length - 1].z, nh = halves(c), pieces = [];
    c.layers.forEach((ly, li) => {
      const sides = ly.side === 'both' ? ['top', 'bot'] : [ly.side === 'bot' ? 'bot' : 'top'];
      const fab = fabById(ly.mat);
      sides.forEach(sd => {
        const p = piece(S, L, ly, sd, c.over); if (!p) return;
        const qty = nh * Math.max(1, Math.round(+ly.n || 1));
        pieces.push(Object.assign(p, { li, side: sd, fab, ori: ly.ori === '45' ? 45 : 0, qty, name: 'L' + (li + 1) + (sd === 'top' ? 'o' : 'u'), note: ly.note || '' }));
      });
    });
    // Holmgurte: UD-Streifen (Länge × Breite innen/außen) aus der Holmauslegung
    (c.caps || []).forEach((cp, i) => {
      const o = +c.over || 0, P = [[0, 0], [cp.len + o, (cp.bIn - cp.bOut) / 2], [cp.len + o, (cp.bIn + cp.bOut) / 2], [0, cp.bIn]];
      pieces.push({ P, net: area(P), cut: area(P), len: cp.len + o, li: -1, side: cp.side, fab: fabById(cp.mat), ori: 0, qty: nh, name: 'G' + (cp.side === 'top' ? 'o' : 'u') + (i + 1), note: T('Holmgurt'), cap: true });
    });
    // Verschachtelung je Gewebe auf die Rolle (Regal: Reihen über die Rollenbreite)
    const roll = Math.max(50, +c.roll || 1000), gap = Math.max(0, +c.gap || 0), byFab = new Map();
    pieces.forEach(p => {
      let Q = p.ori ? rot(p.P, 45) : p.P; let b = bbox(Q);
      if (!p.ori && b.h > b.w && b.w <= roll) { Q = rot(p.P, 90); b = bbox(Q); }   // quer legen, wenn's passt
      Q = Q.map(q => [q[0] - b.x0, q[1] - b.y0]);
      const split = b.h > roll ? Math.ceil(b.h / roll) : 1;
      for (let k = 0; k < p.qty; k++) {
        if (!byFab.has(p.fab.id)) byFab.set(p.fab.id, { fab: p.fab, items: [] });
        byFab.get(p.fab.id).items.push({ p, Q, w: b.w, h: Math.min(b.h, roll), split });
      }
    });
    const rolls = [];
    byFab.forEach(g => {
      // Spalten entlang der Rolle: Breite = erstes (längstes) Teil, Teile quer über die Rollenbreite gestapelt
      g.items.sort((a, b) => b.w - a.w || b.h - a.h);
      const rows = [];
      g.items.forEach(it => {
        let r = rows.find(q => q.len >= it.w - 1e-6 && q.fill + it.h <= roll + 1e-6);
        if (!r) { r = { x: rows.reduce((s, q) => Math.max(s, q.x + q.len + gap), 0), len: it.w, fill: 0, items: [] }; rows.push(r); }
        it.x = r.x; it.y = r.fill; r.fill += it.h + gap; r.items.push(it);
      });
      const len = rows.reduce((s, q) => Math.max(s, q.x + q.len), 0);
      const net = g.items.reduce((s, it) => s + it.p.cut, 0);
      rolls.push({ fab: g.fab, rows, items: g.items, len, net, eff: len > 0 ? net / (len * roll) : 0, split: g.items.some(i => i.split > 1) });
    });
    // Massen (Netto-Fläche × Stückzahl), Harz, Verbrauchsmaterial
    const waste = 1 + Math.max(0, +c.waste || 0) / 100;
    const mats = rolls.map(r => ({ fab: r.fab, m: r.len / 1000 * waste, area: r.net / 1e6, gFab: r.items.reduce((s, it) => s + it.p.net, 0) * r.fab.gsm * 1e-6 }));
    const gFab = mats.reduce((s, m) => s + m.gFab, 0), gResin = gFab * Math.max(0, +c.resin || 0) * waste;
    const maxArc = Math.max(...S.map(s => Math.max(s.top, s.bot)));
    const skin = 2 * S.slice(1).reduce((s, b, i) => s + (b.z - S[i].z) * ((b.top + b.bot + S[i].top + S[i].bot) / 2), 0) / 2;   // Oberfläche je Hälfte (mm²)
    const cons = { peel: c.peel ? skin * nh * 1.1 / 1e6 : 0, breather: c.breather ? skin * nh * 1.1 / 1e6 : 0, bagL: L + 300, bagW: 2 * maxArc + 300 };
    // Zeitplan: je Hälfte und Seite, Lagen nacheinander
    const lay = [];
    let t = +c.setup || 0;
    ['top', 'bot'].forEach(sd => {
      pieces.filter(p => p.side === sd).sort((a, b) => (a.cap ? 0.5 : a.li) - (b.cap ? 0.5 : b.li)).forEach(p => {
        const dt = p.net / 1e6 * (+c.minM2 || 0) + 2; t += dt; lay.push({ name: p.name, side: sd, fab: p.fab.name, dt, t });
      });
    });
    return { c, S, L, nh, pieces, rolls, mats, gFab, gResin, cons, lay, tTot: t, roll };
  }

  // ---------- Holmauslegung übernehmen ----------
  function fromHolm() {
    if (!window.Holm || !Holm.compute) { alert(T('Holmauslegung ist in dieser Ausgabe nicht enthalten.')); return; }
    let R; try { R = window.Holm.compute(); } catch (e) { alert(e.message); return; }
    if (!R || R.err) { alert(R && R.err || T('Holmauslegung liefert kein Ergebnis.')); return; }
    const c = cfg(), L = R.L || 1;
    c.caps = [];
    (R.cutT || []).forEach(q => c.caps.push({ side: 'top', mat: R.capM && R.capM.id, len: q.len, bIn: q.bIn, bOut: q.bOut }));
    (R.cutB || []).forEach(q => c.caps.push({ side: 'bot', mat: R.capM && R.capM.id, len: q.len, bIn: q.bIn, bOut: q.bOut }));
    if (R.sm && R.planS && R.planS.length) {
      c.layers = c.layers.filter(l => !l.fromHolm);
      R.planS.forEach(len => c.layers.push({ mat: R.sm.id, side: 'both', from: 0, to: Math.round(len / L * 1000) / 10, cf: 0, ct: 100, ori: R.ori45 ? '45' : '0', n: 1, note: T('Torsionsschale (Holmauslegung)'), fromHolm: true }));
    }
    if (R.isRov) alert(T('Hinweis: Holmgurte aus Rovings werden nicht als Zuschnitt geführt (nur Gewebe/Gelege).'));
    if (R.isRov) c.caps = [];
    refresh(true);
  }

  // ---------- Export ----------
  function dxf(Rs) {
    const out = ['0', 'SECTION', '2', 'ENTITIES'];
    let yOff = 0;
    Rs.rolls.forEach(r => {
      const lay = r.fab.name.replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 30);
      // Rollenrand
      const edge = [[0, 0], [r.len, 0], [r.len, Rs.roll], [0, Rs.roll]].map(p => [p[0], p[1] + yOff]);
      poly(out, edge, 'ROLLE_' + lay);
      r.items.forEach(it => {
        poly(out, it.Q.map(q => [q[0] + it.x, q[1] + it.y + yOff]), lay);
        out.push('0', 'TEXT', '8', lay, '10', f1(it.x + 5), '20', f1(it.y + yOff + 5), '30', '0', '40', '8', '1', it.p.name + ' ' + (it.p.ori ? '45' : '0') + 'deg');
      });
      yOff += Rs.roll + 200;
    });
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n');
  }
  function poly(out, P, layer) {
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
    P.forEach(p => out.push('0', 'VERTEX', '8', layer, '10', f2(p[0]), '20', f2(p[1]), '30', '0'));
    out.push('0', 'SEQEND');
  }
  function csv(R) {
    const rows = [['Teil', 'Gewebe', 'g/m2', 'Seite', 'Faser', 'Stueck', 'Laenge mm', 'Netto cm2', 'Zuschnitt cm2', 'Notiz']];
    R.pieces.forEach(p => rows.push([p.name, p.fab.name, p.fab.gsm, p.side, p.ori ? '+-45' : '0/90', p.qty, f0(p.len), f1(p.net / 100), f1(p.cut / 100), p.note]));
    return rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  }
  function save(name, data, mime) { if (App.download) App.download(name, data, mime, 'svDxf'); else if (App.anchorDownload) App.anchorDownload(name, data, mime); }
  const base = () => ((state.projectName || 'projekt').replace(/[\\/:*?"<>|]+/g, '_')) + '_laminierplan';

  // ---------- Ansicht ----------
  function el() {
    const v = document.getElementById('lamView'); if (!v) return null;
    let r = v.querySelector('.holm-res');
    if (!r) { r = document.createElement('div'); r.className = 'holm-res'; v.appendChild(r); }
    return r;
  }
  const card = (l, v, s) => '<div class="holm-card"><div class="l">' + esc(T(l)) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  const COLS = ['#5aa9ff', '#ffa94d', '#7ee0a0', '#e07ee0', '#ffd27a', '#7ed0e0', '#ff7e7e', '#b9a2ff'];

  function layerTable(c) {
    const fo = fabrics().map(f => '<option value="' + esc(f.id) + '">' + esc(T(f.name)) + '</option>').join('');
    let h = '<table class="holm-tab lam-lay"><tr><th>#</th><th>' + esc(T('Gewebe')) + '</th><th>' + esc(T('Seite')) + '</th><th>' + esc(T('Spannweite von %')) + '</th><th>' + esc(T('bis %')) + '</th><th>'
      + esc(T('Profil ab Nase von %')) + '</th><th>' + esc(T('bis %')) + '</th><th>' + esc(T('Faser')) + '</th><th>' + esc(T('Anzahl')) + '</th><th>' + esc(T('Notiz')) + '</th><th></th></tr>';
    c.layers.forEach((l, i) => {
      h += '<tr data-i="' + i + '"><td style="color:' + COLS[i % COLS.length] + '">L' + (i + 1) + '</td>'
        + '<td><select data-k="mat">' + fo.replace('value="' + esc(l.mat) + '"', 'value="' + esc(l.mat) + '" selected') + '</select></td>'
        + '<td><select data-k="side">' + Object.keys(SIDES).map(k => '<option value="' + k + '"' + (l.side === k ? ' selected' : '') + '>' + esc(T(SIDES[k])) + '</option>').join('') + '</select></td>'
        + ['from', 'to', 'cf', 'ct'].map(k => '<td><input data-k="' + k + '" type="number" step="5" min="0" max="100" value="' + esc(l[k]) + '" style="width:58px"></td>').join('')
        + '<td><select data-k="ori"><option value="0"' + (l.ori !== '45' ? ' selected' : '') + '>0/90°</option><option value="45"' + (l.ori === '45' ? ' selected' : '') + '>±45°</option></select></td>'
        + '<td><input data-k="n" type="number" min="1" step="1" value="' + esc(l.n || 1) + '" style="width:44px"></td>'
        + '<td><input data-k="note" type="text" value="' + esc(l.note || '') + '" style="width:150px"></td>'
        + '<td style="white-space:nowrap"><button data-a="up">↑</button><button data-a="dn">↓</button><button data-a="del">✕</button></td></tr>';
    });
    return h + '</table><div style="display:flex;gap:6px;margin:4px 0 10px"><button data-a="add">' + esc(T('+ Lage')) + '</button><button data-a="holm">' + esc(T('Aus Holmauslegung übernehmen')) + '</button>'
      + (c.caps && c.caps.length ? '<button data-a="nocaps">' + esc(T('Holmgurte entfernen')) + '</button>' : '') + '</div>';
  }
  function devSvg(R) {
    // Abwicklung je Seite: alle Lagen übereinander (halb transparent), u nach rechts, v nach unten
    const W = 900, pad = 24, L = R.L, maxV = Math.max(...R.S.map(s => Math.max(s.top, s.bot))) + 2 * (+R.c.over || 0);
    const sc = (W - 2 * pad) / (L + 2 * (+R.c.over || 0)), Hs = maxV * sc + 30;
    let g = '';
    ['top', 'bot'].forEach((sd, k) => {
      const y0 = pad + k * (Hs + 20);
      g += '<text class="ht" x="' + pad + '" y="' + (y0 - 6) + '">' + esc(T(SIDES[sd])) + ' — ' + esc(T('Abwicklung: Spannweite → , Bogen ab Nase ↓')) + '</text>';
      g += '<line class="hg" x1="' + pad + '" y1="' + y0 + '" x2="' + (W - pad) + '" y2="' + y0 + '"/>';
      R.S.forEach(s => { g += '<line class="rib" x1="' + (pad + (s.z + (+R.c.over || 0)) * sc) + '" y1="' + y0 + '" x2="' + (pad + (s.z + (+R.c.over || 0)) * sc) + '" y2="' + (y0 + s[sd] * sc) + '"/>'; });
      R.pieces.filter(p => p.side === sd && !p.cap).forEach(p => {
        const col = COLS[p.li % COLS.length];
        g += '<polygon points="' + p.P.map(q => (pad + (q[0] + p.z0) * sc).toFixed(1) + ',' + (y0 + (q[1] - (+R.c.over || 0)) * sc).toFixed(1)).join(' ') + '" fill="' + col + '22" stroke="' + col + '" stroke-width="1.2"/>';
      });
    });
    return '<svg width="100%" viewBox="0 0 ' + W + ' ' + (2 * Hs + 60) + '">' + g + '</svg>';
  }
  function rollSvg(R, r) {
    const W = 900, sc = Math.min((W - 20) / Math.max(1, r.len), 160 / R.roll), H = R.roll * sc + 20;
    let g = '<rect x="10" y="10" width="' + (r.len * sc) + '" height="' + (R.roll * sc) + '" fill="none" stroke="var(--muted)" stroke-dasharray="4 3"/>';
    r.items.forEach(it => {
      const col = it.p.cap ? '#ffd27a' : COLS[it.p.li % COLS.length];
      g += '<polygon points="' + it.Q.map(q => (10 + (q[0] + it.x) * sc).toFixed(1) + ',' + (10 + (q[1] + it.y) * sc).toFixed(1)).join(' ') + '" fill="' + col + '33" stroke="' + col + '"/>';
      if (it.w * sc > 30) g += '<text class="ht" x="' + (14 + it.x * sc) + '" y="' + (22 + it.y * sc) + '">' + esc(it.p.name) + '</text>';
    });
    return '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }
  function draw() {
    const r = el(); if (!r || !isOpen()) return;
    const c = cfg();
    let R; try { R = compute(); } catch (e) { console.error(e); r.innerHTML = '<div class="holm-warn">' + esc(e.message) + '</div>'; return; }
    let h = '<h3 class="bib-h">' + esc(T('Lagenaufbau der Schale')) + '</h3>' + layerTable(c);
    if (R.err) { r.innerHTML = h + '<div class="holm-warn">' + esc(R.err) + '</div>'; wire(r); return; }
    const pot = +c.pot || 0, potWarn = pot > 0 && R.tTot > pot * 0.8;
    h += '<div class="holm-cards">'
      + card('Gewebe gesamt', f0(R.gFab) + ' g', R.nh + ' ' + T('Hälften'))
      + card('Harz (inkl. Verlust)', f0(R.gResin) + ' g', T('Verhältnis Harz/Gewebe') + ' ' + c.resin)
      + card('Laminat gesamt', f0(R.gFab + R.gResin) + ' g', '')
      + card('Abreißgewebe / Vlies', f2(R.cons.peel) + ' / ' + f2(R.cons.breather) + ' m²', '')
      + card('Vakuumsack je Hälfte', f0(R.cons.bagL) + ' × ' + f0(R.cons.bagW) + ' mm', T('Schlauch oder Folie'))
      + card('Laminierzeit je Durchgang', f0(R.tTot) + ' min', (potWarn ? '<span class="bad">' : '') + T('Topfzeit') + ' ' + pot + ' min' + (potWarn ? ' — ' + T('knapp!') + '</span>' : ''))
      + '</div>';
    if (potWarn) h += '<div class="holm-warn">' + esc(T('Die Laminierzeit liegt über 80 % der Topfzeit: langsameren Härter wählen, Ober- und Unterseite getrennt laminieren oder zu zweit arbeiten.')) + '</div>';
    h += '<h3 class="bib-h">' + esc(T('Abwicklung der Zuschnitte (eine Hälfte)')) + '</h3>' + devSvg(R);
    h += '<h3 class="bib-h">' + esc(T('Verbrauch je Gewebe (Rollenbreite')) + ' ' + f0(R.roll) + ' mm)</h3>';
    h += '<table class="holm-tab"><tr><th>' + esc(T('Gewebe')) + '</th><th>' + esc(T('Rolle m (+Verschnitt)')) + '</th><th>' + esc(T('Ausnutzung')) + '</th><th>' + esc(T('Gewebemasse g')) + '</th></tr>'
      + R.rolls.map((ro, i) => '<tr><td>' + esc(T(ro.fab.name)) + '</td><td>' + f2(R.mats[i].m) + '</td><td>' + f0(ro.eff * 100) + ' %</td><td>' + f0(R.mats[i].gFab) + '</td></tr>').join('') + '</table>';
    R.rolls.forEach(ro => { h += '<div class="ht" style="margin-top:8px">' + esc(T(ro.fab.name)) + (ro.split ? ' — <span class="bad">' + esc(T('Teil breiter als die Rolle: stoßen/überlappen')) + '</span>' : '') + '</div>' + rollSvg(R, ro); });
    h += '<h3 class="bib-h">' + esc(T('Zuschnittliste')) + '</h3><table class="holm-tab"><tr><th>' + esc(T('Teil')) + '</th><th>' + esc(T('Gewebe')) + '</th><th>' + esc(T('Seite')) + '</th><th>' + esc(T('Faser')) + '</th><th>' + esc(T('Stück')) + '</th><th>' + esc(T('Länge mm')) + '</th><th>' + esc(T('Zuschnitt dm²')) + '</th><th>' + esc(T('Notiz')) + '</th></tr>'
      + R.pieces.map(p => '<tr><td>' + p.name + '</td><td>' + esc(T(p.fab.name)) + '</td><td>' + esc(T(SIDES[p.side])) + '</td><td>' + (p.ori ? '±45°' : '0/90°') + '</td><td>' + p.qty + '</td><td>' + f0(p.len) + '</td><td>' + f2(p.cut / 1e4) + '</td><td>' + esc(p.note) + '</td></tr>').join('') + '</table>';
    h += '<h3 class="bib-h">' + esc(T('Ablauf (je Hälfte, eine Form)')) + '</h3><table class="holm-tab"><tr><th>' + esc(T('Schritt')) + '</th><th>' + esc(T('Seite')) + '</th><th>' + esc(T('Gewebe')) + '</th><th>min</th><th>' + esc(T('Uhr ab Harzansatz')) + '</th></tr>'
      + '<tr><td>' + esc(T('Harz ansetzen, Form/Kern vorbereiten')) + '</td><td></td><td></td><td>' + f0(+c.setup || 0) + '</td><td>' + f0(+c.setup || 0) + '</td></tr>'
      + R.lay.map(q => '<tr><td>' + esc(q.name) + '</td><td>' + esc(T(SIDES[q.side])) + '</td><td>' + esc(T(q.fab)) + '</td><td>' + f0(q.dt) + '</td><td' + (pot && q.t > pot ? ' class="bad"' : '') + '>' + f0(q.t) + '</td></tr>').join('')
      + '<tr><td>' + esc(T('Abreißgewebe, Vlies, Sack, Vakuum ziehen')) + '</td><td></td><td></td><td>10</td><td>' + f0(R.tTot + 10) + '</td></tr></table>';
    h += '<div style="display:flex;gap:6px;margin:12px 0"><button data-a="dxf">' + esc(T('Zuschnitt-DXF speichern')) + '</button><button data-a="csv">' + esc(T('Zuschnittliste CSV')) + '</button></div>';
    r.innerHTML = h; wire(r, R);
  }
  function wire(r, R) {
    const c = cfg();
    r.querySelectorAll('.lam-lay tr[data-i]').forEach(tr => {
      const i = +tr.dataset.i;
      tr.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
        const k = inp.dataset.k; c.layers[i][k] = inp.type === 'number' ? +inp.value : inp.value; delete c.layers[i].fromHolm; draw();
      });
      tr.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a, L = c.layers;
        if (a === 'del') L.splice(i, 1);
        else if (a === 'up' && i > 0) L.splice(i - 1, 0, L.splice(i, 1)[0]);
        else if (a === 'dn' && i < L.length - 1) L.splice(i + 1, 0, L.splice(i, 1)[0]);
        draw();
      });
    });
    r.querySelectorAll(':scope > div > button[data-a], :scope > div > div > button[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'add') { const l = c.layers[c.layers.length - 1]; c.layers.push(l ? Object.assign({}, l, { note: '', fromHolm: undefined }) : { mat: 'gf80', side: 'both', from: 0, to: 100, cf: 0, ct: 100, ori: '0', n: 1 }); draw(); }
      else if (a === 'holm') fromHolm();
      else if (a === 'nocaps') { c.caps = []; draw(); }
      else if (a === 'dxf' && R) save(base() + '.dxf', dxf(R), 'application/dxf');
      else if (a === 'csv' && R) save(base() + '.csv', '﻿' + csv(R), 'text/csv');
    });
  }
  function refresh(rebuild) { if (!isOpen()) return; if (rebuild && App.buildSidebar) App.buildSidebar(); draw(); }

  function lamSidebar(side) {
    const { grp, hint, numRow, boolRow } = App, c = cfg();
    const RD = () => { if (isOpen()) draw(); };
    const g = grp('Laminierplan', true, 'lam', { key: 'lamMain' }); side.appendChild(g.g);
    hint(g.body, 'Lagen in der Tabelle rechts festlegen. Zuschnitte = Abwicklung der Profilseiten mit Zugabe; Stückzahl gilt je Hälfte.');
    numRow(g.body, 'Zugabe ringsum (mm)', () => c.over, v => { c.over = v; RD(); }, { step: 5, norender: true });
    numRow(g.body, 'Hälften (0 = aus Projektübersicht)', () => c.halves, v => { c.halves = v; RD(); }, { step: 1, norender: true });
    numRow(g.body, 'Rollenbreite (mm)', () => c.roll, v => { c.roll = v; RD(); }, { step: 50, norender: true });
    numRow(g.body, 'Abstand zwischen Teilen (mm)', () => c.gap, v => { c.gap = v; RD(); }, { step: 5, norender: true });
    numRow(g.body, 'Verschnitt/Verlust (%)', () => c.waste, v => { c.waste = v; RD(); }, { step: 5, norender: true });
    const g2 = grp('Harz & Zeit', false, 'lam', { key: 'lamResin' }); side.appendChild(g2.g);
    numRow(g2.body, 'Harz je Gewebe (Massenverhältnis)', () => c.resin, v => { c.resin = v; RD(); }, { step: 0.1, norender: true, hint: 'Vakuum ≈ 0,7–0,9 · Handlaminat ≈ 1,0–1,3' });
    numRow(g2.body, 'Topfzeit (min)', () => c.pot, v => { c.pot = v; RD(); }, { step: 5, norender: true });
    numRow(g2.body, 'Legezeit (min je m²)', () => c.minM2, v => { c.minM2 = v; RD(); }, { step: 5, norender: true });
    numRow(g2.body, 'Vorbereitung (min)', () => c.setup, v => { c.setup = v; RD(); }, { step: 5, norender: true });
    boolRow(g2.body, 'Abreißgewebe', () => c.peel, v => { c.peel = v; RD(); });
    boolRow(g2.body, 'Saugvlies', () => c.breather, v => { c.breather = v; RD(); });
  }

  function show() { draw(); }
  Object.assign(App, { lamSidebar });
  window.Laminat = { show, refresh: show, compute, _test: { arcs, piece, stations, dxf, csv } };
})();

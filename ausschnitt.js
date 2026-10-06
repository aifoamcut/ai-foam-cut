/* ausschnitt.js — Reiter „Tragflächenausschnitt": ein Profil (Wurzelprofil einer
 * Tragfläche oder ein eigenes Profil) als Ausschnitt aus einem Block schneiden,
 * z. B. die Flächenaufnahme im Rumpfblock oder ein Profilstück (Funktion
 * „ausschnitt", optional — andere Module rufen nur geschützt).
 *
 * KONZEPT
 *   Profil   : Wurzelprofil (state.root bzw. ruhende Tragfläche aus state.wings)
 *              oder eigenes Profil (.dat / Profildatenbank), normiert (Sehne 1).
 *              Profiltiefe, Maßstab, Einstellwinkel (Drehpunkt Endleiste), Nasenrichtung.
 *              Lage (Nase ↔ Blockvorderseite/-unterkante) gilt für das ungedrehte Profil,
 *              die Endleiste bleibt beim Drehen stehen.
 *   Block    : Breite/Höhe automatisch (Profil + Rand) oder fest, Lage des Profils
 *              mittig oder frei (Nase ↔ Blockvorderseite, Nasenhöhe über Unterkante).
 *              Blocklage X/Y (Abstand zum Nullpunkt) wie im Reiter „G-Code".
 *   Bahn     : Parallelversatz der Kontur — Block behalten (Loch): Spiel nach außen,
 *              Abbrand/2 nach innen; Profilstück behalten: Abbrand/2 nach außen.
 *              Schlaufen (spitze Endleiste) werden lokal entfernt.
 *   Anfahrt  : von oben / unten / vorne (Nasenseite) / hinten (Endleistenseite):
 *              in Luft zum Anfahrpunkt vor der Blockfläche, senkrecht zur Fläche
 *              hinein bis auf die Höhe/Lage des Startpunkts, Startpunkt, Umlauf in
 *              gewählter Richtung, auf demselben Weg zurück, in Luft zum Nullpunkt.
 *   Start    : Befehl „Startpunkt wählen" + Klick auf die Kontur (gespeichert als Bogenlängen-
 *              Anteil der normierten Kontur → bleibt bei Maßstab/Winkel gültig),
 *              sonst automatisch der Anfahrfläche nächstgelegene Punkt.
 *   G-Code   : ausschnitt_gcode.js (Funktion „gcodegen") macht aus den Fahrten
 *              (Daten) den Text. XY = UV (gerader Draht, Prisma). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, numRow, selectRow, buildSidebar } = App;
  const TAB = 'ausschnitt';

  // ---------- Konfiguration (state.cfg.wa*) --------------------------------
  const DEF = {
    waSrc: 'root',          // 'root' (Wurzelprofil einer Tragfläche) | 'own' (eigenes Profil) | 'rect' (Rechteck)
    waRectL: 100,           // Rechteck: Länge (mm)
    waRectT: 6,             // Rechteck: Dicke (mm)
    waRectR: 0,             // Rechteck: Eckenradius (mm)
    waWing: null,           // Tragflächen-id (null = aktive Tragfläche)
    waProf: null,           // eigenes Profil { name, pts:[[x,y],…] } normiert (Sehne 1)
    waChord: 200,           // Profiltiefe eigenes Profil (mm)
    waScale: 100,           // Maßstab Wurzelprofil (%)
    waAngle: 0,             // Einstellwinkel (°), + = Nase hoch, Drehpunkt Endleiste
    waNose: 'left',         // Nase zeigt nach 'left' (Standard) | 'right' (Ansicht von vorne)
    waFlip: 'no',           // 'no' | 'yes' = an der Sehne gespiegelt (Oberseite unten)
    waPts: 200,             // Punkte der Kontur
    waKeep: 'block',        // 'block' (Ausschnitt = Loch) | 'profile' (Profilstück)
    waClear: 0,             // Spiel: Ausschnitt um so viel größer als das Profil (mm)
    waMatId: null,          // Werkstoff (null = globale Auswahl)
    waKerfMode: 'mat',      // 'mat' | 'manual' | 'off'
    waKerf: 1.0,            // Abbrand manuell (mm)
    waBlockW: 0, waBlockH: 0,   // Blockmaße (0 = automatisch aus Profil + Rand)
    waMargin: 40,           // Rand um das Profil bei automatischer Blockgröße (mm)
    waDepth: 100,           // Blockdicke entlang des Drahts (mm)
    waPosMode: 'manual',    // 'manual' (Standard) | 'center'
    waPosX: 40,             // Nase ↔ Blockvorderseite (Nasenseite) (mm)
    waPosY: 50,             // Nasenhöhe über Blockunterkante (mm)
    waApproach: 'top',      // 'top' | 'bottom' | 'front' (Nasenseite) | 'rear' (Endleistenseite)
    waApproachDist: 10,     // Anfahrpunkt vor der Blockfläche (mm)
    waStart: null,          // Startpunkt: Bogenlängen-Anteil 0…1 der Kontur, null = automatisch
    waDir: 'cw',            // Umlauf 'cw' (Uhrzeigersinn) | 'ccw' — wie in der Ansicht
    waView: { block: true, fill: true, cut: true, arrows: true, dims: true },
    // --- Kabinenhaubenausschnitt (waKind 'canopy'): vordere, untere („waagrechte") und hintere Linie ---
    waKind: 'wing',         // 'wing' (Profil) | 'canopy' (Kabinenhaube)
    khX: 60,                // vordere Ecke ↔ Blockvorderseite (mm)
    khDepth: 40,            // Tiefe der vorderen Ecke unter der Blockoberkante (mm)
    khLen: 150,             // Länge der unteren Linie (mm)
    khSlope: 0,             // Neigung der unteren Linie (°), + = hinten höher
    khAngF: 60, khAngR: 60, // Winkel vordere/hintere Linie zur Waagrechten (90 = senkrecht, kleiner = öffnet nach außen)
    khRadF: 15, khRadR: 15, // Übergangsradius vorne/hinten (mm, 0 = scharfe Ecke)
    khTypeF: 'line', khTypeB: 'line', khTypeR: 'line',   // je Linie 'line' (gerade) | 'spline' (gekrümmt)
    khCurvF: 5, khCurvB: 5, khCurvR: 5,                  // Wölbung (mm), + = in den Rumpf hinein
    khPosF: 50, khPosB: 50, khPosR: 50,                  // Lage der größten Wölbung (% der Linie)
    khKeep: 'canopy',       // maßhaltig: 'canopy' (Haube) | 'fus' (Rumpf) | 'mid' (Draht auf der Linie)
    khDir: 'fwd',           // 'fwd' (vorne → hinten) | 'rev'
    // freier Linienzug (khMode 'free', wie die Haubenlinie im Rumpf-Pro): Punkte von der Blockoberkante zur Blockoberkante
    khMode: 'std',          // 'std' (drei Linien) | 'free' (Linienzug)
    khPts: null             // [{ x (ab Blockvorderseite), y (Tiefe unter Oberkante), r, t line|spline|foil, curv, pos, fSrc naca|wing|dat, fThk, fProf, fSide, fNose a|b, fScale }]
  };
  if (App.GRP_OPEN_DEFAULT && App.GRP_OPEN_DEFAULT.add) ['wa_prof', 'wa_path', 'kh_form'].forEach(k => App.GRP_OPEN_DEFAULT.add(k));
  function C(k) {
    if (state.cfg[k] == null) {
      const d = DEF[k];
      if (d === undefined || d === null) return d;
      state.cfg[k] = (typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
    }
    return state.cfg[k];
  }
  function S(k, v) { state.cfg[k] = v; }
  const num = (k, d) => { const v = +C(k); return isFinite(v) ? v : d; };
  const viewCfg = () => { const v = C('waView'); return (v && typeof v === 'object') ? v : (S('waView', Object.assign({}, DEF.waView)), C('waView')); };

  // ---------- Werkstoff, Abbrand, Vorschub ----------------------------------
  const blockX = () => Math.max(0, +state.cfg.blockX || 0), blockY = () => Math.max(0, +state.cfg.blockY || 0);
  function matId() { const v = C('waMatId'); return v != null ? v : (state.material.id || ''); }
  function feed() {
    const fp = App.feedPair ? App.feedPair(matId()) : null;
    if (App.autoFeedOn && App.autoFeedOn() && fp && fp.fast > 0) return fp.fast;
    return state.cfg.feed || 200;
  }
  function kerf() {
    const m = C('waKerfMode');
    if (m === 'off') return 0;
    if (m === 'manual') return Math.max(0, num('waKerf', 0));
    const f = feed();
    return App.kerfForSpeed ? Math.max(0, App.kerfForSpeed(matId(), f, f) || 0) : 0;
  }

  // ---------- Profilquelle ---------------------------------------------------
  function wings() { return App.wingList ? App.wingList() : []; }
  function wingRec() {
    const L = wings(), id = C('waWing');
    const i = id ? L.findIndex(w => w.id === id) : -1;
    const act = state.activeWing >= 0 ? state.activeWing : 0;
    const idx = i >= 0 ? i : act;
    return { idx, root: idx === act || !L[idx] || !L[idx].root ? state.root : L[idx].root };
  }
  function wingLabel(i) { return App.wingName ? App.wingName(i) : T('Tragfläche'); }
  // → { name, pts:[{x,y}] (normiert, Selig), chord } oder null
  function profileSrc() {
    if (C('waSrc') === 'rect') {
      // Rechteck (z. B. Plattenleitwerk): Umlauf wie ein Profil — Hinterkante Mitte, Oberseite, Vorderkante, Unterseite.
      const L = Math.max(1, num('waRectL', 100)), t = Math.max(0.1, num('waRectT', 6)), h = t / 2 / L;
      const r = Math.max(0, Math.min(num('waRectR', 0), t / 2 - 1e-3, L / 2 - 1e-3)) / L, U = [[1, 0]];
      const corner = (cx, cy, a0) => { if (r < 1e-9) { U.push([cx, cy]); return; } const n = 8, mx = cx + (cx > 0.5 ? -r : r), my = cy + (cy > 0 ? -r : r); for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; U.push([mx + r * Math.cos(a), my + r * Math.sin(a)]); } };
      corner(1, h, 0); corner(0, h, Math.PI / 2); U.push([0, 0]); const iLE = U.length - 1; corner(0, -h, Math.PI); corner(1, -h, 1.5 * Math.PI);
      const f = v => (Math.round(v * 10) / 10).toString();
      return { name: T('Rechteck') + ' ' + f(L) + ' × ' + f(t) + ' mm', chord: L, U, iLE };
    }
    if (C('waSrc') === 'own') {
      const p = C('waProf');
      if (!p || !Array.isArray(p.pts) || p.pts.length < 5) return null;
      return { name: p.name || T('Eigenes Profil'), pts: p.pts.map(a => ({ x: a[0], y: a[1] })), chord: Math.max(1, num('waChord', 200)) };
    }
    const w = wingRec(), r = w.root;
    if (!r || !Array.isArray(r.profile) || r.profile.length < 5) return null;
    const sc = Math.max(1, num('waScale', 100)) / 100;
    return { name: (r.profile.name || T('Wurzelprofil')) + ' · ' + wingLabel(w.idx), pts: r.profile.map(p => ({ x: p.x, y: p.y })), chord: Math.max(1, (+r.chord || 200) * sc), wingIdx: w.idx };
  }

  // ---------- Geometrie-Helfer -----------------------------------------------
  function area(P) { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function segX(a, b, c, d) {   // Schnittpunkt der Strecken ab und cd (echt), sonst null
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
    return [a[0] + t * rx, a[1] + t * ry, t];
  }
  // Nächster Punkt auf dem geschlossenen Polygon: { i (Kante i→i+1), t, p, d }
  function nearestOnPoly(P, x, y) {
    let best = null;
    for (let i = 0, n = P.length; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
      const px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { i, t, p: [px, py], d };
    }
    return best;
  }
  // Parallelversatz eines geschlossenen Polygons um d (+ = nach außen).
  // Spitze Ecken (Endleiste) nach außen gefast statt langer Gehrungsspitze.
  function offsetClosed(P, d) {
    const n = P.length; if (Math.abs(d) < 1e-9) return P.map(p => p.slice());
    const sg = area(P) > 0 ? 1 : -1;   // gegen den Uhrzeigersinn: Außennormale = (dy, −dx)
    const nrm = i => { const a = P[i], b = P[(i + 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [sg * dy / L, -sg * dx / L]; };
    const out = [];
    for (let i = 0; i < n; i++) {
      const n1 = nrm((i - 1 + n) % n), n2 = nrm(i), p = P[i];
      let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const ml = Math.hypot(mx, my);
      const cosH = ml / 2;   // cos(halber Knickwinkel der Normalen)
      if (ml < 1e-9 || cosH < 0.35) {
        // Spitze Ecke: je ein Punkt auf beiden Nachbarkanten (Fase auf der offenen
        // Seite; auf der überlappenden Seite entsteht eine Mini-Schlaufe → deloop).
        out.push([p[0] + n1[0] * d, p[1] + n1[1] * d]); out.push([p[0] + n2[0] * d, p[1] + n2[1] * d]); continue;
      }
      mx /= ml; my /= ml; const f = d / cosH;
      out.push([p[0] + mx * f, p[1] + my * f]);
    }
    return deloop(out);
  }
  // Selbstschnitte entfernen: jeweils die kleinere Schlaufe (weniger Punkte) herausnehmen.
  function deloop(Q) {
    for (let guard = 0; guard < 200; guard++) {
      const n = Q.length; if (n < 4) return Q;
      let hit = null;
      outer: for (let i = 0; i < n; i++) {
        const a = Q[i], b = Q[(i + 1) % n];
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const x = segX(a, b, Q[j], Q[(j + 1) % n]);
          if (x) { hit = { i, j, x }; break outer; }
        }
      }
      if (!hit) return Q;
      const { i, j, x } = hit, inner = j - i;   // Punkte i+1…j bilden eine Schlaufe
      const X = [x[0], x[1]];
      if (inner <= n - inner) Q = Q.slice(0, i + 1).concat([X], Q.slice(j + 1));
      else Q = [X].concat(Q.slice(i + 1, j + 1));
    }
    return Q;
  }

  // ======================================================================
  //  Berechnung
  // ======================================================================
  let lastRes = null;
  const isCanopy = () => C('waKind') === 'canopy';

  // ---------- Kabinenhaubenausschnitt: Geometrie ------------------------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // Linie a→b: gerade oder Spline durch den Wölbungspunkt (quadratische Bézier-Kurve).
  // bulge > 0 = rechts der Laufrichtung (vorne → hinten: in den Rumpf hinein).
  function khCurve(a, b, type, bulge, pos) {
    if (type !== 'spline') return { pts: [a.slice(), b.slice()], m: null };
    const t = Math.max(0.1, Math.min(0.9, pos / 100)), d = sub(b, a), L = Math.hypot(d[0], d[1]) || 1;
    const q = lerp(a, b, t), M = [q[0] + d[1] / L * bulge, q[1] - d[0] / L * bulge];
    if (Math.abs(bulge) < 1e-6) return { pts: [a.slice(), b.slice()], m: M };
    const w = 2 * t * (1 - t), cx = (M[0] - (1 - t) * (1 - t) * a[0] - t * t * b[0]) / w, cy = (M[1] - (1 - t) * (1 - t) * a[1] - t * t * b[1]) / w;
    const pts = [], n = 48;
    for (let i = 0; i <= n; i++) { const u = i / n, k0 = (1 - u) * (1 - u), k1 = 2 * u * (1 - u), k2 = u * u; pts.push([k0 * a[0] + k1 * cx + k2 * b[0], k0 * a[1] + k1 * cy + k2 * b[1]]); }
    return { pts, m: M };
  }
  // Parallelversatz eines offenen Linienzugs um d (+ = links der Laufrichtung).
  function offsetOpen(P, d) {
    if (Math.abs(d) < 1e-9) return P.map(p => p.slice());
    const n = P.length, nl = i => { const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; };
    const out = [];
    for (let i = 0; i < n; i++) {
      const n1 = nl(Math.max(0, i - 1)), n2 = nl(Math.min(n - 2, i)), p = P[i];
      const mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my), cosH = ml / 2;
      if (ml < 1e-9 || cosH < 0.35) { out.push([p[0] + n1[0] * d, p[1] + n1[1] * d]); out.push([p[0] + n2[0] * d, p[1] + n2[1] * d]); continue; }
      out.push([p[0] + mx / ml * d / cosH, p[1] + my / ml * d / cosH]);
    }
    return out;
  }
  function deloopOpen(Q) {
    for (let guard = 0; guard < 200; guard++) {
      const n = Q.length; let hit = null;
      outer: for (let i = 0; i < n - 1; i++) for (let j = i + 2; j < n - 1; j++) { const x = segX(Q[i], Q[i + 1], Q[j], Q[j + 1]); if (x) { hit = { i, j, x }; break outer; } }
      if (!hit) return Q;
      Q = Q.slice(0, hit.i + 1).concat([[hit.x[0], hit.x[1]]], Q.slice(hit.j + 1));
    }
    return Q;
  }
  function segXi(a, b, c, d) {   // wie segX, Endpunkte eingeschlossen
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return [a[0] + t * rx, a[1] + t * ry];
  }
  function nearestOpen(P, x, y) {
    let best = null;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
      const px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { i, t, p: [px, py], d };
    }
    return best;
  }
  // Übergangsradius zwischen Linienzug A (endet in der Ecke) und B (beginnt dort):
  // Mittelpunkt = Schnitt der beiden um r versetzten Linien (gilt auch für Splines).
  // → { A, arc, B } · null = kein Radius nötig · false = Radius passt nicht.
  function khFillet(A, B, r) {
    if (!(r > 1e-6)) return null;
    const tA = sub(A[A.length - 1], A[A.length - 2]), tB = sub(B[1], B[0]);
    const cr = (tA[0] * tB[1] - tA[1] * tB[0]) / ((Math.hypot(tA[0], tA[1]) || 1) * (Math.hypot(tB[0], tB[1]) || 1));
    if (Math.abs(cr) < 1e-4) return null;
    const s = cr > 0 ? 1 : -1, oA = offsetOpen(A, s * r), oB = offsetOpen(B, s * r), corner = B[0];
    let c = null, cd = Infinity;
    for (let i = 0; i < oA.length - 1; i++) for (let j = 0; j < oB.length - 1; j++) {
      const x = segXi(oA[i], oA[i + 1], oB[j], oB[j + 1]);
      if (x) { const d = Math.hypot(x[0] - corner[0], x[1] - corner[1]); if (d < cd) { cd = d; c = x; } }
    }
    if (!c) return false;
    const fa = nearestOpen(A, c[0], c[1]), fb = nearestOpen(B, c[0], c[1]);
    const a0 = Math.atan2(fa.p[1] - c[1], fa.p[0] - c[0]); let da = Math.atan2(fb.p[1] - c[1], fb.p[0] - c[0]) - a0;
    if (s > 0) { while (da <= 0) da += 2 * Math.PI; } else { while (da >= 0) da -= 2 * Math.PI; }
    if (Math.abs(da) > Math.PI) return false;
    const m = Math.max(2, Math.ceil(Math.abs(da) / (4 * Math.PI / 180))), arc = [];
    for (let i = 1; i < m; i++) { const a = a0 + da * i / m; arc.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return { A: A.slice(0, fa.i + 1).concat([fa.p]), arc, B: [fb.p].concat(B.slice(fb.i + 1)) };
  }
  function joinPts(parts) {
    const out = [];
    parts.forEach(P => P.forEach(p => { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) out.push(p); }));
    return out;
  }
  const polyLen = P => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };

  // ---------- Freier Linienzug (khMode 'free') -------------------------------------
  // Normiertes Profil ({x,y}, x 0..1) → Ober-/Unterseite als Funktion von u.
  function profFn(pts) {
    if (!Array.isArray(pts) || pts.length < 4) return null;
    pts = pts.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : p);
    let iLE = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const my = a => a.reduce((s, p) => s + p.y, 0) / (a.length || 1);
    let up = pts.slice(0, iLE + 1), lo = pts.slice(iLE); if (my(up) < my(lo)) { const t = up; up = lo; lo = t; }
    const sx = a => a.slice().sort((p, q) => p.x - q.x); up = sx(up); lo = sx(lo);
    if (up.length < 2 || lo.length < 2) return null;
    const at = (a, u) => {
      if (u <= a[0].x) return a[0].y; if (u >= a[a.length - 1].x) return a[a.length - 1].y;
      let l = 0, h = a.length - 1; while (h - l > 1) { const m = (l + h) >> 1; if (a[m].x <= u) l = m; else h = m; }
      const d = a[h].x - a[l].x; return d > 1e-12 ? a[l].y + (a[h].y - a[l].y) * (u - a[l].x) / d : a[l].y;
    };
    return { up: u => at(up, u), lo: u => at(lo, u) };
  }
  const NACA = {};
  function nacaProf(thk) { const t = Math.max(1, Math.min(40, Math.round(+thk || 12))); return NACA[t] || (NACA[t] = (window.Airfoil && Airfoil.naca4) ? Airfoil.naca4('00' + String(t).padStart(2, '0'), 80) : null); }
  // Abschnitt a→b als eine Seite eines Tragflächenprofils: Sehne = Strecke a–b, Profilhöhe senkrecht dazu
  // (+ = rechts der Laufrichtung, wie die Wölbung der Splines). → { pts, m (Griff an der dicksten Stelle), hm } · null = kein Profil
  function khFoil(a, b, s) {
    const pf = s.fSrc === 'dat' ? (s.fProf && s.fProf.pts ? profFn(s.fProf.pts) : null) : s.fSrc === 'wing' ? profFn(wingRec().root && wingRec().root.profile) : profFn(nacaProf(s.fThk || 12));
    if (!pf) return null;
    const d = sub(b, a), L = Math.hypot(d[0], d[1]) || 1, nx = d[1] / L, ny = -d[0] / L;
    const sc = (s.fScale == null || !isFinite(+s.fScale) ? 100 : +s.fScale) / 100, lo = s.fSide === 'lo', rev = s.fNose === 'b';
    const h = u => lo ? -pf.lo(u) : pf.up(u), h0 = h(0), h1 = h(1), n = 72, pts = []; let m = null, hm = 0;
    for (let i = 0; i <= n; i++) {
      const c = (1 - Math.cos(Math.PI * i / n)) / 2, t = rev ? 1 - c : c, off = (h(c) - h0 * (1 - c) - h1 * c) * L;
      const p = [a[0] + d[0] * t + nx * off * sc, a[1] + d[1] * t + ny * off * sc]; pts.push(p);
      if (Math.abs(off) > Math.abs(hm)) { hm = off; m = p; }
    }
    if (rev) pts.reverse();
    pts[0] = a.slice(); pts[pts.length - 1] = b.slice();
    return { pts, m, hm };
  }
  // Freier Linienzug lokal (Ursprung = Blockvorderseite oben, x nach hinten, y nach oben): erster und letzter Punkt
  // auf der Oberkante, je Abschnitt gerade / Spline / Profilseite, je Innenpunkt ein Übergangsradius.
  // → { N, Pn, S, H (Griffe lokal) } · { err }
  function khFreeLine(src, warns) {
    const n = src.length;
    if (n < 2) return { err: T('Kabinenhaube zu klein.') };
    const P = src.map((s, i) => [Math.max(0, +s.x || 0), i === 0 || i === n - 1 ? 0 : -Math.max(0, +s.y || 0)]);
    const H = P.map((p, i) => ({ id: 'n' + i, p })), S = [], cv = [];
    for (let i = 0; i < n - 1; i++) {
      const s = src[i], a = P[i], b = P[i + 1]; let c;
      if (s.t === 'foil') { c = khFoil(a, b, s); if (!c) { warns.push(T('Kein Profil geladen — der Abschnitt bleibt gerade.')); c = { pts: [a.slice(), b.slice()], m: null }; } }
      else c = khCurve(a, b, s.t, +s.curv || 0, +s.pos || 50);
      S.push(c); cv.push(c.pts); if (c.m) H.push({ id: 's' + i, p: c.m });
    }
    const parts = []; let A = cv[0];
    for (let i = 1; i < n - 1; i++) {
      let B = cv[i]; const r = Math.max(0, +src[i].r || 0), f = r > 0 ? (A.length > 1 ? khFillet(A, B, r) : false) : null;
      if (f) { parts.push(f.A, f.arc); B = joinPts([f.B]); }
      else { if (f === false) warns.push(T('Der Eckradius passt nicht zwischen die Linien — kleiner wählen.') + ' (' + T('Punkt') + ' ' + (i + 1) + ')'); parts.push(A); }
      A = B;
    }
    parts.push(A);
    return { N: joinPts(parts), Pn: P, S, H };
  }
  // Freien Linienzug aus den drei Linien übernehmen (res = Ergebnis im Modus 'std') bzw. Vorgabe anlegen.
  function khToFree(res) {
    const r1 = v => Math.round(v * 10) / 10;
    const sg = (t, c, p, r, q) => ({ x: r1(q[0]), y: r1(Math.max(0, -q[1])), r: r || 0, t: t === 'spline' ? 'spline' : 'line', curv: +c || 0, pos: +p || 50 });
    const L = res && res.loc && res.loc.P1 ? res.loc : null;
    if (L) {
      const tl = q => [q[0] + L.kx, q[1] - L.dep];   // lokal (Ecke) → Blockvorderseite oben
      const P1 = tl(L.P1), P4 = tl(L.P4); P1[1] = 0; P4[1] = 0;
      S('khPts', [sg(C('khTypeF'), num('khCurvF', 0), num('khPosF', 50), 0, P1), sg(C('khTypeB'), num('khCurvB', 0), num('khPosB', 50), num('khRadF', 0), tl(L.P2)),
        sg(C('khTypeR'), num('khCurvR', 0), num('khPosR', 50), num('khRadR', 0), tl(L.P3)), sg('line', 0, 50, 0, P4)]);
    } else S('khPts', [sg('line', 0, 50, 0, [20, 0]), sg('line', 0, 50, 15, [60, -40]), sg('line', 0, 50, 15, [210, -40]), sg('line', 0, 50, 0, [250, 0])]);
  }
  const isFree = () => C('khMode') === 'free' && Array.isArray(C('khPts')) && C('khPts').length >= 2;
  let khSel = 0;   // gewählter Punkt des freien Linienzugs

  // Rechnet lokal (vordere Ecke = Ursprung, x nach hinten, y nach oben, Nase links)
  // und spiegelt/verschiebt erst am Ende in Maschinenkoordinaten.
  // Block lokal (Ursprung o = [ox, oy] im Block-Rahmen): Innen-Test und Weg bis zum Austritt.
  function localBlock(kx, dep, W, H) {
    const lb = { x0: -kx, x1: -kx + W, y0: dep - H, y1: dep };
    const inside = p => p[0] > lb.x0 + 1e-6 && p[0] < lb.x1 - 1e-6 && p[1] > lb.y0 + 1e-6 && p[1] < lb.y1 - 1e-6;
    const exitT = (p, d) => {
      if (!inside(p)) return 0;
      let t = Infinity;
      if (d[0] > 1e-12) t = Math.min(t, (lb.x1 - p[0]) / d[0]); else if (d[0] < -1e-12) t = Math.min(t, (lb.x0 - p[0]) / d[0]);
      if (d[1] > 1e-12) t = Math.min(t, (lb.y1 - p[1]) / d[1]); else if (d[1] < -1e-12) t = Math.min(t, (lb.y0 - p[1]) / d[1]);
      return isFinite(t) ? Math.max(0, t) : 0;
    };
    return { lb, inside, exitT };
  }
  // Freier Linienzug: lokal mit Ursprung an der Blockvorderseite oben (kx = dep = 0).
  function buildCanopyFree() {
    const warns = [], notes = [], src = C('khPts');
    const R = khFreeLine(src, warns);
    if (R.err) return { empty: true, msg: R.err };
    const N = R.N; if (N.length < 2) return { empty: true, msg: T('Kabinenhaube zu klein.') };
    let mx = 0, my = 0; N.forEach(p => { mx = Math.max(mx, p[0]); my = Math.max(my, -p[1]); });
    const mg = Math.max(0, num('waMargin', 40));
    const W = num('waBlockW', 0) > 0 ? num('waBlockW', 0) : Math.max(10, mx + mg);
    const H = num('waBlockH', 0) > 0 ? num('waBlockH', 0) : Math.max(10, my + mg);
    const B = localBlock(0, 0, W, H);
    for (let i = 1; i < R.Pn.length - 1; i++) if (!B.inside(R.Pn[i])) return { empty: true, msg: T('Punkt') + ' ' + (i + 1) + ': ' + T('liegt außerhalb des Blocks — X, Tiefe oder Blockmaße anpassen.') };
    if (R.Pn[0][0] >= W || R.Pn[R.Pn.length - 1][0] >= W) return { empty: true, msg: T('Die Endpunkte der Haubenlinie liegen außerhalb des Blocks — X oder Blockbreite anpassen.') };
    const Pn = R.Pn, depth = Math.max(0, ...Pn.map(p => -p[1]));
    // Abbrandseite gilt für die Laufrichtung vorne → hinten: von hinten eingegebene Punkte umdrehen.
    if (Pn[0][0] > Pn[Pn.length - 1][0]) N.reverse();
    return canopyFinish({ N, kx: 0, dep: 0, W, H, B, warns, notes, handles: R.H, corners: Pn,
      loc: { free: true, Pn, S: R.S, kx: 0, dep: 0 }, chord: Math.abs(Pn[Pn.length - 1][0] - Pn[0][0]), angle: 0,
      kh: { free: true, n: Pn.length, x0: Pn[0][0], x1: Pn[Pn.length - 1][0], depth } });
  }
  function buildCanopy() {
    if (isFree()) return buildCanopyFree();
    const warns = [], notes = [], rad = Math.PI / 180;
    const kx = num('khX', 60), dep = num('khDepth', 40), L = Math.max(5, num('khLen', 150));
    const sl = Math.max(-60, Math.min(60, num('khSlope', 0))) * rad;
    const aF = Math.max(10, Math.min(170, num('khAngF', 60))) * rad, aR = Math.max(10, Math.min(170, num('khAngR', 60))) * rad;
    const P2 = [0, 0], P3 = [L * Math.cos(sl), L * Math.sin(sl)];
    const dF = [-Math.cos(aF), Math.sin(aF)], dR = [Math.cos(aR), Math.sin(aR)];
    // Block: fest oder automatisch (Haube + Rand hinten und unten).
    const mg = Math.max(0, num('waMargin', 40));
    const rearTop = P3[0] + Math.max(0, dep - P3[1]) * Math.cos(aR) / Math.sin(aR);
    const W = num('waBlockW', 0) > 0 ? num('waBlockW', 0) : Math.max(10, kx + Math.max(P3[0], rearTop) + mg);
    const H = num('waBlockH', 0) > 0 ? num('waBlockH', 0) : Math.max(10, dep + Math.max(0, -P3[1]) + mg);
    const LB = localBlock(kx, dep, W, H), inside = LB.inside, exitT = LB.exitT;
    if (!inside(P2) || !inside(P3)) return { empty: true, msg: T('Die Ecken der Kabinenhaube liegen außerhalb des Blocks — Lage, Tiefe, Länge oder Blockmaße anpassen.') };
    const tF = exitT(P2, dF), tR = exitT(P3, dR);
    const P1 = [P2[0] + dF[0] * tF, P2[1] + dF[1] * tF], P4 = [P3[0] + dR[0] * tR, P3[1] + dR[1] * tR];
    const cF = khCurve(P1, P2, C('khTypeF'), num('khCurvF', 0), num('khPosF', 50));
    const cB = khCurve(P2, P3, C('khTypeB'), num('khCurvB', 0), num('khPosB', 50));
    const cR = khCurve(P3, P4, C('khTypeR'), num('khCurvR', 0), num('khPosR', 50));
    // Übergangsradien
    let A = cF.pts, B = cB.pts, Cc = cR.pts, arc1 = [], arc2 = [];
    const f1 = khFillet(A, B, Math.max(0, num('khRadF', 0)));
    if (f1) { A = f1.A; arc1 = f1.arc; B = f1.B; } else if (f1 === false) warns.push(T('Der vordere Radius passt nicht zwischen die Linien — kleiner wählen.'));
    B = joinPts([B]);
    const f2 = B.length > 1 ? khFillet(B, Cc, Math.max(0, num('khRadR', 0))) : false;
    if (f2) { B = f2.A; arc2 = f2.arc; Cc = f2.B; } else if (f2 === false) warns.push(T('Der hintere Radius passt nicht zwischen die Linien — kleiner wählen.'));
    const N = joinPts([A, arc1, B, arc2, Cc]);
    const handles = [{ id: 'c2', p: P2 }, { id: 'c3', p: P3 }, { id: 't1', p: P1 }, { id: 't4', p: P4 }];
    if (cF.m) handles.push({ id: 'mF', p: cF.m }); if (cB.m) handles.push({ id: 'mB', p: cB.m }); if (cR.m) handles.push({ id: 'mR', p: cR.m });
    return canopyFinish({ N, kx, dep, W, H, B: { inside, exitT }, warns, notes, handles, corners: [P1, P2, P3, P4], loc: { P1, P2, P3, P4, kx, dep }, chord: L, angle: sl / rad,
      kh: { x: kx, depth: dep, len: L, slope: sl / rad, angF: aF / rad, angR: aR / rad, radF: f1 ? num('khRadF', 0) : 0, radR: f2 ? num('khRadR', 0) : 0 } });
  }
  // Gemeinsamer Schluss: Abbrand-Versatz, Überlauf, Maschinenkoordinaten, Luftwege.
  function canopyFinish(o) {
    const { N, kx, dep, W, H, warns, notes } = o, exitT = o.B.exitT, noseRight = C('waNose') === 'right';
    const D = Math.max(1, num('waDepth', 100));
    const blk = { x0: blockX(), y0: blockY(), w: W, h: H, d: D }; blk.x1 = blk.x0 + W; blk.y1 = blk.y0 + H;
    // Schnittbahn: Abbrand auf die Seite, die NICHT maßhaltig sein muss (links der Laufrichtung = Haube).
    const k = kerf(), keep = ['canopy', 'fus', 'mid'].indexOf(C('khKeep')) >= 0 ? C('khKeep') : 'canopy';
    const off = keep === 'canopy' ? -k / 2 : keep === 'fus' ? k / 2 : 0;
    let path = deloopOpen(joinPts([offsetOpen(N, off)]));
    if (path.length < 2) return { empty: true, msg: T('Kabinenhaube zu klein für den Abbrand.') };
    const cutLen = polyLen(path);
    // Überlauf: in Linienrichtung aus dem Block hinaus + Abstand.
    const dist = Math.max(0, num('waApproachDist', 10));
    const ext = (p, q) => { const d = sub(p, q), l = Math.hypot(d[0], d[1]) || 1, u = [d[0] / l, d[1] / l], e = exitT(p, u) + dist; return e > 1e-6 ? [p[0] + u[0] * e, p[1] + u[1] * e] : null; };
    const e0 = ext(path[0], path[1]), e1 = ext(path[path.length - 1], path[path.length - 2]);
    if (e0) path.unshift(e0); if (e1) path.push(e1);
    // → Maschinenkoordinaten
    const tw = p => [noseRight ? blk.x1 - (p[0] + kx) : blk.x0 + p[0] + kx, blk.y1 - dep + p[1]];
    let clamped = false;
    let loop = path.map(p => { const q = tw(p); if (q[0] < 0) { q[0] = 0; clamped = true; } if (q[1] < 0) { q[1] = 0; clamped = true; } return q; });
    if (clamped) notes.push(T('Überlauf am Nullpunkt begrenzt (X bzw. Y kleiner 0 ist nicht möglich).'));
    const fwd = C('khDir') !== 'rev'; if (!fwd) loop.reverse();
    // Luftwege: über dem Block bzw. links davon direkt, rechts davon über den Block hinweg.
    const safeTop = blk.y1 + Math.max(dist, 2);
    const routeTo = P => {
      if (P[0] <= blk.x0 + 1e-6 && P[1] < blk.y1) return [[0, P[1]], P];
      if (P[1] >= blk.y1 - 1e-6) { const ty = Math.max(P[1], blk.y1 + 2); return ty > P[1] + 1e-6 ? [[0, ty], [P[0], ty], P] : [[0, ty], P]; }
      return [[0, safeTop], [P[0], safeTop], P];
    };
    const S0 = loop[0], Z0 = loop[loop.length - 1], pts = [[0, 0, 'start']];
    routeTo(S0).forEach(p => pts.push([p[0], p[1], 'air']));
    for (let q = 1; q < loop.length; q++) pts.push([loop[q][0], loop[q][1], 'cut']);
    routeTo(Z0).slice(0, -1).reverse().forEach(p => pts.push([p[0], p[1], 'air']));
    pts.push([0, 0, 'air']);
    const handles = o.handles.map(h => ({ id: h.id, p: tw(h.p) }));
    return {
      empty: false, kind: 'canopy', free: !!o.loc.free, name: T('Kabinenhaube'), chord: o.chord, angle: o.angle, noseRight, contour: N.map(tw), path: loop, loop,
      Sp: S0, E: S0, Ap: S0, side: null, ap: 'top', startPicked: false, dirCW: fwd, fwd, block: blk, keep, clear: 0, k, off, feed: feed(),
      cutLen, loopLen: polyLen(loop), pts, warns, notes, handles,
      corners: o.corners.map(tw), loc: o.loc, kh: o.kh
    };
  }

  function build() {
    if (isCanopy()) { lastRes = buildCanopy(); return lastRes; }
    const warns = [], notes = [];
    const src = profileSrc();
    if (!src) { lastRes = { empty: true, msg: C('waSrc') === 'own' ? T('Kein eigenes Profil geladen — links „Profil laden…" oder die Profildatenbank benutzen.') : T('Die Tragfläche hat kein Wurzelprofil.') }; return lastRes; }
    // Kontur normiert (Sehne 1, Nase bei 0): gleichmäßig neu abtasten, schließen.
    let raw = src.pts || [];
    if (!src.U) { let x0 = Infinity, x1 = -Infinity; raw.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); });
      const c = x1 - x0; if (c > 2 || c < 0.5) raw = raw.map(p => ({ x: (p.x - x0) / (c || 1), y: p.y / (c || 1) })); }
    const N = Math.max(40, Math.min(1000, Math.round(num('waPts', 200))));
    let U = src.U ? src.U : (window.Airfoil && Airfoil.resample ? Airfoil.resample(raw, N) : raw).map(p => [p.x, p.y]);
    if (U.length > 3 && Math.hypot(U[0][0] - U[U.length - 1][0], U[0][1] - U[U.length - 1][1]) < 1e-6) U.pop();
    // Bogenlängen-Anteil je Punkt (für den Startpunkt).
    const sArr = [0]; for (let i = 1; i < U.length; i++) sArr.push(sArr[i - 1] + Math.hypot(U[i][0] - U[i - 1][0], U[i][1] - U[i - 1][1]));
    const sTot = sArr[sArr.length - 1] + Math.hypot(U[0][0] - U[U.length - 1][0], U[0][1] - U[U.length - 1][1]) || 1;
    const sN = sArr.map(s => s / sTot);
    // Maßstab, Einstellwinkel (Drehpunkt Endleiste (c,0), + = Nase hoch), Nasenrichtung.
    const c = src.chord, al = num('waAngle', 0) * Math.PI / 180, ca = Math.cos(al), sa = Math.sin(al);
    const noseRight = C('waNose') === 'right';
    // Profil-Grundlage: Nase bei x=0, Endleiste bei +x (fliegt nach −x). Bei „Nase rechts" spiegeln.
    // „Gespiegelt": an der Sehne (vor der Drehung), die Oberseite liegt dann unten.
    const flip = C('waFlip') === 'yes';
    const loc = U.map(([u, v]) => { const x = u * c - c, y = (flip ? -v : v) * c; const xr = c + x * ca + y * sa, yr = -x * sa + y * ca; return [noseRight ? -xr : xr, yr]; });
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    loc.forEach(p => { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); });
    const pw = bx1 - bx0, ph = by1 - by0;
    // Block
    const mg = Math.max(0, num('waMargin', 40));
    // Automatische Blockgröße: mittig = Profil + Rand ringsum; bei „Abstand angeben"
    // = Abstand Nase/Nasenhöhe + Profil bis zur fernen Kante + Rand (Nase bei lokal 0,0).
    const manualPos = C('waPosMode') === 'manual';
    const farX = noseRight ? -bx0 : bx1;   // Nase → hinterster Profilpunkt
    const W = num('waBlockW', 0) > 0 ? num('waBlockW', 0) : manualPos ? Math.max(0, num('waPosX', 40)) + farX + mg : pw + 2 * mg;
    const H = num('waBlockH', 0) > 0 ? num('waBlockH', 0) : manualPos ? Math.max(0, num('waPosY', 50)) + by1 + mg : ph + 2 * mg;
    const D = Math.max(1, num('waDepth', 100));
    const blk = { x0: blockX(), y0: blockY(), w: W, h: H, d: D }; blk.x1 = blk.x0 + W; blk.y1 = blk.y0 + H;
    // Lage: mittig oder Nase frei (Abstand zur Blockvorderseite = Nasenseite, Höhe über Unterkante).
    let dx, dy;
    if (C('waPosMode') === 'manual') {
      const px = num('waPosX', 40), py = num('waPosY', 50);
      dx = noseRight ? blk.x1 - px : blk.x0 + px; dy = blk.y0 + py;
    } else { dx = (blk.x0 + blk.x1) / 2 - (bx0 + bx1) / 2; dy = (blk.y0 + blk.y1) / 2 - (by0 + by1) / 2; }
    const contour = loc.map(p => [p[0] + dx, p[1] + dy]);
    const nose = [dx, dy];   // Bezugspunkt der Lage = Nase des UNGEDREHTEN Profils
    let iLE = 0; U.forEach((q, i) => { if (q[0] < U[iLE][0]) iLE = i; });
    if (src.iLE != null) iLE = src.iLE;
    const noseAct = contour[iLE];                                   // Nase nach der Drehung
    const teAct = [dx + (noseRight ? -c : c), dy];                  // Endleiste (Drehpunkt, bleibt stehen)
    // Schnittbahn: Versatz der Kontur.
    const k = kerf(), keep = C('waKeep') === 'profile' ? 'profile' : 'block';
    const clear = keep === 'block' ? Math.max(0, num('waClear', 0)) : 0;
    const off = keep === 'block' ? clear - k / 2 : k / 2;
    let path = offsetClosed(contour, off);
    if (path.length < 3) { lastRes = { empty: true, msg: T('Profil zu klein für den Abbrand.') }; return lastRes; }
    // Passt das Profil in den Block?
    { let e = Infinity; path.concat(contour).forEach(p => { e = Math.min(e, p[0] - blk.x0, blk.x1 - p[0], p[1] - blk.y0, blk.y1 - p[1]); });
      if (e < 0) warns.push(T('Das Profil ragt aus dem Block — Blockmaße oder Lage anpassen.'));
      else if (e < 2) warns.push(T('Das Profil liegt weniger als 2 mm an der Blockkante.')); }
    // Anfahrfläche (Seite im Bild): vorne = Nasenseite, hinten = Endleistenseite.
    const ap = ['top', 'bottom', 'front', 'rear'].indexOf(C('waApproach')) >= 0 ? C('waApproach') : 'top';
    const side = ap === 'top' ? 'top' : ap === 'bottom' ? 'bottom' : ((ap === 'front') === noseRight ? 'right' : 'left');
    // Startpunkt: gewählt (Bogenlänge → Konturpunkt → nächster Bahnpunkt) oder automatisch.
    let startC = null, ws = C('waStart');
    if (ws != null && isFinite(+ws)) {
      ws = ((+ws % 1) + 1) % 1;
      let i = 0; while (i < sN.length - 1 && sN[i + 1] <= ws) i++;
      const s0 = sN[i], s1 = i + 1 < sN.length ? sN[i + 1] : 1, t = s1 > s0 ? (ws - s0) / (s1 - s0) : 0;
      const a = contour[i], b = contour[(i + 1) % contour.length];
      startC = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    let i0;
    if (startC) {
      const nb = nearestOnPoly(path, startC[0], startC[1]);
      if (nb.t < 1e-6) i0 = nb.i;
      else if (nb.t > 1 - 1e-6) i0 = (nb.i + 1) % path.length;
      else { path.splice(nb.i + 1, 0, nb.p); i0 = nb.i + 1; }
    } else {
      const score = p => side === 'top' ? p[1] : side === 'bottom' ? -p[1] : side === 'right' ? p[0] : -p[0];
      i0 = 0; path.forEach((p, i) => { if (score(p) > score(path[i0]) + 1e-9) i0 = i; });
    }
    const Sp = path[i0];
    // Umlaufrichtung: in der Ansicht (x rechts, y oben) ist cw = negative Fläche.
    const A = area(path), wantCW = C('waDir') !== 'ccw';
    const fwd = wantCW ? A < 0 : A > 0;
    const loop = [];
    for (let q = 0, n = path.length; q <= n; q++) loop.push(path[((fwd ? i0 + q : i0 - q) % n + n) % n]);
    // Eintritt senkrecht zur gewählten Blockfläche.
    const dist = Math.max(0, num('waApproachDist', 10));
    const E = side === 'top' ? [Sp[0], blk.y1] : side === 'bottom' ? [Sp[0], blk.y0] : side === 'right' ? [blk.x1, Sp[1]] : [blk.x0, Sp[1]];
    let Ap = side === 'top' ? [E[0], E[1] + dist] : side === 'bottom' ? [E[0], E[1] - dist] : side === 'right' ? [E[0] + dist, E[1]] : [E[0] - dist, E[1]];
    if (Ap[1] < 0) { Ap[1] = 0; notes.push(T('Anfahrpunkt unten auf Y = 0 begrenzt (Blockhöhe über Nullpunkt kleiner als der Anfahrabstand).')); }
    if (Ap[0] < 0) { Ap[0] = 0; notes.push(T('Anfahrpunkt links auf X = 0 begrenzt (Blockabstand X kleiner als der Anfahrabstand).')); }
    // Anfahrweg durch das Profil?
    { let cross = 0; const n = path.length;
      for (let q = 0; q < n; q++) { const a = path[q], b = path[(q + 1) % n]; if (q === i0 || (q + 1) % n === i0) continue; if (segX(E, Sp, a, b)) cross++; }
      if (cross) {
        if (keep === 'profile') warns.push(T('Der Anfahrweg schneidet durch das Profilstück — anderen Startpunkt oder andere Anfahrrichtung wählen.'));
        else notes.push(T('Der Anfahrweg läuft durch den Ausschnitt (Abfall) — unkritisch.'));
      } }
    // Luftwege vom Nullpunkt zum Anfahrpunkt (um den Block herum).
    const O = [0, 0], safeTop = blk.y1 + dist;
    let route;
    if (side === 'right') route = [[0, safeTop], [Ap[0], safeTop], Ap];
    else route = [[0, Ap[1]], Ap];
    const pts = [[O[0], O[1], 'start']];
    route.forEach(p => pts.push([p[0], p[1], 'air']));
    pts.push([E[0], E[1], 'enter']); pts.push([Sp[0], Sp[1], 'enter']);
    for (let q = 1; q < loop.length; q++) pts.push([loop[q][0], loop[q][1], 'cut']);
    pts.push([E[0], E[1], 'exit']); pts.push([Ap[0], Ap[1], 'exit']);
    route.slice(0, -1).reverse().forEach(p => pts.push([p[0], p[1], 'air']));
    pts.push([O[0], O[1], 'air']);
    // Schnittlänge (im Block)
    let cutLen = 0, loopLen = 0;
    for (let q = 1; q < loop.length; q++) loopLen += Math.hypot(loop[q][0] - loop[q - 1][0], loop[q][1] - loop[q - 1][1]);
    cutLen = loopLen + 2 * Math.hypot(Sp[0] - E[0], Sp[1] - E[1]);
    lastRes = {
      empty: false, name: src.name, chord: c, angle: num('waAngle', 0), noseRight, contour, sN, path, loop, i0, Sp, E, Ap, side, ap,
      startPicked: !!startC, dirCW: wantCW, nose, noseAct, teAct, block: blk, keep, clear, k, off, feed: feed(), cutLen, loopLen, pts, warns, notes,
      pw, ph, origin: { x: 0, y: 0 }
    };
    return lastRes;
  }

  // ======================================================================
  //  Fahrten als Daten (Maschinenkoordinaten) — Text macht ausschnitt_gcode.js
  // ======================================================================
  function machineMoves() {
    const r = build(); if (!r || r.empty) return null;
    const blk = r.block, f = r.feed, maxF = state.cfg.maxFeed || 0;
    const outF = App.outsideFeed ? App.outsideFeed() : f;
    const inBlock = (a, b) => {   // Strecke berührt das Blockinnere? (Liang-Barsky)
      let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
      const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q > 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
      const e = 1e-6;
      return clip(-dx, a[0] - blk.x0 - e) && clip(dx, blk.x1 - e - a[0]) && clip(-dy, a[1] - blk.y0 - e) && clip(dy, blk.y1 - e - a[1]) && t1 - t0 > 1e-9;
    };
    const moves = []; let tmin = 0;
    r.pts.forEach((p, i) => {
      if (i === 0) { moves.push({ X: p[0], Y: p[1], k: 'start', F: outF }); return; }
      const q = r.pts[i - 1], L = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (L < 1e-6) return;
      const cutting = p[2] !== 'air' && inBlock(q, p);
      const F = cutting ? (maxF > 0 ? Math.min(f, maxF) : f) : outF;
      moves.push({ X: p[0], Y: p[1], k: p[2], F, cut: cutting });
      tmin += L / Math.max(1, F);
    });
    const heat = App.heatForSpeed ? App.heatForSpeed(matId(), f) : null;
    return {
      moves, res: r,
      meta: {
        kind: r.kind || 'wing', kh: r.kh || null, fwd: r.fwd,
        name: r.name, chord: r.chord, angle: r.angle, keep: r.keep, clear: r.clear, kerf: r.k, feed: f, outFeed: outF,
        heat, wireS: heat != null && App.wireSFor ? App.wireSFor(heat) : null,
        block: { w: r.block.w, h: r.block.h, d: r.block.d, x: r.block.x0, y: r.block.y0 },
        approach: r.ap, dirCW: r.dirCW, startPicked: r.startPicked, cutLen: r.cutLen, minutes: tmin
      }
    };
  }
  // 3D-Szene (Simulation): Block, Draht gerade (XY = UV).
  function buildScene(mm) {
    mm = mm || machineMoves();
    const mw = state.cfg.machineWidth || 900;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const lim = App.machineLimits ? App.machineLimits() : {};
    if (!mm) return { machineWidth: mw, ax, blocks: [{ seg: 0, x0: 0, x1: 1, y0: 0, y1: 1, x0t: 0, x1t: 1, y0t: 0, y1t: 1, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw }], defaultSeg: 0, limits: lim };
    const b = mm.meta.block, d = Math.min(b.d, mw);
    const z0 = App.effBlockZ ? Math.max(0, Math.min(mw - d, +App.effBlockZ(d) || 0)) : (mw - d) / 2, z1 = z0 + d;
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    return { machineWidth: mw, ax, blocks: [{ seg: 0, x0, x1, y0, y1, x0t: x0, x1t: x1, y0t: y0, y1t: y1, z0, z1, cutZ0: z0, cutZ1: z1 }], defaultSeg: 0, limits: lim };
  }
  // Bahnvorschau ohne G-Code-Erzeugung (pathpreview.js).
  function previewMoves() {
    const mm = machineMoves(); if (!mm) return null;
    const mv = []; let cur = { lx: 0, ly: 0, rx: 0, ry: 0 };
    mm.moves.forEach((m, i) => {
      const to = { lx: m.X, ly: m.Y, rx: m.X, ry: m.Y };
      if (i > 0) mv.push({ from: cur, to, rapid: !m.cut, feed: m.cut ? m.F : 0 });
      cur = to;
    });
    return { moves: mv, label: label() };
  }

  // ======================================================================
  //  Ansicht (Canvas)
  // ======================================================================
  let canvas = null, ctx = null, view = null, bound = false, hover = null;
  // Befehl „Startpunkt wählen": nur solange aktiv, wählt ein Klick auf die Kontur
  // den Startpunkt; danach (oder mit Esc) ist der Befehl wieder beendet.
  let pickMode = false;
  function setPickMode(on) {
    pickMode = !!on; hover = null;
    if (canvas) canvas.style.cursor = '';
    const b = document.getElementById('ausPickStart');
    if (b) { b.textContent = T(pickMode ? '■ Startpunkt wählen: AN' : '▶ Startpunkt wählen'); b.classList.toggle('primary', pickMode); }
    buildSidebar();
    if (state.activeTab === TAB) draw();
  }
  const W2S = (x, y) => [view.ox + x * view.sc, view.oy - y * view.sc];
  const S2W = (px, py) => [(px - view.ox) / view.sc, (view.oy - py) / view.sc];
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function fitCanvas() {
    canvas = document.getElementById('cAusschnitt'); if (!canvas) return false;
    const r = canvas.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return false;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  function fitView() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), res = lastRes;
    const b = res && !res.empty ? [0, 0, res.block.x1, res.block.y1] : [0, 0, 300, 150];
    if (res && !res.empty) res.pts.forEach(p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    const top = 120, bottom = 120, availH = Math.max(40, r.height - top - bottom);
    const sc = Math.min((r.width - 70) / bw, availH / bh);
    view = { sc, ox: (r.width - bw * sc) / 2 - b[0] * sc, oy: top + (availH + bh * sc) / 2 + b[1] * sc };
  }
  function polyPath(P, close) { ctx.moveTo(...W2S(P[0][0], P[0][1])); for (let i = 1; i < P.length; i++) ctx.lineTo(...W2S(P[i][0], P[i][1])); if (close) ctx.closePath(); }
  function arrow(a, b, color, size) {
    const [ax, ay] = W2S(a[0], a[1]), [bx, by] = W2S(b[0], b[1]);
    const L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) return;
    const ux = (bx - ax) / L, uy = (by - ay) / L, s = size || 7;
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx - ux * s - uy * s * 0.55, by - uy * s + ux * s * 0.55); ctx.lineTo(bx - ux * s + uy * s * 0.55, by - uy * s - ux * s * 0.55);
    ctx.closePath(); ctx.fill();
  }
  function draw() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect(), w = r.width, hgt = r.height, res = lastRes;
    if (!view) fitView();
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = col('--panel2', '#1e242c'); ctx.fillRect(0, 0, w, hgt);
    const step = view.sc >= 4 ? 10 : view.sc >= 0.8 ? 50 : view.sc >= 0.2 ? 100 : 500;
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.beginPath();
    const wx0 = -view.ox / view.sc, wx1 = (w - view.ox) / view.sc, wy1 = view.oy / view.sc, wy0 = (view.oy - hgt) / view.sc;
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = W2S(x, 0); ctx.moveTo(px, 0); ctx.lineTo(px, hgt); }
    for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) { const [, py] = W2S(0, y); ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
    if (!res || res.empty) {
      ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText(res && res.msg ? res.msg : T('Kein Profil.'), 20, 140);
      updateInfo(res); return;
    }
    const V = viewCfg(), blk = res.block;
    // Block
    if (V.block !== false) { const [ax, ay] = W2S(blk.x0, blk.y1), [bx, by] = W2S(blk.x1, blk.y0);
      ctx.fillStyle = 'rgba(200,170,110,0.07)'; ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeStyle = '#a08a5a'; ctx.lineWidth = 1.5; ctx.strokeRect(ax, ay, bx - ax, by - ay);
      ctx.fillStyle = '#a08a5a'; ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText(T('Block') + ' ' + blk.w.toFixed(0) + ' × ' + blk.h.toFixed(0) + ' × ' + blk.d.toFixed(0) + ' mm', ax + 4, ay - 5); }
    if (res.kind === 'canopy') { drawCanopy(res, V, w, hgt, step); return; }
    // Anfahrfläche hervorheben
    if (V.block !== false) { const s = res.side, a = s === 'top' ? [blk.x0, blk.y1, blk.x1, blk.y1] : s === 'bottom' ? [blk.x0, blk.y0, blk.x1, blk.y0] : s === 'right' ? [blk.x1, blk.y0, blk.x1, blk.y1] : [blk.x0, blk.y0, blk.x0, blk.y1];
      const [p1x, p1y] = W2S(a[0], a[1]), [p2x, p2y] = W2S(a[2], a[3]);
      ctx.strokeStyle = 'rgba(255,180,84,0.55)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); }
    // Profil
    ctx.beginPath(); polyPath(res.contour, true);
    if (V.fill) { ctx.fillStyle = res.keep === 'block' ? 'rgba(255,255,255,0.05)' : 'rgba(74,163,255,0.22)'; ctx.fill(); }
    ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.4; ctx.stroke();
    // Nase
    if (Math.abs(res.angle) > 1e-6) {   // Drehpunkt Endleiste
      const [tx, ty] = W2S(res.teAct[0], res.teAct[1]); ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.moveTo(tx - 8, ty); ctx.lineTo(tx + 8, ty); ctx.moveTo(tx, ty - 8); ctx.lineTo(tx, ty + 8); ctx.stroke();
      ctx.fillStyle = '#4aa3ff'; ctx.font = '10px Segoe UI, sans-serif'; const tl = T('Drehpunkt Endleiste') + ' ' + res.angle.toFixed(1) + '°'; ctx.fillText(tl, res.noseRight ? tx + 8 : tx - 8 - ctx.measureText(tl).width, ty + 18);
    }
    { const [nx, ny] = W2S(res.noseAct[0], res.noseAct[1]); ctx.fillStyle = '#4aa3ff'; ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText(T('Nase'), nx + (res.noseRight ? 6 : -30), ny - 6); }
    if (V.cut) {
      // Abbrand in wahrer Dicke
      if (App.kerfBand && App.kerfTrueOn && App.kerfTrueOn('ausschnitt') && res.k > 0) {
        const VB = { s: view.sc, X: x => view.ox + x * view.sc, Y: y => view.oy - y * view.sc };
        App.kerfBand(ctx, VB, [res.loop, [res.E, res.Sp]], { view: 'ausschnitt', k: res.k, color: '#ff5a3c' });
      }
      // Luftwege und Anfahrt
      const P = res.pts;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], kd = b[2];
        if (kd === 'cut') continue;
        ctx.beginPath(); ctx.moveTo(...W2S(a[0], a[1])); ctx.lineTo(...W2S(b[0], b[1]));
        if (kd === 'air') { ctx.strokeStyle = '#6b7888'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.1; }
        else { ctx.strokeStyle = '#ffb454'; ctx.setLineDash([]); ctx.lineWidth = 2; }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Umlauf
      ctx.beginPath(); polyPath(res.loop, false); ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 1.4; ctx.stroke();
      if (V.arrows) {
        loopArrows(res);
        // Anfahrt-Pfeil
        const mid = [(res.E[0] + res.Sp[0]) / 2, (res.E[1] + res.Sp[1]) / 2];
        arrow(res.E, mid, '#ffb454', 9);
      }
    }
    // Startpunkt
    { const [sx, sy] = W2S(res.Sp[0], res.Sp[1]);
      ctx.fillStyle = res.startPicked ? '#3ddc84' : '#ffb454'; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#e6ebf1'; ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText(T(res.startPicked ? 'Start (gewählt)' : 'Start (automatisch)'), sx + 8, sy - 8); }
    // Hover: Punkt, der beim Klick Startpunkt wird
    if (hover) {
      const [hx, hy] = W2S(hover.p[0], hover.p[1]);
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
    }
    // Maße: Nullpunkt → Block → Nase (waagrecht unter dem Block), Höhen (senkrecht links bzw. an der Nase).
    if (V.dims !== false) drawDims(res);
    // Nullpunkt
    { const [ox, oy] = W2S(0, 0); ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();
      ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText('X0 Y0', ox + 6, oy + 13); }
    const barH = ((canvas.parentElement && canvas.parentElement.querySelector('.simbar')) || {}).offsetHeight || 44;
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(T('Raster') + ' ' + step + ' mm · ' + T('blau = Profil · rot = Schnittbahn (mit Abbrand) · orange = Anfahrt · grau = Luftweg'), 8, hgt - barH - 8);
    if (pickMode) {
      const msg = T('Wahlmodus AKTIV: einen Punkt der Kontur anklicken — dort beginnt der Schnitt.') + ' ' + T('(Esc = abbrechen)');
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      const tw = ctx.measureText(msg).width, x0 = Math.max(8, (w - tw) / 2 - 10);
      ctx.fillStyle = 'rgba(61,220,132,0.16)'; ctx.fillRect(x0, hgt - barH - 50, tw + 20, 26);
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1; ctx.strokeRect(x0, hgt - barH - 50, tw + 20, 26);
      ctx.fillStyle = '#3ddc84'; ctx.fillText(msg, x0 + 10, hgt - barH - 32);
    }
    updateInfo(res);
  }
  // Pfeile in gleichen Abständen entlang der Schnittbahn (Richtung).
  function loopArrows(res) {
    const L = res.loopLen, nA = Math.max(4, Math.min(14, Math.round(L * view.sc / 90)));
    let acc = 0, next = L / nA * 0.5;
    for (let q = 1; q < res.loop.length; q++) {
      const a = res.loop[q - 1], b = res.loop[q], sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + sl >= next && sl > 0) {
        const t = (next - acc) / sl, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const e = 0.5 / view.sc, u = [(b[0] - a[0]) / sl, (b[1] - a[1]) / sl];
        arrow([p[0] - u[0] * e * 8, p[1] - u[1] * e * 8], [p[0] + u[0] * e * 8, p[1] + u[1] * e * 8], '#ff8a6b', 8);
        next += L / nA;
      }
      acc += sl;
    }
  }
  // Ansicht Kabinenhaubenausschnitt: Haubenlinie, Konstruktionslinien, Griffe, Schnittbahn, Maße.
  function drawCanopy(res, V, w, hgt, step) {
    const blk = res.block, K = res.corners;
    ctx.beginPath(); polyPath(res.contour, false);
    if (V.fill) { ctx.fillStyle = 'rgba(74,163,255,0.16)'; ctx.fill(); }
    // Konstruktion: theoretische Ecken (ohne Radius/Wölbung)
    ctx.beginPath(); polyPath(K, false); ctx.strokeStyle = 'rgba(159,176,196,0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); polyPath(res.contour, false); ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.6; ctx.stroke();
    if (V.cut) {
      if (App.kerfBand && App.kerfTrueOn && App.kerfTrueOn('ausschnitt') && res.k > 0) {
        const VB = { s: view.sc, X: x => view.ox + x * view.sc, Y: y => view.oy - y * view.sc };
        App.kerfBand(ctx, VB, [res.loop], { view: 'ausschnitt', k: res.k, color: '#ff5a3c' });
      }
      const P = res.pts;
      ctx.strokeStyle = '#6b7888'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.1;
      for (let i = 1; i < P.length; i++) { if (P[i][2] !== 'air') continue; ctx.beginPath(); ctx.moveTo(...W2S(P[i - 1][0], P[i - 1][1])); ctx.lineTo(...W2S(P[i][0], P[i][1])); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.beginPath(); polyPath(res.loop, false); ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 1.4; ctx.stroke();
      if (V.arrows) loopArrows(res);
    }
    // Griffe: Ecken, Linienenden und Wölbungspunkte lassen sich mit der Maus ziehen.
    res.handles.forEach(h => {
      const [x, y] = W2S(h.p[0], h.p[1]), sel = res.free && h.id === 'n' + khSel, on = hover && hover.id === h.id || sel, r = on ? 6 : 4.5;
      const endPt = res.free && h.id[0] === 'n' && (+h.id.slice(1) === 0 || +h.id.slice(1) === res.kh.n - 1);
      ctx.fillStyle = h.id[0] === 'm' || h.id[0] === 's' ? '#3ddc84' : h.id[0] === 't' || endPt ? '#ffb454' : '#4aa3ff';
      ctx.strokeStyle = on ? '#ffffff' : '#0b0f14'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
    });
    { const [sx, sy] = W2S(res.Sp[0], res.Sp[1]);
      ctx.fillStyle = '#ffb454'; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#e6ebf1'; ctx.font = '11px Segoe UI, sans-serif'; ctx.fillText(T('Start'), sx + 8, sy - 8); }
    if (V.dims !== false && res.free) {
      // freier Linienzug: Lage des ersten Punkts, Länge zwischen den Endpunkten, größte Tiefe
      const f = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' mm';
      const [, yb] = W2S(0, blk.y0), [, y0] = W2S(0, 0), [, yt] = W2S(0, blk.y1), base = Math.max(yb, y0), r1 = base + 22, r2 = base + 42;
      const [sbx0] = W2S(blk.x0, 0), [sbx1] = W2S(blk.x1, 0), front = res.noseRight ? sbx1 : sbx0;
      const [ax] = W2S(K[0][0], 0), [bx] = W2S(K[K.length - 1][0], 0);
      extLine(ax, yt, ax, r2 + 4); extLine(bx, yt, bx, r2 + 4); extLine(front, yb, front, r1 + 4);
      dimLine(Math.min(front, ax), r1, Math.max(front, ax), r1, f(res.kh.x0));
      dimLine(Math.min(ax, bx), r2, Math.max(ax, bx), r2, f(Math.abs(res.kh.x1 - res.kh.x0)));
      let lo = res.contour[0]; res.contour.forEach(p => { if (p[1] < lo[1]) lo = p; });
      const [lx, ly] = W2S(lo[0], lo[1]), sd = res.noseRight ? 1 : -1, vx = Math.min(ax, bx) - 26;
      extLine(lx + sd * 4, ly, vx - 4, ly); dimLine(vx, ly, vx, yt, f(res.kh.depth), true);
    } else if (V.dims !== false) {
      const f = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' mm';
      const [, yb] = W2S(0, blk.y0), [, y0] = W2S(0, 0), [, yt] = W2S(0, blk.y1), base = Math.max(yb, y0), r1 = base + 22, r2 = base + 42;
      const [sx0] = W2S(0, 0), [sbx0] = W2S(blk.x0, 0), [sbx1] = W2S(blk.x1, 0), [s2x, s2y] = W2S(K[1][0], K[1][1]), [s3x, s3y] = W2S(K[2][0], K[2][1]);
      const front = res.noseRight ? sbx1 : sbx0;
      extLine(s2x, s2y + 6, s2x, r2 + 4); extLine(s3x, s3y + 6, s3x, r2 + 4); extLine(front, yb, front, r1 + 4);
      if (blk.x0 > 0.05) { extLine(sx0, y0, sx0, r1 + 4); extLine(sbx0, yb, sbx0, r1 + 4); dimLine(sx0, r1, sbx0, r1, f(blk.x0)); }
      dimLine(Math.min(front, s2x), r1, Math.max(front, s2x), r1, f(res.kh.x));
      dimLine(Math.min(s2x, s3x), r2, Math.max(s2x, s3x), r2, f(res.kh.len) + (Math.abs(res.kh.slope) > 0.05 ? ' / ' + res.kh.slope.toFixed(1) + '°' : ''));
      const sd = res.noseRight ? 1 : -1, vx = s2x + sd * 26;
      extLine(s2x + sd * 4, s2y, vx + sd * 4, s2y); extLine(s2x, yt, vx + sd * 4, yt);
      dimLine(vx, s2y, vx, yt, f(res.kh.depth), true);
      if (blk.y0 > 0.05) { const bxl = sbx0 - 24; extLine(sbx0, yb, bxl - 4, yb); extLine(sx0, y0, bxl - 4, y0); dimLine(bxl, y0, bxl, yb, f(blk.y0), true); }
    }
    { const [ox, oy] = W2S(0, 0); ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();
      ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText('X0 Y0', ox + 6, oy + 13); }
    const barH = ((canvas.parentElement && canvas.parentElement.querySelector('.simbar')) || {}).offsetHeight || 44;
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(T('Raster') + ' ' + step + ' mm · ' + T('blau = Haubenlinie · rot = Schnittbahn (mit Abbrand) · grau = Luftweg · Vierecke = Griffe zum Ziehen'), 8, hgt - barH - 8);
    updateInfo(res);
  }
  // Griff unter dem Mauszeiger (Kabinenhaube), sonst null.
  function handleAt(px, py) {
    const res = lastRes; if (!res || res.empty || res.kind !== 'canopy' || !view) return null;
    let best = null;
    res.handles.forEach(h => { const [x, y] = W2S(h.p[0], h.p[1]), d = Math.hypot(x - px, y - py); if (d < 10 && (!best || d < best.d)) best = { id: h.id, d }; });
    return best;
  }
  // Griff ziehen: Mausposition (Welt) → Eingabewerte. g = Stand beim Anfassen (Block, lokale Punkte).
  function dragHandle(g, wx, wy) {
    const r1 = v => Math.round(v * 10) / 10, cl = (v, a, b) => Math.max(a, Math.min(b, v)), deg = 180 / Math.PI;
    const fx = g.noseRight ? g.blk.x1 - wx : wx - g.blk.x0;
    if (g.loc.free) {
      // freier Linienzug: lokal = Blockvorderseite oben, y nach oben
      const pts = C('khPts'), i = +g.id.slice(1), s = pts && pts[i]; if (!s) return;
      const lx = fx, ly = wy - g.blk.y1; khSel = i;
      if (g.id[0] === 'n') { s.x = r1(Math.max(0, lx)); if (i > 0 && i < pts.length - 1) s.y = r1(Math.max(0.5, -ly)); return; }
      const a = g.loc.Pn[i], b = g.loc.Pn[i + 1]; if (!a || !b) return;
      const d = sub(b, a), L = Math.hypot(d[0], d[1]) || 1, perp = ((lx - a[0]) * d[1] - (ly - a[1]) * d[0]) / L;
      if (s.t === 'foil') { const hm = g.loc.S[i] && g.loc.S[i].hm; if (Math.abs(hm) > 1e-6) s.fScale = Math.round(perp / hm * 100); }
      else { s.pos = r1(cl(((lx - a[0]) * d[0] + (ly - a[1]) * d[1]) / (L * L), 0.1, 0.9) * 100); s.curv = r1(perp); }
      return;
    }
    if (g.id === 'c2') { S('khX', r1(Math.max(1, fx))); S('khDepth', r1(Math.max(1, g.blk.y1 - wy))); return; }
    const lx = fx - g.kx, ly = wy - (g.blk.y1 - g.dep), L = g.loc;
    if (g.id === 'c3') { S('khLen', r1(Math.max(5, Math.hypot(lx, ly)))); S('khSlope', r1(cl(Math.atan2(ly, Math.max(1e-6, lx)) * deg, -60, 60))); return; }
    if (g.id === 't1') { S('khAngF', r1(cl(Math.atan2(ly, -lx) * deg, 10, 170))); return; }
    if (g.id === 't4') { S('khAngR', r1(cl(Math.atan2(ly - L.P3[1], lx - L.P3[0]) * deg, 10, 170))); return; }
    const ab = g.id === 'mF' ? [L.P1, L.P2] : g.id === 'mB' ? [L.P2, L.P3] : [L.P3, L.P4], sfx = g.id.slice(1);
    const d = sub(ab[1], ab[0]), l = Math.hypot(d[0], d[1]) || 1, rx = lx - ab[0][0], ry = ly - ab[0][1];
    S('khPos' + sfx, r1(cl((rx * d[0] + ry * d[1]) / (l * l), 0.1, 0.9) * 100));
    S('khCurv' + sfx, r1((rx * d[1] - ry * d[0]) / l));
  }
  // Maßkette in Bildschirmkoordinaten: Hilfslinien, Maßlinie mit Pfeilen, Text mittig.
  function dimLine(ax, ay, bx, by, text, vertical) {
    const L = Math.hypot(bx - ax, by - ay); if (L < 2) return;
    ctx.strokeStyle = '#9fb0c4'; ctx.fillStyle = '#9fb0c4'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const ux = (bx - ax) / L, uy = (by - ay) / L, s = Math.min(6, L / 3);
    [[ax, ay, ux, uy], [bx, by, -ux, -uy]].forEach(([x, y, dx, dy]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * s - dy * s * 0.45, y + dy * s + dx * s * 0.45); ctx.lineTo(x + dx * s + dy * s * 0.45, y + dy * s - dx * s * 0.45); ctx.closePath(); ctx.fill();
    });
    ctx.font = '11px Segoe UI, sans-serif';
    const tw = ctx.measureText(text).width, mx = (ax + bx) / 2, my = (ay + by) / 2;
    ctx.save(); ctx.translate(mx, my); if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = col('--panel2', '#1e242c'); ctx.fillRect(-tw / 2 - 3, -14, tw + 6, 13);
    ctx.fillStyle = '#c9d4e0'; ctx.fillText(text, -tw / 2, -4); ctx.restore();
  }
  function extLine(x1, y1, x2, y2) { ctx.strokeStyle = 'rgba(159,176,196,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); }
  function drawDims(res) {
    const blk = res.block, nx = res.noseAct[0], ny = res.noseAct[1], f = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' mm';
    const [, yb] = W2S(0, blk.y0), [, y0] = W2S(0, 0), base = Math.max(yb, y0);
    const [sx0] = W2S(0, 0), [sbx0] = W2S(blk.x0, 0), [sbx1] = W2S(blk.x1, 0), [snx, sny] = W2S(nx, ny);
    const front = res.noseRight ? sbx1 : sbx0;             // Blockvorderseite = Nasenseite
    const r1 = base + 22, r2 = base + 42;
    // Zeile 1: Nullpunkt → Block, Blockvorderseite → Nase
    extLine(snx, sny + 6, snx, r2 + 4);
    extLine(front, yb, front, r1 + 4);
    if (blk.x0 > 0.05) { extLine(sx0, y0, sx0, r2 + 4); extLine(sbx0, yb, sbx0, r1 + 4); dimLine(sx0, r1, sbx0, r1, f(blk.x0)); }
    dimLine(Math.min(front, snx), r1, Math.max(front, snx), r1, f(Math.abs(nx - (res.noseRight ? blk.x1 : blk.x0))));
    // Zeile 2: Nullpunkt → Nase (gesamt)
    dimLine(Math.min(sx0, snx), r2, Math.max(sx0, snx), r2, 'X0 → ' + T('Nase') + ' ' + f(nx));
    // Höhen: Nullpunkt → Blockunterkante (links am Block), Blockunterkante → Nase (an der Nase)
    const side = res.noseRight ? 1 : -1, vx = snx + side * 24;
    extLine(snx + side * 4, sny, vx + side * 4, sny);
    dimLine(vx, yb, vx, sny, f(ny - blk.y0), true);
    if (blk.y0 > 0.05) { const bxl = sbx0 - 24; extLine(sbx0, yb, bxl - 4, yb); extLine(sx0, y0, bxl - 4, y0); dimLine(bxl, y0, bxl, yb, f(blk.y0), true); }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AP_NAMES = { top: 'von oben', bottom: 'von unten', front: 'von vorne (Nasenseite)', rear: 'von hinten (Endleistenseite)' };
  const KH_KEEP = { canopy: 'Haube maßhaltig', fus: 'Rumpf maßhaltig', mid: 'Draht auf der Linie' };
  function updateInfo(res) {
    const el = document.getElementById('ausInfo'); if (!el) return;
    if (!res || res.empty) { el.innerHTML = esc(res && res.msg ? res.msg : T('Kein Profil.')); return; }
    const mm = v => v.toFixed(1);
    if (res.kind === 'canopy') {
      const q = res.kh;
      let hc = '<b>' + T('Kabinenhaubenausschnitt') + '</b><br>'
        + (q.free ? T('Freier Linienzug') + ' · ' + q.n + ' ' + T('Punkte') + ' · ' + T('Länge') + ' ' + mm(Math.abs(q.x1 - q.x0)) + ' mm · ' + T('Tiefe') + ' ' + mm(q.depth) + ' mm<br>' : T('Untere Linie') + ' ' + mm(q.len) + ' mm' + (Math.abs(q.slope) > 0.05 ? ' / ' + q.slope.toFixed(1) + '°' : '') + ' · ' + T('vorne') + ' ' + q.angF.toFixed(1) + '° · ' + T('hinten') + ' ' + q.angR.toFixed(1) + '° · '
        + T('Radien') + ' ' + mm(q.radF) + ' / ' + mm(q.radR) + ' mm<br>')
        + T(res.fwd ? 'Schnitt von vorne nach hinten' : 'Schnitt von hinten nach vorne') + ' · ' + T(KH_KEEP[res.keep]) + '<br>'
        + T('Abbrand') + ' ' + res.k.toFixed(2) + ' mm · ' + T('Vorschub') + ' ' + Math.round(res.feed) + ' mm/min · '
        + T('Schnittlänge') + ' ' + (res.cutLen / 1000).toFixed(2) + ' m (~' + (res.cutLen / Math.max(1, res.feed)).toFixed(1) + ' min)';
      if (res.warns.length) hc += '<div style="color:#ffb454;margin-top:4px">' + res.warns.map(w => '⚠ ' + esc(w)).join('<br>') + '</div>';
      if (res.notes.length) hc += '<div style="color:#8b98a8;margin-top:4px">' + res.notes.map(w => 'ℹ ' + esc(w)).join('<br>') + '</div>';
      el.innerHTML = hc; return;
    }
    let hh = '<b>' + T('Profil') + ':</b> ' + esc(res.name) + '<br>'
      + T('Profiltiefe') + ' ' + mm(res.chord) + ' mm · ' + T('Einstellwinkel') + ' ' + res.angle.toFixed(1) + '° · '
      + T(res.keep === 'block' ? 'Ausschnitt (Block bleibt)' : 'Profilstück bleibt') + (res.clear > 0 ? ' · ' + T('Spiel') + ' ' + res.clear.toFixed(2) + ' mm' : '') + '<br>'
      + T('Anfahrt') + ' ' + T(AP_NAMES[res.ap]) + ' · ' + T(res.dirCW ? 'im Uhrzeigersinn' : 'gegen den Uhrzeigersinn') + ' · '
      + T(res.startPicked ? 'Startpunkt gewählt' : 'Startpunkt automatisch') + '<br>'
      + T('Abbrand') + ' ' + res.k.toFixed(2) + ' mm · ' + T('Vorschub') + ' ' + Math.round(res.feed) + ' mm/min · '
      + T('Schnittlänge') + ' ' + (res.cutLen / 1000).toFixed(2) + ' m (~' + (res.cutLen / Math.max(1, res.feed)).toFixed(1) + ' min)';
    if (res.warns.length) hh += '<div style="color:#ffb454;margin-top:4px">' + res.warns.map(w => '⚠ ' + esc(w)).join('<br>') + '</div>';
    if (res.notes.length) hh += '<div style="color:#8b98a8;margin-top:4px">' + res.notes.map(w => 'ℹ ' + esc(w)).join('<br>') + '</div>';
    el.innerHTML = hh;
  }
  // Klick: nächster Punkt der Profilkontur (innerhalb 14 px) → Bogenlängen-Anteil.
  function pickAt(px, py) {
    const res = lastRes; if (!res || res.empty || !view) return null;
    const [x, y] = S2W(px, py), nb = nearestOnPoly(res.contour, x, y);
    if (!nb || nb.d * view.sc > 14) return null;
    const s0 = res.sN[nb.i], s1 = nb.i + 1 < res.sN.length ? res.sN[nb.i + 1] : 1;
    return { p: nb.p, s: s0 + (s1 - s0) * nb.t };
  }
  // Doppelklick auf die freie Haubenlinie: Punkt dort einfügen (der neue Abschnitt dahinter wird gerade).
  function khInsertAt(px, py) {
    const res = lastRes; if (!res || res.empty || !res.free || !view) return false;
    const pts = C('khPts'), [wx, wy] = S2W(px, py), blk = res.block;
    const lx = res.noseRight ? blk.x1 - wx : wx - blk.x0, ly = wy - blk.y1;
    let best = null;
    res.loc.S.forEach((c, i) => { const nb = nearestOpen(c.pts, lx, ly); if (nb && nb.d * view.sc < 8 && (!best || nb.d < best.d)) best = { i, d: nb.d, p: nb.p }; });
    if (!best) return false;
    const r1 = v => Math.round(v * 10) / 10;
    pts.splice(best.i + 1, 0, { x: r1(best.p[0]), y: r1(Math.max(0.5, -best.p[1])), r: 0, t: 'line', curv: 0, pos: 50 }); khSel = best.i + 1;
    return true;
  }
  function bindCanvas() {
    if (bound) return; canvas = document.getElementById('cAusschnitt'); if (!canvas) return;
    bound = true;
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); if (!view) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      view.ox = mx - (mx - view.ox) * f; view.oy = my - (my - view.oy) * f; view.sc *= f; draw();
    }, { passive: false });
    let drag = null;
    canvas.addEventListener('mousedown', e => { if (e.button !== 0 && e.button !== 1 || !view) return; drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false, btn: e.button };
      if (e.button === 0 && !pickMode) {
        const r = canvas.getBoundingClientRect(), h = handleAt(e.clientX - r.left, e.clientY - r.top), res = lastRes;
        if (h) { drag.grip = { id: h.id, blk: Object.assign({}, res.block), noseRight: res.noseRight, kx: res.loc.kx, dep: res.loc.dep, loc: res.loc }; if (res.free) khSel = +h.id.slice(1); }
      } });
    window.addEventListener('mousemove', e => {
      if (drag && drag.grip) {
        const r = canvas.getBoundingClientRect(), p = S2W(e.clientX - r.left, e.clientY - r.top);
        drag.moved = true; canvas.style.cursor = 'move'; dragHandle(drag.grip, p[0], p[1]); build(); draw();
        return;
      }
      if (drag) {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) { drag.moved = true; canvas.style.cursor = 'grabbing'; hover = null; }
        if (drag.moved) { view.ox = drag.ox + e.clientX - drag.x; view.oy = drag.oy + e.clientY - drag.y; draw(); }
        return;
      }
      if (!pickMode && isCanopy()) {
        const r = canvas.getBoundingClientRect(), h = e.target === canvas ? handleAt(e.clientX - r.left, e.clientY - r.top) : null;
        if ((h && h.id) !== (hover && hover.id)) { hover = h; canvas.style.cursor = h ? 'move' : ''; if (state.activeTab === TAB) draw(); }
        return;
      }
      if (!pickMode) return;
      if (e.target !== canvas) { if (hover) { hover = null; draw(); } return; }
      const r = canvas.getBoundingClientRect(), h = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (!!h !== !!hover || (h && hover && (h.p[0] !== hover.p[0] || h.p[1] !== hover.p[1]))) { hover = h; canvas.style.cursor = h ? 'crosshair' : ''; draw(); }
    });
    window.addEventListener('mouseup', e => {
      if (!drag) return;
      const d = drag; drag = null; canvas.style.cursor = '';
      if (d.grip) { upd(true); return; }
      if (d.moved || d.btn !== 0 || !pickMode) return;
      const r = canvas.getBoundingClientRect(), h = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (h) { S('waStart', +h.s.toFixed(6)); pickMode = false; setPickMode(false); upd(false); }
    });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && pickMode && state.activeTab === TAB) setPickMode(false); });
    canvas.addEventListener('dblclick', e => {
      const r = canvas.getBoundingClientRect();
      if (isCanopy() && isFree() && khInsertAt(e.clientX - r.left, e.clientY - r.top)) { upd(true); return; }
      fitView(); draw();
    });
    // Rechtsklick auf einen Punkt des freien Linienzugs löscht ihn (mindestens zwei bleiben).
    canvas.addEventListener('contextmenu', e => {
      if (!isCanopy() || !isFree()) return;
      const r = canvas.getBoundingClientRect(), h = handleAt(e.clientX - r.left, e.clientY - r.top);
      if (!h || h.id[0] !== 'n') return;
      e.preventDefault();
      const pts = C('khPts'); if (pts.length <= 2) return;
      const i = +h.id.slice(1); pts.splice(i, 1); khSel = Math.max(0, i - 1); hover = null; upd(true);
    });
    const tg = (id, key) => { const b = document.getElementById(id); if (!b) return; b.checked = (key === 'dims' || key === 'block') ? viewCfg()[key] !== false : !!viewCfg()[key]; b.onchange = () => { viewCfg()[key] = b.checked; draw(); }; };
    tg('ausShowBlock', 'block'); tg('ausShowFill', 'fill'); tg('ausShowCut', 'cut'); tg('ausShowArrows', 'arrows'); tg('ausShowDims', 'dims');
    { const kt = document.getElementById('ausShowKerfTrue');
      if (kt && App.kerfTrueOn) { kt.checked = App.kerfTrueOn('ausschnitt'); kt.onchange = () => App.kerfTrueSet('ausschnitt', kt.checked); } }
    const fb = document.getElementById('ausFit'); if (fb) fb.onclick = () => { fitView(); draw(); };
    const pk = document.getElementById('ausPickStart'); if (pk) pk.onclick = () => setPickMode(!pickMode);
    const au = document.getElementById('ausAutoStart'); if (au) au.onclick = () => { S('waStart', null); if (pickMode) setPickMode(false); upd(true); };
    const rv = document.getElementById('ausReverse'); if (rv) rv.onclick = () => { if (isCanopy()) S('khDir', C('khDir') === 'rev' ? 'fwd' : 'rev'); else S('waDir', C('waDir') === 'ccw' ? 'cw' : 'ccw'); upd(true); };
    syncBar();
  }
  // Startpunkt-Befehle gibt es nur beim Profil-Ausschnitt.
  function syncBar() {
    ['ausPickStart', 'ausAutoStart'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = isCanopy() ? 'none' : ''; });
  }

  // ---------- Aktualisieren -------------------------------------------------
  let upTimer = null, genTimer = null;
  function upd(rebuildSide, delay) {
    if (rebuildSide) buildSidebar();
    if (upTimer) clearTimeout(upTimer);
    upTimer = setTimeout(() => {
      upTimer = null;
      if (state.activeTab === TAB) { build(); draw(); }
      if (state.cfg.gcodeSource === TAB) { if (genTimer) clearTimeout(genTimer); genTimer = setTimeout(() => { genTimer = null; App.render(); }, 120); }
    }, delay || 60);
  }
  function show() { bindCanvas(); syncBar(); if (!fitCanvas()) return; const had = lastRes && !lastRes.empty; build(); if (!had || !view) fitView(); draw(); }
  function resize() { if (state.activeTab !== TAB) return; if (fitCanvas()) draw(); }
  function refresh() { if (state.activeTab !== TAB) return; build(); draw(); }

  // ---------- Eigenes Profil ---------------------------------------------------
  function setOwn(prof, name) {
    const n = (window.Airfoil && Airfoil.normalize) ? Airfoil.normalize(prof) : prof;
    S('waProf', { name: name || prof.name || T('Eigenes Profil'), pts: n.map(p => [+p.x.toFixed(6), +p.y.toFixed(6)]) });
    S('waSrc', 'own'); S('waStart', null);
    upd(true);
  }
  async function loadDat() {
    try {
      let f = null;
      if (App.pickTextFile && App.FS_SUPPORTED) f = await App.pickTextFile({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, 'ldDat');
      else f = await new Promise(res => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.dat,.bez,.txt,.cor';
        i.onchange = async () => { const x = i.files[0]; res(x ? { name: x.name, text: await x.text() } : null); };
        i.click();
      });
      if (!f) return;
      const prof = Airfoil.parseDat(f.text);
      if (window.FoilDB) window.FoilDB.add(prof, { file: f.name });
      setOwn(prof, (prof.name && !/^Profil$/i.test(prof.name)) ? prof.name : f.name.replace(/\.[^.]+$/, ''));
    } catch (e) { if (e && e.name !== 'AbortError') App.toast && App.toast(T('Profil nicht lesbar.')); }
  }

  // ======================================================================
  //  Seitenleiste
  // ======================================================================
  function ausschnittSidebar(side) {
    const nr = (body, label, k, opt) => numRow(body, label, () => num(k, DEF[k]), v => { S(k, v); upd(opt && opt.side); }, Object.assign({ norender: true }, opt || {}));
    const sel = (body, label, k, opts, h, sideRebuild) => selectRow(body, label, opts, () => C(k), v => { S(k, v); upd(sideRebuild); }, h);
    const res = lastRes && !lastRes.empty ? lastRes : null;
    const kindRow = body => selectRow(body, 'Art des Ausschnitts', [['wing', 'Tragflächenausschnitt (Profil)'], ['canopy', 'Kabinenhaubenausschnitt']], () => (isCanopy() ? 'canopy' : 'wing'),
      v => { S('waKind', v); pickMode = false; hover = null; lastRes = null; view = null; syncBar(); upd(true); },
      'Tragflächenausschnitt: ein Profil als Loch oder Profilstück. Kabinenhaubenausschnitt: offener Schnitt aus vorderer, unterer („waagrechter") und hinterer Linie mit Übergangsradien.');
    if (isCanopy()) { canopySidebar(side, nr, sel, res, kindRow); return; }

    // --- Profil -------------------------------------------------------------
    const g1 = grp('Tragflächenausschnitt: Profil', true, TAB, { key: 'wa_prof' });
    kindRow(g1.body);
    sel(g1.body, 'Profil', 'waSrc', [['root', 'Wurzelprofil der Tragfläche'], ['own', 'eigenes Profil'], ['rect', 'Rechteck (z. B. Plattenleitwerk)']],
      'Wurzelprofil: Profil und Profiltiefe der Wurzelrippe aus dem Tragflächendesigner (ändert sich mit). Eigenes Profil: .dat-Datei oder Profildatenbank, Profiltiefe frei. Rechteck: Länge, Dicke und Eckenradius frei, z. B. für ein Plattenleitwerk.', true);
    const isRect = C('waSrc') === 'rect';
    if (isRect) {
      const rs = (label, k, opt) => numRow(g1.body, label, () => num(k, DEF[k]), v => { S(k, v); S('waStart', null); upd(true); }, Object.assign({ norender: true }, opt));
      rs('Länge (mm)', 'waRectL', { step: 1, min: 1, hint: 'Länge des Rechtecks in Flugrichtung (Tiefe der Platte).' });
      rs('Dicke (mm)', 'waRectT', { step: 0.5, min: 0.1, hint: 'Dicke der Platte. Die Passung stellt das „Spiel" unter „Block & Lage" ein.' });
      rs('Eckenradius (mm)', 'waRectR', { step: 0.5, min: 0, hint: '0 = scharfe Ecken; höchstens die halbe Dicke.' });
    } else if (C('waSrc') === 'own') {
      const p = C('waProf');
      hint(g1.body, p ? T('Geladen: ') + p.name : 'Noch kein Profil geladen.');
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
      const b = document.createElement('button'); b.textContent = T('📂 Profil laden (.dat)…'); b.title = T('Profildatei im Selig- oder Lednicer-Format laden'); b.onclick = loadDat; bar.appendChild(b);
      if (C('waSrc') === 'own' && wingRec().root && wingRec().root.profile) {
        const r = document.createElement('button'); r.textContent = T('Wurzelprofil übernehmen'); r.title = T('Das Wurzelprofil der aktiven Tragfläche als eigenes Profil kopieren (danach unabhängig davon)');
        r.onclick = () => { const w = wingRec().root; S('waChord', +(+w.chord || 200).toFixed(1)); setOwn(w.profile, w.profile.name || T('Wurzelprofil')); };
        bar.appendChild(r);
      }
      g1.body.appendChild(bar);
      if (window.FoilDB && window.FoilDB.fillSelect) {
        const row = document.createElement('div'); row.className = 'row full';
        const s = document.createElement('select'); s.style.width = '100%';
        window.FoilDB.fillSelect(s, {});
        s.onchange = () => { const pr = window.FoilDB.profile(s.value); if (pr) setOwn(pr, pr.name); };
        row.appendChild(s); g1.body.appendChild(row);
      }
      nr(g1.body, 'Profiltiefe (mm)', 'waChord', { step: 1, min: 1 });
    } else {
      const L = wings();
      if (L.length > 1) {
        const opts = L.map((w, i) => [w.id, wingLabel(i)]);
        selectRow(g1.body, 'Tragfläche', opts, () => (C('waWing') && L.some(w => w.id === C('waWing'))) ? C('waWing') : (L[state.activeWing] || L[0]).id,
          v => { S('waWing', v); S('waStart', null); upd(true); });
      }
      const w = wingRec().root;
      hint(g1.body, T('Wurzelprofil: ') + ((w && w.profile && w.profile.name) || '—') + ' · ' + T('Profiltiefe ') + ((w && +w.chord) || 0).toFixed(1) + ' mm');
      nr(g1.body, 'Maßstab (%)', 'waScale', { step: 1, min: 1, hint: '100 % = Profiltiefe der Wurzelrippe.' });
    }
    nr(g1.body, 'Einstellwinkel (°)', 'waAngle', { step: 0.5, hint: 'Drehung um die Endleiste (sie bleibt stehen): positiv = Nase hoch.' });
    sel(g1.body, 'Nase zeigt nach', 'waNose', [['left', 'links'], ['right', 'rechts']], 'Ansicht von vorne auf die Maschine. „Vorne" bei der Anfahrt ist immer die Nasenseite.');
    if (!isRect) sel(g1.body, 'Profil spiegeln', 'waFlip', [['no', 'nein'], ['yes', 'ja (Oberseite unten)']], 'Spiegelt das Profil an der Sehne: die Oberseite liegt unten. Nase und Endleiste bleiben an ihrem Platz, der Einstellwinkel zählt weiter positiv = Nase hoch.');
    if (!isRect) nr(g1.body, 'Punkte der Kontur', 'waPts', { step: 10, min: 40, max: 1000, int: true });
    side.appendChild(g1.g);

    // --- Block & Lage ---------------------------------------------------------
    const g2 = grp('Tragflächenausschnitt: Block & Lage', false, TAB, { key: 'wa_block' });
    sel(g2.body, 'Was bleibt stehen', 'waKeep', [['block', 'Block (Ausschnitt = Loch)'], ['profile', 'Profilstück']],
      'Bestimmt die Seite des Abbrands: beim Ausschnitt läuft der Draht um den halben Abbrand innerhalb der Kontur (das Loch wird genau so groß wie das Profil plus Spiel), beim Profilstück außerhalb.', true);
    if (C('waKeep') !== 'profile') nr(g2.body, 'Spiel (mm)', 'waClear', { step: 0.1, min: 0, hint: 'Ausschnitt ringsum um diesen Betrag größer als das Profil (Passung, Beplankung, Kleber).' });
    if (App.matOptions) {
      const mo = [['', '— kein Werkstoff —']].concat(App.matOptions());
      selectRow(g2.body, 'Werkstoff', mo, () => (C('waMatId') != null ? C('waMatId') : (state.material.id || '')), v => { S('waMatId', v); upd(true); },
        'Werkstoff des Blocks (Abbrand, Heizung, Vorschub automatisch).');
    }
    sel(g2.body, 'Abbrand', 'waKerfMode', [['mat', 'aus Werkstoff-Kalibrierung'], ['manual', 'manuell'], ['off', 'aus (0)']], null, true);
    if (C('waKerfMode') === 'manual') nr(g2.body, 'Abbrand (Schnittspalt, mm)', 'waKerf', { step: 0.05, min: 0 });
    else hint(g2.body, T('Abbrand aktuell: ') + kerf().toFixed(2) + ' mm');
    nr(g2.body, 'Blockbreite fest (mm, 0 = auto)', 'waBlockW', { step: 5, min: 0 });
    nr(g2.body, 'Blockhöhe fest (mm, 0 = auto)', 'waBlockH', { step: 5, min: 0 });
    if (!(num('waBlockW', 0) > 0 && num('waBlockH', 0) > 0)) nr(g2.body, 'Rand um das Profil (mm, bei auto)', 'waMargin', { step: 1, min: 0 });
    nr(g2.body, 'Blockdicke entlang des Drahts (mm)', 'waDepth', { step: 5, min: 1 });
    sel(g2.body, 'Lage des Profils', 'waPosMode', [['center', 'mittig im Block'], ['manual', 'Abstand angeben']], null, true);
    if (C('waPosMode') === 'manual') {
      nr(g2.body, 'Nase ↔ Blockvorderseite (mm)', 'waPosX', { step: 1, hint: 'Vorderseite = Blockseite auf der Nasenseite. Beide Werte gelten für das ungedrehte Profil (Einstellwinkel 0°); beim Drehen bleibt die Endleiste stehen, die Nase wandert. Die Maße in der Ansicht zeigen die gedrehte Nase.' });
      nr(g2.body, 'Nasenhöhe über Blockunterkante (mm)', 'waPosY', { step: 1 });
    }
    hint(g2.body, 'Blocklage (Abstand X/Y vom Nullpunkt, Lage zwischen den Portalen) und Vorschub stellt der Reiter „G-Code" ein.');
    side.appendChild(g2.g);

    // --- Anfahrt, Startpunkt & Richtung ------------------------------------------
    const g3 = grp('Tragflächenausschnitt: Anfahrt, Startpunkt & Richtung', true, TAB, { key: 'wa_path' });
    sel(g3.body, 'Anfahrt', 'waApproach', [['top', 'von oben'], ['bottom', 'von unten'], ['front', 'von vorne (Nasenseite)'], ['rear', 'von hinten (Endleistenseite)']],
      'Blockfläche, durch die der Draht einfährt: senkrecht zur Fläche bis auf Höhe bzw. Lage des Startpunkts, dann zum Startpunkt; nach dem Umlauf auf demselben Weg hinaus.');
    nr(g3.body, 'Anfahrt-Abstand zur Blockfläche (mm)', 'waApproachDist', { step: 1, min: 0, hint: 'Bis zu diesem Punkt vor der Blockfläche fährt der Draht in Luft.' });
    { const ws = C('waStart');
      hint(g3.body, ws != null
        ? T('Startpunkt gewählt (bei ') + (ws * 100).toFixed(1) + T(' % der Konturlänge, ab Endleiste über die Oberseite).')
        : 'Startpunkt automatisch: der Anfahrfläche nächstgelegener Punkt der Kontur.');
      hint(g3.body, 'Befehl „Startpunkt wählen": danach einen Punkt der Profilkontur anklicken (grüner Kreis zeigt ihn). Der Befehl endet mit dem Klick oder mit Esc.');
      if (pickMode) App.warn ? App.warn(g3.body, T('Wahlmodus AKTIV: einen Punkt der Kontur anklicken — dort beginnt der Schnitt.')) : null;
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
      const p = document.createElement('button'); p.textContent = T(pickMode ? '■ Startpunkt wählen: AN' : '▶ Startpunkt wählen'); if (pickMode) p.className = 'primary';
      p.onclick = () => { if (state.activeTab !== TAB && App.switchView) App.switchView(TAB); setPickMode(!pickMode); }; bar.appendChild(p);
      const a = document.createElement('button'); a.textContent = T('Startpunkt automatisch'); a.disabled = ws == null; a.onclick = () => { S('waStart', null); if (pickMode) setPickMode(false); upd(true); }; bar.appendChild(a);
      g3.body.appendChild(bar); }
    sel(g3.body, 'Schnittrichtung', 'waDir', [['cw', 'im Uhrzeigersinn ↻'], ['ccw', 'gegen den Uhrzeigersinn ↺']],
      'Umlaufrichtung um das Profil, wie in der Ansicht (von vorne) gesehen. Die Pfeile auf der Schnittbahn zeigen sie an.');
    if (res && res.warns.length) res.warns.forEach(w => App.warn ? App.warn(g3.body, w) : hint(g3.body, w));
    if (document.getElementById('gcodeView')) {
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('⚙ G-Code'); b.title = T('Zum Reiter „G-Code" wechseln, Quelle „Ausschnitte"');
      b.onclick = () => { const t = document.getElementById('ausToGcode'); if (t) t.click(); }; bar.appendChild(b);
      g3.body.appendChild(bar);
    }
    side.appendChild(g3.g);
  }

  function canopySidebar(side, nr, sel, res, kindRow) {
    // --- Form ---------------------------------------------------------------
    const g1 = grp('Kabinenhaubenausschnitt: Form', true, TAB, { key: 'kh_form' });
    kindRow(g1.body);
    hint(g1.body, 'Seitenansicht des Rumpfblocks. Der Draht fährt die vordere Linie hinunter, die untere („waagrechte") Linie entlang und die hintere Linie wieder hinauf. Ecken, Linienenden und Wölbungspunkte lassen sich in der Ansicht auch mit der Maus ziehen.');
    sel(g1.body, 'Nase zeigt nach', 'waNose', [['left', 'links'], ['right', 'rechts']], 'Seite des Blocks, auf der die Rumpfnase (vordere Linie) liegt.');
    selectRow(g1.body, 'Art der Schnittlinie', [['std', 'drei Linien (vorne, unten, hinten)'], ['free', 'freier Linienzug (Geraden, Splines, Profil)']], () => isFree() ? 'free' : 'std',
      v => { if (v === 'free' && !(Array.isArray(C('khPts')) && C('khPts').length >= 2)) khToFree(lastRes && !lastRes.empty && !lastRes.free ? lastRes : null); S('khMode', v); khSel = 0; hover = null; upd(true); },
      'Freier Linienzug: beliebig viele Punkte, je Abschnitt gerade, Spline oder Seite eines Tragflächenprofils — wie die Haubenlinie im Rumpf-Pro. Beim ersten Umschalten werden die drei Linien übernommen.');
    if (isFree()) {
      canopyFreeSidebar(g1.body);
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
      const b = document.createElement('button'); b.textContent = T('Aus den drei Linien neu anlegen');
      b.title = T('Verwirft den freien Linienzug und übernimmt wieder die drei Linien (vorne, unten, hinten) als Ausgangsform.');
      b.onclick = () => { S('khMode', 'std'); let q = null; try { q = buildCanopy(); } catch (e) {} khToFree(q && !q.empty ? q : null); S('khMode', 'free'); khSel = 0; upd(true); };
      bar.appendChild(b); g1.body.appendChild(bar);
      side.appendChild(g1.g);
    } else {
    nr(g1.body, 'Vordere Ecke ↔ Blockvorderseite (mm)', 'khX', { step: 1, min: 1, hint: 'Lage der vorderen unteren Ecke (Schnittpunkt von vorderer und unterer Linie, ohne Radius).' });
    nr(g1.body, 'Tiefe unter Blockoberkante (mm)', 'khDepth', { step: 1, min: 1, hint: 'So tief liegt die vordere untere Ecke unter der Blockoberseite.' });
    nr(g1.body, 'Untere Linie: Länge (mm)', 'khLen', { step: 1, min: 5 });
    nr(g1.body, 'Untere Linie: Neigung (°)', 'khSlope', { step: 0.5, min: -60, max: 60, hint: '0° = waagrecht, positiv = hinten höher.' });
    nr(g1.body, 'Vordere Linie: Winkel (°)', 'khAngF', { step: 1, min: 10, max: 170, hint: 'Winkel zur Waagrechten: 90° = senkrecht, kleiner = oben nach vorne geneigt, größer = oben nach hinten geneigt. Die Linie läuft bis zur Blockoberfläche.' });
    nr(g1.body, 'Hintere Linie: Winkel (°)', 'khAngR', { step: 1, min: 10, max: 170, hint: 'Winkel zur Waagrechten: 90° = senkrecht, kleiner = oben nach hinten geneigt, größer = oben nach vorne geneigt.' });
    nr(g1.body, 'Radius vorne (mm)', 'khRadF', { step: 1, min: 0, hint: 'Übergangsradius zwischen vorderer und unterer Linie (0 = scharfe Ecke). Gilt auch zwischen gekrümmten Linien.' });
    nr(g1.body, 'Radius hinten (mm)', 'khRadR', { step: 1, min: 0 });
    side.appendChild(g1.g);

    // --- Linienform ------------------------------------------------------------
    const g2 = grp('Kabinenhaubenausschnitt: Linienform', false, TAB, { key: 'kh_lines' });
    hint(g2.body, 'Jede Linie ist gerade oder ein gekrümmter Spline durch einen Wölbungspunkt. Wölbung positiv = in den Rumpf hinein (Ausschnitt wird größer), negativ = in die Haube hinein.');
    [['F', 'Vordere Linie'], ['B', 'Untere Linie'], ['R', 'Hintere Linie']].forEach(([x, name]) => {
      sel(g2.body, name, 'khType' + x, [['line', 'gerade'], ['spline', 'gekrümmt (Spline)']], null, true);
      if (C('khType' + x) === 'spline') {
        nr(g2.body, 'Wölbung (mm)', 'khCurv' + x, { step: 0.5 });
        nr(g2.body, 'Lage der Wölbung (%)', 'khPos' + x, { step: 5, min: 10, max: 90, hint: 'Stelle der größten Wölbung entlang der Linie, in Schnittrichtung vorne → hinten gezählt.' });
      }
    });
    side.appendChild(g2.g);
    }

    // --- Block & Schnitt ---------------------------------------------------------
    const g3 = grp('Kabinenhaubenausschnitt: Block & Schnitt', true, TAB, { key: 'kh_block' });
    sel(g3.body, 'Maßhaltig bleibt', 'khKeep', [['canopy', 'die Haube (Abbrand im Rumpf)'], ['fus', 'der Rumpf (Abbrand in der Haube)'], ['mid', 'keines (Draht auf der Linie)']],
      'Der Draht läuft um den halben Abbrand neben der Haubenlinie, damit das gewählte Teil genau die gezeichnete Form bekommt.');
    if (App.matOptions) {
      const mo = [['', '— kein Werkstoff —']].concat(App.matOptions());
      selectRow(g3.body, 'Werkstoff', mo, () => (C('waMatId') != null ? C('waMatId') : (state.material.id || '')), v => { S('waMatId', v); upd(true); },
        'Werkstoff des Blocks (Abbrand, Heizung, Vorschub automatisch).');
    }
    sel(g3.body, 'Abbrand', 'waKerfMode', [['mat', 'aus Werkstoff-Kalibrierung'], ['manual', 'manuell'], ['off', 'aus (0)']], null, true);
    if (C('waKerfMode') === 'manual') nr(g3.body, 'Abbrand (Schnittspalt, mm)', 'waKerf', { step: 0.05, min: 0 });
    else hint(g3.body, T('Abbrand aktuell: ') + kerf().toFixed(2) + ' mm');
    nr(g3.body, 'Blockbreite fest (mm, 0 = auto)', 'waBlockW', { step: 5, min: 0 });
    nr(g3.body, 'Blockhöhe fest (mm, 0 = auto)', 'waBlockH', { step: 5, min: 0 });
    if (!(num('waBlockW', 0) > 0 && num('waBlockH', 0) > 0)) nr(g3.body, 'Rand hinter/unter der Haube (mm, bei auto)', 'waMargin', { step: 1, min: 0 });
    nr(g3.body, 'Blockdicke entlang des Drahts (mm)', 'waDepth', { step: 5, min: 1 });
    nr(g3.body, 'Überlauf vor/nach dem Block (mm)', 'waApproachDist', { step: 1, min: 0, hint: 'So weit vor der Blockfläche beginnt und endet der Schnitt in Verlängerung der Linien.' });
    sel(g3.body, 'Schnittrichtung', 'khDir', [['fwd', 'von vorne nach hinten'], ['rev', 'von hinten nach vorne']]);
    hint(g3.body, 'Blocklage (Abstand X/Y vom Nullpunkt, Lage zwischen den Portalen) und Vorschub stellt der Reiter „G-Code" ein.');
    if (res && res.warns.length) res.warns.forEach(w => App.warn ? App.warn(g3.body, w) : hint(g3.body, w));
    if (document.getElementById('gcodeView')) {
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('⚙ G-Code'); b.title = T('Zum Reiter „G-Code" wechseln, Quelle „Ausschnitte"');
      b.onclick = () => { const t = document.getElementById('ausToGcode'); if (t) t.click(); }; bar.appendChild(b);
      g3.body.appendChild(bar);
    }
    side.appendChild(g3.g);
  }

  // Seitenleiste des freien Linienzugs: Punkttabelle + Einstellungen des gewählten Abschnitts.
  function canopyFreeSidebar(body) {
    const pts = C('khPts'), n = pts.length, res = lastRes && !lastRes.empty && lastRes.free ? lastRes : null;
    const Pn = res && res.loc.Pn.length === n ? res.loc.Pn : null, r1 = v => Math.round(v * 10) / 10;
    khSel = Math.max(0, Math.min(n - 1, khSel));
    const ch = () => upd(true);
    hint(body, 'Die Schnittlinie läuft von der Blockoberkante über beliebig viele Punkte zurück zur Oberkante (erster und letzter Punkt liegen immer auf der Oberkante). X = Abstand zur Blockvorderseite (Nasenseite), Tiefe = unter der Blockoberkante. Jeder Abschnitt bis zum nächsten Punkt ist eine Gerade, ein gewölbter Spline oder eine Seite eines Tragflächenprofils; R = Übergangsradius an der Ecke. In der Ansicht: Griffe ziehen, Doppelklick auf die Linie setzt einen Punkt, Rechtsklick auf einen Punkt löscht ihn.');
    const cell = (val, set, dis) => {
      const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal'; i.value = val; i.disabled = !!dis;
      i.style.cssText = 'width:100%;min-width:26px;padding:1px 2px;font-size:10px';
      i.onchange = () => { const v = parseFloat(String(i.value).replace(',', '.')); if (isFinite(v)) set(v); };
      return i;
    };
    const tb = document.createElement('table'); tb.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;margin:4px 0';
    const th = document.createElement('tr');
    th.innerHTML = '<th style="width:16px">#</th><th>X</th><th title="' + T('Tiefe unter der Blockoberkante (mm)') + '">' + T('Tiefe') + '</th><th title="' + T('Übergangsradius an diesem Punkt (mm)') + '">R</th><th style="width:36%" title="' + T('Form der Linie von diesem Punkt bis zum nächsten') + '">' + T('Abschnitt') + '</th>';
    tb.appendChild(th);
    pts.forEach((s, i) => {
      const tr = document.createElement('tr'), end = i === 0 || i === n - 1; if (i === khSel) tr.style.background = 'rgba(255,210,122,.18)';
      const td = el => { const c = document.createElement('td'); if (el) c.appendChild(el); tr.appendChild(c); return c; };
      const t0 = td(); t0.textContent = i + 1; t0.style.cursor = 'pointer'; t0.onclick = () => { khSel = i; ch(); };
      td(cell(r1(+s.x || 0), v => { s.x = Math.max(0, v); khSel = i; ch(); }));
      td(cell(end ? 0 : r1(+s.y || 0), v => { s.y = Math.max(0.5, v); khSel = i; ch(); }, end));
      if (end) td(); else td(cell(r1(+s.r || 0), v => { s.r = Math.max(0, v); khSel = i; ch(); }));
      if (i < n - 1) {
        const se = document.createElement('select'); se.style.cssText = 'width:100%;font-size:10px;padding:0';
        for (const [val, name] of [['line', 'gerade'], ['spline', 'Spline'], ['foil', 'Profil']]) { const o = document.createElement('option'); o.value = val; o.textContent = T(name); se.appendChild(o); }
        se.value = s.t === 'spline' || s.t === 'foil' ? s.t : 'line';
        se.onchange = () => {
          s.t = se.value; khSel = i;
          if (s.t === 'spline' && !(+s.curv)) { s.curv = 10; s.pos = s.pos || 50; }
          if (s.t === 'foil') { if (!s.fSrc) s.fSrc = 'naca'; if (!s.fThk) s.fThk = 12; if (!s.fSide) s.fSide = 'up'; if (!s.fNose) s.fNose = 'a'; if (s.fScale == null) s.fScale = 100; }
          ch();
        };
        td(se);
      } else td();
      tb.appendChild(tr);
    });
    body.appendChild(tb);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
    const add = document.createElement('button'); add.textContent = T('+ Punkt'); add.title = T('Fügt hinter dem gewählten Punkt einen neuen ein (Mitte des Abschnitts).');
    add.onclick = () => {
      const i = Math.min(khSel, n - 2), a = Pn ? Pn[i] : [+pts[i].x || 0, -(+pts[i].y || 0)], b = Pn ? Pn[i + 1] : [+pts[i + 1].x || 0, -(+pts[i + 1].y || 0)];
      pts.splice(i + 1, 0, { x: r1((a[0] + b[0]) / 2), y: r1(Math.max(0.5, -(a[1] + b[1]) / 2)), r: 0, t: 'line', curv: 0, pos: 50 }); khSel = i + 1; ch();
    };
    const del = document.createElement('button'); del.textContent = T('Punkt löschen'); del.disabled = n <= 2;
    del.onclick = () => { if (pts.length > 2) { pts.splice(khSel, 1); khSel = Math.max(0, khSel - 1); ch(); } };
    bar.appendChild(add); bar.appendChild(del); body.appendChild(bar);
    const s = pts[khSel];
    if (khSel < n - 1 && (s.t === 'spline' || s.t === 'foil')) {
      hint(body, T('Abschnitt') + ' ' + (khSel + 1) + ' → ' + (khSel + 2));
      const nr = (label, key, o) => numRow(body, label, () => s[key], v => { s[key] = v; upd(false); }, Object.assign({ step: 1, norender: true }, o || {}));
      if (s.t === 'spline') { nr('Wölbung (mm)', 'curv', { step: 0.5 }); nr('Lage der Wölbung (%)', 'pos', { step: 5, min: 10, max: 90 }); }
      else {
        selectRow(body, 'Profil', [['naca', 'NACA 00xx (symmetrisch)'], ['wing', 'aus Tragflächendesign (Wurzelrippe)'], ['dat', 'aus Datei (.dat)']], () => s.fSrc || 'naca', v => { s.fSrc = v; ch(); });
        if (s.fSrc === 'dat') {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center;margin:2px 0 4px';
          const b = document.createElement('button'); b.textContent = T('Profil laden…'); b.onclick = () => loadDatProf(p => { s.fProf = p; ch(); });
          const nm = document.createElement('span'); nm.style.cssText = 'font-size:10px;opacity:.8;flex:1'; nm.textContent = s.fProf && s.fProf.name ? s.fProf.name : T('(kein Profil geladen)');
          row.appendChild(b); row.appendChild(nm); body.appendChild(row);
        } else if (s.fSrc !== 'wing') nr('Dicke (%)', 'fThk', { min: 1, max: 40, int: true });
        if (s.fSrc === 'dat' || s.fSrc === 'wing') selectRow(body, 'Profilseite', [['up', 'Oberseite'], ['lo', 'Unterseite']], () => s.fSide || 'up', v => { s.fSide = v; ch(); });
        selectRow(body, 'Profilnase', [['a', 'am Anfang des Abschnitts'], ['b', 'am Ende des Abschnitts']], () => s.fNose || 'a', v => { s.fNose = v; ch(); });
        nr('Höhe der Profilseite (%)', 'fScale', { step: 10, hint: '100 = maßstäblich zur Sehne (Strecke zwischen den beiden Punkten). Größer = bauchiger; positiv = in den Rumpf hinein (Ausschnitt wird größer), negativ = in die Haube hinein. Auch mit dem grünen Griff an der dicksten Stelle ziehbar.' });
      }
    }
  }
  // Profil (.dat) für einen Abschnitt des freien Linienzugs laden: cb({ name, pts:[[x,y],…] }).
  async function loadDatProf(cb) {
    try {
      let f = null;
      if (App.pickTextFile && App.FS_SUPPORTED) f = await App.pickTextFile({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, 'ldDat');
      else f = await new Promise(res => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.dat,.bez,.txt,.cor';
        i.onchange = async () => { const x = i.files[0]; res(x ? { name: x.name, text: await x.text() } : null); };
        i.click();
      });
      if (!f) return;
      const prof = Airfoil.parseDat(f.text);
      if (window.FoilDB) window.FoilDB.add(prof, { file: f.name });
      const n = Airfoil.normalize ? Airfoil.normalize(prof) : prof;
      cb({ name: (prof.name && !/^Profil$/i.test(prof.name)) ? prof.name : f.name.replace(/\.[^.]+$/, ''), pts: n.map(p => [+p.x.toFixed(6), +p.y.toFixed(6)]) });
    } catch (e) { if (e && e.name !== 'AbortError') App.toast && App.toast(T('Profil nicht lesbar.')); }
  }

  // Neues Projekt / Projekt laden: Projektwerte des Reiters auf Anfang.
  function reset() {
    Object.keys(DEF).forEach(k => { delete state.cfg[k]; });
    lastRes = null; view = null; hover = null; pickMode = false;
    setTimeout(() => { if (state.activeTab === TAB) show(); }, 0);
  }
  function label() { if (isCanopy()) return T('Kabinenhaubenausschnitt'); const r = lastRes && !lastRes.empty ? lastRes : build(); return T('Tragflächenausschnitt') + (r && !r.empty ? ' · ' + r.name : ''); }
  function fileBase() {
    if (isCanopy()) return 'kabinenhaube';
    const r = lastRes && !lastRes.empty ? lastRes : build();
    return ('ausschnitt_' + (r && !r.empty ? r.name : '')).replace(/[^\wäöüÄÖÜß\-]+/g, '_').replace(/_+$/g, '').slice(0, 50) || 'ausschnitt';
  }

  Object.assign(App, { ausschnittSidebar, buildAusschnittScene: () => buildScene() });
  window.Ausschnitt = {
    show, resize, refresh, build, draw, machineMoves, buildScene, previewMoves, reset, label, fileBase,
    _test: { offsetClosed, deloop, offsetOpen, khFillet, khCurve, khFoil, khFreeLine, khToFree, area, kerf, feed, C, S }
  };
})();

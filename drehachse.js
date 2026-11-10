/* drehachse.js — Reiter „Drehachse" (optionales Feature `drehachse`, Tab `rot`): Schneiden mit Drehtisch
 *
 * Maschine wie in allen anderen Modulen (4 Achsen, waagerechter Draht zwischen den Portalen).
 * Zusätzlich steht der Block auf einem Drehtisch mit SENKRECHTER Achse (grblHAL A/B/C).
 * Verfahren wie bei devFoam 3D („classic STL cutting via rotary table"):
 *   je Tischwinkel θ schneidet der Draht (beide Portale gleich) die Silhouette des Teils in
 *   Blickrichtung des Drahts; danach fährt er hoch, der Tisch dreht weiter, nächster Schnitt.
 *   Ergebnis = Schnittmenge aller Silhouetten-Prismen → ohne Hinterschneidungen/Hohlräume.
 * Rechnung in waagerechten Schichten (Abstand dy): je Schicht die konvexe Hülle des Teilquerschnitts
 * (Tischkoordinaten u, w). Silhouette bei θ = [min, max] von s = u·cosθ + w·sinθ je Schicht.
 * Restkörper je Schicht = Rohling-Rechteck ∩ Streifen aller Schnitte (konvex, Halbebenen-Clipping).
 * Winkel: gleichmäßig, Liste oder automatisch (gierig: jeweils der Winkel mit dem größten Materialabtrag).
 * Teil: Datei (Model3D.parseFile: STL/OBJ/STEP/IGES), aus Reiter 3D-Modell oder Testkörper; im Projekt
 * als Float32-Base64 in cfg.rot.mesh64. Hauptansicht: eigene 3D-Simulation; Schnitte im Klappfenster.
 * Andere Module rufen nur geschützt (window.Drehachse).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const DEG = Math.PI / 180, TAU = 2 * Math.PI;
  const f3 = v => (Math.round(v * 1000) / 1000).toFixed(3), f1 = v => (Math.round(v * 10) / 10).toFixed(1), f0 = v => String(Math.round(v));
  const isOpen = () => state.activeTab === 'rot';
  // Drehteller = Maschineneigenschaft (Reiter Maschine → Drehteller): vorhanden, Achse, Tischmitte X, Oberkante Y
  const tbl = () => ({ on: !!state.cfg.tblOn, axis: String(state.cfg.tblAxis || 'B').toUpperCase(), x: +state.cfg.tblX || 0, y: +state.cfg.tblY || 0 });

  function cfg() {
    let c = state.cfg.rot;
    if (!c || typeof c !== 'object' || c.mode) c = state.cfg.rot = {};   // Altstand (Längsdraht/Drehen) verwerfen
    const d = { invert: false, feed: 0, kerfOn: true,
      src: 'test', test: 'haube', meshName: '', mesh64: null, zUp: true, scale: 100, rotZ: 0, du: 0, dw: 0, base: 10,
      stock: 'auto', margin: 8, stW: 200, stD: 200, stH: 120,
      prof: [[0, 40], [10, 40], [18, 26], [70, 16], [82, 30], [95, 14], [120, 0]], profN: 0, profSnap: 5, tol: 0.05,
      angMode: 'auto', nCuts: 12, range: 180, angList: '0, 45, 90, 135', dy: 2, lead: 15, safe: 25, ghost: false };
    for (const k in d) if (c[k] === undefined) c[k] = d[k];
    return c;
  }
  const kerf = () => (cfg().kerfOn && App.currentKerf ? +App.currentKerf() || 0 : 0);
  const feed = () => +cfg().feed > 0 ? +cfg().feed : (+state.cfg.feed || 300);

  // ---------- Netz ----------
  const b64 = { enc(f) { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
    dec(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); } };
  // Testkörper (Y oben, mm)
  function revolve(prof, n, off) {   // prof: [[y, r], …] von unten nach oben
    const V = [];
    for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < n; i++) {
      const a0 = TAU * i / n + (off || 0), a1 = TAU * (i + 1) / n + (off || 0), [y0, r0] = prof[j], [y1, r1] = prof[j + 1];
      const p = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
      V.push(...p(r0, a0, y0), ...p(r1, a0, y1), ...p(r1, a1, y1), ...p(r0, a0, y0), ...p(r1, a1, y1), ...p(r0, a1, y0));
    }
    return new Float32Array(V);
  }
  function ellipsoidHalf(a, b, h, n) {   // Haube: halbes Ellipsoid, Grundfläche 2a × 2b
    const V = [], m = 16, P = (t, f) => { const c = Math.cos(t); return [a * c * Math.cos(f), h * Math.sin(t), b * c * Math.sin(f)]; };
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const t0 = Math.PI / 2 * j / m, t1 = Math.PI / 2 * (j + 1) / m, q0 = TAU * i / n, q1 = TAU * (i + 1) / n;
      V.push(...P(t0, q0), ...P(t1, q0), ...P(t1, q1), ...P(t0, q0), ...P(t1, q1), ...P(t0, q1));
    }
    return new Float32Array(V);
  }
  const TESTS = {
    haube: ['Kabinenhaube (Halbellipsoid 160 × 70 × 55)', () => ellipsoidHalf(80, 35, 55, 48)],
    figur: ['Drehkörper (Figur)', () => revolve([[0, 30], [8, 30], [12, 18], [60, 12], [70, 22], [78, 12], [95, 20], [110, 0]], 40)],
    pyr: ['Pyramide 120 × 120 × 90', () => { const a = 60, h = 90, B = [[-a, 0, -a], [a, 0, -a], [a, 0, a], [-a, 0, a]], top = [0, h, 0], V = []; for (let i = 0; i < 4; i++) V.push(...B[i], ...B[(i + 1) % 4], ...top); return new Float32Array(V); }]
  };
  // Quelle „Kontur drehen“: Kontur [[y, r] …] um die Hochachse; n Drehschritte (0 = rund, sonst n-Kant)
  function profMesh(c) {
    const pr = (c.prof || []).map(q => [+q[0] || 0, Math.max(0, +q[1] || 0)]); if (pr.length < 2) return null;
    if (pr[0][1] > 0) pr.unshift([pr[0][0], 0]);
    if (pr[pr.length - 1][1] > 0) pr.push([pr[pr.length - 1][0], 0]);
    const n = Math.round(+c.profN || 0) >= 3 ? Math.round(+c.profN) : 72;
    return revolve(pr, n, Math.PI / n);   // halber Schritt versetzt: Flächen (nicht Kanten) bei 0°, 360/n …
  }
  let raw = null, rawKey = '';
  function rawMesh() {
    const c = cfg(), key = c.src + '|' + c.test + '|' + (c.src === 'prof' ? JSON.stringify(c.prof) + c.profN : '') + '|' + (c.mesh64 ? c.mesh64.length + c.mesh64.slice(-16) : 0);
    if (raw && key === rawKey) return raw;
    rawKey = key; raw = null;
    try {
      if (c.src === 'prof') { const v = profMesh(c); raw = v ? { v, yUp: true } : null; }
      else if (c.src === 'test') raw = { v: (TESTS[c.test] || TESTS.haube)[1](), yUp: true };
      else if (c.mesh64) raw = { v: b64.dec(c.mesh64), yUp: false };
    } catch (e) { console.error(e); }
    return raw;
  }
  // Teil auf dem Tisch: Tischkoordinaten (u = Maschinen-X ab Tischachse bei θ = 0, w = quer, y = Maschinenhöhe)
  function placed() {
    const c = cfg(), R = rawMesh(); if (!R) return null;
    const up = c.up || (c.zUp === false ? 'y' : 'z'), v = R.v, n = v.length / 3, s = (+c.scale || 100) / 100, a = (+c.rotZ || 0) * DEG, ca = Math.cos(a), sa = Math.sin(a);
    const P = new Float32Array(v.length);
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      let x = v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
      if (!R.yUp) {   // Hochachse der Datei → Maschinen-Y (oben)
        const t = y;
        switch (up) {
          case 'z': y = z; z = -t; break;
          case '-z': y = -z; z = t; break;
          case 'x': y = x; x = -t; break;
          case '-x': y = -x; x = t; break;
          case '-y': y = -y; z = -z; break;
        }
      }
      x *= s; y *= s; z *= s;
      const u = x * ca - z * sa, w = x * sa + z * ca;
      P[3 * i] = u; P[3 * i + 1] = y; P[3 * i + 2] = w;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < w0) w0 = w; if (w > w1) w1 = w; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const cu = (u0 + u1) / 2 - (+c.du || 0), cw = (w0 + w1) / 2 - (+c.dw || 0), yb = tbl().y + Math.max(0, +c.base || 0) - y0;
    for (let i = 0; i < n; i++) { P[3 * i] -= cu; P[3 * i + 1] += yb; P[3 * i + 2] -= cw; }
    return { P, ntri: n / 3, bb: { u0: u0 - cu, u1: u1 - cu, w0: w0 - cw, w1: w1 - cw, y0: y0 + yb, y1: y1 + yb } };
  }

  // ---------- Schichten + Hüllen ----------
  function hull(pts) {
    if (pts.length < 3) return pts.slice();
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function slices(M) {
    const c = cfg(), dy = Math.max(0.5, +c.dy || 2), P = M.P, yA = M.bb.y0, yB = M.bb.y1, K = Math.max(2, Math.ceil((yB - yA) / dy) + 1), S = [];
    for (let k = 0; k < K; k++) S.push({ y: Math.min(yB - 1e-3, yA + k * dy + (k ? 0 : 1e-3)), pts: [] });
    for (let t = 0; t < M.ntri; t++) {
      const i = 9 * t, A = [P[i], P[i + 1], P[i + 2]], B = [P[i + 3], P[i + 4], P[i + 5]], C = [P[i + 6], P[i + 7], P[i + 8]];
      const lo = Math.min(A[1], B[1], C[1]), hi = Math.max(A[1], B[1], C[1]);
      const k0 = Math.max(0, Math.floor((lo - yA) / dy)), k1 = Math.min(K - 1, Math.ceil((hi - yA) / dy));
      for (let k = k0; k <= k1; k++) {
        const y = S[k].y; if (y < lo - 1e-9 || y > hi + 1e-9) continue;
        [[A, B], [B, C], [C, A]].forEach(([p, q]) => {
          if ((p[1] - y) * (q[1] - y) > 0) return;
          const d = q[1] - p[1];
          if (Math.abs(d) < 1e-9) { S[k].pts.push([p[0], p[2]], [q[0], q[2]]); return; }
          const f = (y - p[1]) / d; S[k].pts.push([p[0] + (q[0] - p[0]) * f, p[2] + (q[2] - p[2]) * f]);
        });
      }
    }
    S.forEach(s => { s.h = hull(s.pts); delete s.pts; });
    for (let k = 0; k < K; k++) if (!S[k].h.length) { const n = S[k - 1] && S[k - 1].h.length ? S[k - 1] : S[k + 1]; if (n) S[k].h = n.h; }
    return S;
  }
  const proj = (h, th) => { const ca = Math.cos(th * DEG), sa = Math.sin(th * DEG); let a = Infinity, b = -Infinity; h.forEach(p => { const s = p[0] * ca + p[1] * sa; if (s < a) a = s; if (s > b) b = s; }); return [a, b]; };
  function clip(poly, nx, ny, cc) {   // behalte nx·u + ny·w ≤ cc
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = nx * p[0] + ny * p[1] - cc, dq = nx * q[0] + ny * q[1] - cc;
      if (dp <= 0) out.push(p);
      if (dp * dq < 0) { const f = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
    }
    return out;
  }
  const area = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
  function cutPoly(poly, h, th, k2) {
    if (!h.length || poly.length < 3) return poly.length < 3 ? [] : poly;
    const ca = Math.cos(th * DEG), sa = Math.sin(th * DEG), [a, b] = proj(h, th);
    return clip(clip(poly, ca, sa, b + k2), -ca, -sa, -(a - k2));
  }
  function stockRect(M) {
    const c = cfg();
    if (c.stock === 'manual') { const W = (+c.stW || 100) / 2, D = (+c.stD || 100) / 2; return { r: [[-W, -D], [W, -D], [W, D], [-W, D]], top: tbl().y + (+c.stH || 100) }; }
    const m = Math.max(0, +c.margin || 0), b = M.bb;
    return { r: [[b.u0 - m, b.w0 - m], [b.u1 + m, b.w0 - m], [b.u1 + m, b.w1 + m], [b.u0 - m, b.w1 + m]], top: b.y1 + m };
  }

  // ---------- Winkel ----------
  function angles(S, st) {
    const c = cfg(), k2 = kerf() / 2;
    if (c.angMode === 'list') return String(c.angList || '').split(/[;,\s]+/).filter(s => s !== '').map(Number).filter(isFinite);
    const n = Math.max(1, Math.round(+c.nCuts || 1)), rg = Math.max(1, +c.range || 180);
    if (c.angMode === 'step') return Array.from({ length: n }, (_, i) => rg * i / n);
    // automatisch: gierig den Winkel mit dem größten Materialabtrag wählen (Kandidaten alle 3°)
    let polys = S.map(() => st.r.slice()); const chosen = [];
    for (let it = 0; it < n; it++) {
      let best = null, bestA = Infinity;
      for (let th = 0; th < 180; th += 3) {
        if (chosen.some(a => { const d = Math.abs(a - th) % 180; return Math.min(d, 180 - d) < 1.5; })) continue;
        let A = 0; for (let k = 0; k < S.length; k++) A += area(cutPoly(polys[k], S[k].h, th, k2));
        if (A < bestA - 1e-6) { bestA = A; best = th; }
      }
      // kein nennenswerter Abtrag mehr (< 0,05 % der Rohlingsfläche) → fertig
      const cur = polys.reduce((s, p) => s + area(p), 0);
      if (best == null || (chosen.length && cur - bestA < 5e-4 * area(st.r) * S.length)) break;
      chosen.push(best); polys = polys.map((p, k) => cutPoly(p, S[k].h, best, k2));
    }
    return chosen.sort((a, b) => a - b);
  }

  // Stützpunkte ausdünnen: Douglas-Peucker mit Toleranz (mm); Endpunkte bleiben
  function simplify(P, tol) {
    if (!(tol > 0) || P.length < 3) return P;
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
      const [i, j] = st.pop(), a = P[i], b = P[j], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      let md = -1, mk = -1;
      for (let k = i + 1; k < j; k++) {
        const d = L < 1e-9 ? Math.hypot(P[k][0] - a[0], P[k][1] - a[1]) : Math.abs(dx * (P[k][1] - a[1]) - dy * (P[k][0] - a[0])) / L;
        if (d > md) { md = d; mk = k; }
      }
      if (md > tol) { keep[mk] = 1; st.push([i, mk], [mk, j]); }
    }
    return P.filter((_, k) => keep[k]);
  }
  // ---------- Bahnen ----------
  function plan() {
    const c = cfg(), M = placed(); if (!M || !M.ntri) return { err: T('Kein Teil geladen.') };
    const S = slices(M), st = stockRect(M), k2 = kerf() / 2, th = angles(S, st);
    if (!th.length) return { err: T('Keine Schnittwinkel angegeben.') };
    const Rc = Math.max(...st.r.map(p => Math.hypot(p[0], p[1]))) + Math.max(2, +c.lead || 0);
    const yBot = M.bb.y0, safeY = Math.max(st.top, M.bb.y1) + Math.max(5, +c.safe || 0), X0 = tbl().x;
    const cuts = th.map(a => {
      const iv = S.map(s => proj(s.h, a)), path = [[X0 - Rc, yBot]];
      for (let k = 0; k < S.length; k++) path.push([X0 + iv[k][0] - k2, S[k].y]);
      const top = M.bb.y1 + k2, kt = S.length - 1;
      path.push([X0 + iv[kt][0] - k2, top], [X0 + iv[kt][1] + k2, top]);
      for (let k = kt; k >= 0; k--) path.push([X0 + iv[k][1] + k2, S[k].y]);
      path.push([X0 + Rc, yBot]);
      const raw = path.length;
      return { a, path: simplify(path, Math.max(0, +c.tol || 0)), raw };
    });
    // Restkörper nach jedem Schnitt (für Simulation und Kennwerte)
    let polys = S.map(() => st.r.slice()); const after = [polys];
    cuts.forEach(ct => { polys = polys.map((p, k) => cutPoly(p, S[k].h, ct.a, k2)); after.push(polys); });
    const dyk = k => (k + 1 < S.length ? S[k + 1].y - S[k].y : 0);
    const vEnd = polys.reduce((s, p, k) => s + area(p) * dyk(k), 0), vHull = S.reduce((s, q, k) => s + area(q.h) * dyk(k), 0);
    return { M, S, st, cuts, after, Rc, yBot, safeY, X0, vEnd, vHull, k2 };
  }

  // Bewegungsliste: { x, y, b, rapid, dt (min), cut }
  function moves(Pl) {
    const c = cfg(), F = feed(), Fr = Math.max(F, +state.cfg.outsideFeed || F * 3), sg = c.invert ? -1 : 1, L = [];
    let cur = { x: Pl.X0 - Pl.Rc, y: Pl.safeY, b: 0, cut: null };
    const go = (x, y, b, rapid) => {
      const d = Math.hypot(x - cur.x, y - cur.y), db = Math.abs(b - cur.b);
      const dt = rapid ? Math.max(d / Fr, db / 3600) : d / F;   // Tisch ≈ 10 U/min angenommen
      cur = { x, y, b, cut: cur.cut }; L.push({ x, y, b, rapid, dt, cut: cur.cut });
    };
    L.push({ x: cur.x, y: cur.y, b: 0, rapid: true, dt: 0, cut: null });
    Pl.cuts.forEach((ct, i) => {
      const b = sg * ct.a, p0 = ct.path[0];
      cur.cut = i;
      go(cur.x, Pl.safeY, cur.b, true); go(cur.x, Pl.safeY, b, true); go(p0[0], Pl.safeY, b, true); go(p0[0], p0[1], b, true);
      ct.path.slice(1).forEach(p => go(p[0], p[1], b, false));
      cur.cut = i + 0.5;   // Schnitt i fertig
      go(cur.x, Pl.safeY, b, true);
    });
    return L;
  }

  // ---------- G-Code ----------
  function gcode() {
    const c = cfg(), Pl = plan(); if (Pl.err) return { err: Pl.err, text: '' };
    const ax = { x: state.cfg.axX || 'X', y: state.cfg.axY || 'Y', u: state.cfg.axU || 'Z', v: state.cfg.axV || 'A' }, B = tbl().axis;
    const L = moves(Pl), o = [], em = s => o.push(s), tot = L.reduce((s, m) => s + m.dt, 0);
    const XY = (x, y) => ax.x + f3(x) + ' ' + ax.y + f3(y) + ' ' + ax.u + f3(x) + ' ' + ax.v + f3(y);
    // Eigener Auftragskopf (sonst setzt der gemeinsame Nachlauf jobHeader „Teil: Tragfläche … Seite“ davor)
    const partName = c.src === 'test' ? T((TESTS[c.test] || TESTS.haube)[0]) : (c.src === 'prof' ? T('Drehkörper (Kontur)') : (c.meshName || T('Modell')));
    em('; ==== ' + T('Auftrag') + ' ====');
    em('; ' + T('Projekt') + ': ' + ((state.projectName || '').trim() || '—'));
    em('; ' + T('Teil') + ': ' + T('Drehtisch') + ' · ' + partName);
    em('; ' + T('Maschine') + ': ' + (App.machineName || '—') + ' · ' + T('Drehteller') + ' ' + B + ' (' + T('Tischmitte X') + ' ' + f1(Pl.X0) + ' mm)');
    em(';');
    em('; ==== AI Foam Cut — ' + T('Drehtisch-Schnitt') + ' (' + T('Achse') + ' ' + B + ') ====');
    em('; ' + T('Teil:') + ' ' + (c.src === 'test' ? T((TESTS[c.test] || TESTS.haube)[0]) : (c.src === 'prof' ? T('Drehkörper (Kontur)') : (c.meshName || ''))) + ' · ' + Pl.cuts.length + ' ' + T('Schnitte') + ': ' + Pl.cuts.map(q => f1(q.a)).join(', ') + '°');
    em('; ' + T('Tischachse bei X') + ' ' + f1(Pl.X0) + ' · ' + T('Tisch-Oberkante Y') + ' ' + f1(tbl().y) + ' · ' + T('Abbrand') + ' ' + f3(kerf()) + ' · F ' + feed());
    em('; ' + T('Schnittdauer ca.') + ' ' + f1(tot) + ' min');
    if (state.projectName) em('; ' + T('Projekt:') + ' ' + state.projectName);
    em('G21'); em('G90');
    let lastCut = null;
    L.forEach((m, i) => {
      if (!i) {
        em('G0 ' + ax.y + f3(m.y) + ' ' + ax.v + f3(m.y)); em('G0 ' + XY(m.x, m.y) + ' ' + B + f3(m.b));
        if (App.currentHeat) { const s = App.currentWireS ? App.currentWireS() : App.currentHeat(); em('M3 S' + s + ' ; ' + T('Drahtheizung EIN')); em('G4 P2'); }
        return;
      }
      if (m.cut != null && m.cut % 1 === 0 && m.cut !== lastCut) { lastCut = m.cut; em('; --- ' + T('Schnitt') + ' ' + (m.cut + 1) + ' / ' + Pl.cuts.length + ' · ' + T('Tisch') + ' ' + f1(Pl.cuts[m.cut].a) + '°'); }
      const prev = L[i - 1];
      if (Math.hypot(m.x - prev.x, m.y - prev.y) < 1e-4 && Math.abs(m.b - prev.b) < 1e-6) return;   // keine Bewegung
      if (m.rapid) em('G0 ' + XY(m.x, m.y) + (Math.abs(m.b - prev.b) > 1e-6 ? ' ' + B + f3(m.b) : ''));
      else em('G1 ' + XY(m.x, m.y) + ' F' + feed());
    });
    em('M5 ; ' + T('Drahtheizung AUS')); em('M2');
    return { text: o.join('\n'), Pl, L, tot };
  }

  // ---------- 3D-Simulation ----------
  const sim = { t: 0, play: false, speed: 10, yaw: -0.85, pitch: 0.45, zoom: 1, px: 0, py: 0, last: 0, cube: null, sel: 0 };
  let G = null, cum = null;
  function update() {
    try { G = gcode(); } catch (e) { console.error(e); G = { err: e.message }; }
    cum = null;
    const info = document.getElementById('rotInfo');
    if (G.err) { if (info) info.innerHTML = '<span class="bad">' + G.err + '</span>'; draw3d(); drawSec(); syncBar(); return; }
    const cm = [0]; G.L.forEach((m, i) => { if (i) cm.push(cm[i - 1] + m.dt); }); cum = cm; sim.t = Math.min(sim.t, G.tot); loadSim();
    const P = G.Pl, extra = P.vHull > 0 ? (P.vEnd / P.vHull - 1) * 100 : 0;
    if (info) info.innerHTML = '<b>' + P.cuts.length + ' ' + T('Schnitte') + ' · ' + T('Schnittdauer ca.') + ' ' + f1(G.tot) + ' min</b> · ' + T('Winkel') + ' ' + P.cuts.map(q => f0(q.a) + '°').join(', ')
      + ' · ' + T('Restmaterial über der Idealform') + ' ' + f1(extra) + ' %';
    sim.sel = Math.min(sim.sel, Math.max(0, P.cuts.length - 1));
    draw3d(); drawSec(); syncBar();
  }
  function stateAt(t) {
    const L = G.L; let lo = 0, hi = cum.length - 1;
    const doneTo = i => { let d = 0; for (let j = 0; j <= i; j++) if (L[j].cut != null && L[j].cut % 1) d = Math.floor(L[j].cut) + 1; return d; };
    if (t <= 0) return Object.assign({ done: 0 }, L[0]);
    if (t >= cum[hi]) return Object.assign({ done: G.Pl.cuts.length }, L[hi]);
    while (hi - lo > 1) { const md = (lo + hi) >> 1; if (cum[md] <= t) lo = md; else hi = md; }
    const a = L[lo], b = L[hi], f = (t - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, b: a.b + (b.b - a.b) * f, done: doneTo(lo), cutting: !b.rapid, cut: b.cut };
  }
  const ROT = (v, yaw, pitch) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy; return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp]; };

  // ---------- Simulation in der gemeinsamen Maschine (sim3d.js) ----------
  const useSim = () => !!(window.Sim3D && Sim3D.mountRot);
  function loadSim() {
    if (!useSim() || !G || G.err) return;
    const c = cfg(), P = G.Pl, F = feed(), list = [];
    for (let i = 1; i < G.L.length; i++) {
      const a = G.L[i - 1], b = G.L[i];
      list.push({ from: { lx: a.x, ly: a.y, rx: a.x, ry: a.y }, to: { lx: b.x, ly: b.y, rx: b.x, ry: b.y }, rapid: b.rapid, feed: F, dur: b.dt * 60 });
    }
    Sim3D.loadRot(list, {
      machineWidth: +state.cfg.machineWidth || 900, ax: { x: state.cfg.axX || 'X', y: state.cfg.axY || 'Y', u: state.cfg.axU || 'Z', v: state.cfg.axV || 'A' },
      blocks: [], defaultSeg: 0, limits: App.machineLimits ? App.machineLimits() : null,
      extraBounds: [{ x0: P.X0 - P.Rc, x1: P.X0 + P.Rc, y0: tbl().y - 20, y1: P.safeY }],
      drawExtra: drawExtra
    });
  }
  // Drehteller + Werkstück (Restkörper) + Zielteil mit der Projektion des Simulators
  function drawExtra(api, at) {
    if (!G || G.err) return;
    const tMin = G.L.length > 1 ? (at.i ? cum[at.i] : 0) + (cum[at.i + 1] - cum[at.i]) * at.u : 0;
    drawTable(api, stateAt(isFinite(tMin) ? tMin : sim.t), G.Pl);
  }
  // Drehteller + Werkstück für den Zustand S { b (Grad), done (fertige Schnitte), cut, cutting } zeichnen
  function drawTable(api, S, P) {
    const c = cfg(), W = +state.cfg.machineWidth || 900, zc = W / 2, th = (c.invert ? -1 : 1) * S.b * DEG;
    const ca = Math.cos(th), sa = Math.sin(th);
    const wp = (u, y, w) => ({ x: P.X0 + u * ca + w * sa, y, z: zc - u * sa + w * ca });
    const g = api.ctx, polys = [], ghost = [];
    const Lw = (v => { const l = Math.hypot(...v); return v.map(x => x / l); })([-0.35, 0.85, -0.4]);
    // Fläche aufnehmen: Normale (optional nach außen bezogen auf ctr), Rückseiten weglassen, weich schattieren
    const add = (V, rgb, al, o) => {
      o = o || {};
      const Q = V.map(api.scr); if (Q.some(q => q.d < api.NEAR)) return;
      const A = [V[1].x - V[0].x, V[1].y - V[0].y, V[1].z - V[0].z], B = [V[2].x - V[0].x, V[2].y - V[0].y, V[2].z - V[0].z];
      let n = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
      const nl = Math.hypot(...n); if (nl < 1e-12) return; n = n.map(x => x / nl);
      const m = V.reduce((s2, v) => ({ x: s2.x + v.x / V.length, y: s2.y + v.y / V.length, z: s2.z + v.z / V.length }), { x: 0, y: 0, z: 0 });
      if (o.ctr && n[0] * (m.x - o.ctr.x) + n[1] * (m.y - o.ctr.y) + n[2] * (m.z - o.ctr.z) < 0) n = n.map(x => -x);
      if (o.ghost) { const q0 = api.scr(m), q1 = api.scr({ x: m.x + n[0], y: m.y + n[1], z: m.z + n[2] }); if (q1.d < q0.d) return; }   // Zielteil: nur Vorderseiten
      const dl = n[0] * Lw[0] + n[1] * Lw[1] + n[2] * Lw[2], k = 0.38 + 0.52 * Math.max(0, dl) + 0.1 * Math.max(0, n[1]);
      const sh = rgb.map(v => Math.min(255, Math.round(v * (o.flat ? 1 : k))));
      (o.ghost ? ghost : polys).push({ Q, d: Q.reduce((s2, q) => s2 + q.d, 0) / Q.length, rgb: sh, col: 'rgba(' + sh.join(',') + ',' + al + ')' });
    };
    const tr = P.Rc * 0.92;
    // Drehteller: liegt immer unter allem → zuerst und unsortiert zeichnen (eine große Fläche würde sonst
    // in der Tiefensortierung den halben Körper überdecken)
    const diskW = Array.from({ length: 64 }, (_, i) => { const a = TAU * i / 64; return wp(tr * Math.cos(a), tbl().y, tr * Math.sin(a)); });
    add(diskW, [54, 58, 66], 1, { flat: true });
    const PL = P.after[Math.min(S.done, P.after.length - 1)], Sl = P.S, fin = S.done >= P.cuts.length, FOAM = fin ? [125, 185, 240] : [228, 231, 236];
    const ctrOf = poly => poly.reduce((s2, p) => [s2[0] + p[0] / poly.length, s2[1] + p[1] / poly.length], [0, 0]);
    // Quader/Prisma (Sockel, oberer Rohlingsrest)
    const prism = (poly, y0, y1, rgb) => {
      if (poly.length < 3) return; const cc = ctrOf(poly), ctr = wp(cc[0], (y0 + y1) / 2, cc[1]);
      for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; add([wp(p[0], y0, p[1]), wp(q[0], y0, q[1]), wp(q[0], y1, q[1]), wp(p[0], y1, p[1])], rgb, 1, { ctr }); }
      add(poly.map(p => wp(p[0], y1, p[1])), rgb, 1, { ctr });
    };
    prism(P.st.r, tbl().y, P.yBot, [228, 231, 236]);
    // Restkörper als glatte Hülle: jede Schicht (konvex) auf NS Strahlen vom Schwerpunkt abtasten, Ringe verbinden
    const NS = 72;
    const ring = poly => {
      const cc = ctrOf(poly), R = [];
      for (let j = 0; j < NS; j++) {
        const a = TAU * j / NS, dx = Math.cos(a), dy = Math.sin(a); let best = 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i], q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const px = p[0] - cc[0], py = p[1] - cc[1], t = (px * ey - py * ex) / den, u = (px * dy - py * dx) / den;
          if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
        }
        R.push([cc[0] + dx * best, cc[1] + dy * best]);
      }
      return { cc, R };
    };
    const rings = [];
    for (let k = 0; k < Sl.length; k++) if (PL[k] && PL[k].length >= 3) rings.push(Object.assign(ring(PL[k]), { y: Sl[k].y }));
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1], ctr = wp((A.cc[0] + B.cc[0]) / 2, (A.y + B.y) / 2, (A.cc[1] + B.cc[1]) / 2);
      for (let j = 0; j < NS; j++) {
        const j1 = (j + 1) % NS;
        add([wp(A.R[j][0], A.y, A.R[j][1]), wp(A.R[j1][0], A.y, A.R[j1][1]), wp(B.R[j1][0], B.y, B.R[j1][1]), wp(B.R[j][0], B.y, B.R[j][1])], FOAM, 1, { ctr });
      }
    }
    if (rings.length) {   // Deckel oben (Fächer)
      const Tp = rings[rings.length - 1], ctr = wp(Tp.cc[0], Tp.y - 5, Tp.cc[1]), top = wp(Tp.cc[0], Tp.y, Tp.cc[1]);
      for (let j = 0; j < NS; j++) { const j1 = (j + 1) % NS; add([top, wp(Tp.R[j][0], Tp.y, Tp.R[j][1]), wp(Tp.R[j1][0], Tp.y, Tp.R[j1][1])], FOAM, 1, { ctr }); }
    }
    if (S.done === 0 && P.st.top > Sl[Sl.length - 1].y + 0.5) prism(P.st.r, Sl[Sl.length - 1].y, P.st.top, FOAM);
    // Zielteil: nur Vorderseiten, als eigene durchscheinende Lage über dem Block (nicht mit ihm vermischt)
    if (c.ghost && !fin && P.M.ntri <= 20000) { const V = P.M.P; for (let t = 0; t < P.M.ntri; t++) { const i = 9 * t; add([wp(V[i], V[i + 1], V[i + 2]), wp(V[i + 3], V[i + 4], V[i + 5]), wp(V[i + 6], V[i + 7], V[i + 8])], [255, 160, 70], 0.25, { ghost: true }); } }
    g.save();
    zRender(g, polys, api.W, api.H);
    // Tellerrand
    const rim = diskW.map(api.scr);
    if (!rim.some(q => q.d < api.NEAR)) { g.beginPath(); rim.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.strokeStyle = 'rgba(200,210,224,.45)'; g.lineWidth = 1; g.stroke(); }
    if (ghost.length) ghost.sort((p, q) => p.d - q.d).forEach(p => { g.beginPath(); p.Q.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.fillStyle = p.col; g.fill(); });
    const a = api.scr(wp(tr * 0.75, tbl().y, 0)), b = api.scr(wp(tr, tbl().y, 0));   // 0°-Marke
    g.strokeStyle = '#ffd27a'; g.lineWidth = 3; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    api.strokeSeg({ x: P.X0, y: tbl().y - 40, z: zc }, { x: P.X0, y: P.safeY + 20, z: zc }, 'rgba(255,255,255,.3)', 1, [6, 4]);   // Tischachse
    const nCut = S.cut != null ? Math.floor(S.cut) + 1 : (fin ? P.cuts.length : 0);
    g.fillStyle = '#ffd27a'; g.font = '12px Segoe UI'; g.textAlign = 'left';
    g.fillText(T('Drehtisch') + ' ' + tbl().axis + ' ' + f1(S.b) + '° · ' + T('Schnitt') + ' ' + Math.min(P.cuts.length, nCut) + ' / ' + P.cuts.length, 12, 20);
    g.restore();
  }

  // ---------- Tiefenpuffer-Rasterer ----------
  // Flächen (konvexe Polygone, projizierte Punkte {x, y, d}; d = Tiefe, im Simulator größer = näher) pixelgenau mit
  // Tiefentest in ein eigenes Bild rastern (zweifach überabgetastet → glatte Kanten), dann aufs Canvas legen.
  function zRender(g, list, W, H) {
    const SS = 2, w = Math.max(1, Math.ceil(W * SS)), h = Math.max(1, Math.ceil(H * SS));
    const cv = zRender.cv || (zRender.cv = document.createElement('canvas'));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; zRender.zb = null; }
    const cx = cv.getContext('2d'), img = cx.createImageData(w, h), px = new Uint32Array(img.data.buffer);
    const zb = zRender.zb || (zRender.zb = new Float32Array(w * h)); zb.fill(-Infinity);
    const tri = (a, b, c, col) => {
      const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (Math.abs(ar) < 1e-9) return;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const inv = 1 / ar, E = -1e-4;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const pxx = x + 0.5;
          const w0 = ((b[0] - pxx) * (c[1] - py) - (b[1] - py) * (c[0] - pxx)) * inv; if (w0 < E) continue;
          const w1 = ((c[0] - pxx) * (a[1] - py) - (c[1] - py) * (a[0] - pxx)) * inv; if (w1 < E) continue;
          const w2 = 1 - w0 - w1; if (w2 < E) continue;
          const z = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * w + x;
          if (z > zb[i]) { zb[i] = z; px[i] = col; }   // im Simulator: größeres d = näher
        }
      }
    };
    for (const p of list) {
      const Q = p.Q.map(q => [q.x * SS, q.y * SS, q.d]), r = p.rgb;
      const col = ((255 << 24) | (r[2] << 16) | (r[1] << 8) | r[0]) >>> 0;
      for (let k = 1; k + 1 < Q.length; k++) tri(Q[0], Q[k], Q[k + 1], col);
    }
    cx.putImageData(img, 0, 0);
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, W, H); g.restore();
  }

  function draw3d() {
    if (useSim()) { Sim3D.setRotTime(sim.t * 60); Sim3D.drawRot(); return; }
    const cv = document.getElementById('cRot3d'); if (!cv || !isOpen()) return;
    const box = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; if (box.width < 10) return;
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const Wc = box.width, Hc = box.height, c = cfg();
    g.fillStyle = '#10141a'; g.fillRect(0, 0, Wc, Hc); g.font = '12px sans-serif';
    if (!G || G.err) { g.fillStyle = '#9aa7b8'; g.fillText(G && G.err ? G.err : '', 14, 24); return; }
    const P = G.Pl, S = stateAt(sim.t), W = +state.cfg.machineWidth || 900, zc = W / 2, sg = c.invert ? -1 : 1, th = sg * S.b * DEG;
    const ca = Math.cos(th), sa = Math.sin(th);
    // Tischkoordinaten (u, y, w) → Welt (Maschinen-X, Y, Z quer); Tisch um θ gedreht
    // muss zur Silhouette passen: Maschinen-X − X0 = u·cosθ + w·sinθ
    const wp = (u, y, w) => [P.X0 + u * ca + w * sa, y, zc - u * sa + w * ca];
    const C = [P.X0, (tbl().y + P.st.top) / 2, zc], ext = Math.max(2.6 * P.Rc, P.st.top - tbl().y) * 1.5, sc = Math.min(Wc, Hc) / ext * sim.zoom;
    const pr = v => { const q = ROT([v[0] - C[0], v[1] - C[1], v[2] - C[2]], sim.yaw, sim.pitch); return [Wc / 2 + sim.px + q[0] * sc, Hc / 2 + sim.py - q[1] * sc, q[2]]; };
    const polys = [], L = [0.35, 0.8, -0.5], Ln = Math.hypot(...L);
    const add = (V, rgb, al, edge) => {
      const Q = V.map(pr), A = [V[1][0] - V[0][0], V[1][1] - V[0][1], V[1][2] - V[0][2]], B = [V[2][0] - V[0][0], V[2][1] - V[0][1], V[2][2] - V[0][2]];
      const n = ROT([A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]], sim.yaw, sim.pitch), nl = Math.hypot(...n) || 1;
      const k = 0.4 + 0.6 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * Ln));
      polys.push({ Q, d: Q.reduce((s, q) => s + q[2], 0) / Q.length, col: 'rgba(' + rgb.map(v => Math.round(v * k)).join(',') + ',' + al + ')', edge });
    };
    // Drehtisch (Scheibe) mit Markierung für 0°
    const tr = P.Rc * 0.92, disk = Array.from({ length: 48 }, (_, i) => { const a = TAU * i / 48; return wp(tr * Math.cos(a), tbl().y, tr * Math.sin(a)); });
    add(disk, [90, 96, 108], 1, true);
    // Werkstück: Restkörper nach S.done Schnitten; darunter der Sockel
    const PL = P.after[Math.min(S.done, P.after.length - 1)], Sl = P.S, fin = S.done >= P.cuts.length, FOAM = fin ? [120, 180, 235] : [225, 228, 232];
    const prism = (poly, y0, y1, rgb, top) => {
      if (poly.length < 3) return;
      for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; add([wp(p[0], y0, p[1]), wp(q[0], y0, q[1]), wp(q[0], y1, q[1]), wp(p[0], y1, p[1])], rgb, 1); }
      if (top) add(poly.map(p => wp(p[0], y1, p[1])), rgb, 1);
    };
    prism(P.st.r, tbl().y, P.yBot, [225, 228, 232], true);   // Sockel
    for (let k = 0; k < Sl.length - 1; k++) prism(PL[k], Sl[k].y, Sl[k + 1].y, FOAM, k === Sl.length - 2 || area(PL[k]) > area(PL[k + 1]) + 1);
    if (S.done === 0 && P.st.top > Sl[Sl.length - 1].y + 0.5) prism(P.st.r, Sl[Sl.length - 1].y, P.st.top, FOAM, true);
    // Zielteil (durchscheinend)
    if (c.ghost && P.M.ntri <= 6000) {
      const V = P.M.P;
      for (let t = 0; t < P.M.ntri; t++) { const i = 9 * t; add([wp(V[i], V[i + 1], V[i + 2]), wp(V[i + 3], V[i + 4], V[i + 5]), wp(V[i + 6], V[i + 7], V[i + 8])], [255, 170, 80], 0.22); }
    }
    polys.sort((a, b) => a.d - b.d);
    polys.forEach(p => { g.beginPath(); p.Q.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fillStyle = p.col; g.fill(); if (p.edge) { g.strokeStyle = 'rgba(200,210,224,.4)'; g.lineWidth = 1; g.stroke(); } });
    // 0°-Marke am Tischrand
    { const a = pr(wp(tr * 0.75, tbl().y, 0)), b = pr(wp(tr, tbl().y, 0)); g.strokeStyle = '#ffd27a'; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    // Tischachse, Portale, Draht (dreht nicht mit)
    const line = (a, b, col, w, dash) => { const A = pr(a), B2 = pr(b); g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B2[0], B2[1]); g.stroke(); g.setLineDash([]); };
    line([P.X0, tbl().y - 40, zc], [P.X0, P.safeY + 20, zc], 'rgba(255,255,255,.3)', 1, [6, 4]);
    [0, W].forEach(z => { line([S.x, 0, z], [S.x, P.safeY + 40, z], 'rgba(160,170,185,.85)', 4); const q = pr([S.x, S.y, z]); g.fillStyle = '#ffd27a'; g.fillRect(q[0] - 5, q[1] - 5, 10, 10); });
    line([S.x, S.y, 0], [S.x, S.y, W], S.cutting ? '#ff5a3c' : '#ff9a80', S.cutting ? 2.4 : 1.4);
    [[[1, 0, 0], '#ff6b6b', 'X'], [[0, 1, 0], '#7ee0a0', 'Y'], [[0, 0, 1], '#5aa9ff', 'Z']].forEach(([v, col, lb]) => { const q = ROT(v, sim.yaw, sim.pitch); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(40, Hc - 40); g.lineTo(40 + q[0] * 26, Hc - 40 - q[1] * 26); g.stroke(); g.fillStyle = col; g.fillText(lb, 43 + q[0] * 30, Hc - 37 - q[1] * 30); });
    g.fillStyle = '#c8d2e0';
    const nCut = S.cut != null ? Math.floor(S.cut) + 1 : (fin ? P.cuts.length : 0);
    g.fillText(tbl().axis + ' ' + f1(S.b) + '°   X ' + f1(S.x) + '   Y ' + f1(S.y) + '   ' + T('Schnitt') + ' ' + Math.min(P.cuts.length, nCut) + ' / ' + P.cuts.length, 12, 20);
  }

  // ---------- Schnitte (Klappfenster): Profil des gewählten Schnitts + Draufsicht ----------
  function drawSec() {
    const cv = document.getElementById('cRot'); if (!cv || !isOpen() || cv.offsetParent === null) return;
    const box = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; if (box.width < 10) return;
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = box.width, H = box.height; g.fillStyle = '#10141a'; g.fillRect(0, 0, W, H); g.font = '11px sans-serif';
    const lab = document.getElementById('rotSecLbl');
    if (!G || G.err || !G.Pl.cuts.length) { if (lab) lab.textContent = '—'; return; }
    const P = G.Pl, i = sim.sel, ct = P.cuts[i], c = cfg();
    if (lab) lab.textContent = (i + 1) + ' / ' + P.cuts.length + ' · ' + f1(ct.a) + '°';
    // links: Profil in X-Y (Blick entlang des Drahts)
    const pw = W * 0.55, pad = 18, xs = ct.path.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = tbl().y, y1 = P.safeY;
    const s1 = Math.min((pw - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad - 14) / (y1 - y0 || 1)), X = x => pad + (x - x0) * s1, Y = y => H - pad - (y - y0) * s1;
    g.strokeStyle = 'rgba(200,210,224,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(x0), Y(tbl().y)); g.lineTo(X(x1), Y(tbl().y)); g.stroke();
    g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(P.X0), Y(tbl().y)); g.lineTo(X(P.X0), Y(y1)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#ff7a5c'; g.lineWidth = 1.6; g.beginPath(); ct.path.forEach((p, k) => k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
    g.fillStyle = '#c8d2e0'; g.fillText(T('Profil (Blick entlang des Drahts)'), pad, 12);
    // rechts: Draufsicht Tisch — Rohling, Teil (orange), Ergebnis (blau) auf ⅓ Höhe, Drahtrichtungen
    const ox = pw + 10, ww = W - ox - 8, R = P.Rc, s2 = Math.min(ww, H - 30) / (2.2 * R), cx = ox + ww / 2, cy = H / 2 + 6, U = (u, w) => [cx + u * s2, cy - w * s2];
    const poly = (Q, col, fill) => { if (Q.length < 2) return; g.beginPath(); Q.forEach((p, k) => { const q = U(p[0], p[1]); k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = col; g.stroke(); };
    g.lineWidth = 1; poly(P.st.r, 'rgba(200,210,224,.45)');
    const fin = P.after[P.after.length - 1], mid = Math.floor(P.S.length / 3);
    if (fin[mid]) poly(fin[mid], '#5aa9ff', 'rgba(90,169,255,.18)');
    poly(P.S[mid].h, '#ffaa50');
    // Draht bei Tischwinkel θ liegt im Tischsystem in Richtung (−sinθ, cosθ)
    P.cuts.forEach((q, k) => { const a = q.a * DEG, d = [-Math.sin(a) * R, Math.cos(a) * R], A = U(-d[0], -d[1]), B = U(d[0], d[1]); g.strokeStyle = k === i ? '#ff5a3c' : 'rgba(255,90,60,.25)'; g.lineWidth = k === i ? 2 : 1; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); });
    g.fillStyle = '#c8d2e0'; g.fillText(T('Draufsicht Tisch: Drahtrichtungen, Teil (orange), Ergebnis (blau) auf ⅓ Höhe'), ox, 12);
  }

  // ---------- Wiedergabe / Fenster / Maus ----------
  function tick(now) {
    if (!sim.play || !isOpen() || !G || G.err) { sim.play = false; syncBar(); return; }
    const dt = Math.min(0.1, (now - (sim.last || now)) / 1000); sim.last = now;
    sim.t += dt / 60 * sim.speed; if (sim.t >= G.tot) { sim.t = G.tot; sim.play = false; }
    draw3d(); syncBar(); if (sim.play) requestAnimationFrame(tick);
  }
  function play(on) { if (!G || G.err) return; sim.play = on == null ? !sim.play : on; if (sim.play && sim.t >= G.tot - 1e-9) sim.t = 0; sim.last = performance.now(); syncBar(); if (sim.play) requestAnimationFrame(tick); }
  const hms = m => { const t = Math.max(0, Math.round(m * 60)), h = Math.floor(t / 3600); return h + ':' + String(Math.floor(t / 60) % 60).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };   // Minuten → h:mm:ss
  function syncBar() {
    const b = document.getElementById('rotBar'); if (!b) return; const ok = G && !G.err;
    b.querySelector('[data-a=play]').textContent = sim.play ? '⏸' : '▶';
    b.querySelector('input[type=range]').value = ok && G.tot > 0 ? Math.round(sim.t / G.tot * 1000) : 0;
    b.querySelector('.rot-t').textContent = ok ? hms(sim.t) + ' / ' + hms(G.tot) : '';
  }
  const secKey = 'hw_rot_secwin';
  function secOpen() { try { return localStorage.getItem(secKey) === '1'; } catch (e) { return false; } }
  function setSec(on) {
    try { localStorage.setItem(secKey, on ? '1' : '0'); } catch (e) {}
    const w = document.getElementById('rotSecWin'); if (w) w.style.display = on ? 'flex' : 'none';
    const bt = document.querySelector('#rotBar [data-a=sec]'); if (bt) bt.classList.toggle('active', on);
    if (on) drawSec();
  }
  function show() {
    const v = document.getElementById('rotView'); if (!v) return;
    if (!v.querySelector('#cRot3d')) {
      v.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column">'
        + '<div id="rotInfo" style="padding:6px 12px;font-size:12px"></div>'
        + '<div style="position:relative;flex:1;min-height:0"><canvas id="cRot3d" style="position:absolute;inset:0;width:100%;height:100%;cursor:grab"></canvas>'
        + '<div id="rotSecWin" class="rot-secwin"><div class="rot-sechd"><span>' + T('Schnitte') + '</span><span style="display:flex;gap:4px;align-items:center"><button data-s="-1">◀</button><span id="rotSecLbl" style="font-weight:400"></span><button data-s="1">▶</button><button data-x="1" title="' + T('Schließen') + '">✕</button></span></div>'
        + '<div style="position:relative;flex:1;min-height:0"><canvas id="cRot" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div></div></div>'
        + '<div id="rotBar" class="rot-bar"><button data-a="start" title="' + T('An den Anfang') + '">⏮</button><button data-a="play">▶</button><button data-a="end" title="' + T('Ans Ende (fertiges Teil)') + '">⏭</button>'
        + '<input type="range" min="0" max="1000" value="0"><span class="rot-t"></span>'
        + '<label>' + T('Tempo') + ' <select data-a="speed">' + [1, 5, 10, 30, 100].map(k => '<option value="' + k + '"' + (k === sim.speed ? ' selected' : '') + '>' + k + '×</option>').join('') + '</select></label>'
        + '<button data-a="sec">' + T('Schnitte') + ' ▾</button></div></div>';
      const bar = v.querySelector('#rotBar');
      bar.querySelector('[data-a=play]').onclick = () => play();
      bar.querySelector('[data-a=start]').onclick = () => { play(false); sim.t = 0; draw3d(); syncBar(); };
      bar.querySelector('[data-a=end]').onclick = () => { play(false); sim.t = G && !G.err ? G.tot : 0; draw3d(); syncBar(); };
      bar.querySelector('input[type=range]').oninput = e => { const v = +e.target.value; play(false); sim.t = G && !G.err ? G.tot * v / 1000 : 0; draw3d(); syncBar(); };
      bar.querySelector('[data-a=speed]').onchange = e => { sim.speed = +e.target.value; };
      bar.querySelector('[data-a=sec]').onclick = () => setSec(!secOpen());
      const win = v.querySelector('#rotSecWin');
      win.querySelector('[data-x]').onclick = () => setSec(false);
      win.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { if (!G || G.err) return; const n = G.Pl.cuts.length; sim.sel = (sim.sel + (+b.dataset.s) + n) % n; drawSec(); });
      dragWin(win, win.querySelector('.rot-sechd'));
      if (window.ResizeObserver) new ResizeObserver(() => drawSec()).observe(win);
      if (useSim()) Sim3D.mountRot('cRot3d'); else wireMouse(v.querySelector('#cRot3d'));
    }
    setSec(secOpen());
    update();
  }
  function dragWin(win, hd) {
    hd.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return; e.preventDefault();
      const r0 = win.getBoundingClientRect(), p = win.offsetParent.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
      const mv = ev => { win.style.left = Math.max(0, Math.min(p.width - 60, ev.clientX - p.left - dx)) + 'px'; win.style.top = Math.max(0, Math.min(p.height - 30, ev.clientY - p.top - dy)) + 'px'; win.style.right = 'auto'; };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
  }
  function resetView() { sim.yaw = -0.85; sim.pitch = 0.45; sim.zoom = 1; sim.px = sim.py = 0; draw3d(); }
  function wireMouse(cv) {
    let d = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => { d = { b: e.button, x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; });
    addEventListener('mousemove', e => {
      if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
      if (d.b === 0) { sim.yaw -= dx * 0.01; sim.pitch = Math.max(-1.55, Math.min(1.55, sim.pitch - dy * 0.01)); } else { sim.px += dx; sim.py += dy; }
      draw3d();
    });
    addEventListener('mouseup', () => { d = null; cv.style.cursor = 'grab'; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2 - sim.px, my = e.clientY - r.top - r.height / 2 - sim.py, k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      sim.zoom = Math.max(0.1, Math.min(50, sim.zoom * k)); sim.px -= mx * (k - 1); sim.py -= my * (k - 1); draw3d();
    }, { passive: false });
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(cv, (x, y) => { const r = cv.getBoundingClientRect(); sim.px += r.width / 2 - x; sim.py += r.height / 2 - y; draw3d(); return true; });
    if (window.ViewCube && ViewCube.attach) sim.cube = ViewCube.attach({
      canvas: () => document.getElementById('cRot3d'), get: () => ({ yaw: sim.yaw, pitch: sim.pitch }),
      set: (y, p) => { sim.yaw = y; sim.pitch = p; }, redraw: draw3d, rot: ROT, k: [-0.01, -0.01],
      labels: { '+x': T('Hinten'), '-x': T('Vorne'), '+y': T('Oben'), '-y': T('Unten'), '+z': T('Rechts'), '-z': T('Links') },
      active: isOpen, reset: resetView
    });
  }
  window.addEventListener('resize', () => { if (isOpen()) { draw3d(); drawSec(); } });

  // ---------- Teil laden ----------
  function loadFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.stl,.obj,.stp,.step,.igs,.iges';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        if (!window.Model3D || !Model3D.parseFile) throw new Error(T('Zum Laden wird die Funktion „3D-Modell“ gebraucht.'));
        setMesh(await Model3D.parseFile(f), f.name);
      } catch (e) { alert(e.message); }
    };
    inp.click();
  }
  function fromModel3d() {
    const v = window.Model3D && Model3D.state && Model3D.state.verts;
    if (!v || v.length < 9) { alert(T('Im Reiter „3D-Modell“ ist kein Modell geladen.')); return; }
    setMesh(v, Model3D.state.name || T('3D-Modell'));
  }
  function setMesh(v, name) {
    const c = cfg();
    if (v.length / 9 > 200000 && !confirm(T('Sehr großes Modell') + ' (' + Math.round(v.length / 9) + ' ' + T('Dreiecke') + ') — ' + T('die Rechnung kann dauern. Trotzdem laden?'))) return;
    c.mesh64 = b64.enc(v instanceof Float32Array ? v : new Float32Array(v)); c.meshName = name; c.src = 'mesh';
    if (App.buildSidebar) App.buildSidebar(); update();
  }

  // ---------- Seitenleiste ----------
  function rotSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, mkMini } = App, c = cfg();
    const warn = App.warn || ((b, t) => hint(b, t));
    const RD = () => { if (isOpen()) update(); }, RB = () => { if (App.buildSidebar) App.buildSidebar(); RD(); };
    const num = (b, l, get, set, o) => numRow(b, l, get, v => { set(v); RD(); }, Object.assign({ norender: true }, o || {}));
    const btns = (b, list) => { const d = document.createElement('div'); d.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin:2px 0 6px'; list.forEach(([t, fn]) => d.appendChild(mkMini(T(t), fn))); b.appendChild(d); };

    const g0 = grp('Drehtisch', true, 'rot', { key: 'rotTbl' }); side.appendChild(g0.g);
    hint(g0.body, 'Der Block steht auf einem Drehtisch mit senkrechter Achse. Je Tischwinkel schneidet der Draht die Silhouette des Teils (beide Portale gleich), fährt hoch, der Tisch dreht weiter. Was von keiner Richtung aus sichtbar ist (Mulden, Löcher), bleibt stehen.');
    const tb = tbl();
    if (!tb.on) warn(g0.body, 'Die Maschine hat laut Einstellungen keinen Drehteller. Im Reiter „Maschine“ → „Drehteller (5. Achse)“ einschalten — erst dann gibt es die Quelle „Drehtisch“ im Reiter „Schneiden“.');
    hint(g0.body, T('Aus dem Reiter Maschine:') + ' ' + T('Achse') + ' ' + tb.axis + ' · ' + T('Tischmitte X') + ' ' + f1(tb.x) + ' mm · ' + T('Tisch-Oberkante Y') + ' ' + f1(tb.y) + ' mm');
    btns(g0.body, [['Drehteller im Reiter Maschine einstellen …', () => App.switchView && App.switchView('machine')]]);
    boolRow(g0.body, 'Drehrichtung umkehren', () => c.invert, v => { c.invert = v; RD(); });
    num(g0.body, 'Vorschub (0 = aus Werkstoff)', () => c.feed, v => c.feed = v, { step: 10 });
    boolRow(g0.body, 'Abbrand berücksichtigen', () => c.kerfOn, v => { c.kerfOn = v; RD(); });

    const g1 = grp('Teil', true, 'rot', { key: 'rotPart' }); side.appendChild(g1.g);
    selectRow(g1.body, 'Quelle', [['test', 'Testkörper'], ['prof', 'Kontur drehen'], ['mesh', 'Geladenes Modell']], () => c.src, v => { c.src = v; RB(); });
    if (c.src === 'test') selectRow(g1.body, 'Testkörper', Object.keys(TESTS).map(k => [k, TESTS[k][0]]), () => c.test, v => { c.test = v; RD(); });
    else if (c.src === 'prof') profEditor(g1.body, c, RD, num, btns);
    else hint(g1.body, c.meshName ? T('Modell:') + ' ' + c.meshName : 'Noch kein Modell geladen.');
    if (c.src !== 'prof') btns(g1.body, [['Datei laden … (STL/OBJ/STEP)', loadFile], ['Aus Reiter 3D-Modell', fromModel3d]]);
    if (c.src === 'mesh') selectRow(g1.body, 'Achse der Datei, die nach oben zeigt', [['z', '+Z (Druckmodelle, CAD)'], ['y', '+Y (Grafik/Spiele, glTF)'], ['x', '+X'], ['-z', '−Z (steht kopf)'], ['-y', '−Y'], ['-x', '−X']], () => c.up || (c.zUp === false ? 'y' : 'z'), v => { c.up = v; RD(); }, 'Diese Achse des Modells wird senkrecht auf den Drehteller gestellt.');
    num(g1.body, 'Maßstab (%)', () => c.scale, v => c.scale = v, { step: 5 });
    num(g1.body, 'Drehung auf dem Tisch (°)', () => c.rotZ, v => c.rotZ = v, { step: 5 });
    num(g1.body, 'Versatz X auf dem Tisch (mm)', () => c.du, v => c.du = v, { step: 1 });
    num(g1.body, 'Versatz quer auf dem Tisch (mm)', () => c.dw, v => c.dw = v, { step: 1 });
    num(g1.body, 'Sockel unter dem Teil (mm)', () => c.base, v => c.base = v, { step: 1, hint: 'Bis zu dieser Höhe bleibt der Block stehen, das Teil hält daran. Der Draht fährt nie tiefer.' });
    boolRow(g1.body, 'Zielteil durchscheinend zeigen', () => c.ghost, v => { c.ghost = v; RD(); });

    const g2 = grp('Rohling', false, 'rot', { key: 'rotStock' }); side.appendChild(g2.g);
    selectRow(g2.body, 'Größe', [['auto', 'aus dem Teil + Rand'], ['manual', 'eigene Maße']], () => c.stock, v => { c.stock = v; RB(); });
    if (c.stock === 'manual') {
      num(g2.body, 'Länge X (mm)', () => c.stW, v => c.stW = v, { step: 5 });
      num(g2.body, 'Breite quer (mm)', () => c.stD, v => c.stD = v, { step: 5 });
      num(g2.body, 'Höhe ab Tisch (mm)', () => c.stH, v => c.stH = v, { step: 5 });
    } else num(g2.body, 'Rand (mm)', () => c.margin, v => c.margin = v, { step: 1 });

    const g3 = grp('Schnitte', true, 'rot', { key: 'rotCuts' }); side.appendChild(g3.g);
    selectRow(g3.body, 'Winkel', [['auto', 'automatisch nach der Geometrie'], ['step', 'gleichmäßig verteilt'], ['list', 'eigene Liste']], () => c.angMode, v => { c.angMode = v; RB(); });
    if (c.angMode === 'list') {
      const row = document.createElement('div'); row.className = 'row'; const l = document.createElement('label'); l.textContent = T('Winkel (°), Komma getrennt'); const inp = document.createElement('input'); inp.type = 'text'; inp.value = c.angList; inp.style.cssText = 'flex:1;min-width:0'; inp.onchange = () => { c.angList = inp.value; RD(); }; row.appendChild(l); row.appendChild(inp); g3.body.appendChild(row);
    } else {
      num(g3.body, 'Anzahl Schnitte', () => c.nCuts, v => c.nCuts = v, { step: 1 });
      if (c.angMode === 'step') num(g3.body, 'Winkelbereich (°)', () => c.range, v => c.range = v, { step: 15, hint: '180° reichen: ein Schnitt bei θ und bei θ + 180° ist derselbe.' });
      if (c.angMode === 'auto') hint(g3.body, 'Wählt nacheinander jeweils den Winkel, der am meisten Restmaterial entfernt (geprüft alle 3°) — Schnitte sammeln sich dort, wo die Form sich stark ändert.');
    }
    num(g3.body, 'Schichtabstand der Rechnung (mm)', () => c.dy, v => c.dy = v, { step: 0.5, hint: 'Feiner = genauere Silhouette, mehr G-Code-Sätze.' });
    num(g3.body, 'Bahn ausdünnen: Toleranz (mm)', () => c.tol, v => c.tol = v, { step: 0.01, hint: 'Lässt Stützpunkte weg, solange die Bahn höchstens so weit abweicht (0 = aus). Weniger, längere G1-Sätze — GRBL fährt gleichmäßiger statt zu ruckeln.' });
    num(g3.body, 'Anfahrweg außerhalb des Blocks (mm)', () => c.lead, v => c.lead = v, { step: 5 });
    num(g3.body, 'Sicherheitshöhe über dem Block (mm)', () => c.safe, v => c.safe = v, { step: 5 });

    const g9 = grp('Ausgabe', true, 'rot', { key: 'rotOut' }); side.appendChild(g9.g);
    btns(g9.body, [['An „Schneiden“ übergeben', sendCut], ['G-Code speichern', saveG]]);
    hint(g9.body, 'Zwischen den Schnitten fährt der Draht über den Block, erst dann dreht der Tisch (Eilgang). grblHAL: Steps je Grad, Geschwindigkeit und Beschleunigung der Tischachse einstellen. Der Simulator im Reiter „Schneiden“ kennt den Drehtisch nicht — dafür ist die Simulation hier.');
  }
  // ---------- Kontur-Editor (Quelle „Kontur drehen“) ----------
  // Links ziehen = Punkt verschieben · Rechtsklick = Punkt einfügen · Doppelklick/Mittelklick = Punkt löschen
  function profEditor(body, c, RD, num, btns) {
    App.hint(body, 'Seitenkontur des Drehkörpers: links die Drehachse, nach rechts der Radius, nach oben die Höhe (mm). Ziehen = verschieben, Rechtsklick = Punkt einfügen, Doppelklick = Punkt löschen.');
    const W = 250, H = 250, cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.id = 'rotProfCv';
    cv.style.cssText = 'display:block;width:' + W + 'px;height:' + H + 'px;margin:4px 0;border:1px solid var(--line,#444);border-radius:4px;background:var(--bg2,#1b1f24);cursor:crosshair';
    body.appendChild(cv);
    const info = document.createElement('div'); info.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:4px'; body.appendChild(info);
    const pad = 18; let drag = -1, hov = -1;
    const ext = () => { const P = c.prof; let r = 20, y = 20; P.forEach(q => { r = Math.max(r, q[1]); y = Math.max(y, q[0]); }); const m = Math.max(r * 1.15, y * 1.1); return { m: Math.ceil(m / 10) * 10 }; };
    let E = ext();
    const sc = () => (Math.min(W, H) - 2 * pad) / E.m;
    const toS = q => [pad + q[1] * sc(), H - pad - q[0] * sc()];
    const toW = (x, y) => [(H - pad - y) / sc(), (x - pad) / sc()];
    const snap = v => { const g = +c.profSnap || 0; return g > 0 ? Math.round(v / g) * g : Math.round(v * 10) / 10; };
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    const near = (x, y) => { let b = -1, bd = 10; c.prof.forEach((q, i) => { const [sx, sy] = toS(q), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; b = i; } }); return b; };
    function draw() {
      const g = cv.getContext('2d'), th = window.DrawTheme, col = (k, d) => (th && th.raw ? th.raw(d) : d);
      g.clearRect(0, 0, W, H);
      const gs = +c.profSnap > 0 ? +c.profSnap : 10, st = gs * sc() < 6 ? gs * Math.ceil(6 / (gs * sc())) : gs;
      g.strokeStyle = col(0, 'rgba(255,255,255,0.07)'); g.lineWidth = 1; g.beginPath();
      for (let v = 0; v <= E.m + 1e-9; v += st) { const a = pad + v * sc(), b = H - pad - v * sc(); g.moveTo(a, pad); g.lineTo(a, H - pad); g.moveTo(pad, b); g.lineTo(W - pad, b); }
      g.stroke();
      g.strokeStyle = col(0, '#e0a040'); g.setLineDash([5, 4]); g.beginPath(); g.moveTo(pad, pad); g.lineTo(pad, H - pad); g.stroke(); g.setLineDash([]);
      const P = c.prof.map(toS);
      g.fillStyle = col(0, 'rgba(90,160,255,0.15)'); g.beginPath(); g.moveTo(pad, P[0][1]); P.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(pad, P[P.length - 1][1]); g.closePath(); g.fill();
      g.strokeStyle = col(0, '#5aa0ff'); g.lineWidth = 2; g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
      P.forEach((p, i) => { g.fillStyle = i === hov || i === drag ? '#ffd040' : col(0, '#e8eef5'); g.beginPath(); g.arc(p[0], p[1], 4, 0, TAU); g.fill(); });
      g.fillStyle = col(0, 'rgba(255,255,255,0.6)'); g.font = '10px sans-serif'; g.fillText(E.m + ' mm', W - pad - 34, H - 5);
      const q = c.prof[hov >= 0 ? hov : drag]; info.textContent = q ? 'H ' + f1(q[0]) + ' mm · r ' + f1(q[1]) + ' mm (Ø ' + f1(2 * q[1]) + ')' : c.prof.length + ' ' + T('Punkte');
    }
    const commit = () => { E = ext(); draw(); RD(); };
    cv.addEventListener('contextmenu', e => {
      e.preventDefault(); const [x, y] = pos(e), w = toW(x, y), q = [Math.max(0, snap(w[0])), Math.max(0, snap(w[1]))];
      // in das nächste Segment einfügen
      let bi = c.prof.length, bd = Infinity; const P = c.prof.map(toS);
      for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y); if (d < bd) { bd = d; bi = i + 1; } }
      c.prof.splice(bi, 0, q); commit();
    });
    const del = i => { if (i >= 0 && c.prof.length > 2) { c.prof.splice(i, 1); hov = -1; commit(); } };
    cv.addEventListener('dblclick', e => { const [x, y] = pos(e); del(near(x, y)); });
    cv.addEventListener('mousedown', e => {
      const [x, y] = pos(e), i = near(x, y);
      if (e.button === 1) { e.preventDefault(); del(i); return; }
      if (e.button !== 0 || i < 0) return;
      drag = i; e.preventDefault();
      const mv = ev => { const [x2, y2] = pos(ev), w = toW(x2, y2); c.prof[drag] = [Math.max(0, snap(w[0])), Math.max(0, snap(w[1]))]; draw(); };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); drag = -1; commit(); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    cv.addEventListener('mousemove', e => { if (drag >= 0) return; const [x, y] = pos(e), i = near(x, y); if (i !== hov) { hov = i; draw(); } });
    cv.addEventListener('mouseleave', () => { if (hov >= 0 && drag < 0) { hov = -1; draw(); } });
    draw();
    num(body, 'Drehschritte (0 = rund, sonst n-Kant)', () => c.profN, v => { c.profN = Math.max(0, Math.round(v)); }, { step: 1, hint: 'Z. B. 6 = Sechskant, 8 = Achtkant. Mit „gleichmäßig verteilt“ und Anzahl Schnitte = halbe Schrittzahl werden die Kanten genau getroffen.' });
    num(body, 'Rasterfang (mm, 0 = aus)', () => c.profSnap, v => { c.profSnap = Math.max(0, v); draw(); }, { step: 1 });
    btns(body, [['Kontur zurücksetzen', () => { c.prof = [[0, 40], [10, 40], [18, 26], [70, 16], [82, 30], [95, 14], [120, 0]]; commit(); }], ['Kegel', () => { c.prof = [[0, 50], [100, 0]]; commit(); }], ['Kuppel', () => { c.prof = []; for (let i = 0; i <= 8; i++) { const t = Math.PI / 2 * i / 8; c.prof.push([Math.round(60 * Math.sin(t) * 10) / 10, Math.round(60 * Math.cos(t) * 10) / 10]); } commit(); }]]);
  }
  // Programm für den Reiter „Schneiden" (Quelle „Drehtisch"): Text, Monitor-Szene mit Drehteller, Bezeichnung.
  // Tischwinkel und Schnittstand je Zeile werden aus dem fertigen Text gelesen (nach dem Vorschub-Modus),
  // damit der Monitor in der Vorschau UND beim echten Lauf (Zeilenverfolgung) den Block richtig dreht.
  function cutProgram(post) {
    const g = gcode(); if (g.err) return { err: g.err };
    const P = g.Pl, B = tbl().axis, text = post ? post(g.text) : g.text, lines = text.split(/\r?\n/);
    const reB = new RegExp('(?:^|\\s)' + B + '\\s*([-+]?\\d*\\.?\\d+)', 'i'), info = [];
    let b = 0, k = -1, cutting = false, cutSeen = false;
    lines.forEach(ln => {
      const code = ln.split(';')[0];
      if (/;\s*---/.test(ln)) { k++; cutSeen = false; }
      const m = reB.exec(code); if (m) b = parseFloat(m[1]);
      if (/^\s*G0?1\b/i.test(code)) { cutting = true; cutSeen = true; } else if (/^\s*G0?0\b/i.test(code)) cutting = false;
      // Schnitt k gilt als fertig, sobald nach seinen G1-Sätzen wieder im Eilgang gefahren wird
      const done = /^\s*M0?[25]\b/i.test(code) ? P.cuts.length : Math.max(0, k + (cutSeen && !cutting ? 1 : 0));
      info.push({ b, cut: k, done, cutting });
    });
    const c = cfg(), name = c.src === 'test' ? T((TESTS[c.test] || TESTS.haube)[0]) : (c.src === 'prof' ? T('Drehkörper (Kontur)') : (c.meshName || T('Modell')));
    const scene = {
      machineWidth: +state.cfg.machineWidth || 900, ax: { x: state.cfg.axX || 'X', y: state.cfg.axY || 'Y', u: state.cfg.axU || 'Z', v: state.cfg.axV || 'A' },
      blocks: [], defaultSeg: 0, limits: App.machineLimits ? App.machineLimits() : null,
      extraBounds: [{ x0: P.X0 - P.Rc, x1: P.X0 + P.Rc, y0: tbl().y - 20, y1: P.safeY }],
      drawExtra: (api) => { const q = info[api.move ? Math.min(info.length - 1, api.move.line) : 0] || { b: 0, done: 0 }; drawTable(api, q, P); }
    };
    return { text, scene, label: T('Drehtisch') + ' · ' + name + ' · ' + P.cuts.length + ' ' + T('Schnitte'), info };
  }
  const fname = () => ((state.projectName || 'drehtisch').replace(/[\\/:*?"<>|]+/g, '_')) + '_drehtisch.gcode';
  // Übergabe: Quelle „Drehtisch" im Reiter „Schneiden" wählen und übernehmen (wie „✂ Schneiden" im G-Code-Reiter)
  function sendCut() {
    if (!tbl().on) { alert(T('Die Maschine hat laut Einstellungen keinen Drehteller (Reiter Maschine → Drehteller).')); return; }
    const g = gcode(); if (g.err) { alert(g.err); return; }
    const src = document.getElementById('cutSource');
    if (!src || ![...src.options].some(o => o.value === 'rot')) { alert(T('Der Reiter „Schneiden“ ist in dieser Ausgabe nicht enthalten.')); return; }
    src.value = 'rot'; App.switchView('cut');
    const btn = document.getElementById('mUseGcode'); if (btn) btn.click();
  }
  function saveG() { if (!tbl().on && !confirm(T('Die Maschine hat laut Einstellungen keinen Drehteller. Trotzdem speichern?'))) return; const g = gcode(); if (g.err) { alert(g.err); return; } if (App.download) App.download(fname(), g.text, 'text/plain', 'svGcode'); else if (App.anchorDownload) App.anchorDownload(fname(), g.text, 'text/plain'); }

  Object.assign(App, { rotSidebar });
  window.Drehachse = { show, refresh: () => { if (isOpen()) update(); }, gcode, cutProgram, sim: () => sim, _test: { plan, slices, placed, angles, hull, cutPoly, area } };
})();

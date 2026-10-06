/* kfm.js — Rechenkern für Stufenprofile (KFm, Kline-Fogleman) und Platten-/
 * Knickprofile. Reine Geometrie ohne Oberfläche; die Eingabemaske liegt im
 * Reiter „Profildatenbank" (foildb.js, gleiche abwählbare Funktion „foildb").
 *
 * Aufbau wie beim Bauen aus Platten: eine Grundplatte über die ganze Sehne,
 * darauf/darunter Lagen von der Nase bis zur jeweiligen Stufe. Dazu Nasenform,
 * optional angeschärfte Endleiste und Knicke der Mittellinie (Knickplatte).
 * Alle Maße in % der Sehne.
 *
 * Ausgabe: Punktliste in Selig-Reihenfolge (Endleiste → Oberseite → Nase →
 * Unterseite → Endleiste). An jeder Ecke sitzen Stützpunkte dicht davor und
 * dahinter, damit die Spline-Neuverteilung (Airfoil.resample) die Stufen nicht
 * überschwingt, sondern als Ecken stehen lässt.
 */
(function () {
  'use strict';

  const PRESETS = [
    { id: 'kfm1', name: 'KFm1', label: 'KFm1 — Stufe unten bei 40 %', t0: 3, steps: [{ side: 'bot', pos: 40, h: 3 }], kinks: [] },
    { id: 'kfm2', name: 'KFm2', label: 'KFm2 — Stufe oben bei 50 %', t0: 3, steps: [{ side: 'top', pos: 50, h: 3 }], kinks: [] },
    { id: 'kfm3', name: 'KFm3', label: 'KFm3 — zwei Stufen oben bei 50 % und 75 %', t0: 3, steps: [{ side: 'top', pos: 50, h: 3 }, { side: 'top', pos: 75, h: 3 }], kinks: [] },
    { id: 'kfm4', name: 'KFm4', label: 'KFm4 — Stufen oben und unten bei 50 %', t0: 3, steps: [{ side: 'top', pos: 50, h: 3 }, { side: 'bot', pos: 50, h: 3 }], kinks: [] },
    { id: 'plate', name: 'Platte', label: 'Ebene Platte', t0: 3, steps: [], kinks: [] },
    { id: 'knick', name: 'Knickplatte', label: 'Knickplatte — Knick bei 30 %', t0: 3, steps: [], kinks: [{ pos: 30, ang: 6 }] }
  ];

  function defaults(id) {
    const p = PRESETS.find(x => x.id === id) || PRESETS[1];
    return { preset: p.id, base: p.name, t0: p.t0, nose: 'round', noseLen: 4,
      steps: p.steps.map(s => ({ side: s.side, pos: s.pos, h: s.h })),
      kinks: p.kinks.map(k => ({ pos: k.pos, ang: k.ang })),
      teLen: 0, teThick: 1 };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, isFinite(v) ? v : a));

  // Eingaben in gültige Bereiche bringen (Sehnenanteile statt %).
  function clean(P) {
    const t0 = clamp(+P.t0, 0.3, 30) / 100;
    const steps = (P.steps || []).map(s => ({ top: s.side !== 'bot', pos: clamp(+s.pos, 5, 95) / 100, h: clamp(+s.h, 0, 30) / 100 }))
      .filter(s => s.h > 1e-5).sort((a, b) => a.pos - b.pos);
    const hu = steps.filter(s => s.top).reduce((a, s) => a + s.h, 0);
    const hl = steps.filter(s => !s.top).reduce((a, s) => a + s.h, 0);
    const half = (t0 + hu + hl) / 2;                    // halbe Gesamtdicke an der Nase
    const first = steps.length ? steps[0].pos : 1;
    let L = P.nose === 'round' ? half : clamp(+P.noseLen, 0.2, 40) / 100;
    L = Math.max(0.002, Math.min(L, first - 0.01, 0.45));
    const last = steps.length ? steps[steps.length - 1].pos : L;
    let teLen = clamp(+P.teLen, 0, 60) / 100;
    teLen = Math.max(0, Math.min(teLen, 1 - Math.max(last, L) - 0.01));
    const teThick = Math.min(clamp(+P.teThick, 0, 30) / 100, t0);
    const kinks = (P.kinks || []).map(k => ({ pos: clamp(+k.pos, 1, 99) / 100, ang: clamp(+k.ang, -45, 45) }))
      .filter(k => Math.abs(k.ang) > 1e-6 && k.pos > L + 0.005).sort((a, b) => a.pos - b.pos);
    return { t0, steps, hu, hl, half, L, teLen, teThick, kinks, nose: P.nose || 'round' };
  }

  // Mittellinie: Polygonzug, an jedem Knick dreht der hintere Teil um ang nach unten.
  function camberFn(kinks) {
    return x => {
      let y = 0, s = 0, x0 = 0;
      for (let i = 0; i < kinks.length && kinks[i].pos < x; i++) {
        y += s * (kinks[i].pos - x0); x0 = kinks[i].pos;
        s -= Math.tan(kinks[i].ang * Math.PI / 180);
      }
      return y + s * (x - x0);
    };
  }

  // Eine Seite von der Nase zur Endleiste als Eckenliste {x, o, sharp}
  // (o = Abstand von der Plattenmitte, positiv nach außen).
  function sideVerts(C, top) {
    const st = C.steps.filter(s => s.top === top);
    const total = C.t0 / 2 + (top ? C.hu : C.hl);
    const off = x => C.t0 / 2 + st.reduce((a, s) => a + (x < s.pos - 1e-9 ? s.h : 0), 0);
    // Nasenspitze auf der Mitte der Grundplatte: so liegt die Sehne (Nase →
    // Endleistenmitte) in der Platte und das Profil wird beim Normieren nicht
    // verdreht — auch bei Stufen auf nur einer Seite.
    const V = [];
    if (C.nose === 'wedge') V.push({ x: 0, o: 0, sharp: true });
    else {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const u = (1 - Math.cos(Math.PI / 2 * i / n));      // an der Nasenspitze verdichtet
        V.push({ x: u * C.L, o: total * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))), sharp: false });
      }
    }
    V.push({ x: C.L, o: total, sharp: C.nose === 'wedge' });
    const xa = 1 - C.teLen;
    const ev = st.map(s => ({ x: s.pos, step: true }));
    C.kinks.forEach(k => ev.push({ x: k.pos }));
    if (C.teLen > 0) ev.push({ x: xa });
    ev.sort((a, b) => a.x - b.x || (a.step ? 1 : -1));
    ev.forEach(e => {
      if (e.step) { V.push({ x: e.x, o: off(e.x - 1e-6), sharp: true }); V.push({ x: e.x, o: off(e.x + 1e-6), sharp: true }); }
      else V.push({ x: e.x, o: off(e.x + 1e-6), sharp: true });
    });
    V.push({ x: 1, o: C.teLen > 0 ? C.teThick / 2 : off(1), sharp: true });
    return V;
  }

  // Eckenliste verdichten: gerade Stücke in höchstens `step` langen Schritten,
  // an scharfen Ecken zusätzlich je ein Punkt im Abstand eps davor/dahinter.
  function densify(V, step, eps) {
    const out = [];
    for (let i = 0; i < V.length - 1; i++) {
      const a = V[i], b = V[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      out.push({ x: a.x, y: a.y });
      if (len < 1e-9) continue;
      const at = d => out.push({ x: a.x + dx * d / len, y: a.y + dy * d / len });
      const e = len > 4 * eps ? eps : 0;
      if (a.sharp && e) at(e);
      const n = Math.ceil(len / step);
      for (let k = 1; k < n; k++) { const d = len * k / n; if (d > 2 * e && d < len - 2 * e) at(d); }
      if (b.sharp && e) at(len - e);
    }
    const z = V[V.length - 1]; out.push({ x: z.x, y: z.y });
    return out;
  }

  function build(P) {
    const C = clean(P || {});
    const cam = camberFn(C.kinks);
    const side = top => {
      const V = sideVerts(C, top).map(v => ({ x: v.x, y: cam(v.x) + (top ? v.o : -v.o), sharp: v.sharp }));
      return densify(V, 0.02, 0.0012);
    };
    const up = side(true), lo = side(false);
    const pts = up.slice().reverse().concat(lo.slice(1));
    pts.name = autoName(P);
    return pts;
  }

  // Namensvorschlag aus den Maßen, z. B. „KFm2 6% (50)".
  function autoName(P) {
    const C = clean(P || {});
    const f = v => String(+(v * 100).toFixed(1));
    let n = (P && P.base) || 'KFm';
    n += ' ' + f(C.t0 + C.hu + C.hl) + '%';
    if (C.steps.length) n += ' (' + C.steps.map(s => (s.top ? 'o' : 'u') + f(s.pos)).join(' ') + ')';
    if (C.kinks.length) n += ' K' + C.kinks.map(k => f(k.pos) + '/' + (+k.ang.toFixed(1)) + '°').join(' ');
    return n;
  }

  // Abgeleitete Maße für die Anzeige (Sehnenanteile).
  function info(P) {
    const C = clean(P || {});
    return { total: C.t0 + C.hu + C.hl, top: C.hu, bot: C.hl, base: C.t0, noseLen: C.L,
      te: C.teLen > 0 ? C.teThick : C.t0, steps: C.steps.length, kinks: C.kinks.length };
  }

  window.KFm = { PRESETS, defaults, build, autoName, info };
})();

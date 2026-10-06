/* Ansichtswürfel (ViewCube) für alle 3D-Ansichten.
 * Eigenes kleines Canvas oben rechts über dem 3D-Canvas (gleicher offsetParent,
 * daher mit Fenstern/Dialogen richtig überdeckt). Jede Fläche ist in 3×3 Felder
 * geteilt: Mitte = Fläche, Ränder = Kante, Ecken = Würfelecke. Klick dreht die
 * Kamera animiert senkrecht auf dieses Feld, Ziehen auf dem Würfel dreht frei.
 *
 * ViewCube.attach({
 *   canvas: () => HTMLCanvasElement,     // 3D-Canvas (bei jedem Frame neu geholt)
 *   get: () => ({ yaw, pitch }), set: (yaw, pitch) => {}, redraw: () => {},
 *   rot: (v, yaw, pitch) => [x, yOben, z],  // Welt-Richtung -> Kamera, wie die Ansicht selbst
 *   k: [kYaw, kPitch],                   // Ziehfaktoren je Pixel (Vorzeichen wie die Ansicht)
 *   labels: { '+x': 'Endleiste', ... },  // Beschriftung je Weltachse
 *   active: () => true,                  // optional: nur in bestimmten Modi zeigen
 *   reset: () => {}                      // optional: „Ansicht wiederherstellen“ (⌂-Knopf + Pos1-Taste)
 * })
 * ViewCube.home({ canvas, reset, active })  // nur der ⌂-Knopf, für 3D-Ansichten ohne Würfel
 */
(function () {
  'use strict';
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  const SIZE = 104, SZ = 25, CUT = 0.6;   // Canvasgröße (CSS-px), halbe Würfelkante (px), Feldgrenze
  const HOME = 24;                        // ⌂-Knopf „Ansicht wiederherstellen“ (CSS-px)
  const FACES = [
    { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], k: '+x' }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], k: '-x' },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], k: '+y' }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], k: '-y' },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], k: '+z' }, { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], k: '-z' }
  ];
  const DEF_LABELS = { '+x': '+X', '-x': '−X', '+y': 'Oben', '-y': 'Unten', '+z': '+Z', '-z': '−Z' };
  const BANDS = [[-1, -CUT, -1], [-CUT, CUT, 0], [CUT, 1, 1]];   // [von, bis, Richtungsanteil]
  const cubes = [];

  const wrapPi = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const col = (name, def) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || def; } catch (e) { return def; } };

  // Blickrichtung des Betrachters im Kameraraum: +z bei echter Drehung, −z bei gespiegelter Achsfolge.
  function viewerSign(o, yaw, pitch) {
    const a = o.rot([1, 0, 0], yaw, pitch), b = o.rot([0, 1, 0], yaw, pitch), c = o.rot([0, 0, 1], yaw, pitch);
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    return det < 0 ? -1 : 1;
  }

  // Kamera (yaw, pitch), bei der die Richtung n genau zum Betrachter zeigt – numerisch,
  // damit jede Ansicht ihre eigene Drehformel behalten kann.
  function solve(o, n, cur) {
    const L = Math.hypot(n[0], n[1], n[2]); n = n.map(x => x / L);
    const sg = viewerSign(o, cur.yaw, cur.pitch);
    const err = (y, p) => 1 - sg * o.rot(n, y, p)[2];
    const pref = (y, p) => Math.abs(wrapPi(y - cur.yaw)) + Math.abs(p - Math.asin(Math.max(-1, Math.min(1, Math.sin(cur.pitch)))));
    let by = cur.yaw, bp = 0, be = 9, bpref = 9;
    const D = Math.PI / 180;
    for (let i = -180; i < 180; i++) for (let j = -90; j <= 90; j++) {
      const y = i * D, p = j * D, e = err(y, p);
      if (e < be - 1e-9 || (e < be + 1e-9 && pref(y, p) < bpref)) { be = e; by = y; bp = p; bpref = pref(y, p); }
    }
    for (let st = D / 4; st > 1e-7; st /= 8) {
      let cy = by, cp = bp;
      for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
        const y = cy + i * st, p = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cp + j * st)), e = err(y, p);
        if (e < be - 1e-12) { be = e; by = y; bp = p; }
      }
    }
    // Senkrecht von oben/unten ist der Drehwinkel frei: aktuellen beibehalten.
    if (Math.abs(Math.abs(bp) - Math.PI / 2) < 1e-4) { bp = Math.sign(bp) * Math.PI / 2; if (err(cur.yaw, bp) < 1e-6) by = cur.yaw; }
    const snap = a => { for (const s of [Math.PI / 4, Math.atan(Math.SQRT1_2)]) { const r = Math.round(a / s) * s; if (Math.abs(a - r) < 1e-4) return r; } return a; };
    by = snap(by); bp = snap(bp);
    by = cur.yaw + wrapPi(by - cur.yaw);                        // kürzester Weg
    bp += 2 * Math.PI * Math.round((cur.pitch - bp) / (2 * Math.PI));
    return { yaw: by, pitch: bp };
  }

  function animateTo(c, tgt) {
    const o = c.o, s = o.get(), y0 = s.yaw, p0 = s.pitch, t0 = performance.now(), dur = 280;
    c.anim = true;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      o.set(y0 + (tgt.yaw - y0) * e, p0 + (tgt.pitch - p0) * e); o.redraw();
      if (t < 1) requestAnimationFrame(step); else c.anim = false;
    };
    requestAnimationFrame(step);
  }

  // Sichtbare Felder in Zeichenreihenfolge (hinten zuerst), je mit Bildschirmpolygon.
  function cells(c) {
    const o = c.o, s = o.get(), sg = viewerSign(o, s.yaw, s.pitch), m = SIZE / 2;
    const pr = v => { const r = o.rot(v, s.yaw, s.pitch); return { x: m + r[0] * SZ, y: m - r[1] * SZ }; };
    const out = [];
    for (const f of FACES) {
      const d = sg * o.rot(f.n, s.yaw, s.pitch)[2]; if (d <= 0.01) continue;
      const P = (a, b) => pr([f.n[0] + f.u[0] * a + f.v[0] * b, f.n[1] + f.u[1] * a + f.v[1] * b, f.n[2] + f.u[2] * a + f.v[2] * b]);
      const sub = [];
      for (const A of BANDS) for (const B of BANDS) {
        const dir = [f.n[0] + f.u[0] * A[2] + f.v[0] * B[2], f.n[1] + f.u[1] * A[2] + f.v[1] * B[2], f.n[2] + f.u[2] * A[2] + f.v[2] * B[2]];
        sub.push({ dir, key: dir.join(','), P: [P(A[0], B[0]), P(A[1], B[0]), P(A[1], B[1]), P(A[0], B[1])] });
      }
      out.push({ f, d, P: [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], c: pr(f.n), sub });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  const inPoly = (P, x, y) => { let r = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) r = !r; return r; };
  function hit(c, x, y) {
    const cs = cells(c);
    for (let k = cs.length - 1; k >= 0; k--) if (inPoly(cs[k].P, x, y)) return cs[k].sub.find(q => inPoly(q.P, x, y)) || null;
    return null;
  }

  function paint(c) {
    const cv = c.el, dpr = window.devicePixelRatio || 1, ctx = cv.getContext('2d');
    if (cv.width !== Math.round(SIZE * dpr)) { cv.width = cv.height = Math.round(SIZE * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, SIZE, SIZE);
    const fg = col('--txt', '#dde'), line = col('--line', '#667'), labels = Object.assign({}, DEF_LABELS, c.o.labels || {});
    ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const q of cells(c)) {
      ctx.beginPath(); q.P.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = 'hsla(210,25%,' + Math.round(30 + 32 * q.d) + '%,.92)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = line; ctx.stroke();
      const hv = c.hover && q.sub.find(s => s.key === c.hover);
      if (hv) {
        ctx.beginPath(); hv.P.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
        ctx.fillStyle = 'rgba(90,160,255,.75)'; ctx.fill();
      }
      const t = T(labels[q.f.k] || '');
      ctx.font = 'bold ' + (t.length > 7 ? 8 : 9) + 'px system-ui';
      ctx.fillStyle = fg; ctx.globalAlpha = Math.min(1, 0.25 + q.d); ctx.fillText(t, q.c.x, q.c.y); ctx.globalAlpha = 1;
    }
  }

  function place(c) {
    const cv = c.o.canvas && c.o.canvas();
    const mw = c.el ? 2 * SIZE : 4 * HOME, mh = c.el ? SIZE : 2 * HOME;
    const show = !!(cv && cv.offsetParent && cv.clientWidth > mw && cv.clientHeight > mh && (!c.o.active || c.o.active()));
    c.cv = show ? cv : null;
    if (!show) {
      if (c.el && c.el.style.display !== 'none') c.el.style.display = 'none';
      if (c.home && c.home.style.display !== 'none') c.home.style.display = 'none';
      return;
    }
    const right = cv.offsetLeft + cv.clientWidth - 4, top = cv.offsetTop + 4;
    if (c.home) {
      // ⌂ links neben dem Würfel (ohne Würfel: in der Ecke oben rechts)
      if (c.home.parentNode !== cv.parentNode) cv.parentNode.insertBefore(c.home, cv.nextSibling);
      const l = right - (c.el ? SIZE : 0) - HOME + 'px', t = top + 'px';
      if (c.home.style.left !== l) c.home.style.left = l;
      if (c.home.style.top !== t) c.home.style.top = t;
      if (c.home.style.display === 'none') c.home.style.display = '';
    }
    if (!c.el) return;
    if (c.el.parentNode !== cv.parentNode) cv.parentNode.insertBefore(c.el, cv.nextSibling);
    const l = right - SIZE + 'px', t = top + 'px';
    if (c.el.style.left !== l) c.el.style.left = l;
    if (c.el.style.top !== t) c.el.style.top = t;
    if (c.el.style.display === 'none') { c.el.style.display = ''; c.sig = ''; }
    const s = c.o.get(), sig = s.yaw.toFixed(4) + '|' + s.pitch.toFixed(4) + '|' + c.hover;
    if (sig !== c.sig) { c.sig = sig; paint(c); }
  }
  function loop() { for (const c of cubes) { try { place(c); } catch (e) { /* Ansicht noch nicht bereit */ } } requestAnimationFrame(loop); }

  // ⌂-Knopf „Ansicht wiederherstellen“: setzt Drehung, Zoom, Verschiebung und Drehpunkt
  // der Ansicht auf den Ausgangszustand (o.reset). Pos1 über dem 3D-Bild tut dasselbe.
  function doReset(c) { try { c.o.reset(); if (c.o.redraw) c.o.redraw(); } catch (e) { /* Ansicht noch nicht bereit */ } }
  function mkHome(c) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vc-home'; b.textContent = '⌂';
    b.title = T('Ansicht wiederherstellen: Standard-Schrägansicht, Zoom, Verschiebung und Drehpunkt zurücksetzen (Pos1)');
    b.style.cssText = 'position:absolute;width:' + HOME + 'px;height:' + HOME + 'px;padding:0;z-index:6;display:none;font-size:15px;line-height:1;opacity:.85';
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('dblclick', e => e.stopPropagation());
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); doReset(c); });
    return b;
  }
  function track(c) {
    cubes.push(c);
    if (cubes.length === 1) {
      requestAnimationFrame(loop);
      // Pos1 über einer sichtbaren 3D-Ansicht (nicht beim Tippen in Feldern)
      let mx = -1, my = -1;
      window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
      window.addEventListener('keydown', e => {
        if (e.key !== 'Home' || e.ctrlKey || e.altKey || e.metaKey) return;
        const a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
        for (const q of cubes) {
          if (!q.home || !q.cv) continue;
          const r = q.cv.getBoundingClientRect();
          if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) { e.preventDefault(); doReset(q); return; }
        }
      });
    }
  }
  function home(o) {
    const c = { o, el: null, home: null };
    c.home = mkHome(c);
    track(c);
    return c;
  }

  function attach(o) {
    const el = document.createElement('canvas');
    el.className = 'viewcube';
    el.title = T('Ansichtswürfel: Klick auf Fläche/Kante/Ecke = Ansicht, Ziehen = drehen');
    el.style.cssText = 'position:absolute;width:' + SIZE + 'px;height:' + SIZE + 'px;z-index:5;cursor:pointer;display:none;touch-action:none';
    const c = { o, el, hover: null, sig: '', anim: false };
    const loc = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let drag = null;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    });
    el.addEventListener('pointermove', e => {
      if (!drag) { const q = loc(e), h = hit(c, q.x, q.y); const k = h ? h.key : null; if (k !== c.hover) { c.hover = k; } return; }
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
      drag.moved = true; el.style.cursor = 'grabbing';
      const s = o.get(), k = o.k || [-0.01, -0.01];
      o.set(s.yaw + dx * k[0] * (Math.cos(s.pitch) < 0 ? -1 : 1), s.pitch + dy * k[1]); o.redraw();
    });
    el.addEventListener('pointerup', e => {
      if (!drag) return;
      const moved = drag.moved; drag = null; el.style.cursor = 'pointer';
      if (moved || c.anim) return;
      const q = loc(e), h = hit(c, q.x, q.y);
      if (h) animateTo(c, solve(o, h.dir, o.get()));
    });
    el.addEventListener('pointerleave', () => { if (!drag) c.hover = null; });
    el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('dblclick', e => e.stopPropagation());
    if (o.reset) c.home = mkHome(c);
    track(c);
    return c;
  }

  // Übliche Drehformeln der Ansichten.
  const ROT_STD = (v, yaw, pitch) => {   // model3d, sim3d, formenbau, rumpf
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  // Mausrad-Doppelklick (zweimal mittlere Taste ≤ 450 ms, ≤ 6 px auseinander) auf dem
  // 3D-Canvas: fn(x, y, e) mit Canvas-Koordinaten (CSS-px). Liefert fn true, wird der
  // zweite Druck verschluckt (kein Verschieben-Start). Läuft in der Capture-Phase, also
  // vor den eigenen mousedown-Handlern der Ansicht; unterdrückt das Browser-Autoscroll.
  function midDbl(cv, fn) {
    if (!cv || cv._midDbl) return; cv._midDbl = true;
    let t = 0, x0 = 0, y0 = 0;
    cv.addEventListener('mousedown', e => {
      if (e.button !== 1) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now();
      if (now - t < 450 && Math.hypot(x - x0, y - y0) <= 6) {
        t = 0;
        if (fn(x, y, e)) { e.stopImmediatePropagation(); }
        return;
      }
      t = now; x0 = x; y0 = y;
    }, true);
    cv.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  }
  // Nächster Punkt in r px Umkreis um (x, y). each(cb) ruft cb(wx, wy, wz) für jeden
  // Kandidaten auf, proj(wx, wy, wz) -> { x, y, d? } (d = Tiefe, kleiner = vorne).
  function pickNear(x, y, each, proj, r) {
    let dm = r || 14, best = null, bd = Infinity;
    each((a, b, c) => {
      const q = proj(a, b, c); if (!q || !isFinite(q.x) || !isFinite(q.y)) return;
      const dd = Math.hypot(q.x - x, q.y - y), dz = q.d == null ? 0 : q.d;
      if (dd < dm - 3 || (dd <= dm + 3 && dz < bd)) { dm = Math.min(dm, dd); bd = dz; best = [a, b, c]; }
    });
    return best;
  }
  // Markierung des gesetzten Drehpunkts (gelbes Fadenkreuz wie im Formenbau).
  function drawPivot(ctx, x, y) {
    if (!ctx || !isFinite(x) || !isFinite(y)) return;
    ctx.save(); ctx.strokeStyle = 'rgba(255,220,80,.9)'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); ctx.restore();
  }
  window.ViewCube = { attach, home, ROT_STD, solve, midDbl, pickNear, drawPivot };
})();

/* bibliothek.js — Reiter „Projektbibliothek" (optionales Feature `bibliothek`, Tab `bib`)
 *
 * 1. Mitgelieferte Vorlagen (Segler, Nurflügel, Pylon, Trainer, Testflügel): werden per
 *    App.newProject(true) + eigene Wurzel/Segmente erzeugt — kein fertiges JSON, damit sie mit
 *    jedem Programmstand zusammenpassen.
 * 2. Eigene Bibliothek: aktuelles Projekt (App.projectData(), Dateiformat v5) mit Name, Kategorie,
 *    Beschreibung in IndexedDB ablegen (maschinenweit, nicht im Projekt); öffnen (App.loadProject),
 *    umbenennen, löschen, als .json exportieren, .json-Projekte importieren.
 * Vorschaubild = Grundriss aus Wurzel + Segmenten (SVG), auch für gespeicherte Projekte.
 * Andere Module rufen nur geschützt (window.Bibliothek, App.bibSidebar).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DEG = Math.PI / 180;
  const isOpen = () => state.activeTab === 'bib';

  // ---------- Vorlagen ----------
  // seg: [Sehne außen, Spannweite, Pfeilung (mm Nasenversatz), Schränkung °, V-Form mm, NACA außen]
  const TPL = [
    { id: 'segler2m', name: 'Segler 2 m (dreifach Trapez)', cat: 'Segler', root: [210, '2411'],
      segs: [[200, 400, 3, 0, 15, '2411'], [165, 380, 12, -0.5, 30, '2410'], [95, 220, 30, -1.5, 30, '2409']],
      desc: 'Thermiksegler, Halbspannweite 1000 mm, Streckung ≈ 11. Kerne in Styrodur, Beplankung Abachi oder Glas/Kohle in der Negativschale.' },
    { id: 'nurfl12', name: 'Nurflügel 1,2 m (gepfeilt)', cat: 'Nurflügel', root: [260, '0012'],
      segs: [[200, 330, 150, -2, 15, '0011'], [140, 270, 140, -3, 15, '0010']],
      desc: 'Gepfeilter Nurflügel, 25–30° Pfeilung, Schränkung −5° bis zur Spitze. Profil gegen ein S-Schlag-Profil aus der Profildatenbank tauschen.' },
    { id: 'pylon1m', name: 'Speed/Pylon 1 m', cat: 'Speed', root: [190, '0009'],
      segs: [[150, 300, 25, 0, 5, '0009'], [95, 200, 45, 0, 5, '0008']],
      desc: 'Dünnes symmetrisches Profil, kleine Fläche; Kern in Rohacell oder EPS 30, Schale Kohle in der Negativform.' },
    { id: 'trainer16', name: 'Trainer/Motorsegler 1,6 m', cat: 'Motormodell', root: [230, '4412'],
      segs: [[230, 450, 0, 0, 25, '4412'], [150, 350, 40, -1, 45, '4411']],
      desc: 'Gutmütiger Trainer: Rechteck innen, Trapez außen, gewölbtes Profil. Ideal für die ersten beplankten Styroporflächen.' },
    { id: 'testflg', name: 'Testflügel (erster Schnitt)', cat: 'Einstieg', root: [200, '2412'],
      segs: [[200, 400, 0, 0, 0, '2412']],
      desc: 'Rechteckflügel 400 mm für den ersten Schnitt: Abbrand, Vorschub und Heizung kalibrieren, bevor teurer Werkstoff dran ist.' }
  ];

  function applyTemplate(t) {
    if (!App.newProject) return;
    const busy = state.segments.length > 1 || state.projectName;
    if (busy && !confirm(T('Vorlage öffnen? Das aktuelle Projekt wird verworfen (vorher speichern!).'))) return;
    App.newProject(true);
    state.root.chord = t.root[0];
    state.root.profile = Airfoil.naca4(t.root[1], 100);
    state.segments = t.segs.map(s => App.mkSeg({ chord: s[0], span: s[1], sweep: s[2], sweepMode: 'mm', washout: s[3], dih: s[4], dihMode: 'mm', profile: Airfoil.naca4(s[5], 100) }));
    if (App.resetWings) App.resetWings();
    if (App.setProjectName) App.setProjectName(T(t.name));
    if (App.recompute) App.recompute();
    if (App.buildSidebar) App.buildSidebar();
    if (App.render) App.render();
    toast(T('Vorlage geladen:') + ' ' + T(t.name));
    if (App.switchView) App.switchView('wing');
  }

  // ---------- Grundriss-Vorschau ----------
  // Aus {root:{chord}, segments:[{chord,span,sweep,sweepMode}]} (State oder Projektdatei).
  function planSvg(root, segs, w, h) {
    if (!root || !segs || !segs.length) return '<svg width="' + w + '" height="' + h + '"></svg>';
    const P = [[0, 0, +root.chord || 0]];   // [z, le, chord]
    let z = 0, le = 0;
    segs.forEach(s => {
      const sp = +s.span || 0;
      const sw = s.sweepMode === 'deg' ? Math.tan((+s.sweep || 0) * DEG) * sp : (+s.sweep || 0);
      z += sp; le += sw; P.push([z, le, +s.chord || 0]);
    });
    const L = z || 1, xMin = Math.min(...P.map(p => p[1])), xMax = Math.max(...P.map(p => p[1] + p[2]));
    // ganze Fläche (beide Hälften) zeigen
    const W = 2 * L, H = Math.max(1, xMax - xMin), sc = Math.min((w - 10) / W, (h - 10) / H);
    const ox = w / 2, oy = (h - H * sc) / 2 - xMin * sc;
    const pt = (zz, x) => (ox + zz * sc).toFixed(1) + ',' + (oy + x * sc).toFixed(1);
    const half = sgn => P.map(p => pt(sgn * p[0], p[1])).concat(P.slice().reverse().map(p => pt(sgn * p[0], p[1] + p[2]))).join(' ');
    const ribs = P.map(p => [1, -1].map(sg => '<line x1="' + pt(sg * p[0], p[1]).replace(',', '" y1="') + '" x2="' + pt(sg * p[0], p[1] + p[2]).replace(',', '" y2="') + '"/>').join('')).join('');
    return '<svg class="bib-plan" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
      + '<polygon points="' + half(1) + '"/><polygon points="' + half(-1) + '"/><g class="rb">' + ribs + '</g></svg>';
  }
  function stats(root, segs) {
    let L = 0, A = 0, c0 = +root.chord || 0;
    segs.forEach(s => { const sp = +s.span || 0, c1 = +s.chord || 0; L += sp; A += sp * (c0 + c1) / 2; c0 = c1; });
    const b = 2 * L, S = 2 * A;
    return { b, S, AR: S > 0 ? b * b / S : 0, n: segs.length };
  }
  const statTxt = st => T('Spannweite') + ' ' + Math.round(st.b) + ' mm · ' + (st.S / 1e4).toFixed(1) + ' dm² · Λ ' + st.AR.toFixed(1) + ' · ' + st.n + ' ' + T('Segm.');

  // ---------- Eigene Bibliothek (IndexedDB) ----------
  const DB = 'aifc_bibliothek', STORE = 'proj';
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      let r; try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); t.onerror = () => rej(t.error);
    });
  }
  const dbAll = () => tx('readonly', s => s.getAll());
  const dbPut = rec => tx('readwrite', s => s.put(rec));
  const dbDel = id => tx('readwrite', s => s.delete(id));
  const dbGet = id => tx('readonly', s => s.get(id));

  let items = [], filter = '', catSel = '';
  async function reload() { try { items = (await dbAll()) || []; } catch (e) { items = []; console.warn('Bibliothek', e); } items.sort((a, b) => (b.t || 0) - (a.t || 0)); draw(); }

  function toast(m) { if (App.toast) App.toast(m); }
  function ask(label, def) { const v = prompt(T(label), def || ''); return v == null ? null : v.trim(); }

  async function addCurrent() {
    if (!App.projectData) return;
    const name = ask('Name in der Bibliothek:', state.projectName || T('Projekt')); if (!name) return;
    const cat = ask('Kategorie (z. B. Segler, Nurflügel, Rumpf):', catSel || ''); if (cat == null) return;
    const desc = ask('Kurzbeschreibung (optional):', ''); if (desc == null) return;
    const data = App.projectData();
    await dbPut({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, cat, desc, t: Date.now(), data });
    toast(T('In der Bibliothek abgelegt:') + ' ' + name); reload();
  }
  async function openItem(id) {
    const r = await dbGet(id); if (!r) return;
    if (!confirm(T('Projekt aus der Bibliothek öffnen? Das aktuelle Projekt wird ersetzt.'))) return;
    try { App.loadProject(JSON.stringify(r.data)); toast(T('Geöffnet:') + ' ' + r.name); } catch (e) { alert(e.message); }
  }
  async function editItem(id) {
    const r = await dbGet(id); if (!r) return;
    const name = ask('Name:', r.name); if (!name) return;
    const cat = ask('Kategorie:', r.cat); if (cat == null) return;
    const desc = ask('Beschreibung:', r.desc); if (desc == null) return;
    Object.assign(r, { name, cat, desc }); await dbPut(r); reload();
  }
  async function delItem(id) {
    const r = await dbGet(id); if (!r) return;
    if (!confirm(T('Aus der Bibliothek löschen?') + ' „' + r.name + '“')) return;
    await dbDel(id); reload();
  }
  async function exportItem(id) {
    const r = await dbGet(id); if (!r) return;
    const txt = JSON.stringify(r.data, null, 1), fn = r.name.replace(/[\\/:*?"<>|]+/g, '_') + '.json';
    if (App.download) App.download(fn, txt, 'application/json', 'svProject'); else if (App.anchorDownload) App.anchorDownload(fn, txt, 'application/json');
  }
  async function updateItem(id) {
    const r = await dbGet(id); if (!r || !App.projectData) return;
    if (!confirm(T('Eintrag mit dem aktuellen Projekt überschreiben?') + ' „' + r.name + '“')) return;
    r.data = App.projectData(); r.t = Date.now(); await dbPut(r); toast(T('Aktualisiert:') + ' ' + r.name); reload();
  }
  function importFiles() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.multiple = true;
    inp.onchange = async () => {
      let n = 0;
      for (const f of inp.files) {
        try {
          const d = JSON.parse(await f.text());
          if (!d || !d.root || !d.segments) throw new Error(T('keine Projektdatei'));
          await dbPut({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: d.projectName || f.name.replace(/\.json$/i, ''), cat: catSel || '', desc: '', t: Date.now(), data: d }); n++;
        } catch (e) { alert(f.name + ': ' + e.message); }
      }
      if (n) { toast(n + ' ' + T('Projekt(e) importiert.')); reload(); }
    };
    inp.click();
  }

  // ---------- Ansicht ----------
  function el() {
    const v = document.getElementById('bibView'); if (!v) return null;
    let r = v.querySelector('.holm-res');
    if (!r) { r = document.createElement('div'); r.className = 'holm-res'; v.appendChild(r); }
    return r;
  }
  function card(o) {
    const st = stats(o.root, o.segs);
    return '<div class="bib-card">' + planSvg(o.root, o.segs, 240, 110)
      + '<div class="bib-n">' + esc(o.name) + '</div>'
      + (o.cat ? '<div class="bib-cat">' + esc(o.cat) + '</div>' : '')
      + '<div class="bib-s">' + esc(statTxt(st)) + (o.when ? ' · ' + esc(o.when) : '') + '</div>'
      + (o.desc ? '<div class="bib-d">' + esc(o.desc) + '</div>' : '')
      + '<div class="bib-b">' + o.btns.map(b => '<button data-a="' + b[0] + '" data-id="' + esc(o.id) + '">' + esc(T(b[1])) + '</button>').join('') + '</div></div>';
  }
  function draw() {
    const r = el(); if (!r || !isOpen()) return;
    const f = filter.toLowerCase();
    const match = (n, c, d) => (!catSel || c === catSel) && (!f || (n + ' ' + c + ' ' + d).toLowerCase().indexOf(f) >= 0);
    const cats = Array.from(new Set(TPL.map(t => T(t.cat)).concat(items.map(i => i.cat).filter(Boolean)))).sort();
    let h = '<div class="bib-top"><input type="search" id="bibFind" placeholder="' + esc(T('Suchen …')) + '" value="' + esc(filter) + '">'
      + '<select id="bibCat"><option value="">' + esc(T('alle Kategorien')) + '</option>' + cats.map(c => '<option' + (c === catSel ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
      + '<button data-a="add">' + esc(T('Aktuelles Projekt ablegen')) + '</button><button data-a="imp">' + esc(T('.json importieren …')) + '</button></div>';
    h += '<h3 class="bib-h">' + esc(T('Meine Projekte')) + '</h3>';
    const mine = items.filter(i => i.data && match(i.name, i.cat || '', i.desc || ''));
    h += mine.length ? '<div class="bib-grid">' + mine.map(i => card({ id: i.id, name: i.name, cat: i.cat, desc: i.desc, root: i.data.root, segs: i.data.segments,
      when: new Date(i.t).toLocaleDateString(), btns: [['open', 'Öffnen'], ['upd', 'Überschreiben'], ['edit', 'Bearbeiten'], ['exp', 'Export'], ['del', 'Löschen']] })).join('') + '</div>'
      : '<div class="hint">' + esc(T(items.length ? 'Kein Treffer.' : 'Noch leer — „Aktuelles Projekt ablegen“ legt das offene Projekt hier ab (bleibt auf diesem Computer, unabhängig von der Projektdatei).')) + '</div>';
    h += '<h3 class="bib-h">' + esc(T('Vorlagen')) + '</h3>';
    const tp = TPL.filter(t => match(T(t.name), T(t.cat), T(t.desc)));
    h += '<div class="bib-grid">' + tp.map(t => card({ id: t.id, name: T(t.name), cat: T(t.cat), desc: T(t.desc),
      root: { chord: t.root[0] }, segs: t.segs.map(s => ({ chord: s[0], span: s[1], sweep: s[2] })), btns: [['tpl', 'Als neues Projekt öffnen']] })).join('') + '</div>';
    r.innerHTML = h;
    const fi = r.querySelector('#bibFind');
    fi.oninput = () => { filter = fi.value; const p = fi.selectionStart; draw(); const n = el().querySelector('#bibFind'); n.focus(); n.setSelectionRange(p, p); };
    r.querySelector('#bibCat').onchange = e => { catSel = e.target.value; draw(); };
    r.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
      const id = b.dataset.id, a = b.dataset.a;
      if (a === 'add') addCurrent(); else if (a === 'imp') importFiles();
      else if (a === 'tpl') { const t = TPL.find(x => x.id === id); if (t) applyTemplate(t); }
      else if (a === 'open') openItem(id); else if (a === 'upd') updateItem(id); else if (a === 'edit') editItem(id);
      else if (a === 'exp') exportItem(id); else if (a === 'del') delItem(id);
    });
  }

  function bibSidebar(side) {
    const { grp, hint, mkMini } = App;
    const g = grp('Projektbibliothek', true, 'bib'); side.appendChild(g.g || g);
    const body = g.body || g.querySelector('.body');
    hint(body, 'Eigene Projekte als Bausteine sammeln und Vorlagen als Startpunkt öffnen. Die Bibliothek liegt im Browser-Speicher dieses Computers — zum Sichern einzeln exportieren.');
    const bb = document.createElement('div'); bb.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    bb.appendChild(mkMini(T('Aktuelles Projekt ablegen'), addCurrent));
    bb.appendChild(mkMini(T('.json importieren …'), importFiles));
    body.appendChild(bb);
  }

  function show() { reload(); }
  Object.assign(App, { bibSidebar });
  window.Bibliothek = { show, refresh: show, templates: () => TPL.slice(), planSvg, _test: { applyTemplate, stats } };
})();

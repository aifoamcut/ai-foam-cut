/* bauanleitung.js — Reiter „Bauanleitung" (optionales Feature `bauanleitung`, Tab `bau`)
 *
 * Erzeugt aus dem Projekt eine druckbare Bauanleitung (Drucken → PDF, oder HTML speichern):
 *   - Kopf: Projektname, Datum, Grundriss (Bibliothek.planSvg, sonst eigener), Kenndaten,
 *   - automatische Kapitel je nach vorhandenen Daten: Tragflächen (Segmenttabelle, Profile),
 *     Styroporblöcke, Kerne schneiden, Negativschalen, Holme, Laminierplan (window.Laminat),
 *     Rippen, Gewicht — jedes ein-/ausschaltbar, mit eigener Notiz und Bild,
 *   - eigene Schritte (Titel, Text, Bild) in frei wählbarer Reihenfolge.
 * Bilder: „Ansicht einfügen" schaltet kurz auf den gewählten Reiter, nimmt die größte sichtbare
 * Zeichenfläche (Canvas, sonst SVG) als JPEG und kehrt zurück; oder Bilddatei laden.
 * Daten projektweit in state.cfg.bau. Andere Module rufen nur geschützt (window.Bauanleitung).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f0 = v => String(Math.round(v)), f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const DEG = Math.PI / 180;
  const isOpen = () => state.activeTab === 'bau';

  function cfg() {
    let c = state.cfg.bau;
    if (!c || typeof c !== 'object') c = state.cfg.bau = {};
    if (!c.auto || typeof c.auto !== 'object') c.auto = {};
    if (!Array.isArray(c.steps)) c.steps = [];
    if (c.author == null) c.author = '';
    if (c.intro == null) c.intro = '';
    return c;
  }
  const autoOf = k => { const a = cfg().auto; return a[k] || (a[k] = { on: true, note: '', img: null }); };

  // ---------- Daten aus dem Projekt ----------
  const segSweep = s => s.sweepMode === 'deg' ? Math.tan((+s.sweep || 0) * DEG) * (+s.span || 0) : (+s.sweep || 0);
  function wingRows() {
    const cf = state.cfg; let c0 = +state.root.chord || 0, p0 = (state.root.profile && state.root.profile.name) || '', z = 0;
    return state.segments.map((s, i) => {
      z += +s.span || 0;
      const r = { i: i + 1, span: +s.span || 0, z, c0, c1: +s.chord || 0, sw: segSweep(s), dih: s.dihMode === 'deg' ? f1(+s.dih || 0) + '°' : f0(+s.dih || 0) + ' mm', wo: +s.washout || 0, p0, p1: (s.profile && s.profile.name) || '',
        bl: Math.max(c0, +s.chord || 0) + Math.abs(segSweep(s)) + (+s.bLE || 0) + (+s.bTE || 0), bh: App.blockH ? safe(() => App.blockH(cf.design === 'neg' ? 'neg' : 'core', i), +s.blockH || 0) : (+s.blockH || 0) };
      c0 = r.c1; p0 = r.p1; return r;
    });
  }
  const safe = (fn, d) => { try { const v = fn(); return v == null || isNaN(v) ? d : v; } catch (e) { return d; } };
  function planSvg(w, h) {
    if (window.Bibliothek && Bibliothek.planSvg) return Bibliothek.planSvg(state.root, state.segments, w, h);
    return '';
  }
  const matName = () => { try { const id = App.matIdFor && App.matIdFor(state.cfg.design === 'neg' ? 'neg' : undefined); return id && App.matField ? T(App.matField(id, 'name', id)) : ''; } catch (e) { return ''; } };

  // Automatische Kapitel: [key, Titel, Bedingung, Inhalt-HTML, Vorschlag-Reiter für das Bild]
  function chapters() {
    const W = wingRows(), cf = state.cfg, list = [];
    const tab = (head, rows) => '<table class="ba-t"><tr>' + head.map(h => '<th>' + esc(T(h)) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</table>';
    const nh = Math.max(1, Math.round(+cf.wtCount || 2));
    list.push(['wing', 'Tragfläche: Geometrie', true,
      tab(['Segm.', 'Spannweite', 'bis', 'Sehne innen', 'Sehne außen', 'Pfeilung', 'V-Form', 'Schränkung', 'Profil innen', 'Profil außen'],
        W.map(r => [r.i, f0(r.span), f0(r.z), f0(r.c0), f0(r.c1), f0(r.sw), r.dih, f1(r.wo) + '°', r.p0, r.p1]))
      + '<p>' + esc(T('Maße in mm, je Hälfte. Anzahl Hälften:')) + ' ' + nh + '.</p>', 'wing']);
    list.push(['blocks', 'Styroporblöcke zuschneiden', true,
      tab(['Segm.', 'Länge (Spannweite)', 'Breite (Sehne + Zugaben)', 'Höhe', 'Stück'], W.map(r => [r.i, f0(r.span), f0(r.bl), f0(r.bh), nh]))
      + (matName() ? '<p>' + esc(T('Werkstoff:')) + ' ' + esc(matName()) + '</p>' : '')
      + '<p>' + esc(T('Blöcke rechtwinklig und mit etwas Übermaß zuschneiden; Spannweitenrichtung anzeichnen. Vor dem Schnitt Werkstoff, Abbrand und Vorschub in der Werkstoffzuordnung prüfen.')) + '</p>', 'material']);
    list.push(['cut', 'Kerne schneiden', true,
      '<ol>' + W.map(r => '<li>' + esc(T('Segment')) + ' ' + r.i + ': ' + esc(T('G-Code erzeugen (Reiter G-Code), Block ausrichten, Draht auf Temperatur, Schnitt starten.')) + '</li>').join('') + '</ol>'
      + '<p>' + esc(T('Kerne und Abfallstücke (Schalen) beschriften — die Schalen dienen beim Beplanken/Laminieren als Pressform.')) + '</p>', 'core']);
    if (cf.design === 'neg' || cf.gcodeSource === 'neg')
      list.push(['neg', 'Negativschalen schneiden', true, '<p>' + esc(T('Ober- und Unterschale nach dem Negativschalendesign schneiden; Innenflächen glätten, trennen (Folie/Trennmittel). Stege und Holm-Aussparungen prüfen.')) + '</p>', 'neg']);
    if ((state.spars && state.spars.length) || cf.holm) {
      let txt = '<p>' + esc(T('Holmaussparungen:')) + ' ' + ((state.spars && state.spars.length) || 0) + '.</p>';
      if (window.Holm && Holm.compute && cf.holm) {
        const R = safe(() => window.Holm.compute(), null);
        if (R && !R.err && R.cutT) txt += tab(['Bauteil', 'Lagen', 'Längen (mm)'], [
          [T('Obergurt') + ' (' + (R.capM ? R.capM.name : '') + ')', R.cutT.length, R.cutT.map(q => f0(q.len)).join(', ')],
          [T('Untergurt'), R.cutB.length, R.cutB.map(q => f0(q.len)).join(', ')],
          [T('Holmsteg'), R.cutW.length, R.cutW.map(q => f0(q.len)).join(', ')]]) + (R.mass ? '<p>' + esc(T('Strukturmasse je Hälfte ca.')) + ' ' + f0(R.mass.total) + ' g</p>' : '');
      }
      list.push(['holm', 'Holm einbauen', true, txt, 'holm']);
    }
    if (window.Laminat && Laminat.compute) {
      const R = safe(() => Laminat.compute(), null);
      if (R && !R.err && R.pieces.length) {
        list.push(['lam', 'Laminieren', true,
          tab(['Teil', 'Gewebe', 'Seite', 'Faser', 'Stück', 'Länge'], R.pieces.map(p => [p.name, T(p.fab.name), p.side === 'top' ? T('oben') : T('unten'), p.ori ? '±45°' : '0/90°', p.qty, f0(p.len)]))
          + '<p>' + esc(T('Harz gesamt ca.')) + ' ' + f0(R.gResin) + ' g · ' + esc(T('Topfzeit')) + ' ' + R.c.pot + ' min · ' + esc(T('Laminierzeit je Durchgang ca.')) + ' ' + f0(R.tTot) + ' min</p>'
          + '<ol>' + R.lay.map(q => '<li>' + esc(q.name) + ' — ' + esc(T(q.fab)) + '</li>').join('') + '</ol>', 'lam']);
      }
    }
    if (cf.rib && typeof cf.rib === 'object') list.push(['rib', 'Rippen', true, '<p>' + esc(T('Rippen nach dem Rippendesign ausgeben (DXF/Fräse/Laser), entgraten und nummerieren.')) + '</p>', 'rib']);
    if (App.wingWeight || cf.wtCount) list.push(['weight', 'Gewicht prüfen', true, '<p>' + esc(T('Teile wiegen und mit der Gewichtsschätzung der Projektübersicht vergleichen; Schwerpunkt vor dem Erstflug einstellen.')) + '</p>', 'material']);
    return list;
  }

  // ---------- Bilder ----------
  const TAB_LBL = () => Array.from(document.querySelectorAll('.tabs button[data-view]')).map(b => [b.dataset.view, b.textContent.trim()]).filter(x => x[0] !== 'bau');
  function shrink(src, w0, h0, maxW) {
    const s = Math.min(1, maxW / w0), c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  // zwei Bildwechsel abwarten; Rückfall per Zeitgeber, falls das Fenster verdeckt ist (rAF pausiert)
  const frame = () => new Promise(r => { let d = false; const ok = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(() => requestAnimationFrame(ok)); setTimeout(ok, 150); });
  async function grabView(view) {
    const back = state.activeTab;
    if (!App.switchView) return null;
    App.switchView(view); await frame(); await new Promise(r => setTimeout(r, 350)); await frame();
    if (App.refreshActiveView) { try { App.refreshActiveView(); } catch (e) {} }   // falls rAF des Reiterwechsels nicht lief
    await new Promise(r => setTimeout(r, 100));
    let url = null;
    try {
      const root = document.getElementById(view + 'View') || document.querySelector('.view.active') || document.body;
      const cv = Array.from(root.querySelectorAll('canvas')).filter(c => c.offsetWidth > 50 && c.offsetHeight > 50).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (cv) {
        // Mehrere übereinanderliegende Canvas (Overlay) zusammensetzen
        const box = cv.getBoundingClientRect(), all = Array.from(root.querySelectorAll('canvas')).filter(c => { const b = c.getBoundingClientRect(); return Math.abs(b.left - box.left) < 2 && Math.abs(b.top - box.top) < 2 && c.width > 0; });
        const comp = document.createElement('canvas'); comp.width = cv.width; comp.height = cv.height;
        const g = comp.getContext('2d'); g.fillStyle = getComputedStyle(document.body).backgroundColor || '#1b1f26'; g.fillRect(0, 0, comp.width, comp.height);
        all.forEach(c => { try { g.drawImage(c, 0, 0, comp.width, comp.height); } catch (e) {} });
        url = shrink(comp, comp.width, comp.height, 1400);
      } else {
        const sv = Array.from(root.querySelectorAll('svg')).filter(s => s.getBoundingClientRect().width > 80).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
        if (sv) url = await svgToJpeg(sv);
      }
    } catch (e) { console.warn('Bauanleitung: Bild', e); }
    App.switchView(back);
    if (!url) alert(T('In diesem Reiter wurde keine Zeichnung gefunden.'));
    return url;
  }
  function svgToJpeg(sv) {
    return new Promise(res => {
      const b = sv.getBoundingClientRect(), cl = sv.cloneNode(true);
      cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cl.setAttribute('width', b.width); cl.setAttribute('height', b.height);
      const st = document.createElement('style'); st.textContent = 'text{font:11px sans-serif;fill:#333}line,polyline,path,polygon{stroke-width:1}'; cl.insertBefore(st, cl.firstChild);
      const img = new Image();
      img.onload = () => res(shrink(img, b.width * 2, b.height * 2, 1400));
      img.onerror = () => res(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(cl));
    });
  }
  function pickFile() {
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const img = new Image(), u = URL.createObjectURL(f); img.onload = () => { res(shrink(img, img.naturalWidth, img.naturalHeight, 1400)); URL.revokeObjectURL(u); }; img.onerror = () => res(null); img.src = u; };
      inp.click();
    });
  }

  // ---------- Dokument ----------
  const DOC_CSS = 'body{font:11pt/1.45 "Segoe UI",Arial,sans-serif;color:#111;margin:0;background:#fff}'
    + '.ba-doc{max-width:180mm;margin:0 auto;padding:12mm 0}h1{font-size:22pt;margin:0 0 2mm}h2{font-size:14pt;margin:8mm 0 2mm;border-bottom:1px solid #999;padding-bottom:1mm;page-break-after:avoid}'
    + '.ba-meta{color:#555;font-size:10pt}.ba-t{border-collapse:collapse;font-size:9pt;margin:2mm 0;width:100%}.ba-t th,.ba-t td{border:1px solid #bbb;padding:1mm 2mm;text-align:left}.ba-t th{background:#eee}'
    + '.ba-img{max-width:100%;max-height:120mm;display:block;margin:3mm auto;border:1px solid #ccc}.ba-note{background:#f4f6f8;border-left:3px solid #5a8fd0;padding:2mm 3mm;white-space:pre-wrap}'
    + '.bib-plan{display:block;margin:4mm auto;max-width:100%;height:auto}.ba-doc{max-width:100%}.bib-plan polygon{fill:#dde8f5;stroke:#335;stroke-width:1}.bib-plan .rb line{stroke:#667;stroke-width:.6}.ba-sec{page-break-inside:avoid}'
    + '@media print{.ba-doc{padding:0}@page{size:A4;margin:15mm}}';
  function docHtml() {
    const c = cfg(), name = state.projectName || T('Projekt'), parts = [];
    let n = 0;
    const sec = (title, body, note, img) => { n++; parts.push('<div class="ba-sec"><h2>' + n + '. ' + esc(title) + '</h2>' + (body || '') + (img ? '<img class="ba-img" src="' + img + '">' : '') + (note ? '<div class="ba-note">' + esc(note) + '</div>' : '') + '</div>'); };
    chapters().forEach(ch => { const a = autoOf(ch[0]); if (a.on) sec(T(ch[1]), ch[3], a.note, a.img); });
    c.steps.forEach(s => sec(s.title || T('Schritt'), '', s.text, s.img));
    let sp = 0, area = 0, c0 = +state.root.chord || 0;
    state.segments.forEach(s => { sp += +s.span || 0; area += (+s.span || 0) * (c0 + (+s.chord || 0)) / 2; c0 = +s.chord || 0; });
    return '<div class="ba-doc"><h1>' + esc(name) + '</h1><div class="ba-meta">' + esc(T('Bauanleitung')) + ' · ' + new Date().toLocaleDateString() + (c.author ? ' · ' + esc(c.author) : '')
      + ' · ' + esc(T('Spannweite')) + ' ' + f0(2 * sp) + ' mm · ' + esc(T('Fläche')) + ' ' + f1(2 * area / 1e4) + ' dm²</div>'
      + planSvg(560, 200) + (c.intro ? '<div class="ba-note">' + esc(c.intro) + '</div>' : '') + parts.join('')
      + '<p class="ba-meta" style="margin-top:10mm">' + esc(T('Erstellt mit AI Foam Cut')) + '</p></div>';
  }
  const fullDoc = () => '<!doctype html><html><head><meta charset="utf-8"><title>' + esc((state.projectName || T('Projekt')) + ' – ' + T('Bauanleitung')) + '</title><style>' + DOC_CSS + '</style></head><body>' + docHtml() + '</body></html>';
  function printDoc() {
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    const d = fr.contentWindow.document; d.open(); d.write(fullDoc()); d.close();
    setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { alert(e.message); } setTimeout(() => fr.remove(), 2000); }, 400);
  }
  function saveHtml() {
    const fn = ((state.projectName || 'projekt').replace(/[\\/:*?"<>|]+/g, '_')) + '_bauanleitung.html';
    if (App.download) App.download(fn, fullDoc(), 'text/html', 'svDxf'); else if (App.anchorDownload) App.anchorDownload(fn, fullDoc(), 'text/html');
  }

  // ---------- Ansicht (Bearbeiten links in der Ansicht, Vorschau rechts) ----------
  function el() {
    const v = document.getElementById('bauView'); if (!v) return null;
    let r = v.querySelector('.holm-res');
    if (!r) { r = document.createElement('div'); r.className = 'holm-res ba-wrap'; v.appendChild(r); }
    return r;
  }
  function imgCtl(key) {
    const opts = TAB_LBL().map(t => '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>').join('');
    return '<span class="ba-imgctl"><select data-tab="' + key + '">' + opts + '</select><button data-grab="' + key + '">' + esc(T('Ansicht einfügen')) + '</button><button data-file="' + key + '">' + esc(T('Bild …')) + '</button><button data-noimg="' + key + '">' + esc(T('kein Bild')) + '</button></span>';
  }
  function draw() {
    const r = el(); if (!r || !isOpen()) return;
    const c = cfg(), ch = chapters();
    let h = '<div class="ba-edit"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><button data-a="print">' + esc(T('Drucken / als PDF')) + '</button><button data-a="html">' + esc(T('Als HTML speichern')) + '</button></div>'
      + '<label class="ba-l">' + esc(T('Ersteller')) + '<input data-f="author" value="' + esc(c.author) + '"></label>'
      + '<label class="ba-l">' + esc(T('Einleitung')) + '<textarea data-f="intro" rows="3">' + esc(c.intro) + '</textarea></label>'
      + '<h3 class="bib-h">' + esc(T('Kapitel aus dem Projekt')) + '</h3>';
    ch.forEach(x => {
      const a = autoOf(x[0]);
      h += '<div class="ba-step"><label><input type="checkbox" data-on="' + x[0] + '"' + (a.on ? ' checked' : '') + '> <b>' + esc(T(x[1])) + '</b></label>'
        + '<textarea data-note="' + x[0] + '" rows="2" placeholder="' + esc(T('eigene Hinweise …')) + '">' + esc(a.note) + '</textarea>'
        + imgCtl('a:' + x[0]).replace('value="' + x[4] + '"', 'value="' + x[4] + '" selected') + (a.img ? '<img class="ba-thumb" src="' + a.img + '">' : '') + '</div>';
    });
    h += '<h3 class="bib-h">' + esc(T('Eigene Schritte')) + '</h3>';
    c.steps.forEach((s, i) => {
      h += '<div class="ba-step"><div style="display:flex;gap:4px"><input data-st="' + i + '" data-k="title" value="' + esc(s.title) + '" placeholder="' + esc(T('Titel')) + '" style="flex:1">'
        + '<button data-mv="' + i + ':-1">↑</button><button data-mv="' + i + ':1">↓</button><button data-del="' + i + '">✕</button></div>'
        + '<textarea data-st="' + i + '" data-k="text" rows="3" placeholder="' + esc(T('Beschreibung …')) + '">' + esc(s.text) + '</textarea>'
        + imgCtl('s:' + i) + (s.img ? '<img class="ba-thumb" src="' + s.img + '">' : '') + '</div>';
    });
    h += '<button data-a="add">' + esc(T('+ Schritt')) + '</button></div>';
    h += '<div class="ba-prev"><style>' + DOC_CSS.replace(/body\{[^}]*\}/, '').replace(/@media print\{.*\}$/, '') + '</style>' + docHtml() + '</div>';
    r.innerHTML = h; wire(r);
  }
  function setImg(key, url) {
    if (!url) return; const c = cfg();
    if (key.startsWith('a:')) autoOf(key.slice(2)).img = url; else { const s = c.steps[+key.slice(2)]; if (s) s.img = url; }
    draw();
  }
  function wire(r) {
    const c = cfg();
    r.querySelectorAll('[data-f]').forEach(i => i.onchange = () => { c[i.dataset.f] = i.value; draw(); });
    r.querySelectorAll('[data-on]').forEach(i => i.onchange = () => { autoOf(i.dataset.on).on = i.checked; draw(); });
    r.querySelectorAll('[data-note]').forEach(i => i.onchange = () => { autoOf(i.dataset.note).note = i.value; draw(); });
    r.querySelectorAll('[data-st]').forEach(i => i.onchange = () => { c.steps[+i.dataset.st][i.dataset.k] = i.value; draw(); });
    r.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split(':').map(Number), j = i + d; if (j < 0 || j >= c.steps.length) return; c.steps.splice(j, 0, c.steps.splice(i, 1)[0]); draw(); });
    r.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm(T('Schritt löschen?'))) { c.steps.splice(+b.dataset.del, 1); draw(); } });
    r.querySelectorAll('[data-grab]').forEach(b => b.onclick = async () => { const k = b.dataset.grab, v = r.querySelector('select[data-tab="' + k + '"]').value; setImg(k, await grabView(v)); });
    r.querySelectorAll('[data-file]').forEach(b => b.onclick = async () => setImg(b.dataset.file, await pickFile()));
    r.querySelectorAll('[data-noimg]').forEach(b => b.onclick = () => { const k = b.dataset.noimg; if (k.startsWith('a:')) autoOf(k.slice(2)).img = null; else c.steps[+k.slice(2)].img = null; draw(); });
    r.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'print') printDoc(); else if (a === 'html') saveHtml();
      else if (a === 'add') { c.steps.push({ title: '', text: '', img: null }); draw(); }
    });
  }
  function bauSidebar(side) {
    const { grp, hint } = App;
    const g = grp('Bauanleitung', true, 'bau', { key: 'bauMain' }); side.appendChild(g.g);
    hint(g.body, 'Die Kapitel entstehen aus den Projektdaten (Tragfläche, Blöcke, Holm, Laminierplan …) und aktualisieren sich mit dem Projekt. Eigene Schritte und Bilder werden im Projekt gespeichert. „Drucken / als PDF“ öffnet den Druckdialog (Ziel „Als PDF speichern“).');
  }
  function reset() { delete state.cfg.bau; }
  function show() { draw(); }
  Object.assign(App, { bauSidebar });
  window.Bauanleitung = { show, refresh: show, reset, docHtml, _test: { chapters, wingRows } };
})();

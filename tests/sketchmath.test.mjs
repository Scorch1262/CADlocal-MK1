// Test der Skizzenmaß-Logik (ohne Browser):  node tests/sketchmath.test.mjs
import { pointOf, snapPoints, measureDim, setDimValue, dropEntityFromDims, autoDims, setAutoDim } from '../web/app/sketchmath.js';
let fails = 0;
const ok = (n, c, i = '') => { console.log((c ? 'OK   ' : 'FAIL ') + n + (i ? '  ' + i : '')); if (!c) fails++; };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

// Rechteck-Größenmaße
let ents = [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30, rot: 0 }];
let ad = autoDims(ents);
ok('Rechteck: 2 Maße', ad.length === 2 && near(ad[0].value, 40) && near(ad[1].value, 30));
setAutoDim(ents, ad.find(x => x.kind === 'rectW'), 60);
ok('Breite 60, linke Kante bleibt', near(ents[0].w, 60) && near(ents[0].cx - ents[0].w / 2, -20));
setAutoDim(ents, autoDims(ents).find(x => x.kind === 'rectH'), 10);
ok('Höhe 10, untere Kante bleibt', near(ents[0].h, 10) && near(ents[0].cy - ents[0].h / 2, -15));

// Kreis
ents = [{ type: 'circle', cx: 5, cy: 5, r: 4 }];
ad = autoDims(ents); ok('Kreis Ø8', near(ad[0].value, 8));
setAutoDim(ents, ad[0], 20); ok('Ø20 -> r10', near(ents[0].r, 10));

// Linienzug: Segmentlänge
ents = [{ type: 'poly', pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }];
ad = autoDims(ents); ok('Linienzug 4 Segmente', ad.length === 4 && ad.every(x => near(x.value, 10)));
setAutoDim(ents, ad[0], 25); ok('Segment 25: Punkt 1 wandert', near(ents[0].pts[1][0], 25) && near(ents[0].pts[1][1], 0));

// Bemaßungswerkzeug: Abstand Kreismittelpunkt – Ursprung (horizontal), dann verändern
ents = [{ type: 'circle', cx: 30, cy: 10, r: 4 }];
let d = { id: 'd1', mode: 'h', a: { e: -1, p: 'o' }, b: { e: 0, p: 'c' } };
ok('Messung horizontal', near(measureDim(ents, d), 30));
setDimValue(ents, d, 50); ok('Kreis auf X=50, Y bleibt', near(ents[0].cx, 50) && near(ents[0].cy, 10));
d = { id: 'd2', mode: 'a', a: { e: -1, p: 'o' }, b: { e: 0, p: 'c' } };
setDimValue(ents, d, Math.hypot(50, 10) * 2); ok('ausgerichtet: Richtung bleibt', near(ents[0].cx, 100) && near(ents[0].cy, 20));

// Zwei Entitäten: Abstand zweier Kreise vertikal
ents = [{ type: 'circle', cx: 0, cy: 0, r: 2 }, { type: 'circle', cx: 5, cy: 12, r: 3 }];
d = { id: 'd3', mode: 'v', a: { e: 0, p: 'c' }, b: { e: 1, p: 'c' } };
ok('vertikal 12', near(measureDim(ents, d), 12));
setDimValue(ents, d, 20); ok('zweiter Kreis auf Y=20', near(ents[1].cy, 20) && near(ents[1].cx, 5) && near(ents[0].cy, 0));

// gleiche Entität: Rechteck Ecke-Ecke horizontal = Breite
ents = [{ type: 'rect', cx: 0, cy: 0, w: 40, h: 30, rot: 0 }];
d = { id: 'd4', mode: 'h', a: { e: 0, p: 'v0' }, b: { e: 0, p: 'v1' } };
ok('Ecke-Ecke = 40', near(measureDim(ents, d), 40));
setDimValue(ents, d, 80); ok('Rechteck wird 80 breit', near(ents[0].w, 80) && near(ents[0].h, 30));

// Entität löschen -> Maße nachziehen
const dims = [{ id: 'a', mode: 'a', a: { e: 0, p: 'c' }, b: { e: 2, p: 'c' } }, { id: 'b', mode: 'a', a: { e: 1, p: 'c' }, b: { e: 2, p: 'c' } }];
const nd = dropEntityFromDims(dims, 1);
ok('Löschen: Maß mit Entität 1 entfällt, Index 2 -> 1', nd.length === 1 && nd[0].b.e === 1);

// Fangpunkte
ok('Fangpunkte Rechteck: Ursprung + Mitte + 4 Ecken', snapPoints([{ type: 'rect', cx: 0, cy: 0, w: 2, h: 2, rot: 0 }]).length === 6);
ok('Ungültige Werte werden abgelehnt', setDimValue([{ type: 'circle', cx: 1, cy: 0, r: 1 }], { mode: 'a', a: { e: -1, p: 'o' }, b: { e: 0, p: 'c' } }, -5) === false);
console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(fails ? 1 : 0);

// Genera data/mapa.json (siluetas de los 78 concejos) desde es-atlas (IGN, CC-BY 4.0).
// Uso: npm install es-atlas topojson-client topojson-simplify d3-geo && node scripts/mapa.mjs
import fs from "fs";
import * as topo from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { geoMercator, geoPath } from "d3-geo";
const t = JSON.parse(fs.readFileSync("node_modules/es-atlas/es/municipalities.json"));
const ast = { ...t.objects.municipalities, geometries: t.objects.municipalities.geometries.filter(g => String(g.id).startsWith("33")) };
let tt = { ...t, objects: { a: ast } };
tt = presimplify(tt);
tt = simplify(tt, quantile(tt, 0.6));
const fc = topo.feature(tt, tt.objects.a);
const W = 1000, H = 420;
const proj = geoMercator().fitExtent([[6, 6], [W - 6, H - 6]], fc);
const path = geoPath(proj).digits(1);
const out = fc.features.map(f => ({ codigo: String(f.id), nombre: f.properties.name, d: path(f), c: proj(geoPathCentroid(f)) }));
function geoPathCentroid(f) { return proj.invert(path.centroid(f)); }
fs.writeFileSync("data/mapa.json", JSON.stringify({ viewBox: `0 0 ${W} ${H}`, concejos: out.map(o => ({ codigo: o.codigo, nombre: o.nombre, d: o.d, cx: +o.c[0].toFixed(1), cy: +o.c[1].toFixed(1) })) }));

console.log(out.length, "KB", (fs.statSync("data/mapa.json").size / 1024).toFixed(0));

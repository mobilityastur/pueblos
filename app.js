"use strict";

// Datos generados por la tarea programada del repo (rama "datos"); siluetas en data/mapa.json.
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const URL_DATOS = LOCAL ? "data/estado.json" : "https://raw.githubusercontent.com/mobilityastur/pueblos/datos/estado.json";
const URL_MAPA = "data/mapa.json?v=1";
const REFRESCO_MS = 15 * 60 * 1000;
const NS = "http://www.w3.org/2000/svg";

const svg = document.getElementById("svg");
const cajaMapa = document.getElementById("mapa");
const lista = document.getElementById("lista");
const buscar = document.getElementById("buscar");
const ficha = document.getElementById("ficha");
const velo = document.getElementById("velo");

let mapa = null;          // { viewBox, concejos: [{codigo, nombre, d, cx, cy}] }
let estado = null;        // estado.json
let porCodigo = new Map();
let caminos = new Map();  // codigo -> <path>
let areas = new Map();    // codigo -> área aproximada (para priorizar rótulos)
let modo = leerModo();
let activa = null;
let filtro = "";

const BASE = { x: 0, y: 0, w: 1000, h: 420 };
let vb = { ...BASE };

// ---------- utilidades ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function normalizar(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'").toLowerCase();
}
function leerModo() {
  try { return localStorage.getItem("pueblos-modo") || "temp"; } catch { return "temp"; }
}
function guardarModo(m) {
  try { localStorage.setItem("pueblos-modo", m); } catch { /* sin almacenamiento */ }
}
function nombreMostrado(c) { return (c && (c.nombreAst || c.nombre)) || ""; }
function hoy(c) { return c && c.tiempo && c.tiempo.dias && c.tiempo.dias[0] ? c.tiempo.dias[0] : null; }
const DIAS_AST = ["Dom", "Llu", "Mar", "Mié", "Xue", "Vie", "Sáb"];
const DIAS_AST_LARGO = ["Domingu", "Llunes", "Martes", "Miércoles", "Xueves", "Vienres", "Sábadu"];
// Etiqueta de probabilidad de lluvia con más contraste cuanto más probable.
function nivelLluvia(p) { return p == null ? "" : p < 10 ? "nula" : p < 40 ? "baja" : p < 70 ? "media" : "alta"; }
function etiquetaLluvia(p) {
  return p == null ? "" : `<span class="prob ${nivelLluvia(p)}">💧 ${Math.round(p)}%</span>`;
}
function nombreDia(fecha) {
  const hoyS = hoyISO();
  const man = new Date(`${hoyS}T12:00:00`); man.setDate(man.getDate() + 1);
  const manS = `${man.getFullYear()}-${String(man.getMonth() + 1).padStart(2, "0")}-${String(man.getDate()).padStart(2, "0")}`;
  if (fecha === hoyS) return "Hoy";
  if (fecha === manS) return "Mañana";
  const d = new Date(`${fecha}T12:00:00`);
  return `${DIAS_AST_LARGO[d.getDay()]} ${d.getDate()}`;
}
function diaSemana(fecha) {
  return DIAS_AST[new Date(`${fecha}T12:00:00`).getDay()];
}

// Cielo del momento: el tramo horario de AEMET que contiene la hora actual (06-12, 12-18...),
// o el más corto que la contenga; si no, el del día completo.
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function cieloActual(d) {
  if (!d) return null;
  const tramos = d.cielos || {};
  const h = new Date().getHours();
  const largo = (p) => { const [a, b] = p.split("-").map(Number); return b - a; };
  if (d.fecha === hoyISO()) {
    const dentro = Object.keys(tramos)
      .filter((p) => { const [a, b] = p.split("-").map(Number); return p && h >= a && h < b; })
      .sort((x, y) => largo(x) - largo(y));
    for (const p of dentro) if (tramos[p].c || tramos[p].d) return tramos[p];
  }
  if (d.cielo || d.codigoCielo) return { c: d.codigoCielo, d: d.cielo };
  const otro = Object.values(tramos).find((x) => x.c || x.d);
  return otro || null;
}

// ---------- predicción horaria ----------
function claveHora(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
}
function horas(c) { return (c && c.tiempo && c.tiempo.horas) || []; }
// La hora en curso, o la última anterior si falta la exacta (como mucho 3 horas atrás).
function horaActual(c) {
  const ahora = claveHora();
  const hs = horas(c).filter((x) => x.h <= ahora);
  const ult = hs[hs.length - 1];
  if (!ult) return null;
  const dif = (new Date(`${ahora}:00`) - new Date(`${ult.h}:00`)) / 3600000;
  return dif <= 3 ? ult : null;
}
// Temperatura que se muestra según el modo: la de ahora (o la máxima si aún no hay horaria).
function tempMostrada(c) {
  const d = hoy(c);
  if (modo === "max") return d && d.max != null ? d.max : null;
  const h = horaActual(c);
  if (h && h.t != null) return h.t;
  return d && d.max != null ? d.max : null;
}
function cieloDe(c) {
  const h = horaActual(c);
  if (h && (h.c || h.d)) return { c: h.c, d: h.d };
  return cieloActual(hoy(c));
}
const ICONO = { despejado: "☀️", "despejado-noche": "🌙", claros: "🌤️", "claros-noche": "☁️", nubes: "☁️", lluvia: "🌧️", tormenta: "⛈️", nieve: "🌨️", niebla: "🌫️" };

// Clasificación por el código de AEMET (la "n" final indica noche).
function tipoCielo(cielo) {
  if (!cielo) return { tipo: null, noche: false };
  const cod = String(cielo.c || "");
  const noche = cod.endsWith("n");
  const n = parseInt(cod, 10);
  let tipo = null;
  if (n === 11) tipo = "despejado";
  else if (n === 12 || n === 13 || n === 17) tipo = "claros";
  else if (n >= 14 && n <= 16) tipo = "nubes";
  else if ((n >= 23 && n <= 26) || (n >= 43 && n <= 46)) tipo = "lluvia";
  else if ((n >= 33 && n <= 36) || (n >= 71 && n <= 74)) tipo = "nieve";
  else if ((n >= 51 && n <= 54) || (n >= 61 && n <= 64)) tipo = "tormenta";
  else if (n >= 81 && n <= 83) tipo = "niebla";
  if (!tipo) {
    const t = String(cielo.d || "").toLowerCase();
    if (/tormenta/.test(t)) tipo = "tormenta";
    else if (/nieve|aguanieve/.test(t)) tipo = "nieve";
    else if (/niebla|bruma|calima/.test(t)) tipo = "niebla";
    else if (/lluvia|llovi|chubasco|granizo|llovizna/.test(t)) tipo = "lluvia";
    else if (/poco nuboso|intervalos|nubes altas/.test(t)) tipo = "claros";
    else if (/cubierto|nuboso/.test(t)) tipo = "nubes";
    else if (/despejado/.test(t)) tipo = "despejado";
  }
  return { tipo, noche };
}
function claveCielo({ tipo, noche }) {
  if (!tipo) return null;
  return (tipo === "despejado" || tipo === "claros") && noche ? `${tipo}-noche` : tipo;
}
function fondoPostal({ tipo, noche }) {
  if (!tipo) return "verde";
  if (tipo === "despejado" || tipo === "claros") return noche ? "noche" : "sol";
  if (tipo === "nubes") return noche ? "nube-noche" : "nube";
  return tipo; // lluvia, tormenta, nieve, niebla
}

// ---------- escenas animadas de la postal ----------
// Pseudoaleatorio fijo para que gotas y copos no cambien de sitio al repintar.
function azar(semilla) { let s = semilla; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
function nube(x, y, s, color, op = 1, clase = "deriva", dur = 18) {
  return `<g class="${clase}" style="animation-duration:${dur}s"><g transform="translate(${x} ${y}) scale(${s})" fill="${color}" opacity="${op}">
    <ellipse cx="0" cy="18" rx="62" ry="20"/><circle cx="-26" cy="8" r="24"/><circle cx="6" cy="-2" r="32"/><circle cx="38" cy="10" r="22"/></g></g>`;
}
function sol(x, y) {
  const rayos = Array.from({ length: 12 }, (_, i) => `<rect x="-3" y="-62" width="6" height="18" rx="3" transform="rotate(${i * 30})"/>`).join("");
  return `<g transform="translate(${x} ${y})"><circle r="70" fill="#FFE08A" opacity=".18"/><g class="girar" fill="#FFD95A">${rayos}</g><circle r="34" fill="#FFD23F"/></g>`;
}
function luna(x, y) {
  return `<defs><mask id="creciente"><circle r="28" fill="#fff"/><circle cx="13" cy="-9" r="25" fill="#000"/></mask></defs>
    <g transform="translate(${x} ${y})"><circle r="56" fill="#E9E6FF" opacity=".07"/><circle r="28" fill="#F1EEDC" mask="url(#creciente)"/></g>`;
}
function estrellas(n, r) {
  return Array.from({ length: n }, (_, i) => `<circle class="parpadeo" style="animation-delay:${(r() * 3).toFixed(2)}s" cx="${(r() * 400).toFixed(0)}" cy="${(r() * 120).toFixed(0)}" r="${(0.8 + r() * 1.4).toFixed(1)}" fill="#fff"/>`).join("");
}
function gotas(n, r, color = "#CFE6F5") {
  return Array.from({ length: n }, () => {
    const x = (r() * 420 - 10).toFixed(0), y = (r() * 200).toFixed(0);
    return `<line class="gota" style="animation-delay:-${(r() * 1).toFixed(2)}s;animation-duration:${(0.6 + r() * 0.4).toFixed(2)}s" x1="${x}" y1="${y}" x2="${x - 4}" y2="${+y + 14}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity=".7"/>`;
  }).join("");
}
function copos(n, r) {
  return Array.from({ length: n }, () => `<circle class="copo" style="animation-delay:-${(r() * 6).toFixed(2)}s;animation-duration:${(4 + r() * 3).toFixed(2)}s" cx="${(r() * 400).toFixed(0)}" cy="${(r() * 60 - 40).toFixed(0)}" r="${(1.5 + r() * 2.5).toFixed(1)}" fill="#fff" opacity=".9"/>`).join("");
}
function escena({ tipo, noche }) {
  const r = azar(7);
  let dentro = "";
  if (tipo === "despejado") dentro = noche ? estrellas(40, r) + luna(318, 128) : sol(318, 128);
  else if (tipo === "claros") dentro = (noche ? estrellas(25, r) + luna(318, 124) : sol(318, 124))
    + nube(372, 168, 0.6, noche ? "#7D86AA" : "#EEF3F7", 0.92, "deriva", 22) + nube(236, 44, 0.45, noche ? "#6E789E" : "#FFFFFF", 0.75, "deriva lenta", 28);
  else if (tipo === "nubes") dentro = nube(110, 40, 1.1, "#7F909C", 0.9, "deriva", 26) + nube(250, 48, 1.3, "#8E9EAA", 0.9, "deriva lenta", 34)
    + nube(300, 140, 1.2, "#A9B6BF", 0.95, "deriva", 20) + nube(410, 96, 0.9, "#97A5AF", 0.85, "deriva lenta", 30);
  else if (tipo === "lluvia") dentro = gotas(70, r) + nube(150, 18, 1.2, "#647B8C", 0.95, "deriva", 26) + nube(300, 24, 1.4, "#56697A", 0.95, "deriva lenta", 32) + nube(420, 40, 1.1, "#6A8090", 0.9, "deriva", 24);
  else if (tipo === "tormenta") dentro = gotas(80, r, "#B9C6E0")
    + `<polygon class="rayo" points="292,52 266,118 288,118 270,186 322,100 298,100 316,52" fill="#FFE768"/>`
    + `<polygon class="rayo tarde" points="372,62 356,110 372,110 360,152 396,96 378,96 390,62" fill="#FFF3A6"/>`
    + nube(140, 16, 1.3, "#4E4A6B", 0.98, "deriva", 26) + nube(290, 22, 1.5, "#3B3756", 0.98, "deriva lenta", 32) + nube(420, 36, 1.2, "#56516F", 0.95, "deriva", 24)
    + `<rect class="destello" width="400" height="200" fill="#fff"/>`;
  else if (tipo === "nieve") dentro = nube(150, 20, 1.2, "#8FA4B6", 0.95, "deriva", 26) + nube(320, 26, 1.4, "#7C93A7", 0.95, "deriva lenta", 32) + copos(60, r);
  else if (tipo === "niebla") dentro = `<defs><filter id="difuso" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="9"/></filter></defs><g filter="url(#difuso)">`
    + [20, 64, 108, 152].map((y, i) => `<g class="${i % 2 ? "deriva lenta" : "deriva"}" style="animation-duration:${16 + i * 5}s"><ellipse cx="${i % 2 ? 260 : 150}" cy="${y}" rx="260" ry="20" fill="#EEF2F5" opacity="${0.35 + (i % 2) * 0.15}"/></g>`).join("") + "</g>";
  if (!dentro) return "";
  return `<svg class="escena" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${dentro}</svg>`;
}

// ---------- colores ----------
// Escala relativa al día: del concejo más fresco al más cálido (mínimo 6° de margen).
const ESCALA_TEMP = [[0, "#5B8FD6"], [0.25, "#4FB3C2"], [0.45, "#69B98A"], [0.65, "#C7C15A"], [0.82, "#F2A33D"], [1, "#E2583E"]];
let rango = { lo: 0, hi: 28 };
function calcularRango() {
  const ts = (estado ? estado.concejos : []).map(tempMostrada).filter((x) => x != null);
  if (!ts.length) return;
  let lo = Math.floor(Math.min(...ts)), hi = Math.ceil(Math.max(...ts));
  if (hi - lo < 6) { const m = (hi + lo) / 2; lo = Math.floor(m - 3); hi = Math.ceil(m + 3); }
  rango = { lo, hi };
}
const COLOR_CIELO = {
  despejado: "#F2B33D", "despejado-noche": "#8E86E0",
  claros: "#B9C27A", "claros-noche": "#5F6E9E",
  nubes: "#7E929F", niebla: "#B4C0C8", lluvia: "#3C7FB0", tormenta: "#B0478A", nieve: "#F4F8FB",
};
const NOMBRE_CIELO = {
  despejado: "Despejado", "despejado-noche": "Despejado (noche)",
  claros: "Poco nuboso", "claros-noche": "Poco nuboso (noche)",
  nubes: "Nubes", niebla: "Niebla", lluvia: "Lluvia", tormenta: "Tormenta", nieve: "Nieve",
};
const SIN_DATO = "#33475A";

function mezclar(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function colorTemp(temp) {
  if (temp == null) return SIN_DATO;
  const t = (temp - rango.lo) / (rango.hi - rango.lo);
  if (t <= ESCALA_TEMP[0][0]) return ESCALA_TEMP[0][1];
  for (let i = 1; i < ESCALA_TEMP.length; i++) {
    const [t1, c1] = ESCALA_TEMP[i];
    const [t0, c0] = ESCALA_TEMP[i - 1];
    if (t <= t1) return mezclar(c0, c1, (t - t0) / (t1 - t0));
  }
  return ESCALA_TEMP[ESCALA_TEMP.length - 1][1];
}
function colorDe(c) {
  if (!c || !c.tiempo) return SIN_DATO;
  if (modo === "cielo") return COLOR_CIELO[claveCielo(tipoCielo(cieloDe(c)))] || SIN_DATO;
  return colorTemp(tempMostrada(c));
}

// ---------- mapa ----------
function dibujarMapa() {
  svg.innerHTML = "";
  svg.setAttribute("viewBox", mapa.viewBox);
  const gC = document.createElementNS(NS, "g");
  for (const m of mapa.concejos) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", m.d);
    p.setAttribute("class", "concejo");
    p.dataset.codigo = m.codigo;
    const t = document.createElementNS(NS, "title");
    t.textContent = m.nombre;
    p.appendChild(t);
    gC.appendChild(p);
    caminos.set(m.codigo, p);
  }
  svg.appendChild(gC);
  const gR = document.createElementNS(NS, "g");
  gR.id = "rotulos";
  svg.appendChild(gR);
  for (const m of mapa.concejos) {
    const b = caminos.get(m.codigo).getBBox();
    areas.set(m.codigo, b.width * b.height);
  }
}

function pintar() {
  if (!mapa) return;
  calcularRango();
  for (const m of mapa.concejos) {
    const p = caminos.get(m.codigo);
    const c = porCodigo.get(m.codigo);
    p.style.fill = colorDe(c);
    p.classList.toggle("activo", m.codigo === activa);
    p.classList.toggle("apagado", !!filtro && !coincide(c || { nombre: m.nombre }));
  }
  pintarLeyenda();
  pintarRotulos();
}

function pintarLeyenda() {
  const el = document.getElementById("leyenda");
  if (modo !== "cielo") {
    const grad = ESCALA_TEMP.map(([t, c]) => `${c} ${t * 100}%`).join(", ");
    const que = modo === "max" ? "máxima de hoy" : `prevista a las ${String(new Date().getHours()).padStart(2, "0")}:00`;
    el.innerHTML = `<span>${rango.lo}°</span><span class="barra" style="background:linear-gradient(90deg, ${grad})"></span><span>${rango.hi}°</span><span>· ${que}</span>`;
  } else {
    // Solo los tipos de cielo que aparecen ahora en el mapa
    const presentes = new Set((estado ? estado.concejos : []).map((c) => claveCielo(tipoCielo(cieloDe(c)))).filter(Boolean));
    el.innerHTML = Object.entries(NOMBRE_CIELO).filter(([k]) => presentes.has(k))
      .map(([k, n]) => `<span class="chip"><i style="background:${COLOR_CIELO[k]}"></i>${n}</span>`).join("") || "<span>Sin datos de cielo</span>";
  }
}

// Rótulos a tamaño de pantalla constante: temperatura cuando hay sitio y, con más zoom, también el nombre.
function pintarRotulos() {
  const g = document.getElementById("rotulos");
  if (!g || !mapa) return;
  g.innerHTML = "";
  const ancho = svg.getBoundingClientRect().width || 1;
  const px = ancho / vb.w;            // píxeles de pantalla por unidad del SVG
  if (px < 0.85) return;              // vista general en el móvil: solo colores
  const u = 1 / px;                   // una unidad de pantalla en el SVG
  const conNombre = px >= 1.5;
  const ocupados = [];
  const choca = (r) => ocupados.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0);
  const orden = [...mapa.concejos].sort((a, b) => (areas.get(b.codigo) || 0) - (areas.get(a.codigo) || 0));
  for (const m of orden) {
    if (m.cx < vb.x || m.cx > vb.x + vb.w || m.cy < vb.y || m.cy > vb.y + vb.h) continue;
    const c = porCodigo.get(m.codigo);
    const tm = tempMostrada(c);
    const temp = tm != null ? `${Math.round(tm)}°` : "–";
    const nombre = nombreMostrado(c) || m.nombre;
    const fT = 13 * u, fN = 11 * u;
    let lineas = conNombre ? [[nombre, fN, "nombre"], [temp, fT, ""]] : [[temp, fT, ""]];
    const caja = (ls) => {
      const w = Math.max(...ls.map(([t, f]) => t.length * f * 0.56)) + 4 * u;
      const h = ls.reduce((s, [, f]) => s + f * 1.15, 0);
      return { x0: m.cx - w / 2, x1: m.cx + w / 2, y0: m.cy - h / 2, y1: m.cy + h / 2 };
    };
    let r = caja(lineas);
    if (choca(r) && conNombre) { lineas = [[temp, fT, ""]]; r = caja(lineas); }
    if (choca(r)) continue;
    ocupados.push(r);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", "rotulo");
    t.setAttribute("stroke-width", String(3 * u));
    let y = r.y0;
    for (const [txt, f, cls] of lineas) {
      const s = document.createElementNS(NS, "tspan");
      s.setAttribute("x", m.cx);
      s.setAttribute("y", y + (f * 1.15) / 2);
      s.setAttribute("font-size", f);
      if (cls) s.setAttribute("class", cls);
      s.textContent = txt;
      t.appendChild(s);
      y += f * 1.15;
    }
    g.appendChild(t);
  }
}

// ---------- zoom y desplazamiento ----------
function limitar() {
  vb.w = Math.min(BASE.w, Math.max(BASE.w / 10, vb.w));
  vb.h = vb.w * (BASE.h / BASE.w);
  vb.x = Math.min(BASE.w - vb.w, Math.max(0, vb.x));
  vb.y = Math.min(BASE.h - vb.h, Math.max(0, vb.y));
}
function aplicarVista() {
  limitar();
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  document.getElementById("reencuadrar").hidden = vb.w > BASE.w * 0.98;
  pintarRotulos();
}
function aSvg(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
}
function zoomEn(factor, clientX, clientY) {
  const p = aSvg(clientX, clientY);
  const w = vb.w / factor;
  vb.x = p.x - ((p.x - vb.x) * w) / vb.w;
  vb.y = p.y - ((p.y - vb.y) * w) / vb.w;
  vb.w = w;
  aplicarVista();
}

const punteros = new Map();
let gesto = null;
cajaMapa.addEventListener("pointerdown", (e) => {
  cajaMapa.setPointerCapture(e.pointerId);
  punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (punteros.size === 1) gesto = { x: e.clientX, y: e.clientY, movido: false, t: Date.now() };
  else if (gesto) gesto.movido = true;
});
cajaMapa.addEventListener("pointermove", (e) => {
  if (!punteros.has(e.pointerId)) return;
  const antes = [...punteros.values()].map((p) => ({ ...p }));
  punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const ahora = [...punteros.values()];
  const r = svg.getBoundingClientRect();
  if (ahora.length === 1) {
    const dx = ahora[0].x - antes[0].x, dy = ahora[0].y - antes[0].y;
    if (gesto && Math.hypot(e.clientX - gesto.x, e.clientY - gesto.y) > 8) gesto.movido = true;
    if (!gesto || !gesto.movido) return;
    vb.x -= (dx / r.width) * vb.w;
    vb.y -= (dy / r.height) * vb.h;
    aplicarVista();
  } else if (ahora.length === 2) {
    const d0 = Math.hypot(antes[0].x - antes[1].x, antes[0].y - antes[1].y);
    const d1 = Math.hypot(ahora[0].x - ahora[1].x, ahora[0].y - ahora[1].y);
    const mx = (ahora[0].x + ahora[1].x) / 2, my = (ahora[0].y + ahora[1].y) / 2;
    const mx0 = (antes[0].x + antes[1].x) / 2, my0 = (antes[0].y + antes[1].y) / 2;
    vb.x -= ((mx - mx0) / r.width) * vb.w;
    vb.y -= ((my - my0) / r.height) * vb.h;
    if (d0 > 0) zoomEn(d1 / d0, mx, my); else aplicarVista();
  }
});
function soltar(e) {
  if (!punteros.has(e.pointerId)) return;
  punteros.delete(e.pointerId);
  if (punteros.size === 0 && gesto && !gesto.movido && e.type === "pointerup") {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const p = el && el.closest && el.closest("[data-codigo]");
    if (p) abrirFicha(p.dataset.codigo);
  }
  if (punteros.size === 0) gesto = null;
}
cajaMapa.addEventListener("pointerup", soltar);
cajaMapa.addEventListener("pointercancel", soltar);
cajaMapa.addEventListener("wheel", (e) => { e.preventDefault(); zoomEn(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); }, { passive: false });
cajaMapa.addEventListener("dblclick", (e) => zoomEn(2, e.clientX, e.clientY));
document.getElementById("reencuadrar").addEventListener("click", (e) => { e.stopPropagation(); vb = { ...BASE }; aplicarVista(); });
document.getElementById("reencuadrar").addEventListener("pointerdown", (e) => e.stopPropagation());
window.addEventListener("resize", () => pintarRotulos());

// ---------- lista y buscador ----------
function coincide(c) {
  if (!filtro) return true;
  return normalizar(c.nombre).includes(filtro) || normalizar(c.nombreAst).includes(filtro);
}
function pintarLista() {
  if (!estado) return;
  // Con búsqueda o con "Ver los 78 concejos" se ve la lista; si no, el panel de tarjetas.
  const verLista = !!filtro || listaAbierta;
  lista.hidden = !verLista;
  document.getElementById("panel").hidden = verLista;
  const boton = document.getElementById("ver-todos");
  boton.hidden = !!filtro;
  boton.textContent = listaAbierta ? "Volver al resumen" : `Ver los ${estado.concejos.length} concejos`;
  if (!verLista) { pintarPanel(); return; }
  const filas = [...estado.concejos]
    .filter(coincide)
    .sort((a, b) => nombreMostrado(a).localeCompare(nombreMostrado(b), "es"));
  lista.innerHTML = filas.map((c) => {
    const tm = tempMostrada(c);
    const cams = (c.webcams || []).length;
    const sub = [c.nombreAst && c.nombreAst !== c.nombre ? c.nombre : "", cams ? `${cams} webcam${cams > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    return `<li><button data-codigo="${esc(c.codigo)}">
      <span class="punto" style="background:${colorDe(c)}"></span>
      <span class="nom"><b>${esc(nombreMostrado(c))}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      <span class="dato">${tm != null ? Math.round(tm) + "°" : "–"}<small>${c.tiempo ? esc((cieloDe(c) || {}).d || "") : "sin previsión"}</small></span>
    </button></li>`;
  }).join("") || `<li class="sin-cam">Ningún concejo coincide.</li>`;
}
lista.addEventListener("click", (e) => {
  const b = e.target.closest("[data-codigo]");
  if (b) abrirFicha(b.dataset.codigo);
});
const borrar = document.getElementById("borrar");
buscar.addEventListener("input", () => {
  filtro = normalizar(buscar.value.trim());
  borrar.hidden = !buscar.value;
  pintarLista();
  pintar();
});
borrar.addEventListener("click", () => {
  buscar.value = "";
  buscar.dispatchEvent(new Event("input"));
  buscar.blur();
});

document.querySelectorAll(".modos button").forEach((b) => {
  b.setAttribute("aria-selected", String(b.dataset.modo === modo));
  b.addEventListener("click", () => {
    modo = b.dataset.modo;
    guardarModo(modo);
    document.querySelectorAll(".modos button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    pintar();
    pintarLista();
  });
});

// ---------- ficha ----------
function abrirFicha(codigo) {
  const c = porCodigo.get(codigo);
  if (!c) return;
  activa = codigo;
  pintar();
  const d = hoy(c);
  const ahora = cieloDe(c);
  const hAhora = horaActual(c);
  const tAhora = hAhora && hAhora.t != null ? hAhora.t : d && d.max != null ? d.max : null;
  const tipo = c.tiempo ? fondoPostal(tipoCielo(ahora)) : "verde";
  const clave = claveHora();
  const proximas = horas(c).filter((x) => x.h >= (hAhora ? hAhora.h : clave)).slice(0, 24);
  const franja = proximas.length
    ? `<h3>Próximas horas</h3><div class="franja">${proximas.map((x, i) => `
        <div class="hora${x.h.endsWith("T00") && i ? " medianoche" : ""}" data-i="${i}" role="button" tabindex="0">
          <b>${i === 0 ? "Ahora" : x.h.slice(11) + " h"}</b>
          <span class="ico">${ICONO[claveCielo(tipoCielo(x))] || "·"}</span>
          <span class="t">${x.t != null ? Math.round(x.t) + "°" : "–"}</span>
          <span class="p">${etiquetaLluvia(x.p)}</span>
        </div>`).join("")}</div><div class="detalle" id="detalle-horas" hidden></div>`
    : "";
  const dias = (c.tiempo && c.tiempo.dias) || [];
  const webcams = c.webcams || [];
  const fuentes = [...new Set(webcams.map((w) => w.fuente))].join(" y ");

  const semana = dias.length
    ? `<div class="semana">${dias.map((x, i) => `
        <div class="dia" data-i="${i}" role="button" tabindex="0">
          <b>${esc(diaSemana(x.fecha))}</b>
          <span class="max">${x.max != null ? Math.round(x.max) + "°" : "–"}</span>
          <span class="min">${x.min != null ? Math.round(x.min) + "°" : "–"}</span>
          ${etiquetaLluvia(x.lluvia)}
        </div>`).join("")}</div><div class="detalle" id="detalle-dias" hidden></div>`
    : `<p class="sin-cam">Todavía no hay previsión para este concejo.</p>`;

  const camaras = webcams.length
    ? `<h3>Webcams en directo</h3>
       <p class="nota">En directo en la web de ${esc(fuentes)}; se abre aparte.</p>
       ${webcams.map((w) => `<a class="cam" href="${esc(w.url)}" target="_blank" rel="noopener"><span>${esc(w.nombre)}</span><span>↗</span></a>`).join("")}`
    : `<h3>Webcams en directo</h3><p class="sin-cam">Todavía no tenemos una webcam pública para este concejo.</p>`;

  const elab = c.tiempo && c.tiempo.elaborado ? `Previsión AEMET elaborada el ${esc(new Date(c.tiempo.elaborado).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}.` : "";
  ficha.innerHTML = `
    <button class="cerrar" aria-label="Cerrar">×</button>
    <div class="portada ${esc(tipo)}">
      ${c.tiempo ? escena(tipoCielo(ahora)) : ""}
      <h2>${esc(nombreMostrado(c))}</h2>
      ${c.nombreAst && c.nombreAst !== c.nombre ? `<p class="concejo-es">${esc(c.nombre)}</p>` : ""}
      <div class="hoy">
        <span class="grados">${tAhora != null ? Math.round(tAhora) + "°" : "–"}</span>
        <span class="cielo">${c.tiempo ? esc((ahora && ahora.d) || "") : "Sin previsión por ahora"}${d && d.max != null ? `<small>Máx ${Math.round(d.max)}° · Mín ${d.min != null ? Math.round(d.min) + "°" : "–"}</small>` : ""}</span>
      </div>
    </div>
    <div class="cuerpo">
      ${franja}
      <h3>Próximos días</h3>
      ${semana}
      ${camaras}
      <p class="pie">${elab} Fuente del tiempo: AEMET OpenData.</p>
    </div>`;
  ficha.hidden = false;
  velo.hidden = false;
  ficha.scrollTop = 0;
  ficha.querySelector(".cerrar").addEventListener("click", cerrarFicha);

  // Al tocar una hora o un día, se amplía su detalle debajo de la fila.
  const detalleHora = (x) => {
    const cl = { c: x.c, d: x.d };
    const mm = x.mm != null && x.mm > 0 ? `<p>Precipitación prevista: <strong>${String(x.mm).replace(".", ",")} mm</strong></p>` : "";
    return `<b>${esc(nombreDia(x.h.slice(0, 10)))} a las ${x.h.slice(11)}:00</b>
      <p class="grande">${ICONO[claveCielo(tipoCielo(cl))] || ""} ${esc(x.d || "")} · <strong>${x.t != null ? Math.round(x.t) + "°" : "–"}</strong></p>
      <p class="lluvia-det ${nivelLluvia(x.p)}">💧 Probabilidad de lluvia: <strong>${x.p != null ? Math.round(x.p) + "%" : "sin dato"}</strong></p>${mm}`;
  };
  const detalleDia = (x) => {
    const cl = x.cielo || x.codigoCielo ? { c: x.codigoCielo, d: x.cielo } : Object.values(x.cielos || {}).find((y) => y.c || y.d) || null;
    return `<b>${esc(nombreDia(x.fecha))}</b>
      <p class="grande">${cl ? (ICONO[claveCielo(tipoCielo({ c: String(cl.c || "").replace("n", ""), d: cl.d }))] || "") + " " + esc(cl.d || "") + " · " : ""}<strong>${x.max != null ? Math.round(x.max) + "°" : "–"}</strong> / ${x.min != null ? Math.round(x.min) + "°" : "–"}</p>
      <p class="lluvia-det ${nivelLluvia(x.lluvia)}">💧 Probabilidad de lluvia: <strong>${x.lluvia != null ? Math.round(x.lluvia) + "%" : "sin dato"}</strong></p>`;
  };
  const enlazar = (selector, caja, lista, pintarDet) => {
    const det = ficha.querySelector(caja);
    if (!det) return;
    ficha.querySelectorAll(selector).forEach((el) => {
      const abrir = () => {
        const ya = el.classList.contains("sel");
        ficha.querySelectorAll(selector).forEach((o) => o.classList.remove("sel"));
        if (ya) { det.hidden = true; return; }
        el.classList.add("sel");
        det.innerHTML = pintarDet(lista[+el.dataset.i]);
        det.hidden = false;
      };
      el.addEventListener("click", abrir);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
    });
  };
  enlazar(".hora", "#detalle-horas", proximas, detalleHora);
  enlazar(".dia", "#detalle-dias", dias, detalleDia);
}
function cerrarFicha() {
  activa = null;
  ficha.hidden = true;
  velo.hidden = true;
  pintar();
}
velo.addEventListener("click", cerrarFicha);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ficha.hidden) cerrarFicha(); });

// ---------- panel de tarjetas ----------
let listaAbierta = false;
let ZONAS = {};
const ZONA_NOMBRE = { costa: "Costa", interior: "Interior", montana: "Montaña" };
const ZONA_COLOR = { costa: "#2F96C2", interior: "#5E9E3E", montana: "#A06FD3" };
const ORDEN_Z = ["costa", "interior", "montana"];
const zonaDe = (c) => ZONAS[c.nombre] || "interior";
const media = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const fmt = (x) => x == null ? "–" : `${Math.round(x)}°`;

document.getElementById("ver-todos").addEventListener("click", () => {
  listaAbierta = !listaAbierta;
  pintarLista();
  if (!listaAbierta) document.querySelector(".listado").scrollIntoView({ behavior: "smooth" });
});

function pintarPanel() {
  const el = document.getElementById("panel");
  if (!estado) return;
  el.innerHTML = tarjetaAhora() + tarjeta36h() + tarjetaDias() + tarjetaSol();
  el.querySelectorAll("[data-codigo]").forEach((b) => b.addEventListener("click", () => abrirFicha(b.dataset.codigo)));
  activarGrafica36h();
}

// 1. Ahora en Asturias: extremos y dónde es probable la lluvia
function tarjetaAhora() {
  const filas = estado.concejos.map((c) => ({ c, h: horaActual(c) })).filter((x) => x.h && x.h.t != null);
  if (!filas.length) return "";
  const calido = filas.reduce((a, b) => (b.h.t > a.h.t ? b : a));
  const frio = filas.reduce((a, b) => (b.h.t < a.h.t ? b : a));
  const lluvioso = filas.reduce((a, b) => ((b.h.p ?? -1) > (a.h.p ?? -1) || ((b.h.p ?? -1) === (a.h.p ?? -1) && (b.h.mm ?? 0) > (a.h.mm ?? 0)) ? b : a));
  const hora = `${String(new Date().getHours()).padStart(2, "0")}:00`;
  const porZona = ORDEN_Z.map((z) => {
    const fz = filas.filter((x) => zonaDe(x.c) === z);
    const n = fz.filter((x) => (x.h.p ?? 0) >= 50).length;
    return { z, n, total: fz.length };
  });
  const totalLl = porZona.reduce((a, b) => a + b.n, 0);
  const resumen = totalLl === 0 ? "No se espera lluvia en esta hora en ningún concejo."
    : totalLl === filas.length ? "Lluvia probable en toda Asturias en esta hora."
    : `Lluvia probable (50 % o más) en ${totalLl} de ${filas.length} concejos.`;
  const ext = (txt, x, valor) => `<button class="extremo" data-codigo="${esc(x.c.codigo)}"><small>${txt}</small><strong>${valor}</strong><span>${esc(nombreMostrado(x.c))}</span></button>`;
  return `<section class="tarjeta">
    <h3>Ahora en Asturias · ${hora}</h3>
    <p class="resumen">${resumen}</p>
    <div class="extremos">
      ${ext("Más templado", calido, fmt(calido.h.t))}
      ${ext("Más frío", frio, fmt(frio.h.t))}
      ${ext("Más lluvia", lluvioso, lluvioso.h.p != null ? Math.round(lluvioso.h.p) + "%" : "–")}
    </div>
    <div class="zonas-lluvia">${porZona.map(({ z, n, total }) => `
      <div class="zl"><b><span class="punto-z" style="background:${ZONA_COLOR[z]}"></span>${ZONA_NOMBRE[z]}</b>
        <div class="pista"><div class="lleno" style="width:${total ? (n / total) * 100 : 0}%;background:${ZONA_COLOR[z]}"></div></div>
        <em>${n}/${total}</em></div>`).join("")}</div>
    <p class="pie-t">Concejos con probabilidad de lluvia de 50 % o más, por zona.</p>
  </section>`;
}

// 2. Próximas 36 horas: media por zona y banda mín.–máx. de toda Asturias
let serie36 = null;
function datos36h() {
  const inicio = claveHora();
  const claves = [...new Set(estado.concejos.flatMap((c) => horas(c).map((x) => x.h)))].filter((h) => h >= inicio).sort().slice(0, 36);
  const filas = claves.map((h) => {
    const vals = { costa: [], interior: [], montana: [] };
    const todos = []; let noches = 0, n = 0;
    for (const c of estado.concejos) {
      const x = horas(c).find((y) => y.h === h);
      if (!x || x.t == null) continue;
      vals[zonaDe(c)].push(x.t); todos.push(x.t); n++;
      if (String(x.c).endsWith("n")) noches++;
    }
    return { h, costa: media(vals.costa), interior: media(vals.interior), montana: media(vals.montana),
      min: todos.length ? Math.min(...todos) : null, max: todos.length ? Math.max(...todos) : null, noche: n && noches / n > 0.5 };
  }).filter((f) => f.min != null);
  return filas;
}
function tarjeta36h() {
  const f = datos36h();
  if (f.length < 2) return "";
  serie36 = f;
  const W = 340, H = 190, iz = 26, de = 84, ar = 10, ab = 22;
  const lo = Math.floor(Math.min(...f.map((x) => x.min)) - 1), hi = Math.ceil(Math.max(...f.map((x) => x.max)) + 1);
  const X = (i) => iz + (i / (f.length - 1)) * (W - iz - de);
  const Y = (v) => ar + (1 - (v - lo) / (hi - lo)) * (H - ar - ab);
  const paso = hi - lo > 14 ? 5 : hi - lo > 7 ? 3 : 2;
  let rej = "";
  for (let v = Math.ceil(lo / paso) * paso; v <= hi; v += paso) rej += `<line class="rejilla" x1="${iz}" x2="${W - de}" y1="${Y(v)}" y2="${Y(v)}"/><text class="eje" x="${iz - 4}" y="${Y(v) + 3}" text-anchor="end">${v}°</text>`;
  let noche = "";
  f.forEach((x, i) => { if (x.noche) noche += `<rect class="noche" x="${X(Math.max(0, i - 0.5))}" y="${ar}" width="${X(Math.min(f.length - 1, i + 0.5)) - X(Math.max(0, i - 0.5))}" height="${H - ar - ab}"/>`; });
  const ejeX = f.map((x, i) => {
    const hh = x.h.slice(11);
    if (i === 0) return `<text class="eje" x="${X(0)}" y="${H - 6}" text-anchor="start">Ahora</text>`;
    return hh % 6 === 0 && i > 2 ? `<text class="eje" x="${X(i)}" y="${H - 6}" text-anchor="middle">${hh} h</text>` : "";
  }).join("");
  const banda = `<path class="banda" d="M${f.map((x, i) => `${X(i)},${Y(x.max)}`).join(" L")} L${f.map((x, i) => [i, x]).reverse().map(([i, x]) => `${X(i)},${Y(x.min)}`).join(" L")} Z"/>`;
  const lineas = ORDEN_Z.map((z) => `<path class="linea" stroke="${ZONA_COLOR[z]}" d="M${f.map((x, i) => `${X(i)},${Y(x[z])}`).join(" L")}"/>`).join("");
  // Etiquetas directas al final de cada línea, separadas si se pisan
  const finales = ORDEN_Z.map((z) => ({ z, y: Y(f[f.length - 1][z]), v: f[f.length - 1][z] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < finales.length; i++) if (finales[i].y - finales[i - 1].y < 13) finales[i].y = finales[i - 1].y + 13;
  const etiquetas = finales.map(({ z, y, v }) => `<circle cx="${X(f.length - 1)}" cy="${Y(v)}" r="3" fill="${ZONA_COLOR[z]}"/><text class="etq" x="${X(f.length - 1) + 6}" y="${y + 4}">${fmt(v)} ${ZONA_NOMBRE[z]}</text>`).join("");
  // Resumen en texto
  const minM = f.reduce((a, b) => (b.montana < a.montana ? b : a));
  const maxC = f.reduce((a, b) => (b.costa > a.costa ? b : a));
  const cuando = (h) => `${nombreDia(h.slice(0, 10)).toLowerCase()} a las ${h.slice(11)} h`;
  return `<section class="tarjeta">
    <h3>Próximas 36 horas</h3>
    <p class="resumen">Mínima en la montaña de ${fmt(minM.montana)} (${cuando(minM.h)}); en la costa se llega a ${fmt(maxC.costa)} (${cuando(maxC.h)}).</p>
    <div class="leyenda-z">${ORDEN_Z.map((z) => `<span><span class="punto-z" style="background:${ZONA_COLOR[z]}"></span>${ZONA_NOMBRE[z]}</span>`).join("")}<span><span class="punto-z" style="background:#8FA0AD;opacity:.5"></span>Rango en Asturias</span></div>
    <div class="grafica" id="g36"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperatura media prevista por zona en las próximas 36 horas">${noche}${rej}${banda}${lineas}${etiquetas}${ejeX}
      <line class="cruz" id="g36-cruz" y1="${ar}" y2="${H - ab}" visibility="hidden"/></svg><div class="globo" id="g36-globo" hidden></div></div>
    <p class="pie-t">Media de los concejos de cada zona. Zona sombreada: noche.</p>
  </section>`;
}
function activarGrafica36h() {
  const caja = document.getElementById("g36");
  if (!caja || !serie36) return;
  const svgG = caja.querySelector("svg"), cruz = document.getElementById("g36-cruz"), globo = document.getElementById("g36-globo");
  const vb = svgG.viewBox.baseVal, iz = 26, de = 84, f = serie36;
  const mover = (ev) => {
    const r = svgG.getBoundingClientRect();
    const xs = ((ev.clientX - r.left) / r.width) * vb.width;
    const i = Math.max(0, Math.min(f.length - 1, Math.round(((xs - iz) / (vb.width - iz - de)) * (f.length - 1))));
    const x = iz + (i / (f.length - 1)) * (vb.width - iz - de);
    cruz.setAttribute("x1", x); cruz.setAttribute("x2", x); cruz.setAttribute("visibility", "visible");
    const d = f[i];
    globo.innerHTML = `<b>${esc(nombreDia(d.h.slice(0, 10)))}, ${d.h.slice(11)}:00</b>${ORDEN_Z.map((z) => `<span class="punto-z" style="background:${ZONA_COLOR[z]}"></span>${ZONA_NOMBRE[z]} ${fmt(d[z])}`).join("<br>")}<br><span style="color:var(--suave)">Asturias ${fmt(d.min)} a ${fmt(d.max)}</span>`;
    globo.hidden = false;
    const px = (x / vb.width) * r.width;
    globo.style.left = `${Math.min(Math.max(px - 70, 0), r.width - 150)}px`;
    globo.style.top = `-8px`;
    globo.style.transform = "translateY(-100%)";
  };
  const ocultar = () => { cruz.setAttribute("visibility", "hidden"); globo.hidden = true; };
  svgG.addEventListener("pointermove", mover);
  svgG.addEventListener("pointerdown", mover);
  svgG.addEventListener("pointerleave", ocultar);
}

// 3. Próximos 5 días: rango medio de mínimas a máximas en Asturias y lluvia media
function tarjetaDias() {
  const fechas = [...new Set(estado.concejos.flatMap((c) => (c.tiempo && c.tiempo.dias || []).map((d) => d.fecha)))].sort().slice(0, 5);
  const filas = fechas.map((fe) => {
    const ds = estado.concejos.map((c) => (c.tiempo && c.tiempo.dias || []).find((d) => d.fecha === fe)).filter(Boolean);
    const cuenta = {};
    ds.forEach((d) => {
      const cl = d.cielo || d.codigoCielo ? { c: String(d.codigoCielo || "").replace("n", ""), d: d.cielo } : Object.values(d.cielos || {}).find((y) => y.c || y.d);
      const k = claveCielo(tipoCielo(cl ? { c: String(cl.c || "").replace("n", ""), d: cl.d } : null));
      if (k) cuenta[k] = (cuenta[k] || 0) + 1;
    });
    const tipo = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
    return { fe, mn: media(ds.map((d) => d.min).filter((x) => x != null)), mx: media(ds.map((d) => d.max).filter((x) => x != null)),
      ll: media(ds.map((d) => d.lluvia).filter((x) => x != null)), ico: tipo ? ICONO[tipo[0]] : "" };
  }).filter((x) => x.mn != null && x.mx != null);
  if (!filas.length) return "";
  const lo = Math.min(...filas.map((x) => x.mn)), hi = Math.max(...filas.map((x) => x.mx));
  const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  return `<section class="tarjeta">
    <h3>Próximos días en Asturias</h3>
    <div class="dias5">${filas.map((x) => `
      <div class="d5" title="Media de Asturias: mínima ${fmt(x.mn)}, máxima ${fmt(x.mx)}, lluvia ${x.ll != null ? Math.round(x.ll) + " %" : "–"}">
        <span class="nom">${esc(nombreDia(x.fe).replace(/ \d+$/, ""))}</span><span class="ico">${x.ico}</span>
        <span class="mn">${fmt(x.mn)}</span>
        <span class="rango"><i style="left:${pos(x.mn)}%;width:${Math.max(pos(x.mx) - pos(x.mn), 3)}%;background:linear-gradient(90deg, ${colorTempFijo(x.mn, lo, hi)}, ${colorTempFijo(x.mx, lo, hi)})"></i></span>
        <span class="mx">${fmt(x.mx)}</span>${etiquetaLluvia(x.ll)}
      </div>`).join("")}</div>
    <p class="pie-t">Mínima y máxima medias de los 78 concejos; gota: probabilidad media de lluvia.</p>
  </section>`;
}
function colorTempFijo(v, lo, hi) {
  const t = (v - lo) / (hi - lo || 1);
  for (let i = 1; i < ESCALA_TEMP.length; i++) if (t <= ESCALA_TEMP[i][0]) return mezclar(ESCALA_TEMP[i - 1][1], ESCALA_TEMP[i][1], (t - ESCALA_TEMP[i - 1][0]) / (ESCALA_TEMP[i][0] - ESCALA_TEMP[i - 1][0]));
  return ESCALA_TEMP[ESCALA_TEMP.length - 1][1];
}

// 4. Luz del día en Uviéu (cálculo astronómico, no hace falta pedir nada)
function solDe(fecha, lat = 43.36, lon = -5.85) {
  const rad = Math.PI / 180, [y, m, d] = fecha.split("-").map(Number);
  const jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
  const n = Math.ceil(jd - 2451545 + 0.0008), js = n - lon / 360;
  const M = (357.5291 + 0.98560028 * js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lam = (M + C + 180 + 102.9372) % 360;
  const jt = 2451545 + js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
  const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec))) / rad;
  const aFecha = (j) => new Date((j - 2440587.5) * 86400000);
  return { sale: aFecha(jt - w / 360), pone: aFecha(jt + w / 360) };
}
function tarjetaSol() {
  const hoyS = hoyISO(), ayer = new Date(`${hoyS}T12:00:00`); ayer.setDate(ayer.getDate() - 1);
  const s = solDe(hoyS), sa = solDe(`${ayer.getFullYear()}-${String(ayer.getMonth() + 1).padStart(2, "0")}-${String(ayer.getDate()).padStart(2, "0")}`);
  const hm = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const luz = (s.pone - s.sale) / 60000, dif = Math.round(luz - (sa.pone - sa.sale) / 60000);
  return `<section class="tarjeta">
    <h3>Luz del día en Uviéu</h3>
    <div class="sol"><div><small>Amanece</small><strong>${hm(s.sale)}</strong></div><div><small>Anochece</small><strong>${hm(s.pone)}</strong></div><div><small>Horas de luz</small><strong>${Math.floor(luz / 60)} h ${String(Math.round(luz % 60)).padStart(2, "0")}</strong></div></div>
    <p class="pie-t">${dif === 0 ? "Igual que ayer." : `${Math.abs(dif)} min ${dif < 0 ? "menos" : "más"} que ayer.`}</p>
  </section>`;
}

// ---------- carga ----------
function mostrarEstado() {
  const el = document.getElementById("estado-datos");
  if (!estado) { el.textContent = "Sin datos todavía"; return; }
  const con = estado.concejos.filter((c) => c.tiempo).length;
  const hora = new Date(estado.generado).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const pista = matchMedia("(pointer: coarse)").matches ? " · pellizca el mapa para acercar" : "";
  el.textContent = `${con} de ${estado.concejos.length} concejos · actualizado a las ${hora}${pista}`;
}

async function cargarDatos() {
  try {
    const r = await fetch(`${URL_DATOS}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    estado = await r.json();
    porCodigo = new Map(estado.concejos.map((c) => [c.codigo, c]));
    calcularRango();
    mostrarEstado();
    pintarLista();
    pintar();
    if (activa) abrirFicha(activa);
  } catch {
    document.getElementById("estado-datos").textContent = "No se pudieron cargar los datos. Reintentamos en un momento.";
  }
}

// Si se ha publicado una versión nueva, recargar saltándose la caché del navegador.
const VERSION_APP = "12";
async function comprobarVersion() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const { version } = await r.json();
    if (version && version !== VERSION_APP) {
      const clave = `pueblos-recarga-${version}`;
      let ya = false;
      try { ya = sessionStorage.getItem(clave); sessionStorage.setItem(clave, "1"); } catch { /* sin almacenamiento */ }
      if (!ya) location.replace(`${location.pathname}?v=${version}`);
    }
  } catch { /* sin conexión: seguimos con lo que hay */ }
}

// Al cambiar de hora, repintar con la temperatura y el cielo de la hora nueva.
let horaPintada = claveHora();
setInterval(() => {
  if (claveHora() === horaPintada || !estado) return;
  horaPintada = claveHora();
  pintarLista();
  pintar();
  if (activa) abrirFicha(activa);
}, 60000);

async function iniciar() {
  comprobarVersion();
  setInterval(comprobarVersion, REFRESCO_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) comprobarVersion(); });
  try {
    try { ZONAS = await (await fetch("data/zonas.json?v=1")).json(); } catch { ZONAS = {}; }
    mapa = await (await fetch(URL_MAPA)).json();
    dibujarMapa();
    pintar();
  } catch {
    document.getElementById("estado-datos").textContent = "No se pudo cargar el mapa.";
  }
  await cargarDatos();
  setInterval(cargarDatos, REFRESCO_MS);
}
iniciar();

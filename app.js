"use strict";

// Datos generados por la tarea programada del repo (rama "datos").
const URL_DATOS = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "data/estado.json"
  : "https://raw.githubusercontent.com/mobilityastur/pueblos/datos/estado.json";
const REFRESCO_MS = 15 * 60 * 1000;
const CENTRO = [43.36, -5.85];

const ICONOS_DIA = { sol: "☀︎", nube: "☁︎", lluvia: "🌧", noche: "☾", niebla: "〰", nieve: "❄︎", tormenta: "⛈" };

let mapa = null;
let estado = null;
let marcas = new Map();
let activa = null;

function tipoCielo(texto = "", codigo = "") {
  const t = texto.toLowerCase();
  if (/tormenta/.test(t)) return "tormenta";
  if (/nieve|aguanieve/.test(t)) return "nieve";
  if (/niebla|bruma/.test(t)) return "niebla";
  if (/lluvia|llovi|chubasco|granizo|llovizna/.test(t)) return "lluvia";
  if (/cubierto|nuboso|nubes/.test(t) && !/poco|interv/.test(t)) return "nube";
  if (/despejado|poco nuboso|sol|intervalos/.test(t)) return "sol";
  return String(codigo).endsWith("n") ? "noche" : "sol";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nombreMostrado(c) {
  return c.nombreAst || c.nombre;
}

function diaSemana(fecha) {
  const d = new Date(`${fecha}T12:00:00`);
  return d.toLocaleDateString("ast-ES", { weekday: "short" }).replace(".", "");
}

function hoy(c) {
  return c.tiempo && c.tiempo.dias && c.tiempo.dias[0] ? c.tiempo.dias[0] : null;
}

function iniciarMapa() {
  mapa = L.map("mapa", { zoomControl: true, attributionControl: true }).setView(CENTRO, 9);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd", maxZoom: 18,
  }).addTo(mapa);
  mapa.on("click", () => cerrarFicha());
}

function pintarMarcas() {
  for (const m of marcas.values()) m.remove();
  marcas = new Map();
  const grupo = [];
  for (const c of estado.concejos) {
    if (c.lat == null || c.lon == null) continue;
    const d = hoy(c);
    const temp = d && d.max != null ? `${Math.round(d.max)}°` : "–";
    const icono = L.divIcon({
      className: "",
      html: `<div class="marca${d ? "" : " sin-datos"}"><span class="pildora">${esc(nombreMostrado(c))} · ${temp}</span><span class="pata"></span></div>`,
      iconSize: null,
    });
    const marca = L.marker([c.lat, c.lon], { icon: icono, title: nombreMostrado(c) }).addTo(mapa);
    marca.on("click", (ev) => { L.DomEvent.stopPropagation(ev); abrirFicha(c.codigo); });
    marcas.set(c.codigo, marca);
    grupo.push([c.lat, c.lon]);
  }
  if (grupo.length && !activa) mapa.fitBounds(grupo, { padding: [30, 30] });
}

function marcarActiva(codigo) {
  document.querySelectorAll(".marca.activa").forEach((el) => el.classList.remove("activa"));
  const m = marcas.get(codigo);
  if (m && m.getElement()) m.getElement().querySelector(".marca").classList.add("activa");
}

function abrirFicha(codigo) {
  const c = estado.concejos.find((x) => x.codigo === codigo);
  if (!c) return;
  activa = codigo;
  marcarActiva(codigo);
  const d = hoy(c);
  const tipo = d ? tipoCielo(d.cielo, d.codigoCielo) : "verde";
  const dias = (c.tiempo && c.tiempo.dias) || [];
  const webcams = c.webcams || [];
  const fuentes = [...new Set(webcams.map((w) => w.fuente))].join(" y ");

  const portada = `
    <div class="portada ${esc(tipo)}">
      <h2>${esc(nombreMostrado(c))}</h2>
      ${c.nombreAst && c.nombreAst !== c.nombre ? `<p class="concejo-es">${esc(c.nombre)}</p>` : ""}
      <div class="hoy">
        <span class="grados">${d && d.max != null ? Math.round(d.max) + "°" : "–"}</span>
        <span class="cielo">${d ? esc(d.cielo || "") : "Sin previsión por ahora"}</span>
      </div>
    </div>`;

  const semana = dias.length
    ? `<div class="semana">${dias.map((x) => `
        <div class="dia">
          <b>${esc(diaSemana(x.fecha))}</b>
          <span class="max">${x.max != null ? Math.round(x.max) + "°" : "–"}</span>
          <span class="min">${x.min != null ? Math.round(x.min) + "°" : "–"}</span>
          ${x.lluvia != null ? `<span class="lluvia">💧 ${Math.round(x.lluvia)}%</span>` : ""}
        </div>`).join("")}</div>`
    : `<p class="sin-cam">Todavía no hay previsión para este concejo.</p>`;

  const camaras = webcams.length
    ? `<h3>Webcams en directo</h3>
       <p class="nota">En directo en la web de ${esc(fuentes)}; se abre aparte.</p>
       ${webcams.map((w) => `<a class="cam" href="${esc(w.url)}" target="_blank" rel="noopener"><span>${esc(w.nombre)}</span><span>↗</span></a>`).join("")}`
    : `<h3>Webcams en directo</h3><p class="sin-cam">Todavía no tenemos una webcam pública para este concejo.</p>`;

  const elab = c.tiempo && c.tiempo.elaborado ? `Previsión AEMET elaborada ${esc(c.tiempo.elaborado)}.` : "";
  const ficha = document.getElementById("ficha");
  ficha.innerHTML = `
    <button class="cerrar" aria-label="Cerrar">×</button>
    ${portada}
    <div class="cuerpo">
      ${semana}
      ${camaras}
      <p class="pie">${elab} Fuente del tiempo: AEMET OpenData.</p>
    </div>`;
  ficha.hidden = false;
  ficha.scrollTop = 0;
  ficha.querySelector(".cerrar").addEventListener("click", (ev) => { ev.stopPropagation(); cerrarFicha(); });
  if (c.lat != null) mapa.panTo([c.lat, c.lon], { animate: true });
}

function cerrarFicha() {
  activa = null;
  document.getElementById("ficha").hidden = true;
  marcarActiva(null);
}

function mostrarEstado() {
  const el = document.getElementById("estado-datos");
  if (!estado) { el.textContent = "Sin datos todavía"; return; }
  const con = estado.concejos.filter((c) => c.tiempo).length;
  const hora = new Date(estado.generado).toLocaleTimeString("ast-ES", { hour: "2-digit", minute: "2-digit" });
  el.textContent = `${con} de ${estado.concejos.length} concejos · actualizado a las ${hora}`;
}

async function cargarDatos() {
  try {
    const r = await fetch(`${URL_DATOS}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    estado = await r.json();
    pintarMarcas();
    mostrarEstado();
    if (activa) abrirFicha(activa);
  } catch (e) {
    document.getElementById("estado-datos").textContent = "No se pudieron cargar los datos. Reintentamos en un momento.";
  }
}

iniciarMapa();
cargarDatos();
setInterval(cargarDatos, REFRESCO_MS);

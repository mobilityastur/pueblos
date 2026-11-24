"""Información regional de AEMET para el panel de la app:
avisos, predicción en texto para Asturias, comparación con lo normal y montaña.

Cada fuente tiene su frecuencia y se guarda en la caché, de modo que si una
petición falla se sigue mostrando el último dato válido.
"""
import io
import json
import re
import tarfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

BASE = "https://opendata.aemet.es/opendata/api"
UA = "mobilityastur-pueblos/1.0 (+https://github.com/mobilityastur/pueblos)"
MADRID = ZoneInfo("Europe/Madrid")
CAP = {"c": "urn:oasis:names:tc:emergency:cap:1.2"}

# (clave, nombre visible, estación de observación, estación de valores normales)
ESTACIONES = [
    ("oviedo", "Uviéu", "1249X", "1249I"),
    ("gijon", "Xixón", "1208H", "1208H"),
    ("aeropuerto", "Aeropuertu", "1212E", "1212E"),
]
CADA = {"avisos": 0, "texto": 3600, "obs": 3600, "montana": 3 * 3600, "normales": 365 * 86400}
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]


def _pedir(url, cabeceras=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(cabeceras or {})})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


def _aemet_bruto(ruta, clave, pausa):
    """Hace la petición en dos pasos de AEMET y devuelve los bytes de 'datos'."""
    pausa()
    meta = json.loads(_pedir(BASE + ruta, {"api_key": clave, "Accept": "application/json"}).decode("utf-8", "replace"))
    if meta.get("estado") != 200 or not meta.get("datos"):
        raise RuntimeError(f"AEMET: {meta.get('estado')} {meta.get('descripcion')}")
    pausa()
    return _pedir(meta["datos"])


def _json_iso(b):
    return json.loads(b.decode("iso-8859-15"))


def _sin_tildes(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


# ---------- avisos (CAP) ----------
def parsear_avisos(b, ahora):
    """Avisos amarillos, naranjas o rojos vigentes o futuros, uno por zona, fenómeno y día."""
    vistos = {}
    try:
        tar = tarfile.open(fileobj=io.BytesIO(b), mode="r:*")
    except tarfile.TarError:
        return []
    for m in tar.getmembers():
        if not m.isfile() or not m.name.endswith(".xml"):
            continue
        try:
            raiz = ET.parse(tar.extractfile(m)).getroot()
        except ET.ParseError:
            continue
        tipo = raiz.findtext("c:msgType", namespaces=CAP) or ""
        enviado = raiz.findtext("c:sent", namespaces=CAP) or ""
        for info in raiz.findall("c:info", CAP):
            if info.findtext("c:language", namespaces=CAP) != "es-ES":
                continue
            params = {p.findtext("c:valueName", namespaces=CAP): p.findtext("c:value", namespaces=CAP) for p in info.findall("c:parameter", CAP)}
            nivel = (params.get("AEMET-Meteoalerta nivel") or "").lower()
            fen = (info.findtext("c:eventCode/c:value", namespaces=CAP) or ";").split(";")
            area = info.find("c:area", CAP)
            zona = area.findtext("c:areaDesc", namespaces=CAP) if area is not None else ""
            codzona = area.findtext("c:geocode/c:value", namespaces=CAP) if area is not None else zona
            onset = info.findtext("c:onset", namespaces=CAP) or ""
            expires = info.findtext("c:expires", namespaces=CAP) or ""
            clave = (codzona, fen[0], onset[:10])
            previo = vistos.get(clave)
            if previo and previo["_enviado"] >= enviado:
                continue
            vistos[clave] = {
                "_enviado": enviado, "_tipo": tipo, "nivel": nivel,
                "fenomeno": (fen[1] if len(fen) > 1 else "").strip(),
                "zona": zona.replace("Costa - ", "Costa: "),
                "desde": onset, "hasta": expires,
                "texto": (info.findtext("c:description", namespaces=CAP) or "").strip(),
                "probabilidad": params.get("AEMET-Meteoalerta probabilidad") or "",
            }
    avisos = []
    for a in vistos.values():
        if a["_tipo"] == "Cancel" or a["nivel"] not in ("amarillo", "naranja", "rojo"):
            continue
        try:
            if datetime.fromisoformat(a["hasta"]) < ahora:
                continue
        except ValueError:
            pass
        avisos.append({k: v for k, v in a.items() if not k.startswith("_")})
    orden = {"rojo": 0, "naranja": 1, "amarillo": 2}
    avisos.sort(key=lambda a: (a["desde"], orden.get(a["nivel"], 3), a["zona"]))
    return avisos


# ---------- predicción en texto para Asturias ----------
def parsear_texto(b):
    t = b.decode("iso-8859-15").replace("\r", "")
    valido = re.search(r"V[ÁA]LIDA PARA EL\s+\w+\s+(\d{1,2})", t, re.I)
    elab = re.search(r"D[ÍI]A\s+(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})\s+A LAS\s+(\d{1,2}:\d{2})", t, re.I)

    def seccion(ini, fin):
        m = re.search(ini + r"\s*\n(.*?)(?=" + fin + r"|\Z)", t, re.S | re.I)
        return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
    elaborado = ""
    if elab:
        mes = MESES.index(_sin_tildes(elab.group(2))) + 1 if _sin_tildes(elab.group(2)) in MESES else None
        if mes:
            elaborado = f"{elab.group(3)}-{mes:02d}-{int(elab.group(1)):02d}T{elab.group(4).zfill(5)}"
    return {
        "dia": int(valido.group(1)) if valido else None,
        "elaborado": elaborado,
        "fenomenos": seccion(r"A\.-\s*FEN[ÓO]MENOS SIGNIFICATIVOS", r"\n\s*B\.-"),
        "prediccion": seccion(r"B\.-\s*PREDICCI[ÓO]N", r"\n\s*C\.-"),
    }


def elegir_textos(textos, ahora_local):
    """De los textos 'hoy' y 'mañana' de AEMET, elige por fecha de validez (a veces 'hoy' está desfasado)."""
    hoy = ahora_local.date()
    man = hoy + timedelta(days=1)
    salida = {}
    for t in sorted(textos, key=lambda x: x.get("elaborado") or ""):
        if not t.get("prediccion") or not t.get("dia"):
            continue
        if t["dia"] == hoy.day:
            salida["hoy"] = t
        elif t["dia"] == man.day:
            salida["manana"] = t
    return salida


# ---------- observación frente a valores normales ----------
def parsear_obs(b, hoy_local):
    regs = _json_iso(b)
    hoy = [r for r in regs if datetime.strptime(r["fint"], "%Y-%m-%dT%H:%M:%S%z").astimezone(MADRID).date() == hoy_local]
    ult = regs[-1] if regs else {}
    maxs = [r.get("tamax", r.get("ta")) for r in hoy if r.get("tamax", r.get("ta")) is not None]
    mins = [r.get("tamin", r.get("ta")) for r in hoy if r.get("tamin", r.get("ta")) is not None]
    return {
        "hora": ult.get("fint"), "ahora": ult.get("ta"),
        "max_hoy": max(maxs) if maxs else None, "min_hoy": min(mins) if mins else None,
        "lluvia_hoy": round(sum(r.get("prec") or 0 for r in hoy), 1) if hoy else None,
    }


def parsear_normales(b):
    """Medias mensuales 1991-2020 de máximas, mínimas y temperatura media, por mes."""
    salida = {}
    for m in _json_iso(b):
        try:
            mes = int(m.get("mes"))
        except (TypeError, ValueError):
            continue
        if 1 <= mes <= 12:
            num = lambda k: float(m[k]) if m.get(k) not in (None, "", "-") else None
            salida[str(mes)] = {"max": num("tm_max_md"), "min": num("tm_min_md"), "media": num("tm_mes_md")}
    return salida


# ---------- montaña: Picos de Europa ----------
def parsear_montana(b):
    m = _json_iso(b)[0]
    secc = {s.get("nombre"): s for s in m.get("seccion", [])}
    pred = {a.get("nombre"): a.get("texto") for a in (secc.get("prediccion") or {}).get("apartado", [])}
    libre = {a.get("nombre"): a.get("texto") for a in (secc.get("atmosferalibre") or {}).get("apartado", [])}
    lugares = [{"nombre": l.get("nombre"), "altitud": l.get("altitud"), "min": l.get("minima"), "max": l.get("maxima"),
                "st_min": l.get("stminima")} for l in (secc.get("sensacion_termica") or {}).get("lugar", [])]
    return {"cielo": pred.get("nubosidad"), "precipitacion": pred.get("pcp"), "tormentas": pred.get("tormentas"),
            "temperaturas": pred.get("temperatura"), "viento": pred.get("viento"),
            "isocero": libre.get("isocero"), "lugares": lugares}


# ---------- todo junto ----------
def obtener_region(clave, previo, ahora, pausa, errores):
    """Devuelve (region para estado.json, caché nueva de fuentes)."""
    cache = dict(previo or {})
    ahora_local = ahora.astimezone(MADRID)

    def toca(nombre, frecuencia):
        ts = (cache.get(nombre) or {}).get("ts")
        return not ts or (ahora - datetime.fromisoformat(ts)).total_seconds() >= frecuencia

    def guardar(nombre, datos):
        cache[nombre] = {"ts": ahora.isoformat(), "datos": datos}

    def intentar(nombre, frecuencia, funcion):
        if not clave or not toca(nombre, frecuencia):
            return
        try:
            guardar(nombre, funcion())
        except Exception as e:  # noqa: BLE001 - se mantiene el dato anterior
            errores.append(f"{nombre}: {e}")

    intentar("avisos", CADA["avisos"], lambda: parsear_avisos(_aemet_bruto("/avisos_cap/ultimoelaborado/area/63", clave, pausa), ahora))
    intentar("texto_hoy", CADA["texto"], lambda: parsear_texto(_aemet_bruto("/prediccion/ccaa/hoy/ast", clave, pausa)))
    intentar("texto_manana", CADA["texto"], lambda: parsear_texto(_aemet_bruto("/prediccion/ccaa/manana/ast", clave, pausa)))
    intentar("montana", CADA["montana"], lambda: parsear_montana(_aemet_bruto("/prediccion/especifica/" + quote("montaña") + "/pasada/area/peu1/dia/0", clave, pausa)))
    for cl, _, obs, norm in ESTACIONES:
        intentar(f"obs_{cl}", CADA["obs"], lambda obs=obs: parsear_obs(_aemet_bruto(f"/observacion/convencional/datos/estacion/{obs}", clave, pausa), ahora_local.date()))
        intentar(f"normales_{cl}", CADA["normales"], lambda norm=norm: parsear_normales(_aemet_bruto(f"/valores/climatologicos/normales/estacion/{norm}", clave, pausa)))

    dato = lambda n: (cache.get(n) or {}).get("datos")
    # Los avisos guardados se vuelven a filtrar por si alguno ha caducado desde entonces
    avisos = [a for a in dato("avisos") or [] if not a.get("hasta") or datetime.fromisoformat(a["hasta"]) >= ahora]
    mes = str(ahora_local.month)
    estaciones = []
    for cl, nombre, _, _ in ESTACIONES:
        o = dato(f"obs_{cl}")
        n = (dato(f"normales_{cl}") or {}).get(mes)
        if o and o.get("hora") and datetime.strptime(o["hora"], "%Y-%m-%dT%H:%M:%S%z").astimezone(MADRID).date() != ahora_local.date():
            o = None  # observación de otro día: no vale para comparar
        if o or n:
            estaciones.append({"clave": cl, "nombre": nombre, "obs": o, "normal": n})
    region = {
        "avisos": avisos,
        "texto": elegir_textos([t for t in (dato("texto_hoy"), dato("texto_manana")) if t], ahora_local),
        "estaciones": estaciones,
        "montana": dato("montana"),
        "mes": MESES[ahora_local.month - 1],
    }
    return region, cache

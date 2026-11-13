#!/usr/bin/env python3
"""Genera estado.json para Pueblos de Asturias.

Para cada uno de los 78 concejos de Asturias (códigos INE 33001-33078, que son los
mismos que usa AEMET) descarga la predicción diaria del municipio y junta
coordenadas, nombres y webcams desde data/.

Uso: python scripts/actualizar.py --salida out [--previo carpeta_con_cache.json]
Solo biblioteca estándar. La clave de AEMET va en la variable AEMET_API_KEY.
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent.parent
UA = "mobilityastur-pueblos/1.0 (+https://github.com/mobilityastur/pueblos)"
URL_MUNICIPIOS = "https://opendata.aemet.es/opendata/api/maestro/municipios"
URL_PREDICCION = "https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/{codigo}"
URL_HORARIA = "https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/horaria/{codigo}"
HORAS = 36            # horas de predicción horaria que guardamos desde la hora actual
DIARIA_CADA_S = 3 * 3600  # la diaria (5 días) cambia poco: se pide cada 3 horas
PAUSA_S = 2.0  # AEMET limita las peticiones: vamos despacio
REINTENTOS = 3
ESPERA_429_S = 10
PRESUPUESTO_S = 17 * 60  # tiempo máximo de descargas; después publicamos lo que haya
INICIO = time.monotonic()
DIAS = 5
AHORA = datetime.now(timezone.utc)
HOY_MADRID = AHORA.astimezone(ZoneInfo("Europe/Madrid")).date().isoformat()
HORA_MADRID = AHORA.astimezone(ZoneInfo("Europe/Madrid")).strftime("%Y-%m-%dT%H")


def get_json(url, cabeceras=None, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(cabeceras or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    for codificacion in ("utf-8", "latin-1"):
        try:
            return json.loads(raw.decode(codificacion))
        except UnicodeDecodeError:
            continue
    raise ValueError("respuesta no decodificable")


def aemet(url, clave):
    """La API de AEMET responde con una URL 'datos' donde está el contenido real."""
    meta = get_json(url, {"api_key": clave, "Accept": "application/json"})
    if meta.get("estado") != 200 or "datos" not in meta:
        raise RuntimeError(f"AEMET: {meta.get('estado')} {meta.get('descripcion')}")
    return get_json(meta["datos"])


def con_reintentos(url, clave):
    """Reintenta cuando AEMET responde 429 (demasiadas peticiones), esperando cada vez más."""
    for intento in range(REINTENTOS):
        if time.monotonic() - INICIO > PRESUPUESTO_S:
            raise TimeoutError("presupuesto de tiempo agotado")
        time.sleep(PAUSA_S)
        try:
            return aemet(url, clave)
        except urllib.error.HTTPError as e:
            if e.code != 429 or intento == REINTENTOS - 1:
                raise
            time.sleep(ESPERA_429_S * (intento + 1))


ARTICULOS = {"el", "la", "los", "las", "l"}


def normalizar(texto):
    """'Las Regueras', 'Regueras (Las)' y 'Regueras, Las' quedan igual: 'regueras'."""
    sin_tildes = unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode()
    palabras = re.sub(r"[^a-z0-9]+", " ", sin_tildes.lower()).split()
    return " ".join(w for w in palabras if w not in ARTICULOS)


def claves_nombre(nombre):
    """AEMET puede dar nombres dobles ('Gijón/Xixón'): vale cualquiera de las partes."""
    return {normalizar(parte) for parte in re.split(r"[/]", nombre or "") if parte.strip()}


def parsear_coordenada(valor):
    """AEMET puede dar la coordenada en decimal, en DDMMSS+letra (433602N)
    o en grados, minutos y segundos (43° 36' 02" N). Devuelve grados decimales."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    s = str(valor).strip().replace(",", ".")
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return float(s)
    signo = -1 if re.search(r"[SWO]\s*$", s, re.I) else 1
    m = re.fullmatch(r"(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)\s*[NSEWO]?", s, re.I)
    if m:
        return signo * (int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600)
    m = re.fullmatch(r"(-?\d{1,3})\s*[°º]?\s*(\d{1,2})?\s*['′]?\s*(\d{1,2}(?:\.\d+)?)?\s*[\"″]?\s*[NSEWO]?", s, re.I)
    if m:
        grados = abs(float(m[1])) + float(m[2] or 0) / 60 + float(m[3] or 0) / 3600
        return signo * grados if m[1][0] != "-" else -grados
    try:
        return float(s.rstrip("NSEWOnsewo "))
    except ValueError:
        return None


def resumir_dia(dia):
    cielos = [c for c in dia.get("estadoCielo") or [] if (c.get("value") or c.get("descripcion"))]
    # Cielo general del día: el que no tiene periodo, o el de 00-24, o el primero con dato
    cielo = (next((c for c in cielos if not c.get("periodo")), None)
             or next((c for c in cielos if c.get("periodo") == "00-24"), None)
             or (cielos[0] if cielos else {}))
    # Y el de cada tramo horario (00-06, 06-12...), para mostrar el del momento
    tramos = {(c.get("periodo") or ""): {"c": c.get("value") or "", "d": c.get("descripcion") or ""} for c in cielos}
    probs = [float(p.get("value") or 0) for p in dia.get("probPrecipitacion") or [] if str(p.get("value", "")).strip() != ""]
    temp = dia.get("temperatura") or {}
    return {
        "fecha": (dia.get("fecha") or "")[:10],
        "max": temp.get("maxima"),
        "min": temp.get("minima"),
        "cielo": cielo.get("descripcion") or "",
        "codigoCielo": cielo.get("value") or "",
        "cielos": tramos,
        "lluvia": max(probs) if probs else None,
    }


def parsear_prediccion(datos):
    """datos: lista con un elemento por municipio; cogemos el primero.
    Descartamos los días anteriores a hoy (la API puede devolver el día en curso desde la noche anterior)."""
    if not datos:
        return None
    dias = (datos[0].get("prediccion") or {}).get("dia") or []
    resumen = [r for r in (resumir_dia(d) for d in dias) if r["fecha"] >= HOY_MADRID][:DIAS]
    return {"elaborado": datos[0].get("elaborado"), "dias": resumen} if resumen else None


def numero(v):
    """AEMET da números como texto; 'Ip' (inapreciable) cuenta como 0."""
    if v is None or str(v).strip() == "":
        return None
    if str(v).strip().lower() == "ip":
        return 0.0
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def parsear_horaria(datos, desde):
    """Lista de horas [{h:'AAAA-MM-DDTHH', t, c, d, p, mm}] a partir de la hora 'desde'."""
    if not datos:
        return []
    horas = []
    for dia in (datos[0].get("prediccion") or {}).get("dia") or []:
        fecha = (dia.get("fecha") or "")[:10]
        cielo = {x["periodo"]: x for x in dia.get("estadoCielo") or [] if x.get("periodo")}
        lluvia_mm = {x["periodo"]: x.get("value") for x in dia.get("precipitacion") or [] if x.get("periodo")}
        probs = [x for x in dia.get("probPrecipitacion") or [] if len(str(x.get("periodo", ""))) == 4]
        for x in dia.get("temperatura") or []:
            hh = str(x.get("periodo") or "").zfill(2)
            if not hh.isdigit():
                continue
            h = int(hh)
            prob = None
            for pr in probs:
                a, b = int(pr["periodo"][:2]), int(pr["periodo"][2:])
                dentro = a <= h < b if a < b else (h >= a or h < b)
                if dentro:
                    prob = numero(pr.get("value"))
            cl = cielo.get(hh) or cielo.get(str(h)) or {}
            horas.append({"h": f"{fecha}T{hh}", "t": numero(x.get("value")), "c": cl.get("value") or "",
                          "d": cl.get("descripcion") or "", "p": prob, "mm": numero(lluvia_mm.get(hh))})
    horas.sort(key=lambda x: x["h"])
    return [x for x in horas if x["h"] >= desde][:HORAS]


def cargar_datos_locales():
    concejos = json.loads((RAIZ / "data" / "concejos.json").read_text(encoding="utf-8"))
    webcams = json.loads((RAIZ / "data" / "webcams.json").read_text(encoding="utf-8"))
    nombres_ast = json.loads((RAIZ / "data" / "nombres_ast.json").read_text(encoding="utf-8"))
    return concejos, webcams, nombres_ast


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", required=True)
    ap.add_argument("--previo", help="carpeta con cache.json de la ejecución anterior")
    args = ap.parse_args()

    clave = os.environ.get("AEMET_API_KEY", "").strip()
    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)

    cache_previo = {}
    if args.previo and (Path(args.previo) / "cache.json").exists():
        cache_previo = json.loads((Path(args.previo) / "cache.json").read_text(encoding="utf-8"))

    concejos_base, webcams, nombres_ast = cargar_datos_locales()
    errores = []

    # 1. Coordenadas y códigos desde el maestro de municipios de AEMET
    maestro = {}
    if clave:
        try:
            for m in aemet(URL_MUNICIPIOS, clave):
                codigo = str(m.get("id", "")).replace("id", "")
                if codigo.startswith("33"):
                    maestro[codigo] = m
        except Exception as e:  # noqa: BLE001 - seguimos con lo que hubiera
            errores.append(f"maestro municipios: {e}")
    else:
        errores.append("Falta el secreto AEMET_API_KEY")

    # Emparejar cada concejo con su código real de AEMET/INE por el nombre
    # (los códigos INE no siguen el orden alfabético actual).
    codigos = dict(cache_previo.get("_codigos") or {})
    if maestro:
        por_nombre = {}
        for cod, m in maestro.items():
            for k in claves_nombre(m.get("nombre")):
                por_nombre[k] = cod
        for c in concejos_base:
            cod = next((por_nombre[k] for k in claves_nombre(c["nombre"]) if k in por_nombre), None)
            if cod:
                codigos[c["nombre"]] = cod
            else:
                errores.append(f"{c['nombre']}: no aparece en el maestro de AEMET")
        if len(set(codigos.values())) != len(codigos):
            errores.append("hay concejos con el mismo código: revisar nombres")

    # 2. Predicción por concejo
    resultado = []
    diarias = {}
    for c in concejos_base:
        codigo = codigos.get(c["nombre"])
        if not codigo:
            continue  # sin código fiable preferimos no pintarlo antes que pintarlo mal
        ficha = maestro.get(codigo, {})
        lat = parsear_coordenada(ficha.get("latitud")) or c.get("lat")
        lon = parsear_coordenada(ficha.get("longitud")) or c.get("lon")
        previo = cache_previo.get(codigo) or {}
        hay_tiempo = lambda: clave and time.monotonic() - INICIO <= PRESUPUESTO_S

        # Predicción diaria (5 días): solo si la guardada tiene más de 3 horas
        tiempo, diaria_ts = None, previo.get("diaria_ts")
        edad = (AHORA - datetime.fromisoformat(diaria_ts)).total_seconds() if diaria_ts else None
        if hay_tiempo() and (edad is None or edad > DIARIA_CADA_S or not previo.get("tiempo")):
            try:
                tiempo = parsear_prediccion(con_reintentos(URL_PREDICCION.format(codigo=codigo), clave))
                if tiempo:
                    diaria_ts = AHORA.isoformat()
            except Exception as e:  # noqa: BLE001
                errores.append(f"{c['nombre']} (diaria): {e}")
        if tiempo is None:
            tiempo = previo.get("tiempo")  # conserva el último dato válido
            if tiempo:
                tiempo["dias"] = [d for d in tiempo["dias"] if d["fecha"] >= HOY_MADRID]
                tiempo = tiempo if tiempo["dias"] else None

        # Predicción horaria: en cada ejecución
        horas = None
        if hay_tiempo():
            try:
                horas = parsear_horaria(con_reintentos(URL_HORARIA.format(codigo=codigo), clave), HORA_MADRID) or None
            except Exception as e:  # noqa: BLE001
                errores.append(f"{c['nombre']} (horaria): {e}")
        if horas is None:
            horas = [x for x in previo.get("horas") or [] if x["h"] >= HORA_MADRID] or None
        if horas:
            tiempo = dict(tiempo or {"dias": []})
            tiempo["horas"] = horas
        if tiempo and tiempo.get("dias"):
            diarias[codigo] = diaria_ts
        resultado.append({
            "codigo": codigo,
            "nombre": c["nombre"],
            "nombreAst": nombres_ast.get(c["nombre"]) or c["nombre"],
            "lat": lat,
            "lon": lon,
            "webcams": webcams.get(c["nombre"], []),
            "tiempo": tiempo,
        })

    ahora_iso = AHORA.strftime("%Y-%m-%dT%H:%M:%SZ")
    estado = {
        "generado": ahora_iso,
        "fuentes": {
            "tiempo": {"nombre": "AEMET OpenData", "ok": bool(clave) and not any("AEMET" in e for e in errores)},
        },
        "errores": errores[:50],
        "concejos": resultado,
    }
    (salida / "estado.json").write_text(json.dumps(estado, ensure_ascii=False, indent=1), encoding="utf-8")
    cache = {}
    for r in resultado:
        if not r["tiempo"]:
            continue
        sin_horas = {k: v for k, v in r["tiempo"].items() if k != "horas"}
        cache[r["codigo"]] = {"tiempo": sin_horas if sin_horas.get("dias") else None,
                              "diaria_ts": diarias.get(r["codigo"]), "horas": r["tiempo"].get("horas")}
    cache["_codigos"] = codigos
    (salida / "cache.json").write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"{len(resultado)} concejos, {sum(1 for r in resultado if r['tiempo'] and r['tiempo'].get('dias'))} con diaria, "
          f"{sum(1 for r in resultado if r['tiempo'] and r['tiempo'].get('horas'))} con horaria, {len(errores)} avisos")
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
PAUSA_S = 2.0  # AEMET limita las peticiones: vamos despacio
REINTENTOS = 3
ESPERA_429_S = 10
PRESUPUESTO_S = 17 * 60  # tiempo máximo de descargas; después publicamos lo que haya
INICIO = time.monotonic()
DIAS = 5
AHORA = datetime.now(timezone.utc)
HOY_MADRID = AHORA.astimezone(ZoneInfo("Europe/Madrid")).date().isoformat()


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
    cielos = dia.get("estadoCielo") or []
    cielo = next((c for c in cielos if not c.get("periodo")), cielos[0] if cielos else {})
    probs = [float(p.get("value") or 0) for p in dia.get("probPrecipitacion") or [] if str(p.get("value", "")).strip() != ""]
    temp = dia.get("temperatura") or {}
    return {
        "fecha": (dia.get("fecha") or "")[:10],
        "max": temp.get("maxima"),
        "min": temp.get("minima"),
        "cielo": cielo.get("descripcion") or "",
        "codigoCielo": cielo.get("value") or "",
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
    for c in concejos_base:
        codigo = codigos.get(c["nombre"])
        if not codigo:
            continue  # sin código fiable preferimos no pintarlo antes que pintarlo mal
        ficha = maestro.get(codigo, {})
        lat = parsear_coordenada(ficha.get("latitud")) or c.get("lat")
        lon = parsear_coordenada(ficha.get("longitud")) or c.get("lon")
        tiempo = None
        if clave and time.monotonic() - INICIO <= PRESUPUESTO_S:
            try:
                tiempo = parsear_prediccion(con_reintentos(URL_PREDICCION.format(codigo=codigo), clave))
            except Exception as e:  # noqa: BLE001
                errores.append(f"{c['nombre']}: {e}")
        if tiempo is None:
            tiempo = (cache_previo.get(codigo) or {}).get("tiempo")  # conserva el último dato válido
            if tiempo:
                tiempo["dias"] = [d for d in tiempo["dias"] if d["fecha"] >= HOY_MADRID]
                tiempo = tiempo if tiempo["dias"] else None
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
    cache = {r["codigo"]: {"tiempo": r["tiempo"]} for r in resultado if r["tiempo"]}
    cache["_codigos"] = codigos
    (salida / "cache.json").write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"{len(resultado)} concejos, {sum(1 for r in resultado if r['tiempo'])} con previsión, {len(errores)} avisos")
    return 0


if __name__ == "__main__":
    sys.exit(main())

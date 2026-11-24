#!/usr/bin/env python3
"""Reconocimiento temporal: guarda en bruto las respuestas de las fuentes de AEMET
que se van a usar en la fase 2, para ajustar los parsers al formato real.
Uso: python scripts/muestras.py --salida out/muestras   (necesita AEMET_API_KEY)
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

BASE = "https://opendata.aemet.es/opendata/api"
UA = "mobilityastur-pueblos/1.0 (+https://github.com/mobilityastur/pueblos)"
FUENTES = {
    "avisos_63": "/avisos_cap/ultimoelaborado/area/63",
    "ccaa_hoy_ast": "/prediccion/ccaa/hoy/ast",
    "ccaa_manana_ast": "/prediccion/ccaa/manana/ast",
    "obs_1249I": "/observacion/convencional/datos/estacion/1249I",
    "obs_1208H": "/observacion/convencional/datos/estacion/1208H",
    "obs_1212E": "/observacion/convencional/datos/estacion/1212E",
    "normales_1249I": "/valores/climatologicos/normales/estacion/1249I",
    "montana_peu1_0": "/prediccion/especifica/" + quote("montaña") + "/pasada/area/peu1/dia/0",
    "montana_peu1": "/prediccion/especifica/" + quote("montaña") + "/pasada/area/peu1",
}


def pedir(url, cabeceras=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(cabeceras or {})})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read(), r.headers.get("Content-Type", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", required=True)
    args = ap.parse_args()
    clave = os.environ.get("AEMET_API_KEY", "").strip()
    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    resumen = {}
    for nombre, ruta in FUENTES.items():
        time.sleep(3)
        info = {"ruta": ruta}
        try:
            raw, ctype = pedir(BASE + ruta, {"api_key": clave, "Accept": "application/json"})
            meta = json.loads(raw.decode("utf-8", "replace"))
            info["meta"] = meta
            if meta.get("datos"):
                time.sleep(1)
                datos, ctype2 = pedir(meta["datos"])
                info["tipo"] = ctype2
                info["bytes"] = len(datos)
                ext = ".tar" if datos[:2] == b"\x1f\x8b" or b"ustar" in datos[:600] else ".txt"
                (salida / f"{nombre}{ext}").write_bytes(datos)
                info["fichero"] = f"{nombre}{ext}"
        except urllib.error.HTTPError as e:
            info["error"] = f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            info["error"] = str(e)
        resumen[nombre] = info
        print(nombre, info.get("error") or info.get("bytes"))
    (salida / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

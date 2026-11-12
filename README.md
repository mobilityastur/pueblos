# Pueblos de Asturias

App web (instalable) con la previsión del tiempo y las webcams en directo de los 78 concejos de Asturias. Portada con un mapa de concejos coloreado por temperatura o cielo (se toca la superficie del concejo), lista con buscador y ficha tipo postal.

## Cómo funciona

- `data/concejos.json`: los 78 concejos. El código de cada uno se toma del maestro de municipios de AEMET emparejando por nombre (los códigos INE no siguen el orden alfabético actual).
- `data/mapa.json`: siluetas de los concejos en SVG, generadas con `scripts/mapa.mjs` a partir de es-atlas (límites del IGN, CC-BY 4.0).
- `data/webcams.json`: webcams públicas por concejo, de momento las de la app de costa. Se abren en la web de origen; no se reproducen sus imágenes.
- `data/nombres_ast.json`: nombres en asturiano. Es un borrador pendiente de revisión; los que faltan se muestran en castellano.
- `scripts/actualizar.py`: descarga coordenadas y previsión de 5 días desde AEMET OpenData y escribe `estado.json`. Si una petición falla, conserva la última previsión válida.
- `.github/workflows/datos.yml`: lo ejecuta cada media hora y publica el resultado en la rama `datos`.

La clave de AEMET va en el secreto del repo `AEMET_API_KEY`.

## Cómo probarlo en local

    python3 scripts/actualizar.py --salida out
    cp out/estado.json data/estado.json
    python3 -m http.server 8000

Después, abre http://localhost:8000.

## Pendiente

- Revisar `data/nombres_ast.json`.
- Categorías (montaña, ríos, poblaciones, puertos) y temáticas (Sidra, Picos de Europa, etc.) como filtros.
- Webcams de los concejos que aún no tienen cámara.
- Localidades dentro de cada concejo, con su propia webcam, si se decide ampliar.
- Service worker para uso sin conexión.

Al publicar cambios en la app, sube el número de `version.json`, de `VERSION_APP` en `app.js` y de los `?v=` de `index.html`: las apps ya abiertas se recargan solas.

Fuentes: AEMET OpenData (predicción municipal). Límites de concejos: IGN, vía es-atlas (CC-BY 4.0).

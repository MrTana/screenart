# Galería de arte (screenart) — notas para Claude

Pantalla de arte para la TV (Samsung con Freebox) y el móvil: muestra obras de museos que cambian solas. Una sola página web (PWA)
publicada en **https://screenart.pages.dev** (Cloudflare Pages, se despliega sola con cada push a `main` de GitHub `MrTana/screenart`).

## Reglas del usuario (importantes)

- **Responder siempre en español.** Explicar en lenguaje sencillo; no es programador.
- **No enviarle el archivo HTML** (ni otros archivos del código) salvo que lo pida.
- **Todo cambio debe funcionar igual en todas partes:** TV, versión móvil y mando (el móvil conectado a la TV con `?c=código`).
- **Colecciones rápidas:** cada una parte de cero (borra todos los filtros y marca todos los museos) y pone solo lo suyo. Antes de crear
  colecciones nuevas, proponer una tabla de filtros y esperar su visto bueno.
- En la TV no debe aparecer nada que estorbe a la pintura (avisos, «buscando…»): eso va en el menú o en el mando.
- Comprobar lo que se pueda (pruebas, capturas con Playwright) y decir con claridad qué no se pudo probar (servicios reales, su TV).
- La TV y el mando se actualizan solos (comprueban versión nueva cada 5 min y se recargan entre obras); avisar si un cambio necesita recargar.

## Cómo se trabaja

- Código fuente en `src/`: `core.js` (fuentes, filtros, colecciones), `ui.js` (pantalla, menú, mando, relé), `template.html` (HTML y CSS),
  `sw.js` (service worker), `vendor/qrcode.min.js`.
- **`node build.mjs`** junta todo en `index.html` y `sw.js` (con la huella de versión y la fecha en hora de París). `index.html` y `sw.js`
  se generan: no editarlos a mano, pero sí subirlos (Cloudflare publica el repositorio tal cual).
- **`npm test`** (jsdom, red simulada): adapters, smoke, queue, pwa, sources, remote (mando y relé), exclude, favloop. Deben pasar antes de subir.
  Algunas pruebas del mando dependen de tiempos y fallan muy de vez en cuando: repetir antes de buscar un error.
- Subir: commit (mensajes en español) y `git pull --rebase origin main && git push origin HEAD:main` (hay bots que suben datos a `main`).
- Desde el entorno en la nube no se llega a Wikidata, Wikipedia ni a screenart.pages.dev; sí a la API pública de GitHub
  (`api.github.com`, `raw.githubusercontent.com`) para ver el resultado de las acciones y los datos generados.

## Piezas principales

- **Museos** (`MUSEUMS` y `MORE_MUSEUMS` en core.js, ~195): cada museo consulta a la vez varias fuentes (`museumFetch`): su API directa o
  lista precargada («Directa»), Wikidata, Commons, Wikipedia, Google Art Project y, si es europeo y hay clave, Europeana.
  «Colecciones abiertas» (`m:open`) junta WikiArt, Commons, Wikipedia, Wikidata y Europeana.
- **Listas precargadas** en `data/<museo>/` (MoMA, NGA, Tate con scripts propios; ~57 museos sin API desde Wikidata con
  `tools/wd-shards.mjs`, lista `WD_SHARDS`). Acción semanal «Colecciones precargadas» (`.github/workflows/colecciones.yml`);
  `data/wd-summary.json` dice qué museo falló. Identificadores de Wikidata encontrados: `WD_QIDS`.
- **Prueba diaria de fuentes** (`tools/probe.mjs`, acción «Prueba diaria de fuentes»): búsqueda real en cada fuente; resultado en
  `data/health.json`, que la app muestra en «Probar fuentes». Fue la que destapó fallos reales (consultas de Wikidata que se cortaban,
  AIC sin imágenes, Wikipedia con `?utm_`): mirarla primero ante «no salen obras de X».
- **Estilos** (`STYLES`): fechas, búsqueda, categoría de Commons, movimiento de Wikidata, estilo de WikiArt y lista de artistas
  (`STYLE_MORE` amplía). Con un estilo elegido, una obra entra solo si la fuente ya comprobó el estilo (`sid`: WikiArt o Wikidata P135)
  o si su artista está en la lista del estilo. Los estilos «sueltos» (`loose`: china, coreana, virreinal, persa, mogol) no filtran por artista.
- **Colecciones rápidas** (`QUICK_COLLECTIONS` en core.js): 42 movimientos (de historia-arte.com/movimientos) y grupos Asia,
  Latinoamérica, Norteamérica y Europa. Campos: `s` estilos, `a` solo esos artistas (basta con que el nombre contenga todas sus
  palabras: por eso hay variantes como «Bosch»/«El Bosco»), `y` años, `g` grupo del desplegable. La elegida queda marcada mientras
  no se toque ningún filtro.
- **Mando y relé**: el móvil con `?c=código` controla la TV. Relé propio en Cloudflare (`relay/`, Worker + Durable Objects, desplegado por
  la acción «Desplegar relé»; la web lo usa en `/api/relay/<código>/…` vía `functions/api/relay/[[path]].js` con el enlace `ROOMS`).
  Respaldo: brokers MQTT públicos y ntfy. La TV manda al mando su estado (filtros, aspecto, estado de cada museo, favoritas).
  Favoritas y claves de API se guardan en la nube por código (gana el cambio más reciente; las bajas quedan apuntadas).
- **Arranque instantáneo** (cola guardada en el dispositivo), **conteos en caché 3 días**, **conteos de Wikidata en lote**,
  **imágenes al tamaño de la pantalla** (miniaturas directas de Commons), **barrido** de todos los museos seleccionados (4 a la vez).
- **Presentación «Con cartela»**: verticales y cuadradas a un lado con su cartela al otro, alternando lados.
- **Pantalla de inicio del móvil** (`#home`, solo en el móvil: no en la TV ni en el mando; `?home=1`/`?home=0` la fuerzan): Escaneo de obra,
  Galería de arte y Colecciones (ver abajo). El botón Atrás
  del móvil y «Inicio» del menú vuelven a ella (`history.pushState`). «Conectar a la TV» abre el mando con el último código usado (`tvcode`, que guarda el mando al abrirse) o lo pide.
- **Colecciones** (`#colls`, desde «Colecciones» del inicio del móvil): círculos arriba (Favoritas y Pinturas vistas, lista `COLLS` en ui.js) y
  cuadrícula masonry (cada obra a la columna más corta, 30 por página al bajar). Tocar una obra la muestra en la galería; Atrás vuelve.
  «Pinturas vistas» (`S.viewed`, clave `viewed`, 500 como máximo) se apunta en `present()` y, en el mando, con cada obra que manda la TV.
  El historial lleva la profundidad (`history.state.d`) para que «Inicio» vuelva al inicio en un solo salto.
- **Escáner tipo cámara** (`#scanner`, el mismo desde el inicio y desde el menú): zoom (1× 2× 3× y pellizco; zoom de la cámara si lo tiene,
  si no ampliación), círculo = escanear (manual; el marco se pone verde cuando está quieto), cuadrado izquierdo = buscar por nombre,
  derecho = buscar por foto de la galería. Resultados en una hoja desde abajo (`#scanSheet`, que también pide la clave si falta).
- **Buscar por título** y **por foto** (subir foto o escanear con la cámara; reconoce con la clave de Gemini o Anthropic del usuario).
- Aspectos (skins) Material 3 y Material 3 Expressive, claro y oscuro: afectan al menú, mando, avisos, fondo y ficha.

## Detalles que ya dieron problemas

- Wikidata: la página de obras va en subconsulta y los nombres después (si no, >60 s y error 504); imágenes con `wdt:P18|wdt:P6500`, sin UNION.
  El Louvre registra sus obras por departamento (`P195/P361*`). Un autor desconocido llega como `…/.well-known/genid/…`: `cleanName` lo quita.
- AIC necesita `fields=…image_id` y pasa por el intermediario `/api/p` (no da CORS con `fields`).
- Una imagen rota cuenta como vista en esa vuelta (si no, una colección pequeña como favoritas se quedaba parada).
- El mando debe aplicar el aspecto de la TV (`applyLook`) al recibir su estado, no solo marcar el selector.
- `localStorage` usa el prefijo `galeria-arte-v1:`; en el mando solo se guardan claves concretas (ver `lsSet`).

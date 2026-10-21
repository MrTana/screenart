# Galería de arte para la TV

Una sola página web que muestra obras de museos en pantalla completa y cambia sola cada cierto tiempo. No necesita servidor ni instalar nada: se abre `index.html` en cualquier navegador.

## Museos

El menú ya no tiene una lista de fuentes: solo **museos**. Hay unos 160 (Louvre, Orsay, Versalles, Prado, Uffizi, Hermitage, The Met, Rijksmuseum, MoMA, Tate, Städel, Pushkin, Tokio, Buenos Aires, Sídney…), con un filtro para encontrarlos y botones para marcar o quitar los de la lista. Hay 18 de México, 28 de Bélgica (Bruselas, Brujas, Amberes, Gante…) y unos 60 con obras surrealistas (Museo Magritte, Teatro-Museo Dalí, MoMA, Peggy Guggenheim, Menil, Max Ernst…), con colecciones rápidas «Museos de México», «Museos de Bélgica» y «Surrealismo en museos». Para cualquier otro, escribe su nombre en «Añadir otro museo»: la app lo busca en Wikidata y lo guarda en el navegador.

**Cada museo se consulta a la vez en todas sus fuentes:**
- **Directa**: la API del propio museo, cuando tiene una abierta (The Met, Art Institute of Chicago, Cleveland, Rijksmuseum, V&A, SMK, Minneapolis; Smithsonian y Harvard con clave gratuita).
- **Wikidata**: todas las obras de su colección que tengan imagen, no solo pinturas.
- **Wikimedia Commons**: categoría «Paintings in the…» del museo y búsqueda por su nombre.
- **Wikipedia**: artículos de obras que citan al museo; la imagen del artículo es la obra.

Si una fuente de un museo falla, las demás siguen. El punto de color y la línea bajo cada museo muestran cuántas obras dio cada fuente.

**Colecciones abiertas** es una fila aparte con WikiArt (catálogo grande por estilo), Commons por estilo, Wikidata por movimiento y Europeana. Estas fuentes no distinguen museos, así que se mezclan con cualquier museo; desmárcala si solo quieres los museos elegidos. Las claves gratuitas (Europeana, Smithsonian, Harvard) se escriben en «Claves de API» y se guardan solo en el navegador.

## Repositorios y colecciones añadidos

**Datos abiertos incluidos en el propio repositorio** (carpeta `data/`, unos 16 MB en total). Cada museo se convierte en trozos pequeños por tipo y año, y la app solo descarga el que necesita; si buscas un artista, revisa todos los trozos del tipo elegido. Para actualizarlos, vuelve a ejecutar el script correspondiente de `tools/`.

- **MoMA** (`tools/moma-shards.py`): unas 68 000 obras con imagen de moma.org a 1024 px.
- **National Gallery of Art, Washington** (`tools/nga-shards.py`): unas 62 000 obras de acceso abierto; imágenes IIIF de hasta 1600 px (3000 px con «alta calidad»).
- **Tate** (`tools/tate-shards.py`): unas 31 000 obras (se dejan fuera los cuadernos de bocetos de Turner). Las imágenes salen de media.tate.org.uk, en el tamaño más grande disponible.

**Otras fuentes**

- **WikiArt**: además del catálogo por estilo, ahora se consulta la página de cada artista.
- **Wikimedia Commons**: búsqueda por categorías con subcategorías («Paintings by …», estilos, museos), **Google Art Project** e **imágenes destacadas**.
- **Intermediario `/api/p`** (`functions/api/p.js`, una función de Cloudflare Pages): WikiArt y la búsqueda del Art Institute of Chicago no envían cabeceras CORS y el navegador no las deja leer. Si la petición directa falla, la app la repite por este intermediario, que solo acepta esas direcciones y solo desde la propia página.
- **Museos de un solo artista** (Picasso, Miró, Munch, Matisse, Chagall, Rodin, Botero, Sorolla, Klimt…), con colección rápida propia.

**Artistas y estilos**

- Más de 260 artistas agrupados en 13 grupos (menú Artistas). Cada nombre se busca en todas las fuentes anteriores. Hay colecciones rápidas para Remedios Varo, surrealistas de Latinoamérica, mujeres artistas y «Los grandes maestros».
- 59 estilos (antes 23): gótico, primitivos flamencos, bizantino, orientalismo, neoimpresionismo, futurismo, dadá, constructivismo, Bauhaus, art déco, realismo mágico, muralismo mexicano, campos de color, minimalismo, fotorrealismo, neoexpresionismo, arte urbano, pintura china, miniaturas persas y mogolas, etc.

**No integrados**

- **Biblioteca Digital de Princeton (DPUL)**: su JSON no incluye las imágenes y los manifiestos IIIF piden una verificación anti-bots que no se salta.
- **Public Domain Image Archive** y **Artvee**: sin API y sin permiso claro para el acceso automatizado.
- **SFMOMA, Museo Thyssen, Newfields, MFAH**: no se encontró API ni datos abiertos utilizables. Siguen en la lista de museos y se consultan por Wikidata, Commons y Wikipedia.
- **Galería Wendi Norris** (galería comercial con artistas vivos) y **remediosvaro.art** (no se pudo consultar su estructura): para Remedios Varo se usan WikiArt, Commons, Wikidata y los museos.

## Derechos de autor

Es un proyecto de uso personal, así que por defecto se usan todas las imágenes que cada fuente entrega, con o sin derechos de autor. En Wikidata se añaden también las imágenes externas de obras protegidas (propiedad P6500). La app no guarda ni redistribuye nada: carga cada imagen desde el servidor del museo. Si un museo no sirve la imagen de una obra protegida, la app la salta sola. Al activar «Solo dominio público» en el menú vuelven los filtros de dominio público en todas las fuentes. La ficha indica la licencia de cada obra.

**Cómo consigue Google Arts & Culture sus imágenes.** No tiene API pública ni se puede copiar: son museos socios, invitados por Google, que suben ellos mismos las imágenes y fichas a la plataforma de Google (muchas con la cámara Art Camera de Google) y conservan los derechos. Por eso aquí se usan las fuentes abiertas de cada museo y Wikidata/Commons, que cubren gran parte de las mismas colecciones.

## Filtros

Época (o años exactos), estilo o movimiento (23), tipo de obra, artistas, tema, formato horizontal o vertical, solo dominio público y favoritas. Los filtros de época, estilo y artista de los museos famosos dependen de que Wikidata tenga fecha y autor de cada obra. Hay colecciones rápidas como Impresionismo, Maestros holandeses, Museos de París o Grandes museos de Europa.

## Si las imágenes no cambian o un estilo sale vacío

Abre el menú y pulsa **Probar fuentes** (también sale en la pantalla de carga cuando no hay obras). Muestra, para cada fuente activa con tus filtros, cuántas obras devuelve, cuántas pasan el filtro, si la imagen carga y el error si lo hay. La cola ya no se rinde: si una fuente falla o viene vacía, descansa unos segundos y vuelve a intentarlo, y si se agotan las obras nuevas repite las ya vistas.

## Manejo

| Tecla | Acción |
| --- | --- |
| Flechas izquierda y derecha | Obra anterior y siguiente |
| Espacio | Pausar y reanudar |
| Intro, M o flechas arriba y abajo | Abrir el menú |
| F | Pantalla completa |
| I | Mostrar u ocultar la ficha |
| L | Guardar o quitar favorita |

En el móvil o la tableta funciona como un libro electrónico: tocar el borde derecho pasa a la siguiente obra, el borde izquierdo vuelve a la anterior y el centro abre el menú. También se puede deslizar el dedo a izquierda o derecha.

## Mando desde el móvil (sin usar el control de la TV)

Al abrir la galería en una pantalla grande aparece un **código QR** en la esquina (unos 2 minutos la primera vez, 20 segundos después de emparejar). Escanéalo con la cámara del móvil: se abre la misma página en modo **mando**, con el menú de filtros siempre abierto y los botones Anterior, Pausar, Siguiente y Favorita. Todo lo que cambies en el móvil se aplica en la TV.

- Si no ves el QR, abre la galería en la TV con `?tv=1` al final de la dirección (o pulsa la tecla Q). En el menú de la TV hay también «Mando en el móvil».
- El móvil queda emparejado por un código aleatorio que la TV guarda en su navegador; puedes añadir la página del mando a la pantalla de inicio del móvil y seguirá funcionando mientras la TV no cambie de código.
- La comunicación pasa por el canal público de [ntfy.sh](https://ntfy.sh) (sin cuentas ni servidor propio): solo viajan órdenes, filtros y el título de la obra, nunca claves de API. Con el límite gratuito de unos 250 mensajes al día por conexión, la TV solo avisa de cada obra nueva mientras hay un móvil conectado (como mucho una cada 8 segundos). Para usar tu propio servidor ntfy, añade `?relay=https://tu-servidor` en ambas direcciones.
- **Fondo:** negro por defecto; en el menú (también desde el mando), «Fondo» permite volver al blanco.
- **Actualizar:** al final del mando hay «Buscar actualización»: la TV borra su copia guardada y recarga la última versión, y el móvil se actualiza después. Muestra la versión de cada uno.
- Pruebas: `test/remote.cjs` simula TV y móvil.

## Instalarla como app (PWA)

La galería es una app instalable: tiene manifiesto, iconos y un service worker que la abre sin conexión (las obras sí necesitan internet). Abre la página publicada y:
- **Android (Chrome):** menú de la galería, botón «Instalar la app», o menú de Chrome, «Instalar app».
- **iPhone o iPad (Safari):** Compartir y «Añadir a pantalla de inicio».
- **Ordenador (Chrome o Edge):** icono de instalar en la barra de direcciones.

Se abre en pantalla completa, sin barra del navegador. Las actualizaciones llegan solas al abrirla con conexión. Para que se pueda instalar, la página debe servirse por https (Cloudflare Pages o GitHub Pages sirven).

## Publicar en GitHub Pages

1. En el repositorio: Settings, Pages, Source «Deploy from a branch», rama `main`, carpeta `/ (root)`.
2. La galería queda en `https://mrtana.github.io/screenart/`.

## Desarrollo

```
npm install
npm run build   # genera index.html a partir de src/
npm test        # pruebas con respuestas simuladas de cada museo
```

Estructura: `src/core.js` (fuentes y filtros, sin DOM), `src/ui.js` (interfaz), `src/template.html` (estilos y estructura), `src/sw.js` (service worker). `build.mjs` los junta en `index.html` y `sw.js` (con la versión estampada). `manifest.webmanifest` y `icons/` van en la raíz.

Las pruebas usan respuestas simuladas con la forma de cada API. Para saber si un museo responde de verdad desde el navegador, mira el punto de color junto a su nombre en el menú o usa «Probar fuentes».

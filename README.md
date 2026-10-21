# Galería de arte para la TV

Una sola página web que muestra obras de museos en pantalla completa y cambia sola cada cierto tiempo. No necesita servidor ni instalar nada: se abre `index.html` en cualquier navegador.

## Fuentes

Con acceso abierto y sin clave: The Met, Art Institute of Chicago, Cleveland Museum of Art, Rijksmuseum, Victoria and Albert Museum, SMK (Copenhague), Minneapolis Institute of Art y Wikidata con Wikimedia Commons.

**Un Wikidata por museo.** Los 27 museos famosos (Louvre, Orsay, Versalles, Orangerie, Prado, Uffizi, Hermitage, National Gallery, Van Gogh, Mauritshuis, Kunsthistorisches…) tienen cada uno su fila en el menú y su propia consulta a Wikidata. Entran todas las obras de la colección del museo que tengan imagen, no solo pinturas. Louvre, Orsay, Versalles, Prado, Uffizi, Hermitage, National Gallery y Van Gogh se buscan por su código de Wikidata y por nombre; el resto, solo por nombre. En cada ronda se consultan 4 de los museos marcados para no saturar Wikidata.

Con clave gratuita (opcionales, desactivadas por defecto): Europeana, Smithsonian y Harvard Art Museums. Se escriben en el menú, en «Claves de API», y se guardan solo en el navegador.

Para buscar por estilo o artista (por ejemplo Surrealismo) hay dos fuentes más: **Wikimedia Commons (búsqueda)**, que busca por categoría de estilo y por texto, y **WikiArt (por estilo)**, un catálogo grande de pintura clasificado por movimiento (experimental). En Wikidata, el movimiento artístico se busca tanto en la obra como en su autor, y las obras sin fecha también entran cuando eliges un estilo.

**Cómo consigue Google Arts & Culture sus imágenes.** No tiene API pública ni se puede copiar: son museos socios, invitados por Google, que suben ellos mismos las imágenes y fichas a la plataforma de Google (muchas con la cámara Art Camera de Google) y conservan los derechos. Por eso aquí se usan las fuentes abiertas de cada museo y Wikidata/Commons, que cubren gran parte de las mismas colecciones.

## Derechos de autor

Es un proyecto de uso personal, así que por defecto se usan todas las imágenes que cada fuente entrega, con o sin derechos de autor. En Wikidata se añaden también las imágenes externas de obras protegidas (propiedad P6500). La app no guarda ni redistribuye nada: carga cada imagen desde el servidor del museo. Si un museo no sirve la imagen de una obra protegida, la app la salta sola. Al activar «Solo dominio público» en el menú vuelven los filtros de dominio público en todas las fuentes. La ficha indica la licencia de cada obra.

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

En una pantalla táctil, tocar la pantalla abre el menú.

## Publicar en GitHub Pages

1. En el repositorio: Settings, Pages, Source «Deploy from a branch», rama `main`, carpeta `/ (root)`.
2. La galería queda en `https://mrtana.github.io/screenart/`.

## Desarrollo

```
npm install
npm run build   # genera index.html a partir de src/
npm test        # pruebas con respuestas simuladas de cada museo
```

Estructura: `src/core.js` (fuentes y filtros, sin DOM), `src/ui.js` (interfaz), `src/template.html` (estilos y estructura). `build.mjs` los junta en `index.html`.

Las pruebas usan respuestas simuladas con la forma de cada API. Para saber si un museo responde de verdad desde el navegador, mira el punto de color junto a su nombre en el menú o usa «Probar fuentes».

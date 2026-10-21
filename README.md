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

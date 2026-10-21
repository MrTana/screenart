# Galería de arte para la TV

Una sola página web que muestra obras de museos en pantalla completa y cambia sola cada cierto tiempo. No necesita servidor ni instalar nada: se abre `index.html` en cualquier navegador.

## Fuentes

Con acceso abierto y sin clave: The Met, Art Institute of Chicago, Cleveland Museum of Art, Rijksmuseum, Victoria and Albert Museum, SMK (Copenhague), Minneapolis Institute of Art y Wikidata con Wikimedia Commons.

«Louvre, Orsay, Versalles y más» usa Wikidata y Commons para 27 museos famosos (Prado, Uffizi, Hermitage, National Gallery, Van Gogh, Mauritshuis, Kunsthistorisches…). Los museos se localizan por el nombre de su ficha en Wikidata y solo salen obras de dominio público con foto en Commons.

Con clave gratuita (opcionales, desactivadas por defecto): Europeana, Smithsonian y Harvard Art Museums. Se escriben en el menú, en «Claves de API», y se guardan solo en el navegador.

Google Arts & Culture no tiene API pública, por eso no se usa directamente.

## Filtros

Época (o años exactos), estilo o movimiento (23), tipo de obra, artistas, tema, formato horizontal o vertical, solo dominio público y favoritas. Hay colecciones rápidas como Impresionismo, Maestros holandeses, Museos de París o Grandes museos de Europa.

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

Las pruebas usan respuestas simuladas con la forma de cada API. Para saber si un museo responde de verdad desde el navegador, mira el punto de color junto a su nombre en el menú.

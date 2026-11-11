# Transcriptor Local

Aplicación web de una sola página para trabajar con documentos y grabaciones **sin subirlos a la nube**: todo el procesamiento ocurre en el navegador de tu equipo.

**👉 Úsala en línea: [fadavilar.github.io/transcripcion](https://fadavilar.github.io/transcripcion/)**

Este repositorio es una copia corregida de [adfincarserv-source/transcripcion](https://github.com/adfincarserv-source/transcripcion) — ver [Qué se corrigió](#qué-se-corrigió-en-esta-copia) más abajo.

## Funciones

| Pestaña | Qué hace | Salida |
| --- | --- | --- |
| ⚡ Automático | Detecta el tipo de cada archivo y aplica la conversión adecuada | Según el archivo |
| 📝 A Markdown | Convierte PDF, Word, PowerPoint, Excel, CSV, HTML, texto e imágenes (como MarkItDown). Aplica OCR a las páginas escaneadas | `MarkitDown/*.md` |
| 🔍 OCR de PDF | Reconoce el texto de PDF escaneados o imágenes (español, inglés, portugués) | `OCR/*_OCR.pdf` (buscable), `.txt`, `.md` |
| 🎙️ Audio y video | Transcribe m4a, mp3, wav, mp4… con Whisper, sin límite de duración (fragmentos de 30 s) | `Transcripciones/*.md` (con marcas de tiempo), `.txt` |
| ▦ Generador QR | Crea códigos QR a partir de enlaces o texto | PNG o SVG |

- Acepta **archivos sueltos o carpetas completas** (con subcarpetas). En Chrome o Edge los resultados se guardan directamente en una subcarpeta de la carpeta elegida; en otros navegadores se descargan individualmente o en un ZIP.
- Diseño adaptable a celulares, tabletas y portátiles; tema claro, oscuro o automático y tamaño de letra ajustable (se recuerdan entre sesiones).

## Instalación y uso

### En línea (recomendado)

Abre **https://fadavilar.github.io/transcripcion/** en Chrome o Edge (computador) o en el navegador del celular. GitHub Pages solo entrega la página: tus archivos se procesan en tu dispositivo y no se suben a ningún servidor.

### 📲 Instalar en el celular (o en el computador)

Abre **https://fadavilar.github.io/transcripcion/** en Chrome, Edge o Safari y usa la opción del navegador para instalarla:

- **Android (Chrome):** menú ⋮ → "Instalar app" (o el banner "Agregar a pantalla de inicio" que aparece solo).
- **iPhone/iPad (Safari):** botón Compartir → "Agregar a inicio".
- **Computador (Chrome/Edge):** ícono de instalar ⊕ en la barra de direcciones.

Queda como una app aparte, con su propio ícono (el micrófono 🎙️ sobre fondo verde azulado) y sin la barra del navegador — se abre y se ve igual que cualquier otra app del celular, pero sigue siendo 100% local: nada se sube a internet.

### Sin conexión a GitHub

No requiere instalación ni `npm install`: es HTML + JavaScript puro, sin paso de compilación.

```bash
git clone https://github.com/fadavilar/transcripcion.git
```

1. En Windows, haz doble clic en **`Iniciar.bat`**. Se abre la app en `http://localhost:8765`, un servidor que solo existe en tu equipo.
2. Alternativa (cualquier sistema): abre `index.html` directamente en Chrome o Edge.

Luego elige una carpeta o archivos, ajusta las opciones y pulsa **Procesar**.

> La opción de instalar como app (y el ícono) solo aparece cuando la abres por `http://` o `https://` (en línea, o vía `Iniciar.bat`/`servidor.ps1`). Abriendo `index.html` directamente con doble clic (`file://`) la app funciona igual, pero los navegadores no permiten instalar apps servidas así.

> La primera vez se necesita internet para descargar las librerías y los modelos (datos de OCR y el modelo Whisper elegido, entre 75 MB y 1 GB). Quedan guardados en el navegador. Tus archivos nunca salen de tu equipo.

## Parámetros

### Modelos de transcripción (Whisper)

| Modelo | Tamaño | Recomendado para |
| --- | --- | --- |
| Tiny | ~75 MB | Pruebas rápidas |
| Base | ~150 MB | Uso general |
| Small | ~500 MB | Mejor precisión en español |
| Large v3 Turbo | ~1 GB | Equipos con tarjeta gráfica (WebGPU) |

### Opciones de audio/video

| Opción | Valores | Por defecto |
| --- | --- | --- |
| Idioma del audio | Español, Inglés, Portugués, Detectar automáticamente | Español |
| Procesador | WebGPU (si está disponible), CPU | CPU |
| Salida | Markdown con marcas de tiempo (.md), Texto plano (.txt) | Ambas |

### Opciones de OCR

| Opción | Valores | Por defecto |
| --- | --- | --- |
| Idioma del OCR | Español, Español + Inglés, Inglés, Portugués | Español + Inglés |
| Calidad del OCR | Normal, Alta, Muy alta | Alta |

## Estructura del proyecto

```
transcripcion/
├── index.html              # Marcado, estilos, y el worker de transcripción (inline a propósito, ver nota)
├── src/
│   └── app.js               # Lógica de la aplicación (pestañas, conversión a Markdown, OCR, transcripción, QR)
├── manifest.webmanifest     # Metadatos de instalación como app (nombre, ícono, colores)
├── sw.js                    # Service worker mínimo (cachea solo el "shell", ver nota)
├── icons/                   # Íconos de instalación (Android, iOS, favicon) en los tamaños requeridos
├── favicon.ico
├── Iniciar.bat              # Lanza servidor.ps1 con doble clic en Windows
├── servidor.ps1             # Servidor estático mínimo en localhost (sin dependencias)
└── LICENSE
```

**Nota de diseño:** el *worker* de transcripción (`<script type="text/worker" id="asrWorkerSrc">` dentro de `index.html`) se mantiene inline a propósito, no en un archivo `.js` separado. Al abrir `index.html` directamente con doble clic (protocolo `file://`), Chrome y Edge bloquean la carga de *module workers* externos por CORS; mantenerlo como texto embebido y crear el worker desde un `Blob` evita ese problema y preserva el "abre y usa" sin servidor. El resto de la lógica (`src/app.js`) sí es un archivo normal, porque un `<script src>` clásico (no un worker de tipo módulo) carga sin problema bajo `file://`.

Por la misma razón no hay paso de build (Rollup/Babel) ni carpeta `lib/`: esta no es una librería que otro código importe, es una herramienta de un solo archivo pensada para abrirse directamente, sin instalar nada.

`sw.js` solo cachea el *shell* propio de la app (HTML, JS, manifest, íconos) para que el navegador la considere instalable y cargue más rápido en visitas repetidas — no cachea las librerías de terceros (pdf.js, Tesseract, transformers.js) ni los modelos de Whisper, que ya gestionan su propia caché.

## Qué se corrigió en esta copia

Respecto a [adfincarserv-source/transcripcion](https://github.com/adfincarserv-source/transcripcion):

1. **Vista previa truncada en audios largos.** Al terminar de procesar, la vista previa en pantalla recortaba el texto a los primeros 20 000 caracteres (~15-20 min de audio en español) con `.slice(0, 20000)`. El archivo `.md`/`.txt` guardado siempre quedaba completo — solo la vista previa mentía. Se quitó el recorte, igual que ya hacía el botón "ver" de cada resultado.
2. **Pérdida de contenido tras un fallo del motor de transcripción.** El motor (Whisper vía transformers.js) corre en un *worker* aparte. Si ese worker se caía por falta de memoria —más probable con audios largos, que generan más fragmentos de 30 s—, el código nunca volvía a cargar el modelo: cada fragmento restante fallaba en cascada y quedaba relleno con `[Error en transcripción]`. Ahora, si un fragmento falla, se recarga el modelo y se reintenta ese fragmento una vez antes de darlo por perdido.

## Navegadores compatibles

Requiere un navegador moderno con WebAssembly: Chrome, Edge o Firefox recientes (escritorio o Android). En Safari/iOS funciona con limitaciones (sin acceso directo a carpetas; los resultados se descargan). Para transcripción con GPU (WebGPU) se necesita Chrome o Edge recientes con tarjeta gráfica compatible; sin eso, usa CPU.

## Tecnologías

[pdf.js](https://mozilla.github.io/pdf.js/) · [Tesseract.js](https://tesseract.projectnaptha.com/) · [Transformers.js](https://huggingface.co/docs/transformers.js) (Whisper) · [mammoth](https://github.com/mwilliamson/mammoth.js) · [Turndown](https://github.com/mixmark-io/turndown) · [SheetJS](https://sheetjs.com/) · [JSZip](https://stuk.github.io/jszip/) · [pdf-lib](https://pdf-lib.js.org/) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)

## Licencia

CC0 1.0 — dominio público. Ver [LICENSE](LICENSE).

## Créditos

Desarrollado originalmente en [adfincarserv-source/transcripcion](https://github.com/adfincarserv-source/transcripcion).

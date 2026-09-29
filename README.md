# 🎹 Synth Manos

Sintetizador y piano que se tocan **con las manos delante de la cámara** o **con la pantalla táctil**, pensado para las clases de música de primaria. Funciona **sin internet** en Windows.

## Qué incluye

| Modo | Qué hace |
|---|---|
| 🖐️ **Sintetizador con las manos** | Cada dedo índice es una voz. Subes o bajas la mano para cambiar de nota y la mueves a los lados para cambiar el brillo o el volumen. Con el puño cerrado se calla. Tiene dos tipos de tono: **notas fijas** (salta de nota en nota dentro de una escala, así que siempre suena afinado) y **theremin** (el tono se desliza de forma continua, con un indicador de afinación). |
| 🤟 **Acordes con gestos** | Como en lengua de signos: con una mano formas el acorde (1 a 5 dedos = I a V, 🤘 = VI, 🤟 = VII; inclinarla cambia entre mayor y menor) y con la otra eliges la variante (tríada, inversión, séptima), el volumen (altura) y el brillo (inclinación). Incluye un **tutorial interactivo paso a paso** (la app comprueba cada gesto con la cámara), progresiones guiadas (I–IV–V–I, pop, blues…) y opción de arpegio. Inspirado en *Gesture Synth* de Eric Wei. |
| 🎹 **Piano táctil** | Teclado multitoque en la pantalla. También se toca con el ratón o con el teclado del ordenador. |
| ✨ **Piano en el aire** | Aparece un teclado sobre la imagen de la cámara. Con la mano cerrada no suena nada; al **extender un dedo** suena la tecla que tiene debajo y al doblarlo se para. |
| 📚 **Canciones y tutoriales** | Lee archivos MIDI (`.mid`) y karaoke (`.kar`) de una carpeta. Hay dos tutoriales: uno de piano con notas que caen y otro con las manos, donde un anillo te indica dónde colocar el dedo. |
| 🤟 **Karaoke de acordes** | Suena la canción con su letra y el alumno pone los acordes con las manos. La app deduce la tonalidad y los acordes del MIDI, los muestra encima de la letra y en una cinta con el dibujo de la mano, y en modo *Practicar* espera a que se haga cada acorde. |
| 🎤 **Karaoke** | Letra gigante con una bolita que salta de sílaba en sílaba, fondo animado y la melodía en colores. Si la canción no tiene letra, se cantan los nombres de las notas. |
| 🎬 **Grabar vídeo** | Botón **⏺ Grabar** (o tecla **F9**): graba la ventana de la app con su sonido (y, si se quiere, el micrófono) en *Documentos › Synth Manos › Grabaciones*. |
| 🐞 **Reportar un problema** | Abre una incidencia en GitHub ya rellenada con la descripción y los datos técnicos (versión, pantalla, últimos errores). |
| 📺 **Modo clase** | Pantalla completa y sin menús, para proyectar o compartir pantalla. |

Los tutoriales tienen tres modos:

- **👂 Escuchar:** la app toca la melodía sola.
- **⏳ Practicar:** la canción se para hasta que tocas la nota correcta.
- **⭐ Reto:** en tiempo real, con puntos, rachas y estrellas.

Las notas pueden verse como **Do-Re-Mi**, como **C-D-E** o solo con **colores** (los colores habituales en el aula: Do rojo, Re naranja, Mi amarillo…).

---

## 👩‍🏫 Para el profesor/a

### Instalar

1. Descarga `SynthManos-Instalador.exe` desde la página **Releases** del repositorio, o directamente con el enlace `https://github.com/JorgeJaraB/Synth/releases/latest/download/SynthManos-Instalador.exe`, que siempre descarga la última versión.
2. Haz doble clic. Se instala sola y crea un icono **Synth Manos** en el escritorio.
3. La primera vez, Windows puede mostrar el aviso *"Windows protegió su PC"*. Aparece porque la app no está firmada con un certificado de pago. Pulsa **Más información → Ejecutar de todas formas**.

¿Prefieres no instalar nada? Usa `SynthManos-Portable.exe`: es un único archivo que se abre directamente, por ejemplo desde un USB.

### Actualizaciones automáticas

La app instalada **se actualiza sola**. Al abrirla (y cada 2 horas) mira si hay una versión nueva, la descarga en segundo plano y la instala **al cerrar la app**. También aparece un botón **✨ Actualizar** para instalarla en el momento. En *Ajustes → Acerca de* se ve la versión y se puede buscar a mano.

La versión portable no se actualiza sola.

### Añadir canciones

Formatos admitidos: **MIDI** (`.mid`), **karaoke** (`.kar`, con letra) y **partituras MusicXML** (`.musicxml`, `.mxl`, `.xml`), que es lo que exporta MuseScore.

Formas de añadirlas:

1. **Arrastra** los archivos a la ventana de la app, estés en la pantalla que estés.
2. Pulsa **➕ Añadir canciones** en la pestaña *Canciones* y elígelos.
3. Cópialos en la carpeta **Documentos › Synth Manos › Canciones** (botón **📂 Abrir carpeta**). Aparecen en la app al momento, sin reiniciar.
4. **✏️ Crear canción:** escribe las notas (`Do Do Sol Sol La La Sol-`) y la letra (`Es-tre-lli-ta dón-de_es-tás`), escúchala y guárdala. La pantalla explica cómo se escribe y trae un ejemplo.

Más cosas útiles:

- **Categorías:** crea carpetas dentro de la carpeta de canciones (por ejemplo "Navidad" o "3º Primaria") y cada una aparece como una categoría.
- **Buscar:** la barra de búsqueda filtra por nombre cuando ya hay muchas canciones.
- **Quitar:** el botón 🗑️ envía la canción a la papelera de Windows, por si te equivocas.
- **Dónde conseguirlas:**
  - En **musescore.com** hay miles de canciones, también infantiles en español. En cada partitura: *Descargar → MusicXML* o *MIDI* (hace falta una cuenta gratuita).
  - En **bitmidi.com** y **freemidi.org** hay MIDI que se descargan con un clic.
- **Canciones de ejemplo** (en la categoría *Ejemplos*): Estrellita, Martinillo, Cumpleaños feliz, La cucaracha, Navidad (Jingle Bells), A la luz de la luna, María tenía un corderito, Himno de la alegría y un ejercicio con la escala de Do.

### Privacidad

- La imagen de la cámara se procesa **solo en el ordenador**. Nunca se envía ni se guarda.
- Los vídeos grabados se guardan **solo en el ordenador** (*Documentos › Synth Manos › Grabaciones*). La app no tiene ninguna forma de subirlos: su interfaz tiene prohibido conectarse a internet, y hay tests que lo comprueban.
- Los reportes de problemas solo envían el texto que se escribe, sin imágenes, vídeos ni nombres de archivos; las rutas y el nombre de usuario se borran antes de enviar.
- La app solo se conecta a internet para descargar actualizaciones de GitHub y enviar esos reportes.

### Consejos para la cámara

- Con la **cámara del portátil**: siéntate a un brazo de distancia, inclina un poco la pantalla hacia atrás y busca **buena luz de frente** (evita tener una ventana a la espalda).
- En el piano en el aire, el teclado aparece a media altura de la imagen, con una octava de teclas grandes. Puedes cambiar su altura y su tamaño en *Piano → Opciones*.
- En **Ajustes** puedes elegir la cámara si hay más de una y probarla.
- Si la cámara no se enciende:
  - Revisa *Configuración de Windows → Privacidad y seguridad → Cámara* y activa **"Permitir que las aplicaciones de escritorio accedan a la cámara"**.
  - Cierra Teams, Zoom u otras apps que puedan estar usando la cámara.

### Atajos útiles

- **Barra espaciadora:** reproducir o pausar en los tutoriales y en el karaoke.
- **Teclado del ordenador como piano:**
  - Teclas blancas: `A S D F G H J K`
  - Teclas negras: `W E T Y U`
  - Cambiar de octava: `Z` y `X`
- **F11:** pantalla completa.
- **F5:** recargar la app.

---

## 👩‍💻 Para desarrollo

Requisitos: **Node.js 20 o superior**.

```bash
npm install
npm run dev        # versión web con recarga en caliente → http://localhost:5173
npm start          # abre la app de escritorio (Electron)
npm test           # tests del lector MIDI/karaoke
npm run dist:win   # genera el instalador y el portable de Windows en release/
```

### Cómo conseguir el `.exe` sin tener Windows

Cada vez que se sube un cambio a GitHub, el flujo **Compilar para Windows** (`.github/workflows/build-windows.yml`) compila la app en una máquina Windows:

- Los `.exe` aparecen en la pestaña **Actions** del repositorio: entra en la última ejecución y descarga el artefacto **SynthManos-Windows**.
- Además, cada cambio en la rama principal se publica **automáticamente** como una nueva versión en **Releases**. No hay que hacer nada a mano.
- Enlace fijo para el profe, siempre con la última versión: `https://github.com/JorgeJaraB/Synth/releases/latest/download/SynthManos-Instalador.exe`. Para que funcione sin iniciar sesión, el repositorio tiene que ser **público**.

### Reportes de problemas sin cuenta de GitHub

El botón 🐞 puede crear la incidencia directamente, sin que el maestro tenga cuenta. Para activarlo:

1. En GitHub, crea un token con permiso **solo para incidencias de este repositorio**: *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
   - *Repository access:* **Only select repositories → Synth**.
   - *Permissions → Repository permissions:* **Issues → Read and write**. Nada más.
2. En el repositorio: *Settings → Secrets and variables → Actions → New repository secret*.
   - Nombre: `ISSUES_TOKEN`
   - Valor: el token.
3. La siguiente compilación lo incluye en la app.

El token va dentro de la app, así que alguien con conocimientos podría extraerlo. Como solo sirve para crear o editar incidencias de este repositorio, lo peor que podría hacer es escribir incidencias falsas. Se puede revocar en cualquier momento desde GitHub. Sin el secreto, el botón abre la web de GitHub.

### Estructura

```
electron/        proceso principal (ventana, carpeta de canciones, permisos de cámara)
src/core/        audio (Tone.js), detección de manos (MediaPipe), lector MIDI/KAR, reproductor
src/ui/          teclado, cámara, piano en el aire, notas que caen, letra con bolita
src/views/       pantallas: inicio, sintetizador, piano, canciones, tutoriales, karaoke, ajustes
public/          modelo de manos, muestras de piano y canciones de ejemplo
scripts/         descarga de recursos y generador de canciones de ejemplo
```

Todo funciona en local:

- El modelo de MediaPipe y las muestras de piano van dentro de la app.
- `npm run assets` copia los archivos WebAssembly de MediaPipe y descarga lo que falte.
- `npm run songs` regenera las canciones de ejemplo.

## Licencias y créditos

- Modo *Acordes con gestos*: idea inspirada en [Gesture Synth](https://github.com/ericwei97-cloud/gesture-synth) de Eric Wei (indecisive.eric); implementación propia.
- Detección de manos: [MediaPipe](https://developers.google.com/mediapipe) (Apache 2.0).
- Audio: [Tone.js](https://tonejs.github.io/) (MIT).
- Piano: muestras *Salamander Grand Piano* de Alexander Holm (CC-BY 3.0).
- Tipografía: Nunito (SIL Open Font License).
- Canciones de ejemplo: melodías populares de dominio público.

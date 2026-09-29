// Biblioteca de canciones: lista la carpeta, permite añadir y elegir cómo practicar.
import {
  listSongs, loadSong, importFiles, removeSong, onSongsChanged, openSongsFolder, songsFolderPath,
  isDesktop, displayName, EXAMPLES_CATEGORY,
} from '../core/library.js';
import { navigate } from '../router.js';
import { noteName } from '../core/notes.js';
import { settings } from '../core/settings.js';
import { h, toast, formatTime } from '../ui/dom.js';

const MY_SONGS = 'Mis canciones';
const ALL = '__todas__';
let lastSelected = null;
let lastCategory = ALL;

const categoryLabel = (c) => c || MY_SONGS;

/** Tarjeta con las instrucciones para añadir canciones. */
export function howToAddCard(folderPath, onClose) {
  return h('div.howto-card',
    onClose ? h('button.btn.icon.howto-close', { title: 'Cerrar', onclick: onClose }, '✕') : null,
    h('h3', '➕ Cómo añadir canciones'),
    h('ol',
      h('li', h('b', 'Arrastra'), ' los archivos a esta ventana. Es lo más fácil.'),
      h('li', 'O pulsa ', h('b', '➕ Añadir canciones'), ' y elígelos en el ordenador.'),
      isDesktop ? h('li', 'O cópialos en la carpeta de canciones (botón ', h('b', '📂 Abrir carpeta'), '). Aparecen aquí solos.') : null,
    ),
    h('li', 'O pulsa ', h('b', '✏️ Crear canción'), ' y escribe las notas y la letra tú mismo.'),
    h('p.muted', '💡 Formatos: ', h('b', 'MIDI (.mid)'), ', ', h('b', 'karaoke (.kar)'), ' y ', h('b', 'partituras MusicXML (.musicxml, .mxl)'), '. En ', h('b', 'musescore.com'), ' hay miles de canciones: en cada partitura, "Descargar" → MusicXML o MIDI. También en bitmidi.com o freemidi.org.'),
    isDesktop ? h('p.muted', '📁 Para ordenarlas, crea carpetas dentro de la carpeta de canciones ("Navidad", "3º Primaria"…). Cada carpeta aparece como una categoría.') : null,
    folderPath ? h('p.muted', 'Carpeta: ', h('code', folderPath)) : null,
  );
}

export function mount(root, params = {}) {
  let songs = [];
  let category = lastCategory;
  let query = '';
  let showHelp = false;
  let folderPath = null;

  const list = h('div.song-list');
  const chips = h('div.category-chips');
  const helpHost = h('div');
  const detail = h('aside.panel.song-detail', h('div.empty-detail', h('div.big-emoji', '🎵'), h('p', 'Elige una canción de la lista')));
  const fileInput = h('input', {
    type: 'file', accept: '.mid,.midi,.kar,.musicxml,.mxl,.xml', multiple: true, style: { display: 'none' },
    onchange: async () => { await addFiles(fileInput.files); fileInput.value = ''; },
  });
  const search = h('input.search', {
    type: 'search', placeholder: '🔍 Buscar canción…',
    oninput: () => { query = search.value.trim().toLowerCase(); renderList(); },
  });

  const view = h(
    'div.view.view-with-panel',
    h('div.main-col',
      h('div.view-toolbar.wrap',
        h('h2', '📚 Canciones'),
        search,
        h('div.spacer'),
        h('button.btn', { onclick: () => navigate('song-editor') }, '✏️ Crear canción'),
        h('button.btn.primary', { onclick: () => fileInput.click() }, '➕ Añadir canciones'),
        isDesktop ? h('button.btn', { onclick: () => openSongsFolder() }, '📂 Abrir carpeta') : null,
        h('button.btn.icon', { title: 'Cómo añadir canciones', onclick: () => { showHelp = !showHelp; renderHelp(); } }, '❓'),
        fileInput,
      ),
      h('div.library-body', helpHost, chips, list),
    ),
    detail,
  );
  root.append(view);

  songsFolderPath().then((p) => {
    folderPath = p;
    renderHelp();
  });

  function renderHelp() {
    const empty = songs.filter((s) => s.category !== EXAMPLES_CATEGORY).length === 0;
    helpHost.replaceChildren(showHelp || (empty && songs.length < 12) ? howToAddCard(folderPath, () => { showHelp = false; helpHost.replaceChildren(); }) : '');
  }

  async function addFiles(files) {
    const target = category === ALL || category === EXAMPLES_CATEGORY ? '' : category;
    const { added, rejected } = await importFiles([...files], target);
    if (added.length) toast(`✅ ${added.length === 1 ? 'Canción añadida' : added.length + ' canciones añadidas'}`);
    if (rejected.length) toast(`⚠️ No se pudo añadir: ${rejected.join(', ')} (solo .mid, .kar, .musicxml o .mxl)`, 4000);
    await refresh();
    if (added[0]) select(added[0]);
  }

  function categories() {
    const map = new Map();
    for (const s of songs) map.set(s.category, (map.get(s.category) || 0) + 1);
    // Primero las del profe, luego sus carpetas y al final los ejemplos.
    return [...map.entries()].sort(([a], [b]) => {
      const rank = (c) => (c === '' ? 0 : c === EXAMPLES_CATEGORY ? 2 : 1);
      return rank(a) - rank(b) || a.localeCompare(b, 'es');
    });
  }

  function renderChips() {
    const cats = categories();
    if (!cats.some(([c]) => c === category)) category = ALL;
    chips.replaceChildren(
      ...(cats.length > 1
        ? [[ALL, songs.length], ...cats].map(([c, n]) =>
            h('button.chip', { class: c === category ? 'active' : '', onclick: () => { category = lastCategory = c; renderChips(); renderList(); } },
              c === ALL ? 'Todas' : categoryLabel(c), h('span.chip-count', n)))
        : []),
    );
  }

  function songCard(s, i) {
    const kar = /\.kar$/i.test(s.name);
    const score = /\.(musicxml|mxl|xml)$/i.test(s.name);
    return h('button.song-card', { 'data-name': s.name, style: { '--hue': (i * 47) % 360 }, class: s.name === lastSelected ? 'selected' : '', onclick: () => select(s.name) },
      h('div.song-icon', score ? '📄' : kar ? '🎤' : '🎼'),
      h('div.song-name', displayName(s.name)),
      h('div.song-type', score ? 'Partitura' : kar ? 'Con letra' : 'MIDI'),
    );
  }

  function renderList() {
    let visible = songs.filter((s) => (category === ALL || s.category === category) && (!query || displayName(s.name).toLowerCase().includes(query)));
    if (!songs.length) {
      list.replaceChildren(h('div.empty-state', h('div.big-emoji', '🎼'), h('h3', 'Todavía no hay canciones'), h('p', 'Arrastra aquí archivos MIDI, karaoke o partituras MusicXML, o crea una canción con ✏️.')));
      return;
    }
    if (!visible.length) {
      list.replaceChildren(h('div.empty-state', h('p', `No hay canciones que coincidan con "${search.value}".`)));
      return;
    }
    let i = 0;
    if (category === ALL && !query && categories().length > 1) {
      list.replaceChildren(
        ...categories().map(([c]) => h('section.song-section',
          h('h3.section-title', c === EXAMPLES_CATEGORY ? '⭐ ' + c : c === '' ? '🎵 ' + MY_SONGS : '📁 ' + c),
          h('div.song-grid', visible.filter((s) => s.category === c).map((s) => songCard(s, i++))),
        )),
      );
    } else {
      list.replaceChildren(h('div.song-grid', visible.map((s) => songCard(s, i++))));
    }
  }

  async function refresh() {
    try {
      songs = await listSongs();
    } catch (e) {
      console.error(e);
      songs = [];
    }
    renderChips();
    renderList();
    renderHelp();
    if (lastSelected && !songs.some((s) => s.name === lastSelected)) {
      lastSelected = null;
      detail.replaceChildren(h('div.empty-detail', h('div.big-emoji', '🎵'), h('p', 'Elige una canción de la lista')));
    }
  }

  async function select(name) {
    lastSelected = name;
    for (const c of list.querySelectorAll('.song-card')) c.classList.toggle('selected', c.dataset.name === name);
    detail.replaceChildren(h('div.spinner'));
    detail.classList.add('open');
    let song;
    try {
      song = await loadSong(name);
    } catch (e) {
      console.error(e);
      detail.replaceChildren(h('div.empty-detail', h('div.big-emoji', '😕'), h('p', 'No se pudo leer este archivo. ¿Es un MIDI válido?'), removeButton(name)));
      return;
    }
    if (lastSelected !== name) return;
    const playable = song.tracks.filter((t) => !t.isDrum);
    let practiceTrack = song.melodyTrack;
    const trackSel = h(
      'select',
      { onchange: () => (practiceTrack = Number(trackSel.value)) },
      playable.map((t) =>
        h('option', { value: t.index, selected: t.index === song.melodyTrack }, `${t.name} — ${t.notes.length} notas (${noteName(t.minPitch, settings.notation, true)}–${noteName(t.maxPitch, settings.notation, true)})${t.index === song.melodyTrack ? ' ★' : ''}`),
      ),
    );
    const go = (v) => navigate(v, { songName: name, practiceTrack });
    // Sin los null: replaceChildren los escribiría como texto "null".
    detail.replaceChildren(
      ...[
        h('button.btn.icon.panel-close', { title: 'Cerrar', onclick: () => detail.classList.remove('open') }, '✕'),
        h('h2', displayName(name)),
        song.title.toLowerCase() !== displayName(name).toLowerCase() ? h('p.muted.song-subtitle', song.title) : null,
        h('div.song-meta',
          h('span', '⏱️ ', formatTime(song.duration)),
          h('span', '🥁 ', song.bpm, ' ppm'),
          h('span', '🎼 ', song.timeSignature.join('/')),
          h('span', song.hasLyrics ? '🎤 Con letra' : '🎹 Sin letra'),
        ),
        h('div.mode-buttons',
          h('button.mode-btn', { onclick: () => go('tutorial-piano') }, h('span.mode-emoji', '🎹'), h('b', 'Tutorial de piano'), h('small', 'Las notas caen sobre el teclado')),
          h('button.mode-btn', { onclick: () => go('tutorial-synth') }, h('span.mode-emoji', '🖐️'), h('b', 'Tutorial con las manos'), h('small', 'La cámara te dice dónde poner la mano')),
          h('button.mode-btn', { onclick: () => go('karaoke') }, h('span.mode-emoji', '🎤'), h('b', 'Karaoke'), h('small', song.hasLyrics ? 'Letra grande con bolita' : 'Sin letra: se cantan los nombres de las notas')),
          h('button.mode-btn', { onclick: () => go('karaoke-chords') }, h('span.mode-emoji', '🤟'), h('b', 'Karaoke de acordes'), h('small', 'Pon los acordes con las manos mientras suena la canción')),
        ),
        playable.length > 1
          ? h('details.advanced',
              h('summary', 'Opciones avanzadas'),
              h('label.field', h('span.field-label', 'Pista que toca el alumno'), trackSel),
              h('p.muted', 'La ★ marca la melodía detectada automáticamente. El resto de pistas suena como acompañamiento.'),
            )
          : null,
        h('div.spacer'),
        removeButton(name),
      ].filter(Boolean),
    );
  }

  function removeButton(name) {
    return h('button.btn.danger.small', {
      onclick: async () => {
        if (!confirm(`¿Quitar "${displayName(name)}" de la biblioteca?${isDesktop ? '\n\nSe enviará a la papelera de Windows, por si quieres recuperarla.' : ''}`)) return;
        try {
          await removeSong(name);
          toast('🗑️ Canción quitada');
        } catch (e) {
          console.error(e);
          toast('⚠️ No se pudo quitar la canción');
        }
        lastSelected = null;
        detail.classList.remove('open');
        detail.replaceChildren(h('div.empty-detail', h('div.big-emoji', '🎵'), h('p', 'Elige una canción de la lista')));
        refresh();
      },
    }, '🗑️ Quitar de la biblioteca');
  }

  const offChange = onSongsChanged(() => refresh());
  refresh().then(() => {
    const target = params.select || lastSelected;
    if (target && songs.some((s) => s.name === target)) select(target);
  });

  return () => {
    offChange();
    view.remove();
  };
}

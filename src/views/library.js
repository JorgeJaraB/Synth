// Biblioteca de canciones: lista la carpeta, permite añadir y elegir cómo practicar.
import {
  listSongs, loadSong, importFiles, removeSong, renameSong, onSongsChanged, openSongsFolder, songsFolderPath,
  isDesktop, displayName, EXAMPLES_CATEGORY, isAppSong,
} from '../core/library.js';
import { songArtist, setArtist } from '../core/song-info.js';
import { navigate } from '../router.js';
import { noteName } from '../core/notes.js';
import { settings } from '../core/settings.js';
import { h, toast, formatTime } from '../ui/dom.js';
import { audio } from '../core/audio.js';
import { SongPlayer } from '../core/player.js';
import { previewStart, PREVIEW_SECONDS } from '../core/song-preview.js';

const MY_SONGS = 'Mis canciones';
const ALL = '__todas__';
let lastSelected = null;
let lastCategory = ALL;
let lastFilters = new Set();
let lastSort = 'nombre';
// Datos de cada canción (letra, duración) que se van leyendo en segundo plano para los filtros.
const meta = new Map();

const WEEK = 7 * 24 * 3600 * 1000;
const FILTERS = [
  ['letra', '🎤 Con letra'],
  ['sinletra', '🎹 Sin letra'],
  ['cortas', '⏱️ Cortas (1 min o menos)'],
  ['partitura', '📄 Partituras'],
  ['nuevas', '🆕 Añadidas esta semana'],
];
const isScore = (name) => /\.(musicxml|mxl|xml)$/i.test(name);

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
  // Canciones que se acaban de guardar o editar: hay que volver a leer sus datos.
  for (const n of params.changed || []) if (n) meta.delete(n);
  let songs = [];
  let alive = true;
  let category = lastCategory;
  let query = '';
  let showHelp = false;
  let folderPath = null;

  const list = h('div.song-list');
  const chips = h('div.category-chips');
  let filters = lastFilters;
  let sort = lastSort;
  const filterChips = h('div.category-chips.filter-chips');
  const metaStatus = h('span.muted.meta-status');
  const sortSel = h('select.compact', {
    title: 'Ordenar',
    onchange: () => { sort = lastSort = sortSel.value; renderList(); },
  },
    [['nombre', '🔤 Por nombre'], ['recientes', '🆕 Más recientes'], ['cortas', '⏱️ Más cortas']].map(([v, t]) => h('option', { value: v, selected: v === sort }, t)));
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
      h('div.library-body', helpHost, chips, filterChips, list),
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

  function renderFilters() {
    const hasDates = songs.some((x) => x.mtime);
    filterChips.replaceChildren(
      h('span.filter-label', 'Filtrar:'),
      ...FILTERS.filter(([k]) => k !== 'nuevas' || hasDates).map(([k, label]) =>
        h('button.chip.small', {
          class: filters.has(k) ? 'active' : '',
          onclick: () => {
            if (filters.has(k)) filters.delete(k);
            else {
              filters.add(k);
              // "Con letra" y "Sin letra" no pueden ir juntas
              if (k === 'letra') filters.delete('sinletra');
              if (k === 'sinletra') filters.delete('letra');
            }
            renderFilters();
            renderList();
          },
        }, label)),
      h('div.spacer'),
      metaStatus,
      sortSel,
    );
  }

  /** ¿Pasa la canción los filtros? null = aún no se sabe (se está leyendo). */
  function passes(s) {
    const m = meta.get(s.name);
    for (const f of filters) {
      if (f === 'partitura' && !isScore(s.name)) return false;
      if (f === 'nuevas' && !(s.mtime && Date.now() - s.mtime < WEEK)) return false;
      if (f === 'letra' || f === 'sinletra' || f === 'cortas') {
        if (!m) return null;
        if (m.error) return false;
        if (f === 'letra' && !m.hasLyrics) return false;
        if (f === 'sinletra' && m.hasLyrics) return false;
        if (f === 'cortas' && m.duration > 61) return false;
      }
    }
    return true;
  }

  // Lee en segundo plano las canciones que faltan (de una en una para no bloquear la app).
  let metaRun = 0;
  async function loadMeta() {
    const run = ++metaRun;
    const missing = songs.filter((x) => !meta.has(x.name));
    let done = 0;
    for (const x of missing) {
      if (run !== metaRun || !alive) return;
      metaStatus.textContent = `Leyendo canciones… ${done}/${missing.length}`;
      try {
        const song = await loadSong(x.name);
        meta.set(x.name, { hasLyrics: song.hasLyrics, duration: song.duration, artist: songArtist(x.name, song) });
      } catch {
        meta.set(x.name, { error: true });
      }
      done++;
      if (done % 8 === 0 && (filters.size || sort === 'cortas')) renderList();
      await new Promise((r) => setTimeout(r, 0));
    }
    metaStatus.textContent = '';
    if (missing.length) renderList();
  }

  function songCard(s, i) {
    const kar = /\.kar$/i.test(s.name);
    const score = isScore(s.name);
    const card = h('button.song-card', {
      'data-name': s.name, style: { '--hue': (i * 47) % 360 }, class: s.name === lastSelected ? 'selected' : '',
      onclick: () => select(s.name),
      oncontextmenu: (e) => {
        e.preventDefault();
        startRename(s, wrap);
      },
    },
      h('div.song-icon', score ? '📄' : kar ? '🎤' : '🎼'),
      h('div.song-name', displayName(s.name)),
      meta.get(s.name)?.artist ? h('div.song-artist', meta.get(s.name).artist) : null,
      h('div.song-type', cardInfo(s, score, kar)),
    );
    const playing = preview?.name === s.name;
    const wrap = h('div.song-card-wrap', { 'data-name': s.name, class: [s.name === lastSelected ? 'selected' : '', playing ? 'previewing' : ''].join(' ') },
      card,
      h('div.song-actions',
        h('button.song-action', { title: playing ? 'Parar' : `Escuchar un trozo (${PREVIEW_SECONDS} s)`, onclick: () => togglePreview(s.name) }, playing ? '⏹' : '▶'),
        h('button.song-action', { title: 'Cambiar el nombre (o clic derecho)', onclick: () => startRename(s, wrap) }, '✏️'),
      ),
    );
    return wrap;
  }

  // ---------- Cambiar el nombre ----------
  function startRename(s, wrap) {
    const input = h('input.rename-input', { type: 'text', value: displayName(s.name), maxLength: 80 });
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (!save || !value || value === displayName(s.name)) return renderList();
      try {
        const rel = await renameSong(s.name, value);
        meta.delete(s.name);
        if (lastSelected === s.name) lastSelected = rel;
        toast('✏️ Nombre cambiado');
        await refresh();
        select(rel);
      } catch (e) {
        console.error(e);
        toast(/existe/i.test(e?.message) ? '⚠️ Ya hay una canción con ese nombre' : '⚠️ No se pudo cambiar el nombre', 3500);
        renderList();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    wrap.replaceChildren(h('div.song-card.editing', { style: { '--hue': wrap.firstChild?.style?.getPropertyValue('--hue') || 0 } },
      h('div.song-icon', '✏️'),
      input,
      h('div.song-type', 'Enter para guardar · Esc para cancelar'),
    ));
    input.focus();
    input.select();
  }

  // ---------- Escuchar un trozo ----------
  let preview = null; // { name, player, raf }
  function stopPreview() {
    if (!preview) return;
    cancelAnimationFrame(preview.raf);
    preview.player.pause();
    audio.releaseAll();
    const name = preview.name;
    preview = null;
    markPreview(name, false);
  }
  function markPreview(name, on) {
    for (const w of list.querySelectorAll('.song-card-wrap')) {
      if (w.dataset.name !== name) continue;
      w.classList.toggle('previewing', on);
      const b = w.querySelector('.song-action');
      if (b) b.textContent = on ? '⏹' : '▶';
    }
  }
  async function togglePreview(name) {
    if (preview?.name === name) return stopPreview();
    stopPreview();
    await audio.init();
    let song;
    try {
      song = await loadSong(name);
    } catch {
      toast('⚠️ No se pudo leer esta canción');
      return;
    }
    if (!alive) return;
    const start = previewStart(song);
    const player = new SongPlayer(song, { mode: 'escuchar', allTracks: true });
    player.speed = 1;
    player.seek(start);
    player.play();
    preview = { name, player, raf: 0 };
    markPreview(name, true);
    const end = start + PREVIEW_SECONDS;
    const loop = () => {
      if (!preview || preview.player !== player) return;
      player.update();
      if (player.time >= end || !player.playing) return stopPreview();
      preview.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function cardInfo(s, score, kar) {
    const m = meta.get(s.name);
    const kind = score ? 'Partitura' : kar ? 'Karaoke' : 'MIDI';
    if (!m || m.error) return kind;
    return `${score ? 'Partitura · ' : ''}${m.hasLyrics ? '🎤 Con letra' : 'Sin letra'} · ${formatTime(m.duration)}`;
  }

  function renderList() {
    const pending = [];
    let visible = songs.filter((s) => {
      const text = (displayName(s.name) + ' ' + (meta.get(s.name)?.artist || '')).toLowerCase();
      if (!((category === ALL || s.category === category) && (!query || text.includes(query)))) return false;
      const ok = passes(s);
      if (ok === null) pending.push(s);
      return ok === true;
    });
    if (sort === 'recientes') visible = [...visible].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    if (sort === 'cortas') visible = [...visible].sort((a, b) => (meta.get(a.name)?.duration ?? 1e9) - (meta.get(b.name)?.duration ?? 1e9));
    if (!songs.length) {
      list.replaceChildren(h('div.empty-state', h('div.big-emoji', '🎼'), h('h3', 'Todavía no hay canciones'), h('p', 'Arrastra aquí archivos MIDI, karaoke o partituras MusicXML, o crea una canción con ✏️.')));
      return;
    }
    if (!visible.length) {
      list.replaceChildren(h('div.empty-state', h('p', pending.length
        ? 'Leyendo las canciones para filtrarlas…'
        : query ? `No hay canciones que coincidan con "${search.value}".` : 'Ninguna canción cumple los filtros elegidos.')));
      return;
    }
    let i = 0;
    if (category === ALL && !query && !filters.size && sort === 'nombre' && categories().length > 1) {
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
    renderFilters();
    renderList();
    renderHelp();
    loadMeta();
    if (lastSelected && !songs.some((s) => s.name === lastSelected)) {
      lastSelected = null;
      detail.replaceChildren(h('div.empty-detail', h('div.big-emoji', '🎵'), h('p', 'Elige una canción de la lista')));
    }
  }

  async function select(name) {
    lastSelected = name;
    for (const c of list.querySelectorAll('.song-card, .song-card-wrap')) c.classList.toggle('selected', c.dataset.name === name);
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
        artistRow(name, song),
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
        isAppSong(name, song)
          ? h('button.btn.edit-song-btn', { onclick: () => navigate('song-editor', { edit: name }) }, '✏️ Editar la canción')
          : h('button.btn.edit-song-btn', { title: 'Se abre en "Crear canción" para retocarla y guardarla como una canción nueva', onclick: () => navigate('song-editor', { edit: name }) }, '✏️ Abrir en el editor (copia)'),
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

  /** Artista de la canción, que se puede escribir o corregir (se guarda en este equipo). */
  function artistRow(name, song) {
    const row = h('div.artist-row');
    const show = () => {
      const a = songArtist(name, song);
      row.replaceChildren(
        h('span', '🎤 ', a || h('i', 'Sin artista')),
        h('button.btn.icon.small', { title: a ? 'Cambiar el artista' : 'Escribir el artista', onclick: edit }, '✏️'),
      );
    };
    const edit = () => {
      const input = h('input.editor-input', { type: 'text', value: songArtist(name, song), placeholder: 'Artista o grupo', maxLength: 80 });
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (ok) {
          setArtist(name, input.value);
          const m = meta.get(name);
          if (m) m.artist = input.value.trim();
          renderList();
        }
        show();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      row.replaceChildren(h('span', '🎤'), input);
      input.focus();
      input.select();
    };
    show();
    return row;
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
    alive = false;
    stopPreview();
    offChange();
    view.remove();
  };
}

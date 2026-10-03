// Crear canción: el maestro escribe las notas y la letra, la escucha y la guarda en la biblioteca.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { importFiles, parseAny } from '../core/library.js';
import { songToText, noteToken } from '../core/song-import.js';
import { TouchKeyboard } from '../ui/keyboard.js';
import { parseSongText, buildKar, EXAMPLE_SONG } from '../core/song-text.js';
import { noteColor, noteName } from '../core/notes.js';
import { navigate } from '../router.js';
import { h, toast, segmented } from '../ui/dom.js';
import { chordSheetPanel } from './chord-sheet-editor.js';

const DRAFT_KEY = 'synth-manos-borrador-cancion';
let lastTab = 'notas';

export function mount(root, params = {}) {
  let draft = {};
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    /* sin borrador */
  }
  const title = h('input.editor-input', { type: 'text', placeholder: 'Ej.: Los pollitos', value: draft.title || '', maxLength: 80 });
  const bpm = h('input.editor-input.small', { type: 'number', min: 40, max: 220, value: draft.bpm || 100 });
  const meter = h('select', [4, 3, 2].map((b) => h('option', { value: b, selected: Number(draft.beatsPerBar || 4) === b }, `${b}/4`)));
  const notesTa = h('textarea.editor-ta', { rows: 5, placeholder: 'Do Do Sol Sol | La La Sol- | Fa Fa Mi Mi | Re Re Do-', value: draft.notesText || '' });
  const lyricsTa = h('textarea.editor-ta', { rows: 5, placeholder: 'Es-tre-lli-ta, ¿dón-de_es-tás?\nMe pre-gun-to qué se-rás.', value: draft.lyricsText || '' });
  const chordsIn = h('input.editor-input', { type: 'text', placeholder: 'Opcional, uno por compás: Do Do Fa Do | Sol Do Sol Do', value: draft.chordsText || '' });
  const preview = h('div.editor-preview');
  const messages = h('div.editor-messages');
  const playBtn = h('button.btn', { onclick: () => (playing ? stop() : play()) }, '▶ Escuchar');
  const saveBtn = h('button.btn.primary', { onclick: save }, '💾 Guardar en mis canciones');

  const help = h('details.editor-help', { open: !draft.notesText },
    h('summary', '❓ Cómo se escribe'),
    h('table',
      h('tr', h('td', h('code', 'Do Re Mi')), h('td', 'Una nota de 1 pulso (también C D E…)')),
      h('tr', h('td', h('code', 'Sol-'), ' ', h('code', 'Sol--')), h('td', 'Nota larga: 2 y 3 pulsos')),
      h('tr', h('td', h('code', 'Do/'), ' ', h('code', 'Do//')), h('td', 'Medio pulso (corchea) y un cuarto')),
      h('tr', h('td', h('code', 'Do.')), h('td', 'Con puntillo (pulso y medio)')),
      h('tr', h('td', h('code', 'Do5'), ' ', h('code', 'La3')), h('td', 'Otra octava (4 es la central)')),
      h('tr', h('td', h('code', 'Fa#'), ' ', h('code', 'Sib')), h('td', 'Sostenido y bemol')),
      h('tr', h('td', h('code', '_'), ' ', h('code', '_-')), h('td', 'Silencio de 1 y 2 pulsos')),
      h('tr', h('td', h('code', '|')), h('td', 'Barra de compás (opcional, solo para leerlo mejor)')),
      h('tr', h('td', h('code', 'Es-tre-lli-ta')), h('td', 'Letra: sílabas con guiones, una por nota. Cada línea es una línea del karaoke.')),
      h('tr', h('td', h('code', 'dón-de_es-tás')), h('td', 'Dos sílabas en una misma nota: únelas con _')),
    ),
  );

  // ---------- Teclado para probar y añadir notas ----------
  const durSel = h('select.compact', { title: 'Duración de la nota que se añade' },
    [['', '1 pulso'], ['-', '2 pulsos'], ['--', '3 pulsos'], ['---', '4 pulsos'], ['/', 'medio pulso'], ['//', '¼ de pulso'], ['/-', 'pulso y medio']].map(([v, t]) => h('option', { value: v }, t)));
  const addTok = (tok) => {
    const v = notesTa.value;
    notesTa.value = v + (v && !/\s$/.test(v) ? ' ' : '') + tok;
    notesTa.scrollTop = notesTa.scrollHeight;
    refresh();
  };
  const padCanvas = h('canvas.editor-kb');
  const addMode = h('input', { type: 'checkbox', checked: true });
  const padCard = h('div.editor-pad',
    h('div.row.pad-head',
      h('b', '🎹 Prueba notas'),
      h('label.toggle.small', addMode, h('span.toggle-track', h('span.toggle-thumb')), h('span', 'Añadirlas a la canción')),
      durSel,
    ),
    h('div.keyboard-wrap.editor-kb-wrap', padCanvas),
    h('div.row.pad-actions',
      h('button.btn.small', { onclick: () => addTok('_' + durSel.value) }, '𝄽 Silencio'),
      h('button.btn.small', { onclick: () => addTok('|') }, '| Barra de compás'),
      h('button.btn.small', {
        onclick: () => {
          notesTa.value = notesTa.value.replace(/\s*\S+\s*$/, '');
          refresh();
        },
      }, '⌫ Quitar la última'),
    ),
  );
  const pad = new TouchKeyboard(padCanvas, {
    low: 60,
    high: 84,
    onNoteOn: (m) => {
      audio.init();
      audio.noteOn(m, 0.8, settings.pianoInstrument);
      if (addMode.checked) {
        const names = settings.notation === 'letras' ? 'letras' : 'solfeo';
        addTok(noteToken(m, names) + durSel.value);
      }
    },
    onNoteOff: (m) => audio.noteOff(m, settings.pianoInstrument),
  });
  let padAlive = true;
  const padLoop = () => {
    if (!padAlive) return;
    requestAnimationFrame(padLoop);
    if (!padCanvas.isConnected || padCanvas.offsetParent === null) return;
    pad.draw();
  };
  padLoop();

  const sheet = chordSheetPanel();
  // Abrir una partitura o un MIDI y pasarlo al formato del editor
  const fileIn = h('input', {
    type: 'file', accept: '.mid,.midi,.kar,.musicxml,.mxl,.xml', style: { display: 'none' },
    onchange: async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const song = await parseAny(new Uint8Array(await f.arrayBuffer()), f.name);
        const r = songToText(song, { notation: settings.notation === 'letras' ? 'letras' : 'solfeo' });
        title.value = r.title || f.name.replace(/\.[^.]+$/, '');
        bpm.value = r.bpm;
        meter.value = r.beatsPerBar;
        notesTa.value = r.notesText;
        lyricsTa.value = r.lyricsText;
        chordsIn.value = r.chordsText;
        refresh();
        toast(r.warnings.length ? '⚠️ ' + r.warnings.join(' ') : '✅ Canción abierta: ya puedes retocarla', 4500);
      } catch (e) {
        console.error(e);
        toast('⚠️ No se pudo leer ese archivo');
      }
    },
  });
  const notesActions = h('div.row.editor-actions',
    h('button.btn', { title: 'Convierte un MIDI o una partitura MusicXML al formato del editor', onclick: () => fileIn.click() }, '📂 Abrir partitura o MIDI'),
    h('button.btn', { onclick: loadExample }, '📋 Cargar un ejemplo'),
    playBtn, saveBtn, fileIn);
  const sheetActions = h('div.row.editor-actions', ...sheet.actions);
  let notesBody;
  function showTab(t) {
    lastTab = t;
    notesBody.hidden = notesActions.hidden = t !== 'notas';
    sheet.el.hidden = sheetActions.hidden = t !== 'acordes';
    if (t !== 'notas') stop();
  }
  const view = h(
    'div.view.editor-view',
    h('div.view-toolbar.wrap',
      h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
      h('h2', '✏️ Crear canción'),
      segmented([['notas', '✏️ Notas y letra'], ['acordes', '🎸 Acordes y letra (pegar)']], params.tab || lastTab, showTab),
      h('div.spacer'),
      notesActions,
      sheetActions,
    ),
    (notesBody = h('div.editor-body',
      h('div.editor-form',
        h('label.field', h('span.field-label', 'Título'), title),
        h('div.field-row', h('label.field', h('span.field-label', 'Velocidad (pulsos por minuto)'), bpm), h('label.field', h('span.field-label', 'Compás'), meter)),
        h('label.field', h('span.field-label', '🎵 Notas'), notesTa),
        h('label.field', h('span.field-label', '🎤 Letra (opcional)'), lyricsTa),
        h('label.field', h('span.field-label', '🎸 Acordes (opcional, para el karaoke de acordes)'), chordsIn),
        help,
      ),
      h('div.editor-side', padCard, h('h3', 'Vista previa'), messages, preview),
    )),
    sheet.el,
  );
  root.append(view);

  let parsed = null;
  function refresh() {
    const beatsPerBar = Number(meter.value);
    parsed = parseSongText({ notesText: notesTa.value, lyricsText: lyricsTa.value, chordsText: chordsIn.value, beatsPerBar });
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: title.value, bpm: bpm.value, beatsPerBar, notesText: notesTa.value, lyricsText: lyricsTa.value, chordsText: chordsIn.value }));
    } catch {
      /* sin almacenamiento */
    }
    messages.replaceChildren(
      ...[
      ...parsed.errors.map((e) => h('p.msg-error', '❌ ' + e)),
      ...parsed.warnings.map((w) => h('p.msg-warn', '⚠️ ' + w)),
      !parsed.errors.length && !parsed.warnings.length && parsed.notes.length
        ? h('p.msg-ok', `✅ ${parsed.notes.filter((n) => !n.rest).length} notas · ${Math.round((parsed.totalBeats * 60) / Number(bpm.value || 100))} segundos`)
        : null,
      ].filter(Boolean),
    );
    // Notas con su sílaba debajo, en líneas según la letra
    let si = 0;
    const rows = [];
    let row = [];
    for (const n of parsed.notes) {
      if (n.rest) {
        row.push(h('span.ed-note.rest', { style: { '--w': n.beats } }, h('b', '𝄽'), h('small', '')));
        continue;
      }
      const syl = parsed.syllables[si++] || '';
      if ((syl.startsWith('/') || syl.startsWith('\\')) && row.length) {
        rows.push(row);
        row = [];
      }
      row.push(h('span.ed-note', { 'data-start': n.start, style: { '--c': noteColor(n.midi), '--w': n.beats } },
        h('b', settings.notation === 'colores' ? '' : noteName(n.midi, settings.notation)),
        h('small', syl.replace(/^[/\\]/, '')),
      ));
    }
    if (row.length) rows.push(row);
    preview.replaceChildren(...(rows.length ? rows.map((r) => h('div.ed-row', r)) : [h('p.muted', 'Escribe las notas a la izquierda y aquí verás cómo queda.')]));
    saveBtn.disabled = !parsed.notes.length || parsed.errors.length > 0;
  }
  for (const el of [title, bpm, meter, notesTa, lyricsTa, chordsIn]) el.addEventListener('input', refresh);
  meter.addEventListener('change', refresh);

  function loadExample() {
    title.value = EXAMPLE_SONG.title;
    bpm.value = EXAMPLE_SONG.bpm;
    meter.value = EXAMPLE_SONG.beatsPerBar;
    notesTa.value = EXAMPLE_SONG.notesText;
    lyricsTa.value = EXAMPLE_SONG.lyricsText;
    chordsIn.value = EXAMPLE_SONG.chordsText;
    refresh();
  }

  // ---------- Escuchar ----------
  let playing = false;
  let timer = null;
  function play() {
    if (!parsed?.notes.length) return;
    audio.init();
    const spb = 60 / Number(bpm.value || 100);
    const t0 = audio.now() + 0.15;
    const events = [
      ...parsed.notes.filter((n) => !n.rest).map((n) => ({ ...n, kind: 'melodia' })),
      ...parsed.chords.flatMap((c) => c.notes.map((m) => ({ midi: m, start: c.start, beats: c.beats, kind: 'acorde' }))),
    ].sort((a, b) => a.start - b.start);
    let i = 0;
    playing = true;
    playBtn.textContent = '⏹ Parar';
    const end = t0 + parsed.totalBeats * spb + 0.5;
    const chips = [...preview.querySelectorAll('.ed-note[data-start]')];
    timer = setInterval(() => {
      const now = audio.now();
      // Se programan las notas de los próximos 0,3 s (así se puede parar en cualquier momento).
      while (i < events.length && t0 + events[i].start * spb < now + 0.3) {
        const e = events[i++];
        const at = t0 + e.start * spb;
        if (e.kind === 'melodia') audio.playNote(e.midi, e.beats * spb * 0.95, at, 0.8, settings.pianoInstrument, 'main');
        else audio.playNote(e.midi, e.beats * spb * 0.98, at, 0.5, 'piano', 'acc');
      }
      const beat = (now - t0) / spb;
      for (const c of chips) {
        const s = Number(c.dataset.start);
        c.classList.toggle('playing', beat >= s && beat < s + 0.95);
      }
      if (now > end) stop();
    }, 40);
  }
  function stop() {
    clearInterval(timer);
    playing = false;
    playBtn.textContent = '▶ Escuchar';
    audio.releaseAll();
    preview.querySelectorAll('.playing').forEach((c) => c.classList.remove('playing'));
  }

  // ---------- Guardar ----------
  async function save() {
    if (!parsed || parsed.errors.length || !parsed.notes.length) return;
    const name = (title.value.trim() || 'Mi canción').replace(/[<>:"/\\|?*]/g, '').slice(0, 60);
    const bytes = buildKar({
      title: name,
      bpm: Number(bpm.value || 100),
      beatsPerBar: Number(meter.value),
      notes: parsed.notes,
      syllables: parsed.syllables,
      chords: parsed.chords,
    });
    const { added } = await importFiles([new File([bytes], name + '.kar')]);
    if (!added.length) {
      toast('⚠️ No se pudo guardar la canción');
      return;
    }
    stop();
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nada */
    }
    toast(`✅ "${name}" guardada en tus canciones`);
    navigate('library', { select: added[0] });
  }

  refresh();
  showTab(params.tab || lastTab);
  return () => {
    padAlive = false;
    pad.destroy();
    stop();
    view.remove();
  };
}

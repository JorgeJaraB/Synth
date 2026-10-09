// "Crear canción" → pestaña "Acordes y letra": se pega una canción de una web de acordes
// (acordes encima de la letra) y se guarda como karaoke para el karaoke de acordes.
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { saveCreatedSong } from '../core/library.js';
import { parseChordSheet, layoutChordSheet, chordSheetToKar, accompanimentNotes, keyName, inKey } from '../core/chord-sheet.js';
import { SOLFEGE, LETTERS } from '../core/notes.js';
import { navigate } from '../router.js';
import { h, toast } from '../ui/dom.js';

const DRAFT_KEY = 'synth-manos-borrador-acordes';

const EXAMPLE = `Key: C

[Estrofa]
C                 G
  Estrellita, ¿dónde estás?
F           C
  Me pregunto qué serás.
`;

/**
 * Devuelve { el, actions, load } para colocarlos en la pantalla del editor.
 * @param opts.editing  () => ruta de la canción que se está editando (o null si es nueva)
 */
export function chordSheetPanel({ editing = () => null } = {}) {
  let draft = {};
  try {
    if (!editing()) draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    /* sin borrador */
  }
  const title = h('input.editor-input', { type: 'text', placeholder: 'Ej.: Creep', value: draft.title || '', maxLength: 80 });
  const artist = h('input.editor-input', { type: 'text', placeholder: 'Opcional. Ej.: Radiohead', value: draft.artist || '', maxLength: 80 });
  const bpm = h('input.editor-input.small', { type: 'number', min: 40, max: 220, value: draft.bpm || 90 });
  const per = h('select', [[2, '2 pulsos (cambios rápidos)'], [4, '4 pulsos (un compás)'], [8, '8 pulsos (dos compases)']].map(([v, t]) => h('option', { value: v, selected: Number(draft.per || 4) === v }, t)));
  const keySel = h('select', h('option', { value: 'auto' }, 'Automática'),
    SOLFEGE.map((s, i) => h('option', { value: i }, `${s} mayor (${LETTERS[i]})`)));
  keySel.value = draft.key ?? 'auto';
  const text = h('textarea.editor-ta.sheet-ta', {
    rows: 16,
    spellcheck: false,
    placeholder: 'Pega aquí la canción tal cual viene en la web de acordes:\n\nKey: G\n[Intro] G  B  C  Cm\n                      G\nWhen you were here before\n                         B\nCouldn\'t look you in the eye',
    value: draft.text || '',
  });
  const messages = h('div.editor-messages');
  const preview = h('div.sheet-preview');
  const playBtn = h('button.btn', { onclick: () => (playing ? stop() : play()) }, '▶ Escuchar');
  const saveBtn = h('button.btn.primary', { onclick: save }, '💾 Guardar en mis canciones');

  // ---------- Marcar el pulso: se toca al ritmo de la canción y se calcula la velocidad ----------
  let taps = [];
  const tapInfo = h('small.muted.tap-info', '');
  const tapBtn = h('button.btn.small.tap-btn', {
    type: 'button',
    title: 'Pon la canción (en YouTube, por ejemplo) y pulsa aquí siguiendo el pulso',
    onclick: () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; // pausa larga: se empieza de nuevo
      taps.push(now);
      taps = taps.slice(-12);
      if (taps.length < 4) {
        tapInfo.textContent = `Sigue… (${taps.length}/4)`;
        return;
      }
      const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
      const mid = gaps[Math.floor(gaps.length / 2)];
      const v = Math.max(40, Math.min(220, Math.round(60000 / mid)));
      bpm.value = v;
      tapInfo.textContent = `≈ ${v} pulsos por minuto`;
      refresh();
    },
  }, '👆 Marca el pulso');

  const help = h('details.editor-help', { open: !draft.text },
    h('summary', '❓ Cómo funciona'),
    h('ul',
      h('li', 'Copia la canción de una web de acordes (por ejemplo, Ultimate Guitar o Cifra Club) y pégala tal cual: ', h('b', 'cada acorde encima de la palabra'), ' en la que cambia.'),
      h('li', 'Si pone ', h('code', 'Key: G'), ' (o ', h('code', 'Tono: Sol'), ', ', h('code', 'Tom: G'), '), se usa esa tonalidad; si no, la del primer acorde. Si no es la que buscas, elígela en ', h('b', 'Tonalidad'), '.'),
      h('li', 'Las secciones entre corchetes, como ', h('code', '[Estribillo]'), ', separan párrafos de la letra.'),
      h('li', 'Estas webs no traen la melodía: suena una ', h('b', 'nota guía'), ' con el ritmo de las palabras.'),
      h('li', 'La canción se usa sobre todo en el ', h('b', '🤟 Karaoke de acordes'), ', con los acordes exactos de la hoja.'),
    ),
  );
  const tempoHelp = h('details.editor-help',
    h('summary', '🥁 ¿Qué velocidad pongo? ¿Cuánto dura cada acorde?'),
    h('ul',
      h('li', h('b', 'Velocidad:'), ' pon la canción original y pulsa ', h('b', '👆 Marca el pulso'), ' siguiendo el ritmo (como dando palmas), 4 veces o más. La app calcula los pulsos por minuto. Muchas webs también la indican como ', h('i', 'BPM'), ' o ', h('i', 'tempo'), '; si buscas «nombre de la canción bpm» en internet suele salir.'),
      h('li', h('b', 'Cuánto dura cada acorde:'), ' cuenta las palmas mientras suena un acorde, hasta que cambia. En la mayoría de canciones son ', h('b', '4'), ' (un compás). Si los acordes cambian muy rápido, prueba con 2; si van muy lentos, con 8.'),
      h('li', 'Pulsa ', h('b', '▶ Escuchar'), ' para comprobarlo: si los acordes van por delante de la canción, baja la velocidad; si van por detrás, súbela. No tiene que ser exacto: en el karaoke se puede ir más lento o más rápido.'),
    ),
  );

  const el = h('div.editor-body',
    h('div.editor-form',
      h('div.field-row', h('label.field', h('span.field-label', 'Título'), title), h('label.field', h('span.field-label', 'Artista'), artist)),
      h('div.field-row',
        h('label.field', h('span.field-label', 'Velocidad (pulsos por minuto)'), h('div.row.tap-row', bpm, tapBtn, tapInfo)),
        h('label.field', h('span.field-label', 'Cada acorde dura'), per),
        h('label.field', h('span.field-label', 'Tonalidad'), keySel),
      ),
      tempoHelp,
      h('label.field', h('span.field-label', '🎸 Acordes y letra'), text),
      help,
    ),
    h('div.editor-side', h('h3', 'Vista previa'), messages, preview),
  );

  let sheet = null;
  const source = () => ({ kind: 'acordes', title: title.value, artist: artist.value, bpm: bpm.value, per: per.value, key: keySel.value, text: text.value });
  function refresh() {
    try {
      if (!editing()) localStorage.setItem(DRAFT_KEY, JSON.stringify(source()));
    } catch {
      /* sin almacenamiento */
    }
    sheet = text.value.trim() ? parseChordSheet(text.value) : null;
    const autoKey = sheet?.key;
    keySel.options[0].textContent = autoKey != null ? `Automática (${SOLFEGE[autoKey]} mayor)` : 'Automática';
    if (sheet && keySel.value !== 'auto') sheet.key = Number(keySel.value);
    if (!sheet) {
      messages.replaceChildren();
      preview.replaceChildren(h('p.muted', 'Pega la canción a la izquierda y aquí verás los acordes sobre la letra.'));
      saveBtn.disabled = playBtn.disabled = true;
      return;
    }
    const layout = layoutChordSheet(sheet, { beatsPerChord: Number(per.value) });
    const outside = [...new Set(sheet.lines.flatMap((l) => l.chords).filter((c) => !inKey(c.root, sheet.key)).map((c) => c.name))];
    const secs = Math.round((layout.totalBeats * 60) / Number(bpm.value || 90));
    messages.replaceChildren(
      ...[
        ...sheet.errors.map((e) => h('p.msg-error', '❌ ' + e)),
        !sheet.errors.length ? h('p.msg-ok', `✅ Tonalidad: ${keyName(sheet.key)} mayor · ${layout.chords.length} acordes · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} min`) : null,
        outside.length
          ? h('p.msg-warn', `⚠️ ${outside.join(', ')} no ${outside.length === 1 ? 'es' : 'son'} de la tonalidad: se oirá${outside.length === 1 ? '' : 'n'} en el acompañamiento, pero no se pide${outside.length === 1 ? '' : 'n'} con las manos.`)
          : null,
      ].filter(Boolean),
    );
    let ci = 0;
    preview.replaceChildren(
      ...sheet.lines.map((l) =>
        h('div.sheet-line', { class: l.paragraph ? 'para' : '' },
          l.chords.length ? h('div.sheet-chords', l.chords.map((c) => h('span.sheet-chord', { class: inKey(c.root, sheet.key) ? '' : 'out', 'data-i': ci++ }, c.name))) : null,
          l.lyric ? h('div.sheet-lyric', l.lyric.trim()) : null,
        ),
      ),
    );
    saveBtn.disabled = playBtn.disabled = sheet.errors.length > 0;
  }
  for (const x of [title, artist, bpm, text]) x.addEventListener('input', refresh);
  per.addEventListener('change', refresh);
  keySel.addEventListener('change', refresh);

  // ---------- Escuchar: acordes y nota guía, marcando el acorde que suena ----------
  let playing = false;
  let timer = null;
  function play() {
    if (!sheet || sheet.errors.length) return;
    audio.init();
    const { chords, words } = layoutChordSheet(sheet, { beatsPerChord: Number(per.value) });
    const spb = 60 / Number(bpm.value || 90);
    const t0 = audio.now() + 0.15;
    const at = (start) => chords.reduce((c, x) => (x.start <= start + 1e-6 ? x : c), chords[0]);
    const events = [
      ...chords.flatMap((c) => accompanimentNotes(c).map((m) => ({ midi: m, start: c.start, beats: c.beats, acc: true }))),
      ...words.map((w) => ({ midi: 60 + (at(w.start)?.root ?? 0), start: w.start, beats: Math.max(0.25, w.beats * 0.9) })),
    ].sort((a, b) => a.start - b.start);
    const chips = [...preview.querySelectorAll('.sheet-chord[data-i]')];
    let i = 0;
    playing = true;
    playBtn.textContent = '⏹ Parar';
    const end = t0 + (chords.at(-1).start + chords.at(-1).beats) * spb + 0.5;
    timer = setInterval(() => {
      const now = audio.now();
      while (i < events.length && t0 + events[i].start * spb < now + 0.3) {
        const e = events[i++];
        audio.playNote(e.midi, e.beats * spb * 0.97, t0 + e.start * spb, e.acc ? 0.45 : 0.6, e.acc ? 'piano' : settings.pianoInstrument, e.acc ? 'acc' : 'main');
      }
      const beat = (now - t0) / spb;
      const cur = chords.findIndex((c) => beat >= c.start && beat < c.start + c.beats);
      chips.forEach((c, k) => c.classList.toggle('playing', k === cur));
      if (cur >= 0 && chips[cur] && !chips[cur].dataset.seen) {
        chips.forEach((c) => delete c.dataset.seen);
        chips[cur].dataset.seen = '1';
        chips[cur].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

  async function save() {
    if (!sheet || sheet.errors.length) return;
    const name = (title.value.trim() || 'Canción con acordes').replace(/[<>:"/\\|?*]/g, '').slice(0, 60);
    const bytes = chordSheetToKar(sheet, { title: name, artist: artist.value.trim(), bpm: Number(bpm.value || 90), beatsPerChord: Number(per.value), source: source() });
    const was = editing();
    let rel;
    try {
      rel = await saveCreatedSong(bytes, name, was);
    } catch {
      toast('⚠️ No se pudo guardar la canción');
      return;
    }
    stop();
    try {
      if (!was) localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nada */
    }
    toast(was ? `✅ "${name}" guardada con los cambios` : `✅ "${name}" guardada: pruébala en el Karaoke de acordes`, 4000);
    navigate('library', { select: rel, changed: [was, rel] });
  }

  /** Rellena el formulario con lo guardado dentro de una canción (para editarla). */
  function load(src) {
    title.value = src.title || '';
    artist.value = src.artist || '';
    bpm.value = src.bpm || 90;
    per.value = src.per || 4;
    keySel.value = src.key ?? 'auto';
    text.value = src.text || '';
    help.open = false;
    refresh();
  }

  const exampleBtn = h('button.btn', {
    onclick: () => {
      title.value = 'Estrellita (con acordes)';
      artist.value = 'Canción popular';
      bpm.value = 100;
      keySel.value = 'auto';
      text.value = EXAMPLE;
      refresh();
    },
  }, '📋 Cargar un ejemplo');

  refresh();
  return { el, actions: [exampleBtn, playBtn, saveBtn], load, stop };
}

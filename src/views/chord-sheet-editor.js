// "Crear canción" → pestaña "Acordes y letra": se pega una canción de una web de acordes
// (acordes encima de la letra) y se guarda como karaoke para el karaoke de acordes.
import { importFiles } from '../core/library.js';
import { parseChordSheet, layoutChordSheet, chordSheetToKar, keyName, inKey } from '../core/chord-sheet.js';
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

/** Devuelve { el, actions } para colocarlos en la pantalla del editor. */
export function chordSheetPanel() {
  let draft = {};
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    /* sin borrador */
  }
  const title = h('input.editor-input', { type: 'text', placeholder: 'Ej.: Creep', value: draft.title || '', maxLength: 80 });
  const bpm = h('input.editor-input.small', { type: 'number', min: 40, max: 220, value: draft.bpm || 90 });
  const per = h('select', [[2, '2 pulsos (cambios rápidos)'], [4, '4 pulsos (un compás)'], [8, '8 pulsos (dos compases)']].map(([v, t]) => h('option', { value: v, selected: Number(draft.per || 4) === v }, t)));
  const text = h('textarea.editor-ta.sheet-ta', {
    rows: 16,
    spellcheck: false,
    placeholder: 'Pega aquí la canción tal cual viene en la web de acordes:\n\nKey: G\n[Intro] G  B  C  Cm\n                      G\nWhen you were here before\n                         B\nCouldn\'t look you in the eye',
    value: draft.text || '',
  });
  const messages = h('div.editor-messages');
  const preview = h('div.sheet-preview');
  const saveBtn = h('button.btn.primary', { onclick: save }, '💾 Guardar en mis canciones');

  const help = h('details.editor-help', { open: !draft.text },
    h('summary', '❓ Cómo funciona'),
    h('ul',
      h('li', 'Copia la canción de una web de acordes (por ejemplo, Ultimate Guitar o Cifra Club) y pégala tal cual: ', h('b', 'cada acorde encima de la palabra'), ' en la que cambia.'),
      h('li', 'Si pone ', h('code', 'Key: G'), ' (o ', h('code', 'Tono: Sol'), '), se usa esa tonalidad; si no, la del primer acorde.'),
      h('li', 'Las secciones entre corchetes, como ', h('code', '[Estribillo]'), ', separan párrafos de la letra.'),
      h('li', 'Estas webs no traen la melodía: suena una ', h('b', 'nota guía'), ' con el ritmo de las palabras. Ajusta la velocidad y cuánto dura cada acorde para que encaje.'),
      h('li', 'La canción se usa sobre todo en el ', h('b', '🤟 Karaoke de acordes'), ', con los acordes exactos de la hoja.'),
    ),
  );

  const el = h('div.editor-body',
    h('div.editor-form',
      h('label.field', h('span.field-label', 'Título'), title),
      h('div.field-row',
        h('label.field', h('span.field-label', 'Velocidad (pulsos por minuto)'), bpm),
        h('label.field', h('span.field-label', 'Cada acorde dura'), per),
      ),
      h('label.field', h('span.field-label', '🎸 Acordes y letra'), text),
      help,
    ),
    h('div.editor-side', h('h3', 'Vista previa'), messages, preview),
  );

  let sheet = null;
  function refresh() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: title.value, bpm: bpm.value, per: per.value, text: text.value }));
    } catch {
      /* sin almacenamiento */
    }
    sheet = text.value.trim() ? parseChordSheet(text.value) : null;
    if (!sheet) {
      messages.replaceChildren();
      preview.replaceChildren(h('p.muted', 'Pega la canción a la izquierda y aquí verás los acordes sobre la letra.'));
      saveBtn.disabled = true;
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
    preview.replaceChildren(
      ...sheet.lines.map((l) =>
        h('div.sheet-line', { class: l.paragraph ? 'para' : '' },
          l.chords.length ? h('div.sheet-chords', l.chords.map((c) => h('span.sheet-chord', { class: inKey(c.root, sheet.key) ? '' : 'out' }, c.name))) : null,
          l.lyric ? h('div.sheet-lyric', l.lyric.trim()) : null,
        ),
      ),
    );
    saveBtn.disabled = sheet.errors.length > 0;
  }
  for (const x of [title, bpm, text]) x.addEventListener('input', refresh);
  per.addEventListener('change', refresh);

  async function save() {
    if (!sheet || sheet.errors.length) return;
    const name = (title.value.trim() || 'Canción con acordes').replace(/[<>:"/\\|?*]/g, '').slice(0, 60);
    const bytes = chordSheetToKar(sheet, { title: name, bpm: Number(bpm.value || 90), beatsPerChord: Number(per.value) });
    const { added } = await importFiles([new File([bytes], name + '.kar')]);
    if (!added.length) {
      toast('⚠️ No se pudo guardar la canción');
      return;
    }
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nada */
    }
    toast(`✅ "${name}" guardada: pruébala en el Karaoke de acordes`, 4000);
    navigate('library', { select: added[0] });
  }

  const exampleBtn = h('button.btn', {
    onclick: () => {
      title.value = 'Estrellita (con acordes)';
      bpm.value = 100;
      text.value = EXAMPLE;
      refresh();
    },
  }, '📋 Cargar un ejemplo');

  refresh();
  return { el, actions: [exampleBtn, saveBtn] };
}

// Tocar con YouTube (prueba): lista de canciones preparadas y asistente en tres pasos
// (la canción, los acordes y sincronizar). Al tocar se usa el karaoke de acordes.
import { settings } from '../core/settings.js';
import { parseChordSheet, layoutChordSheet, keyName } from '../core/chord-sheet.js';
import { SOLFEGE, LETTERS } from '../core/notes.js';
import {
  parseVideoId, searchVideos, listYtSongs, saveYtSong, removeYtSong, createYtClock, fitSync, ytErrorText, thumbUrl,
} from '../core/youtube.js';
import { navigate } from '../router.js';
import { h } from '../ui/dom.js';

const MIN_TAPS = 4;

export function mount(root, params = {}) {
  const view = h('div.view.yt-view');
  root.append(view);
  let cleanup = null;
  const setBody = (...els) => {
    cleanup?.();
    cleanup = null;
    view.replaceChildren(...els);
  };

  // ---------- Lista de canciones preparadas ----------
  function showList() {
    const songs = listYtSongs();
    setBody(
      h('div.view-toolbar.wrap',
        h('button.btn.icon', { title: 'Volver a canciones', onclick: () => navigate('library') }, '←'),
        h('h2', '▶ Tocar con YouTube'),
        h('span.chip.small.beta', '🧪 Prueba'),
        h('div.spacer'),
        h('button.btn.primary', { onclick: () => showWizard() }, '➕ Preparar una canción'),
      ),
      h('div.yt-body',
        h('p.muted', 'Suena la canción original de YouTube y los alumnos ponen los acordes con las manos, como en el karaoke de acordes. Necesita internet.'),
        songs.length
          ? h('div.song-grid', songs.map((s) => h('div.yt-card',
              h('img.yt-thumb', { src: thumbUrl(s.videoId), alt: '' }),
              h('div.yt-card-body',
                h('b', s.title),
                s.artist ? h('div.muted', s.artist) : null,
                h('div.muted.small', `${Math.round(s.bpm)} ppm · ${keyName(s.keyPc ?? 0)} mayor`),
                h('div.row.yt-card-actions',
                  h('button.btn.primary.small', { onclick: () => navigate('karaoke-chords', { yt: s.id }) }, '🤟 Tocar'),
                  h('button.btn.small', { onclick: () => showWizard(s) }, '✏️'),
                  h('button.btn.small', {
                    title: 'Quitar',
                    onclick: () => {
                      if (!confirm(`¿Quitar "${s.title}"?`)) return;
                      removeYtSong(s.id);
                      showList();
                    },
                  }, '🗑️'),
                ),
              ),
            )))
          : h('div.empty-state', h('div.big-emoji', '🎬'), h('h3', 'Aún no hay canciones'), h('p', 'Pulsa ', h('b', '➕ Preparar una canción'), ': eliges el vídeo, pegas los acordes y los sincronizas una vez.')),
      ),
    );
  }

  // ---------- Asistente: la canción, los acordes, sincronizar ----------
  function showWizard(edit = null) {
    const state = {
      id: edit?.id || 'yt' + Date.now().toString(36),
      videoId: edit?.videoId || null,
      title: edit?.title || '',
      artist: edit?.artist || '',
      text: edit?.text || '',
      per: edit?.per || 4,
      key: edit?.key ?? 'auto',
      bpm: edit?.bpm || null,
      offset: edit?.offset ?? null,
    };

    // 1. La canción
    const results = h('div.yt-results');
    const picked = h('div.yt-picked');
    const q = h('input.editor-input', { type: 'search', placeholder: '🔍 Busca la canción o pega el enlace de YouTube' });
    const pick = (videoId, title = '', channel = '') => {
      state.videoId = videoId;
      if (title && !state.title) titleIn.value = state.title = title;
      if (channel && !state.artist) artistIn.value = state.artist = channel.replace(/ - Topic$|VEVO$/i, '').trim();
      picked.replaceChildren(h('div.yt-res.on', h('img.yt-thumb.small', { src: thumbUrl(videoId), alt: '' }), h('div', h('b', title || 'Vídeo elegido'), h('div.muted.small', channel || videoId))));
      results.replaceChildren();
      loadPlayer();
      refresh();
    };
    async function find() {
      const text = q.value.trim();
      if (!text) return;
      const id = parseVideoId(text);
      if (id) return pick(id);
      results.replaceChildren(h('div.spinner'));
      try {
        const list = await searchVideos(text);
        results.replaceChildren(...(list.length
          ? list.map((r) => h('button.yt-res', { onclick: () => pick(r.videoId, r.title, r.channel) }, h('img.yt-thumb.small', { src: r.thumb, alt: '' }), h('div', h('b', r.title), h('div.muted.small', r.channel))))
          : [h('p.muted', 'No se ha encontrado nada.')]));
      } catch (e) {
        results.replaceChildren(h('p.msg-warn', '⚠️ ' + ytErrorText(e)));
      }
    }
    q.addEventListener('keydown', (e) => e.key === 'Enter' && find());

    // 2. Los acordes
    const titleIn = h('input.editor-input', { type: 'text', placeholder: 'Título', value: state.title, maxLength: 80, oninput: () => (state.title = titleIn.value) });
    const artistIn = h('input.editor-input', { type: 'text', placeholder: 'Artista', value: state.artist, maxLength: 80, oninput: () => (state.artist = artistIn.value) });
    const sheetTa = h('textarea.editor-ta.sheet-ta.yt-sheet', {
      rows: 9, spellcheck: false, value: state.text,
      placeholder: 'Pega la canción de una web de acordes (acordes encima de la letra):\n\nTom: A\nA7M                 B7(9)\nOlha que coisa mais linda',
    });
    const per = h('select', [[2, '2 pulsos'], [4, '4 pulsos (un compás)'], [8, '8 pulsos']].map(([v, t]) => h('option', { value: v, selected: Number(state.per) === v }, t)));
    const keySel = h('select', h('option', { value: 'auto' }, 'Automática'), SOLFEGE.map((s, i) => h('option', { value: i }, `${s} mayor (${LETTERS[i]})`)));
    keySel.value = state.key;
    const sheetMsg = h('div.editor-messages');

    // 3. Sincronizar
    const playerHost = h('div.yt-player.setup');
    const tapBtn = h('button.btn.primary.yt-tap', { disabled: true }, '👆 ¡Cambia!');
    const tapInfo = h('div.muted');
    const syncMsg = h('div.editor-messages');
    const startBtn = h('button.btn.primary', { disabled: true, onclick: start }, '🤟 Guardar y tocar');
    let clock = null;
    let taps = [];
    let layout = null;
    let sheet = null;

    function loadPlayer() {
      clock?.destroy();
      playerHost.replaceChildren();
      taps = [];
      clock = createYtClock(playerHost, state.videoId, { offset: 0 });
      clock.ready.then(() => clock.setVolume(1)).catch((e) => {
        playerHost.replaceChildren(h('p.msg-warn', '⚠️ ' + ytErrorText(e)));
      });
      cleanup = () => clock?.destroy();
    }

    function refresh() {
      state.text = sheetTa.value;
      state.per = Number(per.value);
      state.key = keySel.value;
      sheet = state.text.trim() ? parseChordSheet(state.text) : null;
      if (sheet && state.key !== 'auto') sheet.key = Number(state.key);
      layout = sheet && !sheet.errors.length ? layoutChordSheet(sheet, { beatsPerChord: state.per }) : null;
      sheetMsg.replaceChildren(
        !sheet ? h('p.muted', 'Pega los acordes para seguir.')
          : sheet.errors.length ? h('p.msg-error', '❌ ' + sheet.errors[0])
            : h('p.msg-ok', `✅ ${keyName(sheet.key)} mayor · ${layout.chords.length} acordes`),
        layout ? h('div.yt-chips', layout.chords.slice(0, 12).map((c, i) => h('span.sheet-chord', { class: i < taps.length ? 'done' : i === taps.length ? 'next' : '' }, c.name)), layout.chords.length > 12 ? h('span.muted', ' …') : null) : null,
      );
      tapBtn.disabled = !(layout && state.videoId);
      const next = layout?.chords[taps.length];
      tapInfo.textContent = !state.videoId ? 'Elige primero el vídeo (paso 1).'
        : !layout ? 'Pega primero los acordes (paso 2).'
          : next ? `Siguiente: ${next.name} (${taps.length}/${Math.min(layout.chords.length, 8)})` : 'Listo';
      const fit = taps.length >= MIN_TAPS ? fitSync(taps) : null;
      if (fit) {
        state.bpm = fit.bpm;
        state.offset = fit.offset;
      }
      const ready = state.videoId && layout && state.bpm && state.offset != null;
      syncMsg.replaceChildren(
        fit ? h('p.msg-ok', `✅ Primer acorde en ${fmt(fit.offset)} · ${Math.round(fit.bpm)} pulsos por minuto`)
          : taps.length >= MIN_TAPS ? h('p.msg-warn', '⚠️ Los toques no cuadran: vuelve a empezar y pulsa justo en cada cambio.')
            : edit && state.bpm ? h('p.muted', `Sincronización guardada: ${Math.round(state.bpm)} pulsos por minuto. Puedes rehacerla.`)
              : h('p.muted', `Dale al ▶ del vídeo y pulsa «¡Cambia!» cada vez que empiece un acorde (al menos ${MIN_TAPS}, empezando por el primero).`),
      );
      startBtn.disabled = !ready;
    }
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    sheetTa.addEventListener('input', () => { taps = []; refresh(); });
    per.addEventListener('change', () => { taps = []; refresh(); });
    keySel.addEventListener('change', refresh);
    tapBtn.addEventListener('click', () => {
      if (!layout || !clock) return;
      const k = taps.length;
      if (k >= layout.chords.length) return;
      taps.push({ beat: layout.chords[k].start, time: clock.videoTime() });
      refresh();
    });

    function start() {
      const keyPc = sheet.key;
      saveYtSong({ id: state.id, videoId: state.videoId, title: state.title.trim() || 'Canción de YouTube', artist: state.artist.trim(), text: state.text, per: state.per, key: state.key, keyPc, bpm: state.bpm, offset: state.offset });
      navigate('karaoke-chords', { yt: state.id });
    }

    setBody(
      h('div.view-toolbar.wrap',
        h('button.btn.icon', { title: 'Volver', onclick: showList }, '←'),
        h('h2', edit ? '✏️ ' + edit.title : '▶ Preparar una canción de YouTube'),
        h('div.spacer'),
        startBtn,
      ),
      h('div.yt-steps',
        h('section.yt-step',
          h('h3', h('span.step-n', '1'), 'La canción'),
          h('div.row', q, h('button.btn', { onclick: find }, 'Buscar')),
          settings.youtubeApiKey ? null : h('p.muted.small', 'Sin clave de la API (Ajustes) no se puede buscar: pega el enlace del vídeo.'),
          picked, results,
          h('p.muted.small', '🔒 Sin cuenta ni cookies. Solo suena el reproductor oficial de YouTube.'),
        ),
        h('section.yt-step',
          h('h3', h('span.step-n', '2'), 'Los acordes'),
          h('div.field-row', titleIn, artistIn),
          sheetTa,
          h('div.field-row', h('label.field', h('span.field-label', 'Cada acorde dura'), per), h('label.field', h('span.field-label', 'Tonalidad'), keySel)),
          sheetMsg,
        ),
        h('section.yt-step',
          h('h3', h('span.step-n', '3'), 'Sincronizar'),
          playerHost,
          tapBtn,
          tapInfo,
          h('div.row', h('button.btn.small', { onclick: () => { taps.pop(); refresh(); } }, '↩️ Deshacer'), h('button.btn.small', { onclick: () => { taps = []; clock?.seek(0); refresh(); } }, '⏮ Empezar de nuevo')),
          syncMsg,
        ),
      ),
    );
    if (state.videoId) pick(state.videoId, state.title, state.artist);
    refresh();
  }

  if (params.edit) {
    const s = listYtSongs().find((x) => x.id === params.edit);
    if (s) showWizard(s);
    else showList();
  } else showList();
  if (import.meta.env.DEV) window.__yt = { showWizard, showList };

  return () => {
    cleanup?.();
    view.remove();
  };
}

// La tecla espacio también marca el cambio (más cómodo que el ratón al ritmo de la música).
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const btn = document.querySelector('.yt-tap:not([disabled])');
  if (!btn || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  e.preventDefault();
  btn.click();
});

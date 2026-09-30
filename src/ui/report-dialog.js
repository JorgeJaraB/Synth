// Ventana "Reportar un problema": el maestro describe el fallo y se abre una incidencia en GitHub.
import { h, toast } from './dom.js';
import { buildReport, issueUrl, REPO } from '../core/diagnostics.js';

/** @param {{ title?: string }} [opts]  resumen ya escrito (p. ej. al opinar sobre una parte concreta) */
export async function openReportDialog({ title: presetTitle = '' } = {}) {
  if (document.querySelector('.report-overlay')) return;
  const api = window.synthAPI;
  // Envío directo (sin cuenta) si la app instalada trae el permiso; si no, se abre GitHub.
  const direct = !!(api?.canSendReport && (await api.canSendReport()));
  const title = h('input.report-title', { type: 'text', placeholder: 'Ej.: El acorde Sol no suena con la mano abierta', maxLength: 120, value: presetTitle });
  const who = h('input.report-title', { type: 'text', placeholder: 'Ej.: Ana, CEIP San José (opcional)', maxLength: 80 });
  const desc = h('textarea.report-desc', { rows: 6, placeholder: '¿Qué estabas haciendo? ¿Qué esperabas que pasara y qué ha pasado? También puedes dejar ideas u opiniones.' });
  const tech = h('input', { type: 'checkbox', checked: true });
  const status = h('p.report-status');
  const close = () => ov.remove();
  const fullTitle = () => '[App] ' + (title.value.trim() || 'Problema u opinión');
  const report = () => (who.value.trim() ? `**Enviado por:** ${who.value.trim()}\n\n` : '') + buildReport(desc.value, { technical: tech.checked });
  const sendBtn = h('button.btn.primary', {
    onclick: async () => {
      if (!desc.value.trim() && !title.value.trim()) {
        status.textContent = '✏️ Escribe al menos un resumen o una descripción.';
        return;
      }
      if (!direct) {
        window.open(issueUrl(fullTitle(), report()), '_blank');
        toast(`Abriendo GitHub (${REPO})…`);
        close();
        return;
      }
      sendBtn.disabled = true;
      status.textContent = '📨 Enviando…';
      const r = await api.sendReport(fullTitle(), report());
      if (r.ok) {
        close();
        toast(`✅ ¡Gracias! Reporte enviado (nº ${r.number}).`, 4000);
      } else {
        sendBtn.disabled = false;
        status.textContent =
          r.reason === 'offline'
            ? '⚠️ No hay conexión a internet. Prueba más tarde o usa "Copiar informe".'
            : r.reason === 'too-fast'
              ? '⏳ Espera unos segundos antes de enviar otro.'
              : '⚠️ No se pudo enviar (' + r.reason + '). Usa "Copiar informe" y mándalo por correo.';
      }
    },
  }, direct ? '📨 Enviar' : 'Abrir en GitHub →');
  const ov = h(
    'div.report-overlay',
    { onclick: (e) => e.target === ov && close() },
    h('div.report-card',
      h('h2', '🐞 Reportar un problema u opinión'),
      h('p.muted', direct
        ? 'Tu mensaje llega directamente al desarrollador. No hace falta ninguna cuenta.'
        : 'Se abrirá la página de GitHub con el informe ya escrito; solo hay que pulsar "Submit new issue" (hace falta una cuenta gratuita de GitHub).'),
      h('label.field', h('span.field-label', 'Resumen'), title),
      h('label.field', h('span.field-label', 'Descripción'), desc),
      h('label.field', h('span.field-label', 'Tu nombre o colegio'), who),
      h('label.toggle', tech, h('span.toggle-track', h('span.toggle-thumb')), h('span', 'Incluir datos técnicos (versión, pantalla, errores)')),
      h('p.muted.privacy-note', '🔒 Solo se envía el texto de esta ventana. Nunca se envían imágenes de la cámara, vídeos, grabaciones ni nombres de archivos. No escribas nombres de alumnos.'),
      status,
      h('div.row.report-actions',
        h('button.btn', { onclick: close }, 'Cancelar'),
        h('button.btn', {
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(`# ${fullTitle()}\n\n${report()}`);
              toast('📋 Informe copiado: pégalo en un correo o mensaje');
            } catch {
              toast('⚠️ No se pudo copiar');
            }
          },
        }, '📋 Copiar informe'),
        sendBtn,
      ),
    ),
  );
  document.body.append(ov);
  (presetTitle ? desc : title).focus();
}

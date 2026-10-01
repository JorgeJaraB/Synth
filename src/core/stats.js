// Datos de rendimiento de la cámara y del detector de manos, para los reportes de problemas.
// (Módulo aparte para no cargar MediaPipe solo por leerlos.)
export const cameraStats = {
  resolution: '', // lo que da la cámara de verdad, p. ej. "640×480"
  cameraFps: 0, // imágenes por segundo que dice dar la cámara
  detectFps: 0, // imágenes por segundo que se analizan de verdad
  detectMs: 0, // lo que tarda el detector en cada imagen
  delegate: '', // 'GPU' (tarjeta gráfica) o 'CPU' (procesador, más lento)
};

export function cameraStatsText() {
  const s = cameraStats;
  if (!s.resolution) return 'sin usar todavía';
  return `${s.resolution} a ${Math.round(s.cameraFps) || '?'} img/s · se analizan ${Math.round(s.detectFps)} img/s (${Math.round(s.detectMs)} ms por imagen, ${s.delegate === 'CPU' ? 'con el procesador' : 'con la tarjeta gráfica'})`;
}

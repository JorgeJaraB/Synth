// Pulgar fuera o dentro con los puntos 3D de MediaPipe (módulo aparte, sin cámara, para los tests).

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/**
 * Pulgar fuera con los puntos 3D (en metros, no dependen de cómo se gire la mano ante la
 * cámara). En la imagen plana, un pulgar relajado junto al índice o metido hacia la cámara
 * "salía" por el lado y daba muchos falsos positivos. Aquí tiene que cumplir las dos cosas:
 *   - la punta lejos del nudillo del índice (en anchos de palma): recogido ≈ 0,3–0,5,
 *     pegado al índice ≈ 0,5–0,7, fuera de verdad ≈ 0,85 o más;
 *   - el pulgar estirado (sus dos últimos tramos casi en línea).
 * Con histéresis (prev) para que no parpadee.
 */
export const THUMB_3D = { far: 0.82, farKeep: 0.7, straight: 0.8, straightKeep: 0.6 };
export function thumbMetrics(w) {
  const palm = dist3(w[5], w[17]) || 0.07;
  const far = dist3(w[4], w[5]) / palm;
  const v1 = { x: w[3].x - w[2].x, y: w[3].y - w[2].y, z: (w[3].z || 0) - (w[2].z || 0) };
  const v2 = { x: w[4].x - w[3].x, y: w[4].y - w[3].y, z: (w[4].z || 0) - (w[3].z || 0) };
  const n = Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z) || 1;
  const straight = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / n; // 1 = en línea
  return { far, straight };
}
export function thumbOut3D(w, prev = false, t = THUMB_3D) {
  const { far, straight } = thumbMetrics(w);
  return prev ? far > t.farKeep && straight > t.straightKeep : far > t.far && straight > t.straight;
}

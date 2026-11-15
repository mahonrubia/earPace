/** Formateo en español para voz y pantalla. */

const num = (v: number, decimals = 1) => {
  const r = Number(v.toFixed(decimals));
  return String(r).replace('.', ',');
};

/** "5:12" para pantalla. */
export function paceShort(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "5 12" → el sintetizador lo lee "cinco doce", como lo diría un corredor. */
export function paceSpeech(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)} ${String(s % 60).padStart(2, '0')}`;
}

export function durSpeech(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 120 && s % 60 !== 0) return `${s} segundos`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  const parts: string[] = [];
  if (h) parts.push(h === 1 ? '1 hora' : `${h} horas`);
  if (m) parts.push(m === 1 ? '1 minuto' : `${m} minutos`);
  return parts.join(' ') || '0 minutos';
}

export function durShort(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function distSpeech(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} metros`;
  const km = meters / 1000;
  return km === 1 ? '1 kilómetro' : `${num(km, km >= 10 ? 0 : 1)} kilómetros`;
}

export function distShort(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${num(meters / 1000, 1)} km`;
}

export const pct = (fraction: number) => num(Math.abs(fraction) * 100, 0);
export const kmh = (mps: number) => Math.round(mps * 3.6);

export function compass(deg: number): string {
  const names = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * Protocolo móvil ↔ reloj (Connect IQ). Mensajes pequeños: el enlace Bluetooth es lento.
 * Debe coincidir con apps/watch/source/PhoneLink.mc.
 */
import type { CoachStatus } from './session';
import type { FlatStep } from './plan';
import type { Cue, Haptic, HrZone, LiveSample } from './types';

const HAPTIC: Record<Haptic, number> = { none: 0, short: 1, double: 2, long: 3, alert: 4 };
const KIND = { warmup: 0, work: 1, recovery: 2, cooldown: 3, steady: 4 } as const;

/** Las fuentes del reloj no tienen emoji ni símbolos: solo Latin-1. */
const plain = (s: string) => s.replace(/[^\n\x20-\x7e¡-ÿ]/g, '').replace(/ +\n/g, '\n').trim();

export const watchCue = (c: Cue) => ({ k: 'cue', s: plain(c.short), h: HAPTIC[c.haptic], p: c.priority });

export function watchStatus(st: CoachStatus) {
  const m: Record<string, unknown> = { k: 'st' };
  if (st.targetPace) {
    m.pmin = Math.round(st.targetPace.min);
    m.pmax = Math.round(st.targetPace.max);
  } else if (st.targetZone && st.targetHr) {
    m.z = st.targetZone;
    m.lo = st.targetHr.min;
    m.hi = st.targetHr.max;
  }
  return m;
}

/** Entrenamiento resumido para el entrenador local del reloj (por si se pierde el móvil). */
export function watchConfig(title: string, steps: FlatStep[]) {
  return {
    k: 'cfg',
    title: plain(title).slice(0, 24),
    steps: steps.slice(0, 60).map((s) => [
      KIND[s.kind],
      s.duration.type === 'time' ? 0 : s.duration.type === 'distance' ? 1 : 2,
      s.duration.type === 'time' ? s.duration.seconds : s.duration.type === 'distance' ? s.duration.meters : 0,
      s.target?.hrZone ?? 0,
    ]),
  };
}

export interface WatchProfile {
  zones?: HrZone[];
  weightKg?: number;
  hrRest?: number;
  hrMax?: number;
}

/** Perfil que el usuario tiene configurado en su Garmin (zonas de carrera, peso, FC reposo). */
export function profileFromWatch(msg: Record<string, any>): WatchProfile {
  const out: WatchProfile = {};
  const z = msg.zones;
  // Garmin: [mínZ1, máxZ1, máxZ2, máxZ3, máxZ4, máxZ5]
  if (Array.isArray(z) && z.length >= 6 && z.every((v) => typeof v === 'number')) {
    out.zones = [1, 2, 3, 4, 5].map((i) => ({ min: i === 1 ? z[0] : z[i - 1] + 1, max: z[i] }));
    out.hrMax = z[5];
  }
  if (typeof msg.w === 'number' && msg.w > 0) out.weightKg = Math.round(msg.w / 100) / 10;
  if (typeof msg.rhr === 'number' && msg.rhr > 0) out.hrRest = msg.rhr;
  return out;
}

export function sampleFromWatch(msg: Record<string, any>): LiveSample {
  let cad: number | undefined = typeof msg.cad === 'number' ? msg.cad : undefined;
  // Algunos relojes informan zancadas (un pie): se pasa a pasos por minuto.
  if (cad !== undefined && cad > 0 && cad < 120) cad *= 2;
  return {
    t: msg.t ?? 0,
    distanceM: msg.d ?? 0,
    hr: msg.hr ?? undefined,
    cadence: cad,
    speedMps: typeof msg.spd === 'number' ? msg.spd / 100 : undefined,
    altitudeM: msg.alt ?? undefined,
    headingDeg: msg.hdg ?? undefined,
  };
}

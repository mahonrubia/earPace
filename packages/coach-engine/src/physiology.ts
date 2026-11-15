import type {
  AthleteProfile,
  HrZone,
  Injury,
  InjuryRestrictions,
  PastActivity,
  RecoveryInfo,
  Shoe,
  Terrain,
  Weather,
  WorkoutType,
} from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zonas por reserva de FC (Karvonen) o % de FC máx si no hay FC de reposo. */
export function computeHrZones(hrMax: number, hrRest?: number): HrZone[] {
  const bounds = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const at = (f: number) =>
    Math.round(hrRest !== undefined ? hrRest + f * (hrMax - hrRest) : f * hrMax);
  return [0, 1, 2, 3, 4].map((i) => ({
    min: at(bounds[i]) + (i === 0 ? 0 : 1),
    max: at(bounds[i + 1]),
  }));
}

export function zonesOf(profile: AthleteProfile): HrZone[] {
  return profile.hrZones && profile.hrZones.length === 5
    ? profile.hrZones
    : computeHrZones(profile.hrMax, profile.hrRest);
}

/** Zona 0..5 (0 = por debajo de Z1). Por encima de Z5 devuelve 5. */
export function zoneOfHr(hr: number, zones: HrZone[]): number {
  if (hr < zones[0].min) return 0;
  for (let i = 0; i < zones.length; i++) if (hr <= zones[i].max) return i + 1;
  return 5;
}

/** Punto de rocío (fórmula de Magnus). */
export function dewPointC(tempC: number, humidityPct: number): number {
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(clamp(humidityPct, 1, 100) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

/**
 * Penalización de ritmo por calor y humedad (suma temperatura + punto de rocío en °F).
 * Devuelve fracción: 0.03 = ritmo un 3 % más lento. `extreme` = desaconsejado correr fuerte.
 */
export function heatAdjustment(w: Pick<Weather, 'tempC' | 'humidityPct'>): { pct: number; extreme: boolean } {
  const f = (c: number) => (c * 9) / 5 + 32;
  const sum = f(w.tempC) + f(dewPointC(w.tempC, w.humidityPct));
  const table: Array<[number, number]> = [
    [100, 0],
    [110, 0.005],
    [120, 0.01],
    [130, 0.02],
    [140, 0.03],
    [150, 0.045],
    [160, 0.06],
    [170, 0.08],
    [180, 0.1],
  ];
  if (sum <= 100) return { pct: 0, extreme: false };
  if (sum > 180) return { pct: 0.12, extreme: true };
  for (let i = 1; i < table.length; i++) {
    if (sum <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return { pct: y0 + ((sum - x0) / (x1 - x0)) * (y1 - y0), extreme: false };
    }
  }
  return { pct: 0.1, extreme: false };
}

/**
 * Factor de coste por pendiente (Minetti 2002). grade = fracción (0.05 = 5 %).
 * >1 más lento a igual esfuerzo. El beneficio de bajada se amortigua al 50 %,
 * porque en la práctica frenar y la técnica limitan lo que se gana.
 */
export function gradeFactor(grade: number): number {
  const i = clamp(grade, -0.3, 0.3);
  const c = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  const f = c / 3.6;
  return f >= 1 ? f : 1 - (1 - f) * 0.5;
}

export const TERRAIN_FACTOR: Record<Terrain, number> = {
  road: 1,
  track: 1,
  treadmill: 1,
  gravel: 1.03,
  grass: 1.05,
  trail: 1.08,
  technical_trail: 1.18,
  snow: 1.2,
  sand: 1.25,
};

/** Componente de viento de cara (m/s, + de cara, − a favor) dado el rumbo del corredor. */
export function headwindMps(weather: Pick<Weather, 'windSpeedMps' | 'windFromDeg'>, headingDeg: number): number {
  const diff = ((weather.windFromDeg - headingDeg) * Math.PI) / 180;
  return weather.windSpeedMps * Math.cos(diff);
}

/**
 * Penalización de ritmo por viento (heurística sobre resistencia aerodinámica ∝ v²).
 * El viento a favor devuelve solo la mitad de lo que quita el de cara.
 */
export function windAdjustment(headwind: number, speedMps: number): number {
  const k = 0.0016;
  const v = Math.max(speedMps, 2);
  // El viento de la previsión se mide a 10 m; a la altura del corredor llega aproximadamente la mitad.
  const rel = v + headwind * 0.5;
  const delta = k * (rel * Math.abs(rel) - v * v);
  return clamp(delta >= 0 ? delta : delta * 0.5, -0.04, 0.15);
}

export function shoeMaxKm(shoe: Shoe, weightKg?: number): number {
  const base =
    shoe.maxKm ??
    { daily: 750, tempo: 600, racing: 350, trail: 700, recovery: 750 }[shoe.type];
  // Un corredor pesado comprime antes la mediasuela.
  return weightKg !== undefined && weightKg > 85 ? Math.round(base * 0.9) : base;
}

export function defaultRestrictions(injury: Injury): InjuryRestrictions {
  if (injury.status === 'recovered') return {};
  const active = injury.status === 'active';
  const r: InjuryRestrictions = {
    maxZone: active ? (injury.severity >= 2 ? 2 : 3) : 3 + (injury.severity === 1 ? 1 : 0),
    avoidSpeedWork: active || injury.severity >= 2,
  };
  if (active) r.maxDurationMin = injury.severity === 3 ? 20 : injury.severity === 2 ? 40 : 60;
  if (['knee', 'quad', 'itband', 'shin'].includes(injury.area)) r.avoidDownhill = true;
  if (['shin', 'plantar', 'foot', 'knee'].includes(injury.area)) r.avoidHardSurface = active;
  return r;
}

export function restrictionsOf(injury: Injury): InjuryRestrictions {
  return { ...defaultRestrictions(injury), ...(injury.restrictions ?? {}) };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Carga de una sesión: TRIMP de Banister con FC, o duración × RPE como alternativa. */
export function sessionLoad(a: PastActivity, profile: AthleteProfile): number {
  if (a.avgHr !== undefined) {
    const rest = profile.hrRest ?? 55;
    const hrr = clamp((a.avgHr - rest) / (profile.hrMax - rest), 0, 1);
    return a.durationMin * hrr * 0.64 * Math.exp(1.92 * hrr);
  }
  const rpe = a.rpe ?? ({ easy: 3, recovery: 2, long: 4, tempo: 6, intervals: 7, hills: 7, race: 9, rest: 0 } as Record<WorkoutType, number>)[a.type ?? 'easy'];
  return (a.durationMin * rpe) / 5;
}

export type ReadinessLevel = 'fresh' | 'normal' | 'fatigued' | 'overreached';

export interface Readiness {
  level: ReadinessLevel;
  /** Ratio carga aguda (7 d) / crónica (media semanal de 28 d). */
  acwr?: number;
  daysSinceRest: number;
  hardYesterday: boolean;
  poorSleep: boolean;
  lowHrv: boolean;
}

export function computeReadiness(
  history: PastActivity[] | undefined,
  profile: AthleteProfile,
  today: string,
  recovery?: RecoveryInfo,
): Readiness {
  const h = (history ?? []).filter((a) => a.durationMin > 0);
  const age = (a: PastActivity) => daysBetween(a.date, today);
  const acute = h.filter((a) => age(a) >= 1 && age(a) <= 7).reduce((s, a) => s + sessionLoad(a, profile), 0);
  const chronic = h.filter((a) => age(a) >= 1 && age(a) <= 28).reduce((s, a) => s + sessionLoad(a, profile), 0) / 4;
  const acwr = chronic > 0 ? acute / chronic : undefined;

  let daysSinceRest = 0;
  for (let d = 1; d <= 14; d++) {
    if (!h.some((a) => age(a) === d)) break;
    daysSinceRest = d;
  }
  const hardTypes: WorkoutType[] = ['tempo', 'intervals', 'hills', 'race', 'long'];
  const hardYesterday = h.some((a) => age(a) === 1 && ((a.rpe ?? 0) >= 7 || hardTypes.includes(a.type ?? 'easy')));
  const poorSleep = recovery?.lastSleepHours !== undefined && recovery.lastSleepHours < 6;
  const lowHrv = recovery?.hrvRatio !== undefined && recovery.hrvRatio < 0.85;

  let score = 0;
  if (acwr !== undefined) score += acwr > 1.5 ? 2 : acwr > 1.3 ? 1 : acwr < 0.8 ? -1 : 0;
  if (daysSinceRest >= 6) score += 1;
  if (hardYesterday) score += 1;
  if (poorSleep) score += 1;
  if (lowHrv) score += 1;
  const level: ReadinessLevel = score >= 3 ? 'overreached' : score >= 2 ? 'fatigued' : score < 0 ? 'fresh' : 'normal';
  return { level, acwr, daysSinceRest, hardYesterday, poorSleep, lowHrv };
}

/** Gasto estimado: ~1 kcal por kg y km. */
export const kcalFor = (weightKg: number, distanceM: number) => Math.round((weightKg * distanceM) / 1000);

/** Sudoración estimada (l/h) según peso y calor. */
export function sweatRateLph(weightKg: number, weather?: Weather): number {
  const base = 0.6 + (weightKg - 70) * 0.008;
  const heat = weather ? clamp((weather.tempC - 12) * 0.035, 0, 0.9) : 0.2;
  return clamp(base + heat, 0.3, 2);
}

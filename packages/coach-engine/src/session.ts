import { buildBriefing } from './briefing';
import { distShort, distSpeech, durShort, durSpeech, kmh, paceShort, paceSpeech, pct } from './format';
import {
  clamp,
  computeReadiness,
  gradeFactor,
  headwindMps,
  heatAdjustment,
  kcalFor,
  restrictionsOf,
  sweatRateLph,
  TERRAIN_FACTOR,
  windAdjustment,
  zoneOfHr,
  zonesOf,
  type Readiness,
} from './physiology';
import { flattenWorkout, isHardWorkout, plannedDurationS, type FlatStep } from './plan';
import { findSegments, gradeAt, resample, type Segment } from './route';
import type {
  CoachContext,
  Cue,
  CueCategory,
  Haptic,
  HrZone,
  Injury,
  LiveSample,
  RoutePoint,
  RunSummary,
  Verbosity,
} from './types';

interface Candidate extends Omit<Cue, 'atS'> {
  /** Segundos mínimos antes de repetir la misma clave. */
  cooldownS?: number;
  /** Evento puntual: se encola y se emite una sola vez. */
  oneShot?: boolean;
  /** Vida en cola de un evento puntual. */
  ttlS?: number;
}

export interface CoachStatus {
  stepIndex: number;
  stepCount: number;
  stepKind?: string;
  /** Segundos o metros que quedan del paso actual. */
  stepRemaining?: { type: 'time' | 'distance'; value: number };
  targetZone?: number;
  targetHr?: HrZone;
  /** Ritmo objetivo ya ajustado a calor, terreno, pendiente y viento (s/km). */
  targetPace?: { min: number; max: number };
  hr?: number;
  zone?: number;
  paceSecPerKm?: number;
  cadence?: number;
  grade?: number;
}

const GAP_BY_VERBOSITY: Record<Verbosity, number> = { minimal: 45, normal: 25, detailed: 15 };
const MAX_PRIORITY: Record<Verbosity, number> = { minimal: 2, normal: 3, detailed: 4 };

/**
 * Entrenador en vivo. Se alimenta con muestras (~1 por segundo o cada pocos segundos)
 * y devuelve las indicaciones que hay que decir/mostrar en ese instante.
 */
export class CoachSession {
  readonly zones: HrZone[];
  readonly steps: FlatStep[];
  readonly readiness: Readiness;
  readonly heatPct: number;

  private readonly ctx: CoachContext;
  private readonly today: string;
  private readonly verbosity: Verbosity;
  private readonly terrainFactor: number;
  private readonly plannedS: number;
  private readonly routePts: RoutePoint[] | undefined;
  private readonly segments: Segment[];
  private readonly raceCourseNorm: number;
  private readonly openInjuries: Injury[];
  private maxZoneCap: number | undefined;
  private readonly maxDurationS: number | undefined;
  private readonly avoidDownhill: boolean;
  private readonly isRace: boolean;
  private readonly raceDistM: number;
  private readonly racePace: number | undefined;

  private win: LiveSample[] = [];
  private last: LiveSample | undefined;
  private stepIdx = 0;
  private stepStartT = 0;
  private stepStartDist = 0;
  private workoutDone = false;
  private pending: Array<{ c: Candidate; expires: number }> = [];
  private emitted = new Map<string, number>();
  private lastSpokenT = -999;
  private lastP1T = -999;

  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private fastSince: number | null = null;
  private slowSince: number | null = null;
  private inTargetSince: number | null = null;
  private lowCadSince: number | null = null;
  private headwindSince: number | null = null;
  private hadHeadwind = false;
  private headwindTold = false;
  private repeats = new Map<string, { n: number; seen: number }>();
  private hrMaxSince: number | null = null;

  private zoneTime = [0, 0, 0, 0, 0];
  private targetTime = 0;
  private compliantTime = 0;
  private hrSum = 0;
  private hrN = 0;
  private cadSum = 0;
  private cadN = 0;
  private ascent = 0;
  private lastAlt: number | undefined;
  private kmMark = { k: 0, t: 0, hrSum: 0, hrN: 0 };
  private earlyCad = { sum: 0, n: 0 };
  private earlyEff = { sum: 0, n: 0 };
  private recentEff: Array<{ t: number; v: number }> = [];

  constructor(ctx: CoachContext) {
    this.ctx = ctx;
    this.today = ctx.today ?? new Date().toISOString().slice(0, 10);
    this.verbosity = ctx.verbosity ?? 'normal';
    this.zones = zonesOf(ctx.profile);
    this.steps = ctx.workout ? flattenWorkout(ctx.workout) : [];
    this.readiness = computeReadiness(ctx.history, ctx.profile, this.today, ctx.recovery);
    this.heatPct = ctx.weather ? heatAdjustment(ctx.weather).pct : 0;
    this.terrainFactor = TERRAIN_FACTOR[ctx.terrain ?? 'road'];
    this.plannedS = ctx.workout ? plannedDurationS(ctx.workout, ctx.profile.thresholdPaceSecPerKm ? ctx.profile.thresholdPaceSecPerKm * 1.2 : 360) : 0;
    this.routePts = ctx.route && ctx.route.points.length > 1 ? resample(ctx.route.points, 25) : undefined;
    this.segments = ctx.route && ctx.route.points.length > 1 ? findSegments(ctx.route) : [];

    this.openInjuries = (ctx.injuries ?? []).filter((i) => i.status !== 'recovered').sort((a, b) => b.severity - a.severity);
    const rs = this.openInjuries.map(restrictionsOf);
    const minOf = (xs: Array<number | undefined>) => {
      const v = xs.filter((x): x is number => x !== undefined);
      return v.length ? Math.min(...v) : undefined;
    };
    this.maxZoneCap = minOf(rs.map((r) => r.maxZone));
    const maxMin = minOf(rs.map((r) => r.maxDurationMin));
    this.maxDurationS = maxMin !== undefined ? maxMin * 60 : undefined;
    this.avoidDownhill = rs.some((r) => r.avoidDownhill);

    const race = ctx.workout?.race;
    this.isRace = !!race;
    this.raceDistM = race?.distanceM ?? 0;
    this.racePace = race?.targetTimeS ? race.targetTimeS / (race.distanceM / 1000) : undefined;
    // Normaliza el reparto por pendiente para que el tiempo total cuadre con el objetivo.
    this.raceCourseNorm = this.routePts
      ? this.routePts.reduce((s, p) => s + gradeFactor(gradeAt(this.routePts!, p.distM) ?? 0), 0) / this.routePts.length
      : 1;
  }

  /** Charla previa a la salida, ya filtrada por nivel de detalle. */
  briefing(): Cue[] {
    return buildBriefing(this.ctx, this.today)
      .filter((c) => c.priority <= MAX_PRIORITY[this.verbosity])
      .map((c) => ({ ...c, atS: 0 }));
  }

  /** El corredor pulsa vuelta: avanza al siguiente paso (necesario en pasos abiertos). */
  lap(): Cue[] {
    if (!this.last || this.workoutDone || !this.steps.length) return [];
    this.advanceStep(this.last);
    return this.schedule(this.last.t, []);
  }

  /** El corredor informa de dolor (0..10) desde el reloj o el móvil. */
  reportPain(level: number): Cue[] {
    const t = this.last?.t ?? 0;
    const label = this.openInjuries[0]?.label ?? 'molestia';
    let c: Candidate;
    if (level >= 6)
      c = this.mk('pain.stop', 'injury', 1, `Dolor ${level} sobre 10: paramos aquí. Vuelve caminando, aplica hielo y anota cómo evoluciona. No merece la pena arriesgar.`, `DOLOR ${level}/10\nPARA`, 'alert');
    else if (level >= 4) {
      this.maxZoneCap = Math.min(this.maxZoneCap ?? 5, 1);
      c = this.mk('pain.reduce', 'injury', 1, `Dolor ${level} sobre 10 en tu ${label}: baja a trote muy suave o camina dos minutos. Si no mejora, terminamos por hoy.`, `DOLOR ${level}/10\nBaja a Z1`, 'long');
    } else c = this.mk('pain.ok', 'injury', 2, `Anotado, dolor ${level} sobre 10. Podemos seguir; te vuelvo a preguntar en un rato.`, `DOLOR ${level}/10\nSeguimos`, 'short');
    // La respuesta a un aviso de dolor nunca espera turno.
    this.lastSpokenT = this.lastP1T = -999;
    this.pending = this.pending.filter((p) => !p.c.key.startsWith('pain.'));
    return this.schedule(t, [{ ...c, priority: 1, oneShot: true, key: `${c.key}.${Math.round(t)}.${level}` }]);
  }

  status(): CoachStatus {
    const s = this.last;
    const step = this.currentStep();
    const st: CoachStatus = { stepIndex: this.stepIdx, stepCount: this.steps.length, stepKind: step?.kind };
    if (!s) return st;
    const rem = this.stepRemaining(s);
    if (rem) st.stepRemaining = rem;
    const z = this.targetZone(s);
    if (z) {
      st.targetZone = z;
      st.targetHr = this.zones[z - 1];
    }
    const grade = this.grade(s);
    st.targetPace = this.targetPace(s, grade);
    st.hr = this.avg('hr', 30);
    if (st.hr !== undefined) st.zone = zoneOfHr(st.hr, this.zones);
    const sp = this.avg('speedMps', 30);
    if (sp && sp > 0.5) st.paceSecPerKm = 1000 / sp;
    st.cadence = this.avg('cadence', 30);
    st.grade = grade;
    return st;
  }

  update(sample: LiveSample): Cue[] {
    const s: LiveSample = { ...sample };
    if (s.hr !== undefined && (s.hr < 30 || s.hr > 230)) s.hr = undefined; // lectura anómala del sensor
    const prev = this.last;
    const dt = prev ? clamp(s.t - prev.t, 0, 30) : 0;
    this.last = s;
    this.win.push(s);
    while (this.win.length && s.t - this.win[0].t > 120) this.win.shift();
    if (!prev) {
      this.stepStartT = s.t;
      this.stepStartDist = s.distanceM;
    }

    const c: Candidate[] = [];
    const t = s.t;
    const hr = this.avg('hr', 30);
    const speed = this.avg('speedMps', 30);
    const cadence = this.avg('cadence', 30);
    const grade = this.grade(s);
    const zone = hr !== undefined ? zoneOfHr(hr, this.zones) : undefined;
    const pace = speed && speed > 0.8 ? 1000 / speed : undefined;

    // Acumulados.
    if (hr !== undefined && dt > 0) {
      if (zone && zone >= 1) this.zoneTime[zone - 1] += dt;
      this.hrSum += hr * dt;
      this.hrN += dt;
      this.kmMark.hrSum += hr * dt;
      this.kmMark.hrN += dt;
    }
    if (cadence !== undefined && cadence > 120 && dt > 0) {
      this.cadSum += cadence * dt;
      this.cadN += dt;
      if (t >= 300 && t <= 900) {
        this.earlyCad.sum += cadence * dt;
        this.earlyCad.n += dt;
      }
    }
    if (s.altitudeM !== undefined) {
      if (this.lastAlt === undefined) this.lastAlt = s.altitudeM;
      // Histéresis de 2 m para no sumar ruido del barómetro.
      else if (s.altitudeM - this.lastAlt >= 2) {
        this.ascent += s.altitudeM - this.lastAlt;
        this.lastAlt = s.altitudeM;
      } else if (this.lastAlt - s.altitudeM >= 2) this.lastAlt = s.altitudeM;
    }

    this.ruleSteps(s, c);
    const tz = this.targetZone(s);
    const tp = this.targetPace(s, grade);
    const atMax = this.ruleSafety(s, hr, c);
    const hrHigh = this.ruleHr(s, hr, zone, tz, grade, atMax, c);
    this.rulePace(s, pace, tp, grade, hrHigh, c);
    this.ruleCompliance(t, dt, hr, pace, tz, tp, grade, c);
    this.ruleCadence(s, cadence, speed, grade, c);
    this.ruleElevation(s, grade, c);
    this.ruleWeather(s, speed, c);
    this.ruleFuel(t, c);
    this.ruleInjury(t, c);
    this.ruleDrift(s, hr, speed, grade, c);
    this.ruleSplits(s, c);
    if (this.isRace) this.ruleRace(s, pace, c);

    return this.schedule(t, c);
  }

  finish(): RunSummary {
    const s = this.last ?? { t: 0, distanceM: 0 };
    const w = this.ctx.profile.weightKg;
    const avgPace = s.distanceM > 100 ? s.t / (s.distanceM / 1000) : undefined;
    const avgHr = this.hrN ? Math.round(this.hrSum / this.hrN) : undefined;
    const compliancePct = this.targetTime > 60 ? Math.round((this.compliantTime / this.targetTime) * 100) : undefined;
    const fluidMl = Math.round((sweatRateLph(w, this.ctx.weather) * (s.t / 3600) * 1000) / 50) * 50;
    const kcal = kcalFor(w, s.distanceM);

    let text = `Sesión terminada: ${distSpeech(s.distanceM)} en ${durSpeech(s.t)}`;
    if (avgPace) text += `, a ${paceSpeech(avgPace)} de media`;
    if (avgHr) text += `, pulso medio ${avgHr}`;
    text += '.';
    if (compliancePct !== undefined)
      text +=
        compliancePct >= 80
          ? ` Has cumplido el objetivo el ${compliancePct} por ciento del tiempo. Gran trabajo.`
          : compliancePct >= 55
            ? ` Has estado en objetivo el ${compliancePct} por ciento del tiempo. Bien, con margen para afinar.`
            : ` Solo el ${compliancePct} por ciento del tiempo en objetivo. La próxima vez, más control al principio.`;
    text += ` Repón unos ${fluidMl} mililitros de líquido`;
    text += s.t >= 3600 ? ' y toma hidratos y proteína en la próxima media hora.' : '.';
    if (this.readiness.level === 'overreached' || this.readiness.level === 'fatigued')
      text += ' Mañana, descanso o algo muy suave.';
    if (this.openInjuries.length) text += ` Anota cómo ha respondido tu ${this.openInjuries[0].label}.`;
    if (this.ctx.shoe) text += ` Tus ${this.ctx.shoe.name} suman ya ${Math.round(this.ctx.shoe.km + s.distanceM / 1000)} kilómetros.`;

    return {
      durationS: s.t,
      distanceM: s.distanceM,
      avgPaceSecPerKm: avgPace,
      avgHr,
      avgCadence: this.cadN ? Math.round(this.cadSum / this.cadN) : undefined,
      ascentM: Math.round(this.ascent),
      timeInZonesS: this.zoneTime.map(Math.round),
      compliancePct,
      kcal,
      fluidMl,
      cue: { key: 'summary', category: 'summary', priority: 2, text, short: `${distShort(s.distanceM)} · ${durShort(s.t)}`, haptic: 'long', atS: s.t },
    };
  }

  // ───────────────────────── utilidades ─────────────────────────

  private mk(key: string, category: CueCategory, priority: Cue['priority'], text: string, short: string, haptic: Haptic = 'short'): Candidate {
    return { key, category, priority, text, short, haptic };
  }

  private avg(field: 'hr' | 'speedMps' | 'cadence', seconds: number): number | undefined {
    const now = this.last?.t ?? 0;
    let sum = 0;
    let n = 0;
    for (let i = this.win.length - 1; i >= 0; i--) {
      const s = this.win[i];
      if (now - s.t > seconds) break;
      const v = s[field];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : undefined;
  }

  /** Pendiente actual: del perfil de ruta si lo hay; si no, del altímetro en los últimos ~80 m. */
  private grade(s: LiveSample): number | undefined {
    if (this.routePts) return gradeAt(this.routePts, s.distanceM);
    if (s.altitudeM === undefined) return undefined;
    for (let i = this.win.length - 1; i >= 0; i--) {
      const p = this.win[i];
      const d = s.distanceM - p.distanceM;
      if (d >= 80 && p.altitudeM !== undefined) return clamp((s.altitudeM - p.altitudeM) / d, -0.4, 0.4);
    }
    return undefined;
  }

  private currentStep(): FlatStep | undefined {
    return this.workoutDone ? undefined : this.steps[this.stepIdx];
  }

  private stepRemaining(s: LiveSample): { type: 'time' | 'distance'; value: number } | undefined {
    const st = this.currentStep();
    if (!st) return undefined;
    if (st.duration.type === 'time') return { type: 'time', value: st.duration.seconds - (s.t - this.stepStartT) };
    if (st.duration.type === 'distance') return { type: 'distance', value: st.duration.meters - (s.distanceM - this.stepStartDist) };
    return undefined;
  }

  private targetZone(s: LiveSample): number | undefined {
    let z = this.currentStep()?.target?.hrZone;
    if (z === undefined && this.isRace && !this.racePace) {
      // Sin tiempo objetivo: competición guiada por pulso según distancia.
      const base = this.raceDistM <= 5500 ? 5 : this.raceDistM <= 12000 ? 4 : this.raceDistM <= 22000 ? 4 : 3;
      z = s.distanceM < this.raceDistM * 0.5 ? Math.max(base - 1, 3) : base;
    }
    if (this.maxZoneCap !== undefined) {
      if (z === undefined) return this.maxZoneCap; // carrera libre con lesión: techo de zona
      z = Math.min(z, this.maxZoneCap);
    }
    return z;
  }

  /** Ritmo objetivo ajustado a las condiciones reales del momento. */
  private targetPace(s: LiveSample, grade: number | undefined): { min: number; max: number } | undefined {
    let base = this.currentStep()?.target?.paceSecPerKm;
    let gf = gradeFactor(grade ?? 0);
    if (!base && this.racePace) {
      const frac = s.distanceM / this.raceDistM;
      const phase = frac < 0.1 ? 1.02 : 1;
      base = { min: this.racePace * phase * 0.985, max: this.racePace * phase * 1.015 };
      gf /= this.raceCourseNorm;
    }
    if (!base) return undefined;
    // Con restricción de zona por lesión manda el pulso, no el ritmo.
    const stepZ = this.currentStep()?.target?.hrZone;
    if (this.maxZoneCap !== undefined && (stepZ === undefined || stepZ > this.maxZoneCap) && !this.isRace) return undefined;
    let f = (1 + this.heatPct) * this.terrainFactor * gf;
    const w = this.ctx.weather;
    if (w && s.headingDeg !== undefined && s.speedMps) f *= 1 + windAdjustment(headwindMps(w, s.headingDeg), s.speedMps);
    return { min: base.min * f, max: base.max * f };
  }

  private advanceStep(s: LiveSample) {
    this.stepIdx++;
    this.stepStartT = s.t;
    this.stepStartDist = s.distanceM;
    this.aboveSince = this.belowSince = this.fastSince = this.slowSince = this.inTargetSince = null;
    if (this.stepIdx >= this.steps.length) {
      this.workoutDone = true;
      this.pending.push({
        c: { ...this.mk('step.done', 'step', 2, 'Entrenamiento completado. Buen trabajo. Puedes seguir trotando suave o parar cuando quieras.', 'COMPLETADO', 'long'), oneShot: true },
        expires: s.t + 30,
      });
      return;
    }
    this.pending.push({ c: { ...this.stepCue(this.steps[this.stepIdx]), oneShot: true }, expires: s.t + 20 });
  }

  private stepCue(st: FlatStep): Candidate {
    const names: Record<string, string> = { warmup: 'Calentamiento', work: 'Serie', recovery: 'Recuperación', cooldown: 'Vuelta a la calma', steady: 'Ritmo continuo' };
    const d = st.duration;
    const dur = d.type === 'time' ? durSpeech(d.seconds) : d.type === 'distance' ? distSpeech(d.meters) : 'hasta que pulses vuelta';
    const durS = d.type === 'time' ? durShort(d.seconds) : d.type === 'distance' ? distShort(d.meters) : 'LAP';
    const z = st.target?.hrZone !== undefined && this.maxZoneCap !== undefined ? Math.min(st.target.hrZone, this.maxZoneCap) : st.target?.hrZone;
    const capped = st.target?.hrZone !== undefined && z !== st.target.hrZone;
    const p = capped ? undefined : st.target?.paceSecPerKm;
    const f = (1 + this.heatPct) * this.terrainFactor;
    let target = '';
    let tShort = '';
    if (p) {
      target = `, a ritmo ${paceSpeech(p.min * f)} a ${paceSpeech(p.max * f)}`;
      tShort = `${paceShort(p.min * f)}-${paceShort(p.max * f)}`;
    } else if (z) {
      target = `, en zona ${z}, entre ${this.zones[z - 1].min} y ${this.zones[z - 1].max} pulsaciones`;
      tShort = `Z${z} ${this.zones[z - 1].min}-${this.zones[z - 1].max}`;
    }
    const name = st.rep ? `Serie ${st.rep.n} de ${st.rep.of}` : names[st.kind];
    const extra = capped ? ' Adaptado por tu lesión.' : st.note ? ` ${st.note}` : '';
    const last = st.rep && st.rep.n === st.rep.of && st.rep.of > 1 ? ' Es la última, ¡vamos!' : '';
    return this.mk(`step.${st.index}`, 'step', 2, `${name}: ${dur}${target}.${extra}${last}`, `${name.toUpperCase()} ${durS}\n${tShort}`, 'double');
  }

  // ───────────────────────── reglas ─────────────────────────

  private ruleSteps(s: LiveSample, c: Candidate[]) {
    if (!this.steps.length || this.workoutDone) return;
    if (!this.emitted.has('step.0') && !this.pending.some((p) => p.c.key === 'step.0'))
      this.pending.push({ c: { ...this.stepCue(this.steps[0]), oneShot: true }, expires: s.t + 30 });
    // Puede completarse más de un paso si las muestras llegan espaciadas.
    for (let guard = 0; guard < 5; guard++) {
      const rem = this.stepRemaining(s);
      if (!rem || rem.value > 0) break;
      this.advanceStep(s);
      if (this.workoutDone) return;
    }
    const st = this.currentStep()!;
    const rem = this.stepRemaining(s);
    if (!rem) return;
    const total = st.duration.type === 'time' ? st.duration.seconds : st.duration.type === 'distance' ? st.duration.meters : 0;
    const next = this.steps[this.stepIdx + 1];
    const nextName = next ? { warmup: 'calentamiento', work: 'serie', recovery: 'recuperación', cooldown: 'vuelta a la calma', steady: 'ritmo continuo' }[next.kind] : 'final';
    if (rem.type === 'time' && total >= 60 && rem.value <= 10)
      c.push({ ...this.mk(`step.end.${st.index}`, 'step', 2, `10 segundos. Ahora, ${nextName}.`, `10 s → ${nextName.toUpperCase()}`, 'short'), oneShot: true, ttlS: 6 });
    if (rem.type === 'distance' && total >= 400 && rem.value <= 50)
      c.push({ ...this.mk(`step.end.${st.index}`, 'step', 2, `50 metros. Ahora, ${nextName}.`, `50 m → ${nextName.toUpperCase()}`, 'short'), oneShot: true, ttlS: 8 });
    if (st.kind === 'work' && rem.value <= total / 2 && ((rem.type === 'time' && total >= 240) || (rem.type === 'distance' && total >= 1000)))
      c.push({ ...this.mk(`step.half.${st.index}`, 'step', 4, 'Mitad de la serie. Mantén la postura y respira.', 'MITAD DE SERIE', 'none'), oneShot: true, ttlS: 15 });
  }

  /** En cuesta el ritmo no es referencia (salvo en competición con perfil conocido). */
  private hilly(grade: number | undefined): boolean {
    return grade !== undefined && Math.abs(grade) >= 0.03 && !(this.isRace && !!this.routePts);
  }

  private graceS(): number {
    const st = this.currentStep();
    if (!st) return 90;
    const d = st.duration;
    const total = d.type === 'time' ? d.seconds : d.type === 'distance' ? d.meters / 3 : 600;
    return Math.min(90, total * 0.4);
  }

  private ruleHr(s: LiveSample, hr: number | undefined, zone: number | undefined, tz: number | undefined, grade: number | undefined, atMax: boolean, c: Candidate[]): boolean {
    if (hr === undefined || zone === undefined || tz === undefined) {
      this.aboveSince = this.belowSince = null;
      return false;
    }
    const t = s.t;
    // En el tramo final de una competición no se frena al corredor por pulso.
    if (this.isRace && s.distanceM > this.raceDistM * 0.85) return false;
    const { min, max } = this.zones[tz - 1];
    const inGrace = t - this.stepStartT < this.graceS();
    const above = hr > max + 2 && !inGrace;
    const below = hr < min - 2 && !inGrace;
    this.aboveSince = above ? (this.aboveSince ?? t) : null;
    this.belowSince = below ? (this.belowSince ?? t) : null;
    const st = this.currentStep();
    const injuryCapped = this.maxZoneCap !== undefined && tz === this.maxZoneCap && (st?.target?.hrZone ?? 9) > tz;

    // Calentando, recuperando o enfriando el pulso tarda en bajar: aviso suave y sin insistir.
    const soft = st !== undefined && (st.kind === 'recovery' || st.kind === 'cooldown' || st.kind === 'warmup');
    if (this.aboveSince !== null && t - this.aboveSince >= (soft ? 60 : 20)) {
      if (atMax) return true; // ya lo cubre la alerta de seguridad
      if (soft) {
        c.push({
          ...this.mk('hr.high.soft', 'hr', 3, `Sigues en ${Math.round(hr)} pulsaciones y ahora toca bajar de ${max}. ${st!.kind === 'warmup' ? 'Calienta más despacio, sin prisa.' : 'Trota más suave o camina un poco hasta recuperar.'}`, `AFLOJA\nFC ${Math.round(hr)} > ${max}`, 'short'),
          cooldownS: 180,
        });
        return true;
      }
      const longOver = t - this.aboveSince >= 180;
      let advice: string;
      if (grade !== undefined && grade >= 0.03) advice = 'Estás subiendo: acorta la zancada y, si hace falta, camina unos pasos.';
      else if (injuryCapped) advice = 'Con tu lesión hoy no toca forzar: afloja.';
      else if (this.heatPct >= 0.03) advice = 'Es el calor: baja el ritmo sin mirar el reloj.';
      else advice = 'Afloja un poco el ritmo y suelta los hombros.';
      if (longOver)
        c.push({
          ...this.mk('hr.high.long', 'hr', zone - tz >= 2 ? 1 : 2, `Llevas más de 3 minutos por encima de tu zona, a ${Math.round(hr)} pulsaciones. Camina un minuto hasta bajar de ${max} y retoma más despacio.`, `FC ${Math.round(hr)} ALTA\nCamina 1 min`, zone - tz >= 2 ? 'alert' : 'long'),
          cooldownS: 240,
        });
      else
        c.push({
          ...this.mk('hr.high', 'hr', 2, `Pulso alto: ${Math.round(hr)}, estás en zona ${zone} y toca zona ${tz}, por debajo de ${max}. ${advice}`, `BAJA RITMO\nFC ${Math.round(hr)} > ${max}`, 'double'),
          cooldownS: 75,
        });
      return true;
    }
    const push = st ? st.kind === 'work' || (st.kind === 'steady' && tz >= 3) : this.isRace;
    if (push && !injuryCapped && this.belowSince !== null && t - this.belowSince >= 45 && this.readiness.level !== 'overreached') {
      c.push({
        ...this.mk('hr.low', 'hr', 3, `Vas por debajo del objetivo: ${Math.round(hr)} pulsaciones y buscamos zona ${tz}, a partir de ${min}. Puedes apretar un poco.`, `SUBE RITMO\nFC ${Math.round(hr)} < ${min}`, 'short'),
        cooldownS: 90,
      });
    }
    return false;
  }

  private rulePace(s: LiveSample, pace: number | undefined, tp: { min: number; max: number } | undefined, grade: number | undefined, hrHigh: boolean, c: Candidate[]) {
    const t = s.t;
    const hilly = this.hilly(grade);
    if (pace === undefined || !tp || hilly || t - this.stepStartT < Math.min(30, this.graceS())) {
      this.fastSince = this.slowSince = null;
      return;
    }
    const finalPush = this.isRace && s.distanceM > this.raceDistM * 0.85;
    const fast = pace < tp.min * 0.97 && !finalPush;
    const slow = pace > tp.max * 1.03;
    this.fastSince = fast ? (this.fastSince ?? t) : null;
    this.slowSince = slow ? (this.slowSince ?? t) : null;
    const st = this.currentStep();
    const range = `${paceSpeech(tp.min)} a ${paceSpeech(tp.max)}`;
    const rangeS = `${paceShort(tp.min)}-${paceShort(tp.max)}`;
    if (this.fastSince !== null && t - this.fastSince >= 20) {
      if (hrHigh) return; // el aviso de pulso ya pide aflojar
      const early = this.isRace && s.distanceM < this.raceDistM * 0.25;
      c.push({
        ...this.mk('pace.fast', 'pace', early ? 2 : 3, early ? `Vas demasiado rápido para empezar: a ${paceSpeech(pace)} y tu plan es ${range}. Afloja ahora; lo agradecerás al final.` : `Vas más rápido de lo previsto: a ${paceSpeech(pace)}, objetivo ${range}. Contrólate.`, `MÁS DESPACIO\n${paceShort(pace)} → ${rangeS}`, 'double'),
        cooldownS: early ? 60 : 90,
      });
    } else if (this.slowSince !== null && t - this.slowSince >= 30 && (this.isRace || st?.kind === 'work' || st?.kind === 'steady')) {
      if (hrHigh) return; // el pulso ya va alto: no se pide más ritmo
      if (this.readiness.level === 'overreached' || this.readiness.level === 'fatigued') {
        c.push({ ...this.mk('pace.slow.tired', 'pace', 4, `Vas a ${paceSpeech(pace)}, algo por encima del objetivo, pero llegas cargado: mantén sensaciones, hoy no hace falta clavar el ritmo.`, `${paceShort(pace)} OK\nPor sensaciones`, 'none'), cooldownS: 300 });
        return;
      }
      c.push({
        ...this.mk('pace.slow', 'pace', 3, `Se te va el ritmo: a ${paceSpeech(pace)}, objetivo ${range}. Sube la cadencia y recupera.`, `MÁS RÁPIDO\n${paceShort(pace)} → ${rangeS}`, 'short'),
        cooldownS: 90,
      });
    }
  }

  private ruleCompliance(t: number, dt: number, hr: number | undefined, pace: number | undefined, tz: number | undefined, tp: { min: number; max: number } | undefined, grade: number | undefined, c: Candidate[]) {
    let ok: boolean | undefined;
    if (tp && pace !== undefined && !this.hilly(grade)) ok = pace >= tp.min * 0.97 && pace <= tp.max * 1.03;
    else if (tz && hr !== undefined) ok = hr >= this.zones[tz - 1].min - 2 && hr <= this.zones[tz - 1].max + 2;
    if (ok === undefined || t - this.stepStartT < this.graceS()) return;
    this.targetTime += dt;
    if (ok) this.compliantTime += dt;
    this.inTargetSince = ok ? (this.inTargetSince ?? t) : null;
    if (this.inTargetSince !== null && t - this.inTargetSince >= 300) {
      const lines = ['Perfecto, clavado en el objetivo. Sigue así.', 'Muy bien, ritmo de metrónomo. Respira y disfruta.', 'Lo estás bordando. Hombros sueltos y a seguir.'];
      c.push({ ...this.mk('motivation.ontarget', 'motivation', 4, lines[Math.floor(t / 600) % lines.length], 'PERFECTO ✓', 'none'), cooldownS: 600 });
    }
  }

  private ruleCadence(s: LiveSample, cadence: number | undefined, speed: number | undefined, grade: number | undefined, c: Candidate[]) {
    const t = s.t;
    if (cadence === undefined || cadence < 130 || speed === undefined || speed < 2.5 || t < 300 || (grade !== undefined && Math.abs(grade) >= 0.04)) {
      this.lowCadSince = null;
      return;
    }
    const base = this.ctx.profile.baselineCadence;
    const threshold = base ? base - 8 : 160;
    this.lowCadSince = cadence < threshold ? (this.lowCadSince ?? t) : null;
    if (this.lowCadSince !== null && t - this.lowCadSince >= 60) {
      const goal = Math.round(Math.min(base ?? 170, cadence * 1.05));
      const inj = this.openInjuries.some((i) => ['knee', 'shin', 'hip', 'itband'].includes(i.area));
      c.push({
        ...this.mk('cadence.low', 'cadence', 3, `Cadencia baja: ${Math.round(cadence)} pasos por minuto. Da pasos más cortos y rápidos, hacia ${goal}.${inj ? ' Reduce el impacto en tu lesión.' : ' Impactarás menos y gastarás menos.'}`, `CADENCIA ${Math.round(cadence)}\nPasos cortos → ${goal}`, 'short'),
        cooldownS: 480,
      });
      return;
    }
    if (t > 1800 && this.earlyCad.n > 200) {
      const early = this.earlyCad.sum / this.earlyCad.n;
      if (cadence < early * 0.95)
        c.push({
          ...this.mk('cadence.fade', 'cadence', 3, `Tu cadencia ha caído de ${Math.round(early)} a ${Math.round(cadence)}: es fatiga. Cuerpo alto, mirada al frente y brazos activos.`, `CADENCIA CAE\n${Math.round(early)} → ${Math.round(cadence)}`, 'short'),
          cooldownS: 900,
        });
    }
  }

  private ruleElevation(s: LiveSample, grade: number | undefined, c: Candidate[]) {
    const d = s.distanceM;
    const kneeNote = this.avoidDownhill ? ` Cuidado con tu ${this.openInjuries[0]?.label ?? 'lesión'}: baja frenando poco pero sin dejarte caer, pasos muy cortos.` : '';
    if (this.segments.length) {
      for (const seg of this.segments) {
        const id = Math.round(seg.startM);
        const ahead = seg.startM - d;
        if (ahead > 0 && ahead <= 250) {
          if (seg.kind === 'climb')
            c.push({
              ...this.mk(`elev.climb.${id}`, 'elevation', 2, `En ${distSpeech(ahead)} empieza una subida de ${distSpeech(seg.lengthM)} al ${pct(seg.grade)} por ciento, ${Math.round(seg.gainM)} metros de desnivel. Acorta la zancada, sube la cadencia y guíate por pulso, no por ritmo.`, `SUBIDA en ${distShort(ahead)}\n${distShort(seg.lengthM)} al ${pct(seg.grade)}%`, 'double'),
              oneShot: true,
              ttlS: 40,
            });
          else if (seg.lengthM >= 200 && (Math.abs(seg.grade) >= 0.05 || this.avoidDownhill))
            c.push({
              ...this.mk(`elev.descent.${id}`, 'elevation', this.avoidDownhill ? 2 : 3, `Viene una bajada de ${distSpeech(seg.lengthM)} al ${pct(seg.grade)} por ciento. Inclínate un poco hacia delante y deja correr las piernas.${kneeNote}`, `BAJADA ${distShort(seg.lengthM)}\n${pct(seg.grade)}%`, 'short'),
              oneShot: true,
              ttlS: 40,
            });
        }
        if (seg.kind === 'climb' && seg.lengthM >= 300 && d >= seg.endM && d < seg.endM + 100)
          c.push({ ...this.mk(`elev.top.${id}`, 'elevation', 3, 'Subida superada. Recupera el aliento sin pararte y vuelve poco a poco a tu ritmo.', 'CIMA ✓\nRecupera', 'short'), oneShot: true, ttlS: 30 });
      }
      return;
    }
    if (grade === undefined) return;
    if (grade >= 0.04)
      c.push({ ...this.mk('elev.climb.now', 'elevation', 3, `Subida del ${pct(grade)} por ciento. Pasos cortos, mirada arriba y esfuerzo constante: aquí manda el pulso, no el ritmo.`, `SUBIDA ${pct(grade)}%\nPor pulso`, 'short'), cooldownS: 420 });
    else if (grade <= -0.05)
      c.push({ ...this.mk('elev.descent.now', 'elevation', this.avoidDownhill ? 2 : 4, `Bajada del ${pct(grade)} por ciento. Cadencia alta y sin frenar de talón.${kneeNote}`, `BAJADA ${pct(grade)}%`, this.avoidDownhill ? 'short' : 'none'), cooldownS: 420 });
  }

  private ruleWeather(s: LiveSample, speed: number | undefined, c: Candidate[]) {
    const w = this.ctx.weather;
    if (!w || s.headingDeg === undefined || speed === undefined || w.windSpeedMps < 4) return;
    const hw = headwindMps(w, s.headingDeg);
    this.headwindSince = hw >= 4 ? (this.headwindSince ?? s.t) : null;
    if (hw < 2) this.headwindTold = false; // nuevo tramo: se podrá volver a avisar
    if (this.headwindSince !== null && s.t - this.headwindSince >= 30 && !this.headwindTold) {
      this.hadHeadwind = true;
      c.push({ ...this.mk('wind.head', 'weather', 3, `Viento de cara de ${kmh(hw)} kilómetros por hora. Mantén el esfuerzo y olvida el ritmo; cuerpo algo inclinado y, si puedes, resguárdate tras otro corredor.`, `VIENTO DE CARA\n${kmh(hw)} km/h`, 'short'), cooldownS: 300 });
    } else if (hw <= -4 && this.hadHeadwind)
      c.push({ ...this.mk('wind.tail', 'weather', 4, 'Ahora tienes el viento a favor: aprovecha para recuperar tiempo sin gastar de más.', 'VIENTO A FAVOR', 'none'), cooldownS: 900 });
  }

  private ruleFuel(t: number, c: Candidate[]) {
    const w = this.ctx.weather;
    const longRun = this.plannedS >= 3600 || t >= 3600;
    const everyMin = this.heatPct >= 0.03 ? 15 : w && w.tempC >= 20 ? 20 : longRun ? 25 : 0;
    if (everyMin) {
      const n = Math.floor(t / (everyMin * 60));
      if (n >= 1) {
        const ml = Math.round((sweatRateLph(this.ctx.profile.weightKg, w) * (everyMin / 60) * 1000 * 0.6) / 50) * 50;
        c.push({ ...this.mk(`fuel.drink.${n}`, 'fuel', 3, `Toca beber: unos ${clamp(ml, 100, 300)} mililitros a sorbos pequeños.`, `BEBE\n~${clamp(ml, 100, 300)} ml`, 'short'), oneShot: true, ttlS: 120 });
      }
    }
    if (this.plannedS >= 4500 || t >= 4500) {
      const n = t >= 2400 ? Math.floor((t - 2400) / 2100) + 1 : 0;
      if (n >= 1) c.push({ ...this.mk(`fuel.carbs.${n}`, 'fuel', 3, 'Toca comer: un gel o unos 25 gramos de hidratos, con agua.', 'GEL / HIDRATOS', 'short'), oneShot: true, ttlS: 180 });
    }
  }

  private ruleInjury(t: number, c: Candidate[]) {
    const inj = this.openInjuries[0];
    if (!inj) return;
    const n = t >= 600 ? Math.floor((t - 600) / 1200) + 1 : 0;
    if (n >= 1)
      c.push({ ...this.mk(`injury.check.${n}`, 'injury', 3, `¿Cómo va tu ${inj.label}? Si el dolor pasa de 3 sobre 10 o notas que cambias la pisada, dímelo y paramos.`, `¿QUÉ TAL LA LESIÓN?\nDolor >3 = parar`, 'short'), oneShot: true, ttlS: 120 });
    if (this.maxDurationS !== undefined) {
      if (t >= this.maxDurationS)
        c.push({ ...this.mk('injury.duration', 'injury', 2, `Has llegado a los ${Math.round(this.maxDurationS / 60)} minutos que permite tu ${inj.label}. Termina aquí y camina para enfriar.`, 'LÍMITE POR LESIÓN\nTermina aquí', 'long'), cooldownS: 300 });
      else if (t >= this.maxDurationS - 300)
        c.push({ ...this.mk('injury.duration.soon', 'injury', 3, 'Te quedan 5 minutos del tiempo máximo que marca tu lesión. Ve terminando.', 'QUEDAN 5 MIN\n(límite lesión)', 'short'), oneShot: true, ttlS: 60 });
    }
  }

  private ruleSafety(s: LiveSample, hr: number | undefined, c: Candidate[]): boolean {
    if (hr === undefined) return false;
    const nearMax = hr >= this.ctx.profile.hrMax * 0.98;
    const sprinting = this.isRace && s.distanceM > this.raceDistM * 0.85;
    this.hrMaxSince = nearMax && !sprinting ? (this.hrMaxSince ?? s.t) : null;
    if (this.hrMaxSince !== null && s.t - this.hrMaxSince >= 15)
      c.push({ ...this.mk('safety.hrmax', 'safety', 1, `Estás en tu pulso máximo, ${Math.round(hr)} pulsaciones. Baja ya a caminar y respira hondo. Si notas mareo o dolor en el pecho, detente y pide ayuda.`, `FC MÁXIMA ${Math.round(hr)}\nCAMINA`, 'alert'), cooldownS: 120 });
    return this.hrMaxSince !== null;
  }

  /** Deriva cardíaca: el pulso sube a igual velocidad → fatiga, calor o deshidratación. */
  private ruleDrift(s: LiveSample, hr: number | undefined, speed: number | undefined, grade: number | undefined, c: Candidate[]) {
    const type = this.ctx.workout?.type;
    if (type && isHardWorkout(this.ctx.workout!)) return;
    if (hr === undefined || speed === undefined || speed < 2 || (grade !== undefined && Math.abs(grade) > 0.02)) return;
    const eff = hr / speed;
    if (s.t >= 600 && s.t <= 1200) {
      this.earlyEff.sum += eff;
      this.earlyEff.n++;
    }
    this.recentEff.push({ t: s.t, v: eff });
    while (this.recentEff.length && s.t - this.recentEff[0].t > 600) this.recentEff.shift();
    if (s.t < 2400 || this.earlyEff.n < 30 || this.recentEff.length < 30) return;
    const early = this.earlyEff.sum / this.earlyEff.n;
    const recent = this.recentEff.reduce((a, b) => a + b.v, 0) / this.recentEff.length;
    const drift = recent / early - 1;
    if (drift >= 0.08)
      c.push({
        ...this.mk('drift', 'hr', 3, `Tu pulso ha subido un ${pct(drift)} por ciento al mismo ritmo que al principio. Es deriva cardíaca: ${this.heatPct >= 0.02 ? 'el calor te está pasando factura, ' : ''}bebe y baja un punto el ritmo para terminar entero.`, `DERIVA FC +${pct(drift)}%\nBebe y afloja`, 'short'),
        cooldownS: 1200,
      });
  }

  private ruleSplits(s: LiveSample, c: Candidate[]) {
    const k = Math.floor(s.distanceM / 1000);
    if (k <= this.kmMark.k) return;
    const lapS = s.t - this.kmMark.t;
    const kms = k - this.kmMark.k;
    const lapPace = lapS / kms;
    const lapHr = this.kmMark.hrN ? Math.round(this.kmMark.hrSum / this.kmMark.hrN) : undefined;
    this.kmMark = { k, t: s.t, hrSum: 0, hrN: 0 };
    let text = `Kilómetro ${k}, en ${paceSpeech(lapPace)}`;
    if (lapHr) text += `, pulso medio ${lapHr}`;
    text += '.';
    let priority: Cue['priority'] = 3;
    if (this.isRace && this.racePace) {
      const projected = s.t + ((this.raceDistM - s.distanceM) / 1000) * this.racePace;
      const delta = Math.round(s.t - (s.distanceM / 1000) * this.racePace);
      text +=
        Math.abs(delta) < 5
          ? ' Vas clavado en tu objetivo.'
          : delta < 0
            ? ` Llevas ${durSpeech(-delta)} de ventaja sobre tu objetivo.`
            : ` Vas ${durSpeech(delta)} por detrás; al ritmo objetivo desde aquí llegarías en ${durSpeech(projected)}.`;
      priority = 2;
    }
    c.push({ ...this.mk(`split.${k}`, 'split', priority, text, `KM ${k} · ${paceShort(lapPace)}${lapHr ? `\nFC ${lapHr}` : ''}`, 'short'), oneShot: true, ttlS: 25 });
  }

  private ruleRace(s: LiveSample, _pace: number | undefined, c: Candidate[]) {
    const left = this.raceDistM - s.distanceM;
    const one = (key: string, priority: Cue['priority'], text: string, short: string, haptic: Haptic = 'double') =>
      c.push({ ...this.mk(key, 'race', priority, text, short, haptic), oneShot: true, ttlS: 30 });
    if (s.distanceM >= this.raceDistM / 2 && left > this.raceDistM * 0.4)
      one('race.half', 2, `Mitad de carrera en ${durSpeech(s.t)}. Ahora empieza de verdad: mantén el ritmo y céntrate en el siguiente kilómetro.`, `MITAD · ${durShort(s.t)}`);
    if (left <= this.raceDistM * 0.2 && left > Math.max(1200, this.raceDistM * 0.1))
      one('race.last20', 2, `Quedan ${distSpeech(left)}. Si tienes fuerzas, es el momento de ir subiendo poco a poco.`, `QUEDAN ${distShort(left)}\nVe subiendo`);
    if (left <= 1000 && left > 500 && this.raceDistM >= 3000) one('race.lastkm', 2, 'Último kilómetro. Todo lo que tengas, a por ello. Brazos y cadencia.', 'ÚLTIMO KM\n¡VAMOS!', 'long');
    if (left <= 400 && left > 100) one('race.sprint', 1, 'Últimos 400 metros. ¡Esprinta hasta la meta!', '400 m\n¡SPRINT!', 'long');
    if (left <= 0) one('race.finish', 1, '¡Meta! Enhorabuena. Sigue caminando unos minutos y bebe.', '¡META!', 'long');
  }

  // ───────────────────────── planificador de avisos ─────────────────────────

  /**
   * Decide qué se dice ahora: como mucho una indicación por actualización, la más
   * prioritaria, respetando silencios mínimos para no agobiar al corredor.
   */
  private schedule(t: number, candidates: Candidate[]): Cue[] {
    const maxP = MAX_PRIORITY[this.verbosity];
    for (const c of candidates) {
      if (!c.oneShot) continue;
      if (this.emitted.has(c.key) || this.pending.some((p) => p.c.key === c.key)) continue;
      this.pending.push({ c, expires: t + (c.ttlS ?? 30) });
    }
    // Los eventos caducados se marcan como emitidos para que no vuelvan a encolarse.
    for (const p of this.pending) if (p.expires < t) this.emitted.set(p.c.key, t);
    this.pending = this.pending.filter((p) => p.expires >= t);

    // Si el corredor no corrige, se insiste cada vez más espaciado (×2, ×4, ×8) en vez de machacar.
    const ready = (c: Candidate) => {
      const r = this.repeats.get(c.key);
      if (r && t - r.seen > 60) r.n = 0; // la situación se corrigió: se empieza de cero
      if (r) r.seen = t;
      const factor = c.priority === 1 ? 1 : 2 ** Math.min(r ? Math.max(r.n - 1, 0) : 0, 3);
      return t - (this.emitted.get(c.key) ?? -1e9) >= (c.cooldownS ?? 60) * factor;
    };
    const pool: Candidate[] = [
      ...this.pending.map((p) => p.c),
      ...candidates.filter((c) => !c.oneShot).filter(ready),
    ].filter((c) => c.priority <= maxP);
    if (!pool.length) return [];
    pool.sort((a, b) => a.priority - b.priority || Number(!!b.oneShot) - Number(!!a.oneShot));
    const top = pool[0];
    const gap = top.priority === 1 ? (t - this.lastP1T < 10 ? 10 : 0) : top.category === 'step' || top.category === 'race' ? 4 : GAP_BY_VERBOSITY[this.verbosity];
    if (t - this.lastSpokenT < gap) return [];
    this.emitted.set(top.key, t);
    if (top.key === 'wind.head') this.headwindTold = true;
    if (!top.oneShot) {
      const r = this.repeats.get(top.key) ?? { n: 0, seen: t };
      r.n++;
      r.seen = t;
      this.repeats.set(top.key, r);
    }
    this.lastSpokenT = t;
    if (top.priority === 1) this.lastP1T = t;
    this.pending = this.pending.filter((p) => p.c.key !== top.key);
    const { cooldownS: _c, oneShot: _o, ttlS: _t, ...cue } = top;
    return [{ ...cue, atS: t }];
  }
}

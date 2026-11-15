import type { PlanGoal, TrainingPlan, Workout, WorkoutStep } from './types';

const t = (minutes: number) => ({ type: 'time' as const, seconds: minutes * 60 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Plan de ejemplo de 4 semanas (4 días/semana) para probar la app sin importar nada.
 * `thresholdPace` = ritmo umbral en s/km; el resto de ritmos se derivan de él.
 */
export function buildSamplePlan(today: string, thresholdPace = 300, goal?: PlanGoal): TrainingPlan {
  const start = new Date(today + 'T00:00:00Z');
  const workouts: Workout[] = [];
  const warm: WorkoutStep = { kind: 'warmup', duration: t(12), target: { hrZone: 2 } };
  const cool: WorkoutStep = { kind: 'cooldown', duration: t(8), target: { hrZone: 1 } };
  for (let week = 0; week < 4; week++) {
    const day = (offset: number) => iso(new Date(start.getTime() + (week * 7 + offset) * 86400000));
    const deload = week === 3;
    workouts.push({
      date: day(0),
      type: 'easy',
      title: 'Rodaje suave',
      steps: [{ kind: 'steady', duration: t(deload ? 35 : 40 + week * 5), target: { hrZone: 2 } }],
    });
    workouts.push({
      date: day(2),
      type: 'intervals',
      title: `Series ${deload ? 4 : 5 + week}×1000`,
      steps: [
        warm,
        {
          repeat: deload ? 4 : 5 + week,
          steps: [
            { kind: 'work', duration: { type: 'distance', meters: 1000 }, target: { paceSecPerKm: { min: thresholdPace * 0.94, max: thresholdPace * 0.98 } } },
            { kind: 'recovery', duration: t(2), target: { hrZone: 2 } },
          ],
        },
        cool,
      ],
    });
    workouts.push({
      date: day(4),
      type: 'tempo',
      title: 'Tempo',
      steps: [warm, { kind: 'steady', duration: t(deload ? 15 : 20 + week * 3), target: { hrZone: 4, paceSecPerKm: { min: thresholdPace * 1.0, max: thresholdPace * 1.04 } } }, cool],
    });
    workouts.push({
      date: day(6),
      type: 'long',
      title: 'Tirada larga',
      steps: [{ kind: 'steady', duration: t(deload ? 60 : 75 + week * 10), target: { hrZone: 2 } }],
    });
  }
  return { name: 'Plan de ejemplo · 4 semanas', goal, workouts };
}

/** Valida un plan importado (JSON) y devuelve errores legibles. */
export function validatePlan(data: unknown): { plan?: TrainingPlan; error?: string } {
  const p = data as TrainingPlan;
  if (!p || typeof p !== 'object' || !Array.isArray(p.workouts)) return { error: 'Falta la lista "workouts".' };
  for (const [i, w] of p.workouts.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w?.date ?? '')) return { error: `Sesión ${i + 1}: fecha no válida (usa AAAA-MM-DD).` };
    if (!w.title || !w.type) return { error: `Sesión ${i + 1}: faltan "title" o "type".` };
    if (!Array.isArray(w.steps)) return { error: `Sesión ${i + 1}: falta "steps".` };
    if (w.type === 'race' && !w.race?.distanceM) return { error: `Sesión ${i + 1}: una competición necesita "race.distanceM".` };
  }
  return { plan: { name: p.name ?? 'Plan importado', goal: p.goal, workouts: p.workouts } };
}

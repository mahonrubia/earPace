import type { RepeatBlock, TrainingPlan, Workout, WorkoutStep } from './types';

export interface FlatStep extends WorkoutStep {
  index: number;
  /** Para series: nº de repetición y total. */
  rep?: { n: number; of: number };
}

const isRepeat = (s: WorkoutStep | RepeatBlock): s is RepeatBlock => 'repeat' in s;

/** Expande los bloques de repetición en una lista lineal de pasos. */
export function flattenWorkout(workout: Workout): FlatStep[] {
  const out: FlatStep[] = [];
  for (const s of workout.steps) {
    if (isRepeat(s)) {
      for (let n = 1; n <= s.repeat; n++)
        for (const st of s.steps)
          out.push({ ...st, index: out.length, rep: st.kind === 'work' ? { n, of: s.repeat } : undefined });
    } else out.push({ ...s, index: out.length });
  }
  return out;
}

export function workoutForDate(plan: TrainingPlan | undefined, date: string): Workout | undefined {
  return plan?.workouts.find((w) => w.date === date);
}

/** Duración prevista en segundos (estimando los pasos por distancia a un ritmo dado). */
export function plannedDurationS(workout: Workout, fallbackPaceSecPerKm = 360): number {
  if (workout.race?.targetTimeS) return workout.race.targetTimeS;
  if (workout.race) return (workout.race.distanceM / 1000) * fallbackPaceSecPerKm;
  let total = 0;
  for (const s of flattenWorkout(workout)) {
    if (s.duration.type === 'time') total += s.duration.seconds;
    else if (s.duration.type === 'distance') {
      const p = s.target?.paceSecPerKm;
      total += (s.duration.meters / 1000) * (p ? (p.min + p.max) / 2 : fallbackPaceSecPerKm);
    } else total += 600;
  }
  return total;
}

export const isHardWorkout = (w: Workout) => ['tempo', 'intervals', 'hills', 'race'].includes(w.type);

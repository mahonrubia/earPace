import { CoachSession } from '../src/session';
import type { AthleteProfile, CoachContext, Cue, LiveSample } from '../src/types';

export const profile: AthleteProfile = {
  weightKg: 72,
  hrMax: 190,
  hrRest: 50,
  baselineCadence: 172,
  // Z1 120-134 · Z2 135-148 · Z3 149-162 · Z4 163-176 · Z5 177-190
  hrZones: [
    { min: 120, max: 134 },
    { min: 135, max: 148 },
    { min: 149, max: 162 },
    { min: 163, max: 176 },
    { min: 177, max: 190 },
  ],
};

export const ctx = (extra: Partial<CoachContext> = {}): CoachContext => ({
  profile,
  today: '2026-11-15',
  verbosity: 'detailed',
  ...extra,
});

type Gen = (t: number, distanceM: number) => Partial<LiveSample> & { speedMps: number };

/** Simula una carrera segundo a segundo y devuelve todas las indicaciones emitidas. */
export function run(session: CoachSession, seconds: number, gen: Gen, from = 0, startDist = 0): { cues: Cue[]; dist: number } {
  const cues: Cue[] = [];
  let dist = startDist;
  for (let t = from; t <= from + seconds; t++) {
    const g = gen(t, dist);
    cues.push(...session.update({ t, distanceM: dist, cadence: 172, ...g }));
    dist += g.speedMps;
  }
  return { cues, dist };
}

export const keys = (cues: Cue[]) => cues.map((c) => c.key);

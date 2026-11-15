import { describe, expect, it } from 'vitest';
import { buildSamplePlan, flattenWorkout, parseGpx, profileFromWatch, sampleFromWatch, validatePlan, watchConfig, watchCue, watchStatus, workoutForDate } from '../src';

describe('GPX', () => {
  it('extrae el perfil de elevación', () => {
    const gpx = `<gpx><trk><name>Ruta</name><trkseg>
      <trkpt lat="40.0000" lon="-3.7000"><ele>650</ele></trkpt>
      <trkpt lat="40.0090" lon="-3.7000"><ele>690.5</ele></trkpt>
      <trkpt lat="40.0180" lon="-3.7000"><ele>670</ele></trkpt>
    </trkseg></trk></gpx>`;
    const r = parseGpx(gpx);
    expect(r.name).toBe('Ruta');
    expect(r.points).toHaveLength(3);
    expect(r.points[1].distM).toBeCloseTo(1000, -2);
    expect(r.points[1].eleM).toBe(690.5);
    expect(() => parseGpx('<gpx></gpx>')).toThrow();
  });
});

describe('protocolo con el reloj', () => {
  it('codifica indicaciones, objetivo y entrenamiento', () => {
    expect(watchCue({ key: 'k', category: 'hr', priority: 2, text: '', short: 'CIMA ✓\nRecupera', haptic: 'double', atS: 1 })).toEqual({ k: 'cue', s: 'CIMA\nRecupera', h: 2, p: 2 });
    expect(watchStatus({ stepIndex: 0, stepCount: 1, targetZone: 2, targetHr: { min: 135, max: 148 } })).toEqual({ k: 'st', z: 2, lo: 135, hi: 148 });
    expect(watchStatus({ stepIndex: 0, stepCount: 1, targetPace: { min: 254.6, max: 265.2 } })).toEqual({ k: 'st', pmin: 255, pmax: 265 });
    const plan = buildSamplePlan('2026-11-15');
    const w = workoutForDate(plan, '2026-11-17')!;
    const cfg = watchConfig(w.title, flattenWorkout(w));
    expect(cfg.steps[0]).toEqual([0, 0, 720, 2]);
    expect(cfg.steps[1]).toEqual([1, 1, 1000, 0]);
    expect(JSON.stringify(cfg).length).toBeLessThan(600);
  });

  it('decodifica muestras y perfil de Garmin', () => {
    expect(sampleFromWatch({ k: 's', t: 60, d: 180, hr: 140, cad: 86, spd: 300, alt: 650, hdg: 90 })).toEqual({ t: 60, distanceM: 180, hr: 140, cadence: 172, speedMps: 3, altitudeM: 650, headingDeg: 90 });
    const p = profileFromWatch({ zones: [95, 114, 133, 152, 171, 190], w: 72500, rhr: 48 });
    expect(p.zones![1]).toEqual({ min: 115, max: 133 });
    expect(p).toMatchObject({ weightKg: 72.5, hrRest: 48, hrMax: 190 });
  });
});

describe('planes', () => {
  it('genera y valida', () => {
    const plan = buildSamplePlan('2026-11-15');
    expect(plan.workouts).toHaveLength(16);
    expect(validatePlan(JSON.parse(JSON.stringify(plan))).plan?.workouts).toHaveLength(16);
    expect(validatePlan({ workouts: [{ date: '15/11/2026', title: 'x', type: 'easy', steps: [] }] }).error).toContain('fecha');
    expect(validatePlan({}).error).toBeDefined();
  });
});

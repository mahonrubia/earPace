import { describe, expect, it } from 'vitest';
import {
  computeHrZones,
  computeReadiness,
  dewPointC,
  gradeFactor,
  headwindMps,
  heatAdjustment,
  restrictionsOf,
  shoeMaxKm,
  windAdjustment,
  zoneOfHr,
} from '../src/physiology';
import { flattenWorkout } from '../src/plan';
import { findSegments, totalAscent } from '../src/route';
import { profile } from './helpers';

describe('fisiología', () => {
  it('calcula zonas contiguas por reserva de FC', () => {
    const z = computeHrZones(190, 50);
    expect(z).toHaveLength(5);
    expect(z[0].min).toBe(120);
    expect(z[4].max).toBe(190);
    for (let i = 1; i < 5; i++) expect(z[i].min).toBe(z[i - 1].max + 1);
    expect(zoneOfHr(100, z)).toBe(0);
    expect(zoneOfHr(140, z)).toBe(2);
    expect(zoneOfHr(200, z)).toBe(5);
  });

  it('ajusta por calor y humedad', () => {
    expect(dewPointC(20, 50)).toBeCloseTo(9.3, 0);
    expect(heatAdjustment({ tempC: 10, humidityPct: 50 }).pct).toBe(0);
    const hot = heatAdjustment({ tempC: 30, humidityPct: 70 });
    expect(hot.pct).toBeGreaterThan(0.04);
    expect(hot.pct).toBeLessThan(0.1);
    expect(heatAdjustment({ tempC: 38, humidityPct: 80 }).extreme).toBe(true);
  });

  it('ajusta por pendiente y viento', () => {
    expect(gradeFactor(0)).toBeCloseTo(1);
    expect(gradeFactor(0.05)).toBeGreaterThan(1.25);
    expect(gradeFactor(-0.05)).toBeLessThan(1);
    expect(gradeFactor(-0.05)).toBeGreaterThan(0.85);
    // Viento del norte, corriendo hacia el norte = de cara.
    expect(headwindMps({ windSpeedMps: 6, windFromDeg: 0 }, 0)).toBeCloseTo(6);
    expect(headwindMps({ windSpeedMps: 6, windFromDeg: 0 }, 180)).toBeCloseTo(-6);
    expect(headwindMps({ windSpeedMps: 6, windFromDeg: 0 }, 90)).toBeCloseTo(0);
    expect(windAdjustment(6, 3.3)).toBeGreaterThan(0.03);
    expect(windAdjustment(6, 3.3)).toBeLessThan(0.07);
    expect(windAdjustment(-6, 3.3)).toBeLessThan(0);
    expect(Math.abs(windAdjustment(-6, 3.3))).toBeLessThan(windAdjustment(6, 3.3));
  });

  it('acorta la vida de la zapatilla en corredores pesados', () => {
    const shoe = { id: 's', name: 'X', type: 'daily' as const, km: 0 };
    expect(shoeMaxKm(shoe, 70)).toBe(750);
    expect(shoeMaxKm(shoe, 92)).toBe(675);
  });

  it('deriva restricciones de la lesión', () => {
    const r = restrictionsOf({ id: 'i', area: 'knee', label: 'rodilla', status: 'active', severity: 2, onset: '2026-11-01' });
    expect(r.maxZone).toBe(2);
    expect(r.avoidDownhill).toBe(true);
    expect(r.maxDurationMin).toBe(40);
    expect(restrictionsOf({ id: 'i', area: 'knee', label: 'r', status: 'recovered', severity: 2, onset: '2026-01-01' })).toEqual({});
  });

  it('detecta sobrecarga por historial', () => {
    const base = Array.from({ length: 21 }, (_, i) => i + 8)
      .filter((d) => d % 2 === 0)
      .map((d) => ({ date: iso(d), durationMin: 40, distanceKm: 7, avgHr: 140 }));
    const spike = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ date: iso(d), durationMin: 75, distanceKm: 14, avgHr: 160, type: 'tempo' as const }));
    const r = computeReadiness([...base, ...spike], profile, '2026-11-15', { lastSleepHours: 5 });
    expect(r.acwr).toBeGreaterThan(1.5);
    expect(r.daysSinceRest).toBe(8); // 7 días de pico + el día 8 de la base
    expect(r.level).toBe('overreached');
    expect(computeReadiness(base, profile, '2026-11-15').level).toBe('fresh');
  });
});

const iso = (daysAgo: number) => new Date(Date.parse('2026-11-15') - daysAgo * 86400000).toISOString().slice(0, 10);

describe('plan y ruta', () => {
  it('expande las repeticiones', () => {
    const steps = flattenWorkout({
      date: '2026-11-15',
      type: 'intervals',
      title: 'Series',
      steps: [
        { kind: 'warmup', duration: { type: 'time', seconds: 600 } },
        { repeat: 3, steps: [{ kind: 'work', duration: { type: 'distance', meters: 1000 } }, { kind: 'recovery', duration: { type: 'time', seconds: 90 } }] },
        { kind: 'cooldown', duration: { type: 'time', seconds: 300 } },
      ],
    });
    expect(steps.map((s) => s.kind)).toEqual(['warmup', 'work', 'recovery', 'work', 'recovery', 'work', 'recovery', 'cooldown']);
    expect(steps[5].rep).toEqual({ n: 3, of: 3 });
  });

  it('encuentra subidas y bajadas', () => {
    const route = {
      points: [
        { distM: 0, eleM: 100 },
        { distM: 1000, eleM: 100 },
        { distM: 1600, eleM: 136 }, // 6 %
        { distM: 2600, eleM: 136 },
        { distM: 3100, eleM: 106 }, // −6 %
        { distM: 4000, eleM: 106 },
      ],
    };
    const segs = findSegments(route);
    expect(segs.map((s) => s.kind)).toEqual(['climb', 'descent']);
    expect(segs[0].startM).toBeCloseTo(1000, -2);
    expect(segs[0].grade).toBeCloseTo(0.06, 2);
    expect(totalAscent(route.points)).toEqual({ ascentM: 36, descentM: 30 });
  });
});

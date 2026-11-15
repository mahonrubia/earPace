import { describe, expect, it } from 'vitest';
import { CoachSession } from '../src/session';
import type { Injury, Workout } from '../src/types';
import { ctx, keys, run } from './helpers';

const easy: Workout = {
  date: '2026-11-15',
  type: 'easy',
  title: 'Rodaje suave',
  steps: [{ kind: 'steady', duration: { type: 'time', seconds: 2400 }, target: { hrZone: 2 } }],
};

const intervals: Workout = {
  date: '2026-11-15',
  type: 'intervals',
  title: 'Series de 1000',
  steps: [
    { kind: 'warmup', duration: { type: 'time', seconds: 300 }, target: { hrZone: 2 } },
    {
      repeat: 2,
      steps: [
        { kind: 'work', duration: { type: 'distance', meters: 1000 }, target: { paceSecPerKm: { min: 255, max: 265 } } },
        { kind: 'recovery', duration: { type: 'time', seconds: 120 }, target: { hrZone: 2 } },
      ],
    },
    { kind: 'cooldown', duration: { type: 'time', seconds: 300 }, target: { hrZone: 1 } },
  ],
};

const knee: Injury = { id: 'k', area: 'knee', label: 'rodilla derecha', status: 'active', severity: 2, onset: '2026-11-01', clinicalLog: [{ date: '2026-11-10', note: 'mejor', painLevel: 2 }] };

describe('briefing', () => {
  it('resume sesión, clima, zapatillas y lesiones', () => {
    const s = new CoachSession(
      ctx({
        workout: intervals,
        plan: { name: 'Plan', goal: { name: 'la media maratón', date: '2026-12-20', distanceM: 21097 }, workouts: [intervals] },
        weather: { tempC: 29, humidityPct: 70, windSpeedMps: 8, windFromDeg: 270 },
        shoe: { id: 's', name: 'Pegasus', type: 'daily', km: 810 },
        injuries: [knee],
        terrain: 'trail',
      }),
    );
    const b = s.briefing();
    const k = keys(b);
    expect(k).toEqual(expect.arrayContaining(['brief.workout', 'brief.weather', 'brief.terrain', 'brief.shoe.worn', 'brief.shoe.terrain', 'brief.injury.k']));
    const text = b.map((c) => c.text).join(' ');
    expect(text).toContain('2 series de 1 kilómetro');
    expect(text).toContain('Faltan 35 días para la media maratón');
    expect(text).toContain('viento del oeste');
    expect(text).toContain('no encaja con tu lesión');
    expect(text).toContain('2 sobre 10');
    for (const c of b) expect(c.short.length).toBeGreaterThan(0);
  });

  it('en modo mínimo solo deja lo importante', () => {
    const s = new CoachSession(ctx({ workout: easy, verbosity: 'minimal', terrain: 'gravel', weather: { tempC: 12, humidityPct: 50, windSpeedMps: 1, windFromDeg: 0 } }));
    expect(keys(s.briefing())).toEqual(['brief.workout']);
  });
});

describe('pulso', () => {
  it('avisa si el pulso se va por encima de la zona y escala si persiste', () => {
    const s = new CoachSession(ctx({ workout: easy }));
    const a = run(s, 400, () => ({ hr: 142, speedMps: 2.9 }));
    expect(keys(a.cues)).not.toContain('hr.high');
    const b = run(s, 240, () => ({ hr: 168, speedMps: 3.4 }), 401, a.dist);
    const high = b.cues.find((c) => c.key === 'hr.high')!;
    expect(high.text).toContain('zona 4');
    expect(high.text).toContain('por debajo de 148');
    expect(high.short).toContain('BAJA RITMO');
    expect(keys(b.cues)).toContain('hr.high.long');
    expect(b.cues.find((c) => c.key === 'hr.high.long')!.priority).toBe(1);
  });

  it('no molesta mientras se cumple y felicita a los 5 minutos', () => {
    const s = new CoachSession(ctx({ workout: easy }));
    const { cues } = run(s, 900, () => ({ hr: 142, speedMps: 2.9 }));
    expect(cues.filter((c) => c.category === 'hr')).toHaveLength(0);
    expect(keys(cues)).toContain('motivation.ontarget');
  });

  it('alerta de seguridad al llegar a FC máxima', () => {
    const s = new CoachSession(ctx());
    const { cues } = run(s, 120, () => ({ hr: 189, speedMps: 4.5 }));
    const c = cues.find((x) => x.key === 'safety.hrmax')!;
    expect(c.priority).toBe(1);
    expect(c.haptic).toBe('alert');
  });

  it('ignora lecturas imposibles del sensor', () => {
    const s = new CoachSession(ctx());
    const { cues } = run(s, 120, () => ({ hr: 250, speedMps: 3 }));
    expect(cues.filter((c) => c.category === 'safety')).toHaveLength(0);
  });
});

describe('estructura del entrenamiento', () => {
  it('anuncia pasos, cuenta atrás y final', () => {
    const s = new CoachSession(ctx({ workout: intervals }));
    const { cues } = run(s, 1700, (t, d) => {
      const fast = (d >= 870 && d < 1870) || (d >= 2218 && d < 3218);
      return { hr: fast ? 170 : 140, speedMps: fast ? 3.85 : 2.9 };
    });
    const k = keys(cues);
    for (const key of ['step.0', 'step.end.0', 'step.1', 'step.2', 'step.3', 'step.4', 'step.5', 'step.done']) expect(k).toContain(key);
    expect(cues.find((c) => c.key === 'step.1')!.text).toContain('Serie 1 de 2: 1 kilómetro, a ritmo 4 15 a 4 25');
    expect(cues.find((c) => c.key === 'step.3')!.text).toContain('Es la última');
    // A ritmo objetivo no hay correcciones de ritmo.
    expect(cues.filter((c) => c.category === 'pace')).toHaveLength(0);
  });

  it('corrige el ritmo en las series y lo ajusta por calor', () => {
    const s = new CoachSession(ctx({ workout: intervals }));
    const { cues } = run(s, 500, (t) => ({ hr: t < 300 ? 140 : 170, speedMps: t < 300 ? 2.9 : 4.4 }));
    expect(cues.find((c) => c.key === 'pace.fast')!.text).toContain('objetivo 4 15 a 4 25');

    const hot = new CoachSession(ctx({ workout: intervals, weather: { tempC: 30, humidityPct: 70, windSpeedMps: 0, windFromDeg: 0 } }));
    expect(hot.heatPct).toBeGreaterThan(0.04);
    run(hot, 360, (t) => ({ hr: 140, speedMps: 2.9 }));
    const tp = hot.status().targetPace!;
    expect(tp.min).toBeGreaterThan(255 * 1.04);
  });

  it('pide más ritmo si se queda corto, salvo con el pulso ya alto', () => {
    const slow = new CoachSession(ctx({ workout: intervals }));
    const a = run(slow, 420, (t) => ({ hr: 150, speedMps: t < 300 ? 2.9 : 3.3 }));
    expect(keys(a.cues)).toContain('pace.slow');
  });

  it('lap avanza pasos abiertos', () => {
    const w: Workout = { ...easy, steps: [{ kind: 'warmup', duration: { type: 'open' } }, { kind: 'steady', duration: { type: 'time', seconds: 600 }, target: { hrZone: 3 } }] };
    const s = new CoachSession(ctx({ workout: w }));
    run(s, 100, () => ({ hr: 130, speedMps: 2.8 }));
    expect(s.status().stepIndex).toBe(0);
    expect(keys(s.lap())).toEqual(['step.1']);
    expect(s.status().targetZone).toBe(3);
  });
});

describe('desnivel', () => {
  const route = {
    points: [
      { distM: 0, eleM: 100 },
      { distM: 1000, eleM: 100 },
      { distM: 1600, eleM: 136 },
      { distM: 2600, eleM: 136 },
      { distM: 3100, eleM: 106 },
      { distM: 4000, eleM: 106 },
    ],
  };

  it('anticipa subidas y bajadas del recorrido', () => {
    const s = new CoachSession(ctx({ route, injuries: [knee] }));
    const { cues } = run(s, 1300, () => ({ hr: 130, speedMps: 3 }));
    const climb = cues.find((c) => c.key.startsWith('elev.climb'))!;
    expect(climb.text).toMatch(/empieza una subida de 600 metros al 6 por ciento/);
    expect(climb.atS).toBeLessThan(1000 / 3);
    expect(keys(cues).some((k) => k.startsWith('elev.top'))).toBe(true);
    const down = cues.find((c) => c.key.startsWith('elev.descent'))!;
    expect(down.text).toContain('rodilla derecha');
    expect(down.priority).toBe(2);
  });

  it('sin ruta reacciona al altímetro', () => {
    const s = new CoachSession(ctx());
    const { cues } = run(s, 300, (t, d) => ({ hr: 150, speedMps: 3, altitudeM: 100 + Math.max(0, d - 300) * 0.07 }));
    expect(keys(cues)).toContain('elev.climb.now');
    expect(s.finish().ascentM).toBeGreaterThan(30);
  });
});

describe('lesiones', () => {
  it('limita la zona, pregunta y corta por duración', () => {
    const s = new CoachSession(ctx({ workout: { ...easy, steps: [{ kind: 'steady', duration: { type: 'time', seconds: 3600 }, target: { hrZone: 3 } }] }, injuries: [knee] }));
    const { cues } = run(s, 2500, () => ({ hr: 155, speedMps: 3 }));
    const k = keys(cues);
    expect(s.status().targetZone).toBe(2);
    expect(cues.find((c) => c.key === 'step.0')!.text).toContain('Adaptado por tu lesión');
    expect(cues.find((c) => c.key === 'hr.high')!.text).toContain('lesión');
    expect(k).toContain('injury.check.1');
    expect(k).toContain('injury.duration.soon');
    expect(k).toContain('injury.duration');
  });

  it('reacciona al dolor comunicado', () => {
    const s = new CoachSession(ctx({ injuries: [knee] }));
    run(s, 60, () => ({ hr: 130, speedMps: 3 }));
    expect(s.reportPain(2)[0].text).toContain('Podemos seguir');
    expect(s.reportPain(5)[0].short).toContain('Z1');
    expect(s.status().targetZone).toBe(1);
    expect(s.reportPain(7)[0].short).toContain('PARA');
  });
});

describe('clima, avituallamiento y técnica', () => {
  it('recuerda beber con calor y comer en tiradas largas', () => {
    const long: Workout = { ...easy, type: 'long', steps: [{ kind: 'steady', duration: { type: 'time', seconds: 6000 }, target: { hrZone: 2 } }] };
    const s = new CoachSession(ctx({ workout: long, weather: { tempC: 28, humidityPct: 65, windSpeedMps: 1, windFromDeg: 0 } }));
    const { cues } = run(s, 2700, () => ({ hr: 142, speedMps: 2.8 }));
    const k = keys(cues);
    expect(k).toContain('fuel.drink.1');
    expect(k).toContain('fuel.drink.2');
    expect(k).toContain('fuel.carbs.1');
  });

  it('avisa del viento de cara y luego a favor', () => {
    const s = new CoachSession(ctx({ weather: { tempC: 12, humidityPct: 50, windSpeedMps: 7, windFromDeg: 0 } }));
    const a = run(s, 120, () => ({ hr: 140, speedMps: 3, headingDeg: 10 }));
    expect(a.cues.find((c) => c.key === 'wind.head')!.text).toContain('25 kilómetros por hora');
    const b = run(s, 120, () => ({ hr: 140, speedMps: 3, headingDeg: 180 }), 121, a.dist);
    expect(keys(b.cues)).toContain('wind.tail');
  });

  it('corrige cadencia baja y detecta su caída por fatiga', () => {
    const s = new CoachSession(ctx());
    const a = run(s, 500, () => ({ hr: 140, speedMps: 3, cadence: 158 }));
    expect(a.cues.find((c) => c.key === 'cadence.low')!.text).toContain('hacia 166');
    const s2 = new CoachSession(ctx());
    const b = run(s2, 2100, (t) => ({ hr: 140, speedMps: 3, cadence: t < 1500 ? 174 : 165 }));
    expect(keys(b.cues)).toContain('cadence.fade');
  });

  it('detecta deriva cardíaca', () => {
    const s = new CoachSession(ctx({ workout: { ...easy, steps: [{ kind: 'steady', duration: { type: 'time', seconds: 5400 } }] } }));
    const { cues } = run(s, 3200, (t) => ({ hr: t < 1500 ? 140 : 156, speedMps: 3 }));
    expect(keys(cues)).toContain('drift');
  });
});

describe('competición', () => {
  const race: Workout = { date: '2026-11-15', type: 'race', title: '10K Ciudad', steps: [], race: { distanceM: 10000, targetTimeS: 3000 } };

  it('frena la salida rápida, canta parciales y empuja al final', () => {
    const s = new CoachSession(ctx({ workout: race }));
    expect(s.briefing()[0].text).toContain('a 5 00 de media');
    const a = run(s, 200, () => ({ hr: 165, speedMps: 3.7 })); // 4:30/km, demasiado rápido
    const fast = a.cues.find((c) => c.key === 'pace.fast')!;
    expect(fast.priority).toBe(2);
    expect(fast.text).toContain('demasiado rápido para empezar');
    const b = run(s, 2800, () => ({ hr: 172, speedMps: 3.34 }), 201, a.dist);
    const k = keys(b.cues);
    for (const key of ['split.1', 'split.5', 'race.half', 'race.last20', 'race.lastkm', 'race.sprint', 'race.finish']) expect(k).toContain(key);
    expect(b.cues.find((c) => c.key === 'split.5')!.text).toContain('ventaja');
    // En el tramo final nadie le pide que baje pulsaciones.
    expect(b.cues.filter((c) => c.category === 'hr' && c.atS > 2600)).toHaveLength(0);
  });
});

describe('planificador de avisos', () => {
  it('respeta el silencio mínimo entre indicaciones no críticas', () => {
    const s = new CoachSession(ctx({ workout: easy, verbosity: 'normal', weather: { tempC: 28, humidityPct: 65, windSpeedMps: 7, windFromDeg: 0 } }));
    const { cues } = run(s, 2400, (t) => ({ hr: t % 600 < 300 ? 142 : 166, speedMps: 3, cadence: 156, headingDeg: 0 }));
    expect(cues.length).toBeGreaterThan(10);
    for (let i = 1; i < cues.length; i++) {
      const gap = cues[i].atS - cues[i - 1].atS;
      if (cues[i].priority > 1 && cues[i].category !== 'step') expect(gap).toBeGreaterThanOrEqual(25);
    }
    // Sin repetir eventos puntuales.
    const once = keys(cues).filter((k) => k.startsWith('fuel.') || k.startsWith('split.'));
    expect(new Set(once).size).toBe(once.length);
  });

  it('el resumen final incluye cumplimiento y reposición', () => {
    const s = new CoachSession(ctx({ workout: easy, shoe: { id: 's', name: 'Pegasus', type: 'daily', km: 300 } }));
    run(s, 2400, () => ({ hr: 142, speedMps: 3 }));
    const sum = s.finish();
    expect(sum.distanceM).toBeCloseTo(7200, -2);
    expect(sum.compliancePct).toBeGreaterThan(90);
    expect(sum.timeInZonesS[1]).toBeGreaterThan(2300);
    expect(sum.kcal).toBeCloseTo(518, -1);
    expect(sum.cue.text).toContain('Pegasus suman ya 307');
  });
});

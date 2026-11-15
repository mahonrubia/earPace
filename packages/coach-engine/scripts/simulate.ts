/** Simula una tirada con cuestas, calor y una lesión, e imprime lo que diría el entrenador. */
import { CoachSession, durShort, type CoachContext } from '../src';

const ctx: CoachContext = {
  today: '2026-11-15',
  verbosity: 'normal',
  profile: { name: 'Ana', weightKg: 64, hrMax: 186, hrRest: 48, baselineCadence: 174 },
  workout: {
    date: '2026-11-15',
    type: 'tempo',
    title: 'Tempo progresivo',
    steps: [
      { kind: 'warmup', duration: { type: 'time', seconds: 600 }, target: { hrZone: 2 } },
      { kind: 'steady', duration: { type: 'distance', meters: 5000 }, target: { hrZone: 4, paceSecPerKm: { min: 285, max: 295 } } },
      { kind: 'cooldown', duration: { type: 'time', seconds: 600 }, target: { hrZone: 1 } },
    ],
  },
  plan: { name: 'Media maratón', goal: { name: 'la media de Valencia', date: '2026-12-13', distanceM: 21097, targetTimeS: 6300 }, workouts: [] },
  weather: { tempC: 26, humidityPct: 68, windSpeedMps: 6, windFromDeg: 90, condition: 'clear' },
  terrain: 'road',
  shoe: { id: '1', name: 'Novablast', type: 'daily', km: 655 },
  injuries: [{ id: 'a', area: 'achilles', label: 'tendón de Aquiles izquierdo', status: 'recovering', severity: 1, onset: '2026-10-01', clinicalLog: [{ date: '2026-11-12', note: 'rigidez matutina', painLevel: 1 }] }],
  history: [1, 2, 3, 5, 6, 8, 9, 11, 13, 15, 17, 20, 22, 24, 27].map((d) => ({
    date: new Date(Date.parse('2026-11-15') - d * 86400000).toISOString().slice(0, 10),
    durationMin: d < 7 ? 60 : 45,
    distanceKm: d < 7 ? 11 : 8,
    avgHr: d === 1 ? 165 : 142,
    type: d === 1 ? ('intervals' as const) : ('easy' as const),
  })),
  route: {
    points: [
      { distM: 0, eleM: 20 }, { distM: 3000, eleM: 22 }, { distM: 3700, eleM: 57 }, { distM: 4500, eleM: 60 },
      { distM: 5200, eleM: 25 }, { distM: 9000, eleM: 20 },
    ],
  },
};

const s = new CoachSession(ctx);
const say = (t: number, text: string, short: string) => console.log(`[${durShort(t).padStart(7)}] 🔊 ${text}\n          ⌚ ${short.replace(/\n/g, ' | ')}`);
console.log('── Antes de salir ──');
for (const c of s.briefing()) say(0, c.text, c.short);
console.log('── En carrera ──');
let dist = 0;
for (let t = 0; t <= 2750; t++) {
  const st = s.status();
  const tempo = st.stepKind === 'steady';
  const grade = st.grade ?? 0;
  // Corredora algo impaciente: sale fuerte en el tempo y sufre la cuesta.
  let speed = tempo ? (t < 900 ? 3.75 : 3.42) : 2.75;
  speed /= 1 + Math.max(0, grade) * 4;
  const hr = (tempo ? 168 + Math.max(0, grade) * 250 + (t - 600) / 300 : t < 600 ? 128 + t / 60 : 138) + Math.sin(t / 20) * 2;
  const heading = dist < 4500 ? 90 : 270;
  for (const c of s.update({ t, distanceM: dist, hr, speedMps: speed, cadence: tempo ? 176 : 168, headingDeg: heading })) say(t, c.text, c.short);
  dist += speed;
}
console.log('── Final ──');
const sum = s.finish();
say(sum.durationS, sum.cue.text, sum.cue.short);
console.log(sum.timeInZonesS, `cumplimiento ${sum.compliancePct}%`);

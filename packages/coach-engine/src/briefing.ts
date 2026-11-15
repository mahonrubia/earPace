import { compass, distSpeech, durSpeech, kmh, paceSpeech, pct } from './format';
import {
  computeReadiness,
  daysBetween,
  heatAdjustment,
  restrictionsOf,
  shoeMaxKm,
  TERRAIN_FACTOR,
  type Readiness,
} from './physiology';
import { flattenWorkout, isHardWorkout, plannedDurationS } from './plan';
import { findSegments, totalAscent } from './route';
import type { CoachContext, Cue, CueCategory, Haptic, Injury, Terrain, Workout } from './types';

type Draft = Omit<Cue, 'atS'>;
const cue = (
  key: string,
  category: CueCategory,
  priority: Cue['priority'],
  text: string,
  short: string,
  haptic: Haptic = 'none',
): Draft => ({ key, category, priority, text, short, haptic });

const TERRAIN_NAME: Record<Terrain, string> = {
  road: 'asfalto',
  track: 'pista',
  treadmill: 'cinta',
  gravel: 'tierra compacta',
  grass: 'hierba',
  trail: 'sendero',
  technical_trail: 'sendero técnico',
  snow: 'nieve',
  sand: 'arena',
};

function describeWorkout(w: Workout): string {
  if (w.race) {
    const t = w.race.targetTimeS;
    return `Hoy compites: ${w.title}, ${distSpeech(w.race.distanceM)}${
      t ? `, con objetivo de ${durSpeech(t)}, a ${paceSpeech(t / (w.race.distanceM / 1000))} de media` : ''
    }.`;
  }
  const steps = flattenWorkout(w);
  const work = steps.filter((s) => s.kind === 'work');
  let structure = '';
  if (work.length > 1) {
    const d = work[0].duration;
    const each = d.type === 'time' ? durSpeech(d.seconds) : d.type === 'distance' ? distSpeech(d.meters) : '';
    const z = work[0].target?.hrZone;
    const p = work[0].target?.paceSecPerKm;
    structure = ` ${work.length} series de ${each}${p ? ` a ${paceSpeech((p.min + p.max) / 2)}` : z ? ` en zona ${z}` : ''}.`;
  } else if (steps.length) {
    const main = steps.find((s) => s.kind === 'steady' || s.kind === 'work') ?? steps[0];
    const z = main.target?.hrZone;
    const p = main.target?.paceSecPerKm;
    if (p) structure = ` Ritmo objetivo entre ${paceSpeech(p.min)} y ${paceSpeech(p.max)}.`;
    else if (z) structure = ` Objetivo: zona ${z}.`;
  }
  return `Hoy toca ${w.title}, unos ${durSpeech(Math.round(plannedDurationS(w) / 300) * 300)}.${structure}`;
}

function readinessText(r: Readiness, hard: boolean): Draft | null {
  const reasons: string[] = [];
  if (r.acwr !== undefined && r.acwr > 1.3) reasons.push('has subido mucho la carga esta semana');
  if (r.daysSinceRest >= 6) reasons.push(`llevas ${r.daysSinceRest} días seguidos sin descansar`);
  if (r.hardYesterday) reasons.push('ayer hiciste una sesión exigente');
  if (r.poorSleep) reasons.push('has dormido poco');
  if (r.lowHrv) reasons.push('tu variabilidad cardíaca está baja');
  const why = reasons.length ? ` porque ${reasons.join(' y ')}` : '';
  if (r.level === 'overreached')
    return cue(
      'brief.load',
      'load',
      2,
      `Ojo, llegas muy cargado${why}. ${hard ? 'Te recomiendo cambiar la sesión por un rodaje suave o recortar las series a la mitad.' : 'Hoy muy suave y sin alargar.'}`,
      'MUY CARGADO\nRebaja la sesión',
      'double',
    );
  if (r.level === 'fatigued')
    return cue(
      'brief.load',
      'load',
      3,
      `Llegas algo cansado${why}. ${hard ? 'Haz la sesión, pero si la primera serie cuesta más de lo normal, quita una o dos repeticiones.' : 'Mantén el esfuerzo realmente fácil.'}`,
      'ALGO CANSADO\nSin forzar',
    );
  if (r.level === 'fresh' && hard)
    return cue('brief.load', 'load', 4, 'Llegas fresco y descansado. Buen día para cumplir la sesión con calidad.', 'FRESCO\nA por ello');
  return null;
}

function injuryBrief(injuries: Injury[], workout?: Workout): Draft[] {
  const out: Draft[] = [];
  const open = injuries.filter((i) => i.status !== 'recovered').sort((a, b) => b.severity - a.severity);
  for (const inj of open) {
    const r = restrictionsOf(inj);
    const limits: string[] = [];
    if (r.maxZone) limits.push(`no pases de zona ${r.maxZone}`);
    if (r.maxDurationMin) limits.push(`máximo ${r.maxDurationMin} minutos`);
    if (r.avoidDownhill) limits.push('cuidado en las bajadas');
    if (r.avoidHardSurface) limits.push('mejor superficie blanda');
    const last = inj.clinicalLog?.[inj.clinicalLog.length - 1];
    const pain = last?.painLevel !== undefined ? ` En tu último registro el dolor era ${last.painLevel} sobre 10.` : '';
    const conflict =
      workout && r.avoidSpeedWork && isHardWorkout(workout) && !workout.race
        ? ' La sesión de hoy es intensa y no encaja con tu lesión: te la adaptaré a esfuerzo suave.'
        : '';
    out.push(
      cue(
        `brief.injury.${inj.id}`,
        'injury',
        2,
        `Tengo en cuenta tu ${inj.label}, ${inj.status === 'active' ? 'todavía activa' : 'en recuperación'}: ${limits.join(', ') || 've con sensaciones'}.${pain}${conflict} Si el dolor pasa de 3 sobre 10 o te cambia la pisada, paramos.`,
        `LESIÓN: ${inj.label.slice(0, 16)}\n${r.maxZone ? `Máx Z${r.maxZone}` : 'Con cuidado'}`,
        'short',
      ),
    );
  }
  // Recaídas: misma zona lesionada dos o más veces.
  const byArea = new Map<string, number>();
  for (const i of injuries) byArea.set(i.area, (byArea.get(i.area) ?? 0) + 1);
  const recent = injuries.find(
    (i) => i.status === 'recovered' && (byArea.get(i.area) ?? 0) >= 2 && !open.some((o) => o.area === i.area),
  );
  if (recent)
    out.push(
      cue(
        'brief.injury.recurrent',
        'injury',
        3,
        `Recuerda que tu ${recent.label} ya te ha dado guerra más de una vez. Calienta bien y vigila las primeras molestias.`,
        'ZONA RECURRENTE\nCalienta bien',
      ),
    );
  return out;
}

/** Charla previa a la salida: todo lo que un entrenador te diría antes de empezar. */
export function buildBriefing(ctx: CoachContext, today: string): Draft[] {
  const out: Draft[] = [];
  const { profile, workout, weather, route, shoe } = ctx;
  const terrain = ctx.terrain ?? 'road';
  const hard = workout ? isHardWorkout(workout) : false;

  if (workout) {
    let text = describeWorkout(workout);
    const goal = ctx.plan?.goal;
    if (goal && !workout.race) {
      const d = daysBetween(today, goal.date);
      if (d > 0) text += ` Faltan ${d} días para ${goal.name}.`;
    }
    if (workout.race)
      text += ' Sal controlado: los dos primeros kilómetros un punto por debajo de tu ritmo, y la carrera empieza en la segunda mitad.';
    out.push(cue('brief.workout', 'briefing', 2, text, workout.title.slice(0, 40), 'short'));
  } else {
    out.push(
      cue('brief.workout', 'briefing', 3, 'Carrera libre. Te iré avisando de pulso, cadencia y terreno.', 'CARRERA LIBRE'),
    );
  }

  const readiness = computeReadiness(ctx.history, profile, today, ctx.recovery);
  const rt = readinessText(readiness, hard);
  if (rt) out.push(rt);

  if (weather) {
    const heat = heatAdjustment(weather);
    let text = `${Math.round(weather.tempC)} grados y ${Math.round(weather.humidityPct)} por ciento de humedad`;
    if (weather.windSpeedMps >= 3)
      text += `, viento del ${compass(weather.windFromDeg)} a ${kmh(weather.windSpeedMps)} kilómetros por hora`;
    text += '.';
    let priority: Cue['priority'] = 4;
    let short = `${Math.round(weather.tempC)}°C · ${Math.round(weather.humidityPct)}% HR`;
    if (heat.extreme) {
      priority = 1;
      text += ' Calor extremo: no es día para forzar. Acorta la sesión, busca sombra y agua, o pásala a primera hora.';
      short = 'CALOR EXTREMO\nAcorta y bebe';
    } else if (heat.pct >= 0.02) {
      priority = 2;
      const p = workout && flattenWorkout(workout).find((s) => s.target?.paceSecPerKm)?.target?.paceSecPerKm;
      text += ` Con este calor ajusto tus ritmos un ${pct(heat.pct)} por ciento${
        p ? `, unos ${Math.round(((p.min + p.max) / 2) * heat.pct)} segundos más lento por kilómetro` : ''
      }. Guíate por pulso y bebe a menudo.`;
      short = `CALOR: ritmos +${pct(heat.pct)}%`;
    } else if (weather.tempC <= 3) {
      priority = 3;
      text += ' Hace frío: alarga el calentamiento y protege manos y cabeza.';
    }
    if (weather.condition === 'storm') {
      priority = 1;
      text += ' Hay tormenta: evita zonas abiertas y arbolado, valora aplazar la salida.';
      short = 'TORMENTA\nValora aplazar';
    } else if (weather.condition === 'rain' || (weather.precipitationMm ?? 0) > 0.5) {
      priority = Math.min(priority, 3) as Cue['priority'];
      text += ' Suelo mojado: cuidado en curvas, pintura y tapas metálicas.';
    }
    if (weather.windSpeedMps >= 7 && !heat.extreme) {
      priority = Math.min(priority, 3) as Cue['priority'];
      text += ' Con el viento de cara mantén el esfuerzo, no el ritmo; lo recuperarás con el viento a favor.';
    }
    out.push(cue('brief.weather', 'weather', priority, text, short, priority <= 2 ? 'double' : 'none'));
  }

  if (route && route.points.length > 1) {
    const { ascentM, descentM } = totalAscent(route.points);
    const length = route.points[route.points.length - 1].distM;
    const climbs = findSegments(route).filter((s) => s.kind === 'climb');
    let text = `El recorrido tiene ${distSpeech(length)} con ${ascentM} metros de subida y ${descentM} de bajada.`;
    if (climbs.length) {
      const big = [...climbs].sort((a, b) => b.gainM - a.gainM)[0];
      text += ` ${climbs.length === 1 ? 'Hay una subida importante' : `Hay ${climbs.length} subidas importantes`}; la más dura empieza en el kilómetro ${(big.startM / 1000).toFixed(1).replace('.', ',')}: ${distSpeech(big.lengthM)} al ${pct(big.grade)} por ciento. Te avisaré antes de cada una.`;
    } else if (ascentM < length * 0.005) text += ' Prácticamente llano.';
    out.push(cue('brief.route', 'elevation', 3, text, `+${ascentM} m / -${descentM} m`));
  }

  if (terrain !== 'road' && terrain !== 'track' && terrain !== 'treadmill') {
    const f = TERRAIN_FACTOR[terrain];
    out.push(
      cue(
        'brief.terrain',
        'pace',
        4,
        `Corres sobre ${TERRAIN_NAME[terrain]}: cuento con ritmos un ${pct(f - 1)} por ciento más lentos que en asfalto. Pasos cortos y mirada adelante.`,
        `${TERRAIN_NAME[terrain].toUpperCase()}\nritmos +${pct(f - 1)}%`,
      ),
    );
  }

  if (shoe) {
    const max = shoeMaxKm(shoe, profile.weightKg);
    const used = shoe.km / max;
    const injured = (ctx.injuries ?? []).some((i) => i.status !== 'recovered');
    if (used >= 1)
      out.push(
        cue(
          'brief.shoe.worn',
          'shoe',
          injured ? 2 : 3,
          `Tus ${shoe.name} llevan ${Math.round(shoe.km)} kilómetros y ya han superado su vida útil de unos ${max}. ${injured ? 'Con una lesión abierta, cámbialas ya: la amortiguación gastada te está cargando de más.' : 'Ve pensando en jubilarlas; hoy mejor superficie blanda.'}`,
          `ZAPATILLAS ${Math.round(shoe.km)} km\nCámbialas`,
          'short',
        ),
      );
    else if (used >= 0.85)
      out.push(
        cue(
          'brief.shoe.near',
          'shoe',
          4,
          `Tus ${shoe.name} llevan ${Math.round(shoe.km)} de unos ${max} kilómetros. Les queda poco; empieza a alternarlas con el par nuevo.`,
          `ZAPATILLAS ${Math.round(used * 100)}% uso`,
        ),
      );
    const trailTerrain = terrain === 'trail' || terrain === 'technical_trail' || terrain === 'snow';
    if (trailTerrain && shoe.type !== 'trail')
      out.push(
        cue(
          'brief.shoe.terrain',
          'shoe',
          3,
          `Llevas ${shoe.name}, que son de asfalto, para un terreno de ${TERRAIN_NAME[terrain]}. Tendrás menos agarre: baja con precaución.`,
          'ZAPATILLA DE ASFALTO\nPoco agarre',
        ),
      );
    else if (!trailTerrain && shoe.type === 'trail' && terrain !== 'gravel' && terrain !== 'grass')
      out.push(
        cue('brief.shoe.terrain', 'shoe', 4, `Llevas zapatillas de trail en ${TERRAIN_NAME[terrain]}: son más duras y pesadas, no te obsesiones con el ritmo.`, 'TRAIL EN ASFALTO'),
      );
    if (shoe.type === 'racing' && workout && !hard)
      out.push(
        cue('brief.shoe.racing', 'shoe', 4, 'Llevas las de competir en un día suave. Guárdalas para las sesiones de calidad y te durarán más.', 'RESERVA LAS VOLADORAS'),
      );
  }

  out.push(...injuryBrief(ctx.injuries ?? [], workout));

  const wh = [...(profile.weightHistory ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (wh.length >= 3) {
    const last = wh[wh.length - 1];
    const prev = wh.slice(-8, -1);
    const avg = prev.reduce((s, e) => s + e.kg, 0) / prev.length;
    if (daysBetween(last.date, today) <= 2 && last.kg < avg * 0.98)
      out.push(
        cue(
          'brief.weight',
          'fuel',
          3,
          `Tu peso ha bajado ${(avg - last.kg).toFixed(1).replace('.', ',')} kilos respecto a tu media reciente. Puede ser deshidratación: bebe antes de salir y durante la sesión.`,
          'PESO BAJO\nHidrátate',
        ),
      );
  }
  return out;
}

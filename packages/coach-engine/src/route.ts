import type { Route, RoutePoint } from './types';

export interface Segment {
  kind: 'climb' | 'descent';
  startM: number;
  endM: number;
  lengthM: number;
  /** Desnivel con signo (m). */
  gainM: number;
  /** Pendiente media con signo (fracción). */
  grade: number;
}

/** Remuestrea el perfil a pasos regulares para estabilizar pendientes. */
export function resample(points: RoutePoint[], stepM = 50): RoutePoint[] {
  const pts = [...points].sort((a, b) => a.distM - b.distM);
  if (pts.length < 2) return pts;
  const out: RoutePoint[] = [];
  let j = 0;
  const end = pts[pts.length - 1].distM;
  for (let d = pts[0].distM; d <= end; d += stepM) {
    while (j < pts.length - 2 && pts[j + 1].distM < d) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const t = b.distM === a.distM ? 0 : (d - a.distM) / (b.distM - a.distM);
    out.push({ distM: d, eleM: a.eleM + Math.min(1, Math.max(0, t)) * (b.eleM - a.eleM) });
  }
  return out;
}

export function totalAscent(points: RoutePoint[], fromM = 0): { ascentM: number; descentM: number } {
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].distM <= fromM) continue;
    const d = points[i].eleM - points[i - 1].eleM;
    if (d > 0) ascentM += d;
    else descentM -= d;
  }
  return { ascentM: Math.round(ascentM), descentM: Math.round(descentM) };
}

/** Pendiente del recorrido en un punto kilométrico (ventana de ±50 m). */
export function gradeAt(points: RoutePoint[], distM: number, windowM = 100): number | undefined {
  if (points.length < 2) return undefined;
  const ele = (d: number) => {
    if (d <= points[0].distM) return points[0].eleM;
    for (let i = 1; i < points.length; i++) {
      if (points[i].distM >= d) {
        const a = points[i - 1];
        const b = points[i];
        return a.eleM + ((d - a.distM) / (b.distM - a.distM || 1)) * (b.eleM - a.eleM);
      }
    }
    return points[points.length - 1].eleM;
  };
  return (ele(distM + windowM / 2) - ele(distM - windowM / 2)) / windowM;
}

/**
 * Detecta subidas (≥ minGrade) y bajadas (≤ −minGrade) relevantes.
 * Une tramos del mismo signo separados por respiros cortos.
 */
export function findSegments(route: Route, minGrade = 0.035, minLengthM = 150): Segment[] {
  const pts = resample(route.points);
  const raw: Segment[] = [];
  let cur: { kind: 'climb' | 'descent'; start: number; gain: number; end: number } | null = null;
  const flush = () => {
    if (cur) {
      const lengthM = cur.end - cur.start;
      raw.push({ kind: cur.kind, startM: cur.start, endM: cur.end, lengthM, gainM: cur.gain, grade: cur.gain / (lengthM || 1) });
    }
    cur = null;
  };
  for (let i = 1; i < pts.length; i++) {
    const len = pts[i].distM - pts[i - 1].distM;
    const dz = pts[i].eleM - pts[i - 1].eleM;
    const g = dz / (len || 1);
    const kind = g >= minGrade ? 'climb' : g <= -minGrade ? 'descent' : null;
    if (kind && cur && cur.kind === kind) {
      cur.end = pts[i].distM;
      cur.gain += dz;
    } else {
      flush();
      if (kind) cur = { kind, start: pts[i - 1].distM, end: pts[i].distM, gain: dz };
    }
  }
  flush();
  // Fusiona tramos del mismo tipo separados por menos de 100 m.
  const merged: Segment[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.kind === s.kind && s.startM - last.endM <= 100) {
      last.endM = s.endM;
      last.gainM += s.gainM;
      last.lengthM = last.endM - last.startM;
      last.grade = last.gainM / last.lengthM;
    } else merged.push({ ...s });
  }
  return merged.filter((s) => s.lengthM >= minLengthM);
}

import type { Route, RoutePoint } from './types';

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Rumbo inicial de un punto a otro (grados, 0 = norte). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Convierte un GPX (track o ruta con elevación) en un perfil distancia/altitud. */
export function parseGpx(xml: string): Route {
  const name = /<name>([^<]*)<\/name>/.exec(xml)?.[1]?.trim();
  const points: RoutePoint[] = [];
  const re = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g;
  let m: RegExpExecArray | null;
  let dist = 0;
  let prev: { lat: number; lon: number } | undefined;
  while ((m = re.exec(xml))) {
    const lat = Number(/lat="([^"]+)"/.exec(m[1])?.[1]);
    const lon = Number(/lon="([^"]+)"/.exec(m[1])?.[1]);
    const ele = Number(/<ele>([^<]+)<\/ele>/.exec(m[2])?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(ele)) continue;
    if (prev) dist += haversineM(prev.lat, prev.lon, lat, lon);
    prev = { lat, lon };
    points.push({ distM: dist, eleM: ele });
  }
  if (points.length < 2) throw new Error('El GPX no contiene puntos con elevación');
  return { name, points };
}

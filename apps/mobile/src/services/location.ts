import { bearingDeg, haversineM, type LiveSample } from '@pinganillo/coach-engine';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const TASK = 'pinganillo-run-location';

type Listener = (points: Location.LocationObject[]) => void;
let listener: Listener | null = null;

// La tarea debe definirse al cargar el módulo: el sistema la despierta en segundo plano.
TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error || !data) return;
  listener?.((data as { locations: Location.LocationObject[] }).locations);
});

/**
 * Mantiene la app viva durante la carrera (servicio en primer plano en Android,
 * modo ubicación en iOS) y entrega posiciones GPS.
 */
export async function startTracking(onPoints: Listener): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  // Sin permiso "siempre" sigue funcionando gracias al servicio en primer plano.
  await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
  listener = onPoints;
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 0,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Pinganillo te está guiando',
      notificationBody: 'Carrera en curso',
      notificationColor: '#FF5A1F',
    },
  });
  return true;
}

export async function stopTracking() {
  listener = null;
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK);
}

/** Convierte posiciones GPS del móvil en muestras para el entrenador (cuando no hay reloj). */
export class PhoneGpsSource {
  private startMs = 0;
  private pausedMs = 0;
  private pauseStart: number | null = null;
  private dist = 0;
  private prev: Location.LocationObject | undefined;
  private heading: number | undefined;

  pause() {
    this.pauseStart ??= Date.now();
    this.prev = undefined;
  }

  resume() {
    if (this.pauseStart !== null) this.pausedMs += Date.now() - this.pauseStart;
    this.pauseStart = null;
  }

  next(p: Location.LocationObject): LiveSample | undefined {
    if (this.pauseStart !== null) return undefined;
    if ((p.coords.accuracy ?? 0) > 30) return undefined; // posición poco fiable
    if (!this.startMs) this.startMs = p.timestamp;
    let speed = p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed : undefined;
    if (this.prev) {
      const d = haversineM(this.prev.coords.latitude, this.prev.coords.longitude, p.coords.latitude, p.coords.longitude);
      const dt = (p.timestamp - this.prev.timestamp) / 1000;
      if (dt <= 0) return undefined;
      if (d / dt > 9) return undefined; // salto de GPS
      if (d > 1.5) {
        this.dist += d;
        if (d > 4) this.heading = bearingDeg(this.prev.coords.latitude, this.prev.coords.longitude, p.coords.latitude, p.coords.longitude);
      }
      speed ??= d / dt;
    }
    this.prev = p;
    return {
      t: Math.round((p.timestamp - this.startMs - this.pausedMs) / 1000),
      distanceM: this.dist,
      speedMps: speed,
      altitudeM: p.coords.altitude ?? undefined,
      headingDeg: p.coords.heading !== null && p.coords.heading >= 0 ? p.coords.heading : this.heading,
    };
  }
}

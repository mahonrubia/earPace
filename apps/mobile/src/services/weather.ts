import type { Weather } from '@pinganillo/coach-engine';
import * as Location from 'expo-location';

function conditionOf(code: number): Weather['condition'] {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  return code >= 2 ? 'cloudy' : 'clear';
}

/** Clima actual en la posición del corredor (Open-Meteo, sin clave ni registro). */
export async function fetchWeather(): Promise<Weather | undefined> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return undefined;
  const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const { latitude, longitude } = pos.coords;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}` +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code&wind_speed_unit=ms';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Clima no disponible (${res.status})`);
  const cur = (await res.json()).current;
  return {
    tempC: cur.temperature_2m,
    humidityPct: cur.relative_humidity_2m,
    windSpeedMps: cur.wind_speed_10m,
    windFromDeg: cur.wind_direction_10m,
    precipitationMm: cur.precipitation,
    condition: conditionOf(cur.weather_code),
  };
}

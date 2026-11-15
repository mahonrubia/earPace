import { buildBriefing, computeReadiness, parseGpx, totalAscent, workoutForDate, type CoachContext, type Terrain, type Weather } from '@pinganillo/coach-engine';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React from 'react';
import { notify } from '../dialog';
import { ActivityIndicator } from 'react-native';
import { run, type SourceKind } from '../run';
import { garmin } from '../services/garmin';
import { fetchWeather } from '../services/weather';
import { todayIso, useStore } from '../store';
import { c } from '../theme';
import { Button, Card, Chips, Dim, Field, H1, H2, P, num } from '../ui';

const TERRAINS: Array<{ value: Terrain; label: string }> = [
  { value: 'road', label: 'Asfalto' },
  { value: 'track', label: 'Pista' },
  { value: 'gravel', label: 'Tierra' },
  { value: 'trail', label: 'Sendero' },
  { value: 'technical_trail', label: 'Técnico' },
  { value: 'grass', label: 'Hierba' },
  { value: 'sand', label: 'Arena' },
  { value: 'treadmill', label: 'Cinta' },
];

const READY = { fresh: ['Fresco', c.ok], normal: ['Normal', c.text], fatigued: ['Cansado', c.warn], overreached: ['Muy cargado', c.bad] } as const;

export function TodayScreen() {
  const { data, update } = useStore();
  const today = todayIso();
  const workout = workoutForDate(data.plan, today);
  const [weather, setWeather] = React.useState<Weather>();
  const [loadingWx, setLoadingWx] = React.useState(false);
  const [source, setSource] = React.useState<SourceKind>(garmin.available && data.settings.device ? 'watch' : 'phone');
  const [starting, setStarting] = React.useState(false);

  const loadWeather = React.useCallback(() => {
    setLoadingWx(true);
    fetchWeather()
      .then(setWeather)
      .catch(() => setWeather(undefined))
      .finally(() => setLoadingWx(false));
  }, []);
  React.useEffect(loadWeather, [loadWeather]);

  const shoe = data.shoes.find((s) => s.id === data.activeShoeId);
  const ctx: CoachContext = {
    profile: data.profile,
    workout: workout?.type === 'rest' ? undefined : workout,
    plan: data.plan,
    shoe,
    injuries: data.injuries,
    history: data.history,
    recovery: data.recovery,
    weather,
    terrain: data.terrain,
    route: data.route,
    today,
    verbosity: data.settings.verbosity,
  };
  const readiness = computeReadiness(data.history, data.profile, today, data.recovery);
  const briefing = buildBriefing(ctx, today);

  const importGpx = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/gpx+xml', 'text/xml', 'application/xml', '*/*'], copyToCacheDirectory: true });
    if (res.canceled) return;
    try {
      const route = parseGpx(await new File(res.assets[0].uri).text());
      update((d) => ({ ...d, route: { ...route, name: route.name ?? res.assets[0].name } }));
    } catch (e: any) {
      notify('No se pudo leer el GPX', e?.message ?? 'Archivo no válido');
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      await run.prepare(ctx, data.settings, source);
    } catch (e: any) {
      notify('No se pudo preparar la carrera', e?.message ?? 'Error desconocido');
      run.reset();
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <H1>Hoy</H1>
      <Card>
        <Dim>{workout ? 'SESIÓN DEL PLAN' : 'SIN SESIÓN PLANIFICADA'}</Dim>
        <H2 style={{ fontSize: 22, marginTop: 4 }}>{workout?.type === 'rest' ? 'Descanso' : (workout?.title ?? 'Carrera libre')}</H2>
        {workout?.description ? <P>{workout.description}</P> : null}
        <P style={{ color: READY[readiness.level][1] }}>
          Estado: {READY[readiness.level][0]}
          {readiness.acwr !== undefined ? ` · carga 7d/28d ${readiness.acwr.toFixed(2).replace('.', ',')}` : ''}
        </P>
        <Field label="Horas de sueño esta noche" numeric suffix="h" value={data.recovery.lastSleepHours} onChange={(v) => update((d) => ({ ...d, recovery: { ...d.recovery, lastSleepHours: num(v) } }))} />
      </Card>

      <Card>
        <H2>Condiciones</H2>
        {loadingWx ? (
          <ActivityIndicator color={c.accent} />
        ) : weather ? (
          <P>
            {Math.round(weather.tempC)} °C · {Math.round(weather.humidityPct)} % humedad · viento {Math.round(weather.windSpeedMps * 3.6)} km/h
          </P>
        ) : (
          <Dim>Sin datos de clima (revisa el permiso de ubicación y la conexión).</Dim>
        )}
        <Button kind="ghost" title="Actualizar clima" onPress={loadWeather} />
        <Dim style={{ marginTop: 12 }}>Terreno</Dim>
        <Chips options={TERRAINS} value={data.terrain} onChange={(terrain) => update((d) => ({ ...d, terrain }))} />
        <Dim style={{ marginTop: 6 }}>Zapatillas</Dim>
        {data.shoes.length ? (
          <Chips options={data.shoes.map((s) => ({ value: s.id, label: `${s.name} · ${Math.round(s.km)} km` }))} value={data.activeShoeId ?? ''} onChange={(activeShoeId) => update((d) => ({ ...d, activeShoeId }))} />
        ) : (
          <Dim>Añade tus zapatillas en la pestaña Corredor.</Dim>
        )}
        <Dim style={{ marginTop: 6 }}>Recorrido</Dim>
        {data.route ? (
          <P>
            {data.route.name ?? 'Ruta'} · {(data.route.points[data.route.points.length - 1].distM / 1000).toFixed(1).replace('.', ',')} km · +{totalAscent(data.route.points).ascentM} m
          </P>
        ) : (
          <Dim>Sin recorrido: te avisaré de las cuestas según el altímetro.</Dim>
        )}
        <Button kind="ghost" title={data.route ? 'Cambiar recorrido (GPX)' : 'Cargar recorrido (GPX)'} onPress={importGpx} />
        {data.route ? <Button kind="ghost" title="Quitar recorrido" onPress={() => update((d) => ({ ...d, route: undefined }))} /> : null}
      </Card>

      <Card>
        <H2>Lo que te diré antes de salir</H2>
        {briefing.map((b) => (
          <P key={b.key} style={{ marginBottom: 8, color: b.priority <= 2 ? c.text : c.dim }}>
            {b.text}
          </P>
        ))}
      </Card>

      <Card>
        <H2>¿De dónde tomo los datos?</H2>
        <Chips
          options={[
            { value: 'watch', label: 'Reloj Garmin' },
            { value: 'phone', label: 'GPS del móvil' },
            { value: 'demo', label: 'Demo' },
          ]}
          value={source}
          onChange={setSource}
        />
        {source === 'watch' && !garmin.available ? <Dim>El enlace con Garmin necesita la app instalada desde la tienda o una compilación de desarrollo (no funciona en Expo Go).</Dim> : null}
        {source === 'watch' && garmin.available && !data.settings.device ? <Dim>Elige tu reloj en Ajustes.</Dim> : null}
        {source === 'phone' ? <Dim>Sin reloj no hay pulso ni cadencia: te guiaré por ritmo, desnivel y tiempo.</Dim> : null}
        {source === 'demo' ? <Dim>Corredor simulado a 5× para probar las indicaciones.</Dim> : null}
        <Button title={starting ? 'Preparando…' : 'Preparar carrera'} onPress={start} disabled={starting || (source === 'watch' && (!garmin.available || !data.settings.device))} />
      </Card>
    </>
  );
}

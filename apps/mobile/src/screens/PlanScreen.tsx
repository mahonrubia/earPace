import { buildSamplePlan, daysBetween, validatePlan, type Workout } from '@earpace/coach-engine';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React from 'react';
import { notify } from '../dialog';
import { View } from 'react-native';
import { todayIso, useStore } from '../store';
import { c } from '../theme';
import { Button, Card, Dim, Field, H1, H2, P, Row, num } from '../ui';

const TYPE: Record<string, string> = { easy: 'Suave', recovery: 'Recuperación', long: 'Larga', tempo: 'Tempo', intervals: 'Series', hills: 'Cuestas', race: 'Competición', rest: 'Descanso' };

export function PlanScreen() {
  const { data, update } = useStore();
  const today = todayIso();
  const [race, setRace] = React.useState({ name: '', date: '', km: undefined as number | undefined, min: undefined as number | undefined });

  const importPlan = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
    if (res.canceled) return;
    try {
      const { plan, error } = validatePlan(JSON.parse(await new File(res.assets[0].uri).text()));
      if (!plan) return notify('Plan no válido', error);
      update((d) => ({ ...d, plan }));
    } catch {
      notify('Plan no válido', 'El archivo no es un JSON legible.');
    }
  };

  const addRace = () => {
    if (!race.name || !/^\d{4}-\d{2}-\d{2}$/.test(race.date) || !race.km) return notify('Faltan datos', 'Indica nombre, fecha (AAAA-MM-DD) y distancia.');
    const distanceM = Math.round(race.km * 1000);
    const targetTimeS = race.min ? Math.round(race.min * 60) : undefined;
    const w: Workout = { date: race.date, type: 'race', title: race.name, steps: [], race: { distanceM, targetTimeS } };
    update((d) => {
      const plan = d.plan ?? { name: 'Mi plan', workouts: [] };
      return { ...d, plan: { ...plan, goal: { name: race.name, date: race.date, distanceM, targetTimeS }, workouts: [...plan.workouts.filter((x) => x.date !== race.date), w].sort((a, b) => a.date.localeCompare(b.date)) } };
    });
    setRace({ name: '', date: '', km: undefined, min: undefined });
  };

  const upcoming = (data.plan?.workouts ?? []).filter((w) => w.date >= today).slice(0, 21);
  const goal = data.plan?.goal;

  return (
    <>
      <H1>Plan</H1>
      {goal ? (
        <Card>
          <Dim>OBJETIVO</Dim>
          <H2 style={{ fontSize: 20, marginTop: 4 }}>{goal.name}</H2>
          <P>
            {(goal.distanceM / 1000).toFixed(1).replace('.', ',')} km · {goal.date}
            {goal.targetTimeS ? ` · ${Math.floor(goal.targetTimeS / 3600)}h ${Math.round((goal.targetTimeS % 3600) / 60)}min` : ''}
          </P>
          <Dim>{daysBetween(today, goal.date) >= 0 ? `Faltan ${daysBetween(today, goal.date)} días` : 'Ya pasó'}</Dim>
        </Card>
      ) : null}

      <Card>
        <H2>{data.plan?.name ?? 'Sin plan cargado'}</H2>
        {upcoming.length ? (
          upcoming.map((w) => (
            <Row key={w.date + w.title} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Dim style={{ width: 86, color: w.date === today ? c.accent : c.dim }}>{w.date === today ? 'HOY' : w.date.slice(5).split('-').reverse().join('/')}</Dim>
              <View style={{ flex: 1 }}>
                <P>{w.title}</P>
                <Dim>{TYPE[w.type] ?? w.type}</Dim>
              </View>
            </Row>
          ))
        ) : (
          <Dim>Carga tu plan para que cada día sepa qué te toca y hacia qué objetivo vas.</Dim>
        )}
        <Button title="Importar plan (JSON)" onPress={importPlan} />
        <Button kind="ghost" title="Usar plan de ejemplo (4 semanas)" onPress={() => update((d) => ({ ...d, plan: buildSamplePlan(today, d.profile.thresholdPaceSecPerKm ?? 300, d.plan?.goal) }))} />
        {data.plan ? <Button kind="ghost" title="Borrar plan" onPress={() => update((d) => ({ ...d, plan: undefined }))} /> : null}
      </Card>

      <Card>
        <H2>Añadir competición</H2>
        <Field label="Nombre" value={race.name} onChange={(name) => setRace((r) => ({ ...r, name }))} placeholder="10K de mi ciudad" />
        <Row>
          <Field label="Fecha" value={race.date} onChange={(date) => setRace((r) => ({ ...r, date }))} placeholder="AAAA-MM-DD" />
          <Field label="Distancia" numeric suffix="km" value={race.km} onChange={(v) => setRace((r) => ({ ...r, km: num(v) }))} />
        </Row>
        <Field label="Tiempo objetivo (opcional)" numeric suffix="min" value={race.min} onChange={(v) => setRace((r) => ({ ...r, min: num(v) }))} />
        <Button title="Añadir al plan" onPress={addRace} />
        <Dim style={{ marginTop: 8 }}>El día de la carrera te marcaré el ritmo por kilómetro, frenaré la salida y te empujaré al final.</Dim>
      </Card>
    </>
  );
}

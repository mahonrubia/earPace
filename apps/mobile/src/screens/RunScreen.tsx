import { durShort, paceShort } from '@earpace/coach-engine';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { confirm } from '../dialog';
import { run, useRun } from '../run';
import { todayIso, useStore } from '../store';
import { c } from '../theme';
import { Button, Card, Dim, H1, H2, P, Row } from '../ui';

const PRIORITY_COLOR = ['', c.bad, c.warn, c.text, c.dim];

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.metric}>
      <Text style={[s.metricValue, color ? { color } : null]}>{value}</Text>
      <Dim>{label}</Dim>
    </View>
  );
}

export function RunScreen() {
  const r = useRun();
  const { data, update } = useStore();
  const st = r.status;
  const last = r.cues[0];

  const confirmFinish = () => confirm('¿Terminar la carrera?', 'Terminar', () => run.finish());

  const save = () => {
    const sum = r.summary;
    if (sum && sum.distanceM > 200) {
      const km = sum.distanceM / 1000;
      update((d) => ({
        ...d,
        history: [...d.history, { date: todayIso(), durationMin: Math.round(sum.durationS / 60), distanceKm: Math.round(km * 100) / 100, avgHr: sum.avgHr }].slice(-200),
        shoes: d.shoes.map((sh) => (sh.id === d.activeShoeId ? { ...sh, km: Math.round((sh.km + km) * 10) / 10 } : sh)),
      }));
    }
    run.reset();
  };

  if (r.phase === 'finished' && r.summary) {
    const sum = r.summary;
    const total = sum.timeInZonesS.reduce((a, b) => a + b, 0) || 1;
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <H1>Resumen</H1>
        <Card>
          <Row style={{ flexWrap: 'wrap' }}>
            <Metric label="km" value={(sum.distanceM / 1000).toFixed(2).replace('.', ',')} />
            <Metric label="tiempo" value={durShort(sum.durationS)} />
            <Metric label="min/km" value={sum.avgPaceSecPerKm ? paceShort(sum.avgPaceSecPerKm) : '–'} />
            <Metric label="FC media" value={sum.avgHr ? String(sum.avgHr) : '–'} />
            <Metric label="cadencia" value={sum.avgCadence ? String(sum.avgCadence) : '–'} />
            <Metric label="desnivel +" value={`${sum.ascentM} m`} />
            <Metric label="kcal" value={String(sum.kcal)} />
            <Metric label="en objetivo" value={sum.compliancePct !== undefined ? `${sum.compliancePct} %` : '–'} />
          </Row>
        </Card>
        <Card>
          <H2>Tiempo en zonas</H2>
          {sum.timeInZonesS.map((sec, i) => (
            <Row key={i} style={{ marginBottom: 6 }}>
              <Text style={{ color: c.zones[i + 1], width: 28, fontWeight: '700' }}>Z{i + 1}</Text>
              <View style={{ flex: 1, height: 10, backgroundColor: c.bg, borderRadius: 5 }}>
                <View style={{ width: `${(sec / total) * 100}%`, height: 10, borderRadius: 5, backgroundColor: c.zones[i + 1] }} />
              </View>
              <Dim style={{ width: 52, textAlign: 'right' }}>{durShort(sec)}</Dim>
            </Row>
          ))}
        </Card>
        <Card>
          <P>{sum.cue.text}</P>
        </Card>
        <Button title="Guardar en mi historial" onPress={save} />
        <Button kind="ghost" title="Descartar" onPress={() => run.reset()} />
      </ScrollView>
    );
  }

  const zoneColor = st?.zone !== undefined ? c.zones[st.zone] : c.text;
  const target = st?.targetPace ? `${paceShort(st.targetPace.min)}–${paceShort(st.targetPace.max)} /km` : st?.targetHr ? `Z${st.targetZone} · ${st.targetHr.min}–${st.targetHr.max} ppm` : 'Libre';
  const rem = st?.stepRemaining ? (st.stepRemaining.type === 'time' ? durShort(Math.max(0, st.stepRemaining.value)) : `${Math.max(0, Math.round(st.stepRemaining.value))} m`) : undefined;

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Dim>{r.title.toUpperCase()}</Dim>
      <Text style={s.clock}>{durShort(r.sample?.t ?? 0)}</Text>
      <Row style={{ flexWrap: 'wrap' }}>
        <Metric label={st?.zone ? `ppm · Z${st.zone}` : 'ppm'} value={st?.hr ? String(Math.round(st.hr)) : '–'} color={zoneColor} />
        <Metric label="min/km" value={st?.paceSecPerKm ? paceShort(st.paceSecPerKm) : '–'} />
        <Metric label="km" value={((r.sample?.distanceM ?? 0) / 1000).toFixed(2).replace('.', ',')} />
        <Metric label="cadencia" value={st?.cadence ? String(Math.round(st.cadence)) : '–'} />
      </Row>
      <Card style={{ marginTop: 12 }}>
        <Dim>
          OBJETIVO{st && st.stepCount > 0 ? ` · paso ${Math.min(st.stepIndex + 1, st.stepCount)} de ${st.stepCount}` : ''}
          {rem ? ` · quedan ${rem}` : ''}
        </Dim>
        <H2 style={{ fontSize: 22, marginTop: 4 }}>{target}</H2>
        {st?.grade !== undefined && Math.abs(st.grade) >= 0.02 ? <Dim>Pendiente {(st.grade * 100).toFixed(0)} %</Dim> : null}
      </Card>

      <Card style={{ borderColor: last ? PRIORITY_COLOR[last.priority] : c.line, minHeight: 96 }}>
        <Dim>ENTRENADOR</Dim>
        <P style={{ fontSize: 18, lineHeight: 25, marginTop: 4 }}>
          {last?.text ?? (r.phase === 'ready' ? (r.source === 'watch' ? 'Abre EarPace en tu reloj y pulsa START cuando quieras.' : 'Cuando quieras, pulsa Empezar.') : 'Todo en orden. Te aviso cuando haga falta.')}
        </P>
      </Card>

      {r.source === 'watch' ? (
        <Dim style={{ marginBottom: 8 }}>Reloj: {r.watchLink === 'CONNECTED' ? 'conectado · controlas la carrera desde el reloj' : `sin conexión (${r.watchLink})`}</Dim>
      ) : null}

      {r.phase === 'ready' && r.source !== 'watch' ? <Button title="Empezar" onPress={() => run.begin()} /> : null}
      {r.phase === 'running' && r.source !== 'watch' ? <Button kind="ghost" title="Pausa" onPress={() => run.pause()} /> : null}
      {r.phase === 'paused' && r.source !== 'watch' ? <Button title="Reanudar" onPress={() => run.begin()} /> : null}
      {r.phase !== 'ready' ? (
        <>
          <Button kind="ghost" title="Vuelta / siguiente paso" onPress={() => run.lap()} />
          <Dim style={{ marginTop: 14 }}>¿Notas dolor?</Dim>
          <Row>
            <View style={{ flex: 1 }}>
              <Button kind="ghost" title="Leve" onPress={() => run.pain(2)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="ghost" title="Moderado" onPress={() => run.pain(5)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="ghost" title="Fuerte" onPress={() => run.pain(7)} />
            </View>
          </Row>
          <Button kind="danger" title="Terminar" onPress={confirmFinish} />
        </>
      ) : (
        <Button kind="ghost" title="Cancelar" onPress={() => run.reset()} />
      )}

      {r.phase === 'ready' && r.briefing.length ? (
        <Card style={{ marginTop: 16 }}>
          <H2>Antes de salir</H2>
          {r.briefing.map((b) => (
            <P key={b.key} style={{ marginBottom: 8 }}>
              {b.text}
            </P>
          ))}
        </Card>
      ) : null}

      {r.cues.length > 1 ? (
        <Card style={{ marginTop: 16 }}>
          <H2>Historial</H2>
          {r.cues.slice(1, 15).map((cue, i) => (
            <Dim key={`${cue.key}-${cue.atS}-${i}`} style={{ marginBottom: 6, color: PRIORITY_COLOR[cue.priority] }}>
              {durShort(cue.atS)} · {cue.text}
            </Dim>
          ))}
        </Card>
      ) : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  clock: { color: c.text, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], marginVertical: 4 },
  metric: { width: '47%', backgroundColor: c.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: c.line, marginBottom: 8 },
  metricValue: { color: c.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

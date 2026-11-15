import { paceShort, restrictionsOf, shoeMaxKm, zonesOf, type Injury, type InjuryArea, type InjuryStatus, type ShoeType } from '@earpace/coach-engine';
import React from 'react';
import { notify } from '../dialog';
import { Text, View } from 'react-native';
import { todayIso, useStore } from '../store';
import { c } from '../theme';
import { Button, Card, Chips, Dim, Field, H1, H2, P, Row, num } from '../ui';

const SHOE_TYPES: Array<{ value: ShoeType; label: string }> = [
  { value: 'daily', label: 'Diario' },
  { value: 'tempo', label: 'Ritmo' },
  { value: 'racing', label: 'Competición' },
  { value: 'trail', label: 'Trail' },
  { value: 'recovery', label: 'Recuperación' },
];

const AREAS: Array<{ value: InjuryArea; label: string }> = [
  { value: 'knee', label: 'Rodilla' },
  { value: 'achilles', label: 'Aquiles' },
  { value: 'plantar', label: 'Fascia plantar' },
  { value: 'shin', label: 'Tibia' },
  { value: 'calf', label: 'Gemelo' },
  { value: 'hamstring', label: 'Isquios' },
  { value: 'quad', label: 'Cuádriceps' },
  { value: 'itband', label: 'Cintilla' },
  { value: 'hip', label: 'Cadera' },
  { value: 'ankle', label: 'Tobillo' },
  { value: 'foot', label: 'Pie' },
  { value: 'back', label: 'Espalda' },
  { value: 'other', label: 'Otra' },
];

const STATUS: Array<{ value: InjuryStatus; label: string }> = [
  { value: 'active', label: 'Activa' },
  { value: 'recovering', label: 'Recuperándose' },
  { value: 'recovered', label: 'Recuperada' },
];

const id = () => Math.random().toString(36).slice(2, 10);
const parsePace = (v: string) => {
  const m = /^(\d+)[:.,'](\d{1,2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

export function RunnerScreen() {
  const { data, update } = useStore();
  const p = data.profile;
  const zones = zonesOf(p);
  const setProfile = (patch: Partial<typeof p>) => update((d) => ({ ...d, profile: { ...d.profile, ...patch } }));

  const [shoe, setShoe] = React.useState({ name: '', type: 'daily' as ShoeType, km: 0 });
  const [inj, setInj] = React.useState({ label: '', area: 'knee' as InjuryArea, status: 'active' as InjuryStatus, severity: 1 as 1 | 2 | 3 });
  const [note, setNote] = React.useState<Record<string, { note: string; pain?: number }>>({});

  const setWeight = (v: string) => {
    const kg = num(v);
    if (!kg) return;
    update((d) => ({ ...d, profile: { ...d.profile, weightKg: kg, weightHistory: [...(d.profile.weightHistory ?? []).filter((w) => w.date !== todayIso()), { date: todayIso(), kg }].slice(-60) } }));
  };

  const patchInjury = (injId: string, fn: (i: Injury) => Injury) => update((d) => ({ ...d, injuries: d.injuries.map((i) => (i.id === injId ? fn(i) : i)) }));

  return (
    <>
      <H1>Corredor</H1>
      <Card>
        <H2>Perfil</H2>
        <Row>
          <Field label="Peso" numeric suffix="kg" value={p.weightKg} onChange={setWeight} />
          <Field label="Edad" numeric value={p.age} onChange={(v) => setProfile({ age: num(v) })} />
        </Row>
        <Row>
          <Field label="FC máxima" numeric suffix="ppm" value={p.hrMax} onChange={(v) => num(v) && setProfile({ hrMax: num(v)!, hrZones: undefined })} />
          <Field label="FC reposo" numeric suffix="ppm" value={p.hrRest} onChange={(v) => setProfile({ hrRest: num(v), hrZones: undefined })} />
        </Row>
        <Row>
          <Field label="Cadencia habitual" numeric suffix="p/min" value={p.baselineCadence} onChange={(v) => setProfile({ baselineCadence: num(v) })} />
          <Field label="Ritmo umbral" suffix="/km" placeholder="4:45" value={p.thresholdPaceSecPerKm ? paceShort(p.thresholdPaceSecPerKm) : undefined} onChange={(v) => setProfile({ thresholdPaceSecPerKm: parsePace(v) })} />
        </Row>
        <Dim>Zonas de frecuencia cardíaca {p.hrZones ? '(tomadas de tu Garmin)' : '(calculadas; al conectar el reloj uso las de Garmin)'}</Dim>
        <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {zones.map((z, i) => (
            <View key={i} style={{ borderRadius: 8, borderWidth: 1, borderColor: c.zones[i + 1], paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: c.zones[i + 1], fontWeight: '700', fontSize: 12 }}>
                Z{i + 1} {z.min}–{z.max}
              </Text>
            </View>
          ))}
        </Row>
      </Card>

      <Card>
        <H2>Zapatillas</H2>
        {data.shoes.map((sh) => {
          const max = shoeMaxKm(sh, p.weightKg);
          const used = Math.min(1, sh.km / max);
          return (
            <View key={sh.id} style={{ marginBottom: 12 }}>
              <Row>
                <P style={{ flex: 1 }}>
                  {sh.name} <Dim>· {SHOE_TYPES.find((t) => t.value === sh.type)?.label}</Dim>
                </P>
                <Dim onPress={() => update((d) => ({ ...d, shoes: d.shoes.filter((x) => x.id !== sh.id) }))}>Quitar</Dim>
              </Row>
              <View style={{ height: 8, backgroundColor: c.bg, borderRadius: 4, marginVertical: 4 }}>
                <View style={{ width: `${used * 100}%`, height: 8, borderRadius: 4, backgroundColor: used >= 1 ? c.bad : used >= 0.85 ? c.warn : c.ok }} />
              </View>
              <Dim>
                {Math.round(sh.km)} de ~{max} km
              </Dim>
            </View>
          );
        })}
        <Field label="Modelo" value={shoe.name} onChange={(name) => setShoe((s) => ({ ...s, name }))} placeholder="Pegasus 41" />
        <Chips options={SHOE_TYPES} value={shoe.type} onChange={(type) => setShoe((s) => ({ ...s, type }))} />
        <Field label="Kilómetros que llevan" numeric suffix="km" value={shoe.km} onChange={(v) => setShoe((s) => ({ ...s, km: num(v) ?? 0 }))} />
        <Button
          title="Añadir zapatillas"
          onPress={() => {
            if (!shoe.name) return notify('Indica el modelo');
            const newId = id();
            update((d) => ({ ...d, shoes: [...d.shoes, { id: newId, ...shoe }], activeShoeId: d.activeShoeId ?? newId }));
            setShoe({ name: '', type: 'daily', km: 0 });
          }}
        />
      </Card>

      <Card>
        <H2>Lesiones</H2>
        <Dim style={{ marginBottom: 8 }}>Registra las actuales y las pasadas, con su evolución. Adapto zonas, duración y avisos en bajadas según cada una.</Dim>
        {data.injuries.map((i) => {
          const r = restrictionsOf(i);
          const limits = [r.maxZone ? `máx. Z${r.maxZone}` : '', r.maxDurationMin ? `máx. ${r.maxDurationMin} min` : '', r.avoidDownhill ? 'cuidado en bajadas' : '', r.avoidSpeedWork ? 'sin series' : ''].filter(Boolean).join(' · ');
          const draft = note[i.id] ?? { note: '' };
          return (
            <View key={i.id} style={{ borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 10 }}>
              <Row>
                <P style={{ flex: 1, fontWeight: '700' }}>{i.label}</P>
                <Dim onPress={() => update((d) => ({ ...d, injuries: d.injuries.filter((x) => x.id !== i.id) }))}>Borrar</Dim>
              </Row>
              <Dim>
                Desde {i.onset}
                {i.recoveredOn ? ` hasta ${i.recoveredOn}` : ''} · gravedad {i.severity}/3
              </Dim>
              <Chips options={STATUS} value={i.status} onChange={(status) => patchInjury(i.id, (x) => ({ ...x, status, recoveredOn: status === 'recovered' ? todayIso() : undefined }))} />
              {limits ? <Dim style={{ color: c.warn }}>Hoy te limito: {limits}</Dim> : null}
              {(i.clinicalLog ?? []).slice(-4).map((l, k) => (
                <Dim key={k}>
                  {l.date}
                  {l.painLevel !== undefined ? ` · dolor ${l.painLevel}/10` : ''} · {l.note}
                </Dim>
              ))}
              <Row style={{ marginTop: 6 }}>
                <Field label="Evolución (nota)" value={draft.note} onChange={(v) => setNote((n) => ({ ...n, [i.id]: { ...draft, note: v } }))} placeholder="Fisio, sensaciones…" />
                <View style={{ width: 90 }}>
                  <Field label="Dolor 0-10" numeric value={draft.pain} onChange={(v) => setNote((n) => ({ ...n, [i.id]: { ...draft, pain: num(v) } }))} />
                </View>
              </Row>
              <Button
                kind="ghost"
                title="Añadir a la evolución"
                onPress={() => {
                  if (!draft.note && draft.pain === undefined) return;
                  patchInjury(i.id, (x) => ({ ...x, clinicalLog: [...(x.clinicalLog ?? []), { date: todayIso(), note: draft.note || 'Sin nota', painLevel: draft.pain }] }));
                  setNote((n) => ({ ...n, [i.id]: { note: '' } }));
                }}
              />
            </View>
          );
        })}
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
          <Field label="Nueva lesión" value={inj.label} onChange={(label) => setInj((s) => ({ ...s, label }))} placeholder="tendinitis rotuliana derecha" />
          <Chips options={AREAS} value={inj.area} onChange={(area) => setInj((s) => ({ ...s, area }))} />
          <Chips options={STATUS} value={inj.status} onChange={(status) => setInj((s) => ({ ...s, status }))} />
          <Chips
            options={[
              { value: '1', label: 'Leve' },
              { value: '2', label: 'Moderada' },
              { value: '3', label: 'Grave' },
            ]}
            value={String(inj.severity)}
            onChange={(v) => setInj((s) => ({ ...s, severity: Number(v) as 1 | 2 | 3 }))}
          />
          <Button
            title="Añadir lesión"
            onPress={() => {
              if (!inj.label) return notify('Describe la lesión');
              update((d) => ({ ...d, injuries: [...d.injuries, { id: id(), ...inj, onset: todayIso(), recoveredOn: inj.status === 'recovered' ? todayIso() : undefined }] }));
              setInj({ label: '', area: 'knee', status: 'active', severity: 1 });
            }}
          />
        </View>
      </Card>
    </>
  );
}

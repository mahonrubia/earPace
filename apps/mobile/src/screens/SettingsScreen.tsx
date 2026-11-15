import type { Verbosity } from '@earpace/coach-engine';
import React from 'react';
import { notify } from '../dialog';
import { Platform, Switch, View } from 'react-native';
import { run, useRun } from '../run';
import { garmin, type GarminDevice } from '../services/garmin';
import { prepareVoice, say } from '../services/speech';
import { useStore, type Settings } from '../store';
import { c } from '../theme';
import { Button, Card, Chips, Dim, H1, H2, P, Row } from '../ui';

const VERBOSITY: Array<{ value: Verbosity; label: string }> = [
  { value: 'minimal', label: 'Solo lo importante' },
  { value: 'normal', label: 'Normal' },
  { value: 'detailed', label: 'Todo' },
];

export function SettingsScreen() {
  const { data, update } = useStore();
  const r = useRun();
  const st = data.settings;
  const set = (patch: Partial<Settings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const [devices, setDevices] = React.useState<GarminDevice[]>([]);
  const [busy, setBusy] = React.useState(false);

  const search = async () => {
    setBusy(true);
    try {
      const init = await garmin.init();
      if (!init.ok) return notify('Garmin no disponible', init.error);
      let list = await garmin.devices();
      if (!list.length && Platform.OS === 'ios') {
        await garmin.pickDevice(); // abre Garmin Connect; al volver se actualiza la lista
        return;
      }
      setDevices(list);
      if (!list.length) notify('Sin relojes', 'Empareja tu reloj en Garmin Connect y vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    const sub = garmin.onSdk((status) => {
      if (status === 'devices') garmin.devices().then(setDevices);
    });
    return () => sub?.remove();
  }, []);

  const choose = async (d: GarminDevice) => {
    const next = { ...st, device: { id: d.id, name: d.name } };
    set({ device: next.device });
    const status = await run.connectWatch(next);
    if (status !== 'CONNECTED') notify('Reloj guardado', 'Ahora mismo no está conectado. Se enlazará al preparar la carrera.');
  };

  return (
    <>
      <H1>Ajustes</H1>
      <Card>
        <H2>Voz (auriculares)</H2>
        <Row>
          <P style={{ flex: 1 }}>Indicaciones por audio</P>
          <Switch value={st.voice} onValueChange={(voice) => set({ voice })} trackColor={{ true: c.accent }} />
        </Row>
        <Dim>Suenan por los auriculares conectados al móvil y bajan el volumen de tu música mientras hablo.</Dim>
        <Dim style={{ marginTop: 10 }}>Velocidad</Dim>
        <Chips
          options={[
            { value: '0.9', label: 'Pausada' },
            { value: '1', label: 'Normal' },
            { value: '1.15', label: 'Rápida' },
          ]}
          value={String(st.voiceRate)}
          onChange={(v) => set({ voiceRate: Number(v) })}
        />
        <Dim style={{ marginTop: 6 }}>¿Cuánto quieres que hable?</Dim>
        <Chips options={VERBOSITY} value={st.verbosity} onChange={(verbosity) => set({ verbosity })} />
        <Button
          kind="ghost"
          title="Probar voz"
          onPress={async () => {
            await prepareVoice(st.voiceRate);
            say({ text: 'Hola, soy tu entrenador. Vas a 5 12, pulso 148, en zona 2. Sigue así.', priority: 1 });
          }}
        />
      </Card>

      <Card>
        <H2>Reloj Garmin</H2>
        <Row>
          <P style={{ flex: 1 }}>Indicaciones en el reloj</P>
          <Switch value={st.watch} onValueChange={(watch) => set({ watch })} trackColor={{ true: c.accent }} />
        </Row>
        {garmin.available ? (
          <>
            <P style={{ marginTop: 8 }}>
              {st.device ? `${st.device.name} · ${r.watchLink === 'CONNECTED' ? 'conectado' : 'no conectado'}` : 'Ningún reloj elegido'}
            </P>
            {devices.map((d) => (
              <Button key={d.id} kind="ghost" title={`${d.name}${d.connected ? ' · conectado' : ''}`} onPress={() => choose(d)} />
            ))}
            <Button title={busy ? 'Buscando…' : 'Buscar mi reloj'} onPress={search} disabled={busy} />
            <Button kind="ghost" title="Instalar la app en el reloj (Connect IQ)" onPress={() => garmin.openStore()} />
            <Dim style={{ marginTop: 8 }}>Necesitas Garmin Connect instalado y el reloj emparejado. Al conectar, tomo de tu Garmin las zonas de pulso, el peso y el pulso en reposo.</Dim>
          </>
        ) : (
          <Dim style={{ marginTop: 8 }}>El enlace con Garmin solo está en la app instalada desde la tienda o en una compilación de desarrollo. Aquí puedes usar el GPS del móvil o la demo.</Dim>
        )}
      </Card>

      <Card>
        <H2>Aviso</H2>
        <Dim>
          EarPace orienta tu entrenamiento, no sustituye a un médico ni a un fisioterapeuta. Si notas dolor en el pecho, mareo o un dolor que empeora al correr, para y consulta a un profesional.
        </Dim>
        <View style={{ height: 4 }} />
      </Card>
    </>
  );
}

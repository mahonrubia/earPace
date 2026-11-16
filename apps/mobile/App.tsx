import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { DialogHost } from './src/dialog';
import { run, useRun } from './src/run';
import { PlanScreen } from './src/screens/PlanScreen';
import { RunnerScreen } from './src/screens/RunnerScreen';
import { RunScreen } from './src/screens/RunScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { StoreProvider, todayIso, useStore } from './src/store';
import { c } from './src/theme';

const TABS = [
  { key: 'today', label: 'Hoy', Screen: TodayScreen },
  { key: 'plan', label: 'Plan', Screen: PlanScreen },
  { key: 'runner', label: 'Corredor', Screen: RunnerScreen },
  { key: 'settings', label: 'Ajustes', Screen: SettingsScreen },
] as const;

function Shell() {
  const { ready, data, update } = useStore();
  const r = useRun();
  const [tab, setTab] = React.useState<(typeof TABS)[number]['key']>('today');

  // El reloj envía al abrirse las zonas, el peso y el pulso en reposo configurados en Garmin.
  React.useEffect(() => {
    run.wire();
    run.onWatchProfile = (p) =>
      update((d) => ({
        ...d,
        profile: {
          ...d.profile,
          hrZones: p.zones ?? d.profile.hrZones,
          hrMax: p.hrMax ?? d.profile.hrMax,
          hrRest: p.hrRest ?? d.profile.hrRest,
          weightKg: p.weightKg ?? d.profile.weightKg,
          weightHistory: p.weightKg ? [...(d.profile.weightHistory ?? []).filter((w) => w.date !== todayIso()), { date: todayIso(), kg: p.weightKg }].slice(-60) : d.profile.weightHistory,
        },
      }));
    return () => {
      run.onWatchProfile = null;
    };
  }, [update]);

  // Reconecta con el reloj guardado para recibir su perfil aunque aún no haya carrera.
  const device = data.settings.device;
  React.useEffect(() => {
    if (ready && device) run.connectWatch(data.settings).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, device?.id]);

  if (!ready) return <View style={s.root} />;
  if (r.phase !== 'idle')
    return (
      <SafeAreaView style={s.root}>
        <RunScreen />
      </SafeAreaView>
    );

  const Screen = TABS.find((t) => t.key === tab)!.Screen;
  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Screen />
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={s.tab} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Text style={[s.tabText, tab === t.key && { color: c.accent }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <Shell />
        <DialogHost />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 32 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.card },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { color: c.dim, fontWeight: '700', fontSize: 13 },
});

import React from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { c } from './theme';

/**
 * Avisos y confirmaciones. En el móvil se usa el diálogo del sistema. En web se dibujan
 * dentro de la app, porque alert() y confirm() del navegador pueden estar bloqueados
 * (por ejemplo, al abrir la app incrustada en otra página).
 */
interface Dialog {
  title: string;
  message?: string;
  yes?: { label: string; onPress: () => void };
}

let current: Dialog | null = null;
const subs = new Set<() => void>();
const show = (d: Dialog | null) => {
  current = d;
  subs.forEach((fn) => fn());
};

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') show({ title, message });
  else Alert.alert(title, message);
}

export function confirm(title: string, yes: string, onYes: () => void) {
  if (Platform.OS === 'web') show({ title, yes: { label: yes, onPress: onYes } });
  else
    Alert.alert(title, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: yes, style: 'destructive', onPress: onYes },
    ]);
}

/** Va una sola vez en la raíz de la app. */
export function DialogHost() {
  const d = React.useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => current,
  );
  if (!d) return null;
  const close = () => show(null);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.box} accessibilityRole="alert">
          <Text style={s.title}>{d.title}</Text>
          {d.message ? <Text style={s.message}>{d.message}</Text> : null}
          <View style={s.row}>
            {d.yes ? (
              <Pressable style={[s.btn, s.ghost]} onPress={close} accessibilityRole="button">
                <Text style={s.btnText}>Cancelar</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[s.btn, d.yes ? s.danger : s.primary]}
              accessibilityRole="button"
              onPress={() => {
                close();
                d.yes?.onPress();
              }}
            >
              <Text style={s.btnText}>{d.yes?.label ?? 'Entendido'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { width: '100%', maxWidth: 380, backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 20 },
  title: { color: c.text, fontSize: 18, fontWeight: '700' },
  message: { color: c.dim, fontSize: 15, lineHeight: 21, marginTop: 8 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primary: { backgroundColor: c.accent },
  danger: { backgroundColor: c.bad },
  ghost: { borderWidth: 1, borderColor: c.line },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextProps, type ViewProps } from 'react-native';
import { c } from './theme';

export const Card = ({ style, ...p }: ViewProps) => <View {...p} style={[s.card, style]} />;
export const H1 = ({ style, ...p }: TextProps) => <Text {...p} style={[s.h1, style]} />;
export const H2 = ({ style, ...p }: TextProps) => <Text {...p} style={[s.h2, style]} />;
export const P = ({ style, ...p }: TextProps) => <Text {...p} style={[s.p, style]} />;
export const Dim = ({ style, ...p }: TextProps) => <Text {...p} style={[s.dim, style]} />;
export const Row = ({ style, ...p }: ViewProps) => <View {...p} style={[s.row, style]} />;

export function Button({ title, onPress, kind = 'primary', disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, (pressed || disabled) && { opacity: 0.5 }]}
    >
      <Text style={[s.btnText, kind === 'ghost' && { color: c.text }]}>{title}</Text>
    </Pressable>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.chips}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, value === o.value && s.chipOn]}>
          <Text style={[s.chipText, value === o.value && { color: '#fff' }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Campo numérico o de texto con etiqueta. Guarda según se escribe. */
export function Field({ label, value, onChange, numeric, suffix, placeholder }: { label: string; value: string | number | undefined; onChange: (v: string) => void; numeric?: boolean; suffix?: string; placeholder?: string }) {
  const [text, setText] = React.useState(value === undefined ? '' : String(value));
  const focused = React.useRef(false);
  // Mientras se escribe no se pisa el texto con el valor ya interpretado ("7," → 7).
  React.useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldBox}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={(v) => {
            setText(v);
            onChange(v.trim());
          }}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setText(value === undefined ? '' : String(value));
          }}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
          placeholder={placeholder}
          placeholderTextColor={c.dim}
        />
        {suffix ? <Text style={s.dim}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export const num = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v !== '' && Number.isFinite(n) ? n : undefined;
};

const s = StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.line },
  h1: { color: c.text, fontSize: 26, fontWeight: '800', marginBottom: 12 },
  h2: { color: c.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  p: { color: c.text, fontSize: 15, lineHeight: 21 },
  dim: { color: c.dim, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btn: { backgroundColor: c.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', marginTop: 8 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.line },
  btnDanger: { backgroundColor: c.bad },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: c.line },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { color: c.dim, fontSize: 13, fontWeight: '600' },
  field: { flex: 1, minWidth: 120, marginBottom: 10 },
  fieldLabel: { color: c.dim, fontSize: 12, marginBottom: 4 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.line, paddingHorizontal: 10 },
  input: { flex: 1, color: c.text, fontSize: 16, paddingVertical: 9 },
});

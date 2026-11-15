import { Alert, Platform } from 'react-native';

/** Alert.alert no existe en web: se usa el diálogo del navegador. */
export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirm(title: string, yes: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(title) ?? true) onYes();
  } else
    Alert.alert(title, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: yes, style: 'destructive', onPress: onYes },
    ]);
}

import type { Cue } from '@earpace/coach-engine';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

let pending = 0;
let rate = 1;

/** Voz por encima de la música (la atenúa) y también con el móvil bloqueado. */
export async function prepareVoice(voiceRate: number) {
  rate = voiceRate;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: true });
  } catch {
    // Sin modo de audio configurable (p. ej. web): la voz sigue funcionando en primer plano.
  }
}

/**
 * Dice una indicación. Las críticas cortan lo que se esté diciendo; las normales
 * se descartan si ya hay cola, porque un consejo que llega tarde ya no sirve.
 */
export function say(cue: Pick<Cue, 'text' | 'priority'>) {
  if (cue.priority === 1) {
    Speech.stop();
    pending = 0;
  } else if (pending >= 2) return;
  pending++;
  const done = () => {
    pending = Math.max(0, pending - 1);
  };
  Speech.speak(cue.text, { language: 'es-ES', rate, onDone: done, onStopped: done, onError: done });
}

export function hush() {
  Speech.stop();
  pending = 0;
}

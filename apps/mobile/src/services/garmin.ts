import { GarminLinkNative, type GarminDevice } from '../../modules/garmin-link';
import { WATCH_APP_ID } from '../config';

export type { GarminDevice };
export type WatchMessage = Record<string, any> & { k?: string };

/** Enlace con la app del reloj. Todo es no-op si el módulo nativo no está (Expo Go, web). */
export const garmin = {
  available: GarminLinkNative != null,

  async init(): Promise<{ ok: boolean; error?: string }> {
    if (!GarminLinkNative) return { ok: false, error: 'Módulo Garmin no incluido en esta compilación' };
    try {
      await GarminLinkNative.initialize();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Garmin Connect no está instalado o actualizado' };
    }
  },

  devices: async (): Promise<GarminDevice[]> => (GarminLinkNative ? GarminLinkNative.getDevices() : []),

  /** iOS: abre Garmin Connect para elegir reloj. Android: no hace falta. */
  pickDevice: async () => GarminLinkNative?.pickDevice?.(),

  connect: async (device: { id: string; name: string }) => (GarminLinkNative ? GarminLinkNative.connect(device.id, device.name, WATCH_APP_ID) : 'UNAVAILABLE'),

  send: async (message: object) => (GarminLinkNative ? GarminLinkNative.send(JSON.stringify(message)) : 'UNAVAILABLE'),

  openApp: async () => GarminLinkNative?.openApp(),
  openStore: async () => GarminLinkNative?.openStore(WATCH_APP_ID),

  onMessage(cb: (m: WatchMessage) => void) {
    return GarminLinkNative?.addListener('onMessage', (e) => {
      try {
        cb(JSON.parse(e.json));
      } catch {
        // mensaje mal formado: se ignora
      }
    });
  },

  onStatus(cb: (status: string) => void) {
    return GarminLinkNative?.addListener('onDeviceStatus', (e) => cb(e.status));
  },

  onSdk(cb: (status: string) => void) {
    return GarminLinkNative?.addListener('onSdkStatus', (e) => cb(e.status));
  },
};

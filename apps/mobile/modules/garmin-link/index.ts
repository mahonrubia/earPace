import { requireOptionalNativeModule } from 'expo';

export interface GarminDevice {
  id: string;
  name: string;
  connected: boolean;
}

type Sub = { remove(): void };

interface Native {
  initialize(): Promise<boolean>;
  getDevices(): Promise<GarminDevice[]>;
  /** Solo iOS: abre Garmin Connect para elegir reloj. */
  pickDevice?(): Promise<void>;
  connect(deviceId: string, deviceName: string, appId: string): Promise<string>;
  send(json: string): Promise<string>;
  openApp(): Promise<string>;
  openStore(appId: string): Promise<boolean>;
  addListener(event: 'onMessage', cb: (e: { json: string }) => void): Sub;
  addListener(event: 'onDeviceStatus', cb: (e: { id: string; status: string }) => void): Sub;
  addListener(event: 'onSdkStatus', cb: (e: { status: string; error?: string }) => void): Sub;
}

/** null en Expo Go, web o simulador sin el módulo nativo: la app funciona igual con el GPS del móvil. */
export const GarminLinkNative = requireOptionalNativeModule<Native>('GarminLink');

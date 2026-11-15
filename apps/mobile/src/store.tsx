import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AthleteProfile, Injury, PastActivity, RecoveryInfo, Route, Shoe, Terrain, TrainingPlan, Verbosity } from '@pinganillo/coach-engine';
import React from 'react';

export interface Settings {
  voice: boolean;
  watch: boolean;
  verbosity: Verbosity;
  voiceRate: number;
  /** Reloj Garmin elegido. */
  device?: { id: string; name: string };
}

export interface AppData {
  profile: AthleteProfile;
  shoes: Shoe[];
  activeShoeId?: string;
  injuries: Injury[];
  plan?: TrainingPlan;
  history: PastActivity[];
  recovery: RecoveryInfo;
  terrain: Terrain;
  route?: Route;
  settings: Settings;
}

const DEFAULTS: AppData = {
  profile: { weightKg: 70, hrMax: 185, hrRest: 55 },
  shoes: [],
  injuries: [],
  history: [],
  recovery: {},
  terrain: 'road',
  settings: { voice: true, watch: true, verbosity: 'normal', voiceRate: 1 },
};

const KEY = 'pinganillo.data.v1';

interface Store {
  data: AppData;
  ready: boolean;
  update: (fn: (d: AppData) => AppData) => void;
}

const Ctx = React.createContext<Store>({ data: DEFAULTS, ready: false, update: () => {} });
export const useStore = () => React.useContext(Ctx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = React.useState<AppData>(DEFAULTS);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as Partial<AppData>;
          setData({ ...DEFAULTS, ...saved, settings: { ...DEFAULTS.settings, ...saved.settings } });
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const update = React.useCallback((fn: (d: AppData) => AppData) => {
    setData((prev) => {
      const next = fn(prev);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ data, ready, update }}>{children}</Ctx.Provider>;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

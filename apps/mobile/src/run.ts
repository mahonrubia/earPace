import {
  CoachSession,
  profileFromWatch,
  sampleFromWatch,
  watchConfig,
  watchCue,
  watchStatus,
  type CoachContext,
  type CoachStatus,
  type Cue,
  type LiveSample,
  type RunSummary,
  type WatchProfile,
} from '@earpace/coach-engine';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React from 'react';
import { garmin, type WatchMessage } from './services/garmin';
import { PhoneGpsSource, startTracking, stopTracking } from './services/location';
import { hush, prepareVoice, say } from './services/speech';
import type { Settings } from './store';

export type Phase = 'idle' | 'ready' | 'running' | 'paused' | 'finished';
export type SourceKind = 'watch' | 'phone' | 'demo';

export interface RunState {
  phase: Phase;
  source: SourceKind;
  briefing: Cue[];
  cues: Cue[];
  status?: CoachStatus;
  sample?: LiveSample;
  summary?: RunSummary;
  watchLink: string;
  title: string;
}

const IDLE: RunState = { phase: 'idle', source: 'phone', briefing: [], cues: [], watchLink: 'UNKNOWN', title: '' };

/** Orquesta una carrera: fuente de datos → entrenador → voz y reloj. */
class RunManager {
  private state: RunState = IDLE;
  private subs = new Set<() => void>();
  private session: CoachSession | null = null;
  private settings: Settings | null = null;
  private gps: PhoneGpsSource | null = null;
  private demo: ReturnType<typeof setInterval> | null = null;
  private lastStatusT = -99;
  private wired = false;
  /** La pantalla de ajustes guarda aquí el perfil que envía el reloj. */
  onWatchProfile: ((p: WatchProfile) => void) | null = null;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  snapshot = () => this.state;

  private set(patch: Partial<RunState>) {
    this.state = { ...this.state, ...patch };
    this.subs.forEach((fn) => fn());
  }

  /** Escucha al reloj desde el arranque: perfil, muestras y botones. */
  wire() {
    if (this.wired) return;
    this.wired = true;
    garmin.onStatus((s) => this.set({ watchLink: s }));
    garmin.onMessage((m) => this.onWatch(m));
  }

  async connectWatch(settings: Settings): Promise<string> {
    if (!settings.device) return 'NO_DEVICE';
    const init = await garmin.init();
    if (!init.ok) return init.error ?? 'ERROR';
    const status = await garmin.connect(settings.device);
    this.set({ watchLink: status });
    return status;
  }

  async prepare(ctx: CoachContext, settings: Settings, source: SourceKind) {
    this.settings = settings;
    this.session = new CoachSession(ctx);
    this.lastStatusT = -99;
    const briefing = this.session.briefing();
    this.set({ ...IDLE, phase: 'ready', source, briefing, title: ctx.workout?.title ?? 'Carrera libre', watchLink: this.state.watchLink });
    await prepareVoice(settings.voiceRate);
    if (settings.voice) briefing.forEach((c) => say({ text: c.text, priority: 2 }));
    await activateKeepAwakeAsync('run').catch(() => {});

    if (source === 'watch') {
      await this.connectWatch(settings);
      await garmin.send(watchConfig(this.state.title, this.session.steps));
      await garmin.openApp();
    }
    if (source !== 'demo') {
      this.gps = new PhoneGpsSource();
      // Con reloj, el GPS del móvil solo mantiene viva la app con la pantalla apagada.
      await startTracking((points) => {
        if (this.state.source !== 'phone' || this.state.phase !== 'running') return;
        for (const p of points) {
          const s = this.gps?.next(p);
          if (s) this.onSample(s);
        }
      });
    }
  }

  begin() {
    if (!this.session || this.state.phase === 'running') return;
    hush();
    this.gps?.resume();
    this.set({ phase: 'running' });
    if (this.state.source === 'demo' && !this.demo) this.startDemo();
  }

  pause() {
    if (this.state.phase !== 'running') return;
    this.gps?.pause();
    this.set({ phase: 'paused' });
  }

  lap() {
    this.emit(this.session?.lap() ?? []);
  }

  pain(level: number) {
    this.emit(this.session?.reportPain(level) ?? []);
  }

  finish() {
    if (!this.session || this.state.phase === 'finished') return;
    const summary = this.session.finish();
    this.stopSources();
    this.set({ phase: 'finished', summary });
    this.emit([summary.cue]);
  }

  reset() {
    this.stopSources();
    hush();
    this.session = null;
    this.set({ ...IDLE, watchLink: this.state.watchLink });
  }

  private stopSources() {
    if (this.demo) clearInterval(this.demo);
    this.demo = null;
    this.gps = null;
    stopTracking().catch(() => {});
    deactivateKeepAwake('run').catch(() => {});
  }

  private onWatch(m: WatchMessage) {
    if (m.k === 'prof') {
      this.onWatchProfile?.(profileFromWatch(m));
      return;
    }
    if (this.state.source !== 'watch' || !this.session) return;
    if (m.k === 's') {
      if (this.state.phase === 'ready' || this.state.phase === 'paused') this.set({ phase: 'running' });
      if (this.state.phase === 'running') this.onSample(sampleFromWatch(m));
    } else if (m.k === 'ev') {
      if (m.e === 'start' || m.e === 'resume') this.begin();
      else if (m.e === 'pause') this.pause();
      else if (m.e === 'lap') this.lap();
      else if (m.e === 'pain') this.pain(Number(m.v) || 0);
      else if (m.e === 'stop') this.finish();
    }
  }

  private onSample(sample: LiveSample) {
    if (!this.session) return;
    const cues = this.session.update(sample);
    const status = this.session.status();
    this.set({ sample, status });
    this.emit(cues);
    // Objetivo actual al reloj cada ~6 s: también le sirve de latido para saber que el móvil sigue ahí.
    if (this.state.source === 'watch' && this.settings?.watch && sample.t - this.lastStatusT >= 6) {
      this.lastStatusT = sample.t;
      garmin.send(watchStatus(status)).catch(() => {});
    }
  }

  private emit(cues: Cue[]) {
    if (!cues.length) return;
    this.set({ cues: [...cues.slice().reverse(), ...this.state.cues].slice(0, 40) });
    for (const c of cues) {
      if (this.settings?.voice) say(c);
      if (this.settings?.watch && this.state.source === 'watch') garmin.send(watchCue(c)).catch(() => {});
    }
  }

  /** Corredor simulado (×5) para probar la app sin salir a correr. */
  private startDemo() {
    let t = 0;
    let dist = 0;
    let hr = 110;
    this.demo = setInterval(() => {
      if (this.state.phase !== 'running' || !this.session) return;
      const st = this.session.status();
      const targetHr = st.targetHr ? (st.targetHr.min + st.targetHr.max) / 2 : 150;
      const wave = Math.sin(t / 90) * 12; // se pasa y se queda corto a ratos
      hr += (targetHr + wave - hr) * 0.05;
      const pace = st.targetPace ? (st.targetPace.min + st.targetPace.max) / 2 : 330 - (hr - 140) * 2.2;
      const speed = 1000 / Math.max(pace * (1 - wave / 300), 180);
      this.onSample({ t, distanceM: dist, hr: Math.round(hr), speedMps: speed, cadence: Math.round(160 + speed * 4), altitudeM: 100 + Math.sin(dist / 700) * 18, headingDeg: (dist / 30) % 360 });
      dist += speed;
      t += 1;
    }, 200);
  }
}

export const run = new RunManager();
export const useRun = () => React.useSyncExternalStore(run.subscribe, run.snapshot);

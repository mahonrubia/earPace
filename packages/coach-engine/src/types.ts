/** Modelo de datos del entrenador. Unidades: metros, segundos, ppm, pasos/min, s/km. */

export type Terrain =
  | 'road'
  | 'track'
  | 'treadmill'
  | 'gravel'
  | 'trail'
  | 'technical_trail'
  | 'grass'
  | 'sand'
  | 'snow';

export interface HrZone {
  /** Límite inferior incluido (ppm). */
  min: number;
  /** Límite superior incluido (ppm). */
  max: number;
}

export interface WeightEntry {
  date: string; // ISO yyyy-mm-dd
  kg: number;
}

export interface AthleteProfile {
  name?: string;
  age?: number;
  weightKg: number;
  /** Histórico de peso (para detectar caídas bruscas = posible deshidratación). */
  weightHistory?: WeightEntry[];
  hrMax: number;
  hrRest?: number;
  /** Cinco zonas Z1..Z5. Si falta, se calculan con hrMax/hrRest. */
  hrZones?: HrZone[];
  /** Cadencia habitual a ritmo suave (pasos/min). */
  baselineCadence?: number;
  /** Ritmo umbral (s/km), para traducir zonas a ritmo si el plan no lo da. */
  thresholdPaceSecPerKm?: number;
}

export type ShoeType = 'daily' | 'tempo' | 'racing' | 'trail' | 'recovery';

export interface Shoe {
  id: string;
  name: string;
  type: ShoeType;
  km: number;
  /** Vida útil estimada; por defecto según tipo. */
  maxKm?: number;
}

export type InjuryArea =
  | 'knee'
  | 'achilles'
  | 'plantar'
  | 'shin'
  | 'hamstring'
  | 'calf'
  | 'quad'
  | 'itband'
  | 'hip'
  | 'ankle'
  | 'foot'
  | 'back'
  | 'other';

export type InjuryStatus = 'active' | 'recovering' | 'recovered';

export interface InjuryRestrictions {
  /** Zona de FC máxima permitida (1..5). */
  maxZone?: number;
  maxDurationMin?: number;
  avoidDownhill?: boolean;
  avoidSpeedWork?: boolean;
  avoidHardSurface?: boolean;
}

/** Entrada de la evolución clínica de una lesión. */
export interface InjuryLogEntry {
  date: string;
  note: string;
  /** Dolor 0..10. */
  painLevel?: number;
}

export interface Injury {
  id: string;
  area: InjuryArea;
  /** Nombre legible: "tendinitis aquílea izquierda". */
  label: string;
  status: InjuryStatus;
  /** 1 leve, 2 moderada, 3 grave. */
  severity: 1 | 2 | 3;
  onset: string;
  recoveredOn?: string;
  clinicalLog?: InjuryLogEntry[];
  restrictions?: InjuryRestrictions;
}

export type WorkoutType = 'easy' | 'recovery' | 'long' | 'tempo' | 'intervals' | 'hills' | 'race' | 'rest';

export type StepKind = 'warmup' | 'work' | 'recovery' | 'cooldown' | 'steady';

export type StepDuration =
  | { type: 'time'; seconds: number }
  | { type: 'distance'; meters: number }
  /** Hasta que el corredor pulse vuelta. */
  | { type: 'open' };

export interface StepTarget {
  /** Zona de FC objetivo 1..5. */
  hrZone?: number;
  /** Rango de ritmo en llano y condiciones neutras (s/km). min = más rápido. */
  paceSecPerKm?: { min: number; max: number };
}

export interface WorkoutStep {
  kind: StepKind;
  duration: StepDuration;
  target?: StepTarget;
  note?: string;
}

export interface RepeatBlock {
  repeat: number;
  steps: WorkoutStep[];
}

export interface Workout {
  id?: string;
  date: string;
  type: WorkoutType;
  title: string;
  description?: string;
  steps: Array<WorkoutStep | RepeatBlock>;
  /** Solo competición. */
  race?: { distanceM: number; targetTimeS?: number };
}

export interface PlanGoal {
  name: string;
  date: string;
  distanceM: number;
  targetTimeS?: number;
}

export interface TrainingPlan {
  name: string;
  goal?: PlanGoal;
  workouts: Workout[];
}

export interface PastActivity {
  date: string;
  durationMin: number;
  distanceKm: number;
  avgHr?: number;
  /** Esfuerzo percibido 1..10. */
  rpe?: number;
  type?: WorkoutType;
}

export interface RecoveryInfo {
  /** Horas de sueño de la última noche. */
  lastSleepHours?: number;
  /** VFC de anoche relativa a su media (1 = normal, 0.8 = 20 % por debajo). */
  hrvRatio?: number;
}

export interface Weather {
  tempC: number;
  /** Humedad relativa 0..100. */
  humidityPct: number;
  windSpeedMps: number;
  /** Dirección DESDE la que sopla el viento (grados, 0 = norte). */
  windFromDeg: number;
  precipitationMm?: number;
  condition?: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
}

export interface RoutePoint {
  /** Distancia acumulada desde la salida (m). */
  distM: number;
  eleM: number;
}

export interface Route {
  name?: string;
  points: RoutePoint[];
}

export type Verbosity = 'minimal' | 'normal' | 'detailed';

export interface CoachContext {
  profile: AthleteProfile;
  /** Sesión de hoy. Si falta, carrera libre guiada por zonas. */
  workout?: Workout;
  plan?: TrainingPlan;
  shoe?: Shoe;
  injuries?: Injury[];
  history?: PastActivity[];
  recovery?: RecoveryInfo;
  weather?: Weather;
  terrain?: Terrain;
  route?: Route;
  /** Fecha de hoy ISO (inyectable para tests). */
  today?: string;
  verbosity?: Verbosity;
}

/** Muestra en vivo desde el reloj (o GPS del móvil). */
export interface LiveSample {
  /** Segundos de actividad (tiempo en movimiento). */
  t: number;
  distanceM: number;
  hr?: number;
  /** Pasos por minuto (ambos pies). */
  cadence?: number;
  speedMps?: number;
  altitudeM?: number;
  /** Rumbo en grados (0 = norte). */
  headingDeg?: number;
  tempC?: number;
}

export type CueCategory =
  | 'briefing'
  | 'step'
  | 'hr'
  | 'pace'
  | 'cadence'
  | 'elevation'
  | 'weather'
  | 'fuel'
  | 'shoe'
  | 'injury'
  | 'load'
  | 'safety'
  | 'race'
  | 'split'
  | 'motivation'
  | 'summary';

export type Haptic = 'none' | 'short' | 'double' | 'long' | 'alert';

export interface Cue {
  /** Clave estable para antirrepetición. */
  key: string;
  category: CueCategory;
  /** 1 crítico · 2 importante · 3 normal · 4 informativo. */
  priority: 1 | 2 | 3 | 4;
  /** Texto completo para voz. */
  text: string;
  /** Texto corto para la pantalla del reloj. */
  short: string;
  haptic: Haptic;
  /** Segundo de actividad en el que se emite. */
  atS: number;
}

export interface RunSummary {
  durationS: number;
  distanceM: number;
  avgPaceSecPerKm?: number;
  avgHr?: number;
  avgCadence?: number;
  ascentM: number;
  /** Segundos en cada zona Z1..Z5. */
  timeInZonesS: number[];
  /** % del tiempo con objetivo en el que se cumplió. */
  compliancePct?: number;
  kcal: number;
  /** Líquido a reponer estimado (ml). */
  fluidMl: number;
  cue: Cue;
}

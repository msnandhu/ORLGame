import type { DrivingMode } from './modes';
export type VehicleCategory = 'expedition' | 'rock-crawler' | 'racing' | 'common' | 'luxury';
export type TyreType = 'all-terrain' | 'road' | 'performance' | 'mud' | 'rock' | 'snow';
export type PaintFinish = 'gloss' | 'metallic' | 'pearl' | 'matte';
export type Livery = 'stock' | 'none' | 'stripes';

/** Visual description used by the client to build the procedural model (no art in the sim). */
export interface VehicleLook {
  style: 'wagon' | 'crawler' | 'coupe' | 'hatch' | 'sedan';
  paint: [number, number, number];   // linear-ish RGB 0..1
  accent: [number, number, number];
  snorkel: boolean;
  /** driver's hip point (vehicle frame, metres from the CoM; +X is the driver's side) */
  seat: [number, number, number];
  // ---- set by the garage (applyBuild); absent on a factory vehicle ----
  finish?: PaintFinish;
  livery?: Livery;
  rimColor?: [number, number, number];
  /** fitted option id per part slot (see garage/parts.ts) */
  fit?: Record<string, string>;
  /** engine sound gain from exhaust and turbo parts */
  sound?: number;
  /** extra driving lamps lit with the headlights */
  beams?: number;
}

/** Data-driven vehicle definition. Every handling number lives here, so a new vehicle is new data, not new code. */
export interface VehicleSpec {
  id: string;
  name: string;
  category: VehicleCategory;
  description: string;
  /** part-time 4WD has a transfer case (2H/4H/4L) and lockers; road cars drive one axle or all four permanently */
  drivetrain: 'part-time-4wd' | 'fwd' | 'rwd' | 'awd';
  /** tyre compound: all-terrain (default) grips everywhere, road tyres prefer tarmac, performance tyres need it */
  tyre?: TyreType;
  /** aerodynamic downforce, N per (m/s)^2 */
  downforce?: number;
  /** limited-slip differential on the driven axle(s): 0 = open, 1 = locked */
  lsd?: number;
  /** electronic top-speed limiter, km/h */
  vmaxKmh?: number;
  /** driving modes this vehicle offers (default: all) */
  modes?: DrivingMode[];
  damageResistance: number;      // 1 = baseline; higher takes less damage per impact
  bellyY: number;                // skid plate height relative to CoM (ground clearance)
  look: VehicleLook;
  mass: number;                 // kg
  inertia: [number, number, number]; // kg m^2 (x pitch... body axes)
  halfExtents: [number, number, number]; // collision hull half sizes (x,y,z) relative to CoM-centred box
  hullOffsetY: number;          // hull centre relative to CoM
  wheelX: number; wheelFrontZ: number; wheelRearZ: number; mountY: number;
  wheelRadius: number; wheelWidth: number; wheelInertia: number;
  restLength: number; maxTravel: number;
  springRate: number; bumpDamping: number; reboundDamping: number; antiRoll: number;
  maxSteer: number;             // radians
  torqueCurve: [number, number][]; // rpm, Nm
  idleRpm: number; redlineRpm: number; engineInertia: number;
  gears: number[]; reverseRatio: number; finalDrive: number; lowRange: number;
  brakeTorqueFront: number; brakeTorqueRear: number; handbrakeTorque: number;
  dragCoef: number;             // 0.5*rho*Cd*A
  tireGrip: number;             // multiplier on surface friction
  tireLongStiffness: number; tireLatStiffness: number;
  intakeHeight: number;         // y of air intake relative to CoM (snorkel raises it)
  fuelCapacity: number;
  /**
   * Roll-centre height as a fraction of the centre-of-mass height (default 0.35): tyre side forces act through the
   * suspension links at this height, so only the rest rolls the body on its springs.
   */
  rollCentre?: number;
  /** radiator capacity multiplier (1 = factory); tuned engines run hotter, a heavy-duty radiator cooler */
  coolingCapacity?: number;
}

/** "Ranger TX4" — fictional mid-size 4x4 pickup/wagon. Numbers modeled on a typical 3.0 L turbo-diesel 4x4. */
export const RANGER_TX4: VehicleSpec = {
  id: 'ranger-tx4',
  name: 'Ranger TX4',
  category: 'expedition',
  description: 'Mid-size turbo-diesel wagon. Comfortable, long legged, carries fuel for a long day.',
  drivetrain: 'part-time-4wd',
  damageResistance: 1.0,
  bellyY: -0.6,
  look: { style: 'wagon', paint: [0.62, 0.16, 0.08], accent: [0.08, 0.08, 0.08], snorkel: true, seat: [0.42, 0.18, -0.38] },
  mass: 2150,
  inertia: [3600, 4200, 1300],
  halfExtents: [0.95, 0.62, 2.3],
  hullOffsetY: 0.25,
  wheelX: 0.82, wheelFrontZ: 1.42, wheelRearZ: -1.38, mountY: 0.05,
  wheelRadius: 0.42, wheelWidth: 0.3, wheelInertia: 2.2,
  restLength: 0.8, maxTravel: 0.55,
  springRate: 20000, bumpDamping: 2600, reboundDamping: 3800, antiRoll: 6000,
  maxSteer: 0.62,
  torqueCurve: [[600, 180], [1000, 330], [1600, 470], [2000, 520], [2800, 520], [3400, 470], [4000, 400], [4600, 300], [5000, 200]],
  idleRpm: 800, redlineRpm: 4400, engineInertia: 0.22,
  gears: [4.3, 2.55, 1.65, 1.24, 1.0, 0.8], reverseRatio: 3.9, finalDrive: 4.1, lowRange: 2.72,
  brakeTorqueFront: 3200, brakeTorqueRear: 2100, handbrakeTorque: 4000,
  dragCoef: 0.5 * 1.2 * 0.48 * 3.0,
  tireGrip: 1.0,
  tireLongStiffness: 11, tireLatStiffness: 9,
  intakeHeight: 0.35,
  fuelCapacity: 80,
};

/** "Bramble RC2" — fictional short-wheelbase rock crawler: V8 petrol, portal-style clearance, 35" tyres, deep low range. */
export const BRAMBLE_RC2: VehicleSpec = {
  id: 'bramble-rc2',
  name: 'Bramble RC2',
  category: 'rock-crawler',
  description: 'Short, light and tall. Huge tyres and a 4:1 low range crawl over rock; twitchy and thirsty at speed.',
  drivetrain: 'part-time-4wd',
  damageResistance: 1.3,
  bellyY: -0.42,
  look: { style: 'crawler', paint: [0.86, 0.6, 0.08], accent: [0.1, 0.1, 0.1], snorkel: false, seat: [0.38, 0.3, -0.4] },
  mass: 1680,
  inertia: [2300, 2600, 900],
  halfExtents: [0.9, 0.6, 1.95],
  hullOffsetY: 0.32,
  wheelX: 0.86, wheelFrontZ: 1.2, wheelRearZ: -1.2, mountY: 0.12,
  wheelRadius: 0.5, wheelWidth: 0.36, wheelInertia: 3.2,
  restLength: 0.92, maxTravel: 0.72,
  springRate: 14500, bumpDamping: 2000, reboundDamping: 3000, antiRoll: 2500,
  maxSteer: 0.68,
  torqueCurve: [[700, 220], [1500, 380], [2500, 430], [3500, 440], [4500, 400], [5200, 330], [5800, 250]],
  idleRpm: 750, redlineRpm: 5600, engineInertia: 0.18,
  gears: [4.0, 2.4, 1.55, 1.15, 0.9], reverseRatio: 3.6, finalDrive: 4.88, lowRange: 4.0,
  brakeTorqueFront: 2900, brakeTorqueRear: 2200, handbrakeTorque: 3800,
  dragCoef: 0.5 * 1.2 * 0.6 * 2.9,
  tireGrip: 1.12,
  tireLongStiffness: 10, tireLatStiffness: 8.5,
  intakeHeight: 0.55,
  fuelCapacity: 70,
};

const ROAD_MODES: DrivingMode[] = ['normal', 'sport', 'snow'];

/** "Vanta GT": fictional mid-engined-feel front-engine racing coupe. Light, stiff, big rear tyres and real downforce. */
export const VANTA_GT: VehicleSpec = {
  id: 'vanta-gt', name: 'Vanta GT', category: 'racing',
  description: 'Twin-turbo V8 race-bred coupe. Slicks-like grip on tarmac, hopeless on grass. Treat the throttle with respect.',
  drivetrain: 'rwd', tyre: 'performance', downforce: 1.1, lsd: 0.35, modes: ROAD_MODES,
  damageResistance: 0.75, bellyY: -0.3,
  look: { style: 'coupe', paint: [0.05, 0.16, 0.55], accent: [0.9, 0.75, 0.1], snorkel: false, seat: [0.36, -0.06, -0.35] },
  mass: 1420, inertia: [1700, 2100, 480],
  halfExtents: [0.96, 0.36, 2.25], hullOffsetY: 0.1,
  wheelX: 0.82, wheelFrontZ: 1.36, wheelRearZ: -1.3, mountY: 0.1,
  wheelRadius: 0.34, wheelWidth: 0.3, wheelInertia: 1.3,
  restLength: 0.3, maxTravel: 0.16,
  springRate: 46000, bumpDamping: 4600, reboundDamping: 6200, antiRoll: 19000,
  maxSteer: 0.52,
  torqueCurve: [[1000, 300], [2000, 520], [3000, 640], [5500, 660], [6800, 600], [7600, 520], [8200, 430]],
  idleRpm: 950, redlineRpm: 8000, engineInertia: 0.11,
  gears: [3.15, 2.18, 1.66, 1.32, 1.08, 0.88], reverseRatio: 3.0, finalDrive: 3.42, lowRange: 1,
  brakeTorqueFront: 4800, brakeTorqueRear: 3300, handbrakeTorque: 3600,
  dragCoef: 0.5 * 1.2 * 0.33 * 1.95,
  tireGrip: 1.0, tireLongStiffness: 15, tireLatStiffness: 14,
  intakeHeight: 0.15, fuelCapacity: 72,
};

/** "Strix R2": fictional all-wheel-drive rally hatch. Short, nimble and happy on gravel as well as tarmac. */
export const STRIX_R2: VehicleSpec = {
  id: 'strix-r2', name: 'Strix R2', category: 'racing',
  description: 'Turbo four, permanent all-wheel drive and long-travel rally dampers. The one that keeps going when the tarmac stops.',
  drivetrain: 'awd', tyre: 'road', downforce: 0.35, lsd: 0.5, modes: ROAD_MODES,
  damageResistance: 1.0, bellyY: -0.36,
  look: { style: 'hatch', paint: [0.9, 0.9, 0.88], accent: [0.75, 0.08, 0.06], snorkel: false, seat: [0.36, 0.0, -0.3] },
  mass: 1310, inertia: [1500, 1800, 450],
  halfExtents: [0.9, 0.48, 2.0], hullOffsetY: 0.2,
  wheelX: 0.78, wheelFrontZ: 1.27, wheelRearZ: -1.25, mountY: 0.06,
  wheelRadius: 0.33, wheelWidth: 0.24, wheelInertia: 1.2,
  restLength: 0.42, maxTravel: 0.26,
  springRate: 30000, bumpDamping: 3300, reboundDamping: 4600, antiRoll: 11000,
  maxSteer: 0.58,
  torqueCurve: [[1000, 200], [2000, 360], [3000, 420], [5000, 420], [6200, 380], [7000, 320]],
  idleRpm: 900, redlineRpm: 7000, engineInertia: 0.1,
  gears: [3.3, 2.2, 1.65, 1.3, 1.05, 0.86], reverseRatio: 3.2, finalDrive: 4.1, lowRange: 1,
  brakeTorqueFront: 3600, brakeTorqueRear: 2600, handbrakeTorque: 4200,
  dragCoef: 0.5 * 1.2 * 0.36 * 2.1,
  tireGrip: 1.0, tireLongStiffness: 13, tireLatStiffness: 12,
  intakeHeight: 0.25, fuelCapacity: 55,
};

/** "Pella": fictional everyday front-wheel-drive hatchback. */
export const PELLA: VehicleSpec = {
  id: 'pella', name: 'Pella 1.4', category: 'common',
  description: 'The car everyone in Millbrook seems to own. Light, frugal, forgiving, and not in any hurry.',
  drivetrain: 'fwd', tyre: 'road', downforce: 0, modes: ROAD_MODES,
  damageResistance: 0.9, bellyY: -0.34,
  look: { style: 'hatch', paint: [0.55, 0.62, 0.5], accent: [0.15, 0.15, 0.15], snorkel: false, seat: [0.36, 0.02, -0.25] },
  mass: 1130, inertia: [1250, 1500, 380],
  halfExtents: [0.86, 0.5, 1.98], hullOffsetY: 0.22,
  wheelX: 0.74, wheelFrontZ: 1.25, wheelRearZ: -1.25, mountY: 0.06,
  wheelRadius: 0.31, wheelWidth: 0.19, wheelInertia: 0.9,
  restLength: 0.38, maxTravel: 0.2,
  springRate: 23000, bumpDamping: 2300, reboundDamping: 3200, antiRoll: 7000,
  maxSteer: 0.6,
  torqueCurve: [[1000, 95], [2000, 120], [3500, 135], [4500, 132], [5600, 118], [6300, 100]],
  idleRpm: 800, redlineRpm: 6200, engineInertia: 0.09,
  gears: [3.55, 1.95, 1.3, 0.97, 0.78], reverseRatio: 3.4, finalDrive: 4.06, lowRange: 1,
  brakeTorqueFront: 2300, brakeTorqueRear: 1200, handbrakeTorque: 2200,
  dragCoef: 0.5 * 1.2 * 0.32 * 2.1,
  tireGrip: 0.95, tireLongStiffness: 11, tireLatStiffness: 10,
  intakeHeight: 0.2, fuelCapacity: 45,
};

/** "Corvan": fictional family saloon. */
export const CORVAN: VehicleSpec = {
  id: 'corvan', name: 'Corvan 2.0', category: 'common',
  description: 'Roomy, quiet family saloon with a two-litre petrol. Front-wheel drive, soft and safe.',
  drivetrain: 'fwd', tyre: 'road', downforce: 0, modes: ROAD_MODES,
  damageResistance: 1.0, bellyY: -0.34,
  look: { style: 'sedan', paint: [0.5, 0.52, 0.56], accent: [0.12, 0.12, 0.12], snorkel: false, seat: [0.38, 0.0, -0.2] },
  mass: 1420, inertia: [1800, 2300, 500],
  halfExtents: [0.9, 0.5, 2.35], hullOffsetY: 0.2,
  wheelX: 0.78, wheelFrontZ: 1.4, wheelRearZ: -1.35, mountY: 0.06,
  wheelRadius: 0.32, wheelWidth: 0.21, wheelInertia: 1.0,
  restLength: 0.38, maxTravel: 0.2,
  springRate: 25000, bumpDamping: 2500, reboundDamping: 3500, antiRoll: 8000,
  maxSteer: 0.58,
  torqueCurve: [[1000, 140], [2000, 185], [3500, 200], [4800, 198], [5800, 180], [6500, 155]],
  idleRpm: 750, redlineRpm: 6400, engineInertia: 0.1,
  gears: [3.6, 2.08, 1.36, 1.03, 0.84, 0.71], reverseRatio: 3.3, finalDrive: 3.9, lowRange: 1,
  brakeTorqueFront: 2800, brakeTorqueRear: 1500, handbrakeTorque: 2500,
  dragCoef: 0.5 * 1.2 * 0.29 * 2.2,
  tireGrip: 0.97, tireLongStiffness: 11, tireLatStiffness: 10,
  intakeHeight: 0.2, fuelCapacity: 60,
};

/** "Halcyon": fictional luxury limousine. Heavy, silent, very fast in a straight line. */
export const HALCYON: VehicleSpec = {
  id: 'halcyon', name: 'Halcyon Grand', category: 'luxury',
  description: 'Long-wheelbase twin-turbo V8 limousine with air-soft springs and all-wheel drive. Wafts at 200 km/h.',
  drivetrain: 'awd', tyre: 'road', downforce: 0.1, lsd: 0.2, modes: ROAD_MODES, vmaxKmh: 250,
  damageResistance: 1.2, bellyY: -0.36,
  look: { style: 'sedan', paint: [0.06, 0.06, 0.07], accent: [0.75, 0.75, 0.78], snorkel: false, seat: [0.4, 0.04, -0.15] },
  mass: 2180, inertia: [3200, 4300, 800],
  halfExtents: [0.97, 0.55, 2.62], hullOffsetY: 0.2,
  wheelX: 0.84, wheelFrontZ: 1.62, wheelRearZ: -1.55, mountY: 0.06,
  wheelRadius: 0.36, wheelWidth: 0.26, wheelInertia: 1.6,
  restLength: 0.4, maxTravel: 0.22,
  springRate: 32000, bumpDamping: 3100, reboundDamping: 4300, antiRoll: 11000,
  maxSteer: 0.56,
  torqueCurve: [[1000, 450], [1800, 700], [4500, 750], [5500, 720], [6200, 640], [6600, 560]],
  idleRpm: 650, redlineRpm: 6500, engineInertia: 0.16,
  gears: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64], reverseRatio: 3.5, finalDrive: 3.15, lowRange: 1,
  brakeTorqueFront: 5200, brakeTorqueRear: 3400, handbrakeTorque: 3600,
  dragCoef: 0.5 * 1.2 * 0.28 * 2.45,
  tireGrip: 1.0, tireLongStiffness: 12, tireLatStiffness: 11.5,
  intakeHeight: 0.25, fuelCapacity: 90,
};

/** "Solenne GT": fictional luxury grand tourer coupe. */
export const SOLENNE_GT: VehicleSpec = {
  id: 'solenne-gt', name: 'Solenne GT', category: 'luxury',
  description: 'Hand-built V12 grand tourer. Long bonnet, rear-wheel drive, effortless pace and a soundtrack to match.',
  drivetrain: 'rwd', tyre: 'performance', downforce: 0.45, lsd: 0.3, modes: ROAD_MODES,
  damageResistance: 0.9, bellyY: -0.32,
  look: { style: 'coupe', paint: [0.42, 0.04, 0.08], accent: [0.8, 0.78, 0.72], snorkel: false, seat: [0.38, -0.04, -0.45] },
  mass: 1790, inertia: [2300, 2900, 600],
  halfExtents: [0.97, 0.4, 2.4], hullOffsetY: 0.12,
  wheelX: 0.84, wheelFrontZ: 1.5, wheelRearZ: -1.32, mountY: 0.08,
  wheelRadius: 0.35, wheelWidth: 0.29, wheelInertia: 1.5,
  restLength: 0.33, maxTravel: 0.17,
  springRate: 38000, bumpDamping: 3900, reboundDamping: 5400, antiRoll: 15000,
  maxSteer: 0.54,
  torqueCurve: [[1000, 380], [2000, 560], [4000, 700], [5500, 700], [6800, 640], [7400, 560]],
  idleRpm: 800, redlineRpm: 7200, engineInertia: 0.14,
  gears: [4.7, 3.1, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67], reverseRatio: 3.5, finalDrive: 2.85, lowRange: 1,
  brakeTorqueFront: 5000, brakeTorqueRear: 3300, handbrakeTorque: 3400,
  dragCoef: 0.5 * 1.2 * 0.31 * 2.05,
  tireGrip: 1.0, tireLongStiffness: 14, tireLatStiffness: 13,
  intakeHeight: 0.15, fuelCapacity: 80,
};

/**
 * "Sovereign X1" — Elias Kade's ultimate core vehicle (story): a hand-built expedition hypertruck on the Ranger's
 * wagon body: twin-turbo V8, armoured shell, long-travel suspension and huge tyres. Not for sale: the master
 * gangster drives it, and beating him gives it back.
 */
export const SOVEREIGN_X1: VehicleSpec = {
  ...RANGER_TX4,
  id: 'sovereign-x1',
  name: 'Sovereign X1',
  category: 'luxury',
  description: 'Your father\'s core vehicle. Armoured twin-turbo hypertruck: crawls like a crawler, runs like a GT.',
  damageResistance: 2.2,
  look: { style: 'wagon', paint: [0.03, 0.03, 0.035], accent: [0.78, 0.6, 0.2], snorkel: true, seat: [0.42, 0.18, -0.38] },
  mass: 2350,
  inertia: [3900, 4500, 1400],
  wheelRadius: 0.47, wheelWidth: 0.34, wheelInertia: 2.8,
  restLength: 0.86, maxTravel: 0.62,
  springRate: 26000, bumpDamping: 3200, reboundDamping: 4400, antiRoll: 9000,
  torqueCurve: [[600, 260], [1000, 480], [1600, 760], [2200, 880], [3400, 880], [4400, 800], [5400, 680], [6000, 520], [6400, 380]],
  idleRpm: 800, redlineRpm: 6200, engineInertia: 0.26,
  gears: [4.2, 2.6, 1.75, 1.3, 1.0, 0.82, 0.68], finalDrive: 3.9, lowRange: 2.9,
  brakeTorqueFront: 4600, brakeTorqueRear: 3000, handbrakeTorque: 4800,
  tireGrip: 1.08, intakeHeight: 0.4, fuelCapacity: 110,
};

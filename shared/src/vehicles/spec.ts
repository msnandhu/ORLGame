/** Visual description used by the client to build the procedural model (no art in the sim). */
export interface VehicleLook {
  style: 'wagon' | 'crawler';
  paint: [number, number, number];   // linear-ish RGB 0..1
  accent: [number, number, number];
  snorkel: boolean;
  /** driver's hip point (vehicle frame, metres from the CoM; +X is the driver's side) */
  seat: [number, number, number];
}

/** Data-driven vehicle definition. Every handling number lives here, so a new vehicle is new data, not new code. */
export interface VehicleSpec {
  id: string;
  name: string;
  category: 'expedition' | 'rock-crawler';
  description: string;
  drivetrain: 'part-time-4wd';
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

/** Data-driven vehicle definition. Phase 2 garage upgrades will modify these numbers. */
export interface VehicleSpec {
  name: string;
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
  name: 'Ranger TX4',
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

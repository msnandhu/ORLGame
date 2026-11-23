/**
 * Driving modes (terrain response). A mode never adds grip; it changes how the driver's inputs are
 * turned into torque, how the electronics intervene, and how the chassis is set up.
 */
export type DrivingMode = 'normal' | 'sport' | 'offroad' | 'rockcrawl' | 'snow' | 'mud';
export const DRIVING_MODES: readonly DrivingMode[] = ['normal', 'sport', 'offroad', 'rockcrawl', 'snow', 'mud'];

export interface DrivingModeProfile {
  id: DrivingMode;
  label: string;
  description: string;
  /** pedal map: torque request = gain * pedal^exponent (exponent > 1 = gentler tip-in) */
  throttleExp: number; throttleGain: number;
  /** traction control: engine torque is cut when driven-wheel slip ratio exceeds this. null = off */
  tcSlip: number | null;
  /** brake-based traction control: brakes a spinning wheel so an open diff sends torque across */
  brakeTc: boolean;
  /** ABS: releases a braked wheel that starts to lock */
  abs: boolean;
  /** added to the automatic gearbox up/down shift rpm */
  shiftBias: number;
  /** automatic gearbox lowest forward gear in high range (2 = pull away in 2nd on slippery ground) */
  startGear: number;
  /** crawl control: holds speed at or below this many km/h. null = off */
  crawlKmh: number | null;
  antiRollMul: number; dampingMul: number; steerRateMul: number;
  /** what the transfer case and lockers are set to when the mode is selected */
  recommend: { range: '2H' | '4H' | '4L'; diffLock: boolean } | null;
}

export const DRIVING_MODE_PROFILES: Record<DrivingMode, DrivingModeProfile> = {
  normal: {
    id: 'normal', label: 'Normal', description: 'Balanced pedal, traction control and ABS on.',
    throttleExp: 1.2, throttleGain: 1, tcSlip: 0.35, brakeTc: false, abs: true, shiftBias: 0, startGear: 1,
    crawlKmh: null, antiRollMul: 1, dampingMul: 1, steerRateMul: 1, recommend: null,
  },
  sport: {
    id: 'sport', label: 'Sport', description: 'Sharp pedal, late upshifts, stiffer roll control, loose traction control.',
    throttleExp: 0.85, throttleGain: 1, tcSlip: 0.6, brakeTc: false, abs: true, shiftBias: 700, startGear: 1,
    crawlKmh: null, antiRollMul: 1.4, dampingMul: 1.2, steerRateMul: 1.35, recommend: { range: '2H', diffLock: false },
  },
  offroad: {
    id: 'offroad', label: 'Off-road', description: 'Soft roll bars for articulation, brake traction control, 4H.',
    throttleExp: 1.5, throttleGain: 1, tcSlip: 0.5, brakeTc: true, abs: false, shiftBias: 300, startGear: 1,
    crawlKmh: null, antiRollMul: 0.6, dampingMul: 0.9, steerRateMul: 1, recommend: { range: '4H', diffLock: false },
  },
  rockcrawl: {
    id: 'rockcrawl', label: 'Rock crawl', description: 'Crawl control holds walking pace, maximum articulation, 4L and lockers.',
    throttleExp: 2.0, throttleGain: 0.9, tcSlip: 0.4, brakeTc: true, abs: false, shiftBias: 0, startGear: 1,
    crawlKmh: 9, antiRollMul: 0.25, dampingMul: 0.8, steerRateMul: 0.85, recommend: { range: '4L', diffLock: true },
  },
  snow: {
    id: 'snow', label: 'Snow', description: 'Very gentle pedal, tight traction control, pulls away in 2nd, early upshifts.',
    throttleExp: 2.2, throttleGain: 0.75, tcSlip: 0.15, brakeTc: true, abs: true, shiftBias: -300, startGear: 2,
    crawlKmh: null, antiRollMul: 1, dampingMul: 1, steerRateMul: 0.8, recommend: { range: '4H', diffLock: false },
  },
  mud: {
    id: 'mud', label: 'Mud', description: 'Traction control off so the tyres can clear, holds gears longer, 4H and lockers.',
    throttleExp: 1.0, throttleGain: 1, tcSlip: null, brakeTc: false, abs: false, shiftBias: 500, startGear: 1,
    crawlKmh: null, antiRollMul: 0.8, dampingMul: 0.9, steerRateMul: 1, recommend: { range: '4H', diffLock: true },
  },
};

/** Next mode in the cycle; `allowed` restricts it to the modes a vehicle offers. */
export function nextDrivingMode(m: DrivingMode, allowed: readonly DrivingMode[] = DRIVING_MODES): DrivingMode {
  return allowed[(allowed.indexOf(m) + 1) % allowed.length];
}

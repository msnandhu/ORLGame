import { VehicleSpec, RANGER_TX4, BRAMBLE_RC2 } from './spec';

/** Every drivable vehicle, in garage order. Add a vehicle by adding a spec here. */
export const VEHICLES: readonly VehicleSpec[] = [RANGER_TX4, BRAMBLE_RC2];

export function vehicleById(id: string | undefined): VehicleSpec {
  return VEHICLES.find(v => v.id === id) ?? RANGER_TX4;
}

/** Headline figures derived from the spec (so the garage never shows numbers the sim doesn't use). */
export interface VehicleStats {
  powerKw: number; peakPowerRpm: number;
  peakTorqueNm: number; peakTorqueRpm: number;
  topSpeedKmh: number;         // gearing-limited at redline in top gear, high range
  groundClearanceM: number;    // lowest of belly plate / axle at static ride height
  wheelbaseM: number; trackM: number;
  tyreDiameterIn: number;
  crawlRatio: number;          // 1st * low range * final drive
  powerToWeight: number;       // kW per tonne
}

export function vehicleStats(s: VehicleSpec): VehicleStats {
  let powerKw = 0, peakPowerRpm = 0, peakTorqueNm = 0, peakTorqueRpm = 0;
  const c = s.torqueCurve;
  for (let rpm = c[0][0]; rpm <= Math.min(s.redlineRpm, c[c.length - 1][0]); rpm += 50) {
    let tq = c[c.length - 1][1];
    for (let i = 1; i < c.length; i++) if (rpm <= c[i][0]) { const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); tq = c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t; break; }
    const kw = tq * rpm * 2 * Math.PI / 60 / 1000;
    if (kw > powerKw) { powerKw = kw; peakPowerRpm = rpm; }
    if (tq > peakTorqueNm) { peakTorqueNm = tq; peakTorqueRpm = rpm; }
  }
  const top = s.gears[s.gears.length - 1] * s.finalDrive;
  const gearingTop = (s.redlineRpm / top) * 2 * Math.PI / 60 * s.wheelRadius * 3.6;
  // drag-limited top speed: P = dragCoef * v^3 (ignoring rolling resistance)
  const dragTop = Math.cbrt(powerKw * 1000 * 0.85 / s.dragCoef) * 3.6;
  // static sag: weight per wheel / spring rate
  const sag = (s.mass * 9.81 / 4) / s.springRate;
  const rideHeight = s.restLength - sag + s.wheelRadius - s.mountY; // CoM height above ground
  const belly = rideHeight + s.bellyY;
  const axle = s.wheelRadius - 0.13; // diff housing below axle centre
  return {
    powerKw: Math.round(powerKw), peakPowerRpm,
    peakTorqueNm: Math.round(peakTorqueNm), peakTorqueRpm,
    topSpeedKmh: Math.round(Math.min(gearingTop, dragTop)),
    groundClearanceM: +Math.min(belly, axle).toFixed(2),
    wheelbaseM: +(s.wheelFrontZ - s.wheelRearZ).toFixed(2),
    trackM: +(s.wheelX * 2).toFixed(2),
    tyreDiameterIn: Math.round(s.wheelRadius * 2 / 0.0254),
    crawlRatio: +(s.gears[0] * s.lowRange * s.finalDrive).toFixed(1),
    powerToWeight: +(powerKw / (s.mass / 1000)).toFixed(1),
  };
}

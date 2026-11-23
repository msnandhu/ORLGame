export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';
export type CameraMode = 'chase' | 'far' | 'hood' | 'first-person' | 'free';
export type PlayerMode = 'foot' | 'vehicle';

export interface Settings {
  graphics: GraphicsQuality;
  adaptiveQuality: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  volume: number;
  showFps: boolean;
  preferWebGPU: boolean;
}

/** Network-visible transform of one player (and their vehicle when driving). */
export interface PlayerTransform {
  mode: PlayerMode;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  /** which catalog vehicle the player drives (so others see the right model) */
  vid?: string;
  /** client sim time in ms when the snapshot was taken */
  t: number;
}

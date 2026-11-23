import type { Settings, GraphicsQuality } from '@orl/shared';
import { log } from '../core/logger';

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'high', adaptiveQuality: true, mouseSensitivity: 1, invertY: false, volume: 0.6, showFps: false, preferWebGPU: false,
};
const KEY = 'orl.settings.v2';

/** Settings persisted per browser (localStorage), tolerant of blocked storage. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const s = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) } as Settings;
    if (!['low', 'medium', 'high', 'ultra'].includes(s.graphics)) s.graphics = DEFAULT_SETTINGS.graphics;
    return s;
  } catch (e) { log.warn('settings', 'Could not read saved settings; using defaults', e); return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: settings stay in memory */ }
}

export interface QualityPreset {
  hardwareScaling: number;     // >1 renders below native resolution
  shadows: 'off' | 'basic' | 'cascaded';
  shadowMapSize: number;
  ssao: boolean;
  bloom: boolean;
  fxaa: boolean;
  msaaSamples: number;
  fogEnd: number;
  viewDistance: number;
  treeDensity: number;         // fraction of trees rendered
  particles: number;        // particle budget multiplier
  grassDensity: number;     // 0 disables grass clumps
}
export const PRESETS: Record<GraphicsQuality, QualityPreset> = {
  low:    { hardwareScaling: 1.5, shadows: 'off',      shadowMapSize: 1024, ssao: false, bloom: false, fxaa: true,  msaaSamples: 1, fogEnd: 450,  viewDistance: 600,  treeDensity: 0.45, particles: 0.4, grassDensity: 0 },
  medium: { hardwareScaling: 1.15, shadows: 'basic',   shadowMapSize: 2048, ssao: false, bloom: false, fxaa: true,  msaaSamples: 1, fogEnd: 750,  viewDistance: 1400, treeDensity: 0.75, particles: 0.7, grassDensity: 0.5 },
  high:   { hardwareScaling: 1,   shadows: 'cascaded', shadowMapSize: 2048, ssao: false, bloom: true,  fxaa: true,  msaaSamples: 4, fogEnd: 1000, viewDistance: 2500, treeDensity: 1,    particles: 1, grassDensity: 1 },
  ultra:  { hardwareScaling: 1,   shadows: 'cascaded', shadowMapSize: 4096, ssao: true,  bloom: true,  fxaa: true,  msaaSamples: 4, fogEnd: 1200, viewDistance: 3000, treeDensity: 1,    particles: 1.3, grassDensity: 1.6 },
};

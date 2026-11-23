import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { log } from '../core/logger';
// Tree-shaken Babylon only adds engine features that are imported. Multiple render targets are used by the
// pre-pass renderer behind SSAO (Ultra preset); without these the first frame throws "createMultipleRenderTarget
// is not a function".
import '@babylonjs/core/Engines/Extensions/engine.multiRender';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender';

export type Backend = 'WebGPU' | 'WebGL2' | 'WebGL1';

/** Creates the rendering engine: WebGPU where supported (and allowed), otherwise WebGL2. */
export async function createEngine(canvas: HTMLCanvasElement, preferWebGPU: boolean): Promise<{ engine: AbstractEngine; backend: Backend }> {
  const params = { antialias: true, stencil: true, powerPreference: 'high-performance' as const, adaptToDeviceRatio: true };
  if (preferWebGPU) {
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, params);
        await engine.initAsync();
        log.info('engine', 'Using WebGPU backend');
        return { engine, backend: 'WebGPU' };
      }
      log.info('engine', 'WebGPU not supported by this browser/GPU; falling back to WebGL2');
    } catch (e) {
      log.warn('engine', 'WebGPU initialisation failed; falling back to WebGL2', e);
    }
  }
  const engine = new Engine(canvas, true, params, true);
  const backend: Backend = engine.webGLVersion >= 2 ? 'WebGL2' : 'WebGL1';
  if (backend === 'WebGL1') log.warn('engine', 'Only WebGL1 is available; visuals will be reduced');
  log.info('engine', `Using ${backend} backend`);
  return { engine, backend };
}

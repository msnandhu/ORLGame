/// <reference lib="webworker" />
import { handleMapRequest } from './mapCore';
export type { MapMeta } from './mapCore';

/** Renders the island map off the main thread (see mapCore.ts). */
self.onmessage = (e: MessageEvent) => {
  const r = handleMapRequest(e.data);
  if (r) (self as unknown as Worker).postMessage(r.msg, r.transfer);
};

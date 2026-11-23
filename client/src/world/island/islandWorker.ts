/// <reference lib="webworker" />
import { Island, OuterWorld } from '@orl/shared';
import { NodeBuilder, type NodeRequest } from './islandNode';

/** Builds island terrain nodes off the main thread. */
const builder = new NodeBuilder(new OuterWorld(new Island(), 1280));
self.postMessage({ type: 'ready' });
self.onmessage = (e: MessageEvent<NodeRequest>) => {
  const d = builder.build(e.data);
  (self as unknown as Worker).postMessage({ type: 'node', d }, [d.pos.buffer, d.nrm.buffer, d.col.buffer, d.splat.buffer, d.extra.buffer, d.trees.buffer]);
};

'use client';
import { lazy, Suspense, useSyncExternalStore } from 'react';
const Scene = lazy(() => import('./avatar-preview-scene').then((m) => ({ default: m.AvatarPreview })));
const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** Keep WebGL and Three.js outside the worker's server-rendered module graph. */
export function AvatarPreview(props: {
  color: string;
  anime: boolean;
  anonymous?: boolean;
  /** Идентификатор скина из lib/avatar-catalog; без него показываем «агента». */
  skin?: string;
  bandanaColor?: string;
}) {
  const mounted = useSyncExternalStore(subscribe, client, server);
  return <Suspense fallback={null}>{mounted ? <Scene {...props} /> : null}</Suspense>;
}

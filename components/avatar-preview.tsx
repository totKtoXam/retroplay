'use client';
import { useEffect, useRef } from 'react';
import * as T from 'three';
import { useResourcePack } from '../hooks/use-resource-pack';
import {
  createAvatar,
  animateAvatar,
  setAvatarStyle,
  setAvatarAnonymous,
} from './world-avatar';

/** Статический просмотр: кадр рисуется только при повороте или изменении размера. */
export function AvatarPreview({
  color,
  anime,
  anonymous = false,
}: {
  color: string;
  anime: boolean;
  anonymous?: boolean;
}) {
  const resourcePack = useResourcePack();
  const mount = useRef<HTMLDivElement>(null),
    turn = useRef<(angle: number) => void>(() => {});
  useEffect(() => {
    const host = mount.current!;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Трёхмерный просмотр вашего персонажа',
    );
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(36, 1, 0.1, 20);
    camera.position.set(0.2, 1.25, -3.7);
    camera.lookAt(0, 1.03, 0);
    scene.add(new T.HemisphereLight('#ecf8ff', '#44656b', 2.6));
    const key = new T.DirectionalLight('#fff1d2', 3);
    key.position.set(-2, 4, -3);
    scene.add(key);
    const rim = new T.DirectionalLight('#91d7ea', 2);
    rim.position.set(3, 2, 2);
    scene.add(rim);
    const avatar = createAvatar(color);
    scene.add(avatar);
    setAvatarStyle(avatar, anime);
    setAvatarAnonymous(avatar, anonymous);
    for (let i = 0; i < 45; i++)
      animateAvatar(
        avatar,
        {
          speed: 0,
          strafe: 0,
          forward: 1,
          airborne: false,
          velocityY: 0,
          stance: 'stand',
          tool: 'other',
          pitch: 0,
        },
        1 / 30,
        0,
      );
    const disk = new T.Mesh(
      new T.CylinderGeometry(0.65, 0.75, 0.06, 40),
      new T.MeshStandardMaterial({ color: '#9aaea6', roughness: 1 }),
    );
    disk.position.y = -0.04;
    scene.add(disk);
    const render = () => renderer.render(scene, camera);
    let disposed = false;
    let releasePack: (() => void) | undefined;
    if (resourcePack === 'realistic-bodycam') {
      void Promise.all([import('./resource-packs/realistic/materials'), import('./resource-packs/realistic/characters')]).then(([{ createRealisticMaterials }, { dressFieldCharacter }]) => {
        if (disposed) return;
        const library = createRealisticMaterials('low');
        const uniform = dressFieldCharacter(avatar, library);
        releasePack = () => { uniform.dispose(); library.dispose(); };
        render();
      }).catch((error) => console.error('Character preview pack failed', error));
    }
    turn.current = (angle) => {
      avatar.rotation.y += angle;
      render();
    };
    const resize = () => {
      const w = host.clientWidth,
        h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
      disposed = true; releasePack?.();
      observer.disconnect();
      turn.current = () => {};
      const geometries = new Set<T.BufferGeometry>(),
        materials = new Set<T.Material>();
      scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          geometries.add(o.geometry);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            materials.add(m),
          );
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [color, anime, anonymous, resourcePack]);
  return (
    <div className="agent-preview">
      <div ref={mount} className="agent-preview-canvas" />
      <div className="agent-preview-controls">
        <button
          onClick={() => turn.current(-Math.PI / 4)}
          aria-label="Повернуть персонажа влево"
        >
          ←
        </button>
        <span>{resourcePack === 'realistic-bodycam' ? 'FIELD / 01' : anime ? 'SORA' : 'AERO'} / ваш персонаж</span>
        <button
          onClick={() => turn.current(Math.PI / 4)}
          aria-label="Повернуть персонажа вправо"
        >
          →
        </button>
      </div>
    </div>
  );
}

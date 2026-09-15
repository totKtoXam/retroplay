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
import { applyAvatarSkin, attachCustomSkins } from './world-skins';

/** Статический просмотр: кадр рисуется только при повороте или изменении размера. */
export function AvatarPreview({
  color,
  anime,
  anonymous = false,
  skin = 'agent',
  bandanaColor = '#3b82f6',
}: {
  color: string;
  anime: boolean;
  anonymous?: boolean;
  skin?: string;
  bandanaColor?: string;
}) {
  const resourcePack = useResourcePack();
  const mount = useRef<HTMLDivElement>(null),
    turn = useRef<(angle: number) => void>(() => {});
  /**
   * Скин и бандана меняются чаще всего, а пересборка сцены гасит поворот модели и
   * заново создаёт WebGL-контекст. Поэтому они не в зависимостях эффекта сборки:
   * текущие значения лежат в `look`, а `applyLook` докрашивает уже собранный аватар.
   */
  const look = useRef({ skin, bandanaColor }),
    applyLook = useRef<(skin: string, bandanaColor: string) => void>(() => {});
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
    // Те же накладки, что и в игре: без них превью не знало ни о скинах, ни о бандане.
    const skins = attachCustomSkins(avatar);
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
    applyLook.current = (nextSkin, nextColor) => {
      applyAvatarSkin(avatar, nextSkin, nextColor, skins.bandanaMat);
      render();
    };
    applyLook.current(look.current.skin, look.current.bandanaColor);
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
    /*
     * Вращение перетаскиванием. Pointer Events покрывают мышь, перо и палец одним кодом,
     * а setPointerCapture доводит до нас и движение, и отпускание кнопки за пределами
     * канваса — иначе модель «залипала» бы в повороте. touch-action убирает прокрутку
     * страницы во время жеста. Стрелки рядом остаются: это доступ с клавиатуры.
     */
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    let dragging = -1,
      lastX = 0;
    const onDown = (e: PointerEvent) => {
      dragging = e.pointerId;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      // Ширина превью — полный оборот: жест ощущается как вращение предмета в руках.
      turn.current(((e.clientX - lastX) / Math.max(1, canvas.clientWidth)) * Math.PI * 2);
      lastX = e.clientX;
    };
    const onUp = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      dragging = -1;
      canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
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
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      turn.current = () => {};
      applyLook.current = () => {};
      skins.dispose();
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
  useEffect(() => {
    look.current = { skin, bandanaColor };
    applyLook.current(skin, bandanaColor);
  }, [skin, bandanaColor]);
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

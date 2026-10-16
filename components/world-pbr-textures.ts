import * as T from 'three';

/*
 * PBR-наборы «Зоны заражения»: public/textures/outbreak/<набор>/{albedo,normal,rough}.webp
 * (1024², нормали OpenGL +Y). Ими рисуются рельеф и дороги (components/world-terrain-material.ts,
 * components/world-roads.ts) и процедурные здания (components/world-proc-buildings.ts).
 * Каждый файл грузится один раз: наборы с другим повтором — копии текстур с общим
 * источником, видеокарта получает картинку тоже один раз.
 */

export type PbrTextureSet = {
  map: T.Texture;
  normalMap: T.Texture;
  roughnessMap: T.Texture;
};
export type TextureSetLoader = {
  /** Набор по id; текстуры возвращаются сразу и дорисовываются по мере загрузки. */
  get(setId: string, opts?: { repeat?: number }): PbrTextureSet;
  /** Дождаться всех уже запрошенных файлов (ошибки загрузки не роняют обещание). */
  whenLoaded(): Promise<void>;
  dispose(): void;
};

const ROOT = '/textures/outbreak';
const ANISOTROPY = 8;

/** URL одного файла набора: цвет (sRGB), нормали или шероховатость. */
export const textureSetUrl = (
  setId: string,
  kind: 'albedo' | 'normal' | 'rough',
) => `${ROOT}/${setId}/${kind}.webp`;

export function createTextureSetLoader(
  renderer?: T.WebGLRenderer,
): TextureSetLoader {
  const loader = new T.TextureLoader();
  const anisotropy = Math.min(
    ANISOTROPY,
    renderer?.capabilities.getMaxAnisotropy() ?? ANISOTROPY,
  );
  const files = new Map<string, T.Texture>();
  /** Копии с другим повтором: после загрузки файла их тоже надо отметить обновлёнными. */
  const copies = new Map<T.Texture, T.Texture[]>();
  const sets = new Map<string, PbrTextureSet>();
  const pending: Promise<unknown>[] = [];

  const file = (url: string, color: boolean) => {
    let texture = files.get(url);
    if (texture) return texture;
    let done!: () => void;
    pending.push(new Promise<void>((resolve) => (done = resolve)));
    texture = loader.load(
      url,
      (loaded) => {
        for (const c of copies.get(loaded) ?? []) c.needsUpdate = true;
        done();
      },
      undefined,
      () => {
        console.warn('Текстура не загрузилась', url);
        done();
      },
    );
    // Цвет — в sRGB, нормали и шероховатость — линейные данные.
    texture.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = anisotropy;
    files.set(url, texture);
    return texture;
  };

  return {
    get(setId, opts) {
      const repeat = opts?.repeat ?? 1;
      const key = `${setId}|${repeat}`;
      let set = sets.get(key);
      if (set) return set;
      const base = {
        map: file(textureSetUrl(setId, 'albedo'), true),
        normalMap: file(textureSetUrl(setId, 'normal'), false),
        roughnessMap: file(textureSetUrl(setId, 'rough'), false),
      };
      if (repeat === 1) set = base;
      else {
        // clone() делит с исходной текстурой источник (Source): картинка в памяти одна.
        const copy = (t: T.Texture) => {
          const c = t.clone();
          c.repeat.set(repeat, repeat);
          if (!t.image) {
            // Пока файла нет, копия не должна проситься на видеокарту (иначе three.js каждый
            // кадр предупреждает о пустой картинке): версию 0 он пропускает молча.
            c.version = 0;
            copies.set(t, [...(copies.get(t) ?? []), c]);
          }
          return c;
        };
        set = {
          map: copy(base.map),
          normalMap: copy(base.normalMap),
          roughnessMap: copy(base.roughnessMap),
        };
      }
      sets.set(key, set);
      return set;
    },
    whenLoaded: () => Promise.all(pending).then(() => undefined),
    dispose() {
      for (const set of sets.values())
        for (const t of Object.values(set)) t.dispose();
      for (const t of files.values()) t.dispose();
      sets.clear();
      files.clear();
    },
  };
}

import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoomState } from '@/lib/model';
import type { ArenaDef, GameMap } from '@/lib/maps/types';
import { createAvatar, setAvatarStyle } from './world-avatar';
import { createSurfaceLibrary } from './world-cinematic';
import type { WorldKit } from './world-map-scene';

/**
 * Scene for a team-battle map described by an ArenaDef (lib/maps). Everything static is
 * built from the same boxes, ramps and cylinders that the collision uses, then merged by
 * material to keep draw calls low.
 */
export function createArenaScene(map: GameMap & { arena: ArenaDef }): WorldKit {
  const def = map.arena;
  const surfaces = createSurfaceLibrary();
  const scene = new T.Scene();
  const statics = new T.Group();
  scene.add(statics);
  const mats = new Map<string, T.MeshStandardMaterial>();
  const material = (color: string) => {
    let m = mats.get(color);
    if (!m) {
      m = surfaces.material(color);
      mats.set(color, m);
    }
    return m;
  };
  const add = (geo: T.BufferGeometry, color: string, x: number, y: number, z: number) => {
    const m = new T.Mesh(geo, material(color));
    m.position.set(x, y, z);
    statics.add(m);
    return m;
  };
  const { minX, maxX, minZ, maxZ } = def.bounds;
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2,
    span = Math.max(maxX - minX, maxZ - minZ);

  const hemi = new T.HemisphereLight('#e1edff', '#6c6483', 0.7);
  scene.add(hemi);
  const sunlight = new T.DirectionalLight('#ffedce', 2.8);
  sunlight.position.set(cx - 30, 36, cz - 24);
  sunlight.target.position.set(cx, 0, cz);
  scene.add(sunlight.target);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  const half = span / 2 + 6;
  sunlight.shadow.camera.left = -half;
  sunlight.shadow.camera.right = half;
  sunlight.shadow.camera.top = half;
  sunlight.shadow.camera.bottom = -half;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 140;
  sunlight.shadow.bias = -0.0005;
  sunlight.shadow.normalBias = 0.035;
  scene.add(sunlight);
  const skyMaterial = new T.ShaderMaterial({
    uniforms: { top: { value: new T.Color('#76b6ed') }, bottom: { value: new T.Color('#e0dff4') } },
    vertexShader:
      'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:
      'uniform vec3 top;uniform vec3 bottom;varying vec3 vWorld;void main(){float h=clamp((normalize(vWorld).y+0.04)*1.5,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,pow(h,0.7)),1.0);}',
    side: T.BackSide,
    depthWrite: false,
  });
  scene.add(new T.Mesh(new T.SphereGeometry(180, 24, 16), skyMaterial));

  // Ground inside the walls and a wider backdrop outside them.
  add(new T.BoxGeometry(maxX - minX, 0.2, maxZ - minZ), def.groundColor, cx, -0.1, cz);
  add(new T.BoxGeometry(span + 200, 0.2, span + 200), def.outsideColor ?? '#6f7f63', cx, -0.14, cz);
  for (const b of def.boxes) add(new T.BoxGeometry(b.w, b.h, b.d), b.color, b.x, b.y, b.z);
  for (const r of def.ramps ?? []) {
    const run = r.to - r.from,
      rise = r.y1 - r.y0,
      slope = Math.hypot(run, rise);
    if (r.axis === 'z') {
      const m = add(new T.BoxGeometry(r.maxX - r.minX, 0.2, slope), r.color, (r.minX + r.maxX) / 2, (r.y0 + r.y1) / 2 - 0.1, (r.from + r.to) / 2);
      m.rotation.x = -Math.atan2(rise, run);
    } else {
      const m = add(new T.BoxGeometry(slope, 0.2, r.maxZ - r.minZ), r.color, (r.from + r.to) / 2, (r.y0 + r.y1) / 2 - 0.1, (r.minZ + r.maxZ) / 2);
      m.rotation.z = Math.atan2(rise, run);
    }
  }
  for (const c of def.cylinders ?? [])
    add(new T.CylinderGeometry(c.r, c.r, c.h, c.sides ?? 16), c.color, c.x, c.y, c.z);
  for (const s of def.spheres ?? []) add(new T.IcosahedronGeometry(s.r, 1), s.color, s.x, s.y, s.z);
  const waters: T.Mesh[] = [];
  for (const w of def.water ?? []) {
    const water = new T.Mesh(
      new T.PlaneGeometry(w.maxX - w.minX, w.maxZ - w.minZ),
      new T.MeshStandardMaterial({ color: w.color ?? '#3f7f96', roughness: 0.2, metalness: 0.4 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set((w.minX + w.maxX) / 2, w.y, (w.minZ + w.maxZ) / 2);
    water.receiveShadow = true;
    scene.add(water);
    waters.push(water);
  }
  for (const l of def.lights ?? []) {
    const light = new T.PointLight(l.color, l.intensity, l.distance);
    light.position.set(l.x, l.y, l.z);
    scene.add(light);
  }

  // Merge static meshes by material.
  statics.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  // A copy: meshes are removed from `statics` while iterating.
  for (const o of statics.children.slice()) {
    if (!(o instanceof T.Mesh) || Array.isArray(o.material)) continue;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    const list = buckets.get(o.material) ?? [];
    list.push(geo);
    buckets.set(o.material, list);
    o.removeFromParent();
    o.geometry.dispose();
  }
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    surfaces.projectUV(merged);
    const mesh = new T.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    statics.add(mesh);
  }

  const update = (s: RoomState) => {
    const night = s.time === 'night',
      sunset = s.time === 'sunset',
      dawn = s.time === 'dawn';
    const top = night ? '#111832' : sunset ? '#707cc0' : dawn ? '#999dcc' : '#79b8ed';
    const bottom = night ? '#3a3b69' : sunset ? '#edb6a9' : dawn ? '#efcbd4' : '#d2dfef';
    skyMaterial.uniforms.top.value.set(top);
    skyMaterial.uniforms.bottom.value.set(bottom);
    scene.fog = new T.Fog(night ? '#18242d' : sunset ? '#b5a18c' : '#9fb6c2', 45, 170);
    hemi.intensity = night ? 0.35 : 0.7;
    hemi.color.set(night ? '#98b6ff' : '#e6edff');
    sunlight.intensity = night ? 0.5 : sunset ? 2.2 : 2.8;
    sunlight.color.set(sunset ? '#ffb687' : night ? '#98acff' : '#ffedce');
    sunlight.position.set(cx - 30, sunset ? 10 : night ? 20 : 36, cz - 24);
    sunlight.shadow.needsUpdate = true;
  };
  const avatarFactory = (color: string) => {
    const avatar = createAvatar(color);
    avatar.name = 'player-avatar';
    setAvatarStyle(avatar, false);
    return avatar;
  };
  return {
    scene,
    boards: [],
    colliders: map.colliders,
    stations: [],
    avatarFactory,
    update,
    setNotes: () => {},
    clouds: new T.Group(),
    sunlight,
    animate: () => {},
    dispose: () => {
      surfaces.dispose();
      waters.forEach((w) => {
        w.geometry.dispose();
        (w.material as T.Material).dispose();
      });
    },
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createMaterialPool } from '../components/material-pool.ts';

function tracked() {
  const disposed = new Set();
  const create = () => {
    const m = new T.MeshBasicMaterial();
    m.addEventListener('dispose', () => disposed.add(m));
    return m;
  };
  return { disposed, create };
}

test('освобождённый материал не удаляется, а достаётся следующему эффекту', () => {
  const { disposed, create } = tracked();
  const pool = createMaterialPool(create);
  const first = pool.acquire();
  pool.release(first);
  assert.equal(disposed.size, 0, 'иначе Three.js удалит шейдерную программу');
  assert.equal(pool.acquire(), first);
});

test('лишние свободные материалы сверх лимита освобождаются', () => {
  const { disposed, create } = tracked();
  const pool = createMaterialPool(create, 2);
  const taken = [pool.acquire(), pool.acquire(), pool.acquire()];
  taken.forEach((m) => pool.release(m));
  assert.equal(pool.idle, 2);
  assert.deepEqual([...disposed], [taken[2]]);
});

test('повторный release не кладёт материал в пул дважды', () => {
  const { create } = tracked();
  const pool = createMaterialPool(create);
  const m = pool.acquire();
  pool.release(m);
  pool.release(m);
  assert.equal(pool.idle, 1);
  assert.notEqual(pool.acquire(), pool.acquire());
});

test('dispose освобождает свободные, а возвращённые после него — сразу', () => {
  const { disposed, create } = tracked();
  const pool = createMaterialPool(create);
  const idle = pool.acquire();
  const busy = pool.acquire();
  pool.release(idle);
  pool.dispose();
  assert.ok(disposed.has(idle));
  assert.ok(!disposed.has(busy));
  pool.release(busy);
  assert.ok(disposed.has(busy));
  assert.equal(pool.idle, 0);
});

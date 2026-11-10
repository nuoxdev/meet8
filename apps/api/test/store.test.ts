import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore, PostgresStore, type Store } from '../src/store.js';
async function contract(store: Store) {
  const marker = randomUUID();
  await store.transaction((s) => {
    s.users.push({
      id: marker,
      email: `${marker}@example.com`,
      name: 'Persistent person',
      createdAt: new Date().toISOString(),
    });
  });
  await assert.rejects(() =>
    store.transaction((s) => {
      s.users.find((u) => u.id === marker)!.name = 'Must roll back';
      throw new Error('rollback');
    }),
  );
  assert.equal(
    await store.transaction((s) => s.users.find((u) => u.id === marker)!.name),
    'Persistent person',
  );
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.transaction((s) => {
        s.audit.push({
          id: randomUUID(),
          actor: marker,
          action: 'concurrent',
          target: String(i),
          createdAt: new Date().toISOString(),
        });
      }),
    ),
  );
  assert.equal(
    await store.transaction((s) => s.audit.filter((a) => a.actor === marker).length),
    10,
  );
  return marker;
}
test('memory repository rolls back failed transactions and serializes concurrent writes', async () => {
  const store = new MemoryStore();
  await contract(store);
});
test(
  'PostgreSQL transactions persist across connections and roll back atomically',
  { skip: !process.env.MEET8_TEST_DATABASE_URL },
  async () => {
    const store = new PostgresStore(process.env.MEET8_TEST_DATABASE_URL!);
    await store.initialize();
    try {
      const marker = await contract(store);
      const second = new PostgresStore(process.env.MEET8_TEST_DATABASE_URL!);
      try {
        assert.equal(
          await second.transaction((s) => s.users.find((u) => u.id === marker)!.name),
          'Persistent person',
        );
      } finally {
        await second.close();
      }
    } finally {
      await store.close();
    }
  },
);

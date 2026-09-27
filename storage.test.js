const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const storageStart = html.indexOf('const APP_STORAGE = (() => {');
const storageEnd = html.indexOf('\n})();', storageStart) + 6;
assert.ok(storageStart >= 0 && storageEnd > storageStart);
const createStorage = new Function('window', 'setTimeout', 'clearTimeout', `${html.slice(storageStart, storageEnd)}; return APP_STORAGE;`);

function makeLocalStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); }
  };
}

function makeIndexedDB(records) {
  return {
    open() {
      const request = {};
      const db = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
          const tx = {
            objectStore() {
              return {
                getAll() {
                  const read = {};
                  queueMicrotask(() => { read.result = [...records].map(([key, value]) => ({ key, value })); read.onsuccess?.(); });
                  return read;
                },
                put({ key, value }) { records.set(key, value); queueMicrotask(() => tx.oncomplete?.()); },
                delete(key) { records.delete(key); queueMicrotask(() => tx.oncomplete?.()); }
              };
            }
          };
          return tx;
        }
      };
      queueMicrotask(() => { request.result = db; request.onsuccess?.(); });
      return request;
    }
  };
}

test('progress survives a second visit through localStorage', async () => {
  const localStorage = makeLocalStorage();
  const first = createStorage({ localStorage }, setTimeout, clearTimeout);
  await first.ready;
  first.setItem('paradox_sp_max_v11', 14);
  first.setItem('paradox_skin', 6);
  const second = createStorage({ localStorage }, setTimeout, clearTimeout);
  await second.ready;
  assert.equal(second.getItem('paradox_sp_max_v11'), '14');
  assert.equal(second.getItem('paradox_skin'), '6');
  assert.equal(second.persistent, true);
});

test('IndexedDB restores progress when localStorage is denied', async () => {
  const records = new Map([['paradox_sp_max_v11', '9']]);
  const window = { get localStorage() { throw Error('denied'); }, indexedDB: makeIndexedDB(records) };
  const first = createStorage(window, setTimeout, clearTimeout);
  await first.ready;
  assert.equal(first.getItem('paradox_sp_max_v11'), '9');
  assert.equal(first.persistent, true);
  first.setItem('paradox_sp_max_v11', 10);
  await first.flush();
  const second = createStorage(window, setTimeout, clearTimeout);
  await second.ready;
  assert.equal(second.getItem('paradox_sp_max_v11'), '10');
});

test('progress from older campaign keys is migrated without moving backwards', async () => {
  const localStorage = makeLocalStorage();
  localStorage.setItem('paradox_sp_max_v10', 18);
  localStorage.setItem('paradox_sp_max_v11', 7);
  localStorage.setItem('paradox_mp_max_v9', 4);
  const storage = createStorage({ localStorage }, setTimeout, clearTimeout);
  await storage.ready;
  const start = html.indexOf('function migrateProgress(){');
  const end = html.indexOf('\n}', start) + 2;
  const migrate = new Function('APP_STORAGE', 'MP_LEVELS', `${html.slice(start, end)}; return migrateProgress;`)(storage, Array(20));
  migrate();
  assert.equal(storage.getItem('paradox_sp_max_v11'), '18');
  assert.equal(storage.getItem('paradox_mp_max_v10'), '4');
});

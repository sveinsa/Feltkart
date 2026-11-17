// Enkel lagring i nettleseren (IndexedDB).
// Byttes ut med et API mot en server når løsningen skal ha flere brukere – se README.
import type { Folder, Item, Settings } from '../types';

import { dbNameForActive } from './projects';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbNameForActive(), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const db = {
  getFolders: () => run<Folder[]>('folders', 'readonly', (s) => s.getAll()),
  putFolder: (f: Folder) => run<void>('folders', 'readwrite', (s) => s.put(f)),
  deleteFolder: (id: string) => run<void>('folders', 'readwrite', (s) => s.delete(id)),

  getItems: () => run<Item[]>('items', 'readonly', (s) => s.getAll()),
  putItem: (i: Item) => run<void>('items', 'readwrite', (s) => s.put(i)),
  deleteItem: (id: string) => run<void>('items', 'readwrite', (s) => s.delete(id)),

  getSettings: () => run<Settings | undefined>('settings', 'readonly', (s) => s.get('main')),
  putSettings: (v: Settings) => run<void>('settings', 'readwrite', (s) => s.put(v, 'main')),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

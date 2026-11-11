// Copia local (IndexedDB) de la bóveda para verla sin conexión.
import type { VaultItem } from './types';

const DB_NAME = 'moto-vault';
const FILES = 'files';
const META = 'meta';

function openDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
                if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            req.onsuccess = () => resolve((req.result as T) ?? null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export const putFile = (id: string, blob: Blob) => run(FILES, 'readwrite', (s) => s.put(blob, id));
export const getFile = (id: string) => run<Blob>(FILES, 'readonly', (s) => s.get(id));
export const deleteFile = (id: string) => run(FILES, 'readwrite', (s) => s.delete(id));
export const putMeta = (userId: string, items: VaultItem[]) => run(META, 'readwrite', (s) => s.put(items, userId));
export const getMeta = (userId: string) => run<VaultItem[]>(META, 'readonly', (s) => s.get(userId));

export function base64ToBlob(data: string, mimeType: string): Blob {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const s = String(r.result);
            resolve(s.slice(s.indexOf(',') + 1));
        };
        r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        r.readAsDataURL(blob);
    });
}

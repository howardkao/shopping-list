/**
 * IndexedDB-based offline storage for shopping list data
 * Provides local persistence so the app works without connectivity
 */

const DB_NAME = 'shopping-list-offline';
const DB_VERSION = 2;
const STORES = {
  SHOPPING_LIST: 'shoppingList',
  SYNC_QUEUE: 'syncQueue',
  META: 'meta'
};
const DROPPED_STORES = ['shoppingHistory', 'commonItems', 'lessCommonItems'];

let db = null;
/** After a failed open, skip IndexedDB for the rest of the session (avoids console spam on every save). */
let offlineIdbDisabled = false;
let offlineIdbWarned = false;

function warnOfflineIdbOnce(error) {
  if (offlineIdbWarned) return;
  offlineIdbWarned = true;
  console.warn(
    '[shopping-list] IndexedDB unavailable; offline cache is disabled until you reload the tab.',
    error?.message || error
  );
}

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase | null>}
 */
export async function initOfflineDB() {
  if (offlineIdbDisabled) return null;
  if (db) return db;

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      offlineIdbDisabled = true;
      db = null;
      warnOfflineIdbOnce(request.error);
      resolve(null);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORES.SHOPPING_LIST)) {
        database.createObjectStore(STORES.SHOPPING_LIST, { keyPath: 'key' });
      }

      if (!database.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const syncStore = database.createObjectStore(STORES.SYNC_QUEUE, {
          keyPath: 'id',
          autoIncrement: true
        });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!database.objectStoreNames.contains(STORES.META)) {
        database.createObjectStore(STORES.META, { keyPath: 'key' });
      }

      for (const name of DROPPED_STORES) {
        if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name);
      }
    };
  });
}

/**
 * Get a value from the specified store
 */
async function getFromStore(storeName, key) {
  const database = await initOfflineDB();
  if (!database) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result?.data);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a value to the specified store
 */
async function saveToStore(storeName, key, data) {
  const database = await initOfflineDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put({ key, data, updatedAt: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save shopping list to local storage
 */
export async function saveShoppingListLocally(items) {
  try {
    await saveToStore(STORES.SHOPPING_LIST, 'current', items);
    await saveToStore(STORES.META, 'lastSync', {
      shoppingList: Date.now()
    });
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
  }
}

/**
 * Load shopping list from local storage
 */
export async function loadShoppingListLocally() {
  try {
    return await getFromStore(STORES.SHOPPING_LIST, 'current') ?? null;
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
    return null;
  }
}

/**
 * Get the last sync timestamp
 */
export async function getLastSyncTime() {
  try {
    const meta = await getFromStore(STORES.META, 'lastSync');
    return meta?.shoppingList || null;
  } catch (error) {
    return null;
  }
}

/**
 * Save the last used quantity per item name so re-added items can reuse it.
 */
export async function saveQuantityDefaultsLocally(quantityDefaults) {
  try {
    await saveToStore(STORES.META, 'quantityDefaults', quantityDefaults);
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
  }
}

/**
 * Load the last used quantity per item name.
 */
export async function loadQuantityDefaultsLocally() {
  try {
    return await getFromStore(STORES.META, 'quantityDefaults') ?? null;
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
    return null;
  }
}

/**
 * Queue an operation for sync when back online
 */
export async function queueSyncOperation(operation) {
  const database = await initOfflineDB();
  if (!database) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.add({
      ...operation,
      timestamp: Date.now()
    });

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all queued sync operations
 */
export async function getQueuedSyncOperations() {
  const database = await initOfflineDB();
  if (!database) return [];

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear a sync operation after successful sync
 */
export async function clearSyncOperation(id) {
  const database = await initOfflineDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all sync operations
 */
export async function clearAllSyncOperations() {
  const database = await initOfflineDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if there are pending sync operations
 */
export async function hasPendingSyncOperations() {
  const operations = await getQueuedSyncOperations();
  return operations.length > 0;
}

/**
 * Save cached user info (for offline-first auth)
 */
export async function saveCachedUser(userInfo) {
  const database = await initOfflineDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.META, 'readwrite');
    const store = transaction.objectStore(STORES.META);
    const request = store.put({
      key: 'cachedUser',
      ...userInfo,
      cachedAt: Date.now()
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load cached user info (for offline-first auth)
 */
export async function loadCachedUser() {
  try {
    const database = await initOfflineDB();
    if (!database) return null;

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORES.META, 'readonly');
      const store = transaction.objectStore(STORES.META);
      const request = store.get('cachedUser');
      request.onsuccess = () => {
        const record = request.result;
        if (!record) { resolve(null); return; }
        // saveCachedUser spreads userInfo directly (uid, email, isAdmin, cachedAt)
        // so we extract those fields, not a nested .data property
        const { key, cachedAt, ...userInfo } = record;
        resolve(Object.keys(userInfo).length > 0 ? userInfo : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
    return null;
  }
}

/**
 * Save the v2 taxonomy snapshot to local storage.
 * Include `householdId` on the object so we never hydrate another household's
 * aisle/category id graph into the wrong account (would orphan every category).
 */
export async function saveTaxonomyV2Locally(taxonomy) {
  try {
    await saveToStore(STORES.META, 'taxonomyV2', taxonomy);
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
  }
}

/**
 * Load the v2 taxonomy snapshot from local storage.
 */
export async function loadTaxonomyV2Locally() {
  try {
    return await getFromStore(STORES.META, 'taxonomyV2') ?? null;
  } catch (error) {
    offlineIdbDisabled = true;
    warnOfflineIdbOnce(error);
    return null;
  }
}

/**
 * Clear cached user info (on explicit logout)
 */
export async function clearCachedUser() {
  const database = await initOfflineDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES.META, 'readwrite');
    const store = transaction.objectStore(STORES.META);
    const request = store.delete('cachedUser');

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB-based offline storage for shopping list data
 * Provides local persistence so the app works without connectivity
 */

const DB_NAME = 'shopping-list-offline';
const DB_VERSION = 1;
const STORES = {
  SHOPPING_LIST: 'shoppingList',
  SHOPPING_HISTORY: 'shoppingHistory',
  COMMON_ITEMS: 'commonItems',
  LESS_COMMON_ITEMS: 'lessCommonItems',
  SYNC_QUEUE: 'syncQueue',
  META: 'meta'
};

let db = null;

/**
 * Initialize the IndexedDB database
 */
export async function initOfflineDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Store for shopping list items
      if (!database.objectStoreNames.contains(STORES.SHOPPING_LIST)) {
        database.createObjectStore(STORES.SHOPPING_LIST, { keyPath: 'key' });
      }

      // Store for shopping history
      if (!database.objectStoreNames.contains(STORES.SHOPPING_HISTORY)) {
        database.createObjectStore(STORES.SHOPPING_HISTORY, { keyPath: 'key' });
      }

      // Store for common items by category
      if (!database.objectStoreNames.contains(STORES.COMMON_ITEMS)) {
        database.createObjectStore(STORES.COMMON_ITEMS, { keyPath: 'category' });
      }

      // Store for less common items by category
      if (!database.objectStoreNames.contains(STORES.LESS_COMMON_ITEMS)) {
        database.createObjectStore(STORES.LESS_COMMON_ITEMS, { keyPath: 'category' });
      }

      // Store for queued operations to sync when back online
      if (!database.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const syncStore = database.createObjectStore(STORES.SYNC_QUEUE, {
          keyPath: 'id',
          autoIncrement: true
        });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Store for metadata (last sync time, etc.)
      if (!database.objectStoreNames.contains(STORES.META)) {
        database.createObjectStore(STORES.META, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Get a value from the specified store
 */
async function getFromStore(storeName, key) {
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
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
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
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
    console.error('Failed to save shopping list locally:', error);
  }
}

/**
 * Load shopping list from local storage
 */
export async function loadShoppingListLocally() {
  try {
    return await getFromStore(STORES.SHOPPING_LIST, 'current');
  } catch (error) {
    console.error('Failed to load shopping list locally:', error);
    return null;
  }
}

/**
 * Save shopping history to local storage
 */
export async function saveShoppingHistoryLocally(history) {
  try {
    await saveToStore(STORES.SHOPPING_HISTORY, 'current', history);
  } catch (error) {
    console.error('Failed to save shopping history locally:', error);
  }
}

/**
 * Load shopping history from local storage
 */
export async function loadShoppingHistoryLocally() {
  try {
    return await getFromStore(STORES.SHOPPING_HISTORY, 'current');
  } catch (error) {
    console.error('Failed to load shopping history locally:', error);
    return null;
  }
}

/**
 * Save common items for a category to local storage
 */
export async function saveCommonItemsLocally(category, items) {
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.COMMON_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORES.COMMON_ITEMS);
    const request = store.put({ category, items, updatedAt: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load all common items from local storage
 */
export async function loadAllCommonItemsLocally() {
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.COMMON_ITEMS, 'readonly');
    const store = transaction.objectStore(STORES.COMMON_ITEMS);
    const request = store.getAll();

    request.onsuccess = () => {
      const result = {};
      for (const item of request.result || []) {
        result[item.category] = item.items;
      }
      resolve(result);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save less common items for a category to local storage
 */
export async function saveLessCommonItemsLocally(category, items) {
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.LESS_COMMON_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORES.LESS_COMMON_ITEMS);
    const request = store.put({ category, items, updatedAt: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load all less common items from local storage
 */
export async function loadAllLessCommonItemsLocally() {
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.LESS_COMMON_ITEMS, 'readonly');
    const store = transaction.objectStore(STORES.LESS_COMMON_ITEMS);
    const request = store.getAll();

    request.onsuccess = () => {
      const result = {};
      for (const item of request.result || []) {
        result[item.category] = item.items;
      }
      resolve(result);
    };
    request.onerror = () => reject(request.error);
  });
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
 * Queue an operation for sync when back online
 */
export async function queueSyncOperation(operation) {
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
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
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readonly');
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
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
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
  await initOfflineDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
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

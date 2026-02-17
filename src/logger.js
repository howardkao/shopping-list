/**
 * Production-ready centralized logging system
 * Automatically captures client-side logs and stores them in Firebase
 * with 30-day rolling retention
 */

import { ref, push, serverTimestamp, query, orderByChild, endAt, get, remove } from 'firebase/database';
import { database } from './firebase';

const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

// Determine if we're in production
const IS_PRODUCTION = import.meta.env.PROD;

// Generate a unique session ID for this app session
const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// In-memory log buffer (for admin log viewer)
const logBuffer = [];
const MAX_BUFFER_SIZE = 500;

// Log batch for efficient Firebase writes
const logBatch = [];
const MAX_BATCH_SIZE = 10;
const BATCH_FLUSH_INTERVAL = 5000; // 5 seconds
let batchFlushTimer = null;

// Periodic sync to ensure logs reach server
const PERIODIC_SYNC_INTERVAL = 60000; // 1 minute
let periodicSyncTimer = null;

// IndexedDB for offline logging
const DB_NAME = 'shopping-list-logs';
const DB_VERSION = 1;
const LOG_STORE = 'logs';

let logDB = null;
let currentUserId = null;
let logListeners = [];

// Log retention (30 days)
const LOG_RETENTION_DAYS = 30;
const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Initialize the logging database
 */
async function initLogDB() {
  if (logDB) return logDB;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open logs IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      logDB = request.result;
      resolve(logDB);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(LOG_STORE)) {
        const store = db.createObjectStore(LOG_STORE, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('level', 'level', { unique: false });
        store.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };
  });
}

/**
 * Save log entry to IndexedDB
 */
async function saveLogLocally(entry) {
  try {
    await initLogDB();

    return new Promise((resolve, reject) => {
      const transaction = logDB.transaction(LOG_STORE, 'readwrite');
      const store = transaction.objectStore(LOG_STORE);
      const request = store.add(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    // Don't throw - logging should never break the app
    console.error('Failed to save log locally:', error);
  }
}

/**
 * Save log entry to Firebase (batched for efficiency)
 */
async function saveLogToFirebase(entry) {
  if (!currentUserId || !database) return;

  // In production, only log INFO, WARN, and ERROR to Firebase (not DEBUG)
  if (IS_PRODUCTION && entry.level === LOG_LEVELS.DEBUG) {
    return;
  }

  // Add to batch
  logBatch.push(entry);

  // Flush if batch is full
  if (logBatch.length >= MAX_BATCH_SIZE) {
    await flushLogBatch();
  } else {
    // Schedule flush
    if (batchFlushTimer) {
      clearTimeout(batchFlushTimer);
    }
    batchFlushTimer = setTimeout(flushLogBatch, BATCH_FLUSH_INTERVAL);
  }
}

/**
 * Flush log batch to Firebase
 */
async function flushLogBatch() {
  if (batchFlushTimer) {
    clearTimeout(batchFlushTimer);
    batchFlushTimer = null;
  }

  if (logBatch.length === 0 || !currentUserId || !database) {
    return;
  }

  const logsToSend = [...logBatch];
  logBatch.length = 0; // Clear batch

  try {
    const logsRef = ref(database, `logs/${currentUserId}/${SESSION_ID}`);

    // Send all logs in batch
    for (const entry of logsToSend) {
      await push(logsRef, {
        ...entry,
        serverTimestamp: serverTimestamp()
      });
    }
  } catch (error) {
    // Don't throw - logging should never break the app
    console.error('Failed to flush log batch to Firebase:', error);
    // Put logs back in batch for retry
    logBatch.unshift(...logsToSend);
  }
}

/**
 * Core logging function
 */
async function log(level, category, message, data = {}) {
  const timestamp = Date.now();
  const entry = {
    timestamp,
    sessionId: SESSION_ID,
    level,
    category,
    message,
    data,
    url: window.location.href,
    userAgent: navigator.userAgent
  };

  // Add to in-memory buffer
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift();
  }

  // Notify listeners (for debug panel)
  logListeners.forEach(listener => {
    try {
      listener(entry);
    } catch (e) {
      // Ignore listener errors
    }
  });

  // Console output with color coding
  const color = {
    debug: '#999',
    info: '#0066cc',
    warn: '#ff9900',
    error: '#cc0000'
  }[level] || '#000';

  console.log(
    `%c[${new Date(timestamp).toISOString()}] [${category}] ${message}`,
    `color: ${color}; font-weight: ${level === 'error' ? 'bold' : 'normal'}`,
    data
  );

  // Save to IndexedDB and Firebase (async, don't wait)
  saveLogLocally(entry).catch(() => {});
  saveLogToFirebase(entry).catch(() => {});
}

/**
 * Clean up old logs from Firebase (30+ days old)
 */
async function cleanupOldFirebaseLogs() {
  if (!currentUserId || !database) {
    return;
  }

  try {
    const logsRef = ref(database, `logs/${currentUserId}`);
    const snapshot = await get(logsRef);

    if (!snapshot.exists()) {
      return;
    }

    const sessions = snapshot.val();
    const cutoffTime = Date.now() - LOG_RETENTION_MS;
    let deletedCount = 0;

    // Iterate through sessions and delete old ones
    for (const [sessionId, sessionLogs] of Object.entries(sessions)) {
      // Check if any log in this session is older than cutoff
      const logs = Object.values(sessionLogs || {});
      if (logs.length === 0) continue;

      const oldestLog = logs.reduce((oldest, log) => {
        return log.timestamp < oldest.timestamp ? log : oldest;
      }, logs[0]);

      if (oldestLog.timestamp < cutoffTime) {
        // Delete entire session
        await remove(ref(database, `logs/${currentUserId}/${sessionId}`));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info('Logger', 'Cleaned up old log sessions', {
        deletedSessions: deletedCount,
        cutoffDate: new Date(cutoffTime).toISOString()
      });
    }
  } catch (error) {
    console.error('Failed to cleanup old Firebase logs:', error);
  }
}

/**
 * Public logging API
 */
export const logger = {
  debug: (category, message, data) => log(LOG_LEVELS.DEBUG, category, message, data),
  info: (category, message, data) => log(LOG_LEVELS.INFO, category, message, data),
  warn: (category, message, data) => log(LOG_LEVELS.WARN, category, message, data),
  error: (category, message, data) => log(LOG_LEVELS.ERROR, category, message, data),

  /**
   * Set the current user ID (for Firebase logging)
   */
  setUserId: (userId) => {
    currentUserId = userId;
    logger.info('Logger', 'User ID set', { userId, sessionId: SESSION_ID });

    // Clean up old logs when user logs in (runs in background)
    setTimeout(() => {
      cleanupOldFirebaseLogs();
      logger.clearOldLogs(LOG_RETENTION_DAYS);
    }, 10000); // Wait 10 seconds after login
  },

  /**
   * Flush any pending logs to Firebase
   */
  flush: async () => {
    await flushLogBatch();
  },

  /**
   * Get session ID
   */
  getSessionId: () => SESSION_ID,

  /**
   * Get all logs from buffer
   */
  getBufferedLogs: () => [...logBuffer],

  /**
   * Subscribe to new log entries
   */
  subscribe: (listener) => {
    logListeners.push(listener);
    return () => {
      logListeners = logListeners.filter(l => l !== listener);
    };
  },

  /**
   * Get logs from IndexedDB
   */
  getLocalLogs: async (limit = 1000) => {
    try {
      await initLogDB();

      return new Promise((resolve, reject) => {
        const transaction = logDB.transaction(LOG_STORE, 'readonly');
        const store = transaction.objectStore(LOG_STORE);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev'); // Newest first

        const results = [];
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get local logs:', error);
      return [];
    }
  },

  /**
   * Get logs from Firebase for a specific user and date range
   */
  getFirebaseLogs: async (userId, startDate = null, endDate = null) => {
    if (!database) return [];

    try {
      const logsRef = ref(database, `logs/${userId}`);
      const snapshot = await get(logsRef);

      if (!snapshot.exists()) {
        return [];
      }

      const sessions = snapshot.val();
      const allLogs = [];

      // Collect all logs from all sessions
      for (const [sessionId, sessionLogs] of Object.entries(sessions)) {
        for (const [logId, log] of Object.entries(sessionLogs || {})) {
          if (startDate && log.timestamp < startDate) continue;
          if (endDate && log.timestamp > endDate) continue;
          allLogs.push({ ...log, sessionId, logId });
        }
      }

      // Sort by timestamp (newest first)
      allLogs.sort((a, b) => b.timestamp - a.timestamp);

      return allLogs;
    } catch (error) {
      console.error('Failed to get Firebase logs:', error);
      return [];
    }
  },

  /**
   * Clear old logs from IndexedDB
   */
  clearOldLogs: async (daysToKeep = LOG_RETENTION_DAYS) => {
    try {
      await initLogDB();
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      return new Promise((resolve, reject) => {
        const transaction = logDB.transaction(LOG_STORE, 'readwrite');
        const store = transaction.objectStore(LOG_STORE);
        const index = store.index('timestamp');
        const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));

        let deletedCount = 0;
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            if (deletedCount > 0) {
              console.log(`Cleaned up ${deletedCount} old log entries from IndexedDB`);
            }
            resolve(deletedCount);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to clear old logs:', error);
    }
  },

  /**
   * Export logs as JSON
   */
  exportLogs: async () => {
    const logs = await logger.getLocalLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shopping-list-logs-${SESSION_ID}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
};

// Initialize logging DB on load
initLogDB().catch(() => {});

// Log startup
logger.info('App', 'Application started', {
  sessionId: SESSION_ID,
  timestamp: Date.now(),
  online: navigator.onLine,
  userAgent: navigator.userAgent,
  isProduction: IS_PRODUCTION
});

// Monitor online/offline status
window.addEventListener('online', () => {
  logger.info('Network', 'Browser online event', {
    navigatorOnLine: navigator.onLine
  });
});

window.addEventListener('offline', () => {
  logger.warn('Network', 'Browser offline event', {
    navigatorOnLine: navigator.onLine
  });
});

// Monitor visibility changes
document.addEventListener('visibilitychange', () => {
  logger.info('App', 'Visibility changed', {
    hidden: document.hidden,
    visibilityState: document.visibilityState
  });

  // Flush logs when page is hidden (user leaving)
  if (document.hidden) {
    flushLogBatch();
  }
});

// Flush logs before page unload
window.addEventListener('beforeunload', () => {
  flushLogBatch();
});

// Start periodic sync when online
function startPeriodicSync() {
  if (periodicSyncTimer) {
    clearInterval(periodicSyncTimer);
  }

  periodicSyncTimer = setInterval(() => {
    if (navigator.onLine && currentUserId) {
      flushLogBatch();
    }
  }, PERIODIC_SYNC_INTERVAL);
}

// Start periodic sync immediately
startPeriodicSync();

// Restart periodic sync when coming back online
window.addEventListener('online', () => {
  startPeriodicSync();
  flushLogBatch(); // Immediate flush when back online
});

// Periodic cleanup (once per day)
setInterval(() => {
  if (currentUserId) {
    cleanupOldFirebaseLogs();
    logger.clearOldLogs(LOG_RETENTION_DAYS);
  }
}, 24 * 60 * 60 * 1000); // Every 24 hours

// Catch unhandled errors
window.addEventListener('error', (event) => {
  logger.error('Error', 'Unhandled error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.stack
  });
});

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Error', 'Unhandled promise rejection', {
    reason: event.reason,
    promise: event.promise
  });
});

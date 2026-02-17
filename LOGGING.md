# Production Logging System

## Overview

This app includes a production-ready logging system that automatically captures client-side events and stores them in Firebase for 30 days. This provides rich diagnostic data for debugging authentication and network issues, plus **automated analytics** to identify patterns across all users.

## Features

### ✅ Automatic Log Collection
- **Always enabled** - No manual intervention needed
- **Client-side logging** - Captures all important app events
- **Batched writes** - Efficient Firebase usage (batches up to 10 logs or every 5 seconds)
- **Periodic sync** - Logs sync to Firebase every minute (even without user actions)
- **Immediate sync on reconnect** - Flushes pending logs when network returns
- **Offline support** - Logs stored in IndexedDB when offline, synced when back online
- **30-day retention** - Automatically cleaned up daily

### 🔍 Automated Analytics
- **Aggregated insights** - Analyze logs from all users at once
- **Common issue detection** - Automatically identifies recurring problems
- **User impact tracking** - Shows how many users are affected by each issue
- **Statistics dashboard** - Total events, errors, warnings, active users
- **Error categorization** - Auth, Network, Sync issues tracked separately

### 📊 What Gets Logged

**Authentication Events:**
- Login/logout attempts and results
- Sign-up flow with invite code validation
- Token refresh attempts and failures
- Cached user load/save operations
- Auth state changes

**Network & Connection:**
- Browser online/offline events
- Firebase `.info/connected` state changes
- Visibility changes (app backgrounded/foregrounded)
- Network state vs reported state

**Data Synchronization:**
- Firebase read/write operations with timing
- IndexedDB operations
- Pending operations count changes
- Sync success/failure with error details

**Errors:**
- Unhandled errors with stack traces
- Unhandled promise rejections
- Failed operations with context

**App Lifecycle:**
- Application start/stop
- Session IDs for tracking user sessions
- User agent and environment info

### 🔒 Security

- **User-scoped logs** - Each user can only read/write their own logs
- **Firebase security rules** - Enforced at database level
- **No sensitive data** - Passwords and tokens are never logged

### 📈 Log Levels

**Development Mode:**
- DEBUG, INFO, WARN, ERROR all logged to console and IndexedDB
- Only INFO, WARN, ERROR sent to Firebase

**Production Mode:**
- Only INFO, WARN, ERROR logged (no DEBUG)
- Minimal performance impact

### 💾 Storage

**IndexedDB (Client-side):**
- All log levels stored locally
- Used for offline access
- Cleaned up after 30 days

**Firebase Realtime Database (Server-side):**
- Structure: `/logs/{userId}/{sessionId}/{logId}`
- INFO, WARN, ERROR levels only
- Cleaned up after 30 days
- Accessible remotely for debugging

## Usage

### For Admins

#### Log Analytics (Recommended)

**For understanding overall app health and finding patterns:**

1. **Sign in as admin**
2. **Open menu** → Click "Admin Panel"
3. **Click "Log Analytics (All Users)"**

This shows aggregated insights including:
- **Statistics**: Total events, active users, error counts
- **Common Issues**: Automatically grouped by category and message, sorted by frequency
- **Impact Analysis**: How many users and occurrences for each issue
- **Recent Errors**: Latest errors across all users
- **Date Range**: Filter by 24h, 7d, 14d, or 30d
- **Export**: Download full analysis as JSON

**Use this view to:**
- Identify widespread issues affecting multiple users
- Spot patterns in auth or network failures
- Monitor overall app health
- Track recurring problems

#### Individual User Logs (For Real-time Debugging)

**For debugging a specific user's current session:**

1. **Sign in as admin**
2. **Open menu** → Click "Admin Panel"
3. **Click "My Logs (Real-time)"**

This shows your own logs from Firebase with:
- Date range filter (24 hours, 7 days, 14 days, 30 days)
- Log level filter (Debug, Info, Warn, Error)
- Category filter (Auth, Network, Firebase, Sync, etc.)
- Search functionality
- Export to JSON

#### Real-time Debug Panel (Admin Only)

Access via:
- **Floating bug icon** (bottom-left corner) - visible only to admins
- **Keyboard shortcut**: `Ctrl+Shift+D`
- **URL parameter**: `?debug=true`

Shows:
- Real-time logs as they happen
- In-memory buffer (last 500 logs)
- Filters and search
- Export functionality

### For Developers

#### Adding Custom Logs

```javascript
import { logger } from './logger';

// Info level (general information)
logger.info('CategoryName', 'Message describing what happened', {
  key1: 'value1',
  key2: 'value2'
});

// Warn level (potential issues)
logger.warn('CategoryName', 'Warning message', {
  reason: 'why this is a warning'
});

// Error level (failures)
logger.error('CategoryName', 'Error message', {
  error: error.message,
  code: error.code,
  stack: error.stack
});

// Debug level (detailed debugging - dev only)
logger.debug('CategoryName', 'Debug message', {
  detailedInfo: 'lots of details'
});
```

#### Best Practices

1. **Use meaningful categories** - Makes filtering easier (e.g., 'Auth', 'Network', 'Firebase')
2. **Include context** - Add relevant data objects to help diagnose issues
3. **Avoid sensitive data** - Never log passwords, tokens, or PII
4. **Use appropriate levels**:
   - DEBUG: Detailed debugging info (dev only)
   - INFO: General informational events
   - WARN: Potentially harmful situations
   - ERROR: Error events that might still allow the app to continue

## Automatic Cleanup

### Client-side (IndexedDB)
- Runs daily
- Deletes logs older than 30 days
- Triggered on user login

### Server-side (Firebase)
- Runs daily
- Deletes entire sessions older than 30 days
- Triggered on user login
- Runs in background (non-blocking)

## Deployment

### Update Firebase Security Rules

Before deploying, update the database rules:

```bash
firebase deploy --only database
```

The rules in `database.rules.json` now include:

```json
"logs": {
  ".read": "root.child('users').child(auth.uid).child('isFirstUser').val() === true",
  "$uid": {
    ".read": "auth != null && auth.uid == $uid",
    ".write": "auth != null && auth.uid == $uid"
  }
}
```

This allows:
- All users can write their own logs
- All users can read their own logs
- Admins (first user) can read ALL logs for analytics

## Troubleshooting

### Logs not appearing in Firebase?

1. Check user is authenticated (`logger.setUserId()` was called)
2. Verify Firebase rules are deployed
3. Check browser console for Firebase errors
4. Logs are batched - wait up to 5 seconds for flush

### Old logs not being cleaned up?

1. Cleanup runs once per day after user login
2. Check browser console for cleanup messages
3. Manually trigger: `await logger.clearOldLogs(30)`

### Too many logs in production?

1. Adjust log levels in code (reduce INFO logs if too verbose)
2. Logs are automatically batched to minimize Firebase writes
3. Consider increasing batch size in `logger.js` if needed

## Log Analysis Tips

### Using Log Analytics

**The analytics dashboard does the heavy lifting for you:**

1. **Check "Common Issues" first** - This shows what's affecting the most users
2. **Click on issues** - See examples and affected user counts
3. **Review statistics** - Are errors increasing? Which categories?
4. **Filter by date range** - Compare this week vs last week
5. **Export for detailed analysis** - Includes grouped issues with examples

### Manual Analysis

When debugging specific issues:

1. **Filter by session** - All logs from one user session share a session ID
2. **Look for patterns** - Network state changes before auth failures?
3. **Check timing** - Timestamp shows when events occurred
4. **Correlate events** - Auth failure followed by offline event?
5. **Export for analysis** - Download JSON and analyze with tools

### Common Patterns to Look For

**Authentication Issues:**
- Token refresh failures followed by logout
- "Permission denied" errors
- Cached user not loading

**Network/Sync Issues:**
- `navigatorOnLine: false` but `firebaseConnected: true`
- Pending operations stuck at > 0
- Sync operations failing with specific error codes

**Offline Behavior:**
- Logs showing online status when airplane mode is enabled
- IndexedDB operations failing
- Service worker issues

## Performance Impact

- **Minimal** - Logs batched and written asynchronously
- **Non-blocking** - Logging never blocks app functionality
- **Efficient** - IndexedDB for local, batched Firebase writes
- **Automatic cleanup** - Prevents database bloat

## Future Enhancements

Possible improvements:
- [ ] Server-side log aggregation (Firebase Functions)
- [ ] Real-time monitoring dashboard
- [ ] Automated alerting for errors
- [ ] Log analytics and trends
- [ ] User activity analytics
- [ ] Performance metrics

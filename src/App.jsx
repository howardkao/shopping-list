import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Check, X, Search, CheckCircle, Loader2, Menu, Trash2, Edit2, LogOut, Shield, Mail, Lock, Copy, ChevronDown, ChevronRight, ShoppingCart, ClipboardList, RefreshCw, Bug, Settings, History, UserCircle } from 'lucide-react';
import { auth, database, firestore } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth';
import { ref, set, get, remove, onValue, push } from 'firebase/database';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import {
  initOfflineDB,
  saveShoppingListLocally,
  loadShoppingListLocally,
  saveShoppingHistoryLocally,
  loadShoppingHistoryLocally,
  saveCommonItemsLocally,
  loadAllCommonItemsLocally,
  saveLessCommonItemsLocally,
  loadAllLessCommonItemsLocally,
  saveCategoriesToLocally,
  loadCategoriesLocally,
  saveQuantityDefaultsLocally,
  loadQuantityDefaultsLocally,
  getLastSyncTime,
  saveCachedUser,
  loadCachedUser,
  clearCachedUser
} from './offlineStorage';
import { logger } from './logger';
import DebugPanel from './DebugPanel';
import {
  buildItemStats,
  topPurchased,
  dormantQuickAddCandidates,
  promotionCandidates,
  userContributions,
  eventSummary,
} from './itemAnalytics';

// Edit these to match the sections and stores you shop at.
const CATEGORIES = ['PRODUCE', 'MEAT & FISH', 'DELI, DAIRY & EGGS', 'FROZEN', 'DRY GOODS', 'BAKING, SPICES & OILS', 'PREPARED FOODS', 'HOUSEHOLD & PHARMACY', 'OTHER'];
const generateId = () => Math.random().toString(36).substr(2, 9);

const formatRelativeTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/** Local calendar + local clock; "today at 1:30pm", "yesterday at 2:30pm", or "4/7 at 11:30am". */
const formatLocalDateTimePhrase = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '';
  try {
    const d = new Date(ms);
    const now = new Date();
    const sameLocalDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    let timePart = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    timePart = timePart.replace(/\s*([AP]M)/i, (_, ap) => ap.toLowerCase());

    if (sameLocalDay(d, now)) return `today at ${timePart}`;
    if (sameLocalDay(d, yesterday)) return `yesterday at ${timePart}`;
    return `${d.getMonth() + 1}/${d.getDate()} at ${timePart}`;
  } catch {
    return '';
  }
};

// Edit these to seed your suggestion library with items you buy regularly.
// Keys must match the CATEGORIES list above.
const DEFAULT_ITEMS = {
  'PRODUCE': ['broccoli', 'carrots', 'onions', 'bananas', 'apples'],
  'MEAT & FISH': ['chicken breast', 'ground beef', 'salmon'],
  'DELI, DAIRY & EGGS': ['eggs', 'milk', 'butter', 'cheddar cheese'],
  'FROZEN': ['peas', 'corn'],
  'DRY GOODS': ['pasta', 'rice', 'bread'],
  'BAKING, SPICES & OILS': ['olive oil', 'garlic powder', 'salt'],
  'PREPARED FOODS': ['rotisserie chicken'],
  'HOUSEHOLD & PHARMACY': ['dish soap', 'toilet paper', 'paper towels'],
  'OTHER': []
};

// Encode category names for Firebase (replace invalid characters)
const encodeCategory = (cat) => {
  return cat.replace(/\//g, '___SLASH___')
    .replace(/\./g, '___DOT___')
    .replace(/#/g, '___HASH___')
    .replace(/\$/g, '___DOLLAR___')
    .replace(/\[/g, '___LBRACKET___')
    .replace(/\]/g, '___RBRACKET___');
};

const decodeCategory = (encoded) => {
  return encoded.replace(/___SLASH___/g, '/')
    .replace(/___DOT___/g, '.')
    .replace(/___HASH___/g, '#')
    .replace(/___DOLLAR___/g, '$')
    .replace(/___LBRACKET___/g, '[')
    .replace(/___RBRACKET___/g, ']');
};

const migrateItems = (items) => {
  const migrated = {};
  Object.keys(items).forEach(cat => {
    migrated[cat] = items[cat].map(name => ({ id: generateId(), name }));
  });
  return migrated;
};

function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('signin');
  const [signupType, setSignupType] = useState('create'); // 'create' | 'join'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    logger.info('Auth', 'Sign in attempt', { email });
    try {
      await signInWithEmailAndPassword(auth, email, password);
      logger.info('Auth', 'Sign in successful', { email });
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      logger.error('Auth', 'Sign in failed', { email, error: err.message, code: err.code });
      setError(err.message);
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!email) { setError('Please enter your email address'); return; }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess('Password reset email sent! Check your inbox.');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    logger.info('Auth', 'Sign up attempt', { email, signupType });

    try {
      const trimmedName = displayName.trim();
      if (!trimmedName) {
        setError('Please enter your name');
        setLoading(false);
        return;
      }

      let householdId;

      if (signupType === 'join') {
        if (!inviteCode) {
          setError('Please enter your invitation code');
          setLoading(false);
          return;
        }
        const code = inviteCode.trim().toUpperCase();
        const codeSnapshot = await get(ref(database, `inviteCodes/${code}`));
        const codeData = codeSnapshot.val();
        if (!codeData || codeData.used || Date.now() > new Date(codeData.expiresAt).getTime()) {
          logger.warn('Auth', 'Sign up failed - invalid/expired invite code');
          setError('Invalid or expired invitation code');
          setLoading(false);
          return;
        }
        householdId = codeData.householdId;
        logger.info('Auth', 'Valid invite code', { householdId });

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;

        // Mark code used in both global index and household copy
        const now = Date.now();
        await set(ref(database, `inviteCodes/${code}/used`), true);
        await set(ref(database, `inviteCodes/${code}/usedBy`), email);
        await set(ref(database, `inviteCodes/${code}/usedAt`), now);
        await set(ref(database, `households/${householdId}/inviteCodes/${code}/used`), true);
        await set(ref(database, `households/${householdId}/inviteCodes/${code}/usedBy`), email);
        await set(ref(database, `households/${householdId}/inviteCodes/${code}/usedAt`), now);

        await set(ref(database, `users/${newUser.uid}`), {
          email: newUser.email,
          displayName: trimmedName,
          createdAt: now,
          householdId
        });
        await set(ref(database, `households/${householdId}/members/${newUser.uid}`), {
          displayName: trimmedName,
          email: newUser.email
        });
      } else {
        // Create a new household
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;

        const newHouseholdRef = push(ref(database, 'households'));
        householdId = newHouseholdRef.key;

        const now = Date.now();
        await set(newHouseholdRef, {
          adminUid: newUser.uid,
          createdAt: now
        });

        await set(ref(database, `users/${newUser.uid}`), {
          email: newUser.email,
          displayName: trimmedName,
          createdAt: now,
          householdId
        });
        await set(ref(database, `households/${householdId}/members/${newUser.uid}`), {
          displayName: trimmedName,
          email: newUser.email
        });

        logger.info('Auth', 'New household created', { householdId, adminUid: newUser.uid });
      }

      logger.info('Auth', 'Sign up completed successfully');
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      logger.error('Auth', 'Sign up failed', { email, error: err.message, code: err.code });
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F7F7F7' }}>
      <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md w-full border border-gray-200">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ backgroundColor: '#FF7A7A' }}>
            <Mail size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Shopping List</h1>
          <p className="text-gray-600 font-medium">{mode === 'signin' ? 'Sign in to your account' : 'Create your account'}</p>
        </div>
        <div className="space-y-4">
          {mode === 'signup' && (
            <div className="flex rounded-xl overflow-hidden border-2 border-gray-200">
              <button onClick={() => { setSignupType('create'); setError(''); }} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${signupType === 'create' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={signupType === 'create' ? { backgroundColor: '#FF7A7A' } : {}}>New household</button>
              <button onClick={() => { setSignupType('join'); setError(''); }} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${signupType === 'join' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={signupType === 'join' ? { backgroundColor: '#FF7A7A' } : {}}>Join with code</button>
            </div>
          )}
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Your name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane" className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors" />
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-gray-400" size={20} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors" onKeyDown={(e) => e.key === 'Enter' && (mode === 'signin' ? handleSignIn() : handleSignUp())} />
            </div>
          </div>
          {mode === 'signup' && signupType === 'join' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Invitation Code</label>
              <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="16-character code" className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors font-mono tracking-wider" />
            </div>
          )}
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
          {success && <div className="bg-green-50 text-green-600 px-4 py-3 rounded-xl text-sm font-medium border border-green-200">{success}</div>}
          <button onClick={mode === 'signin' ? handleSignIn : handleSignUp} disabled={loading} className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90" style={{ backgroundColor: loading ? undefined : '#FF7A7A' }}>
            {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : signupType === 'create' ? 'Create Household' : 'Join Household'}
          </button>
          {mode === 'signin' && (
            <button onClick={handleResetPassword} disabled={loading} className="w-full text-sm font-semibold hover:underline text-gray-600 transition-colors">
              Forgot password?
            </button>
          )}
          <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setSuccess(''); }} className="w-full text-sm font-semibold hover:underline" style={{ color: '#FF7A7A' }}>
            {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateToast({ onUpdate, onDismiss }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slide-up">
      <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: '#FFE5E5' }}>
            <RefreshCw size={20} className="text-[#FF7A7A]" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 text-sm mb-1">
              Update Available
            </h3>
            <p className="text-gray-600 text-xs mb-3">
              A new version is ready. Reload to get the latest features.
            </p>
            <div className="flex gap-2">
              <button
                onClick={onUpdate}
                className="flex-1 px-3 py-2 text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#FF7A7A' }}
              >
                Reload Now
              </button>
              <button
                onClick={onDismiss}
                className="px-3 py-2 text-gray-600 rounded-lg font-semibold text-sm hover:bg-gray-100 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OfflineReadyToast({ onDismiss }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slide-up">
      <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-green-100">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 text-sm mb-1">
              Ready to Work Offline
            </h3>
            <p className="text-gray-600 text-xs mb-3">
              You can now use this app without an internet connection.
            </p>
            <button
              onClick={onDismiss}
              className="px-3 py-2 text-gray-600 rounded-lg font-semibold text-sm hover:bg-gray-100 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightsModal({ householdId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [commonByCat, setCommonByCat] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [evSnap, commonSnap] = await Promise.all([
          get(ref(database, `households/${householdId}/item-events`)),
          get(ref(database, `households/${householdId}/common-items`)),
        ]);
        if (cancelled) return;
        const evRaw = evSnap.val() || {};
        const evList = Object.values(evRaw).filter(e => e && typeof e.ts === 'number');
        evList.sort((a, b) => a.ts - b.ts);
        const cRaw = commonSnap.val() || {};
        const cByCat = {};
        Object.entries(cRaw).forEach(([encodedCat, items]) => {
          cByCat[decodeCategory(encodedCat)] = items || [];
        });
        setEvents(evList);
        setCommonByCat(cByCat);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  const summary = events.length ? eventSummary(events) : null;
  const top = events.length ? topPurchased(events, { limit: 15 }) : [];
  const promote = events.length ? promotionCandidates(events, commonByCat, { minAdds: 3, withinDays: 42 }) : [];
  const dormant = Object.keys(commonByCat).length ? dormantQuickAddCandidates(events, commonByCat, { dormantDays: 56 }) : [];
  const users = events.length ? userContributions(events) : [];

  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : '—';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Household Insights</h2>
            <p className="text-gray-600 font-medium text-sm">Tier 1 — frequency aggregates from item events</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-800"><X size={22} /></button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto space-y-6 text-sm">
          {loading && <div className="text-gray-500">Loading…</div>}
          {error && <div className="text-red-600">Error: {error}</div>}
          {!loading && !error && !events.length && (
            <div className="text-gray-500">No item events recorded yet. Add and check off items to start collecting data.</div>
          )}
          {!loading && !error && events.length > 0 && (
            <>
              <section>
                <h3 className="font-bold text-gray-800 mb-2">Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Total events</div><div className="text-xl font-bold">{summary.total}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Added</div><div className="text-xl font-bold">{summary.added || 0}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Checked</div><div className="text-xl font-bold">{summary.checked || 0}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Removed</div><div className="text-xl font-bold">{summary.removed || 0}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Typed adds</div><div className="text-xl font-bold">{summary.typed || 0}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Quick-add</div><div className="text-xl font-bold">{summary.quickAdd || 0}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">First event</div><div className="text-sm font-bold">{fmtDate(summary.firstTs)}</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Last event</div><div className="text-sm font-bold">{fmtDate(summary.lastTs)}</div></div>
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Top purchased (all-time)</h3>
                {top.length === 0 ? <div className="text-gray-500">No checkoff events yet.</div> : (
                  <div className="space-y-1">
                    {top.map(s => (
                      <div key={s.key} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{s.name}</span> <span className="text-gray-500 text-xs">· {s.category}</span></div>
                        <div className="text-gray-600">×{s.checked}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Promotion candidates <span className="text-xs font-normal text-gray-500">(typed ≥3× in 42 days, not in quick-add)</span></h3>
                {promote.length === 0 ? <div className="text-gray-500">None.</div> : (
                  <div className="space-y-1">
                    {promote.map(c => (
                      <div key={`${c.category}::${c.name}`} className="flex justify-between items-center bg-amber-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{c.name}</span> <span className="text-gray-500 text-xs">· {c.category}</span></div>
                        <div className="text-gray-600">typed ×{c.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Dormant quick-add items <span className="text-xs font-normal text-gray-500">(no use in 56+ days)</span></h3>
                {dormant.length === 0 ? <div className="text-gray-500">None.</div> : (
                  <div className="space-y-1">
                    {dormant.slice(0, 30).map(d => (
                      <div key={`${d.category}::${d.name}`} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{d.name}</span> <span className="text-gray-500 text-xs">· {d.category}</span></div>
                        <div className="text-gray-600">{d.daysSinceLastUse == null ? 'never used' : `${d.daysSinceLastUse}d ago`}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Per-user activity</h3>
                <div className="space-y-1">
                  {users.map(u => (
                    <div key={u.uid} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                      <div className="font-mono text-xs text-gray-700">{u.uid.slice(0, 12)}…</div>
                      <div className="text-gray-600 text-xs">added {u.added} · checked {u.checked} · removed {u.removed}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ onClose, householdId }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);
  const [showInsights, setShowInsights] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    const codesRef = ref(database, `households/${householdId}/inviteCodes`);
    const unsubscribe = onValue(codesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const codesArray = Object.entries(data)
          .map(([code, val]) => ({ id: code, code, ...val }))
          .filter(c => !c.used && Date.now() <= new Date(c.expiresAt).getTime());
        setInvitations(codesArray);
      } else {
        setInvitations([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [householdId]);

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  const createInvitation = async () => {
    if (!householdId) return;
    setCreating(true);
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const codeData = { code, expiresAt: expiresAt.toISOString(), used: false, createdAt: Date.now(), householdId };

    // Write to household (for admin panel display)
    await set(ref(database, `households/${householdId}/inviteCodes/${code}`), codeData);
    // Write to global lookup index (for signup validation without auth)
    await set(ref(database, `inviteCodes/${code}`), { householdId, expiresAt: expiresAt.toISOString(), used: false, createdAt: Date.now() });
    setCreating(false);
  };

  const deleteInvitation = async (code) => {
    await remove(ref(database, `households/${householdId}/inviteCodes/${code}`));
    await remove(ref(database, `inviteCodes/${code}`));
  };

  const copy = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-3xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-800">Admin Panel</h2>
            <p className="text-gray-600 font-medium">Manage invitation codes</p>
          </div>
        <div className="p-6 flex-1 overflow-y-auto">
          <button onClick={createInvitation} disabled={creating} className="w-full text-white py-3.5 rounded-xl font-bold hover:opacity-90 disabled:bg-gray-300 flex items-center justify-center gap-2 mb-3 transition-opacity" style={{ backgroundColor: creating ? undefined : '#10B981' }}>
            <Plus size={20} strokeWidth={2.5} />{creating ? 'Creating...' : 'Create New Code'}
          </button>
          <button onClick={() => setShowInsights(true)} className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200 mb-6 transition-colors">
            View Household Insights
          </button>
          {showInsights && <InsightsModal householdId={householdId} onClose={() => setShowInsights(false)} />}
          {loading ? (
            <div className="text-center py-8 text-gray-500 font-medium">Loading...</div>
          ) : invitations.length === 0 ? (
            <div className="text-center py-8 text-gray-500 font-medium">No active codes</div>
          ) : (
            <div className="space-y-3">
              {invitations.map(inv => (
                <div key={inv.id} className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl font-mono font-bold" style={{ color: '#FF7A7A' }}>{inv.code}</span>
                    <div className="flex gap-2">
                      <button onClick={() => copy(inv.code)} className="p-2 text-gray-600 hover:text-gray-800 rounded-lg transition-colors">
                        {copiedCode === inv.code ? <CheckCircle size={20} className="text-green-600" /> : <Copy size={20} />}
                      </button>
                      <button onClick={() => deleteInvitation(inv.id)} className="p-2 text-gray-600 hover:text-red-600 rounded-lg transition-colors">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 font-medium">Expires: {new Date(inv.expiresAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-6 border-t border-gray-200">
          <button onClick={onClose} className="w-full bg-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-300 transition-colors">Close</button>
        </div>
      </div>
    </div>
</>
  );
}

function DisplayNamePrompt({ user, householdId, onSaved }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter your name'); return; }
    setLoading(true);
    setError('');
    try {
      await set(ref(database, `users/${user.uid}/displayName`), trimmed);
      if (householdId) {
        await set(ref(database, `households/${householdId}/members/${user.uid}`), {
          displayName: trimmed,
          email: user.email
        });
      }
      onSaved(trimmed);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">What's your name?</h2>
          <p className="text-gray-600 font-medium mt-1">This helps your household know who added items</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
        </div>
        <div className="p-6 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
            style={{ backgroundColor: loading || !name.trim() ? undefined : '#FF7A7A' }}
          >
            {loading ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemBottomSheet({ item, members, lastPurchasedTs, onClose }) {
  const [nameDraft, setNameDraft] = useState(item.name || '');
  const [quantityDraft, setQuantityDraft] = useState(item.quantity || '');

  useEffect(() => {
    setNameDraft(item.name || '');
  }, [item.id, item.name]);

  useEffect(() => {
    setQuantityDraft(item.quantity || '');
  }, [item]);

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(item.name || '');
      return;
    }
    if (trimmed === (item.name || '').trim()) return;
    if (item.onNameChange) {
      await item.onNameChange(item.itemKey, trimmed);
    }
  };

  const commitQuantity = async (nextValue) => {
    const trimmed = nextValue.trim();
    const current = (item.quantity || '').trim();
    if (trimmed === current) return;
    if (item.onQuantityChange) {
      await item.onQuantityChange(item.itemKey, trimmed);
    }
  };

  const nudgeQuantity = async (delta) => {
    const current = quantityDraft.trim();
    const match = current.match(/^(\d+)(\s+.*)?$/);
    const currentNumber = match ? Number(match[1]) : 0;
    const remainder = match?.[2] || (current && !match ? ` ${current}` : '');
    const nextNumber = Math.max(1, currentNumber + delta);
    const nextValue = `${nextNumber}${remainder}`.trim();
    setQuantityDraft(nextValue);
    await commitQuantity(nextValue);
  };

  const handleClose = async () => {
    await commitName();
    await commitQuantity(quantityDraft);
    onClose();
  };

  const addedByName = item.addedBy && members[item.addedBy]
    ? members[item.addedBy].displayName
    : null;
  const addedAtFormatted = item.addedAt ? formatLocalDateTimePhrase(item.addedAt) : null;

  const lastPurchasedFormatted = lastPurchasedTs
    ? formatRelativeTime(lastPurchasedTs)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/40 transition-opacity md:bg-black/50" />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-xl animate-slide-up md:max-h-[85vh] md:max-w-md md:overflow-hidden md:rounded-3xl md:border md:border-gray-200 md:animate-none md:shadow-xl md:flex md:flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="px-6 pb-6 pt-2 md:flex-1 md:flex md:flex-col md:min-h-0 md:overflow-y-auto md:pt-6 md:pb-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Name</p>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="w-full text-lg font-bold text-gray-800 md:text-xl bg-transparent border border-transparent rounded-xl px-0 py-1 -mx-0 focus:outline-none focus:ring-2 focus:ring-[#FF7A7A]/30 focus:border-[#FF7A7A]/40"
                aria-label="Item name"
              />
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="hidden md:flex flex-shrink-0 p-2 -mr-2 -mt-1 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Quantity</p>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="text"
                    value={quantityDraft}
                    onChange={(e) => setQuantityDraft(e.target.value)}
                    onBlur={() => commitQuantity(quantityDraft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="Optional"
                    className="flex-1 bg-transparent text-sm font-medium text-gray-700 placeholder:text-gray-400 focus:outline-none min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => nudgeQuantity(-1)}
                    className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center"
                    aria-label="Decrease quantity"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeQuantity(1)}
                    className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            {(addedByName || addedAtFormatted) && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FFF0F0' }}>
                  <Plus size={16} style={{ color: '#FF7A7A' }} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    {addedByName
                      ? `Added by ${addedByName}`
                      : 'Added'}
                  </p>
                  {addedAtFormatted && (
                    <p className="text-sm text-gray-500">{addedAtFormatted}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FFF0F0' }}>
                <History size={16} style={{ color: '#FF7A7A' }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700">Last purchased</p>
                <p className="text-sm text-gray-500">
                  {lastPurchasedFormatted || 'Never purchased'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountModal({ user, householdId, isAdmin, onClose, onDeleted }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!password) return;
    setLoading(true);
    setError('');
    logger.info('Auth', 'Account deletion initiated', { uid: user.uid, isAdmin });
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);

      if (isAdmin && householdId) {
        // Delete global invite code index entries first (while user record still exists for auth)
        const inviteCodesSnap = await get(ref(database, `households/${householdId}/inviteCodes`));
        const inviteCodes = inviteCodesSnap.val();
        if (inviteCodes) {
          await Promise.all(Object.keys(inviteCodes).map(code =>
            remove(ref(database, `inviteCodes/${code}`))
          ));
        }
        // Delete household
        await remove(ref(database, `households/${householdId}`));
      }

      // Delete user record (must happen before deleteUser so auth is still valid)
      await remove(ref(database, `users/${user.uid}`));

      // Clear local cache before deleting auth account
      await clearCachedUser();

      // Delete Firebase Auth account (signs user out automatically)
      await deleteUser(auth.currentUser);

      logger.info('Auth', 'Account deleted successfully', { uid: user.uid });
      onDeleted();
    } catch (err) {
      logger.error('Auth', 'Account deletion failed', { uid: user.uid, error: err.message, code: err.code });
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect password. Please try again.');
      } else {
        setError(err.message);
      }
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">Delete Account</h2>
          <p className="text-gray-600 font-medium mt-1">This action cannot be undone</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 font-medium">
            {isAdmin
              ? 'Your account and all household data will be permanently deleted — including the shopping list, history, and all suggestions. Other household members will lose access.'
              : 'Your account will be removed. The household and its data will remain accessible to other members.'}
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Enter your password to confirm</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 border-2 border-red-200 rounded-xl focus:border-red-400 focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && handleDelete()}
                autoFocus
              />
            </div>
          </div>
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
        </div>
        <div className="p-6 border-t border-gray-200 flex gap-3">
          <button onClick={onClose} disabled={loading} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-300 transition-colors disabled:opacity-50">Cancel</button>
          <button
            onClick={handleDelete}
            disabled={loading || !password}
            className="flex-1 text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
            style={{ backgroundColor: loading || !password ? undefined : '#EF4444' }}
          >
            {loading ? 'Deleting...' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PurchaseHistory({ householdId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dayGroups, setDayGroups] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(ref(database, `households/${householdId}/item-events`));
        if (cancelled) return;
        const raw = snap.val() || {};
        const events = Object.values(raw).filter(e => e && typeof e.ts === 'number' && (e.action === 'checked' || e.action === 'unchecked'));

        // Net out checked/unchecked per item per local date
        const dayMap = new Map(); // dateStr -> Map(itemKey -> { name, category, qty, count })
        for (const e of events) {
          const dateStr = new Date(e.ts).toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
          if (!dayMap.has(dateStr)) dayMap.set(dateStr, new Map());
          const items = dayMap.get(dateStr);
          const key = `${(e.category || '').toLowerCase()}::${(e.name || '').toLowerCase()}`;
          if (!items.has(key)) {
            items.set(key, { name: e.name, category: e.category, qty: e.qty || 1, count: 0 });
          }
          const item = items.get(key);
          if (e.action === 'checked') item.count++;
          else if (e.action === 'unchecked') item.count--;
          if (e.qty) item.qty = e.qty;
        }

        // Build sorted groups (newest first), filter out items with count <= 0
        const groups = [];
        for (const [dateStr, items] of dayMap) {
          const purchased = Array.from(items.values()).filter(i => i.count > 0);
          if (purchased.length > 0) {
            purchased.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
            groups.push({ dateStr, items: purchased });
          }
        }
        groups.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

        setDayGroups(groups);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  const formatDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  };

  if (loading) return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-gray-400">Loading purchase history...</div></div>;
  if (error) return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-red-500">Error: {error}</div></div>;
  if (dayGroups.length === 0) return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-gray-400 text-sm">No purchases yet. Check off items on your shopping list to start tracking.</div></div>;

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="space-y-4">
        {dayGroups.map(group => (
          <div key={group.dateStr} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-700 text-sm">{formatDate(group.dateStr)}</h3>
              <span className="text-xs text-gray-400">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {group.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Check size={16} className="text-gray-300 flex-shrink-0" />
                  <span className="flex-1 text-sm font-medium text-gray-700">{item.name}</span>
                  {item.qty > 1 && <span className="text-xs text-gray-400 font-medium">x{item.qty}</span>}
                  <span className="text-xs text-gray-400 uppercase tracking-wide">{item.category}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [householdId, setHouseholdId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [currentPage, setCurrentPage] = useState('list');
  const [showMenu, setShowMenu] = useState(false);
  const [list, setList] = useState([]);
  const [history, setHistory] = useState(new Set());
  const [categories, setCategories] = useState(CATEGORIES);
  const [commonItems, setCommonItems] = useState({});
  const [lessCommonItems, setLessCommonItems] = useState({});
  const [quickAddMode, setQuickAddMode] = useState(false);
  const [categorySearches, setCategorySearches] = useState({});
  const [newItemInputs, setNewItemInputs] = useState({});
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingOps, setPendingOps] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [localDataLoaded, setLocalDataLoaded] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showHeader, setShowHeader] = useState(true);
  const [showStickyToolbar, setShowStickyToolbar] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef(null);
  const prevQuickAddMode = useRef(quickAddMode);
  const lastScrollY = useRef(0);
  const lastScrollTime = useRef(Date.now());
  const smoothedVelocity = useRef(0);
  const toolbarRef = useRef(null);
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [showOfflineToast, setShowOfflineToast] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showLoginExplicitly, setShowLoginExplicitly] = useState(false);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [members, setMembers] = useState({});
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemLastPurchased, setSelectedItemLastPurchased] = useState(null);
  const [quantityDefaults, setQuantityDefaults] = useState({});
  const authResolvedRef = useRef(false);
  const getStableItemKey = (item) => item?.itemKey || String(item?.id || '');

  // Check for debug mode in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true') {
      setShowDebugPanel(true);
      logger.info('Debug', 'Debug panel activated via URL parameter');
    }

    // Keyboard shortcut: Ctrl+Shift+D to toggle debug panel
    const handleKeyPress = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setShowDebugPanel(prev => !prev);
        logger.info('Debug', 'Debug panel toggled via keyboard shortcut');
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  useEffect(() => {
    logger.info('Auth', 'Auth initialization started');

    // Load cached user immediately (offline-first)
    loadCachedUser().then(cachedUser => {
      if (cachedUser && !authResolvedRef.current) {
        logger.info('Auth', 'Loaded cached user', {
          uid: cachedUser.uid,
          email: cachedUser.email,
          isAdmin: cachedUser.isAdmin
        });
        // Use cached user info while Firebase auth is loading
        setUser({
          uid: cachedUser.uid,
          email: cachedUser.email,
          cached: true
        });
        setIsAdmin(cachedUser.isAdmin || false);
        setHouseholdId(cachedUser.householdId || null);
        logger.setUserId(cachedUser.uid);
      } else {
        logger.debug('Auth', 'No cached user found or user already set');
      }
    }).catch(err => {
      logger.error('Auth', 'Failed to load cached user', { error: err.message });
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      authResolvedRef.current = true;
      logger.info('Auth', 'onAuthStateChanged fired', {
        hasUser: !!firebaseUser,
        uid: firebaseUser?.uid,
        email: firebaseUser?.email
      });

      if (firebaseUser) {
        setUser(firebaseUser);
        setShowLoginExplicitly(false);
        logger.setUserId(firebaseUser.uid);

        // Load household membership and derive admin status from household record.
        // Retry a few times: onAuthStateChanged fires immediately after createUserWithEmailAndPassword,
        // before the signup handler has finished writing the user record to the DB.
        let isAdminUser = false;
        let userHouseholdId = null;
        try {
          let userRecord = await get(ref(database, `users/${firebaseUser.uid}`));
          let retries = 0;
          while (!userRecord.val() && retries < 4) {
            await new Promise(r => setTimeout(r, 400));
            userRecord = await get(ref(database, `users/${firebaseUser.uid}`));
            retries++;
            if (!userRecord.val()) {
              logger.debug('Auth', 'User record not yet written, retrying', { retries });
            }
          }
          userHouseholdId = userRecord.val()?.householdId || null;
          if (!userRecord.val()?.displayName) {
            setNeedsDisplayName(true);
          }
          if (userHouseholdId) {
            const household = await get(ref(database, `households/${userHouseholdId}`));
            isAdminUser = household.val()?.adminUid === firebaseUser.uid;
          }
        } catch (err) {
          logger.error('Auth', 'Failed to load household/admin status, using cached value', {
            error: err.message,
            code: err.code
          });
          const cachedUser = await loadCachedUser().catch(() => null);
          isAdminUser = cachedUser?.isAdmin || false;
          userHouseholdId = cachedUser?.householdId || null;
        }
        setIsAdmin(isAdminUser);
        setHouseholdId(userHouseholdId);

        logger.info('Auth', 'User authenticated', {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          householdId: userHouseholdId,
          isAdmin: isAdminUser
        });

        // Save user info to IndexedDB for offline-first auth
        await saveCachedUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          isAdmin: isAdminUser,
          householdId: userHouseholdId
        }).then(() => {
          logger.debug('Auth', 'Cached user saved to IndexedDB');
        }).catch(err => {
          logger.error('Auth', 'Failed to save cached user', { error: err.message });
        });
      } else {
        logger.warn('Auth', 'Firebase auth returned null user');

        // Be more lenient: if we have a cached user, keep using it even if online
        // only clear if we have no cached user at all
        const cachedUser = await loadCachedUser().catch(() => null);
        if (!cachedUser) {
          logger.info('Auth', 'No cached user and Firebase auth is null - clearing auth state');
          setUser(null);
          setIsAdmin(false);
          setHouseholdId(null);
        } else {
          logger.info('Auth', 'Firebase auth is null but keeping cached user', {
            uid: cachedUser.uid,
            email: cachedUser.email,
            online: navigator.onLine
          });
          // We keep the 'user' state as the cached user (set during init)
          // This prevents aggressive logouts when token refresh fails
        }
      }
      setAuthLoading(false);
      logger.debug('Auth', 'Auth loading completed');
    });
    return () => unsubscribe();
  }, []);

  // Register PWA update callbacks
  useEffect(() => {
    if (typeof window === 'undefined') return;

    import('./main.jsx').then(({ registerUpdateCallback, registerOfflineCallback }) => {
      registerUpdateCallback((updateSW) => {
        setPendingUpdate(() => updateSW);
        setShowUpdateToast(true);
      });

      registerOfflineCallback(() => {
        setShowOfflineToast(true);
        setTimeout(() => setShowOfflineToast(false), 5000);
      });
    }).catch(err => {
      console.error('Failed to register PWA callbacks:', err);
    });
  }, []);

  const handleUpdate = useCallback(() => {
    if (pendingUpdate) {
      pendingUpdate(true);
    }
  }, [pendingUpdate]);

  const handleDismissUpdate = useCallback(() => {
    setShowUpdateToast(false);
  }, []);

  const handleDismissOffline = useCallback(() => {
    setShowOfflineToast(false);
  }, []);

  // Monitor pendingOps changes
  useEffect(() => {
    logger.info('Sync', 'Pending operations count changed', {
      pendingOps,
      isOnline,
      isConnected,
      timestamp: Date.now()
    });
  }, [pendingOps]);

  // Monitor connection state changes
  useEffect(() => {
    logger.info('Network', 'Connection state changed', {
      isOnline,
      isConnected,
      navigatorOnLine: navigator.onLine,
      timestamp: Date.now()
    });
  }, [isOnline, isConnected]);

  // Handle token refresh when returning to app after inactivity
  useEffect(() => {
    const handleVisibilityChange = async () => {
      logger.info('App', 'Visibility change detected', {
        hidden: document.hidden,
        hasUser: !!user,
        navigatorOnLine: navigator.onLine
      });

      // When user returns to the app
      if (!document.hidden && user) {
        // Only try to refresh if we're online
        if (!navigator.onLine) {
          logger.info('Auth', 'Skipping token refresh (offline)', {
            navigatorOnLine: navigator.onLine
          });
          return;
        }

        try {
          // Get fresh token (this will refresh if expired/expiring)
          const currentUser = auth.currentUser;
          if (currentUser) {
            logger.info('Auth', 'Attempting token refresh on app resume');
            // Get token (refreshes only if necessary)
            await currentUser.getIdToken();
            logger.info('Auth', 'Token refreshed successfully on app resume');
          } else {
            logger.info('Auth', 'No current user for token refresh on resume - waiting for onAuthStateChanged');
          }
        } catch (error) {
          logger.error('Auth', 'Token refresh failed on app resume', {
            error: error.message,
            code: error.code,
            stack: error.stack
          });
          // Don't force logout on network errors - let user work offline
          if (error.code === 'auth/network-request-failed') {
            logger.info('Auth', 'Network error during token refresh - continuing in offline mode');
          }
        }
      }
    };

    const handleOnline = async () => {
      logger.info('Network', 'Network came back online, attempting token refresh', {
        hasUser: !!user
      });

      // When network comes back, try to refresh the token
      if (user) {
        try {
          const currentUser = auth.currentUser;
          if (currentUser) {
            await currentUser.getIdToken();
            logger.info('Auth', 'Token refreshed successfully after coming back online');
          } else {
            logger.info('Auth', 'No current user for token refresh yet after coming online - waiting for onAuthStateChanged');
          }
        } catch (error) {
          logger.error('Auth', 'Token refresh failed after coming online', {
            error: error.message,
            code: error.code
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  // Load data from IndexedDB on mount (before Firebase connects)
  useEffect(() => {
    async function loadLocalData() {
      logger.info('OfflineStorage', 'Loading local data from IndexedDB');
      try {
        await initOfflineDB();
        logger.debug('OfflineStorage', 'IndexedDB initialized');

        const [localList, localHistory, localCommon, localLessCommon, localCategories, localQuantityDefaults, syncTime] = await Promise.all([
          loadShoppingListLocally(),
          loadShoppingHistoryLocally(),
          loadAllCommonItemsLocally(),
          loadAllLessCommonItemsLocally(),
          loadCategoriesLocally(),
          loadQuantityDefaultsLocally(),
          getLastSyncTime()
        ]);

        logger.info('OfflineStorage', 'Local data loaded', {
          hasLocalList: !!localList,
          listItemCount: localList?.length || 0,
          hasHistory: !!localHistory,
          historyCount: localHistory?.length || 0,
          commonCategoriesCount: Object.keys(localCommon || {}).length,
          lessCommonCategoriesCount: Object.keys(localLessCommon || {}).length,
          lastSyncTime: syncTime
        });

        // Only use local data if we have it and Firebase hasn't loaded yet
        if (localList !== null && localList !== undefined) {
          setList(localList.map(item => ({ ...item, itemKey: item.itemKey || String(item.id || generateId()) })));
        }
        if (localHistory !== null && localHistory !== undefined) {
          setHistory(new Set(localHistory));
        }
        if (localCategories && Array.isArray(localCategories) && localCategories.length > 0) {
          setCategories(localCategories);
        }
        if (localCommon && Object.keys(localCommon).length > 0) {
          setCommonItems(localCommon);
        }
        if (localLessCommon && Object.keys(localLessCommon).length > 0) {
          setLessCommonItems(localLessCommon);
        }
        if (syncTime) {
          setLastSyncTime(syncTime);
        }
        if (localQuantityDefaults && typeof localQuantityDefaults === 'object') {
          setQuantityDefaults(localQuantityDefaults);
        }

        setLocalDataLoaded(true);
        setLoading(false);
        logger.info('OfflineStorage', 'Local data load completed successfully');
      } catch (error) {
        logger.error('OfflineStorage', 'Failed to load local data', {
          error: error.message,
          stack: error.stack
        });
        setLocalDataLoaded(true);
      }
    }

    loadLocalData();
  }, []);

  useEffect(() => {
    if (!user || !householdId) {
      logger.debug('Firebase', 'Skipping Firebase listeners (no user or household)');
      return;
    }

    logger.info('Firebase', 'Setting up Firebase listeners', { userId: user.uid, householdId });

    // Monitor Firebase connection status
    const connectedRef = ref(database, '.info/connected');
    const unsubConnected = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val() === true;
      logger.info('Firebase', 'Firebase connection state changed', {
        connected,
        navigatorOnLine: navigator.onLine,
        timestamp: Date.now()
      });
      setIsConnected(connected);
    });

    // Monitor browser online/offline status
    const handleOnline = () => {
      logger.info('Network', 'Browser online event handler', {
        navigatorOnLine: navigator.onLine,
        firebaseConnected: isConnected,
        timestamp: Date.now()
      });
      setIsOnline(true);
    };

    const handleOffline = () => {
      logger.warn('Network', 'Browser offline event handler', {
        navigatorOnLine: navigator.onLine,
        firebaseConnected: isConnected,
        timestamp: Date.now()
      });
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial online status
    const initialOnline = navigator.onLine;
    setIsOnline(initialOnline);
    logger.info('Network', 'Initial network status', {
      navigatorOnLine: initialOnline,
      timestamp: Date.now()
    });

    const hPath = `households/${householdId}`;
    const categoriesRef = ref(database, `${hPath}/categories`);
    const listRef = ref(database, `${hPath}/shopping-list`);
    const historyRef = ref(database, `${hPath}/shopping-history`);
    const commonRef = ref(database, `${hPath}/common-items`);
    const lessCommonRef = ref(database, `${hPath}/less-common-items`);
    const quantityDefaultsRef = ref(database, `${hPath}/quantity-defaults`);

    logger.debug('Firebase', 'Setting up data listeners');

    const unsubCategories = onValue(categoriesRef, async (snapshot) => {
      const data = snapshot.val();
      if (data && Array.isArray(data) && data.length > 0) {
        setCategories(data);
        saveCategoriesToLocally(data);
      } else {
        // First setup: seed from code constant and persist to Firebase
        await set(categoriesRef, CATEGORIES);
        setCategories(CATEGORIES);
        saveCategoriesToLocally(CATEGORIES);
      }
    }, (error) => {
      logger.error('Firebase', 'Categories listener error', { error: error.message, code: error.code });
    });

    const unsubList = onValue(listRef, (snapshot) => {
      const data = (snapshot.val() || []).map(item => ({ ...item, itemKey: item.itemKey || String(item.id || generateId()) }));
      logger.info('Firebase', 'Shopping list data received', {
        itemCount: data.length,
        timestamp: Date.now()
      });
      setList(data);
      // Save to IndexedDB for offline access
      saveShoppingListLocally(data).then(() => {
        logger.debug('OfflineStorage', 'Shopping list saved to IndexedDB');
      });
      setLastSyncTime(Date.now());
    }, (error) => {
      logger.error('Firebase', 'Shopping list listener error', {
        error: error.message,
        code: error.code
      });
    });

    const unsubHistory = onValue(historyRef, (snapshot) => {
      const data = snapshot.val() || [];
      logger.info('Firebase', 'Shopping history data received', {
        itemCount: data.length,
        timestamp: Date.now()
      });
      setHistory(new Set(data));
      // Save to IndexedDB for offline access
      saveShoppingHistoryLocally(data).then(() => {
        logger.debug('OfflineStorage', 'Shopping history saved to IndexedDB');
      });
    }, (error) => {
      logger.error('Firebase', 'Shopping history listener error', {
        error: error.message,
        code: error.code
      });
    });

    const unsubCommon = onValue(commonRef, (snapshot) => {
      const data = snapshot.val();
      let processedData;
      if (data) {
        // Decode Firebase keys back to category names
        const decoded = {};
        Object.keys(data).forEach(encodedKey => {
          const actualCat = decodeCategory(encodedKey);
          decoded[actualCat] = data[encodedKey];
        });
        const first = Object.keys(decoded)[0];
        processedData = first && Array.isArray(decoded[first]) && typeof decoded[first][0] === 'string' ? migrateItems(decoded) : decoded;
      } else {
        // First setup: seed from code constant and persist to Firebase
        processedData = migrateItems(DEFAULT_ITEMS);
        const encoded = {};
        Object.keys(processedData).forEach(cat => {
          encoded[encodeCategory(cat)] = processedData[cat];
        });
        set(commonRef, encoded).catch(err =>
          logger.warn('Firebase', 'Failed to seed default items', { error: err.message })
        );
      }
      logger.info('Firebase', 'Common items data received', {
        categoriesCount: Object.keys(processedData).length,
        timestamp: Date.now()
      });
      setCommonItems(processedData);
      // Save to IndexedDB for offline access
      Object.keys(processedData).forEach(cat => {
        saveCommonItemsLocally(cat, processedData[cat]);
      });
      logger.debug('OfflineStorage', 'Common items saved to IndexedDB');
    }, (error) => {
      logger.error('Firebase', 'Common items listener error', {
        error: error.message,
        code: error.code
      });
    });

    const unsubLessCommon = onValue(lessCommonRef, (snapshot) => {
      const data = snapshot.val();
      let processedData;
      if (data) {
        // Decode Firebase keys back to category names
        const decoded = {};
        Object.keys(data).forEach(encodedKey => {
          const actualCat = decodeCategory(encodedKey);
          decoded[actualCat] = data[encodedKey];
        });
        const first = Object.keys(decoded)[0];
        processedData = first && Array.isArray(decoded[first]) && typeof decoded[first][0] === 'string' ? migrateItems(decoded) : decoded;
      } else {
        processedData = {};
      }
      logger.info('Firebase', 'Less common items data received', {
        categoriesCount: Object.keys(processedData).length,
        timestamp: Date.now()
      });
      setLessCommonItems(processedData);
      // Save to IndexedDB for offline access
      Object.keys(processedData).forEach(cat => {
        saveLessCommonItemsLocally(cat, processedData[cat]);
      });
      logger.debug('OfflineStorage', 'Less common items saved to IndexedDB');
    }, (error) => {
      logger.error('Firebase', 'Less common items listener error', {
        error: error.message,
        code: error.code
      });
    });

    const membersRef = ref(database, `households/${householdId}/members`);
    const unsubMembers = onValue(membersRef, (snapshot) => {
      setMembers(snapshot.val() || {});
    }, (error) => {
      logger.error('Firebase', 'Members listener error', { error: error.message, code: error.code });
    });

    const unsubQuantityDefaults = onValue(quantityDefaultsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setQuantityDefaults(data);
      saveQuantityDefaultsLocally(data);
    }, (error) => {
      logger.error('Firebase', 'Quantity defaults listener error', { error: error.message, code: error.code });
    });

    setLoading(false);

    return () => {
      unsubConnected();
      setIsConnected(false);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubCategories();
      unsubList();
      unsubHistory();
      unsubCommon();
      unsubLessCommon();
      unsubMembers();
      unsubQuantityDefaults();
    };
  }, [user?.uid, householdId]);

  const save = async (key, value) => {
    const fullKey = householdId ? `households/${householdId}/${key}` : key;
    const opId = Date.now();
    logger.info('Firebase', 'Starting Firebase save operation', {
      opId,
      key: fullKey,
      dataType: Array.isArray(value) ? 'array' : typeof value,
      itemCount: Array.isArray(value) ? value.length : undefined
    });

    setPendingOps(p => {
      const newCount = p + 1;
      logger.debug('Sync', 'Pending operations increased', {
        opId,
        pendingOps: newCount
      });
      return newCount;
    });

    try {
      await set(ref(database, fullKey), value);
      logger.info('Firebase', 'Firebase save completed', {
        opId,
        key,
        success: true
      });
    } catch (error) {
      logger.error('Firebase', 'Firebase save failed', {
        opId,
        key,
        error: error.message,
        code: error.code,
        stack: error.stack
      });
      // Don't throw - let Firebase handle offline queueing
      // The error is logged, and Firebase will retry when back online
    } finally {
      setPendingOps(p => {
        const newCount = p - 1;
        logger.debug('Sync', 'Pending operations decreased', {
          opId,
          pendingOps: newCount
        });
        return newCount;
      });
    }
  };

  const saveCommonItems = async (items) => {
    // Encode category names for Firebase
    const encoded = {};
    Object.keys(items).forEach(cat => {
      encoded[encodeCategory(cat)] = items[cat];
    });
    await save('common-items', encoded);
  };

  const saveLessCommonItems = async (items) => {
    // Encode category names for Firebase
    const encoded = {};
    Object.keys(items).forEach(cat => {
      encoded[encodeCategory(cat)] = items[cat];
    });
    await save('less-common-items', encoded);
  };

  const persistQuantityDefaults = async (nextDefaults) => {
    setQuantityDefaults(nextDefaults);
    await save('quantity-defaults', nextDefaults);
    await saveQuantityDefaultsLocally(nextDefaults);
  };

  const getDefaultQuantityForItem = (itemKey, name) => {
    const key = String(itemKey || '');
    const legacyKey = (name || '').trim().toLowerCase();
    return quantityDefaults[key] || quantityDefaults[legacyKey] || '';
  };

  const logItemEvent = (event) => {
    if (!householdId) return;
    const payload = {
      ts: Date.now(),
      uid: user?.uid || 'unknown',
      name: (event.name || '').toLowerCase(),
      category: event.category || '',
      action: event.action,
    };
    if (event.source) payload.source = event.source;
    if (event.qty != null) payload.qty = Number(event.qty);
    try {
      push(ref(database, `households/${householdId}/item-events`), payload)
        .catch(err => logger.warn('App', 'item-event write failed', { error: err.message, action: payload.action }));
    } catch (err) {
      logger.warn('App', 'item-event push threw', { error: err.message });
    }
  };

  const addItem = (name, category, source = 'quickAdd', itemKey = generateId()) => {
    const defaultQuantity = getDefaultQuantityForItem(itemKey, name);
    const newList = [...list, { id: Date.now(), itemKey, name, category, quantity: defaultQuantity, done: false, addedBy: user?.uid || null, addedAt: Date.now() }];
    setList(newList); // Optimistic update
    save('shopping-list', newList);
    const newHistory = new Set(history);
    newHistory.add(name.toLowerCase());
    setHistory(newHistory); // Optimistic update
    save('shopping-history', [...newHistory]);
    logItemEvent({ name, category, action: 'added', source, qty: Number(defaultQuantity) || 1 });
  };

  const toggleDone = (id) => {
    const target = list.find(item => item.id === id);
    const newList = list.map(item => item.id === id ? { ...item, done: !item.done } : item);
    setList(newList); // Optimistic update
    save('shopping-list', newList);
    if (target) {
      logItemEvent({
        name: target.name,
        category: target.category,
        action: target.done ? 'unchecked' : 'checked',
        qty: Number(target.quantity) || 1,
      });
    }
  };

  const updateQuantity = (itemKey, qty) => {
    setList((prevList) => {
      const nextList = prevList.map(item =>
        getStableItemKey(item) === itemKey
          ? { ...item, itemKey: getStableItemKey(item), quantity: qty }
          : item
      );
      save('shopping-list', nextList);

      const target = prevList.find(item => getStableItemKey(item) === itemKey);
      if (target) {
        const nextDefaults = { ...quantityDefaults };
        if (qty && qty.trim()) nextDefaults[itemKey] = qty.trim();
        else delete nextDefaults[itemKey];
        persistQuantityDefaults(nextDefaults);
      }

      return nextList;
    });
  };

  const loadLastPurchasedForItemName = async (name) => {
    if (!householdId) {
      setSelectedItemLastPurchased(null);
      return;
    }
    try {
      const eventsSnap = await get(ref(database, `households/${householdId}/item-events`));
      const events = eventsSnap.val();
      if (!events) {
        setSelectedItemLastPurchased(null);
        return;
      }
      const itemNameLower = name.toLowerCase();
      let latestTs = null;
      Object.values(events).forEach(ev => {
        if (ev.action === 'checked' && ev.name === itemNameLower) {
          if (!latestTs || ev.ts > latestTs) latestTs = ev.ts;
        }
      });
      setSelectedItemLastPurchased(latestTs);
    } catch (err) {
      logger.warn('App', 'Failed to fetch last purchased for item', { error: err.message });
    }
  };

  const updateItemName = async (itemKey, nextName) => {
    const trimmed = (nextName || '').trim();
    setList((prevList) => {
      const target = prevList.find(item => getStableItemKey(item) === itemKey);
      if (!target || !trimmed || trimmed === target.name) return prevList;

      const oldNameLower = target.name.trim().toLowerCase();
      const targetStableKey = getStableItemKey(target);
      const renamedTarget = { ...target, itemKey: targetStableKey, name: trimmed };
      const nextList = [];
      for (const item of prevList) {
        const sameLogicalRow = getStableItemKey(item) === itemKey;
        const orphanWithOldName = !sameLogicalRow
          && item.category === target.category
          && item.name.trim().toLowerCase() === oldNameLower;
        if (orphanWithOldName) continue;
        nextList.push(sameLogicalRow ? renamedTarget : item);
      }
      save('shopping-list', nextList);

      const newHistory = new Set(history);
      newHistory.delete(target.name.toLowerCase());
      newHistory.add(trimmed.toLowerCase());
      setHistory(newHistory);
      save('shopping-history', [...newHistory]);

      const renameSuggestionArray = (items = []) => {
        const renamed = items.map((suggestion) =>
          suggestion.name.trim().toLowerCase() === oldNameLower
            ? { ...suggestion, name: trimmed }
            : suggestion
        );
        const deduped = [];
        const seen = new Set();
        for (const suggestion of renamed.sort((a, b) => a.name.localeCompare(b.name))) {
          const key = suggestion.name.trim().toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(suggestion);
        }
        return deduped;
      };
      const nextCommonItems = {};
      Object.keys(commonItems).forEach((cat) => {
        nextCommonItems[cat] = renameSuggestionArray(commonItems[cat]);
      });
      const nextLessCommonItems = {};
      Object.keys(lessCommonItems).forEach((cat) => {
        nextLessCommonItems[cat] = renameSuggestionArray(lessCommonItems[cat]);
      });
      setCommonItems(nextCommonItems);
      setLessCommonItems(nextLessCommonItems);
      saveCommonItems(nextCommonItems);
      saveLessCommonItems(nextLessCommonItems);

      setSelectedItem(si => (si && getStableItemKey(si) === itemKey ? { ...si, name: trimmed } : si));
      void loadLastPurchasedForItemName(trimmed);

      return nextList;
    });
  };

  const openItemSheet = async (item) => {
    const itemKey = getStableItemKey(item);
    setSelectedItem({ ...item, itemKey, onQuantityChange: updateQuantity, onNameChange: updateItemName });
    setSelectedItemLastPurchased(null);
    await loadLastPurchasedForItemName(item.name);
  };

  const openSuggestionSheet = async (cat, suggestion) => {
    const item = {
      ...suggestion,
      category: cat,
      itemKey: suggestion.id,
    };
    setSelectedItem(item);
    setSelectedItemLastPurchased(null);
    await loadLastPurchasedForItemName(suggestion.name);
  };

  const clearDone = () => {
    const newList = list.filter(item => !item.done);
    setList(newList); // Optimistic update
    save('shopping-list', newList);
  };

  const removeItem = (id) => {
    const target = list.find(item => item.id === id);
    const newList = list.filter(item => item.id !== id);
    setList(newList); // Optimistic update
    save('shopping-list', newList);
    if (target && !target.done) {
      if (target.quantity && target.quantity.trim()) {
        const nextDefaults = { ...quantityDefaults, [getStableItemKey(target)]: target.quantity.trim() };
        persistQuantityDefaults(nextDefaults);
      }
      logItemEvent({
        name: target.name,
        category: target.category,
        action: 'removed',
        qty: Number(target.quantity) || 1,
      });
    }
  };

  const toggleQuickAdd = (cat, itemId) => {
    const commonCat = commonItems[cat] || [];
    const lessCat = lessCommonItems[cat] || [];
    const inCommon = commonCat.find(i => i.id === itemId);
    if (inCommon) {
      const newC = { ...commonItems, [cat]: commonCat.filter(i => i.id !== itemId) };
      const newL = { ...lessCommonItems, [cat]: [...lessCat, inCommon].sort((a, b) => a.name.localeCompare(b.name)) };
      setCommonItems(newC); // Optimistic update
      setLessCommonItems(newL); // Optimistic update
      saveCommonItems(newC);
      saveLessCommonItems(newL);
    } else {
      const inLess = lessCat.find(i => i.id === itemId);
      const newL = { ...lessCommonItems, [cat]: lessCat.filter(i => i.id !== itemId) };
      const newC = { ...commonItems, [cat]: [...commonCat, inLess].sort((a, b) => a.name.localeCompare(b.name)) };
      setCommonItems(newC); // Optimistic update
      setLessCommonItems(newL); // Optimistic update
      saveCommonItems(newC);
      saveLessCommonItems(newL);
    }
  };

  const deleteSuggestion = (cat, itemId) => {
    const commonCat = commonItems[cat] || [];
    const lessCat = lessCommonItems[cat] || [];
    if (commonCat.find(i => i.id === itemId)) {
      const newC = { ...commonItems, [cat]: commonCat.filter(i => i.id !== itemId) };
      setCommonItems(newC); // Optimistic update
      saveCommonItems(newC);
    } else {
      const newL = { ...lessCommonItems, [cat]: lessCat.filter(i => i.id !== itemId) };
      setLessCommonItems(newL); // Optimistic update
      saveLessCommonItems(newL);
    }
  };

  const finishEditName = (cat, itemId) => {
    if (!editingItemName.trim()) {
      setEditingItemId(null);
      setEditingItemName('');
      return;
    }
    const commonCat = commonItems[cat] || [];
    const lessCat = lessCommonItems[cat] || [];
    if (commonCat.find(i => i.id === itemId)) {
      const newC = { ...commonItems, [cat]: commonCat.map(i => i.id === itemId ? { ...i, name: editingItemName } : i).sort((a, b) => a.name.localeCompare(b.name)) };
      setCommonItems(newC); // Optimistic update
      saveCommonItems(newC);
    } else {
      const newL = { ...lessCommonItems, [cat]: lessCat.map(i => i.id === itemId ? { ...i, name: editingItemName } : i).sort((a, b) => a.name.localeCompare(b.name)) };
      setLessCommonItems(newL); // Optimistic update
      saveLessCommonItems(newL);
    }
    setEditingItemId(null);
    setEditingItemName('');
  };

  const addNewSuggestion = (cat) => {
    const name = newItemInputs[cat]?.trim();
    if (!name) return;
    const newC = { ...commonItems, [cat]: [...(commonItems[cat] || []), { id: generateId(), name }].sort((a, b) => a.name.localeCompare(b.name)) };
    setCommonItems(newC); // Optimistic update
    saveCommonItems(newC);
    setNewItemInputs(prev => ({ ...prev, [cat]: '' }));
  };

  const getAvailable = (cat) => {
    const listNames = new Set(list.map(i => i.name.toLowerCase()));
    return (commonItems[cat] || []).filter(i => !listNames.has(i.name.toLowerCase()));
  };

  const getSuggestions = (cat) => {
    const search = (categorySearches[cat] || '').toLowerCase();
    if (!search) return [];
    const suggestions = new Set();
    const listNames = new Set(list.map(i => i.name.toLowerCase()));
    history.forEach(item => {
      if (item.includes(search) && !listNames.has(item)) {
        const belongs = (commonItems[cat] || []).some(i => i.name.toLowerCase() === item) || (lessCommonItems[cat] || []).some(i => i.name.toLowerCase() === item);
        if (belongs) suggestions.add(item);
      }
    });
    (lessCommonItems[cat] || []).forEach(i => { if (i.name.toLowerCase().includes(search) && !listNames.has(i.name.toLowerCase())) suggestions.add(i.name.toLowerCase()); });
    (commonItems[cat] || []).forEach(i => { if (i.name.toLowerCase().includes(search) && !listNames.has(i.name.toLowerCase())) suggestions.add(i.name.toLowerCase()); });
    return Array.from(suggestions).slice(0, 10);
  };

  /** Verbatim query first when it is not already an exact (case-insensitive) match in suggestions — easier one-tap add for new strings. */
  const getQuickAddDropdownItems = (cat) => {
    const raw = (categorySearches[cat] || '').trim();
    if (!raw) return [];
    const base = getSuggestions(cat);
    const rawLc = raw.toLowerCase();
    const hasExact = base.some((s) => s.toLowerCase() === rawLc);
    const items = hasExact ? base : [raw, ...base];
    return items.slice(0, 10);
  };

  const addFromSearch = (cat, name) => {
    addItem(name, cat, 'typed', generateId());
    setCategorySearches(prev => ({ ...prev, [cat]: '' }));
  };

  const organized = categories.map(cat => {
    const catItems = list.filter(i => i.category === cat);
    const quickItems = quickAddMode ? getAvailable(cat) : [];
    const all = [...catItems.map(i => ({ type: 'list', data: i, key: i.name.toLowerCase() })), ...quickItems.map(i => ({ type: 'quick', data: i, key: i.name.toLowerCase() }))].sort((a, b) => a.key.localeCompare(b.key));
    return { category: cat, items: all, has: catItems.length > 0 || quickItems.length > 0 };
  });

  useEffect(() => {
    const modeChanged = prevQuickAddMode.current !== quickAddMode;
    prevQuickAddMode.current = quickAddMode;

    // Only recalculate if:
    // 1. Mode changed, OR
    // 2. We're in Shopping Mode (so categories update with list changes)
    if (!modeChanged && quickAddMode) {
      return; // In Adding Mode and mode didn't change, don't recalculate
    }

    const initial = {};
    categories.forEach(cat => {
      if (quickAddMode) {
        // In Adding Mode, expand all categories
        initial[cat] = true;
      } else {
        // In Shopping Mode, only expand categories with items
        const hasItems = list.some(item => item.category === cat);
        initial[cat] = hasItems;
      }
    });
    setExpandedCategories(initial);
  }, [quickAddMode, list]);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY.current;
      const scrollingUp = currentScrollY < lastScrollY.current;

      // Header visibility - hide when scrolling down past 50px, show when scrolling up
      if (scrollingDown && currentScrollY > 50) {
        setShowHeader(false);
        setShowMenu(false); // Close menu when hiding header
      } else if (scrollingUp) {
        setShowHeader(true);
      }

      // Toolbar stickiness - only on list page
      if (currentPage === 'list' && toolbarRef.current) {
        const toolbarTop = toolbarRef.current.getBoundingClientRect().top + currentScrollY;

        if (scrollingDown && currentScrollY > toolbarTop - 20) {
          setShowStickyToolbar(true);
        } else if (scrollingUp && currentScrollY < toolbarTop - 100) {
          setShowStickyToolbar(false);
        }
      }

      // Detect scrolling for fade effects - only at moderate to fast speeds
      const now = Date.now();
      const timeDelta = Math.max(now - lastScrollTime.current, 1);
      const scrollDelta = Math.abs(currentScrollY - lastScrollY.current);
      const instantVelocity = (scrollDelta / timeDelta) * 1000; // pixels per second

      // Smooth the velocity to avoid flickering
      smoothedVelocity.current = smoothedVelocity.current * 0.7 + instantVelocity * 0.3;

      const velocityThreshold = 800; // pixels per second

      if (smoothedVelocity.current >= velocityThreshold) {
        setIsScrolling(true);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        scrollTimeoutRef.current = setTimeout(() => {
          setIsScrolling(false);
          smoothedVelocity.current = 0;
        }, 150);
      }

      lastScrollTime.current = now;

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentPage]);

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleSignOut = async () => {
    logger.info('Auth', 'Sign out initiated');
    try {
      await firebaseSignOut(auth);
      await clearCachedUser(); // Clear cached user on explicit logout
      logger.info('Auth', 'Sign out successful, cached user cleared');
      setShowMenu(false);
    } catch (error) {
      logger.error('Auth', 'Sign out failed', {
        error: error.message,
        code: error.code
      });
    }
  };

  // Offline-first loading: show cached data immediately if available
  // Only block if: no cached data AND (still auth loading OR not logged in)
  const hasCachedData = localDataLoaded && (list.length > 0 || Object.keys(commonItems).length > 0);
  
  // We need re-auth if we are online but have no user, and we've finished checking auth
  const needsReauth = hasCachedData && !user && !authLoading && navigator.onLine;

  // Show login screen if:
  // 1. Explicitly requested
  // 2. No cached data AND (finished auth loading OR not logged in)
  const showLogin = showLoginExplicitly || (!hasCachedData && !authLoading && !user);

  if (showLogin) {
    return <Login onLoginSuccess={() => setShowLoginExplicitly(false)} />;
  }

  // If we have cached data, show the app regardless of auth state (unless explicitly signing in)
  if (hasCachedData) {
    // Auth can happen in background, we already have data to show
  } else {
    // No cached data, need to check auth
    if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
    if (!user) return <Login onLoginSuccess={() => setShowLoginExplicitly(false)} />;
    if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

        * {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .scroll-fade-full {
          transition: none;
        }
        .scroll-fade-full.is-scrolling {
          opacity: 0;
          transition: opacity 0.1s ease-out;
        }

        .scroll-fade-border {
          transition: none;
        }
        .scroll-fade-border.is-scrolling {
          border-color: transparent;
          transition: border-color 0.1s ease-out;
        }

        .scroll-fade-partial {
          transition: none;
        }
        .scroll-fade-partial.is-scrolling {
          opacity: 0.5;
          filter: grayscale(100%);
          transition: opacity 0.1s ease-out, filter 0.1s ease-out;
        }

        .scroll-fade-bg {
          transition: none;
        }
        .scroll-fade-bg.is-scrolling {
          transition: background-color 0.1s ease-out;
        }
      `}</style>
      <div className={`min-h-screen scroll-fade-bg ${isScrolling ? 'is-scrolling' : ''}`} style={{ backgroundColor: isScrolling ? '#FFFFFF' : '#F7F7F7' }}>
        <div className={`fixed top-0 left-0 right-0 bg-white shadow-sm z-50 transition-transform duration-300 ${showHeader ? 'translate-y-0' : '-translate-y-full'}`}>
          <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              {currentPage === 'list' && <div className="flex-1 font-bold text-xl" style={{ color: '#FF6B6B' }}>Shopping List</div>}
              {currentPage === 'settings' && <div className="flex-1 font-bold text-xl text-gray-800">Settings</div>}
              {currentPage === 'history' && <div className="flex-1 font-bold text-xl text-gray-800">Purchase History</div>}
              {currentPage === 'account' && <div className="flex-1 font-bold text-xl text-gray-800">Account</div>}
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
                !isOnline || !isConnected
                  ? 'bg-red-100'
                  : pendingOps > 0
                    ? 'bg-blue-100'
                    : 'bg-green-100'
              }`}>
                {!isOnline || !isConnected ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                    <span className="text-xs font-medium text-red-600">Offline</span>
                  </>
                ) : pendingOps > 0 ? (
                  <>
                    <Loader2 size={14} className="text-blue-600 animate-spin" />
                    <span className="text-xs font-medium text-blue-600">Syncing</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs font-medium text-green-600">Online</span>
                  </>
                )}
              </div>
              <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><Menu size={24} className="text-gray-700" /></button>
            </div>
          </div>
          {showMenu && (
            <div className="absolute top-full left-0 right-0 bg-white shadow-lg border-t border-gray-200">
              <div className="max-w-2xl lg:max-w-6xl mx-auto">
                <button onClick={() => { setCurrentPage('list'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 ${currentPage === 'list' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'list' ? '#FF7A7A' : '#374151' }}>Shopping List</button>
                <button onClick={() => { setCurrentPage('history'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'history' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'history' ? '#FF7A7A' : '#374151' }}><History size={20} />Purchase History</button>
                <button onClick={() => { setCurrentPage('settings'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'settings' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'settings' ? '#FF7A7A' : '#374151' }}><Settings size={20} />Settings</button>
                <button onClick={() => { setCurrentPage('account'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'account' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'account' ? '#FF7A7A' : '#374151' }}><UserCircle size={20} />Account</button>
              </div>
            </div>
          )}
        </div>

        {(!isOnline || !isConnected) && (
          <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-medium">
            ⚠️ You're offline. {lastSyncTime ? `Last synced ${formatRelativeTime(lastSyncTime)}.` : ''} Changes will sync when connection is restored.
          </div>
        )}

        <div className="pt-20 pb-6">
          {currentPage === 'account' ? (
            <div className="max-w-2xl mx-auto px-4">
              <div className="space-y-3">
                {isAdmin && (
                  <button onClick={() => setShowAdmin(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                    <Shield size={20} />Admin Panel
                  </button>
                )}
                <button onClick={handleSignOut} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-red-500 hover:bg-red-50 transition-colors">
                  <LogOut size={20} />Sign Out
                </button>
                <button onClick={() => setShowDeleteAccount(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-red-400 hover:bg-red-50 transition-colors text-sm">
                  <Trash2 size={18} />Delete Account
                </button>
              </div>
            </div>
          ) : currentPage === 'list' ? (
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4">
              {/* Sticky toolbar when scrolling */}
              {showStickyToolbar && (
                <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40 transition-transform duration-300" style={{ transform: showHeader ? 'translateY(72px)' : 'translateY(0)' }}>
                  <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3">
                    <div className="flex items-stretch gap-3">
                      <div className={`bg-white rounded-2xl p-1.5 border-2 border-gray-200 flex-1 scroll-fade-partial ${isScrolling ? 'is-scrolling' : ''}`}>
                        <div className="flex gap-1 h-full">
                          <button
                            onClick={() => setQuickAddMode(false)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all text-sm ${
                              !quickAddMode
                                ? 'text-white'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                            style={{ backgroundColor: !quickAddMode ? '#FF7A7A' : 'transparent' }}
                          >
                            <ShoppingCart size={18} strokeWidth={2.5} />
                            <span>Shop</span>
                          </button>
                          <button
                            onClick={() => setQuickAddMode(true)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all text-sm ${
                              quickAddMode
                                ? 'text-white'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                            style={{ backgroundColor: quickAddMode ? '#FF7A7A' : 'transparent' }}
                          >
                            <ClipboardList size={18} strokeWidth={2.5} />
                            <span>Add</span>
                          </button>
                        </div>
                      </div>
                      <div className={`rounded-2xl p-1.5 border-2 transition-colors scroll-fade-partial ${isScrolling ? 'is-scrolling' : ''} ${list.filter(i => i.done).length === 0 ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'}`}>
                        <button onClick={clearDone} disabled={list.filter(i => i.done).length === 0} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all h-full ${list.filter(i => i.done).length === 0 ? 'text-gray-400' : 'text-white'}`} style={{ backgroundColor: list.filter(i => i.done).length === 0 ? 'transparent' : (quickAddMode ? '#6B7280' : '#FF7A7A') }}>
                          <Check size={18} strokeWidth={2.5} />
                          <span>Clear</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Original toolbar in page */}
              <div ref={toolbarRef} className="flex items-stretch gap-3 mb-6">
                <div className={`bg-white rounded-2xl p-1.5 border-2 border-gray-200 flex-1 scroll-fade-partial ${isScrolling ? 'is-scrolling' : ''}`}>
                  <div className="flex gap-1 h-full">
                    <button
                      onClick={() => setQuickAddMode(false)}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all text-sm ${
                        !quickAddMode
                          ? 'text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      style={{ backgroundColor: !quickAddMode ? '#FF7A7A' : 'transparent' }}
                    >
                      <ShoppingCart size={18} strokeWidth={2.5} />
                      <span>Shop</span>
                    </button>
                    <button
                      onClick={() => setQuickAddMode(true)}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all text-sm ${
                        quickAddMode
                          ? 'text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      style={{ backgroundColor: quickAddMode ? '#FF7A7A' : 'transparent' }}
                    >
                      <ClipboardList size={18} strokeWidth={2.5} />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
                <div className={`rounded-2xl p-1.5 border-2 transition-colors scroll-fade-partial ${isScrolling ? 'is-scrolling' : ''} ${list.filter(i => i.done).length === 0 ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'}`}>
                  <button onClick={clearDone} disabled={list.filter(i => i.done).length === 0} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all h-full ${list.filter(i => i.done).length === 0 ? 'text-gray-400' : 'text-white'}`} style={{ backgroundColor: list.filter(i => i.done).length === 0 ? 'transparent' : (quickAddMode ? '#6B7280' : '#FF7A7A') }}>
                    <Check size={18} strokeWidth={2.5} />
                    <span>Clear</span>
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {organized.map(g => {
                  const search = categorySearches[g.category] || '';
                  const quickAddDropdown = getQuickAddDropdownItems(g.category);
                  const uncheckedCount = list.filter(i => i.category === g.category && !i.done).length;
                  const isExpanded = expandedCategories[g.category];

                  return (
                    <div key={g.category} className={`space-y-2 bg-white border border-gray-200 rounded-2xl overflow-hidden scroll-fade-border ${isScrolling ? 'is-scrolling' : ''}`}>
                      <button
                        onClick={() => toggleCategory(g.category)}
                        className={`w-full py-4 px-4 flex items-center gap-3 transition-colors ${
                          quickAddMode
                            ? "bg-gray-100 hover:bg-gray-200"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        {isExpanded ? (
                          <ChevronDown size={20} className={`scroll-fade-full ${isScrolling ? 'is-scrolling' : ''} ${quickAddMode ? "text-gray-600" : "text-gray-400"}`} />
                        ) : (
                          <ChevronRight size={20} className={`scroll-fade-full ${isScrolling ? 'is-scrolling' : ''} ${quickAddMode ? "text-gray-600" : "text-gray-400"}`} />
                        )}
                        <h3 className={`flex-1 text-left uppercase tracking-wide ${
                          quickAddMode
                            ? "font-bold text-gray-700 text-base"
                            : "font-semibold text-gray-500 text-sm"
                        }`}>{g.category}</h3>
                        {uncheckedCount > 0 && (
                          <span className={`bg-gray-200 text-gray-700 text-xs font-bold px-2.5 py-1 rounded-full min-w-[24px] text-center scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}>
                            {uncheckedCount}
                          </span>
                        )}
                      </button>

                      {isExpanded && (
                        <>
                          {quickAddMode && (
                            <div className={`px-4 pb-3 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}>
                              <div className="relative">
                                <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                                <input type="text" value={search} onChange={(e) => setCategorySearches(prev => ({ ...prev, [g.category]: e.target.value }))} placeholder={`Add to ${g.category}...`} className="w-full pl-10 pr-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-gray-300 focus:outline-none transition-colors" />
                                {search.trim() && (
                                  <div className="absolute w-full bg-white border-2 border-gray-200 rounded-xl mt-2 shadow-lg z-10 max-h-60 overflow-y-auto">
                                    {quickAddDropdown.map((s, i) => (
                                      <button key={`${i}-${s}`} type="button" onClick={() => addFromSearch(g.category, s)} className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0 text-sm font-medium">
                                        {s}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {g.items.length > 0 ? (
                            <div className="pb-3 md:columns-2 lg:columns-3 md:gap-0">
                              {g.items.map((item, idx) => {
                                if (item.type === 'list') {
                                  const li = item.data;
                                  return (
                                    <div key={li.id} className={`flex items-center gap-3 py-3 px-4 border-t border-gray-100 break-inside-avoid scroll-fade-border ${isScrolling ? 'is-scrolling' : ''}`}>
                                      {quickAddMode ? (
                                        li.done ? (
                                          <button
                                            type="button"
                                            onClick={() => toggleDone(li.id)}
                                            className={`flex-shrink-0 w-6 h-6 rounded-md border-2 border-transparent flex items-center justify-center transition-all scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                            style={{ backgroundColor: '#6B7280' }}
                                            aria-label={`Mark ${li.name} as not done`}
                                          >
                                            <Check size={16} className="text-white" strokeWidth={3} />
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => removeItem(li.id)}
                                            className={`flex-shrink-0 w-6 h-6 rounded-md border-2 border-gray-200 bg-white flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                            aria-label={`Remove ${li.name} from list`}
                                          >
                                            <X size={16} strokeWidth={2.5} />
                                          </button>
                                        )
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => toggleDone(li.id)}
                                          className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all scroll-fade-full ${isScrolling ? 'is-scrolling' : ''} ${li.done ? 'border-transparent' : 'border-gray-300 bg-white'}`}
                                          style={{ backgroundColor: li.done ? '#FF7A7A' : undefined }}
                                        >
                                          {li.done && <Check size={16} className="text-white" strokeWidth={3} />}
                                        </button>
                                      )}
                                      <button onClick={() => openItemSheet(li)} className={`flex-1 text-left font-semibold text-sm ${li.done ? 'line-through text-gray-400' : ''}`} style={{ color: li.done ? undefined : '#FF7A7A' }}>
                                        {li.name}
                                        {li.quantity && li.quantity.trim() && (
                                          <span className="ml-1 text-gray-400 font-medium">
                                            {li.quantity}
                                          </span>
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openItemSheet(li)}
                                        className={`p-2 rounded-full transition-colors scroll-fade-full ${isScrolling ? 'is-scrolling' : ''} ${li.done ? 'text-gray-300 hover:text-gray-400' : 'text-gray-300 hover:text-gray-500'}`}
                                        aria-label={`Edit quantity for ${li.name}`}
                                      >
                                        <Edit2 size={14} strokeWidth={1.8} />
                                      </button>
                                    </div>
                                  );
                                } else {
                                  const qi = item.data;
                                  return (
                                    <div key={`qa-${idx}`} className={`w-full flex items-center gap-3 py-3 px-4 hover:bg-gray-50 transition-colors border-t border-gray-100 break-inside-avoid scroll-fade-border ${isScrolling ? 'is-scrolling' : ''}`}>
                                      <button
                                        type="button"
                                        onClick={() => addItem(qi.name, g.category, 'quickAdd', qi.id)}
                                        className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                        style={{ backgroundColor: '#FF7A7A' }}
                                        aria-label={`Add ${qi.name} to list`}
                                      >
                                        <Plus size={16} className="text-white" strokeWidth={2.5} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openSuggestionSheet(g.category, qi)}
                                        className="flex-1 text-left font-semibold text-sm"
                                        style={{ color: '#FF7A7A' }}
                                      >
                                        {qi.name}
                                      </button>
                                    </div>
                                  );
                                }
                              })}
                            </div>
                          ) : (
                            <div className="px-4 pb-4"><div className="text-center py-6 text-gray-400 text-sm italic">No items</div></div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : currentPage === 'history' ? (
            <PurchaseHistory householdId={householdId} />
          ) : (
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4">
              <div className="space-y-3">
                {categories.map(cat => {
                  const all = [...(commonItems[cat] || []).map(i => ({ ...i, isQuick: true })), ...(lessCommonItems[cat] || []).map(i => ({ ...i, isQuick: false }))].sort((a, b) => a.name.localeCompare(b.name));
                  return (
                    <div key={cat} className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden">
                      <div className="bg-gray-100 px-4 py-4 border-b border-gray-200"><h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">{cat}</h3></div>
                      <div className="px-4 pt-4 pb-3">
                        <div className="flex gap-2">
                          <input type="text" value={newItemInputs[cat] || ''} onChange={(e) => setNewItemInputs(prev => ({ ...prev, [cat]: e.target.value }))} onKeyPress={(e) => e.key === 'Enter' && addNewSuggestion(cat)} placeholder="Add new..." className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-gray-300 focus:outline-none transition-colors" />
                          <button onClick={() => addNewSuggestion(cat)} className="px-4 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity" style={{ backgroundColor: '#FF7A7A' }}><Plus size={18} strokeWidth={2.5} /></button>
                        </div>
                      </div>
                      {all.length > 0 ? (
                        <div className="px-4 pb-4 space-y-2 md:columns-2 lg:columns-3 md:gap-4">
                          {all.map(i => (
                            <div key={i.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200 break-inside-avoid">
                              {editingItemId === i.id ? (
                                <input type="text" value={editingItemName} onChange={(e) => setEditingItemName(e.target.value)} onBlur={() => finishEditName(cat, i.id)} onKeyPress={(e) => e.key === 'Enter' && finishEditName(cat, i.id)} className="flex-1 px-3 py-2 border-2 border-gray-300 rounded-lg text-sm font-medium" autoFocus />
                              ) : (
                                <>
                                  <span className="flex-1 font-medium text-sm text-gray-800">{i.name}</span>
                                  <button onClick={() => { setEditingItemId(i.id); setEditingItemName(i.name); }} className="text-gray-400 hover:text-gray-600 p-1 transition-colors"><Edit2 size={16} /></button>
                                </>
                              )}
                              <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-xs text-gray-500 font-semibold">Quick</span>
                                <button onClick={() => toggleQuickAdd(cat, i.id)} className={`w-11 h-6 rounded-full relative transition-colors`} style={{ backgroundColor: i.isQuick ? '#FF7A7A' : '#D1D5DB' }}>
                                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${i.isQuick ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                </button>
                              </label>
                              <button onClick={() => deleteSuggestion(cat, i.id)} className="text-red-400 hover:text-red-600 p-1 transition-colors"><Trash2 size={18} /></button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-4 pb-4"><div className="text-center py-6 text-gray-400 text-sm italic">No suggestions</div></div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {showAdmin && isAdmin && <AdminPanel householdId={householdId} onClose={() => setShowAdmin(false)} />}
      {showDeleteAccount && user && (
        <DeleteAccountModal
          user={user}
          householdId={householdId}
          isAdmin={isAdmin}
          onClose={() => setShowDeleteAccount(false)}
          onDeleted={() => setShowDeleteAccount(false)}
        />
      )}
      {needsDisplayName && user && (
        <DisplayNamePrompt
          user={user}
          householdId={householdId}
          onSaved={() => setNeedsDisplayName(false)}
        />
      )}
      {selectedItem && (
        <ItemBottomSheet
          item={selectedItem}
          members={members}
          lastPurchasedTs={selectedItemLastPurchased}
          onClose={() => setSelectedItem(null)}
        />
      )}
      {showUpdateToast && (
        <UpdateToast
          onUpdate={handleUpdate}
          onDismiss={handleDismissUpdate}
        />
      )}
      {showOfflineToast && (
        <OfflineReadyToast
          onDismiss={handleDismissOffline}
        />
      )}
      {showDebugPanel && (
        <DebugPanel onClose={() => setShowDebugPanel(false)} />
      )}
      {/* Floating debug button (only for admins) */}
      {isAdmin && (
        <button
          onClick={() => setShowDebugPanel(true)}
          className="fixed bottom-4 left-4 p-3 bg-gray-800 text-white rounded-full shadow-lg hover:bg-gray-700 transition-colors z-40"
          title="Open Debug Panel (Ctrl+Shift+D)"
        >
          <Bug size={20} />
        </button>
      )}
      {needsReauth && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center">
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Session Expired</h2>
            <p className="text-sm text-gray-600 mb-5">Your session has ended. Please sign in again to continue.</p>
            <button
              onClick={() => setShowLoginExplicitly(true)}
              className="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Sign In
            </button>
          </div>
        </div>
      )}
    </>
  );
}

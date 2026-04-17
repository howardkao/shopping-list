import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, Check, X, Search, CheckCircle, Loader2, Menu, Trash2, Edit2, LogOut, Shield, Mail, Lock, Copy, ChevronDown, ChevronRight, ShoppingCart, ClipboardList, RefreshCw, Bug, Settings, History, UserCircle, BarChart3, Pin, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { auth, database } from './firebase';
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
import { ref, set, get, remove, onValue, push, update } from 'firebase/database';
import {
  initOfflineDB,
  saveShoppingListLocally,
  loadShoppingListLocally,
  saveTaxonomyV2Locally,
  loadTaxonomyV2Locally,
  saveQuantityDefaultsLocally,
  loadQuantityDefaultsLocally,
  getLastSyncTime,
  saveCachedUser,
  loadCachedUser,
  clearCachedUser
} from './offlineStorage';
import { logger } from './logger';
import DebugPanel from './DebugPanel';
import SuggestionsEditor from './SuggestionsEditor';
import Onboarding from './Onboarding';
import { bootstrapHouseholdTaxonomy } from './householdBootstrap';
import { formatAisleNameForDisplay } from './aisleDisplay';
import {
  dormantShortcuts,
  promotionCandidates,
  topPurchased,
  userContributions,
} from './itemAnalytics';
import { computeEffectiveCheckEvents, lastEffectivePurchaseTimestamp } from './purchaseSemantics.js';
// categoryClassifier is used internally by itemAnalytics

const generateId = () => Math.random().toString(36).substr(2, 9);

/** RTDB may return shopping-list as an object with numeric keys instead of a true array. */
function snapshotShoppingListToArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') {
    return Object.keys(val)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => val[k])
      .filter((row) => row != null);
  }
  return [];
}

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

        try {
          const result = await bootstrapHouseholdTaxonomy(householdId);
          logger.info('Auth', 'Household taxonomy seeded', { householdId, ...result });
        } catch (seedErr) {
          logger.error('Auth', 'Household taxonomy seed failed', { householdId, error: seedErr.message });
        }

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
  const [categoriesV2, setCategoriesV2] = useState({});
  const [visibleByCatId, setVisibleByCatId] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [evSnap, visSnap, catSnap] = await Promise.all([
          get(ref(database, `households/${householdId}/item-events`)),
          get(ref(database, `households/${householdId}/taxonomy/visible-items`)),
          get(ref(database, `households/${householdId}/taxonomy/categories`)),
        ]);
        if (cancelled) return;
        const evRaw = evSnap.val() || {};
        const evList = Object.values(evRaw).filter(e => e && typeof e.ts === 'number');
        evList.sort((a, b) => a.ts - b.ts);
        const visRaw = visSnap.val() || {};
        const catRaw = catSnap.val() || {};
        // Build visibleItemsByCategoryId (keyed by catId) for new analytics API
        const visByCatId = {};
        const cByCat = {};
        for (const [catId, items] of Object.entries(visRaw)) {
          const arr = Array.isArray(items) ? items : Object.values(items || {});
          const filtered = arr.filter(Boolean);
          visByCatId[catId] = filtered;
          const name = catRaw[catId]?.name;
          if (name) cByCat[name] = filtered;
        }
        setEvents(evList);
        setCommonByCat(cByCat);
        setCategoriesV2(catRaw);
        setVisibleByCatId(visByCatId);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  const top = events.length ? topPurchased(events, { limit: 15 }) : [];
  const promote = events.length ? promotionCandidates(events, visibleByCatId, categoriesV2) : [];
  const dormant = Object.keys(visibleByCatId).length ? dormantShortcuts(events, visibleByCatId, categoriesV2) : [];
  const users = events.length ? userContributions(events) : [];

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
                <h3 className="font-bold text-gray-800 mb-2">Promotion candidates <span className="text-xs font-normal text-gray-500">(checked ≥3× in threshold window, not a shortcut)</span></h3>
                {promote.length === 0 ? <div className="text-gray-500">None.</div> : (
                  <div className="space-y-1">
                    {promote.map(c => (
                      <div key={`${c.categoryId || c.category}::${c.name}`} className="flex justify-between items-center bg-amber-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{c.name}</span> <span className="text-gray-500 text-xs">· {c.category}</span></div>
                        <div className="text-gray-600">checked ×{c.checkedCount}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Dormant shortcuts <span className="text-xs font-normal text-gray-500">(no use beyond category threshold)</span></h3>
                {dormant.length === 0 ? <div className="text-gray-500">None.</div> : (
                  <div className="space-y-1">
                    {dormant.slice(0, 30).map(d => (
                      <div key={`${d.categoryId}::${d.name}`} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{d.name}</span> <span className="text-gray-500 text-xs">· {d.categoryName}</span></div>
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
            <h2 className="text-2xl font-bold text-gray-800">Invite Household Members</h2>
            <p className="text-gray-600 font-medium">Create invitation codes for new members</p>
          </div>
        <div className="p-6 flex-1 overflow-y-auto">
          <button onClick={createInvitation} disabled={creating} className="w-full text-white py-3.5 rounded-xl font-bold hover:opacity-90 disabled:bg-gray-300 flex items-center justify-center gap-2 mb-6 transition-opacity" style={{ backgroundColor: creating ? undefined : '#10B981' }}>
            <Plus size={20} strokeWidth={2.5} />{creating ? 'Creating...' : 'Create New Code'}
          </button>
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

function ItemBottomSheet({ item, members, lastPurchasedTs, aisles, categories, onClose }) {
  const [nameDraft, setNameDraft] = useState(item.name || '');
  const [quantityDraft, setQuantityDraft] = useState(item.quantity || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [configAisleId, setConfigAisleId] = useState(item.suggestionConfig?.aisleId || '');
  const [configCatId, setConfigCatId] = useState(item.suggestionConfig?.categoryId || '');
  const [pinActionLoading, setPinActionLoading] = useState(false);
  const [promotedConfig, setPromotedConfig] = useState(null);
  const [translateY, setTranslateY] = useState(0);
  const dragStartYRef = useRef(null);

  const suggestionConfig = promotedConfig || item.suggestionConfig || null;
  const aisleMap = aisles || {};
  const categoryMap = categories || {};

  const orderedAisles = Object.entries(aisleMap)
    .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
    .map(([id, a]) => ({ id, name: a?.name || '' }));

  const categoriesForAisle = (aisleId) =>
    Object.entries(categoryMap)
      .filter(([, c]) => c?.aisleId === aisleId)
      .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
      .map(([id, c]) => ({ id, name: c?.name || '' }));

  /** Props are a snapshot; compare commits to last persisted values, not stale `item`. */
  const lastCommittedNameRef = useRef(String(item.name ?? ''));
  const lastCommittedQtyRef = useRef(String(item.quantity ?? ''));

  useEffect(() => {
    setNameDraft(item.name || '');
    setSaveError('');
  }, [item.itemKey, item.id, item.name]);

  useEffect(() => {
    setQuantityDraft(item.quantity || '');
  }, [item]);

  useEffect(() => {
    lastCommittedNameRef.current = String(item.name ?? '');
    lastCommittedQtyRef.current = String(item.quantity ?? '');
  }, [item.itemKey, item.id, item.name, item.quantity]);

  // Reset picker + drag state when the underlying item changes (sheet reopen).
  useEffect(() => {
    setConfigOpen(false);
    setPromotedConfig(null);
    setPinActionLoading(false);
    setTranslateY(0);
    setConfigAisleId(item.suggestionConfig?.aisleId || '');
    setConfigCatId(item.suggestionConfig?.categoryId || '');
  }, [item.itemKey, item.id]);

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(item.name || '');
      return;
    }
    if (trimmed === String(item.name ?? '').trim()) return;
    if (item.onNameChange) {
      setIsSaving(true);
      setSaveError('');
      try {
        await item.onNameChange(item.itemKey, trimmed);
      } catch (err) {
        setSaveError(err?.message || 'Failed to save name');
        throw err;
      } finally {
        setIsSaving(false);
      }
      lastCommittedNameRef.current = trimmed;
    }
  };

  const commitQuantity = async (nextValue) => {
    const trimmed = String(nextValue ?? '').trim();
    if (trimmed === lastCommittedQtyRef.current.trim()) return;
    if (item.onQuantityChange) {
      await item.onQuantityChange(item.itemKey, trimmed);
      lastCommittedQtyRef.current = trimmed;
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
    try {
      await commitName();
      await commitQuantity(quantityDraft);
      onClose();
    } catch {
      // Keep the sheet open if the save fails so the user can retry.
    }
  };

  const addedByName = item.addedBy && members[item.addedBy]
    ? members[item.addedBy].displayName
    : null;
  const addedAtFormatted = item.addedAt ? formatLocalDateTimePhrase(item.addedAt) : null;

  const lastPurchasedFormatted = lastPurchasedTs
    ? formatRelativeTime(lastPurchasedTs)
    : null;

  // Swipe-to-dismiss on mobile (handle only, not sheet body — avoids fighting internal scroll).
  const handleDragStart = (e) => {
    dragStartYRef.current = e.touches?.[0]?.clientY ?? null;
  };
  const handleDragMove = (e) => {
    if (dragStartYRef.current == null) return;
    const currentY = e.touches?.[0]?.clientY ?? dragStartYRef.current;
    const delta = Math.max(0, currentY - dragStartYRef.current);
    setTranslateY(delta);
  };
  const handleDragEnd = () => {
    if (dragStartYRef.current == null) return;
    dragStartYRef.current = null;
    const SHEET_DISMISS_PX = 100;
    if (translateY >= SHEET_DISMISS_PX) {
      void handleClose();
    } else {
      setTranslateY(0);
    }
  };

  // Backdrop fades proportionally with the sheet drag.
  const backdropOpacity = translateY > 0
    ? Math.max(0, 1 - translateY / 300)
    : 1;

  // Breadcrumb (taxonomy position) for the two-row block.
  const breadcrumbCategoryId = suggestionConfig?.categoryId || item.categoryId || null;
  const breadcrumbAisleId = suggestionConfig?.aisleId
    || (breadcrumbCategoryId ? categoryMap[breadcrumbCategoryId]?.aisleId || null : null);
  const breadcrumbAisleName = breadcrumbAisleId && aisleMap[breadcrumbAisleId]?.name
    ? formatAisleNameForDisplay(aisleMap[breadcrumbAisleId].name)
    : null;
  const breadcrumbCategoryName = breadcrumbCategoryId && categoryMap[breadcrumbCategoryId]?.name
    ? categoryMap[breadcrumbCategoryId].name
    : null;
  const hasBreadcrumb = Boolean(breadcrumbAisleName && breadcrumbCategoryName);
  const canEditTaxonomy = Boolean(suggestionConfig);
  const canPinAction = Boolean(suggestionConfig || item.promoteToShortcut);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      onClick={handleClose}
    >
      <div
        className="absolute inset-0 bg-black/40 transition-opacity md:bg-black/50"
        style={{ opacity: backdropOpacity }}
      />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-xl animate-slide-up md:max-h-[85vh] md:max-w-md md:overflow-hidden md:rounded-3xl md:border md:border-gray-200 md:animate-none md:shadow-xl md:flex md:flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ transform: translateY > 0 ? `translateY(${translateY}px)` : undefined, transition: dragStartYRef.current == null ? 'transform 200ms ease-out' : 'none' }}
      >
        <div
          className="flex justify-center pt-3 pb-1 md:hidden touch-none"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="px-6 pt-2 md:flex-1 md:flex md:flex-col md:min-h-0 md:overflow-y-auto md:pt-6 md:pb-6" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-medium text-gray-500">Name</p>
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
              {saveError && (
                <p className="text-xs font-medium text-red-600">{saveError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving}
              className="flex flex-shrink-0 p-2 -mr-2 -mt-1 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Quantity</p>
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
          <div className="mt-8 space-y-1 text-xs text-gray-400">
            {(addedByName || addedAtFormatted) && (
              <p>
                {addedByName ? `Added by ${addedByName}` : 'Added'}
                {addedAtFormatted ? ` · ${addedAtFormatted}` : ''}
              </p>
            )}
            <p>{lastPurchasedFormatted ? `Last purchased: ${lastPurchasedFormatted}` : 'No purchase history'}</p>
          </div>

          {item.promotionHint && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-800">
                Bought {item.promotionHint.checkedCount}× recently
              </p>
            </div>
          )}

          {(hasBreadcrumb || canPinAction) && (
            <div className="mt-6 space-y-2">
              {hasBreadcrumb && (
                canEditTaxonomy ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfigAisleId(suggestionConfig.aisleId || '');
                      setConfigCatId(suggestionConfig.categoryId || '');
                      setConfigOpen(open => !open);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-left"
                  >
                    <span className="flex-1 text-xs text-gray-500">
                      <span className="font-semibold tracking-wide">{breadcrumbAisleName}</span>
                      <span className="mx-1.5 text-gray-300">›</span>
                      <span>{breadcrumbCategoryName}</span>
                    </span>
                    <ChevronRight size={14} className={`text-gray-400 transition-transform ${configOpen ? 'rotate-90' : ''}`} />
                  </button>
                ) : (
                  <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50">
                    <span className="flex-1 text-xs text-gray-500">
                      <span className="font-semibold tracking-wide">{breadcrumbAisleName}</span>
                      <span className="mx-1.5 text-gray-300">›</span>
                      <span>{breadcrumbCategoryName}</span>
                    </span>
                  </div>
                )
              )}

              {canEditTaxonomy && configOpen && (
                <div className="rounded-xl bg-gray-50 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-500">Aisle</label>
                    <select
                      value={configAisleId}
                      onChange={(e) => {
                        const nextAisle = e.target.value;
                        setConfigAisleId(nextAisle);
                        const opts = categoriesForAisle(nextAisle);
                        setConfigCatId(opts[0]?.id || '');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#FF7A7A]/30"
                    >
                      {orderedAisles.map(a => (
                        <option key={a.id} value={a.id}>{formatAisleNameForDisplay(a.name)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-500">Category</label>
                    <select
                      value={configCatId}
                      onChange={async (e) => {
                        const nextCat = e.target.value;
                        setConfigCatId(nextCat);
                        if (!nextCat) return;
                        if (nextCat === suggestionConfig.categoryId) {
                          setConfigOpen(false);
                          return;
                        }
                        try {
                          await suggestionConfig.onMove(nextCat);
                        } catch {
                          /* silently fail */
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#FF7A7A]/30"
                    >
                      {categoriesForAisle(configAisleId).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {canPinAction && (
                canEditTaxonomy ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (pinActionLoading) return;
                      setPinActionLoading(true);
                      try {
                        await suggestionConfig.onRemove();
                      } catch {
                        setPinActionLoading(false);
                      }
                    }}
                    disabled={pinActionLoading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-red-200 bg-white text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    <Pin size={14} />
                    {pinActionLoading ? 'Unpinning…' : 'Unpin'}
                  </button>
                ) : item.promoteToShortcut ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (pinActionLoading) return;
                      setPinActionLoading(true);
                      try {
                        const config = await item.promoteToShortcut();
                        if (config) setPromotedConfig(config);
                      } catch {
                        /* silently fail */
                      } finally {
                        setPinActionLoading(false);
                      }
                    }}
                    disabled={pinActionLoading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border bg-white text-sm font-semibold hover:bg-[#FFF5F5] disabled:opacity-50"
                    style={{ color: '#FF7A7A', borderColor: 'rgba(255, 122, 122, 0.4)' }}
                  >
                    <Pin size={14} fill="currentColor" />
                    {pinActionLoading ? 'Pinning…' : 'Pin'}
                  </button>
                ) : null
              )}
            </div>
          )}
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
              ? 'Your account and all household data will be permanently deleted — including the shopping list, history, and all shortcuts. Other household members will lose access.'
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

function PurchaseHistory({ householdId, aisles = {}, categories = {} }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /** Raw groups from Firebase (no aisle labels); `null` until first fetch completes for this household. */
  const [baseDayGroups, setBaseDayGroups] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBaseDayGroups(null);
    (async () => {
      try {
        const snap = await get(ref(database, `households/${householdId}/item-events`));
        if (cancelled) return;
        const raw = snap.val() || {};
        const events = Object.values(raw).filter(e => e && typeof e.ts === 'number');

        // Effective purchases only (see purchaseSemantics.js — uncheck within 2h voids prior check)
        const dayMap = new Map(); // dateStr -> Map(rowKey -> { name, category, categoryId?, qty, count, quantityLabel })
        for (const e of computeEffectiveCheckEvents(events)) {
          const dateStr = new Date(e.ts).toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
          if (!dayMap.has(dateStr)) dayMap.set(dateStr, new Map());
          const items = dayMap.get(dateStr);
          const key = e.itemKey != null && String(e.itemKey).trim() !== ''
            ? `k:${String(e.itemKey)}`
            : `${(e.category || '').toLowerCase()}::${(e.name || '').toLowerCase()}`;
          if (!items.has(key)) {
            items.set(key, {
              name: e.name,
              category: e.category,
              categoryId: e.categoryId || null,
              qty: e.qty || 1,
              quantityLabel: (e.quantityLabel && String(e.quantityLabel).trim()) || '',
              count: 0,
            });
          }
          const item = items.get(key);
          if (e.categoryId && !item.categoryId) item.categoryId = e.categoryId;
          item.count++;
          if (e.qty) item.qty = e.qty;
          if (e.quantityLabel && String(e.quantityLabel).trim()) {
            item.quantityLabel = String(e.quantityLabel).trim();
          }
        }

        // Build sorted groups (newest first); aisle labels applied in useMemo when taxonomy is available
        const groups = [];
        for (const [dateStr, items] of dayMap) {
          const purchased = Array.from(items.values()).filter(i => i.count > 0);
          if (purchased.length > 0) {
            purchased.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
            groups.push({ dateStr, items: purchased });
          }
        }
        groups.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

        setBaseDayGroups(groups);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  const dayGroups = useMemo(() => {
    if (baseDayGroups == null) return [];
    const catIdToAisleDisplay = {};
    for (const [catId, cat] of Object.entries(categories)) {
      if (!cat?.aisleId) continue;
      const aisleName = aisles[cat.aisleId]?.name;
      if (aisleName != null && String(aisleName).trim() !== '') {
        catIdToAisleDisplay[catId] = formatAisleNameForDisplay(aisleName);
      }
    }
    const catNameLowerToAisleDisplay = {};
    for (const cat of Object.values(categories)) {
      if (!cat?.name || !cat?.aisleId) continue;
      const aisleName = aisles[cat.aisleId]?.name;
      if (aisleName == null || String(aisleName).trim() === '') continue;
      catNameLowerToAisleDisplay[String(cat.name).toLowerCase()] = formatAisleNameForDisplay(aisleName);
    }
    const aisleLabelForRow = (row) => {
      if (row.categoryId && catIdToAisleDisplay[row.categoryId]) {
        return catIdToAisleDisplay[row.categoryId];
      }
      const k = (row.category || '').toLowerCase();
      if (k && catNameLowerToAisleDisplay[k]) return catNameLowerToAisleDisplay[k];
      return '';
    };
    return baseDayGroups.map((group) => {
      const items = group.items
        .map((row) => {
          const aisleLabel = aisleLabelForRow(row);
          return { ...row, aisleLabel: aisleLabel || (row.category || '') };
        })
        .sort((a, b) => (a.aisleLabel || '').localeCompare(b.aisleLabel || '') || a.name.localeCompare(b.name));
      return { dateStr: group.dateStr, items };
    });
  }, [baseDayGroups, aisles, categories]);

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
  if (baseDayGroups != null && dayGroups.length === 0) {
    return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-gray-400 text-sm">No purchases yet. Check off items on your shopping list to start tracking.</div></div>;
  }

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
              {group.items.map((item, i) => {
                const qtyText = (item.quantityLabel && item.quantityLabel.trim())
                  || (item.qty > 1 ? String(item.qty) : '');
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Check size={16} className="text-gray-300 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-gray-700">
                      {item.name}
                      {qtyText ? (
                        <span className="ml-1 text-gray-400 font-medium">{qtyText}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-gray-400 uppercase tracking-wide flex-shrink-0">{item.aisleLabel}</span>
                  </div>
                );
              })}
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
  const [showHouseholdInsights, setShowHouseholdInsights] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [currentPage, setCurrentPage] = useState('list');
  const [showMenu, setShowMenu] = useState(false);
  const [list, setList] = useState([]);
  const [aislesV2, setAislesV2] = useState({});
  const [categoriesV2, setCategoriesV2] = useState({});
  const [visibleItemsV2, setVisibleItemsV2] = useState({});
  const [libraryItemsV2, setLibraryItemsV2] = useState({});
  const [onboardingCompleted, setOnboardingCompleted] = useState(null);
  const [quickAddMode, setQuickAddMode] = useState(false);
  const [categorySearches, setCategorySearches] = useState({});
  const [loading, setLoading] = useState(true);
  const [pendingOps, setPendingOps] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [localDataLoaded, setLocalDataLoaded] = useState(false);
  /** Raw taxonomy blob from IndexedDB; applied only when `householdId` matches `blob.householdId`. */
  const [localTaxonomyV2Blob, setLocalTaxonomyV2Blob] = useState(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  /** Clear chip first-run tooltip: shows once per device when chip first appears. localStorage-gated. */
  const [showClearChipTooltip, setShowClearChipTooltip] = useState(false);
  const scrollTimeoutRef = useRef(null);
  const prevQuickAddMode = useRef(quickAddMode);
  /** Last aisle-id key we applied shop default expansion for (empty = not yet seeded in shop). */
  const shopAisleDefaultsKeyRef = useRef('');
  /** When this differs from `householdId`, reset shop aisle refs so switching accounts re-applies defaults. */
  const shopAisleDefaultsHouseholdIdRef = useRef(null);
  /** Shop mode: previous snapshot of whether each aisle had any list items (for auto-collapse when emptied). */
  const prevShopAisleHadItemsRef = useRef({});

  // --- A1/B1 suggestion intelligence ---
  const [suggestionDismissals, setSuggestionDismissals] = useState({});
  const [promotionCandidatesCache, setPromotionCandidatesCache] = useState([]);
  const [dormantShortcutsCache, setDormantShortcutsCache] = useState([]);
  const lastScrollY = useRef(0);
  const lastScrollTime = useRef(Date.now());
  const smoothedVelocity = useRef(0);
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [showOfflineToast, setShowOfflineToast] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showLoginExplicitly, setShowLoginExplicitly] = useState(false);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [members, setMembers] = useState({});

  const orderedV2AisleIds = Object.keys(aislesV2)
    .sort((a, b) => (aislesV2[a]?.order ?? 0) - (aislesV2[b]?.order ?? 0));
  const v2CategoriesByAisle = orderedV2AisleIds.reduce((acc, aisleId) => {
    acc[aisleId] = [];
    return acc;
  }, {});
  const v2CategoryNameById = {};
  for (const [catId, cat] of Object.entries(categoriesV2)) {
    if (!cat) continue;
    v2CategoryNameById[catId] = cat.name;
    if (cat.aisleId && v2CategoriesByAisle[cat.aisleId]) {
      v2CategoriesByAisle[cat.aisleId].push(catId);
    }
  }
  const categoryIdByName = Object.entries(categoriesV2).reduce((acc, [catId, cat]) => {
    if (cat?.name) acc[cat.name] = catId;
    return acc;
  }, {});
  const categoryNameForId = (catId) => categoriesV2[catId]?.name || null;
  const normalizeListItem = (item) => {
    const categoryId = item?.categoryId || categoryIdByName[item?.category] || null;
    const category = item?.category || categoryNameForId(categoryId) || '';
    return {
      ...item,
      categoryId,
      category,
      itemKey: item?.itemKey || (item?.id != null && item.id !== '' ? String(item.id) : generateId()),
    };
  };
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemLastPurchased, setSelectedItemLastPurchased] = useState(null);
  const [quantityDefaults, setQuantityDefaults] = useState({});
  const authResolvedRef = useRef(false);
  const getStableItemKey = (item) => item?.itemKey || String(item?.id || '');
  const currentEditor = user?.uid || 'unknown';
  const stampRecord = (record) => ({
    ...record,
    updatedAt: Date.now(),
    updatedBy: currentEditor,
  });

  useEffect(() => {
    if (!Object.keys(aislesV2).length || !Object.keys(categoriesV2).length) return;
    saveTaxonomyV2Locally({
      ...(householdId ? { householdId } : {}),
      aisles: aislesV2,
      categories: categoriesV2,
      visibleItems: visibleItemsV2,
      library: libraryItemsV2,
    });
  }, [householdId, aislesV2, categoriesV2, visibleItemsV2, libraryItemsV2]);

  // Legacy: categories that were "hidden" or lost an aisle are reassigned to the first aisle (merge is how categories are removed now).
  useEffect(() => {
    if (!householdId) return;
    const firstAisleId = Object.keys(aislesV2)
      .sort((a, b) => (aislesV2[a]?.order ?? 0) - (aislesV2[b]?.order ?? 0))[0];
    if (!firstAisleId) return;
    const aisleKeySet = new Set(Object.keys(aislesV2));
    let categoriesPointingAtKnownAisle = 0;
    for (const c of Object.values(categoriesV2)) {
      if (c?.aisleId && aisleKeySet.has(c.aisleId)) categoriesPointingAtKnownAisle++;
    }
    const totalCats = Object.keys(categoriesV2).length;
    // Stale IndexedDB from another household yields ids that match no aisle; without this guard
    // every category would be moved to aisle #1 (Produce) before Firebase overwrites state.
    if (totalCats >= 10 && categoriesPointingAtKnownAisle === 0 && aisleKeySet.size >= 3) {
      return;
    }
    const base = `households/${householdId}/taxonomy`;
    const updates = {};
    for (const [cid, c] of Object.entries(categoriesV2)) {
      if (!c) continue;
      const aisleMissing = !c.aisleId || !aislesV2[c.aisleId];
      if (c.hidden === true || aisleMissing) {
        updates[`${base}/categories/${cid}`] = stampRecord({
          ...c,
          hidden: false,
          aisleId: firstAisleId,
        });
      }
    }
    if (Object.keys(updates).length === 0) return;
    update(ref(database), updates).catch((err) => {
      logger.error('App', 'taxonomy legacy category migration failed', { error: err.message });
    });
  }, [householdId, aislesV2, categoriesV2]);

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
        // No Firebase session — stop RTDB log writes (avoids PERMISSION_DENIED after sign-out or token loss)
        logger.setUserId(null);
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
        const offlineDb = await initOfflineDB();
        logger.debug(
          'OfflineStorage',
          offlineDb ? 'IndexedDB initialized' : 'IndexedDB unavailable (offline cache disabled for this session)'
        );

        const [localList, localTaxonomyV2, localQuantityDefaults, syncTime] = await Promise.all([
          loadShoppingListLocally(),
          loadTaxonomyV2Locally(),
          loadQuantityDefaultsLocally(),
          getLastSyncTime()
        ]);

        logger.info('OfflineStorage', 'Local data loaded', {
          hasLocalList: !!localList,
          listItemCount: localList?.length || 0,
          taxonomyV2AislesCount: Object.keys(localTaxonomyV2?.aisles || {}).length,
          taxonomyV2CategoriesCount: Object.keys(localTaxonomyV2?.categories || {}).length,
          lastSyncTime: syncTime
        });

        if (localList !== null && localList !== undefined) {
          setList(localList.map(normalizeListItem));
        }
        setLocalTaxonomyV2Blob(localTaxonomyV2 ?? null);
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

  // Offline taxonomy: only merge IndexedDB snapshot when it belongs to this household.
  useEffect(() => {
    if (!localDataLoaded || !householdId) return;
    const blob = localTaxonomyV2Blob;
    if (!blob || blob.householdId !== householdId) return;
    setAislesV2(blob.aisles || {});
    setCategoriesV2(blob.categories || {});
    setVisibleItemsV2(blob.visibleItems || {});
    setLibraryItemsV2(blob.library || {});
  }, [localDataLoaded, householdId, localTaxonomyV2Blob]);

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
    const listRef = ref(database, `${hPath}/shopping-list`);
    const quantityDefaultsRef = ref(database, `${hPath}/quantity-defaults`);

    logger.debug('Firebase', 'Setting up data listeners');

    const unsubList = onValue(listRef, (snapshot) => {
      const data = snapshotShoppingListToArray(snapshot.val()).map(normalizeListItem);
      logger.info('Firebase', 'Shopping list data received', {
        itemCount: data.length,
        timestamp: Date.now()
      });
      setList(data);
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

    const aislesRef       = ref(database, `${hPath}/taxonomy/aisles`);
    const categoriesV2Ref = ref(database, `${hPath}/taxonomy/categories`);
    const visibleRef      = ref(database, `${hPath}/taxonomy/visible-items`);
    const libraryRef      = ref(database, `${hPath}/taxonomy/library`);
    const onboardingRef   = ref(database, `${hPath}/taxonomy/onboarding_completed`);

    const unsubAisles = onValue(aislesRef, (snap) => {
      setAislesV2(snap.val() || {});
    }, (error) => {
      logger.error('Firebase', 'Aisles listener error', { error: error.message, code: error.code });
    });
    const unsubCategoriesV2 = onValue(categoriesV2Ref, (snap) => {
      setCategoriesV2(snap.val() || {});
    }, (error) => {
      logger.error('Firebase', 'Categories v2 listener error', { error: error.message, code: error.code });
    });
    const unsubVisible = onValue(visibleRef, (snap) => {
      const raw = snap.val() || {};
      // Stored as { catId: Array | { pushId: {id, name} } }. Normalize to arrays.
      const norm = {};
      for (const [catId, v] of Object.entries(raw)) {
        if (Array.isArray(v)) norm[catId] = v.filter(Boolean);
        else if (v && typeof v === 'object') norm[catId] = Object.values(v);
        else norm[catId] = [];
      }
      setVisibleItemsV2(norm);
    }, (error) => {
      logger.error('Firebase', 'Visible items listener error', { error: error.message, code: error.code });
    });
    const unsubLibrary = onValue(libraryRef, (snap) => {
      const raw = snap.val() || {};
      const norm = {};
      for (const [catId, v] of Object.entries(raw)) {
        if (Array.isArray(v)) norm[catId] = v.filter(Boolean);
        else if (v && typeof v === 'object') norm[catId] = Object.values(v);
        else norm[catId] = [];
      }
      setLibraryItemsV2(norm);
    }, (error) => {
      logger.error('Firebase', 'Library items listener error', { error: error.message, code: error.code });
    });
    const unsubOnboarding = onValue(onboardingRef, (snap) => {
      const v = snap.val();
      setOnboardingCompleted(v === null || v === undefined ? null : v === true);
    }, (error) => {
      logger.error('Firebase', 'Onboarding flag listener error', { error: error.message, code: error.code });
    });

    setLoading(false);

    return () => {
      unsubConnected();
      setIsConnected(false);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubList();
      unsubMembers();
      unsubQuantityDefaults();
      unsubAisles();
      unsubCategoriesV2();
      unsubVisible();
      unsubLibrary();
      unsubOnboarding();
    };
  }, [user?.uid, householdId]);

  const save = async (key, value) => {
    if (!householdId) {
      logger.warn('Firebase', 'Save skipped: missing householdId', { key });
      return;
    }
    const fullKey = `households/${householdId}/${key}`;
    const opId = Date.now();
    logger.info('Firebase', 'Starting Firebase save operation', {
      opId,
      key: fullKey,
      dataType: Array.isArray(value) ? 'array' : typeof value,
      ...(Array.isArray(value) ? { itemCount: value.length } : {})
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

  /** When a list item has a taxonomy category, ensure its name exists in that category's library (not visible/suggestions). */
  const ensureListItemNameInLibrary = async (name, categoryId) => {
    if (!householdId || !categoryId) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const vis = visibleItemsV2[categoryId] || [];
    const lib = libraryItemsV2[categoryId] || [];
    if (vis.some(i => i.name.toLowerCase() === lower)) return;
    if (lib.some(i => i.name.toLowerCase() === lower)) return;
    const base = `households/${householdId}/taxonomy`;
    const itemId = push(ref(database, `${base}/library/${categoryId}`)).key;
    const nextLib = [...lib, stampRecord({ id: itemId, name: trimmed })].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    setLibraryItemsV2(prev => ({ ...prev, [categoryId]: nextLib }));
    try {
      await update(ref(database), {
        [`${base}/library/${categoryId}`]: nextLib,
      });
    } catch (err) {
      logger.warn('App', 'ensureListItemNameInLibrary failed', { error: err.message, categoryId });
    }
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
    if (event.categoryId) payload.categoryId = event.categoryId;
    if (event.itemKey != null && String(event.itemKey).trim() !== '') {
      payload.itemKey = String(event.itemKey).trim().slice(0, 80);
    }
    if (event.source) payload.source = event.source;
    if (event.qty != null) payload.qty = Number(event.qty);
    const qLabel = (event.quantityLabel != null && String(event.quantityLabel).trim())
      ? String(event.quantityLabel).trim().slice(0, 100)
      : '';
    if (qLabel) payload.quantityLabel = qLabel;
    try {
      push(ref(database, `households/${householdId}/item-events`), payload)
        .catch(err => logger.warn('App', 'item-event write failed', { error: err.message, action: payload.action }));
    } catch (err) {
      logger.warn('App', 'item-event push threw', { error: err.message });
    }
  };

  const addItem = (name, category, source = 'quickAdd', itemKey = generateId(), categoryIdOverride = null) => {
    const defaultQuantity = getDefaultQuantityForItem(itemKey, name);
    const categoryIdResolved = categoryIdOverride || categoryIdByName[category] || null;
    const newList = [...list, stampRecord({
      id: Date.now(),
      itemKey,
      name,
      category,
      categoryId: categoryIdResolved,
      quantity: defaultQuantity,
      done: false,
      addedBy: user?.uid || null,
      addedAt: Date.now(),
    })];
    setList(newList);
    save('shopping-list', newList);
    saveShoppingListLocally(newList);
    logItemEvent({
      name,
      category,
      categoryId: categoryIdResolved,
      action: 'added',
      source,
      qty: Number(defaultQuantity) || 1,
      quantityLabel: (defaultQuantity || '').trim() || undefined,
    });
    void ensureListItemNameInLibrary(name, categoryIdResolved);
  };

  const getItemCategoryId = (item) => item?.categoryId || categoryIdByName[item?.category] || null;
  const getShoppingCategoryName = (item) => {
    const catId = getItemCategoryId(item);
    return (catId && categoryNameForId(catId)) || item?.category || '';
  };

  const toggleDone = (id) => {
    const target = list.find(item => item.id === id);
    const newList = list.map(item => item.id === id ? stampRecord({ ...item, done: !item.done }) : item);
    setList(newList); // Optimistic update
    save('shopping-list', newList);
    saveShoppingListLocally(newList);
    if (target) {
      logItemEvent({
        name: target.name,
        category: getShoppingCategoryName(target),
        categoryId: getItemCategoryId(target),
        itemKey: getStableItemKey(target),
        action: target.done ? 'unchecked' : 'checked',
        qty: Number(target.quantity) || 1,
        quantityLabel: (target.quantity || '').trim() || undefined,
      });
    }
  };

  const updateQuantity = (itemKey, qty) => {
    setList((prevList) => {
      const nextList = prevList.map(item =>
        getStableItemKey(item) === itemKey
          ? stampRecord({ ...item, itemKey: getStableItemKey(item), quantity: qty })
          : item
      );
      save('shopping-list', nextList);
      saveShoppingListLocally(nextList);

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

  const loadLastPurchasedForItemQuery = async (query) => {
    if (!householdId) {
      setSelectedItemLastPurchased(null);
      return;
    }
    try {
      const eventsSnap = await get(ref(database, `households/${householdId}/item-events`));
      const raw = eventsSnap.val();
      if (!raw) {
        setSelectedItemLastPurchased(null);
        return;
      }
      const all = Object.values(raw);
      setSelectedItemLastPurchased(lastEffectivePurchaseTimestamp(all, query, {}));
    } catch (err) {
      logger.warn('App', 'Failed to fetch last purchased for item', { error: err.message });
    }
  };

  const computeRenameOutcome = (prevList, itemKey, trimmed, vis, lib) => {
    const target = prevList.find(item => getStableItemKey(item) === itemKey);
    if (!target || !trimmed) return null;
    const targetName = String(target.name ?? '').trim();
    if (trimmed === targetName) return null;

    const oldNameLower = targetName.toLowerCase();
    const targetStableKey = getStableItemKey(target);
    const renamedTarget = stampRecord({ ...target, itemKey: targetStableKey, name: trimmed });
    const nextList = [];
    for (const item of prevList) {
      const sameLogicalRow = getStableItemKey(item) === itemKey;
      const orphanWithOldName = !sameLogicalRow
        && (item.categoryId || item.category) === (target.categoryId || target.category)
        && String(item.name ?? '').trim().toLowerCase() === oldNameLower;
      if (orphanWithOldName) continue;
      nextList.push(sameLogicalRow ? renamedTarget : item);
    }

    const renameBucket = (bucketMap) => {
      const out = {};
      let changed = false;
      for (const [catId, items] of Object.entries(bucketMap || {})) {
        const renamed = (items || []).map((s) =>
          String(s?.name ?? '').trim().toLowerCase() === oldNameLower ? { ...s, name: trimmed } : s
        );
        const hitChange = renamed.some((s, i) => s !== items[i]);
        if (!hitChange) { out[catId] = items; continue; }
        changed = true;
        const seen = new Set();
        const deduped = [];
        for (const s of renamed.sort((a, b) => a.name.localeCompare(b.name))) {
          const key = String(s.name ?? '').trim().toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(s);
        }
        out[catId] = deduped;
      }
      return changed ? out : null;
    };
    const nextVisible = renameBucket(vis);
    const nextLibrary = renameBucket(lib);
    return { nextList, nextVisible, nextLibrary };
  };

  const updateItemName = async (itemKey, nextName) => {
    const trimmed = (nextName || '').trim();
    let outcome = null;
    setList((prevList) => {
      outcome = computeRenameOutcome(prevList, itemKey, trimmed, visibleItemsV2, libraryItemsV2);
      return outcome ? outcome.nextList : prevList;
    });
    if (!outcome) return;

    save('shopping-list', outcome.nextList);
    saveShoppingListLocally(outcome.nextList);
    if (outcome.nextVisible) {
      setVisibleItemsV2(outcome.nextVisible);
      save('taxonomy/visible-items', outcome.nextVisible);
    }
    if (outcome.nextLibrary) {
      setLibraryItemsV2(outcome.nextLibrary);
      save('taxonomy/library', outcome.nextLibrary);
    }

    setSelectedItem(si => (si && getStableItemKey(si) === itemKey ? { ...si, name: trimmed } : si));
    const row = outcome.nextList.find(li => getStableItemKey(li) === itemKey);
    void loadLastPurchasedForItemQuery({
      name: trimmed,
      itemKey,
      categoryName: row ? getShoppingCategoryName(row) : '',
      categoryId: row ? getItemCategoryId(row) : null,
    });
  };

  const renameTaxonomySuggestionById = (categoryId, suggestionId, trimmed) => {
    if (!categoryId || !suggestionId) return;

    const renameIdInList = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return null;
      const target = arr.find((i) => i.id === suggestionId);
      if (!target) return null;
      if (String(target.name ?? '').trim() === trimmed) return null;
      const renamed = arr.map((i) => (i.id === suggestionId ? { ...i, name: trimmed } : i));
      const seen = new Set();
      const deduped = [];
      for (const s of renamed.sort((a, b) => a.name.localeCompare(b.name))) {
        const key = String(s.name ?? '').trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(s);
      }
      return deduped;
    };

    const nextVisSlice = renameIdInList(visibleItemsV2[categoryId]);
    const nextLibSlice = renameIdInList(libraryItemsV2[categoryId]);
    if (nextVisSlice === null && nextLibSlice === null) return;

    if (nextVisSlice !== null) {
      const nextVisible = { ...visibleItemsV2, [categoryId]: nextVisSlice };
      setVisibleItemsV2(nextVisible);
      save('taxonomy/visible-items', nextVisible);
    }
    if (nextLibSlice !== null) {
      const nextLibrary = { ...libraryItemsV2, [categoryId]: nextLibSlice };
      setLibraryItemsV2(nextLibrary);
      save('taxonomy/library', nextLibrary);
    }
  };

  const moveSuggestionToCategory = async (suggestionId, fromCatId, toCatId) => {
    if (!taxonomyBase || !suggestionId || !fromCatId || !toCatId || fromCatId === toCatId) return;
    const fromVis = visibleItemsV2[fromCatId] || [];
    const fromLib = libraryItemsV2[fromCatId] || [];
    const fromVisEntry = fromVis.find(i => i.id === suggestionId);
    const fromLibEntry = fromLib.find(i => i.id === suggestionId);
    const moving = fromVisEntry || fromLibEntry;
    if (!moving) return;
    const wasVisible = !!fromVisEntry;

    const nameLower = String(moving.name ?? '').trim().toLowerCase();
    const toVis = visibleItemsV2[toCatId] || [];
    const toLib = libraryItemsV2[toCatId] || [];
    const duplicate = toVis.some(i => i.name.toLowerCase() === nameLower)
      || toLib.some(i => i.name.toLowerCase() === nameLower);

    const nextFromVis = fromVis.filter(i => i.id !== suggestionId);
    const nextFromLib = fromLib.filter(i => i.id !== suggestionId);
    const nextTo = duplicate
      ? null
      : [...(wasVisible ? toVis : toLib), stampRecord({ id: moving.id, name: moving.name })]
          .sort((a, b) => a.name.localeCompare(b.name));

    const nextVisibleState = { ...visibleItemsV2, [fromCatId]: nextFromVis };
    const nextLibraryState = { ...libraryItemsV2, [fromCatId]: nextFromLib };
    if (nextTo && wasVisible) nextVisibleState[toCatId] = nextTo;
    if (nextTo && !wasVisible) nextLibraryState[toCatId] = nextTo;

    setVisibleItemsV2(nextVisibleState);
    setLibraryItemsV2(nextLibraryState);

    const updates = {
      [`${taxonomyBase}/visible-items/${fromCatId}`]: nextFromVis.length > 0 ? nextFromVis : null,
      [`${taxonomyBase}/library/${fromCatId}`]: nextFromLib.length > 0 ? nextFromLib : null,
    };
    if (nextTo && wasVisible) updates[`${taxonomyBase}/visible-items/${toCatId}`] = nextTo;
    if (nextTo && !wasVisible) updates[`${taxonomyBase}/library/${toCatId}`] = nextTo;
    await update(ref(database), updates);
  };

  const removeSuggestionEverywhere = async (suggestionId, catId) => {
    if (!taxonomyBase || !suggestionId || !catId) return;
    const vis = visibleItemsV2[catId] || [];
    const lib = libraryItemsV2[catId] || [];
    const demoted = vis.find(i => i.id === suggestionId);
    if (demoted) {
      const nextVis = vis.filter(i => i.id !== suggestionId);
      const nextLib = lib.some(i => i.id === suggestionId) ? lib : [...lib, demoted];
      setVisibleItemsV2(prev => ({ ...prev, [catId]: nextVis }));
      setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
      await update(ref(database), {
        [`${taxonomyBase}/visible-items/${catId}`]: nextVis.length > 0 ? nextVis : null,
        [`${taxonomyBase}/library/${catId}`]: nextLib,
      });
    } else {
      const nextLib = lib.filter(i => i.id !== suggestionId);
      if (nextLib.length === lib.length) return;
      setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
      await update(ref(database), {
        [`${taxonomyBase}/library/${catId}`]: nextLib.length > 0 ? nextLib : null,
      });
    }
  };

  const updateSuggestionQuantity = (itemKey, qty) => {
    const nextDefaults = { ...quantityDefaults };
    const t = String(qty ?? '').trim();
    if (t) nextDefaults[itemKey] = t;
    else delete nextDefaults[itemKey];
    void persistQuantityDefaults(nextDefaults);
  };

  const findShortcutForListItem = (item) => {
    const nameLower = String(item?.name ?? '').trim().toLowerCase();
    if (!nameLower) return null;
    const preferredCatId = getItemCategoryId(item);
    const searchIn = (catId) => {
      const vis = (visibleItemsV2[catId] || []).find(s => s.name.toLowerCase() === nameLower);
      if (vis) return { suggestionId: vis.id, categoryId: catId };
      return null;
    };
    if (preferredCatId) {
      const hit = searchIn(preferredCatId);
      if (hit) return hit;
    }
    for (const catId of Object.keys(categoriesV2)) {
      if (catId === preferredCatId) continue;
      const hit = searchIn(catId);
      if (hit) return hit;
    }
    return null;
  };

  const openItemSheet = async (item) => {
    const itemKey = getStableItemKey(item);
    const base = { ...item, itemKey, onQuantityChange: updateQuantity, onNameChange: updateItemName };
    // Surface pin/promote affordances in both Shop and Add mode so the sheet's
    // breadcrumb + Pin button work universally (per Pass 2 / decision 5.2).
    const match = findShortcutForListItem(item);
    if (match) {
      base.suggestionConfig = {
        categoryId: match.categoryId,
        aisleId: categoriesV2[match.categoryId]?.aisleId || null,
        onMove: async (toCatId) => {
          await moveSuggestionToCategory(match.suggestionId, match.categoryId, toCatId);
          const toCategoryName = categoriesV2[toCatId]?.name || '';
          const targetItemKey = itemKey;
          setList(prev => {
            const next = prev.map(li =>
              getStableItemKey(li) === targetItemKey
                ? { ...li, categoryId: toCatId, category: toCategoryName }
                : li
            );
            save('shopping-list', next);
            saveShoppingListLocally(next);
            return next;
          });
          setSelectedItem(null);
        },
        onRemove: async () => {
          await removeSuggestionEverywhere(match.suggestionId, match.categoryId);
          setSelectedItem(null);
        },
      };
    } else {
      const catId = getItemCategoryId(item);
      if (catId) {
        base.promoteToShortcut = async () => {
            const trimmed = String(item.name || '').trim();
            if (!trimmed || !taxonomyBase) return null;
            const vis = visibleItemsV2[catId] || [];
            const lib = libraryItemsV2[catId] || [];
            const lower = trimmed.toLowerCase();
            if (vis.some(i => i.name.toLowerCase() === lower)) return null;
            const libItem = lib.find(i => i.name.toLowerCase() === lower);
            const newId = libItem?.id || push(ref(database, `${taxonomyBase}/visible-items/${catId}`)).key;
            const entry = stampRecord({ id: newId, name: trimmed, createdAt: libItem?.createdAt || Date.now() });
            const nextVis = [...vis, entry];
            const nextLib = libItem ? lib.filter(i => i.id !== libItem.id) : lib;
            setVisibleItemsV2(prev => ({ ...prev, [catId]: nextVis }));
            if (libItem) setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
            const updates = { [`${taxonomyBase}/visible-items/${catId}`]: nextVis };
            if (libItem) updates[`${taxonomyBase}/library/${catId}`] = nextLib.length > 0 ? nextLib : null;
            await update(ref(database), updates);
            return {
              categoryId: catId,
              aisleId: categoriesV2[catId]?.aisleId || null,
              onMove: async (toCatId) => {
                await moveSuggestionToCategory(newId, catId, toCatId);
                const toCategoryName = categoriesV2[toCatId]?.name || '';
                const targetItemKey = itemKey;
                setList(prev => {
                  const next = prev.map(li =>
                    getStableItemKey(li) === targetItemKey
                      ? { ...li, categoryId: toCatId, category: toCategoryName }
                      : li
                  );
                  save('shopping-list', next);
                  saveShoppingListLocally(next);
                  return next;
                });
                setSelectedItem(null);
              },
              onRemove: async () => {
                await removeSuggestionEverywhere(newId, catId);
                setSelectedItem(null);
              },
            };
          };
        }
      }
    // Promotion hint: only meaningful for items that aren't already pinned.
    if (!base.suggestionConfig) {
      const lower = String(item.name || '').toLowerCase();
      const candidate = promotionCandidatesCache.find(c =>
        (c.name || '').toLowerCase() === lower
      );
      if (candidate) base.promotionHint = candidate;
    }
    setSelectedItem(base);
    setSelectedItemLastPurchased(null);
    await loadLastPurchasedForItemQuery({
      name: item.name,
      itemKey: getStableItemKey(item),
      categoryName: getShoppingCategoryName(item),
      categoryId: getItemCategoryId(item),
    });
  };

  const openSuggestionSheet = async (cat, suggestion) => {
    const categoryId = suggestion.catId || categoryIdByName[cat] || null;
    const suggestionId = suggestion.id;
    const defaultQty = getDefaultQuantityForItem(suggestionId, suggestion.name);
    const onNameChange = categoryId
      ? async (itemKey, nextName) => {
          const trimmed = (nextName || '').trim();
          if (!trimmed) return;
          renameTaxonomySuggestionById(categoryId, itemKey, trimmed);
          setSelectedItem(si =>
            si && String(si.itemKey) === String(itemKey) ? { ...si, name: trimmed } : si
          );
          void loadLastPurchasedForItemQuery({
            name: trimmed,
            itemKey: suggestionId,
            categoryName: cat,
            categoryId,
          });
        }
      : undefined;
    const suggestionConfig = categoryId
      ? {
          categoryId,
          aisleId: categoriesV2[categoryId]?.aisleId || null,
          onMove: async (toCatId) => {
            await moveSuggestionToCategory(suggestionId, categoryId, toCatId);
            setSelectedItem(null);
          },
          onRemove: async () => {
            await removeSuggestionEverywhere(suggestionId, categoryId);
            setSelectedItem(null);
          },
        }
      : null;
    const item = {
      ...suggestion,
      category: cat,
      categoryId,
      itemKey: suggestionId,
      quantity: (suggestion.quantity || '').trim() || defaultQty,
      onQuantityChange: updateSuggestionQuantity,
      ...(onNameChange ? { onNameChange } : {}),
      ...(suggestionConfig ? { suggestionConfig } : {}),
    };
    setSelectedItem(item);
    setSelectedItemLastPurchased(null);
    await loadLastPurchasedForItemQuery({
      name: suggestion.name,
      itemKey: suggestionId,
      categoryName: cat,
      categoryId,
    });
  };

  const doneCount = list.reduce((n, item) => n + (item.done ? 1 : 0), 0);

  const clearDone = () => {
    const newList = list.filter(item => !item.done);
    setList(newList); // Optimistic update
    save('shopping-list', newList);
    saveShoppingListLocally(newList);
  };

  /**
   * First-run tooltip for the Clear chip. Shows once per device when chip first appears, then never again
   * (localStorage flag). Auto-dismisses after 4s. Tapping the chip itself dismisses naturally because
   * clearing all done items unmounts the chip.
   */
  const hasDone = doneCount > 0;
  useEffect(() => {
    if (!hasDone) {
      setShowClearChipTooltip(false);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const FLAG = 'tend.clearChipTooltipSeen.v1';
      if (window.localStorage.getItem(FLAG)) return;
      setShowClearChipTooltip(true);
      window.localStorage.setItem(FLAG, '1');
      const t = window.setTimeout(() => setShowClearChipTooltip(false), 4000);
      return () => window.clearTimeout(t);
    } catch {
      // localStorage unavailable (private mode, blocked, etc.) — silently skip the teaching moment.
    }
  }, [hasDone]);

  const removeItem = (id) => {
    const target = list.find(item => item.id === id);
    const newList = list.filter(item => item.id !== id);
    setList(newList); // Optimistic update
    save('shopping-list', newList);
    saveShoppingListLocally(newList);
    if (target && !target.done) {
      if (target.quantity && target.quantity.trim()) {
        const nextDefaults = { ...quantityDefaults, [getStableItemKey(target)]: target.quantity.trim() };
        persistQuantityDefaults(nextDefaults);
      }
      logItemEvent({
        name: target.name,
        category: getShoppingCategoryName(target),
        categoryId: getItemCategoryId(target),
        action: 'removed',
        qty: Number(target.quantity) || 1,
        quantityLabel: (target.quantity || '').trim() || undefined,
      });
    }
  };

  const addFromAisleSearch = (aisleId, suggestion) => {
    let catId = suggestion.catId;
    if (!catId) catId = (v2CategoriesByAisle[aisleId] || [])[0] || null;
    const categoryName = catId ? v2CategoryNameById[catId] : (aislesV2[aisleId]?.name || '');
    addItem(suggestion.name, categoryName, 'typed', generateId(), catId);
    setCategorySearches(prev => ({ ...prev, [aisleId]: '' }));
  };

  const getAisleSuggestions = (aisleId) => {
    const search = (categorySearches[aisleId] || '').toLowerCase().trim();
    if (!search) return [];
    const listNames = new Set(list.map(i => i.name.toLowerCase()));
    const catIds = v2CategoriesByAisle[aisleId] || [];
    const seen = new Set();
    const out = [];
    for (const catId of catIds) {
      const vis = visibleItemsV2[catId] || [];
      const lib = libraryItemsV2[catId] || [];
      for (const item of vis) {
        const lower = item.name.toLowerCase();
        if (seen.has(lower) || listNames.has(lower)) continue;
        if (lower.includes(search)) {
          seen.add(lower);
          out.push({ name: item.name, catId, suggestionId: item.id, fromVisible: true });
          if (out.length >= 10) return out;
        }
      }
      for (const item of lib) {
        const lower = item.name.toLowerCase();
        if (seen.has(lower) || listNames.has(lower)) continue;
        if (lower.includes(search)) {
          seen.add(lower);
          out.push({ name: item.name, catId, suggestionId: item.id, fromVisible: false });
          if (out.length >= 10) return out;
        }
      }
    }
    return out;
  };

  const getAisleDropdownItems = (aisleId) => {
    const raw = (categorySearches[aisleId] || '').trim();
    if (!raw) return [];
    const base = getAisleSuggestions(aisleId);
    const rawLc = raw.toLowerCase();
    const hasExact = base.some(s => s.name.toLowerCase() === rawLc);
    return hasExact ? base : [{ name: raw, catId: null, suggestionId: null, fromVisible: false }, ...base];
  };

  const organized = orderedV2AisleIds.map((aisleId) => {
    const catIds = v2CategoriesByAisle[aisleId] || [];
    const catIdSet = new Set(catIds);
    const catNames = new Set(catIds.map(id => v2CategoryNameById[id]).filter(Boolean));
    const aisleListItems = list.filter((i) => {
      const cid = getItemCategoryId(i);
      if (cid) return catIdSet.has(cid);
      return catNames.has(i.category);
    });
    const taken = new Set(list.map(i => i.name.toLowerCase()));
    const quickItems = quickAddMode
      ? catIds.flatMap(cid => (visibleItemsV2[cid] || [])
          .filter(v => !taken.has(v.name.toLowerCase()))
          .map(v => ({ ...v, catId: cid, catName: v2CategoryNameById[cid] })))
      : [];
    const all = [
      ...aisleListItems.map(i => ({ type: 'list', data: i, key: i.name.toLowerCase() })),
      ...quickItems.map(i => ({ type: 'quick', data: i, key: i.name.toLowerCase() })),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const aisleName = aislesV2[aisleId]?.name || '';
    return {
      aisleId,
      aisleName,
      aisleNameDisplay: formatAisleNameForDisplay(aisleName),
      items: all,
      has: all.length > 0,
      categoryIdSet: catIdSet,
      categoryNames: catNames,
    };
  });

  useEffect(() => {
    const modeChanged = prevQuickAddMode.current !== quickAddMode;
    prevQuickAddMode.current = quickAddMode;

    const aisleIdsKey = Object.keys(aislesV2)
      .sort((a, b) => (aislesV2[a]?.order ?? 0) - (aislesV2[b]?.order ?? 0))
      .join('\0');
    // Must match `organized` list filtering: if we have a category id, only that id's membership
    // in this aisle counts — do not fall back to name (duplicate names across aisles would
    // otherwise mark multiple aisles as "having" one item).
    const hasItemsInAisle = (g) => list.some((item) => {
      const cid = getItemCategoryId(item);
      if (cid) return g.categoryIdSet.has(cid);
      return g.categoryNames.has(item.category);
    });

    if (quickAddMode) {
      if (modeChanged) {
        const initial = {};
        organized.forEach((g) => {
          initial[g.aisleId] = true;
        });
        setExpandedCategories(initial);
        shopAisleDefaultsKeyRef.current = '';
        prevShopAisleHadItemsRef.current = {};
      }
      return;
    }

    const nextHadItems = {};
    organized.forEach((g) => {
      nextHadItems[g.aisleId] = hasItemsInAisle(g);
    });

    if (householdId !== shopAisleDefaultsHouseholdIdRef.current) {
      shopAisleDefaultsHouseholdIdRef.current = householdId;
      shopAisleDefaultsKeyRef.current = '';
      prevShopAisleHadItemsRef.current = {};
    }

    // Shop: collapsed by default; expand only when applying defaults (enter shop / first aisle load / aisle set change), not on every list update.
    if (modeChanged) {
      const initial = {};
      organized.forEach((g) => {
        initial[g.aisleId] = hasItemsInAisle(g);
      });
      setExpandedCategories(initial);
      shopAisleDefaultsKeyRef.current = aisleIdsKey;
      prevShopAisleHadItemsRef.current = nextHadItems;
      return;
    }

    if (aisleIdsKey !== shopAisleDefaultsKeyRef.current) {
      if (shopAisleDefaultsKeyRef.current === '') {
        const initial = {};
        organized.forEach((g) => {
          initial[g.aisleId] = hasItemsInAisle(g);
        });
        setExpandedCategories(initial);
      } else {
        setExpandedCategories((prev) => {
          const next = { ...prev };
          for (const g of organized) {
            if (!(g.aisleId in next)) next[g.aisleId] = false;
          }
          const idSet = new Set(organized.map((g) => g.aisleId));
          for (const id of Object.keys(next)) {
            if (!idSet.has(id)) delete next[id];
          }
          return next;
        });
      }
      shopAisleDefaultsKeyRef.current = aisleIdsKey;
    } else {
      const prevHad = prevShopAisleHadItemsRef.current;
      const toCollapse = [];
      for (const g of organized) {
        if (prevHad[g.aisleId] === true && !nextHadItems[g.aisleId]) {
          toCollapse.push(g.aisleId);
        }
      }
      if (toCollapse.length > 0) {
        setExpandedCategories((p) => {
          const n = { ...p };
          for (const id of toCollapse) n[id] = false;
          return n;
        });
      }
    }

    prevShopAisleHadItemsRef.current = nextHadItems;
  }, [quickAddMode, list, aislesV2, categoriesV2, householdId]);

  // --- A1/B1: Load events and compute candidates when entering Add mode ---
  useEffect(() => {
    if (!quickAddMode || !householdId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [evSnap, dismissSnap] = await Promise.all([
          get(ref(database, `households/${householdId}/item-events`)),
          get(ref(database, `households/${householdId}/suggestion-dismissals`)),
        ]);
        if (cancelled) return;
        const evRaw = evSnap.val() || {};
        const evList = Object.values(evRaw).filter(e => e && typeof e.ts === 'number');
        evList.sort((a, b) => a.ts - b.ts);

        const dismissRaw = dismissSnap.val() || {};
        setSuggestionDismissals(dismissRaw);

        const now = Date.now();
        const isDismissed = (key) => {
          const d = dismissRaw[key];
          if (!d) return false;
          if (d.resurfaceAfter === null || d.resurfaceAfter === undefined) {
            return d.dismissCount >= 2;
          }
          return d.resurfaceAfter > now;
        };

        const promo = promotionCandidates(evList, visibleItemsV2, categoriesV2, { now });
        const filtered = promo.filter(c => {
          const key = `${c.categoryId || c.category}::${(c.name || '').toLowerCase()}::promote`;
          return !isDismissed(key);
        });
        setPromotionCandidatesCache(filtered);

        const dormant = dormantShortcuts(evList, visibleItemsV2, categoriesV2, { now });
        const filteredDormant = dormant.filter(d => {
          const key = `${d.categoryId}::${(d.name || '').toLowerCase()}::demote`;
          return !isDismissed(key);
        });
        setDormantShortcutsCache(filteredDormant);
      } catch (err) {
        logger.warn('App', 'A1/B1 candidate computation failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [quickAddMode, householdId]);

  const dismissSuggestion = async (key, action) => {
    if (!householdId) return;
    const existing = suggestionDismissals[key];
    const count = (existing?.dismissCount || 0) + 1;
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const record = {
      action,
      dismissedAt: Date.now(),
      resurfaceAfter: count >= 2 ? null : Date.now() + NINETY_DAYS,
      dismissCount: count,
    };
    setSuggestionDismissals(prev => ({ ...prev, [key]: record }));
    try {
      await set(ref(database, `households/${householdId}/suggestion-dismissals/${key}`), record);
    } catch (err) {
      logger.warn('App', 'dismissal write failed', { error: err.message, key });
    }
  };

  const handlePromotionAccept = async (candidate) => {
    const catId = candidate.categoryId || categoryIdByName[(candidate.category || '').toLowerCase()];
    if (!catId || !taxonomyBase) return;
    const trimmed = (candidate.name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const vis = visibleItemsV2[catId] || [];
    const lib = libraryItemsV2[catId] || [];
    if (vis.some(i => i.name.toLowerCase() === lower)) return;
    const libItem = lib.find(i => i.name.toLowerCase() === lower);
    const newId = libItem?.id || push(ref(database, `${taxonomyBase}/visible-items/${catId}`)).key;
    const entry = stampRecord({ id: newId, name: trimmed, createdAt: libItem?.createdAt || Date.now() });
    const nextVis = [...vis, entry].sort((a, b) => a.name.localeCompare(b.name));
    const nextLib = libItem ? lib.filter(i => i.id !== libItem.id) : lib;
    setVisibleItemsV2(prev => ({ ...prev, [catId]: nextVis }));
    if (libItem) setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
    const updates = { [`${taxonomyBase}/visible-items/${catId}`]: nextVis };
    if (libItem) updates[`${taxonomyBase}/library/${catId}`] = nextLib.length > 0 ? nextLib : null;
    await update(ref(database), updates);
    setPromotionCandidatesCache(prev => prev.filter(c => c.name !== candidate.name || c.category !== candidate.category));
  };

  const handlePromotionDismiss = (candidate) => {
    const key = `${candidate.categoryId || candidate.category}::${(candidate.name || '').toLowerCase()}::promote`;
    dismissSuggestion(key, 'not-interested');
    setPromotionCandidatesCache(prev => prev.filter(c => c.name !== candidate.name || c.category !== candidate.category));
  };

  const handleDormantDemote = async (item) => {
    await removeSuggestionEverywhere(item.suggestionId, item.categoryId);
    setDormantShortcutsCache(prev => prev.filter(d => !(d.suggestionId === item.suggestionId && d.categoryId === item.categoryId)));
  };

  const handleDormantKeep = (item) => {
    const key = `${item.categoryId}::${(item.name || '').toLowerCase()}::demote`;
    dismissSuggestion(key, 'keep');
    setDormantShortcutsCache(prev => prev.filter(d => !(d.suggestionId === item.suggestionId && d.categoryId === item.categoryId)));
  };

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY.current;
      const scrollingUp = currentScrollY < lastScrollY.current;

      // Header visibility - hide when scrolling down past 50px, show when scrolling up.
      // Bottom nav bar (mobile) is independently fixed-positioned and stays visible regardless.
      if (scrollingDown && currentScrollY > 50) {
        setShowHeader(false);
        setShowMenu(false); // Close menu when hiding header
      } else if (scrollingUp) {
        setShowHeader(true);
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

  const handleLoginSuccess = useCallback(() => {
    setShowLoginExplicitly(false);
    // Login is an early return in this component; list/Shop state would otherwise persist (e.g. Account page).
    setCurrentPage('list');
    setQuickAddMode(false);
  }, []);

  const handleSignOut = async () => {
    setShowMenu(false);
    setCurrentPage('list');
    setQuickAddMode(false);
    logger.info('Auth', 'Sign out initiated');
    try {
      await logger.flush();
      logger.setUserId(null);
      // Clear IndexedDB auth before signOut so onAuthStateChanged never re-adopts a stale cached user
      await clearCachedUser();
      await firebaseSignOut(auth);
      setUser(null);
      setIsAdmin(false);
      setHouseholdId(null);
      setShowLoginExplicitly(true);
      logger.info('Auth', 'Sign out successful, cached user cleared');
    } catch (error) {
      logger.error('Auth', 'Sign out failed', {
        error: error.message,
        code: error.code
      });
    }
  };

  // Offline-first loading: show cached data immediately if available
  // Only block if: no cached data AND (still auth loading OR not logged in)
  const hasCachedData = localDataLoaded && (
    list.length > 0
    || Object.keys(aislesV2).length > 0
    || Object.keys(categoriesV2).length > 0
  );
  
  // We need re-auth if we are online but have no user, and we've finished checking auth
  const needsReauth = hasCachedData && !user && !authLoading && navigator.onLine;

  // Show login screen if:
  // 1. Explicitly requested
  // 2. No cached data AND (finished auth loading OR not logged in)
  const showLogin = showLoginExplicitly || (!hasCachedData && !authLoading && !user);

  if (showLogin) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // If we have cached data, show the app regardless of auth state (unless explicitly signing in)
  if (hasCachedData) {
    // Auth can happen in background, we already have data to show
  } else {
    // No cached data, need to check auth
    if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
    if (!user) return <Login onLoginSuccess={handleLoginSuccess} />;
    if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
  }

  // --- Taxonomy v2 handlers (wired to SuggestionsEditor) ---------------------
  const taxonomyBase = householdId ? `households/${householdId}/taxonomy` : null;
  async function taxoRenameAisle(aisleId, name) {
    if (!taxonomyBase) return;
    const trimmed = (name ?? '').trim();
    const payload = stampRecord({ name: trimmed });
    setAislesV2(prev => ({
      ...prev,
      [aisleId]: stampRecord({ ...(prev[aisleId] || {}), name: trimmed }),
    }));
    await update(ref(database, `${taxonomyBase}/aisles/${aisleId}`), payload);
  }
  async function taxoAddAisle(name) {
    if (!taxonomyBase) return;
    const newRef = push(ref(database, `${taxonomyBase}/aisles`));
    const order = Object.keys(aislesV2).length;
    const trimmed = (name ?? '').trim();
    const payload = stampRecord({ name: trimmed, order });
    setAislesV2(prev => ({
      ...prev,
      [newRef.key]: stampRecord({ name: trimmed, order }),
    }));
    await set(newRef, payload);
  }
  async function taxoDeleteAisle(aisleId) {
    if (!taxonomyBase) return;
    const hasCategories = Object.values(categoriesV2).some((c) => c?.aisleId === aisleId);
    if (hasCategories) return;
    const nextAisles = { ...aislesV2 };
    delete nextAisles[aisleId];
    setAislesV2(nextAisles);
    await remove(ref(database, `${taxonomyBase}/aisles/${aisleId}`));
  }
  async function taxoReorderAisles(orderedIds) {
    if (!taxonomyBase) return;
    const updates = {};
    orderedIds.forEach((id, i) => { updates[`${taxonomyBase}/aisles/${id}`] = stampRecord({ ...(aislesV2[id] || {}), order: i }); });
    setAislesV2(prev => {
      const next = { ...prev };
      orderedIds.forEach((id, i) => {
        if (next[id]) next[id] = stampRecord({ ...next[id], order: i });
      });
      return next;
    });
    await update(ref(database), updates);
  }
  async function taxoRenameCategory(catId, name) {
    if (!taxonomyBase) return;
    const payload = stampRecord({ name });
    setCategoriesV2(prev => ({
      ...prev,
      [catId]: stampRecord({ ...(prev[catId] || {}), name }),
    }));
    await update(ref(database, `${taxonomyBase}/categories/${catId}`), payload);
  }
  async function taxoAddCategory(aisleId, name) {
    if (!taxonomyBase) return;
    const newRef = push(ref(database, `${taxonomyBase}/categories`));
    const payload = stampRecord({ name, aisleId, hidden: false });
    setCategoriesV2(prev => ({
      ...prev,
      [newRef.key]: stampRecord({ name, aisleId, hidden: false }),
    }));
    await set(newRef, payload);
  }
  async function taxoMoveCategory(catId, aisleId) {
    if (!taxonomyBase) return;
    const payload = stampRecord({ aisleId, hidden: false });
    setCategoriesV2(prev => ({
      ...prev,
      [catId]: stampRecord({ ...(prev[catId] || {}), aisleId, hidden: false }),
    }));
    await update(ref(database, `${taxonomyBase}/categories/${catId}`), payload);
  }
  async function taxoMergeCategory(fromCatId, intoCatId) {
    if (!taxonomyBase || !fromCatId || !intoCatId || fromCatId === intoCatId) return;
    const fromCat = categoriesV2[fromCatId];
    const toCat = categoriesV2[intoCatId];
    if (!fromCat || !toCat) return;
    if (fromCat.aisleId !== toCat.aisleId || !fromCat.aisleId) return;

    const toVis = [...(visibleItemsV2[intoCatId] || [])];
    const toLib = [...(libraryItemsV2[intoCatId] || [])];
    const fromVis = visibleItemsV2[fromCatId] || [];
    const fromLib = libraryItemsV2[fromCatId] || [];

    const usedIds = new Set([...toVis, ...toLib].map((i) => i.id));
    const nameSeen = new Set(
      [...toVis, ...toLib].map((i) => String(i.name ?? '').trim().toLowerCase()),
    );
    const allocId = (preferredId) => {
      if (preferredId && !usedIds.has(preferredId)) {
        usedIds.add(preferredId);
        return preferredId;
      }
      const nid = push(ref(database, `${taxonomyBase}/visible-items/${intoCatId}`)).key;
      usedIds.add(nid);
      return nid;
    };

    const nextVis = [...toVis];
    const nextLib = [...toLib];
    for (const item of fromVis) {
      const k = String(item.name ?? '').trim().toLowerCase();
      if (!k || nameSeen.has(k)) continue;
      nameSeen.add(k);
      nextVis.push(stampRecord({ id: allocId(item.id), name: item.name }));
    }
    for (const item of fromLib) {
      const k = String(item.name ?? '').trim().toLowerCase();
      if (!k || nameSeen.has(k)) continue;
      nameSeen.add(k);
      nextLib.push(stampRecord({ id: allocId(item.id), name: item.name }));
    }
    nextVis.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    nextLib.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const toName = toCat.name || '';

    setCategoriesV2((prev) => {
      const next = { ...prev };
      delete next[fromCatId];
      return next;
    });
    setVisibleItemsV2((prev) => {
      const next = { ...prev };
      next[intoCatId] = nextVis;
      delete next[fromCatId];
      return next;
    });
    setLibraryItemsV2((prev) => {
      const next = { ...prev };
      next[intoCatId] = nextLib;
      delete next[fromCatId];
      return next;
    });

    setList((prev) => {
      const mapped = prev.map((li) =>
        getItemCategoryId(li) === fromCatId
          ? { ...li, categoryId: intoCatId, category: toName }
          : li,
      );
      save('shopping-list', mapped);
      saveShoppingListLocally(mapped);
      return mapped;
    });

    try {
      await update(ref(database), {
        [`${taxonomyBase}/categories/${fromCatId}`]: null,
        [`${taxonomyBase}/visible-items/${fromCatId}`]: null,
        [`${taxonomyBase}/library/${fromCatId}`]: null,
        [`${taxonomyBase}/visible-items/${intoCatId}`]: nextVis.length > 0 ? nextVis : null,
        [`${taxonomyBase}/library/${intoCatId}`]: nextLib.length > 0 ? nextLib : null,
      });
    } catch (err) {
      logger.error('App', 'taxoMergeCategory failed', { error: err.message });
    }
  }
  async function taxoRemoveLibraryItem(catId, itemId) {
    if (!taxonomyBase || !catId || !itemId) return;
    const lib = libraryItemsV2[catId] || [];
    if (!lib.some(i => i.id === itemId)) return;
    const nextLib = lib.filter(i => i.id !== itemId);
    setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
    await update(ref(database), {
      [`${taxonomyBase}/library/${catId}`]: nextLib.length > 0 ? nextLib : null,
    });
  }

  const completeOnboarding = async () => {
    if (!householdId) return;
    try {
      await set(ref(database, `households/${householdId}/taxonomy/onboarding_completed`), true);
    } catch (err) {
      logger.error('Firebase', 'Failed to mark onboarding complete', { error: err.message });
    }
  };

  const shouldShowOnboarding = Boolean(user) && !needsDisplayName
    && Object.keys(aislesV2).length > 0
    && Object.keys(categoriesV2).length > 0
    && onboardingCompleted === false;

  if (shouldShowOnboarding) {
    return (
      <Onboarding
        displayName={members?.[user.uid]?.displayName}
        aisles={aislesV2}
        categories={categoriesV2}
        visibleItems={visibleItemsV2}
        libraryItems={libraryItemsV2}
        onRenameAisle={taxoRenameAisle}
        onAddAisle={taxoAddAisle}
        onDeleteAisle={taxoDeleteAisle}
        onReorderAisles={taxoReorderAisles}
        onRenameCategory={taxoRenameCategory}
        onAddCategory={taxoAddCategory}
        onMoveCategory={taxoMoveCategory}
        onMergeCategory={taxoMergeCategory}
        onComplete={completeOnboarding}
      />
    );
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
        {/* Header — mobile: hamburger left, brand center, sync pill right (hides on scroll-down).
            Desktop (lg+): brand left, Shop/Add + Clear inline (when on list), nav links, sync pill. Always visible. */}
        <div className={`fixed top-0 left-0 right-0 bg-white shadow-sm z-50 transition-transform duration-300 lg:translate-y-0 ${showHeader ? 'translate-y-0' : '-translate-y-full'}`}>
          <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 lg:gap-3">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="lg:hidden p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Menu"
              >
                <Menu size={22} className="text-gray-700" />
              </button>

              <button
                onClick={() => { setCurrentPage('list'); setShowMenu(false); }}
                className="font-bold text-xl flex-1 lg:flex-none text-center lg:text-left"
                style={{ color: '#FF7A7A' }}
              >
                Shopping List
              </button>

              {currentPage === 'list' && (
                <div className="hidden lg:flex bg-gray-100 rounded-xl p-1 gap-1 ml-4">
                  <button
                    onClick={() => setQuickAddMode(false)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${!quickAddMode ? 'text-white' : 'text-gray-600 hover:text-gray-800'}`}
                    style={{ backgroundColor: !quickAddMode ? '#FF7A7A' : 'transparent' }}
                  >
                    <ShoppingCart size={16} strokeWidth={2.5} />
                    Shop
                  </button>
                  <button
                    onClick={() => setQuickAddMode(true)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${quickAddMode ? 'text-white' : 'text-gray-600 hover:text-gray-800'}`}
                    style={{ backgroundColor: quickAddMode ? '#FF7A7A' : 'transparent' }}
                  >
                    <ClipboardList size={16} strokeWidth={2.5} />
                    Add
                  </button>
                </div>
              )}

              {currentPage === 'list' && doneCount > 0 && (
                <button
                  onClick={clearDone}
                  className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-lg text-white font-bold text-sm hover:opacity-90"
                  style={{ backgroundColor: '#FF7A7A' }}
                >
                  <Check size={16} strokeWidth={2.5} />
                  Clear {doneCount} done
                </button>
              )}

              <div className="hidden lg:flex items-center gap-1 ml-auto">
                <button onClick={() => setCurrentPage('list')} className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${currentPage === 'list' ? '' : 'text-gray-600 hover:bg-gray-100'}`} style={currentPage === 'list' ? { color: '#FF7A7A' } : {}}>List</button>
                <button onClick={() => setCurrentPage('history')} className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${currentPage === 'history' ? '' : 'text-gray-600 hover:bg-gray-100'}`} style={currentPage === 'history' ? { color: '#FF7A7A' } : {}}>History</button>
                <button onClick={() => setCurrentPage('settings')} className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${currentPage === 'settings' ? '' : 'text-gray-600 hover:bg-gray-100'}`} style={currentPage === 'settings' ? { color: '#FF7A7A' } : {}}>Settings</button>
                <button onClick={() => setCurrentPage('account')} className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${currentPage === 'account' ? '' : 'text-gray-600 hover:bg-gray-100'}`} style={currentPage === 'account' ? { color: '#FF7A7A' } : {}}>Account</button>
              </div>

              <div className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 lg:px-3 py-1.5 rounded-full transition-colors ${
                !isOnline || !isConnected
                  ? 'bg-red-100'
                  : pendingOps > 0
                    ? 'bg-blue-100'
                    : 'bg-green-100'
              }`} aria-label={!isOnline || !isConnected ? 'Offline' : pendingOps > 0 ? 'Syncing' : 'Online'}>
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
            </div>
          </div>
          {showMenu && (
            <div className="lg:hidden absolute top-full left-0 right-0 bg-white shadow-lg border-t border-gray-200">
              <div className="max-w-2xl mx-auto">
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

        <div className={`pt-20 lg:pb-6 ${currentPage === 'list' ? 'pb-32' : 'pb-6'}`}>
          {currentPage === 'account' ? (
            <div className="max-w-2xl mx-auto px-4 flex min-h-[calc(100dvh-5.5rem)] flex-col">
              <div className="space-y-3 shrink-0">
                {householdId && (
                  <button onClick={() => setShowHouseholdInsights(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                    <BarChart3 size={20} />Household Insights
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => setShowAdmin(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                    <Shield size={20} />Invite Household Members
                  </button>
                )}
                <button onClick={handleSignOut} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-red-500 hover:bg-red-50 transition-colors">
                  <LogOut size={20} />Sign Out
                </button>
              </div>
              <div className="mt-auto shrink-0 border-t border-gray-200 pt-10 pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]">
                <button onClick={() => setShowDeleteAccount(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-red-400 hover:bg-red-50 transition-colors text-sm">
                  <Trash2 size={18} />Delete Account
                </button>
              </div>
            </div>
          ) : currentPage === 'list' ? (
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4">
              {/* Toolbar lives in the desktop header (>=lg) and in the mobile bottom nav bar (<lg).
                  See the fixed bottom-bar block at the bottom of this return for the mobile placement. */}
              <div className="space-y-3">
                {organized.map(g => {
                  const search = categorySearches[g.aisleId] || '';
                  const quickAddDropdown = getAisleDropdownItems(g.aisleId);
                  const isExpanded = expandedCategories[g.aisleId];

                  return (
                    <div key={g.aisleId} className={`space-y-2 bg-white border border-gray-200 rounded-2xl overflow-hidden scroll-fade-border ${isScrolling ? 'is-scrolling' : ''}`}>
                      <button
                        onClick={() => toggleCategory(g.aisleId)}
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
                        <h3 className="flex-1 text-left uppercase tracking-wide font-bold text-gray-700 text-base">{g.aisleNameDisplay}</h3>
                      </button>

                      {isExpanded && (
                        <>
                          {quickAddMode && (
                            <div className={`px-4 pb-3 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}>
                              <div className="relative">
                                <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                                <input type="text" value={search} onChange={(e) => setCategorySearches(prev => ({ ...prev, [g.aisleId]: e.target.value }))} placeholder={`Add to ${g.aisleNameDisplay}...`} className="w-full pl-10 pr-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-gray-300 focus:outline-none transition-colors" />
                                {search.trim() && (
                                  <div className="absolute w-full bg-white border-2 border-gray-200 rounded-xl mt-2 shadow-lg z-10 max-h-60 overflow-y-auto">
                                    {quickAddDropdown.map((s, i) => {
                                      const showLibraryRemove = Boolean(
                                        s.catId && s.suggestionId && s.fromVisible === false
                                      );
                                      const rowKey = s.suggestionId && s.catId
                                        ? `${s.catId}-${s.suggestionId}`
                                        : `${i}-${s.name}`;
                                      return (
                                        <div
                                          key={rowKey}
                                          className="flex items-stretch w-full border-b last:border-b-0"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => addFromAisleSearch(g.aisleId, s)}
                                            className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-gray-50 text-sm font-medium"
                                          >
                                            {s.name}
                                          </button>
                                          {showLibraryRemove ? (
                                            <button
                                              type="button"
                                              className="flex-shrink-0 px-3 py-3 text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void taxoRemoveLibraryItem(s.catId, s.suggestionId);
                                              }}
                                              aria-label={`Remove ${s.name} from library`}
                                            >
                                              <X size={18} />
                                            </button>
                                          ) : null}
                                        </div>
                                      );
                                    })}
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
                                  // Row-tap primary action: Shop = toggle done; Add = remove from list.
                                  const handleRowPrimary = quickAddMode
                                    ? () => removeItem(li.id)
                                    : () => toggleDone(li.id);
                                  return (
                                    <div
                                      key={li.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={handleRowPrimary}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowPrimary(); } }}
                                      className={`flex items-center gap-3 py-3 px-4 border-t border-gray-100 break-inside-avoid scroll-fade-border cursor-pointer ${isScrolling ? 'is-scrolling' : ''} ${li.done ? 'opacity-60' : ''}`}
                                    >
                                      {quickAddMode ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); removeItem(li.id); }}
                                          className={`flex-shrink-0 p-2.5 -m-2.5 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                          aria-label={`Remove ${li.name} from list`}
                                        >
                                          <span className="block w-6 h-6 rounded-md border-2 border-gray-200 bg-white flex items-center justify-center text-gray-400">
                                            <X size={16} strokeWidth={2.5} />
                                          </span>
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); toggleDone(li.id); }}
                                          className={`flex-shrink-0 p-2.5 -m-2.5 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                          aria-label={li.done ? `Mark ${li.name} as not done` : `Mark ${li.name} as done`}
                                        >
                                          <span
                                            className={`block w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${li.done ? 'border-transparent' : 'border-gray-300 bg-white'}`}
                                            style={{ backgroundColor: li.done ? '#FF7A7A' : undefined }}
                                          >
                                            {li.done && <Check size={16} className="text-white" strokeWidth={3} />}
                                          </span>
                                        </button>
                                      )}
                                      <span className={`flex-1 text-left font-semibold text-sm ${li.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                        {li.name}
                                        {li.quantity && li.quantity.trim() && (
                                          <span className="ml-1 text-gray-400 font-medium">
                                            {li.quantity}
                                          </span>
                                        )}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); openItemSheet(li); }}
                                        className={`p-2.5 -m-2.5 rounded-full transition-colors text-gray-300 hover:text-gray-500 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                        aria-label={`Open details for ${li.name}`}
                                      >
                                        <ChevronRight size={18} strokeWidth={2} />
                                      </button>
                                    </div>
                                  );
                                } else {
                                  const qi = item.data;
                                  const handleTileAdd = () => addItem(qi.name, qi.catName || g.aisleName, 'quickAdd', qi.id, qi.catId);
                                  return (
                                    <div
                                      key={`qa-${idx}`}
                                      role="button"
                                      tabIndex={0}
                                      onClick={handleTileAdd}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTileAdd(); } }}
                                      className={`w-full flex items-center gap-3 py-3 px-4 transition-colors border-t border-gray-100 break-inside-avoid scroll-fade-border cursor-pointer ${isScrolling ? 'is-scrolling' : ''}`}
                                      style={{ backgroundColor: '#FFF5F5' }}
                                    >
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleTileAdd(); }}
                                        className={`flex-shrink-0 p-2.5 -m-2.5 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                        aria-label={`Add ${qi.name} to list`}
                                      >
                                        <span className="block w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: '#FF7A7A' }}>
                                          <Plus size={16} className="text-white" strokeWidth={2.5} />
                                        </span>
                                      </button>
                                      <span className="flex-1 text-left font-semibold text-sm text-gray-800">
                                        {qi.name}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); openSuggestionSheet(qi.catName || g.aisleName, qi); }}
                                        className={`p-2.5 -m-2.5 rounded-full transition-colors text-gray-300 hover:text-gray-500 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                        aria-label={`Open details for ${qi.name}`}
                                      >
                                        <ChevronRight size={18} strokeWidth={2} />
                                      </button>
                                    </div>
                                  );
                                }
                              })}
                            </div>
                          ) : (
                            <div className="px-4 pb-4"><div className="text-center py-6 text-gray-400 text-sm italic">No items</div></div>
                          )}
                          {/* B1: Dormant shortcuts hint */}
                          {quickAddMode && (() => {
                            const catIds = g.categoryIdSet || new Set();
                            const aisleDormant = dormantShortcutsCache.filter(d => catIds.has(d.categoryId));
                            if (aisleDormant.length === 0) return null;
                            const [showCleanup, setShowCleanup] = [
                              expandedCategories[`cleanup-${g.aisleId}`],
                              (v) => setExpandedCategories(prev => ({ ...prev, [`cleanup-${g.aisleId}`]: v })),
                            ];
                            return (
                              <div className="mx-4 mb-3 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                                <p className="text-xs text-gray-500">
                                  {aisleDormant.length === 1
                                    ? <><span className="font-semibold text-gray-600">{aisleDormant[0].name}</span> hasn't been used in a while and may be cluttering your shortcuts.</>
                                    : <><span className="font-semibold text-gray-600">{aisleDormant.length} shortcuts</span> in this aisle haven't been used in a while.</>}
                                  {' '}
                                  <button
                                    type="button"
                                    onClick={() => setShowCleanup(!showCleanup)}
                                    className="text-xs font-semibold underline underline-offset-2"
                                    style={{ color: '#FF7A7A' }}
                                  >
                                    {showCleanup ? 'Hide' : 'Manage cleanup'}
                                  </button>
                                </p>
                                {showCleanup && (
                                  <div className="mt-3 space-y-1.5">
                                    {aisleDormant.map(d => (
                                      <div key={`${d.categoryId}-${d.suggestionId}`} className="flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3 py-2">
                                        <div className="flex-1 min-w-0">
                                          <span className="text-sm font-medium text-gray-700">{d.name}</span>
                                          <span className="text-xs text-gray-400 ml-1.5">
                                            {d.daysSinceLastUse == null ? 'never used' : `${d.daysSinceLastUse}d ago`}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleDormantDemote(d)}
                                          className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100"
                                        >
                                          Remove
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDormantKeep(d)}
                                          className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50"
                                        >
                                          Keep
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : currentPage === 'history' ? (
            <PurchaseHistory householdId={householdId} aisles={aislesV2} categories={categoriesV2} />
          ) : (
            <SuggestionsEditor
              aisles={aislesV2}
              categories={categoriesV2}
              visibleItems={visibleItemsV2}
              libraryItems={libraryItemsV2}
              onRenameAisle={taxoRenameAisle}
              onAddAisle={taxoAddAisle}
              onDeleteAisle={taxoDeleteAisle}
              onReorderAisles={taxoReorderAisles}
              onRenameCategory={taxoRenameCategory}
              onAddCategory={taxoAddCategory}
              onMoveCategory={taxoMoveCategory}
              onMergeCategory={taxoMergeCategory}
              accordionAisles
            />
          )}
        </div>

        {/* Mobile bottom nav bar — Shop/Add primary toggle + contextual Clear chip.
            Only on the list page (Shop/Add modes don't apply elsewhere). Hidden at lg+ where the desktop header carries these controls. */}
        {currentPage === 'list' && (
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 pt-3 pb-safe pointer-events-none">
            {doneCount > 0 && (
              <div className="flex justify-center mb-2 pointer-events-auto relative">
                {showClearChipTooltip && (
                  <div
                    className="animate-tooltip-in absolute left-1/2 -top-12 -translate-x-1/2 bg-gray-900 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg whitespace-nowrap"
                    aria-hidden="true"
                  >
                    All done with these? Tap to clear.
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                  </div>
                )}
                <button
                  key={`clear-chip-${hasDone}`}
                  onClick={clearDone}
                  className="animate-chip-in flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-xs font-bold shadow-lg active:scale-95 transition-transform"
                  style={{ backgroundColor: '#FF7A7A' }}
                  aria-label={`Clear ${doneCount} done item${doneCount === 1 ? '' : 's'}`}
                >
                  <Check size={14} strokeWidth={2.5} />
                  Clear {doneCount} done
                </button>
              </div>
            )}
            <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-lg p-1.5 flex gap-1 pointer-events-auto">
              <button
                onClick={() => setQuickAddMode(false)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-bold text-sm transition-all ${!quickAddMode ? 'text-white' : 'text-gray-600'}`}
                style={{ backgroundColor: !quickAddMode ? '#FF7A7A' : 'transparent' }}
                aria-pressed={!quickAddMode}
              >
                <ShoppingCart size={18} strokeWidth={2.5} />
                Shop
              </button>
              <button
                onClick={() => setQuickAddMode(true)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-bold text-sm transition-all ${quickAddMode ? 'text-white' : 'text-gray-600'}`}
                style={{ backgroundColor: quickAddMode ? '#FF7A7A' : 'transparent' }}
                aria-pressed={quickAddMode}
              >
                <ClipboardList size={18} strokeWidth={2.5} />
                Add
              </button>
            </div>
          </div>
        )}
      </div>
      {showHouseholdInsights && householdId && (
        <InsightsModal householdId={householdId} onClose={() => setShowHouseholdInsights(false)} />
      )}
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
          aisles={aislesV2}
          categories={categoriesV2}
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
      {/* Floating debug button (admins only). Sits above the mobile bottom bar (currentPage='list') so it doesn't overlap. */}
      {isAdmin && (
        <button
          onClick={() => setShowDebugPanel(true)}
          className={`fixed left-4 lg:bottom-4 ${currentPage === 'list' ? 'bottom-28' : 'bottom-4'} p-3 bg-gray-800 text-white rounded-full shadow-lg hover:bg-gray-700 transition-colors z-40`}
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

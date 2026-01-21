import React, { useState, useEffect, useRef } from 'react';
import { Plus, Check, X, Search, CheckCircle, Loader2, Menu, Trash2, Edit2, LogOut, Shield, Mail, Lock, Copy, ChevronDown, ChevronRight, ShoppingCart, ClipboardList } from 'lucide-react';
import { auth, database, firestore } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { ref, set, get, remove, onValue } from 'firebase/database';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const CATEGORIES = ['VEGGIES', 'FRUIT', 'MEAT & FISH', 'DELI, DAIRY, EGGS', 'FROZEN', 'DRY GOODS', 'BAKING, SPICES & OILS', 'PREPARED FOODS', 'RANCH 99 / WEEE / BERKELEY BOWL', 'PHARMACY / OTC', 'TARGET / AMAZON / COSTCO', 'COSTCO BULK FOODS'];
const generateId = () => Math.random().toString(36).substr(2, 9);

const DEFAULT_ITEMS = {
  'VEGGIES': ['asparagus', 'broccoli', 'carrots', 'green beans', 'onion, yellow'],
  'FRUIT': ['berries', 'bananas', 'grapes'],
  'DELI, DAIRY, EGGS': ['cheese, cheddar', 'eggs', 'milk, 2%'],
  'MEAT & FISH': ['chicken, drumsticks', 'fish, salmon'],
  'FROZEN': ['corn', 'meatballs'],
  'PREPARED FOODS': ['rotisserie chicken', 'tortillas'],
  'BAKING, SPICES & OILS': ['garlic salt', 'oil, olive'],
  'DRY GOODS': ['bread, sandwich', 'pasta'],
  'RANCH 99 / WEEE / BERKELEY BOWL': ['soy sauce', 'white rice'],
  'PHARMACY / OTC': ['vitamin D'],
  'TARGET / AMAZON / COSTCO': ['toilet paper'],
  'COSTCO BULK FOODS': ['butter, salted & unsalted']
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }
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
    try {
      const usersSnapshot = await get(ref(database, 'users'));
      const isFirstUser = !usersSnapshot.exists();

      if (!isFirstUser && !inviteCode) {
        setError('Invitation code required');
        setLoading(false);
        return;
      }

      if (!isFirstUser) {
        const codesSnapshot = await get(ref(database, 'inviteCodes'));
        const codes = codesSnapshot.val() || {};
        const validCode = Object.entries(codes).find(
          ([id, code]) => code.code === inviteCode.toUpperCase() && !code.used
        );

        if (!validCode) {
          setError('Invalid or already used invitation code');
          setLoading(false);
          return;
        }

        await set(ref(database, `inviteCodes/${validCode[0]}/used`), true);
        await set(ref(database, `inviteCodes/${validCode[0]}/usedBy`), email);
        await set(ref(database, `inviteCodes/${validCode[0]}/usedAt`), Date.now());
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await set(ref(database, `users/${user.uid}`), {
        email: user.email,
        createdAt: Date.now(),
        isFirstUser
      });

      if (isFirstUser) {
        await setDoc(doc(firestore, 'admins', user.uid), {
          email: user.email,
          createdAt: Date.now()
        });
      }
    } catch (err) {
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
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors" />
            </div>
          </div>
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Invitation Code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="Enter code (if not first user)"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
              />
            </div>
          )}
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
          {success && <div className="bg-green-50 text-green-600 px-4 py-3 rounded-xl text-sm font-medium border border-green-200">{success}</div>}
          <button onClick={mode === 'signin' ? handleSignIn : handleSignUp} disabled={loading} className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90" style={{ backgroundColor: loading ? undefined : '#FF7A7A' }}>
            {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
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

function AdminPanel({ onClose }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);

  useEffect(() => {
    const codesRef = ref(database, 'inviteCodes');
    const unsubscribe = onValue(codesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const codesArray = Object.entries(data)
          .map(([id, code]) => ({ id, ...code }))
          .filter(c => !c.used && new Date() <= new Date(c.expiresAt));
        setInvitations(codesArray);
      } else {
        setInvitations([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const createInvitation = async () => {
    setCreating(true);
    const code = Math.random().toString(36).substr(2, 8).toUpperCase();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    const codeRef = ref(database, `inviteCodes/${code}`);
    await set(codeRef, {
      code,
      expiresAt: expiresAt.toISOString(),
      used: false,
      createdAt: Date.now()
    });
    setCreating(false);
  };

  const deleteInvitation = async (id) => {
    await remove(ref(database, `inviteCodes/${id}`));
  };

  const copy = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">Admin Panel</h2>
          <p className="text-gray-600 font-medium">Manage invitation codes</p>
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
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [currentPage, setCurrentPage] = useState('list');
  const [showMenu, setShowMenu] = useState(false);
  const [list, setList] = useState([]);
  const [history, setHistory] = useState(new Set());
  const [commonItems, setCommonItems] = useState({});
  const [lessCommonItems, setLessCommonItems] = useState({});
  const [quickAddMode, setQuickAddMode] = useState(false);
  const [categorySearches, setCategorySearches] = useState({});
  const [newItemInputs, setNewItemInputs] = useState({});
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingQty, setEditingQty] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingOps, setPendingOps] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [showHeader, setShowHeader] = useState(true);
  const [showStickyToolbar, setShowStickyToolbar] = useState(false);
  const prevQuickAddMode = useRef(quickAddMode);
  const lastScrollY = useRef(0);
  const toolbarRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        const adminDoc = await getDoc(doc(firestore, 'admins', user.uid));
        setIsAdmin(adminDoc.exists());
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Monitor Firebase connection status
    const connectedRef = ref(database, '.info/connected');
    const unsubConnected = onValue(connectedRef, (snapshot) => {
      setIsConnected(snapshot.val() === true);
    });

    // Monitor browser online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Set initial online status
    setIsOnline(navigator.onLine);

    const listRef = ref(database, 'shopping-list');
    const historyRef = ref(database, 'shopping-history');
    const commonRef = ref(database, 'common-items');
    const lessCommonRef = ref(database, 'less-common-items');

    const unsubList = onValue(listRef, (snapshot) => {
      setList(snapshot.val() || []);
    });

    const unsubHistory = onValue(historyRef, (snapshot) => {
      setHistory(new Set(snapshot.val() || []));
    });

    const unsubCommon = onValue(commonRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Decode Firebase keys back to category names
        const decoded = {};
        Object.keys(data).forEach(encodedKey => {
          const actualCat = decodeCategory(encodedKey);
          decoded[actualCat] = data[encodedKey];
        });
        const first = Object.keys(decoded)[0];
        setCommonItems(first && Array.isArray(decoded[first]) && typeof decoded[first][0] === 'string' ? migrateItems(decoded) : decoded);
      } else {
        setCommonItems(migrateItems(DEFAULT_ITEMS));
      }
    });

    const unsubLessCommon = onValue(lessCommonRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Decode Firebase keys back to category names
        const decoded = {};
        Object.keys(data).forEach(encodedKey => {
          const actualCat = decodeCategory(encodedKey);
          decoded[actualCat] = data[encodedKey];
        });
        const first = Object.keys(decoded)[0];
        setLessCommonItems(first && Array.isArray(decoded[first]) && typeof decoded[first][0] === 'string' ? migrateItems(decoded) : decoded);
      } else {
        setLessCommonItems({});
      }
    });

    setLoading(false);

    return () => {
      unsubConnected();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubList();
      unsubHistory();
      unsubCommon();
      unsubLessCommon();
    };
  }, [user]);

  const save = async (key, value) => {
    setPendingOps(p => p + 1);
    await set(ref(database, key), value);
    setPendingOps(p => p - 1);
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

  const addItem = (name, category) => {
    const newList = [...list, { id: Date.now(), name, category, quantity: '1', done: false }];
    save('shopping-list', newList);
    const newHistory = new Set(history);
    newHistory.add(name.toLowerCase());
    save('shopping-history', [...newHistory]);
  };

  const toggleDone = (id) => {
    const newList = list.map(item => item.id === id ? { ...item, done: !item.done } : item);
    save('shopping-list', newList);
  };

  const updateQuantity = (id, qty) => {
    const newList = list.map(item => item.id === id ? { ...item, quantity: qty } : item);
    save('shopping-list', newList);
  };

  const clearDone = () => {
    const newList = list.filter(item => !item.done);
    save('shopping-list', newList);
  };

  const removeItem = (id) => {
    const newList = list.filter(item => item.id !== id);
    save('shopping-list', newList);
  };

  const toggleQuickAdd = (cat, itemId) => {
    const commonCat = commonItems[cat] || [];
    const lessCat = lessCommonItems[cat] || [];
    const inCommon = commonCat.find(i => i.id === itemId);
    if (inCommon) {
      const newC = { ...commonItems, [cat]: commonCat.filter(i => i.id !== itemId) };
      const newL = { ...lessCommonItems, [cat]: [...lessCat, inCommon].sort((a, b) => a.name.localeCompare(b.name)) };
      saveCommonItems(newC);
      saveLessCommonItems(newL);
    } else {
      const inLess = lessCat.find(i => i.id === itemId);
      const newL = { ...lessCommonItems, [cat]: lessCat.filter(i => i.id !== itemId) };
      const newC = { ...commonItems, [cat]: [...commonCat, inLess].sort((a, b) => a.name.localeCompare(b.name)) };
      saveCommonItems(newC);
      saveLessCommonItems(newL);
    }
  };

  const deleteSuggestion = (cat, itemId) => {
    const commonCat = commonItems[cat] || [];
    const lessCat = lessCommonItems[cat] || [];
    if (commonCat.find(i => i.id === itemId)) {
      const newC = { ...commonItems, [cat]: commonCat.filter(i => i.id !== itemId) };
      saveCommonItems(newC);
    } else {
      const newL = { ...lessCommonItems, [cat]: lessCat.filter(i => i.id !== itemId) };
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
      saveCommonItems(newC);
    } else {
      const newL = { ...lessCommonItems, [cat]: lessCat.map(i => i.id === itemId ? { ...i, name: editingItemName } : i).sort((a, b) => a.name.localeCompare(b.name)) };
      saveLessCommonItems(newL);
    }
    setEditingItemId(null);
    setEditingItemName('');
  };

  const addNewSuggestion = (cat) => {
    const name = newItemInputs[cat]?.trim();
    if (!name) return;
    const newC = { ...commonItems, [cat]: [...(commonItems[cat] || []), { id: generateId(), name }].sort((a, b) => a.name.localeCompare(b.name)) };
    saveCommonItems(newC);
    setNewItemInputs(prev => ({ ...prev, [cat]: '' }));
  };

  const finishEditQty = () => {
    if (editingId && editingQty.trim()) updateQuantity(editingId, editingQty);
    setEditingId(null);
    setEditingQty('');
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

  const addFromSearch = (cat, name) => {
    addItem(name, cat);
    setCategorySearches(prev => ({ ...prev, [cat]: '' }));
  };

  const organized = CATEGORIES.map(cat => {
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
    CATEGORIES.forEach(cat => {
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

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentPage]);

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleSignOut = async () => {
    try {
      await firebaseSignOut(auth);
      setShowMenu(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
  if (!user) return <Login onLoginSuccess={() => {}} />;
  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        
        * {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
      `}</style>
      <div className="min-h-screen" style={{ backgroundColor: '#F7F7F7' }}>
        <div className={`fixed top-0 left-0 right-0 bg-white shadow-sm z-50 transition-transform duration-300 ${showHeader ? 'translate-y-0' : '-translate-y-full'}`}>
          <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              {currentPage === 'list' && <div className="flex-1 font-bold text-xl" style={{ color: '#FF6B6B' }}>Shopping List</div>}
              {currentPage === 'edit' && <div className="flex-1 font-bold text-xl text-gray-800">Edit Suggestions</div>}
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
                <button onClick={() => { setCurrentPage('edit'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 ${currentPage === 'edit' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'edit' ? '#FF7A7A' : '#374151' }}>Edit Suggestions</button>
                {isAdmin && <button onClick={() => { setShowAdmin(true); setShowMenu(false); }} className="w-full text-left px-6 py-4 border-b border-gray-100 flex items-center gap-2 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"><Shield size={20} />Admin Panel</button>}
                <button onClick={handleSignOut} className="w-full text-left px-6 py-4 text-red-500 font-semibold flex items-center gap-2 hover:bg-red-50 transition-colors"><LogOut size={20} />Sign Out</button>
              </div>
            </div>
          )}
        </div>

        {(!isOnline || !isConnected) && (
          <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-medium">
            ⚠️ You're offline. Changes will sync when connection is restored.
          </div>
        )}

        <div className="pt-20 pb-6">
          {currentPage === 'list' ? (
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4">
              {/* Sticky toolbar when scrolling */}
              {showStickyToolbar && (
                <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40 transition-transform duration-300" style={{ transform: showHeader ? 'translateY(72px)' : 'translateY(0)' }}>
                  <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3">
                    <div className="flex items-stretch gap-3">
                      <div className="bg-white rounded-2xl p-1.5 border-2 border-gray-200 flex-1">
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
                      <div className={`rounded-2xl p-1.5 border-2 transition-colors ${list.filter(i => i.done).length === 0 ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'}`}>
                        <button onClick={clearDone} disabled={list.filter(i => i.done).length === 0} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all h-full ${list.filter(i => i.done).length === 0 ? 'text-gray-400' : 'text-white'}`} style={{ backgroundColor: list.filter(i => i.done).length === 0 ? 'transparent' : '#FF7A7A' }}>
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
                <div className="bg-white rounded-2xl p-1.5 border-2 border-gray-200 flex-1">
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
                <div className={`rounded-2xl p-1.5 border-2 transition-colors ${list.filter(i => i.done).length === 0 ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'}`}>
                  <button onClick={clearDone} disabled={list.filter(i => i.done).length === 0} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all h-full ${list.filter(i => i.done).length === 0 ? 'text-gray-400' : 'text-white'}`} style={{ backgroundColor: list.filter(i => i.done).length === 0 ? 'transparent' : '#FF7A7A' }}>
                    <Check size={18} strokeWidth={2.5} />
                    <span>Clear</span>
                  </button>
                </div>
              </div>
              <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3 lg:gap-6">
                {organized.map(g => {
                  const search = categorySearches[g.category] || '';
                  const sugg = getSuggestions(g.category);
                  const uncheckedCount = list.filter(i => i.category === g.category && !i.done).length;
                  const isExpanded = expandedCategories[g.category];

                  return (
                    <div key={g.category} className="space-y-2 bg-white border border-gray-200 rounded-2xl overflow-hidden">
                      <button
                        onClick={() => toggleCategory(g.category)}
                        className={`w-full py-4 px-4 flex items-center gap-3 transition-colors ${
                          quickAddMode
                            ? "bg-gray-100 hover:bg-gray-200"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        {isExpanded ? (
                          <ChevronDown size={20} className={quickAddMode ? "text-gray-600" : "text-gray-400"} />
                        ) : (
                          <ChevronRight size={20} className={quickAddMode ? "text-gray-600" : "text-gray-400"} />
                        )}
                        <h3 className={`flex-1 text-left uppercase tracking-wide ${
                          quickAddMode
                            ? "font-bold text-gray-700 text-base"
                            : "font-semibold text-gray-500 text-sm"
                        }`}>{g.category}</h3>
                        {uncheckedCount > 0 && (
                          <span className="bg-gray-200 text-gray-700 text-xs font-bold px-2.5 py-1 rounded-full min-w-[24px] text-center">
                            {uncheckedCount}
                          </span>
                        )}
                      </button>
                      
                      {isExpanded && (
                        <>
                          {quickAddMode && (
                            <div className="px-4 pb-3">
                              <div className="relative">
                                <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                                <input type="text" value={search} onChange={(e) => setCategorySearches(prev => ({ ...prev, [g.category]: e.target.value }))} placeholder={`Add to ${g.category}...`} className="w-full pl-10 pr-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-gray-300 focus:outline-none transition-colors" />
                                {search && (
                                  <div className="absolute w-full bg-white border-2 border-gray-200 rounded-xl mt-2 shadow-lg z-10 max-h-60 overflow-y-auto">
                                    {sugg.length > 0 ? sugg.map((s, i) => <button key={i} onClick={() => addFromSearch(g.category, s)} className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0 text-sm font-medium">{s}</button>) : (
                                      <button onClick={() => addFromSearch(g.category, search)} className="w-full text-left px-4 py-3 hover:bg-gray-50 text-sm flex items-center gap-2 font-medium"><Plus size={18} style={{ color: '#FF7A7A' }} /><span>Add "<span className="font-semibold">{search}</span>"</span></button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {g.items.length > 0 ? (
                            <div className="pb-3">
                              {g.items.map((item, idx) => {
                                if (item.type === 'list') {
                                  const li = item.data;
                                  return (
                                    <div key={li.id} className="flex items-center gap-3 py-3 px-4 border-t border-gray-100">
                                      <button onClick={() => toggleDone(li.id)} className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${li.done ? 'border-transparent' : 'border-gray-300 bg-white'}`} style={{ backgroundColor: li.done ? '#FF7A7A' : undefined }}>
                                        {li.done && <Check size={16} className="text-white" strokeWidth={3} />}
                                      </button>
                                      <span className={`flex-1 font-medium text-sm ${li.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{li.name}</span>
                                      {editingId === li.id ? (
                                        <input type="text" value={editingQty} onChange={(e) => setEditingQty(e.target.value)} onBlur={finishEditQty} onKeyPress={(e) => e.key === 'Enter' && finishEditQty()} className="min-w-[60px] max-w-[120px] px-3 py-1.5 border-2 border-gray-300 rounded-lg text-right font-medium text-sm focus:outline-none focus:border-gray-400 transition-colors" autoFocus />
                                      ) : (
                                        <button onClick={() => { setEditingId(li.id); setEditingQty(li.quantity); }} className={`px-2 py-1 rounded-md font-medium text-sm transition-colors ${li.done ? 'text-gray-400 bg-transparent' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'} ${li.quantity.length <= 2 ? 'min-w-[32px] text-center' : 'min-w-[48px] text-right'}`}>
                                          {li.quantity}
                                        </button>
                                      )}
                                      <button onClick={() => removeItem(li.id)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={20} /></button>
                                    </div>
                                  );
                                } else {
                                  const qi = item.data;
                                  return (
                                    <button key={`qa-${idx}`} onClick={() => addItem(qi.name, g.category)} className="w-full flex items-center gap-3 py-3 px-4 hover:bg-gray-50 transition-colors border-t border-gray-100">
                                      <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: '#FF7A7A' }}><Plus size={16} className="text-white" strokeWidth={2.5} /></div>
                                      <span className="flex-1 text-left font-semibold text-sm" style={{ color: '#FF7A7A' }}>{qi.name}</span>
                                    </button>
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
          ) : (
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4">
              <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3 lg:gap-6">
                {CATEGORIES.map(cat => {
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
                        <div className="px-4 pb-4 space-y-2">
                          {all.map(i => (
                            <div key={i.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
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
      {showAdmin && isAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </>
  );
}

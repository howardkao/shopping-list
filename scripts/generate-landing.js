import { readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs';

// --- 1. Rename dist/index.html → dist/app.html ---
renameSync('dist/index.html', 'dist/app.html');
// Capacitor loads webDir/index.html; keep a copy so `npx cap sync` works after this script runs.
copyFileSync('dist/app.html', 'dist/index.html');

// --- 2. Patch sw.js precache manifest: index.html → app.html ---
let sw = readFileSync('dist/sw.js', 'utf8');
sw = sw.replace(/{url:"index\.html"(,revision:[^}]+)?}/g, (match) =>
  match.replace('index.html', 'app.html')
);
writeFileSync('dist/sw.js', sw);

// --- 3. Build dist/landing.html with Firebase auth-redirect injected ---
const env = {};
try {
  const lines = readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

const config = {
  apiKey:            env.VITE_FIREBASE_API_KEY            || '',
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN        || '',
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL       || '',
  projectId:         env.VITE_FIREBASE_PROJECT_ID         || '',
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET     || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId:             env.VITE_FIREBASE_APP_ID             || '',
};

const authRedirectScript = `  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
    import { getAuth, getRedirectResult, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
    const app = initializeApp(${JSON.stringify(config)});
    const auth = getAuth(app);
    try {
      await getRedirectResult(auth);
    } catch (e) { /* ignore */ }
    onAuthStateChanged(auth, user => { if (user) window.location.replace('/app'); });
  </script>`;

let html = readFileSync('landing.html', 'utf8');
html = html.replace('</head>', authRedirectScript + '\n</head>');
writeFileSync('dist/landing.html', html);

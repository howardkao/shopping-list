/**
 * Capacitor's webDir must contain `index.html` as the entry document.
 * For Firebase Hosting, `dist/index.html` must NOT exist: static files win over
 * rewrites, so `/` would load the SPA instead of `landing.html`.
 *
 * Usage: `node scripts/capacitor-web-index.js copy` before `npx cap sync`,
 *        `node scripts/capacitor-web-index.js clean` after (optional).
 */
import { copyFileSync, existsSync, unlinkSync } from 'fs';

const cmd = process.argv[2];
if (cmd === 'copy') {
  copyFileSync('dist/app.html', 'dist/index.html');
} else if (cmd === 'clean') {
  if (existsSync('dist/index.html')) unlinkSync('dist/index.html');
} else {
  console.error('Usage: node scripts/capacitor-web-index.js <copy|clean>');
  process.exit(1);
}

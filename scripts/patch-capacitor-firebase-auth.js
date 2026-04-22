import { readFileSync, writeFileSync } from 'fs';

const pluginPath =
  'node_modules/@capacitor-firebase/authentication/android/src/main/java/io/capawesome/capacitorjs/plugins/firebase/authentication/FirebaseAuthenticationPlugin.java';

const original = readFileSync(pluginPath, 'utf8');
const target = "        String[] providers = getConfig().getArray(\"providers\", config.getProviders());\n        config.setProviders(providers);\n";
const replacement =
  "        String authDomain = getConfig().getString(\"authDomain\", config.getAuthDomain());\n        config.setAuthDomain(authDomain);\n        String[] providers = getConfig().getArray(\"providers\", config.getProviders());\n        config.setProviders(providers);\n";

if (original.includes('getConfig().getString("authDomain"')) {
  process.exit(0);
}

if (!original.includes(target)) {
  console.error('Unable to patch Capacitor Firebase Authentication Android plugin: expected code block not found.');
  process.exit(1);
}

writeFileSync(pluginPath, original.replace(target, replacement));
console.info('Patched Capacitor Firebase Authentication Android plugin to load authDomain from capacitor config.');

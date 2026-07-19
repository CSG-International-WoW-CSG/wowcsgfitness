import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const www = join(root, 'www');

const files = [
  'index.html',
  'admin.html',
  'script.js',
  'native-bridge.js',
  'styles.css',
  'ui-refresh.css',
  'firebase-config.js',
  'service-worker.js',
  'manifest.json',
  'favicon.svg',
  'brand-mark.svg',
  'CSG_Logo_K_outline.jpg',
  'challenge-flyer.png'
];

if (existsSync(www)) {
  rmSync(www, { recursive: true, force: true });
}
mkdirSync(www, { recursive: true });

for (const file of files) {
  const src = join(root, file);
  if (!existsSync(src)) {
    console.warn('skip missing:', file);
    continue;
  }
  cpSync(src, join(www, file));
}

const indexPath = join(www, 'index.html');
let html = readFileSync(indexPath, 'utf8');

// Ensure native bridge loads before app logic (Capacitor injects its runtime separately)
if (!html.includes('src="native-bridge.js"')) {
  html = html.replace(
    /<script src="script\.js[^"]*"><\/script>/,
    '<script src="native-bridge.js"></script>\n    <script src="script.js?v=33"></script>'
  );
} else {
  html = html.replace(/script\.js(\?v=\d+)?/, 'script.js?v=33');
}

writeFileSync(indexPath, html, 'utf8');
console.log('www/ ready for Capacitor sync');

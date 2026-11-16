// Lager public/demo/manifest.json ved å lese alle filene i public/demo (inkl. undermapper).
// Kjør:  node scripts/lag-demo-manifest.mjs
// Med  --drive  hentes filer som ikke ligger i public/demo (f.eks. et stort ortofoto) fra Google Disk-demomappen i tillegg.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/demo/', import.meta.url));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.toLowerCase() !== 'manifest.json' && name !== 'LES-MEG.txt' && !name.startsWith('.')) files.push(relative(root, full).split(sep).join('/'));
  }
};
walk(root);
files.sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }));
const alsoFromDrive = process.argv.includes('--drive');
writeFileSync(join(root, 'manifest.json'), JSON.stringify(alsoFromDrive ? { alsoFromDrive: true, files } : { files }, null, 2));
console.log(`Skrev manifest.json med ${files.length} filer${alsoFromDrive ? ' (+ manglende filer fra Google Disk)' : ''}.`);

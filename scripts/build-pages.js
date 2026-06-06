import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cityCatalog } from '../server/hotel-data.js';

const root = new URL('..', import.meta.url);
const publicDir = new URL('public/', root);
const docsDir = new URL('docs/', root);

const staticData = `window.HOTEL_STATIC_DATA = ${JSON.stringify({ cities: cityCatalog }, null, 2)};\nwindow.HOTEL_STATIC_MODE = false;\n`;
const pagesStaticData = `window.HOTEL_STATIC_DATA = ${JSON.stringify({ cities: cityCatalog }, null, 2)};\nwindow.HOTEL_STATIC_MODE = true;\n`;

await writeFile(new URL('static-data.js', publicDir), staticData, 'utf8');
await rm(docsDir, { recursive: true, force: true });
await mkdir(docsDir, { recursive: true });

const publicFiles = await readdir(publicDir);
for (const filename of publicFiles) {
  const source = new URL(filename, publicDir);
  const target = new URL(filename, docsDir);
  await writeFile(target, await readFile(source));
}

await writeFile(new URL('.nojekyll', docsDir), '', 'utf8');
await writeFile(new URL('static-data.js', docsDir), pagesStaticData, 'utf8');
console.log(`Built GitHub Pages site in ${join(root.pathname, 'docs')}`);

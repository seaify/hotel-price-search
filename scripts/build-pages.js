import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cityCatalog } from '../server/hotel-data.js';
import { auditInventoryCoverage } from './audit-inventory-coverage.js';
import { buildInventoryManifest } from './build-inventory-manifest.js';

const defaultRootDir = fileURLToPath(new URL('..', import.meta.url));
const inventoryExtensions = new Set(['.csv', '.json', '.jsonl', '.ndjson']);

export async function buildPages(options = {}) {
  const rootDir = resolve(options.rootDir || defaultRootDir);
  const publicDir = resolve(rootDir, options.publicDir || 'public');
  const docsDir = resolve(rootDir, options.docsDir || 'docs');
  const inventory = await preparePagesInventory(rootDir, options);

  const staticData = `window.HOTEL_STATIC_DATA = ${JSON.stringify({ cities: cityCatalog }, null, 2)};\nwindow.HOTEL_STATIC_MODE = false;\n`;
  const pagesStaticData = `window.HOTEL_STATIC_DATA = ${JSON.stringify({ cities: cityCatalog }, null, 2)};\nwindow.HOTEL_STATIC_MODE = true;\n`;

  await mkdir(publicDir, { recursive: true });
  await writeFile(resolve(publicDir, 'static-data.js'), staticData, 'utf8');
  await rm(docsDir, { recursive: true, force: true });
  await copyPublicDirectory(publicDir, docsDir);
  await writeFile(resolve(docsDir, '.nojekyll'), '', 'utf8');
  await writeFile(resolve(docsDir, 'static-data.js'), pagesStaticData, 'utf8');

  return { rootDir, publicDir, docsDir, inventory };
}

async function preparePagesInventory(rootDir, options) {
  const publicDir = options.publicDir || 'public';
  const inventoryDir = resolve(rootDir, options.inventoryDir || `${publicDir}/inventory`);
  const hasInventoryShards = await hasInventoryShardFiles(inventoryDir);
  const requireFullCoverage = options.requireFullInventoryCoverage
    ?? isTruthy(process.env.HOTEL_PAGES_REQUIRE_FULL_INVENTORY_COVERAGE);
  const auditInventory = options.auditInventory
    ?? isTruthy(process.env.HOTEL_PAGES_AUDIT_INVENTORY);
  const manifestPath = options.manifestPath || `${publicDir}/hotel-inventory.manifest.json`;
  let manifest = null;
  let coverage = null;

  if (hasInventoryShards) {
    manifest = await buildInventoryManifest({
      rootDir,
      inputDir: inventoryDir,
      outputPath: manifestPath,
      publicDir: options.publicDir || 'public',
      baseUrl: options.inventoryBaseUrl || process.env.HOTEL_PAGES_INVENTORY_BASE_URL || ''
    });
  }

  if (hasInventoryShards || requireFullCoverage || auditInventory) {
    coverage = await auditInventoryCoverage({ rootDir, manifestPath });
    if (requireFullCoverage && !coverage.passed) {
      throw new Error(formatCoverageFailure(coverage));
    }
  }

  return {
    generatedManifest: hasInventoryShards,
    sourceCount: manifest?.sources?.length ?? coverage?.sourceCount ?? 0,
    coverage
  };
}

async function copyPublicDirectory(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyPublicDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, await readFile(sourcePath));
    }
  }
}

async function hasInventoryShardFiles(inputDir) {
  let entries;
  try {
    entries = await readdir(inputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = resolve(inputDir, entry.name);
    if (entry.isDirectory() && await hasInventoryShardFiles(entryPath)) return true;
    if (entry.isFile() && inventoryExtensions.has(extname(entry.name).toLowerCase())) return true;
  }
  return false;
}

function formatCoverageFailure(coverage) {
  const missing = coverage.missingCities
    .slice(0, 8)
    .map((item) => `${item.province}/${item.city}`)
    .join(', ');
  const unscoped = coverage.unscopedSources.map((source) => source.name).join(', ');
  const unknown = coverage.unknownDestinations.join(', ');
  return [
    `Inventory coverage audit failed: ${coverage.coveredCities}/${coverage.totalCities} cities covered.`,
    missing ? `Missing: ${missing}${coverage.missingCities.length > 8 ? ` ... +${coverage.missingCities.length - 8}` : ''}` : '',
    unscoped ? `Unscoped sources: ${unscoped}` : '',
    unknown ? `Unknown destinations: ${unknown}` : ''
  ].filter(Boolean).join(' ');
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const result = await buildPages();
    if (result.inventory.generatedManifest) {
      console.log(`Generated inventory manifest with ${result.inventory.sourceCount} sources.`);
    }
    if (result.inventory.coverage) {
      const coverage = result.inventory.coverage;
      console.log(`Inventory coverage: ${coverage.coveredCities}/${coverage.totalCities} cities, ${coverage.hotelCount || 0} hotels.`);
    }
    console.log(`Built GitHub Pages site in ${result.docsDir}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

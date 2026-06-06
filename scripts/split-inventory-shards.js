import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildInventoryManifest, normalizeInventoryLocation, parseInventory, pick, sortChinese } from './build-inventory-manifest.js';

const defaultOutputDir = 'public/inventory';
const defaultManifestPath = 'public/hotel-inventory.manifest.json';

export async function splitInventoryShards(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const inputFiles = normalizeInputFiles(options.inputFiles || options.inputFile || []);
  if (!inputFiles.length) throw new Error('At least one input inventory file is required.');

  const outputDir = resolve(rootDir, options.outputDir || defaultOutputDir);
  if (options.clean) await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const shards = new Map();
  const skippedRows = [];
  let rowCount = 0;

  for (const inputFile of inputFiles) {
    const inputPath = resolve(rootDir, inputFile);
    const rows = parseInventory(await readFile(inputPath, 'utf8'), extname(inputPath).toLowerCase());
    rows.forEach((row, index) => {
      rowCount += 1;
      const location = normalizeInventoryLocation(pick(row, 'city'), pick(row, 'province'));
      if (!location.city || !location.province) {
        skippedRows.push({ inputFile, rowNumber: index + 1, reason: 'missing city or province' });
        return;
      }
      const key = `${location.province}|${location.city}`;
      const shard = shards.get(key) || {
        province: location.province,
        city: location.city,
        rows: []
      };
      shard.rows.push(row);
      shards.set(key, shard);
    });
  }

  const writtenShards = [];
  for (const shard of sortShards([...shards.values()])) {
    const shardPath = resolve(outputDir, getShardFilename(shard));
    await mkdir(dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${shard.rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    writtenShards.push({
      province: shard.province,
      city: shard.city,
      rowCount: shard.rows.length,
      path: shardPath
    });
  }

  let manifest = null;
  if (options.buildManifest !== false) {
    manifest = await buildInventoryManifest({
      rootDir,
      inputDir: options.outputDir || defaultOutputDir,
      outputPath: options.manifestPath || defaultManifestPath,
      baseUrl: options.baseUrl || ''
    });
  }

  return {
    inputFiles,
    rowCount,
    shardCount: writtenShards.length,
    skippedRowCount: skippedRows.length,
    skippedRows,
    shards: writtenShards,
    manifest
  };
}

function normalizeInputFiles(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || '').split(/[,\n;]/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function sortShards(shards) {
  return shards.sort((a, b) =>
    a.province.localeCompare(b.province, 'zh-CN') || a.city.localeCompare(b.city, 'zh-CN')
  );
}

function getShardFilename(shard) {
  return `${slugDestination(shard.province)}/${slugDestination(shard.city)}.jsonl`;
}

function slugDestination(value) {
  return encodeURIComponent(String(value || '').trim())
    .replace(/%/g, '')
    .toLowerCase() || 'unknown';
}

function parseArgs(argv) {
  const options = { inputFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.inputFiles.push(argv[++index]);
    else if (arg === '--output') options.outputDir = argv[++index];
    else if (arg === '--manifest') options.manifestPath = argv[++index];
    else if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--clean') options.clean = true;
    else if (arg === '--no-manifest') options.buildManifest = false;
    else if (arg === '--help') options.help = true;
    else options.inputFiles.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/split-inventory-shards.js --input <file> [options]

Options:
  --input <file>      Supplier inventory file. Can be repeated or comma-separated
  --output <dir>      Output shard directory. Default: public/inventory
  --manifest <file>   Manifest file. Default: public/hotel-inventory.manifest.json
  --base-url <url>    Optional absolute URL prefix for generated manifest source URLs
  --clean             Remove the output directory before writing shards
  --no-manifest       Only write shards, do not rebuild the manifest
`);
}

function formatSummary(result) {
  const lines = [
    `Split ${result.rowCount} rows into ${result.shardCount} city shards.`,
    `Skipped rows: ${result.skippedRowCount}`
  ];
  if (result.manifest) {
    lines.push(`Manifest sources: ${result.manifest.sources.length}`);
    lines.push(`Cities in manifest: ${sortChinese([...new Set(result.manifest.sources.flatMap((source) => source.cities || []))]).length}`);
  }
  return lines.join('\n');
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await splitInventoryShards(options);
      console.log(formatSummary(result));
      if (result.skippedRowCount) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

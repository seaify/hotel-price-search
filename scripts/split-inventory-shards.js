import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildInventoryManifest, normalizeInventoryLocation, parseInventory, pick, sortChinese } from './build-inventory-manifest.js';
import { parseXlsxInventory } from './xlsx-inventory.js';
import { extractZipEntries, isZipBuffer } from './zip-archive.js';

const defaultOutputDir = 'public/inventory';
const defaultManifestPath = 'public/hotel-inventory.manifest.json';
const supportedInventoryExtensions = new Set(['.csv', '.json', '.jsonl', '.ndjson', '.xlsx']);

export async function splitInventoryShards(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const inputFiles = normalizeInputFiles(options.inputFiles || options.inputFile || []);

  const outputDir = resolve(rootDir, options.outputDir || defaultOutputDir);
  if (options.clean) await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const fieldMap = await loadFieldMap(options.fieldMap || options.fields || {}, rootDir);
  const requestHeaders = await loadRequestHeaders(options.headers || options.requestHeaders || {}, rootDir);
  const inventorySources = await loadInventorySources({
    inputFiles,
    sourceManifest: options.sourceManifest || options.sourceManifestUrl || options.sourceManifestConfig
  }, rootDir, { fieldMap, requestHeaders });
  if (!inventorySources.length) throw new Error('At least one input inventory file or source manifest is required.');
  const shards = new Map();
  const skippedRows = [];
  let rowCount = 0;

  for (const source of inventorySources) {
    const inputs = await loadInventoryInputs(source.inputFile, rootDir, source.requestHeaders);
    for (const input of inputs) {
      const rows = getInventoryRows(input).map((row) => mapInventoryRow(row, source.fieldMap));
      rows.forEach((row, index) => {
        rowCount += 1;
        const location = normalizeInventoryLocation(pick(row, 'city'), pick(row, 'province'));
        if (!location.city || !location.province) {
          skippedRows.push({ inputFile: input.name || source.inputFile, sourceName: source.name, rowNumber: index + 1, reason: 'missing city or province' });
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
    inputFiles: inventorySources.map((source) => source.inputFile),
    fieldMap,
    requestHeaders: maskHeaders(requestHeaders),
    rowCount,
    shardCount: writtenShards.length,
    skippedRowCount: skippedRows.length,
    skippedRows,
    shards: writtenShards,
    manifest
  };
}

async function loadInventorySources(options, rootDir, defaults = {}) {
  const directSources = options.inputFiles.map((inputFile, index) => ({
    inputFile,
    name: `supplier-${index + 1}`,
    fieldMap: defaults.fieldMap || {},
    requestHeaders: defaults.requestHeaders || {}
  }));
  const manifestSources = await loadSourceManifestSources(options.sourceManifest, rootDir, defaults);
  return [...directSources, ...manifestSources];
}

async function loadSourceManifestSources(value, rootDir, defaults = {}) {
  if (!value) return [];
  const manifests = Array.isArray(value) ? value : [value];
  const sources = [];
  for (const manifest of manifests) {
    const loaded = await loadSourceManifest(manifest, rootDir, defaults.requestHeaders || {});
    for (let index = 0; index < loaded.sources.length; index += 1) {
      const source = normalizeManifestSource(loaded.sources[index], index, loaded.base, rootDir, defaults);
      if (source) {
        source.fieldMap = await loadFieldMap(source.fieldMap, rootDir);
        sources.push(source);
      }
    }
  }
  return sources;
}

async function loadSourceManifest(value, rootDir, requestHeaders = {}) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { sources: [], base: { type: 'local', dir: rootDir } };
    if (text.startsWith('{') || text.startsWith('[')) {
      return { sources: parseSourceManifestJson(text), base: { type: 'local', dir: rootDir } };
    }
    if (isRemoteInventoryInput(text)) {
      const response = await fetch(text, { headers: requestHeaders });
      if (!response.ok) throw new Error(`Failed to fetch supplier source manifest URL ${text}: HTTP ${response.status}`);
      return { sources: parseSourceManifestJson(await response.text()), base: { type: 'remote', url: text } };
    }
    const manifestPath = resolve(rootDir, text);
    return {
      sources: parseSourceManifestJson(await readFile(manifestPath, 'utf8')),
      base: { type: 'local', dir: dirname(manifestPath) }
    };
  }
  return { sources: parseSourceManifestObject(value), base: { type: 'local', dir: rootDir } };
}

function parseSourceManifestJson(value) {
  return parseSourceManifestObject(JSON.parse(value));
}

function parseSourceManifestObject(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.sources)) return value.sources;
  if (Array.isArray(value.feeds)) return value.feeds;
  if (Array.isArray(value.inventorySources)) return value.inventorySources;
  return [value];
}

function normalizeManifestSource(source, index, base, rootDir, defaults = {}) {
  if (!source || typeof source !== 'object') return null;
  const rawInput = source.url || source.href || source.input || source.file || source.path;
  if (!rawInput) return null;
  const inputFile = normalizeManifestSourceInput(rawInput, base, rootDir);
  const fieldMap = source.fieldMap || source.fields || defaults.fieldMap || {};
  const requestHeaders = {
    ...(defaults.requestHeaders || {}),
    ...loadRequestHeadersSync(source.headers || source.requestHeaders || {})
  };
  return {
    inputFile,
    name: String(source.name || source.provider || source.supplier || `source-${index + 1}`),
    fieldMap,
    requestHeaders
  };
}

function normalizeManifestSourceInput(value, base, rootDir) {
  const input = String(value || '').trim();
  if (isRemoteInventoryInput(input)) return input;
  if (base?.type === 'remote') return new URL(input, base.url).href;
  return resolve(base?.dir || rootDir, input);
}

function loadRequestHeadersSync(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || !text.startsWith('{')) return {};
    return loadRequestHeadersSync(JSON.parse(text));
  }
  if (Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value)
    .map(([name, headerValue]) => [String(name).trim(), String(headerValue ?? '').trim()])
    .filter(([name, headerValue]) => name && headerValue));
}

async function loadRequestHeaders(value, rootDir) {
  if (!value) return {};
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return {};
    const content = text.startsWith('{')
      ? text
      : await readFile(resolve(rootDir, text), 'utf8');
    return loadRequestHeaders(JSON.parse(content), rootDir);
  }
  if (Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value)
    .map(([name, headerValue]) => [String(name).trim(), String(headerValue ?? '').trim()])
    .filter(([name, headerValue]) => name && headerValue));
}

function maskHeaders(headers = {}) {
  return Object.fromEntries(Object.keys(headers).map((name) => [name, '***']));
}

async function loadFieldMap(value, rootDir) {
  if (!value) return {};
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return {};
    const content = text.startsWith('{')
      ? text
      : await readFile(resolve(rootDir, text), 'utf8');
    return loadFieldMap(JSON.parse(content), rootDir);
  }
  if (Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, sourcePath]) =>
    typeof sourcePath === 'string' ||
    (Array.isArray(sourcePath) && sourcePath.every((item) => typeof item === 'string'))
  ));
}

function mapInventoryRow(row, fieldMap = {}) {
  if (!fieldMap || !Object.keys(fieldMap).length) return row;
  const mapped = { ...row };
  Object.entries(fieldMap).forEach(([targetField, sourcePath]) => {
    const value = getMappedValue(row, sourcePath);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      mapped[targetField] = value;
    }
  });
  return mapped;
}

function getMappedValue(row, sourcePath) {
  const paths = Array.isArray(sourcePath) ? sourcePath : [sourcePath];
  for (const path of paths) {
    const value = getPathValue(row, path);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

function getPathValue(value, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, value);
}

function getInventoryRows(input) {
  return Array.isArray(input.rows) ? input.rows : parseInventory(input.content, input.extension);
}

async function loadInventoryInputs(inputFile, rootDir, requestHeaders = {}) {
  if (isRemoteInventoryInput(inputFile)) {
    const response = await fetch(inputFile, { headers: requestHeaders });
    if (!response.ok) throw new Error(`Failed to fetch supplier inventory URL ${inputFile}: HTTP ${response.status}`);
    const format = getInputFormat(inputFile, response.headers.get('content-type') || '');
    const buffer = Buffer.from(await response.arrayBuffer());
    return decodeInventoryInputs(buffer, format, inputFile);
  }
  const inputPath = resolve(rootDir, inputFile);
  const format = getInputFormat(inputPath, '');
  const buffer = await readFile(inputPath);
  return decodeInventoryInputs(buffer, format, inputPath);
}

function getInputFormat(inputFile, contentType = '') {
  const pathname = isRemoteInventoryInput(inputFile)
    ? new URL(inputFile).pathname
    : String(inputFile || '');
  const lowerPath = pathname.toLowerCase();
  for (const format of ['.csv.gz', '.json.gz', '.jsonl.gz', '.ndjson.gz', '.xlsx.gz', '.zip.gz']) {
    if (lowerPath.endsWith(format)) return format;
  }
  const extension = extname(lowerPath).toLowerCase();
  if (extension) return extension;
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('spreadsheetml.sheet')) return '.xlsx';
  if (lowerType.includes('zip')) return '.zip';
  if (lowerType.includes('ndjson')) return '.ndjson';
  if (lowerType.includes('jsonl')) return '.jsonl';
  if (lowerType.includes('json')) return '.json';
  return '.csv';
}

function normalizeInventoryFormat(format) {
  return String(format || '.csv').toLowerCase().replace(/\.gz$/, '');
}

function decodeInventoryBuffer(buffer) {
  return isGzipBuffer(buffer) ? gunzipSync(buffer) : buffer;
}

function decodeInventoryInputs(buffer, format, inputName) {
  const extension = normalizeInventoryFormat(format);
  const decodedBuffer = decodeInventoryBuffer(buffer);
  if (extension === '.xlsx') return [decodeXlsxInventoryInput(decodedBuffer, inputName)];

  if (normalizeArchiveFormat(format) === '.zip' || isZipBuffer(decodedBuffer)) {
    const entries = extractZipEntries(decodedBuffer);
    if (isXlsxEntrySet(entries)) return [decodeXlsxInventoryInput(decodedBuffer, inputName)];
    const inputs = entries
      .map((entry) => decodeZipInventoryEntry(entry, inputName))
      .filter(Boolean);
    if (!inputs.length) {
      throw new Error(`ZIP supplier inventory ${inputName} does not contain CSV, JSON, JSONL, NDJSON, or XLSX files.`);
    }
    return inputs;
  }

  return [{
    name: inputName,
    content: decodedBuffer.toString('utf8'),
    extension
  }];
}

function decodeXlsxInventoryInput(buffer, inputName) {
  return {
    name: inputName,
    rows: parseXlsxInventory(buffer),
    extension: '.xlsx'
  };
}

function decodeZipInventoryEntry(entry, inputName) {
  const format = getInputFormat(entry.name, '');
  const extension = normalizeInventoryFormat(format);
  if (!supportedInventoryExtensions.has(extension)) return null;
  const content = decodeInventoryBuffer(entry.content);
  if (extension === '.xlsx') return decodeXlsxInventoryInput(content, `${inputName}#${entry.name}`);
  return {
    name: `${inputName}#${entry.name}`,
    content: content.toString('utf8'),
    extension
  };
}

function normalizeArchiveFormat(format) {
  return String(format || '').toLowerCase().replace(/\.gz$/, '');
}

function isXlsxEntrySet(entries) {
  return entries.some((entry) => entry.name.replace(/\\/g, '/').toLowerCase() === 'xl/workbook.xml');
}

function isGzipBuffer(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

export function normalizeInventoryInputReference(inputFile, rootDir = process.cwd()) {
  return isRemoteInventoryInput(inputFile) ? inputFile : resolve(rootDir, inputFile);
}

export function isRemoteInventoryInput(inputFile) {
  return /^https?:\/\//i.test(String(inputFile || '').trim());
}

function normalizeInputFiles(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => {
      const text = String(item || '').trim();
      return isRemoteInventoryInput(text) ? [text] : text.split(/[,\n;]/);
    })
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
    else if (arg === '--field-map') options.fieldMap = argv[++index];
    else if (arg === '--headers') options.headers = argv[++index];
    else if (arg === '--source-manifest') options.sourceManifest = argv[++index];
    else if (arg === '--clean') options.clean = true;
    else if (arg === '--no-manifest') options.buildManifest = false;
    else if (arg === '--help') options.help = true;
    else options.inputFiles.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/split-inventory-shards.js --input <file-or-url> [options]

Options:
  --input <file-or-url> Supplier inventory CSV/JSON/JSONL/NDJSON/XLSX, optionally .gz or a .zip archive. Can be repeated or comma-separated
  --output <dir>      Output shard directory. Default: public/inventory
  --manifest <file>   Manifest file. Default: public/hotel-inventory.manifest.json
  --base-url <url>    Optional absolute URL prefix for generated manifest source URLs
  --field-map <json-or-file> Map non-standard supplier fields to internal fields
  --headers <json-or-file> Request headers for protected remote supplier URLs
  --source-manifest <json-or-file-or-url> Multi-source supplier manifest with per-source url, headers and fieldMap
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

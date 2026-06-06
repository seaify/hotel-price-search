import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPages } from './build-pages.js';
import { isRemoteInventoryInput, normalizeInventoryInputReference, splitInventoryShards } from './split-inventory-shards.js';
import { verifySupplierInventory } from './verify-supplier-inventory.js';

const defaultOutputDir = 'public/inventory';
const defaultManifestPath = 'public/hotel-inventory.manifest.json';

export async function publishSupplierInventory(options = {}) {
  const rootDir = resolve(options.rootDir || options.cwd || process.cwd());
  const inputFiles = normalizeInputFiles(options.inputFiles || options.inputFile || [])
    .map((inputFile) => normalizeInventoryInputReference(inputFile, rootDir));
  if (!inputFiles.length) throw new Error('At least one supplier inventory input file is required.');

  const gateOptions = getGateOptions(options);
  const verification = await verifySupplierInventory({
    cwd: rootDir,
    inputFiles,
    fieldMap: options.fieldMap || options.fields || {},
    ...gateOptions
  });

  if (!verification.passed) {
    return {
      passed: false,
      published: false,
      verification,
      split: null,
      build: null
    };
  }

  const outputDir = options.outputDir || defaultOutputDir;
  const manifestPath = options.manifestPath || defaultManifestPath;
  const split = await splitInventoryShards({
    rootDir,
    inputFiles,
    outputDir,
    manifestPath,
    fieldMap: options.fieldMap || options.fields || {},
    baseUrl: options.baseUrl || '',
    clean: options.clean !== false
  });

  const build = await buildPages({
    rootDir,
    inventoryDir: outputDir,
    manifestPath,
    requireFullInventoryCoverage: true,
    requireCityHotels: true,
    ...gateOptions
  });

  return {
    passed: true,
    published: true,
    verification,
    split: {
      rowCount: split.rowCount,
      shardCount: split.shardCount,
      skippedRowCount: split.skippedRowCount,
      skippedRows: split.skippedRows
    },
    build: {
      docsDir: build.docsDir,
      sourceCount: build.inventory.sourceCount,
      coverage: build.inventory.coverage
    }
  };
}

function getGateOptions(options) {
  return {
    checkIn: options.checkIn || '',
    checkOut: options.checkOut || '',
    minHotelsPerCity: getNonNegativeInteger(options.minHotelsPerCity, 1),
    minRowsPerCity: getNonNegativeInteger(options.minRowsPerCity, 1),
    minPricedHotelsPerCity: getNonNegativeInteger(options.minPricedHotelsPerCity, 1),
    minPricedRowsPerCity: getNonNegativeInteger(options.minPricedRowsPerCity, 1),
    maxPriceAgeHours: getNonNegativeNumber(options.maxPriceAgeHours, 0),
    referenceTime: options.referenceTime || ''
  };
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

function getNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function getNonNegativeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
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
    else if (arg === '--check-in') options.checkIn = argv[++index];
    else if (arg === '--check-out') options.checkOut = argv[++index];
    else if (arg === '--min-hotels-per-city') options.minHotelsPerCity = argv[++index];
    else if (arg === '--min-rows-per-city') options.minRowsPerCity = argv[++index];
    else if (arg === '--min-priced-hotels-per-city') options.minPricedHotelsPerCity = argv[++index];
    else if (arg === '--min-priced-rows-per-city') options.minPricedRowsPerCity = argv[++index];
    else if (arg === '--max-price-age-hours') options.maxPriceAgeHours = argv[++index];
    else if (arg === '--reference-time') options.referenceTime = argv[++index];
    else if (arg === '--no-clean') options.clean = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else options.inputFiles.push(arg);
  }
  return options;
}

function formatText(result) {
  const verification = result.verification;
  const coverage = result.build?.coverage || verification.coverage;
  const lines = [
    `Supplier inventory publish: ${result.published ? 'PUBLISHED' : 'FAILED'}`,
    `Verified rows: ${verification.split.rowCount}, verified city shards: ${verification.split.shardCount}, skipped rows: ${verification.split.skippedRowCount}`,
    `Coverage: ${coverage.coveredCities}/${coverage.totalCities} cities, ${coverage.coveredProvinces}/${coverage.totalProvinces} provinces`,
    `Hotels: ${coverage.hotelCount || 0}, rows: ${coverage.rowCount || 0}, priced hotels: ${coverage.pricedHotelCount || 0}, priced rows: ${coverage.pricedRowCount || 0}`
  ];
  if (coverage.query) lines.push(`Stay dates: ${coverage.query.checkIn} to ${coverage.query.checkOut}`);
  if (result.published) {
    lines.push(`Published shards: ${result.split.shardCount}`);
    lines.push(`Built Pages site: ${result.build.docsDir}`);
  } else {
    if (coverage.missingCities.length) lines.push(`Missing cities: ${formatCityList(coverage.missingCities)}`);
    if (coverage.citiesBelowMinimums.length) lines.push(`Below inventory minimums: ${formatCityList(coverage.citiesBelowMinimums)}`);
    if (coverage.citiesBelowPriceMinimums.length) lines.push(`Below priced minimums: ${formatCityList(coverage.citiesBelowPriceMinimums)}`);
    if (coverage.citiesWithStalePrices.length) lines.push(`Stale prices: ${formatCityList(coverage.citiesWithStalePrices)}`);
    if (verification.split.skippedRowCount) {
      const skipped = verification.split.skippedRows.slice(0, 8)
        .map((row) => `${row.inputFile}:${row.rowNumber} ${row.reason}`)
        .join(', ');
      lines.push(`Skipped row samples: ${skipped}${verification.split.skippedRowCount > 8 ? ` ... +${verification.split.skippedRowCount - 8}` : ''}`);
    }
  }
  return lines.join('\n');
}

function formatCityList(cities) {
  return cities.slice(0, 12)
    .map((item) => `${item.province}/${item.city}`)
    .join(', ') + (cities.length > 12 ? ` ... +${cities.length - 12}` : '');
}

function printHelp() {
  console.log(`Usage: node scripts/publish-supplier-inventory.js --input <file-or-url> [options]

Options:
  --input <file-or-url> Supplier inventory CSV/JSON/JSONL/NDJSON, optionally .gz. Can be repeated or comma-separated
  --output <dir>       Output shard directory. Default: public/inventory
  --manifest <file>    Manifest file. Default: public/hotel-inventory.manifest.json
  --base-url <url>     Optional absolute URL prefix for generated manifest source URLs
  --field-map <json-or-file> Map non-standard supplier fields to internal fields
  --check-in DATE      Require city/date evidence covering this check-in date
  --check-out DATE     Require city/date evidence covering this check-out date
  --min-hotels-per-city N         Default: 1
  --min-rows-per-city N           Default: 1
  --min-priced-hotels-per-city N  Default: 1
  --min-priced-rows-per-city N    Default: 1
  --max-price-age-hours N         Require fresh per-city updatedAt evidence
  --reference-time <time>         Reference timestamp for freshness checks
  --no-clean           Keep existing shard files instead of replacing output dir
  --json               Print full JSON result
`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await publishSupplierInventory(options);
      console.log(options.json ? JSON.stringify(result, null, 2) : formatText(result));
      if (!result.published) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

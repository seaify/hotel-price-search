import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditInventoryCoverage } from './audit-inventory-coverage.js';
import { isRemoteInventoryInput, normalizeInventoryInputReference, splitInventoryShards } from './split-inventory-shards.js';

const defaultManifestPath = 'public/hotel-inventory.manifest.json';

export async function verifySupplierInventory(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const inputFiles = normalizeInputFiles(options.inputFiles || options.inputFile || [])
    .map((inputFile) => normalizeInventoryInputReference(inputFile, cwd));
  if (!inputFiles.length) throw new Error('At least one supplier inventory input file is required.');
  const fieldMap = normalizeFieldMapReference(options.fieldMap || options.fields || {}, cwd);

  const tempRoot = await mkdtemp(join(tmpdir(), 'hotel-supplier-verify-'));
  const keepTemp = Boolean(options.keepTemp);
  try {
    const split = await splitInventoryShards({
      rootDir: tempRoot,
      inputFiles,
      fieldMap,
      clean: true,
      manifestPath: defaultManifestPath
    });
    const coverage = await auditInventoryCoverage({
      rootDir: tempRoot,
      manifestPath: defaultManifestPath,
      requireCityHotels: true,
      minHotelsPerCity: getNonNegativeInteger(options.minHotelsPerCity, 1),
      minRowsPerCity: getNonNegativeInteger(options.minRowsPerCity, 1),
      minPricedHotelsPerCity: getNonNegativeInteger(options.minPricedHotelsPerCity, 1),
      minPricedRowsPerCity: getNonNegativeInteger(options.minPricedRowsPerCity, 1),
      maxPriceAgeHours: getNonNegativeNumber(options.maxPriceAgeHours, 0),
      referenceTime: options.referenceTime || '',
      checkIn: options.checkIn || '',
      checkOut: options.checkOut || ''
    });
    const passed = split.skippedRowCount === 0 && coverage.passed;
    return {
      passed,
      tempRoot: keepTemp ? tempRoot : '',
      inputFiles,
      split: {
        rowCount: split.rowCount,
        shardCount: split.shardCount,
        skippedRowCount: split.skippedRowCount,
        skippedRows: split.skippedRows
      },
      coverage,
      nextCommands: passed ? buildNextCommands(inputFiles, options) : []
    };
  } finally {
    if (!keepTemp) await rm(tempRoot, { recursive: true, force: true });
  }
}

function buildNextCommands(inputFiles, options) {
  const inputs = inputFiles.map((inputFile) => `--input ${quoteShell(inputFile)}`).join(' ');
  const fieldMap = options.fieldMap || options.fields;
  const fieldMapOption = fieldMap ? ` --field-map ${quoteShell(formatFieldMapOption(fieldMap))}` : '';
  const splitCommand = `npm run split:inventory-shards -- ${inputs}${fieldMapOption} --clean`;
  const envParts = ['HOTEL_PAGES_REQUIRE_FULL_INVENTORY_COVERAGE=true'];
  const minHotelsPerCity = getNonNegativeInteger(options.minHotelsPerCity, 1);
  const minRowsPerCity = getNonNegativeInteger(options.minRowsPerCity, 1);
  const minPricedHotelsPerCity = getNonNegativeInteger(options.minPricedHotelsPerCity, 1);
  const minPricedRowsPerCity = getNonNegativeInteger(options.minPricedRowsPerCity, 1);
  const maxPriceAgeHours = getNonNegativeNumber(options.maxPriceAgeHours, 0);
  if (minHotelsPerCity) envParts.push(`HOTEL_PAGES_MIN_HOTELS_PER_CITY=${minHotelsPerCity}`);
  if (minRowsPerCity) envParts.push(`HOTEL_PAGES_MIN_ROWS_PER_CITY=${minRowsPerCity}`);
  if (minPricedHotelsPerCity) envParts.push(`HOTEL_PAGES_MIN_PRICED_HOTELS_PER_CITY=${minPricedHotelsPerCity}`);
  if (minPricedRowsPerCity) envParts.push(`HOTEL_PAGES_MIN_PRICED_ROWS_PER_CITY=${minPricedRowsPerCity}`);
  if (options.checkIn) envParts.push(`HOTEL_PAGES_COVERAGE_CHECK_IN=${quoteShell(options.checkIn)}`);
  if (options.checkOut) envParts.push(`HOTEL_PAGES_COVERAGE_CHECK_OUT=${quoteShell(options.checkOut)}`);
  if (maxPriceAgeHours) envParts.push(`HOTEL_PAGES_MAX_PRICE_AGE_HOURS=${maxPriceAgeHours}`);
  if (options.referenceTime) envParts.push(`HOTEL_PAGES_FRESHNESS_REFERENCE_TIME=${quoteShell(options.referenceTime)}`);
  return [
    splitCommand,
    `${envParts.join(' ')} npm run build:pages`
  ];
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

function normalizeFieldMapReference(value, cwd) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || text.startsWith('{')) return text;
  return resolve(cwd, text);
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

function quoteShell(value) {
  const text = String(value);
  return /^[A-Za-z0-9_/:=.,@%+-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

function parseArgs(argv) {
  const options = { inputFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.inputFiles.push(argv[++index]);
    else if (arg === '--check-in') options.checkIn = argv[++index];
    else if (arg === '--check-out') options.checkOut = argv[++index];
    else if (arg === '--field-map') options.fieldMap = argv[++index];
    else if (arg === '--min-hotels-per-city') options.minHotelsPerCity = argv[++index];
    else if (arg === '--min-rows-per-city') options.minRowsPerCity = argv[++index];
    else if (arg === '--min-priced-hotels-per-city') options.minPricedHotelsPerCity = argv[++index];
    else if (arg === '--min-priced-rows-per-city') options.minPricedRowsPerCity = argv[++index];
    else if (arg === '--max-price-age-hours') options.maxPriceAgeHours = argv[++index];
    else if (arg === '--reference-time') options.referenceTime = argv[++index];
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else options.inputFiles.push(arg);
  }
  return options;
}

function formatText(result) {
  const coverage = result.coverage;
  const lines = [
    `Supplier inventory verification: ${result.passed ? 'PASSED' : 'FAILED'}`,
    `Rows: ${result.split.rowCount}, city shards: ${result.split.shardCount}, skipped rows: ${result.split.skippedRowCount}`,
    `Coverage: ${coverage.coveredCities}/${coverage.totalCities} cities, ${coverage.coveredProvinces}/${coverage.totalProvinces} provinces`,
    `Hotels: ${coverage.hotelCount || 0}, rows: ${coverage.rowCount || 0}, priced hotels: ${coverage.pricedHotelCount || 0}, priced rows: ${coverage.pricedRowCount || 0}`
  ];
  if (coverage.query) lines.push(`Stay dates: ${coverage.query.checkIn} to ${coverage.query.checkOut}`);
  if (coverage.missingCities.length) {
    lines.push(`Missing cities: ${formatCityList(coverage.missingCities)}`);
  }
  if (coverage.citiesBelowMinimums.length) {
    lines.push(`Below inventory minimums: ${formatCityList(coverage.citiesBelowMinimums)}`);
  }
  if (coverage.citiesBelowPriceMinimums.length) {
    lines.push(`Below priced minimums: ${formatCityList(coverage.citiesBelowPriceMinimums)}`);
  }
  if (coverage.citiesWithStalePrices.length) {
    lines.push(`Stale prices: ${formatCityList(coverage.citiesWithStalePrices)}`);
  }
  if (result.split.skippedRowCount) {
    const skipped = result.split.skippedRows.slice(0, 8)
      .map((row) => `${row.inputFile}:${row.rowNumber} ${row.reason}`)
      .join(', ');
    lines.push(`Skipped row samples: ${skipped}${result.split.skippedRowCount > 8 ? ` ... +${result.split.skippedRowCount - 8}` : ''}`);
  }
  if (result.nextCommands.length) {
    lines.push('Next commands:');
    result.nextCommands.forEach((command) => lines.push(`  ${command}`));
  }
  if (result.tempRoot) lines.push(`Kept temp directory: ${result.tempRoot}`);
  return lines.join('\n');
}

function formatFieldMapOption(value) {
  return typeof value === 'string' ? value : JSON.stringify(value || {});
}

function formatCityList(cities) {
  return cities.slice(0, 12)
    .map((item) => `${item.province}/${item.city}`)
    .join(', ') + (cities.length > 12 ? ` ... +${cities.length - 12}` : '');
}

function printHelp() {
  console.log(`Usage: node scripts/verify-supplier-inventory.js --input <file-or-url> [options]

Options:
  --input <file-or-url> Supplier inventory CSV/JSON/JSONL/NDJSON, optionally .gz. Can be repeated or comma-separated
  --check-in DATE      Require city/date evidence covering this check-in date
  --check-out DATE     Require city/date evidence covering this check-out date
  --field-map <json-or-file> Map non-standard supplier fields to internal fields
  --min-hotels-per-city N         Default: 1
  --min-rows-per-city N           Default: 1
  --min-priced-hotels-per-city N  Default: 1
  --min-priced-rows-per-city N    Default: 1
  --max-price-age-hours N         Require fresh per-city updatedAt evidence
  --reference-time <time>         Reference timestamp for freshness checks
  --keep-temp          Keep temporary split output for inspection
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
      const result = await verifySupplierInventory(options);
      console.log(options.json ? JSON.stringify(result, null, 2) : formatText(result));
      if (!result.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

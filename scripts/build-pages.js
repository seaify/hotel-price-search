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
  const readiness = buildInventoryReadiness(inventory, options);

  const staticData = `window.HOTEL_STATIC_DATA = ${JSON.stringify({ cities: cityCatalog }, null, 2)};\nwindow.HOTEL_STATIC_MODE = false;\n`;
  const pagesStaticData = `window.HOTEL_STATIC_DATA = ${JSON.stringify({ cities: cityCatalog }, null, 2)};\nwindow.HOTEL_STATIC_MODE = true;\n`;

  await mkdir(publicDir, { recursive: true });
  await writeFile(resolve(publicDir, 'static-data.js'), staticData, 'utf8');
  await writeFile(resolve(publicDir, 'inventory-readiness.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  await rm(docsDir, { recursive: true, force: true });
  await copyPublicDirectory(publicDir, docsDir);
  await writeFile(resolve(docsDir, '.nojekyll'), '', 'utf8');
  await writeFile(resolve(docsDir, 'static-data.js'), pagesStaticData, 'utf8');

  return { rootDir, publicDir, docsDir, inventory, readiness };
}

async function preparePagesInventory(rootDir, options) {
  const publicDir = options.publicDir || 'public';
  const inventoryDir = resolve(rootDir, options.inventoryDir || `${publicDir}/inventory`);
  const hasInventoryShards = await hasInventoryShardFiles(inventoryDir);
  const minHotelsPerCity = getNonNegativeInteger(
    options.minHotelsPerCity ?? process.env.HOTEL_PAGES_MIN_HOTELS_PER_CITY,
    0
  );
  const minRowsPerCity = getNonNegativeInteger(
    options.minRowsPerCity ?? process.env.HOTEL_PAGES_MIN_ROWS_PER_CITY,
    0
  );
  const minPricedHotelsPerCity = getNonNegativeInteger(
    options.minPricedHotelsPerCity ?? process.env.HOTEL_PAGES_MIN_PRICED_HOTELS_PER_CITY,
    0
  );
  const minPricedRowsPerCity = getNonNegativeInteger(
    options.minPricedRowsPerCity ?? process.env.HOTEL_PAGES_MIN_PRICED_ROWS_PER_CITY,
    0
  );
  const minTotalHotels = getNonNegativeInteger(
    options.minTotalHotels ?? process.env.HOTEL_PAGES_MIN_TOTAL_HOTELS,
    0
  );
  const minTotalRows = getNonNegativeInteger(
    options.minTotalRows ?? process.env.HOTEL_PAGES_MIN_TOTAL_ROWS,
    0
  );
  const minTotalPricedHotels = getNonNegativeInteger(
    options.minTotalPricedHotels ?? process.env.HOTEL_PAGES_MIN_TOTAL_PRICED_HOTELS,
    0
  );
  const minTotalPricedRows = getNonNegativeInteger(
    options.minTotalPricedRows ?? process.env.HOTEL_PAGES_MIN_TOTAL_PRICED_ROWS,
    0
  );
  const maxPriceAgeHours = getNonNegativeNumber(
    options.maxPriceAgeHours ?? process.env.HOTEL_PAGES_MAX_PRICE_AGE_HOURS,
    0
  );
  const referenceTime = options.referenceTime ?? process.env.HOTEL_PAGES_FRESHNESS_REFERENCE_TIME ?? '';
  const checkIn = options.checkIn ?? process.env.HOTEL_PAGES_COVERAGE_CHECK_IN ?? '';
  const checkOut = options.checkOut ?? process.env.HOTEL_PAGES_COVERAGE_CHECK_OUT ?? '';
  const requireFullCoverage = options.requireFullInventoryCoverage
    ?? isTruthy(process.env.HOTEL_PAGES_REQUIRE_FULL_INVENTORY_COVERAGE);
  const requireCityHotels = options.requireCityHotels
    ?? (requireFullCoverage || minHotelsPerCity > 0 || isTruthy(process.env.HOTEL_PAGES_REQUIRE_CITY_HOTELS));
  const auditInventory = options.auditInventory
    ?? isTruthy(process.env.HOTEL_PAGES_AUDIT_INVENTORY);
  const shouldBlockOnAudit = requireFullCoverage
    || requireCityHotels
    || minHotelsPerCity > 0
    || minRowsPerCity > 0
    || minPricedHotelsPerCity > 0
    || minPricedRowsPerCity > 0
    || minTotalHotels > 0
    || minTotalRows > 0
    || minTotalPricedHotels > 0
    || minTotalPricedRows > 0
    || maxPriceAgeHours > 0;
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

  if (hasInventoryShards || shouldBlockOnAudit || auditInventory) {
    coverage = await auditInventoryCoverage({
      rootDir,
      manifestPath,
      requireCityHotels,
      minHotelsPerCity,
      minRowsPerCity,
      minPricedHotelsPerCity,
      minPricedRowsPerCity,
      minTotalHotels,
      minTotalRows,
      minTotalPricedHotels,
      minTotalPricedRows,
      maxPriceAgeHours,
      referenceTime,
      checkIn,
      checkOut
    });
    if (shouldBlockOnAudit && !coverage.passed) {
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
  const withoutHotelStats = coverage.citiesWithoutHotelStats
    .slice(0, 8)
    .map((item) => `${item.province}/${item.city}`)
    .join(', ');
  const belowMinimums = coverage.citiesBelowMinimums
    .slice(0, 8)
    .map((item) => `${item.province}/${item.city} hotels ${item.hotelCount}/${item.minHotelCount}, rows ${item.rowCount}/${item.minRowCount}`)
    .join(', ');
  const belowPriceMinimums = coverage.citiesBelowPriceMinimums
    .slice(0, 8)
    .map((item) => `${item.province}/${item.city} priced hotels ${item.pricedHotelCount}/${item.minPricedHotelCount}, priced rows ${item.pricedRowCount}/${item.minPricedRowCount}`)
    .join(', ');
  const belowTotalMinimums = coverage.totalMinimumFailures
    .map((item) => `${item.label} ${item.actual}/${item.minimum}`)
    .join(', ');
  const stalePrices = coverage.citiesWithStalePrices
    .slice(0, 8)
    .map((item) => `${item.province}/${item.city} updated ${item.updatedAt || 'missing'}`)
    .join(', ');
  return [
    `Inventory coverage audit failed: ${coverage.coveredCities}/${coverage.totalCities} cities covered.`,
    missing ? `Missing: ${missing}${coverage.missingCities.length > 8 ? ` ... +${coverage.missingCities.length - 8}` : ''}` : '',
    withoutHotelStats ? `Without hotel stats: ${withoutHotelStats}${coverage.citiesWithoutHotelStats.length > 8 ? ` ... +${coverage.citiesWithoutHotelStats.length - 8}` : ''}` : '',
    belowMinimums ? `Below minimums: ${belowMinimums}${coverage.citiesBelowMinimums.length > 8 ? ` ... +${coverage.citiesBelowMinimums.length - 8}` : ''}` : '',
    belowPriceMinimums ? `Below price minimums: ${belowPriceMinimums}${coverage.citiesBelowPriceMinimums.length > 8 ? ` ... +${coverage.citiesBelowPriceMinimums.length - 8}` : ''}` : '',
    belowTotalMinimums ? `Below total minimums: ${belowTotalMinimums}` : '',
    stalePrices ? `Stale prices: ${stalePrices}${coverage.citiesWithStalePrices.length > 8 ? ` ... +${coverage.citiesWithStalePrices.length - 8}` : ''}` : '',
    unscoped ? `Unscoped sources: ${unscoped}` : '',
    unknown ? `Unknown destinations: ${unknown}` : ''
  ].filter(Boolean).join(' ');
}

function buildInventoryReadiness(inventory = {}, options = {}) {
  const generatedAt = String(options.generatedAt || process.env.HOTEL_PAGES_READINESS_GENERATED_AT || new Date().toISOString());
  const coverage = inventory.coverage || null;

  if (!coverage) {
    return {
      schemaVersion: 1,
      generatedAt,
      mode: 'demo',
      passed: false,
      sourceCount: Number(inventory.sourceCount || 0),
      message: 'No supplier inventory manifest was audited. GitHub Pages will fall back to the demo price catalog until verified supplier inventory is published.',
      coverage: null,
      failures: [{
        type: 'no-audited-inventory',
        message: 'No verified supplier inventory manifest was audited.'
      }]
    };
  }

  return {
    schemaVersion: 1,
    generatedAt,
    mode: 'inventory-audit',
    passed: Boolean(coverage.passed),
    sourceCount: Number(coverage.sourceCount || inventory.sourceCount || 0),
    message: coverage.passed
      ? 'Supplier inventory passed the configured nationwide publication audit.'
      : 'Supplier inventory did not pass the configured nationwide publication audit.',
    coverage: summarizeReadinessCoverage(coverage),
    failures: summarizeReadinessFailures(coverage)
  };
}

function summarizeReadinessCoverage(coverage) {
  return {
    mode: 'audit',
    manifestPath: coverage.manifestPath || '',
    passed: Boolean(coverage.passed),
    query: coverage.query || null,
    sourceCount: Number(coverage.sourceCount || 0),
    scopedSourceCount: Number(coverage.scopedSourceCount || 0),
    unscopedSourceCount: Number(coverage.unscopedSourceCount || 0),
    rowCount: Number(coverage.rowCount || 0),
    hotelCount: Number(coverage.hotelCount || 0),
    pricedRowCount: Number(coverage.pricedRowCount || 0),
    pricedHotelCount: Number(coverage.pricedHotelCount || 0),
    coveredCities: Number(coverage.coveredCities || 0),
    totalCities: Number(coverage.totalCities || 0),
    coverageRatio: Number(coverage.coverageRatio || 0),
    coveredProvinces: Number(coverage.coveredProvinces || 0),
    totalProvinces: Number(coverage.totalProvinces || 0),
    minHotelsPerCity: Number(coverage.minHotelsPerCity || 0),
    minRowsPerCity: Number(coverage.minRowsPerCity || 0),
    minPricedHotelsPerCity: Number(coverage.minPricedHotelsPerCity || 0),
    minPricedRowsPerCity: Number(coverage.minPricedRowsPerCity || 0),
    minTotalHotels: Number(coverage.minTotalHotels || 0),
    minTotalRows: Number(coverage.minTotalRows || 0),
    minTotalPricedHotels: Number(coverage.minTotalPricedHotels || 0),
    minTotalPricedRows: Number(coverage.minTotalPricedRows || 0),
    maxPriceAgeHours: Number(coverage.maxPriceAgeHours || 0),
    freshnessCutoff: coverage.freshnessCutoff || '',
    missingCityCount: (coverage.missingCities || []).length,
    citiesWithoutHotelStatsCount: (coverage.citiesWithoutHotelStats || []).length,
    citiesBelowMinimumCount: (coverage.citiesBelowMinimums || []).length,
    citiesBelowPriceMinimumCount: (coverage.citiesBelowPriceMinimums || []).length,
    citiesWithStalePricesCount: (coverage.citiesWithStalePrices || []).length,
    unknownDestinationCount: (coverage.unknownDestinations || []).length,
    totalMinimumFailures: normalizeTotalMinimumFailures(coverage.totalMinimumFailures || []),
    missingCities: normalizeCityList(coverage.missingCities || []),
    citiesWithoutHotelStats: normalizeCityList(coverage.citiesWithoutHotelStats || []),
    citiesBelowMinimums: normalizeCityMinimums(coverage.citiesBelowMinimums || []),
    citiesBelowPriceMinimums: normalizePriceMinimums(coverage.citiesBelowPriceMinimums || []),
    citiesWithStalePrices: normalizeStaleCities(coverage.citiesWithStalePrices || []),
    unscopedSources: normalizeUnscopedSources(coverage.unscopedSources || []),
    unknownDestinations: [...(coverage.unknownDestinations || [])].map(String),
    sourceCoverage: normalizeSourceCoverage(coverage.sourceCoverage || [])
  };
}

function summarizeReadinessFailures(coverage) {
  const failures = [];
  if ((coverage.missingCities || []).length) {
    failures.push({
      type: 'missing-cities',
      count: coverage.missingCities.length,
      message: `${coverage.missingCities.length} catalog cities are not covered.`
    });
  }
  if ((coverage.citiesWithoutHotelStats || []).length) {
    failures.push({
      type: 'missing-city-hotel-stats',
      count: coverage.citiesWithoutHotelStats.length,
      message: `${coverage.citiesWithoutHotelStats.length} covered cities do not have hotel-count evidence.`
    });
  }
  if ((coverage.citiesBelowMinimums || []).length) {
    failures.push({
      type: 'city-depth-below-minimum',
      count: coverage.citiesBelowMinimums.length,
      message: `${coverage.citiesBelowMinimums.length} cities are below the configured per-city inventory minimum.`
    });
  }
  if ((coverage.citiesBelowPriceMinimums || []).length) {
    failures.push({
      type: 'city-priced-depth-below-minimum',
      count: coverage.citiesBelowPriceMinimums.length,
      message: `${coverage.citiesBelowPriceMinimums.length} cities are below the configured per-city priced inventory minimum.`
    });
  }
  if ((coverage.totalMinimumFailures || []).length) {
    failures.push({
      type: 'nationwide-total-below-minimum',
      count: coverage.totalMinimumFailures.length,
      message: `Nationwide totals are below configured minimums: ${coverage.totalMinimumFailures.map((item) => `${item.label} ${item.actual}/${item.minimum}`).join(', ')}.`
    });
  }
  if ((coverage.citiesWithStalePrices || []).length) {
    failures.push({
      type: 'stale-city-prices',
      count: coverage.citiesWithStalePrices.length,
      message: `${coverage.citiesWithStalePrices.length} cities have stale or missing price update evidence.`
    });
  }
  if ((coverage.unscopedSources || []).length) {
    failures.push({
      type: 'unscoped-sources',
      count: coverage.unscopedSources.length,
      message: `${coverage.unscopedSources.length} supplier sources are missing city/province scope.`
    });
  }
  if ((coverage.unknownDestinations || []).length) {
    failures.push({
      type: 'unknown-destinations',
      count: coverage.unknownDestinations.length,
      message: `${coverage.unknownDestinations.length} destinations are not in the city catalog.`
    });
  }
  return failures;
}

function normalizeCityList(cities) {
  return cities.map((item) => ({
    province: String(item.province || ''),
    city: String(item.city || '')
  }));
}

function normalizeCityMinimums(cities) {
  return cities.map((item) => ({
    province: String(item.province || ''),
    city: String(item.city || ''),
    rowCount: Number(item.rowCount || 0),
    hotelCount: Number(item.hotelCount || 0),
    minRowCount: Number(item.minRowCount || 0),
    minHotelCount: Number(item.minHotelCount || 0)
  }));
}

function normalizePriceMinimums(cities) {
  return cities.map((item) => ({
    province: String(item.province || ''),
    city: String(item.city || ''),
    pricedRowCount: Number(item.pricedRowCount || 0),
    pricedHotelCount: Number(item.pricedHotelCount || 0),
    minPricedRowCount: Number(item.minPricedRowCount || 0),
    minPricedHotelCount: Number(item.minPricedHotelCount || 0),
    minPrice: Number(item.minPrice || 0)
  }));
}

function normalizeStaleCities(cities) {
  return cities.map((item) => ({
    province: String(item.province || ''),
    city: String(item.city || ''),
    updatedAt: String(item.updatedAt || ''),
    maxPriceAgeHours: Number(item.maxPriceAgeHours || 0),
    referenceTime: String(item.referenceTime || '')
  }));
}

function normalizeTotalMinimumFailures(failures) {
  return failures.map((item) => ({
    field: String(item.field || ''),
    label: String(item.label || ''),
    actual: Number(item.actual || 0),
    minimum: Number(item.minimum || 0)
  }));
}

function normalizeUnscopedSources(sources) {
  return sources.map((source) => ({
    name: String(source.name || ''),
    url: String(source.url || '')
  }));
}

function normalizeSourceCoverage(sources) {
  return sources.map((source) => ({
    sourceName: String(source.sourceName || source.name || '供应商'),
    url: String(source.url || ''),
    coveredCities: Number(source.coveredCities ?? source.cityCount ?? 0),
    totalCities: Number(source.totalCities || cityCatalog.length),
    coveredProvinces: Number(source.coveredProvinces || 0),
    totalProvinces: Number(source.totalProvinces || 0),
    rowCount: Number(source.rowCount || 0),
    hotelCount: Number(source.hotelCount || 0),
    pricedRowCount: Number(source.pricedRowCount || 0),
    pricedHotelCount: Number(source.pricedHotelCount || 0),
    minPrice: Number(source.minPrice || 0),
    hasScope: source.hasScope !== false
  }));
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
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

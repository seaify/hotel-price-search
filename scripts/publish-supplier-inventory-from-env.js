import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishSupplierInventory } from './publish-supplier-inventory.js';

export function buildPublishSupplierInventoryOptions(env = process.env, cwd = process.cwd()) {
  const inputFiles = getInputFiles(env);
  const sourceManifest = getSourceManifest(env);
  if (!inputFiles.length && !sourceManifest) {
    throw new Error('Set HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE, HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON, HOTEL_SUPPLIER_INVENTORY_INPUTS, HOTEL_SUPPLIER_INVENTORY_INPUT, HOTEL_SUPPLIER_SOURCE_MANIFEST_OVERRIDE, HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON, or HOTEL_SUPPLIER_SOURCE_MANIFEST_URL before publishing supplier inventory.');
  }

  const options = {
    rootDir: resolve(cwd),
    inputFiles,
    fieldMap: firstNonEmpty(env.HOTEL_SUPPLIER_FIELD_MAP_JSON, env.HOTEL_SUPPLIER_FIELD_MAP, ''),
    headers: firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON, env.HOTEL_SUPPLIER_INVENTORY_HEADERS, ''),
    sourceManifest,
    checkIn: firstNonEmpty(env.HOTEL_SUPPLIER_CHECK_IN, ''),
    checkOut: firstNonEmpty(env.HOTEL_SUPPLIER_CHECK_OUT, ''),
    minHotelsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY, ''),
    minRowsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_ROWS_PER_CITY, ''),
    minPricedHotelsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_PRICED_HOTELS_PER_CITY, ''),
    minPricedRowsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_PRICED_ROWS_PER_CITY, ''),
    minTotalHotels: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_HOTELS, ''),
    minTotalRows: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_ROWS, ''),
    minTotalPricedHotels: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_PRICED_HOTELS, ''),
    minTotalPricedRows: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_PRICED_ROWS, ''),
    maxPriceAgeHours: firstNonEmpty(env.HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS, ''),
    referenceTime: firstNonEmpty(env.HOTEL_SUPPLIER_FRESHNESS_REFERENCE_TIME, env.HOTEL_SUPPLIER_REFERENCE_TIME, ''),
    baseUrl: firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_BASE_URL, ''),
    outputDir: firstNonEmpty(env.HOTEL_SUPPLIER_OUTPUT_DIR, ''),
    manifestPath: firstNonEmpty(env.HOTEL_SUPPLIER_MANIFEST_PATH, '')
  };

  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== ''));
}

export function inspectPublishSupplierInventoryConfig(env = process.env) {
  const inputFiles = getInputFiles(env);
  const sourceManifest = getSourceManifest(env);
  const inputSource = getInputSource(env);
  const manifestSource = getManifestSource(env);
  return {
    configured: inputFiles.length > 0 || Boolean(sourceManifest),
    inputCount: inputFiles.length,
    inputSource,
    manifestConfigured: Boolean(sourceManifest),
    manifestSource,
    headersConfigured: Boolean(firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON, env.HOTEL_SUPPLIER_INVENTORY_HEADERS, '')),
    fieldMapConfigured: Boolean(firstNonEmpty(env.HOTEL_SUPPLIER_FIELD_MAP_JSON, env.HOTEL_SUPPLIER_FIELD_MAP, '')),
    checkInConfigured: Boolean(firstNonEmpty(env.HOTEL_SUPPLIER_CHECK_IN, '')),
    checkOutConfigured: Boolean(firstNonEmpty(env.HOTEL_SUPPLIER_CHECK_OUT, '')),
    minHotelsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY, ''),
    minRowsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_ROWS_PER_CITY, ''),
    minPricedHotelsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_PRICED_HOTELS_PER_CITY, ''),
    minPricedRowsPerCity: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_PRICED_ROWS_PER_CITY, ''),
    minTotalHotels: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_HOTELS, ''),
    minTotalRows: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_ROWS, ''),
    minTotalPricedHotels: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_PRICED_HOTELS, ''),
    minTotalPricedRows: firstNonEmpty(env.HOTEL_SUPPLIER_MIN_TOTAL_PRICED_ROWS, ''),
    maxPriceAgeHours: firstNonEmpty(env.HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS, ''),
    freshnessReferenceTimeConfigured: Boolean(firstNonEmpty(env.HOTEL_SUPPLIER_FRESHNESS_REFERENCE_TIME, env.HOTEL_SUPPLIER_REFERENCE_TIME, '')),
    inventoryBaseUrlConfigured: Boolean(firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_BASE_URL, ''))
  };
}

function getSourceManifest(env) {
  return firstNonEmpty(
    env.HOTEL_SUPPLIER_SOURCE_MANIFEST_OVERRIDE,
    env.HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON,
    env.HOTEL_SUPPLIER_SOURCE_MANIFEST_URL,
    env.HOTEL_SUPPLIER_SOURCE_MANIFEST,
    ''
  );
}

function getInputFiles(env) {
  const overrideInputs = firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE, '');
  if (overrideInputs) return parseTextInputList(overrideInputs);

  const jsonInputs = firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON, '');
  if (jsonInputs) return parseJsonInputList(jsonInputs);

  const text = firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUTS, env.HOTEL_SUPPLIER_INVENTORY_INPUT, '');
  if (!text) return [];
  return parseTextInputList(text);
}

function parseTextInputList(text) {
  if (text.trim().startsWith('[')) return parseJsonInputList(text);
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getInputSource(env) {
  if (firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE, '')) return 'workflow-dispatch';
  if (firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON, '')) return 'secret-json';
  if (firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUTS, '')) return 'secret-list';
  if (firstNonEmpty(env.HOTEL_SUPPLIER_INVENTORY_INPUT, '')) return 'secret-single';
  return 'none';
}

function getManifestSource(env) {
  if (firstNonEmpty(env.HOTEL_SUPPLIER_SOURCE_MANIFEST_OVERRIDE, '')) return 'workflow-dispatch';
  if (firstNonEmpty(env.HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON, '')) return 'secret-json';
  if (firstNonEmpty(env.HOTEL_SUPPLIER_SOURCE_MANIFEST_URL, '')) return 'secret-url';
  if (firstNonEmpty(env.HOTEL_SUPPLIER_SOURCE_MANIFEST, '')) return 'secret-value';
  return 'none';
}

function parseJsonInputList(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Supplier inventory JSON inputs must be an array of file paths or URLs.');
  return parsed.map((item) => String(item || '').trim()).filter(Boolean);
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const result = await publishSupplierInventory(buildPublishSupplierInventoryOptions());
    console.log(JSON.stringify(result, null, 2));
    if (!result.published) process.exitCode = 1;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

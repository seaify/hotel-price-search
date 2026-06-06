import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cityCatalog } from '../server/hotel-data.js';

const supportedExtensions = new Set(['.csv', '.json', '.jsonl', '.ndjson']);
const inventoryCollectionKeys = ['hotels', 'items', 'data', 'results', 'records', 'list', '酒店列表', '酒店'];
const nestedCollectionKeys = new Set([
  ...inventoryCollectionKeys,
  'rooms',
  'roomTypes',
  'roomList',
  'rates',
  'offers',
  'prices',
  'roomRates',
  'plans',
  'products',
  '房型',
  '房型列表',
  '房间',
  '报价',
  '报价列表',
  '价格',
  '价格列表',
  '价格计划'
]);

const fieldAliases = {
  id: ['id', 'hotelId', 'hotel_id', '酒店ID', '酒店编号', '供应商酒店ID'],
  masterHotelId: ['masterHotelId', 'master_hotel_id', 'standardHotelId', 'standard_hotel_id', 'canonicalHotelId', 'canonical_hotel_id', 'unifiedHotelId', 'unified_hotel_id', 'globalHotelId', 'global_hotel_id', '统一酒店ID', '标准酒店ID', '主酒店ID'],
  name: ['name', 'hotelName', 'hotel_name', '酒店名称', '酒店名', '酒店', '名称'],
  province: ['province', '省份', '省', '地区省份'],
  city: ['city', 'destination', '目的地', '城市', '市'],
  address: ['address', '酒店地址', '地址', '详细地址'],
  price: ['price', 'lowestPrice', 'dailyPrice', 'salePrice', 'roomPrice', '最低价', '价格', '日价', '房价', '售卖价', '含税价'],
  totalPrice: ['totalPrice', 'amount', 'totalAmount', '总价', '合计价', '订单金额'],
  providerName: ['source', 'provider', 'supplier', '供应商', '渠道', '来源'],
  checkIn: ['checkIn', 'startDate', '入住日期', '入住', '可售开始日期', '开始日期'],
  checkOut: ['checkOut', 'endDate', '离店日期', '离店', '可售结束日期', '结束日期'],
  available: ['available', 'isAvailable', '可售', '是否可售', '库存状态', '状态'],
  updatedAt: ['updatedAt', 'updated_at', 'fetchedAt', 'fetched_at', 'syncedAt', 'synced_at', 'priceUpdatedAt', 'price_updated_at', 'rateUpdatedAt', 'rate_updated_at', 'lastUpdated', 'last_updated', '价格更新时间', '报价更新时间', '库存更新时间', '抓取时间', '同步时间', '更新时间']
};

export async function buildInventoryManifest(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const publicDir = resolve(rootDir, options.publicDir || 'public');
  const inputDir = resolve(rootDir, options.inputDir || 'public/inventory');
  const outputPath = resolve(rootDir, options.outputPath || 'public/hotel-inventory.manifest.json');
  const files = await listInventoryFiles(inputDir);
  const sources = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const extension = extname(filePath).toLowerCase();
    const rows = parseInventory(content, extension);
    if (!rows.length) continue;
    const summary = summarizeInventoryRows(rows, filePath);
    sources.push({
      name: summary.name,
      url: formatManifestUrl(filePath, publicDir, options.baseUrl),
      ...(summary.cities.length ? { cities: summary.cities } : {}),
      ...(summary.cities.length ? {} : summary.provinces.length ? { provinces: summary.provinces } : {}),
      rowCount: summary.rowCount,
      hotelCount: summary.hotelCount,
      pricedRowCount: summary.pricedRowCount,
      pricedHotelCount: summary.pricedHotelCount,
      ...(summary.minPrice ? { minPrice: summary.minPrice } : {}),
      ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
      cityStats: summary.cityStats
    });
  }

  const manifest = {
    name: 'Hotel supplier inventory manifest',
    description: 'Generated from public inventory shards. GitHub Pages loads matching city/province shards on demand.',
    generatedAt: new Date().toISOString(),
    sources: sources.sort((a, b) => a.url.localeCompare(b.url, 'zh-CN'))
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function listInventoryFiles(inputDir) {
  let entries;
  try {
    entries = await readdir(inputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(inputDir, entry.name);
    if (entry.isDirectory()) return listInventoryFiles(entryPath);
    if (entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase())) return [entryPath];
    return [];
  }));
  return files.flat().sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function parseInventory(content, extension) {
  if (extension === '.json') return flattenInventoryDocument(JSON.parse(content));
  if (extension === '.jsonl' || extension === '.ndjson') {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => flattenInventoryDocument(JSON.parse(line)));
  }
  return parseCsv(content);
}

function flattenInventoryDocument(parsed) {
  const records = getInventoryRecords(parsed);
  return records.flatMap(flattenInventoryRecord);
}

function getInventoryRecords(value, inherited = {}) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...inherited, ...item }));
  }
  if (!value || typeof value !== 'object') return [];
  const rootFields = { ...inherited, ...stripNestedCollections(value) };

  for (const key of inventoryCollectionKeys) {
    const nested = value[key];
    if (Array.isArray(nested)) return getInventoryRecords(nested, rootFields);
    if (nested && typeof nested === 'object') {
      const nestedRecords = getInventoryRecords(nested, rootFields);
      if (nestedRecords.length) return nestedRecords;
    }
  }

  return [{ ...inherited, ...value }];
}

function flattenInventoryRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const rooms = getFirstArray(record, ['rooms', 'roomTypes', 'roomList', '房型', '房型列表', '房间']);
  const directRates = getFirstArray(record, ['rates', 'offers', 'prices', 'roomRates', 'plans', 'products', '报价', '报价列表', '价格', '价格列表', '价格计划']);

  if (rooms.length) {
    const rows = rooms.flatMap((room) => {
      if (!room || typeof room !== 'object') return [];
      const rates = getFirstArray(room, ['rates', 'offers', 'prices', 'roomRates', 'plans', 'products', '报价', '报价列表', '价格', '价格列表', '价格计划']);
      return rates.length
        ? rates.map((rate) => mergeInventoryParts(record, room, rate))
        : [mergeInventoryParts(record, room, null)];
    });
    if (rows.length) return rows;
  }

  if (directRates.length) return directRates.map((rate) => mergeInventoryParts(record, null, rate));
  return [stripNestedCollections(record)];
}

function mergeInventoryParts(hotel, room, rate) {
  return {
    ...stripNestedCollections(hotel || {}),
    ...stripNestedCollections(room || {}),
    ...stripNestedCollections(rate || {})
  };
}

function stripNestedCollections(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([key, item]) => {
      const nestedValue = item && typeof item === 'object';
      return !nestedCollectionKeys.has(key) || !nestedValue;
    })
  );
}

function getFirstArray(value, keys) {
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function summarizeInventoryRows(rows, filePath) {
  const cities = new Set();
  const provinces = new Set();
  const providers = new Set();
  const hotels = new Set();
  const pricedHotels = new Set();
  const cityStats = new Map();
  let pricedRowCount = 0;
  let minPrice = 0;
  let updatedAt = '';

  rows.forEach((row, index) => {
    const location = normalizeInventoryLocation(pick(row, 'city'), pick(row, 'province'));
    const hotelKey = getHotelKey(row, location, index);
    const available = pick(row, 'available') === undefined ? true : parseBoolean(pick(row, 'available'));
    const price = normalizePrice(pick(row, 'price')) || normalizePrice(pick(row, 'totalPrice'));
    const hasPrice = available && price > 0;
    const checkIn = normalizeDate(pick(row, 'checkIn'));
    const checkOut = normalizeDate(pick(row, 'checkOut'));
    const rowUpdatedAt = normalizeTimestamp(pick(row, 'updatedAt'));
    updatedAt = maxTimestamp(updatedAt, rowUpdatedAt);
    if (location.city) cities.add(location.city);
    if (location.province) provinces.add(location.province);
    if (hasPrice) {
      pricedRowCount += 1;
      pricedHotels.add(hotelKey);
      minPrice = minPositivePrice(minPrice, price);
    }
    if (location.city && available) {
      const existing = cityStats.get(location.city) || {
        province: location.province || findCityProvince(location.city),
        city: location.city,
        rowCount: 0,
        hotels: new Set(),
        pricedRowCount: 0,
        pricedHotels: new Set(),
        minPrice: 0,
        dateStats: new Map(),
        updatedAt: ''
      };
      existing.rowCount += 1;
      existing.hotels.add(hotelKey);
      if (hasPrice) {
        existing.pricedRowCount += 1;
        existing.pricedHotels.add(hotelKey);
        existing.minPrice = minPositivePrice(existing.minPrice, price);
      }
      existing.updatedAt = maxTimestamp(existing.updatedAt, rowUpdatedAt);
      const dateKey = `${checkIn || ''}|${checkOut || ''}`;
      const dateStat = existing.dateStats.get(dateKey) || {
        checkIn,
        checkOut,
        rowCount: 0,
        hotels: new Set(),
        pricedRowCount: 0,
        pricedHotels: new Set(),
        minPrice: 0,
        updatedAt: ''
      };
      dateStat.rowCount += 1;
      dateStat.hotels.add(hotelKey);
      if (hasPrice) {
        dateStat.pricedRowCount += 1;
        dateStat.pricedHotels.add(hotelKey);
        dateStat.minPrice = minPositivePrice(dateStat.minPrice, price);
      }
      dateStat.updatedAt = maxTimestamp(dateStat.updatedAt, rowUpdatedAt);
      existing.dateStats.set(dateKey, dateStat);
      cityStats.set(location.city, existing);
    }
    const providerName = pick(row, 'providerName');
    if (providerName) providers.add(String(providerName).trim());
    hotels.add(hotelKey);
  });

  return {
    name: providers.size === 1 ? [...providers][0] : formatSourceName(filePath),
    rowCount: rows.length,
    hotelCount: hotels.size,
    pricedRowCount,
    pricedHotelCount: pricedHotels.size,
    minPrice,
    updatedAt,
    cities: sortChinese([...cities]),
    provinces: sortChinese([...provinces]),
    cityStats: formatCityStats(cityStats)
  };
}

function formatCityStats(cityStats) {
  return [...cityStats.values()]
    .map((item) => ({
      province: item.province,
      city: item.city,
      rowCount: item.rowCount,
      hotelCount: item.hotels.size,
      pricedRowCount: item.pricedRowCount,
      pricedHotelCount: item.pricedHotels.size,
      ...(item.minPrice ? { minPrice: item.minPrice } : {}),
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
      dateStats: formatDateStats(item.dateStats)
    }))
    .sort((a, b) => a.province.localeCompare(b.province, 'zh-CN') || a.city.localeCompare(b.city, 'zh-CN'));
}

function formatDateStats(dateStats) {
  return [...dateStats.values()]
    .map((item) => ({
      ...(item.checkIn ? { checkIn: item.checkIn } : {}),
      ...(item.checkOut ? { checkOut: item.checkOut } : {}),
      rowCount: item.rowCount,
      hotelCount: item.hotels.size,
      pricedRowCount: item.pricedRowCount,
      pricedHotelCount: item.pricedHotels.size,
      ...(item.minPrice ? { minPrice: item.minPrice } : {}),
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {})
    }))
    .sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || ''))
      || String(a.checkOut || '').localeCompare(String(b.checkOut || '')));
}

function getHotelKey(row, location, index) {
  const masterHotelId = normalizeIdentifier(pick(row, 'masterHotelId'));
  if (masterHotelId) return `master:${masterHotelId}`;
  const id = normalizeIdentifier(pick(row, 'id'));
  if (id) return `id:${id}`;
  const name = normalizeIdentifier(pick(row, 'name'));
  const address = normalizeIdentifier(pick(row, 'address'));
  if (name) return `${location.province}|${location.city}|${name}|${address}`;
  return `row:${index}`;
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  const normalized = text
    .replace(/[年月]/g, '-')
    .replace(/日/g, '')
    .replace(/\//g, '-')
    .replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizePrice(value) {
  if (value === undefined || value === null || value === '') return 0;
  const text = String(value).replace(/,/g, '').trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const price = Number(match[0]);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function minPositivePrice(current, next) {
  const price = Number(next || 0);
  if (!Number.isFinite(price) || price <= 0) return current || 0;
  if (!current) return price;
  return price < current ? price : current;
}

function maxTimestamp(current, next) {
  if (!next) return current || '';
  if (!current) return next;
  return next > current ? next : current;
}

function parseBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (['false', '0', 'no', 'n', '不可售', '无房', '售罄', '下架', 'closed', 'unavailable', 'soldout'].includes(normalized)) return false;
  return true;
}

export function normalizeInventoryLocation(cityValue, provinceValue) {
  const rawCity = String(cityValue || '').trim();
  const rawProvince = String(provinceValue || '').trim();
  const explicitProvince = findProvince(rawProvince) || findProvince(rawCity) || '';
  const exactCity = findExactCity(rawCity);
  const embeddedCity = exactCity || findEmbeddedCity(rawCity);
  const city = embeddedCity?.city || normalizeDestinationInput(rawCity);
  const province = explicitProvince || embeddedCity?.province || '';

  return {
    city: findProvince(city) && !embeddedCity ? '' : city,
    province
  };
}

function findEmbeddedCity(value) {
  const normalized = normalizeDestinationInput(value);
  if (!normalized || findProvince(normalized)) return null;
  return cityCatalog.find((item) => normalized.includes(item.city)) || null;
}

function findExactCity(value) {
  const normalized = normalizeDestinationInput(value);
  return cityCatalog.find((item) => item.city === normalized) || null;
}

function findCityProvince(city) {
  return cityCatalog.find((item) => item.city === city)?.province || '';
}

function findProvince(value) {
  const normalized = normalizeDestinationInput(value);
  if (!normalized) return '';
  return [...new Set(cityCatalog.map((item) => item.province))]
    .find((province) => province === normalized) || '';
}

function normalizeDestinationInput(value) {
  return String(value || '')
    .trim()
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/[省市]$/, '');
}

export function pick(row, field) {
  for (const key of fieldAliases[field] || [field]) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return undefined;
}

function formatManifestUrl(filePath, publicDir, baseUrl = '') {
  const relativePath = relative(publicDir, filePath).split(sep).join('/');
  const cleanPath = relativePath.startsWith('..') ? basename(filePath) : relativePath;
  if (!baseUrl) return cleanPath;
  return new URL(cleanPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
}

function formatSourceName(filePath) {
  return basename(filePath, extname(filePath)).replace(/[-_]+/g, ' ');
}

export function sortChinese(values) {
  return values.filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.inputDir = argv[++index];
    else if (arg === '--output') options.outputPath = argv[++index];
    else if (arg === '--public-dir') options.publicDir = argv[++index];
    else if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/build-inventory-manifest.js [options]

Options:
  --input <dir>       Inventory shard directory. Default: public/inventory
  --output <file>     Manifest file. Default: public/hotel-inventory.manifest.json
  --public-dir <dir>  Public web root used for relative URLs. Default: public
  --base-url <url>    Optional absolute URL prefix for generated source URLs
`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const manifest = await buildInventoryManifest(options);
      console.log(`Wrote ${manifest.sources.length} inventory sources.`);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  applyFilters,
  cityCatalog,
  findCity,
  findProvince,
  getNightCount,
  normalizeDestinationInput
} from '../hotel-data.js';

const defaultImage = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80';
const maxImportBytes = 8 * 1024 * 1024;
const defaultRemoteMaxBytes = 12 * 1024 * 1024;
const defaultRemoteTimeoutMs = 8_000;
const defaultInventoryCacheSeconds = 60;
const allowedImportExtensions = new Set(['.csv', '.json', '.jsonl', '.ndjson']);
const allowedInventoryFormats = new Set(['.csv', '.json', '.jsonl', '.ndjson', '.csv.gz', '.json.gz', '.jsonl.gz', '.ndjson.gz']);
const gzipFormats = new Set(['.csv.gz', '.json.gz', '.jsonl.gz', '.ndjson.gz']);
const sensitiveQueryPattern = /(token|key|secret|signature|sign|auth|access|password)/i;
const inventoryCache = new Map();
const inventoryCollectionKeys = ['hotels', 'items', 'data', 'results', 'records', 'list', '酒店列表', '酒店'];
const nestedRoomKeys = ['rooms', 'roomTypes', 'roomList', '房型', '房型列表', '房间'];
const nestedRateKeys = ['rates', 'offers', 'prices', 'roomRates', 'plans', 'products', '报价', '报价列表', '价格', '价格列表', '价格计划'];
const nestedCollectionKeys = new Set([...inventoryCollectionKeys, ...nestedRoomKeys, ...nestedRateKeys]);
const fieldAliases = {
  id: ['id', 'hotelId', 'hotel_id', '酒店ID', '酒店编号', '供应商酒店ID'],
  name: ['name', 'hotelName', 'hotel_name', '酒店名称', '酒店名', '酒店', '名称'],
  province: ['province', '省份', '省', '地区省份'],
  city: ['city', 'destination', '目的地', '城市', '市'],
  district: ['district', 'businessDistrict', 'business_district', '行政区', '区县', '区域', '商圈'],
  address: ['address', '酒店地址', '地址', '详细地址'],
  star: ['star', 'starRating', 'star_rating', '星级', '酒店星级', '挂牌星级'],
  rating: ['rating', 'score', '评分', '用户评分', '点评分'],
  reviews: ['reviews', 'commentCount', 'reviewCount', '点评数', '评论数', '评价数'],
  price: ['price', 'lowestPrice', 'dailyPrice', 'salePrice', 'roomPrice', '最低价', '价格', '日价', '房价', '售卖价', '含税价'],
  totalPrice: ['totalPrice', 'amount', 'totalAmount', '总价', '合计价', '订单金额'],
  originalPrice: ['originalPrice', 'marketPrice', 'rackRate', '门市价', '原价', '划线价'],
  currency: ['currency', '币种', '货币'],
  amenities: ['amenities', 'facilities', '设施', '酒店设施', '服务设施'],
  tags: ['tags', '标签', '卖点', '推荐标签'],
  image: ['image', 'imageUrl', 'coverImage', '图片', '图片链接', '封面图'],
  payment: ['payment', 'paymentType', '支付方式', '付款方式'],
  cancellation: ['cancellation', 'cancelPolicy', '取消政策', '退改政策'],
  providerName: ['source', 'provider', 'supplier', '供应商', '渠道', '来源'],
  checkIn: ['checkIn', 'startDate', '入住日期', '入住', '可售开始日期', '开始日期'],
  checkOut: ['checkOut', 'endDate', '离店日期', '离店', '可售结束日期', '结束日期'],
  available: ['available', 'isAvailable', '可售', '是否可售', '库存状态', '状态'],
  bookingUrl: ['bookingUrl', 'url', '预订链接', '下单链接', '详情页', '链接'],
  roomName: ['style', 'roomName', 'rateName', '房型', '房型名称', '价格计划', '报价名称']
};

export function getLocalInventoryPath() {
  return getLocalInventoryPaths()[0];
}

export function getLocalInventoryPaths() {
  const configured = [
    process.env.HOTEL_DATA_FILES,
    process.env.HOTEL_DATA_FILE
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[,;]/))
    .map((value) => value.trim())
    .filter(Boolean);

  return (configured.length ? configured : ['data/hotel-prices.json']).map((filePath) => resolve(filePath));
}

export function getRemoteInventoryUrls() {
  return [
    process.env.HOTEL_DATA_URLS,
    process.env.HOTEL_DATA_URL
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\n,;]/))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function clearInventoryCache() {
  inventoryCache.clear();
}

export async function getLocalInventoryStatus() {
  const importedFiles = await listImportedInventoryFiles();
  const remoteUrls = getRemoteInventoryUrls();
  const filePaths = unique([...getLocalInventoryPaths(), ...importedFiles.map((file) => file.filePath)]);
  const files = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const info = await stat(filePath);
      return {
        filePath,
        readable: info.isFile(),
        size: info.size,
        updatedAt: info.mtime.toISOString(),
        mtimeMs: info.mtimeMs
      };
    } catch {
      return { filePath, readable: false };
    }
  }));
  const readableFiles = files.filter((file) => file.readable);

  return {
    configured: Boolean(process.env.HOTEL_DATA_FILE || process.env.HOTEL_DATA_FILES || remoteUrls.length || importedFiles.length),
    readable: readableFiles.length > 0 || remoteUrls.length > 0,
    filePath: filePaths[0],
    filePaths,
    fileCount: filePaths.length,
    readableCount: readableFiles.length + remoteUrls.length,
    remoteCount: remoteUrls.length,
    remoteInventory: {
      configured: remoteUrls.length > 0,
      urlCount: remoteUrls.length,
      urls: remoteUrls.map(redactRemoteUrl),
      timeoutMs: getRemoteTimeoutMs(),
      maxBytes: getRemoteMaxBytes(),
      cacheSeconds: getInventoryCacheSeconds()
    },
    importedCount: importedFiles.length,
    importsDir: getImportDir(),
    importedFiles,
    files
  };
}

export async function listImportedInventoryFiles() {
  const importDir = getImportDir();
  try {
    const entries = await readdir(importDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && allowedImportExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(importDir, entry.name));

    return Promise.all(files.map(async (filePath) => {
      const info = await stat(filePath);
      return {
        filename: basename(filePath),
        filePath,
        size: info.size,
        updatedAt: info.mtime.toISOString()
      };
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveImportedInventoryFile({ filename, content }) {
  const safeName = sanitizeImportFilename(filename);
  const extension = extname(safeName).toLowerCase();
  if (!allowedImportExtensions.has(extension)) {
    throw new Error('仅支持 .csv、.json、.jsonl 或 .ndjson 酒店价格文件。');
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('文件内容不能为空。');
  }
  if (Buffer.byteLength(content, 'utf8') > maxImportBytes) {
    throw new Error('单个导入文件不能超过 8MB。');
  }

  const rows = parseInventory(content, extension);
  if (!rows.length) {
    throw new Error('没有识别到酒店价格记录。');
  }

  const importDir = getImportDir();
  await mkdir(importDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const targetPath = join(importDir, `${stamp}-${safeName}`);
  await writeFile(targetPath, content, 'utf8');
  const info = await stat(targetPath);

  return {
    filename: basename(targetPath),
    filePath: targetPath,
    rowCount: rows.length,
    size: info.size,
    updatedAt: info.mtime.toISOString()
  };
}

export async function searchLocalInventory(params) {
  const status = await getLocalInventoryStatus();
  if (!status.readable) {
    return { hotels: [], status };
  }

  const inventory = await loadInventorySources(status);

  return {
    hotels: searchInventoryRows(inventory.rows, params),
    status: { ...inventory.status, coverage: buildInventoryCoverage(inventory.rows) },
    rowCount: inventory.rows.length,
    sourceCount: inventory.sourceCount
  };
}

export async function getLocalInventoryCoverage(status = null) {
  const inventoryStatus = status || await getLocalInventoryStatus();
  if (!inventoryStatus.readable) {
    return buildInventoryCoverage([]);
  }
  const inventory = await loadInventorySources(inventoryStatus);
  return {
    ...buildInventoryCoverage(inventory.rows),
    sourceCount: inventory.sourceCount,
    sourceErrors: inventory.sourceErrors
  };
}

export function parseInventory(raw, extension = '.json') {
  if (extension === '.csv') return parseCsv(raw);
  if (extension === '.jsonl' || extension === '.ndjson') return parseJsonLines(raw);
  const parsed = JSON.parse(raw);
  return flattenInventoryDocument(parsed);
}

export function searchInventoryRows(rows, params, options = {}) {
  const sourceLabel = options.sourceLabel || '';
  const source = options.source || 'local';
  const nights = getNightCount(params.checkIn, params.checkOut);
  const normalized = rows
    .map((row, index) => normalizeHotel({
      ...row,
      __inventoryFile: row.__inventoryFile || sourceLabel
    }, index, nights, { source, sourceLabel }))
    .filter((hotel) => isAvailableForDates(hotel, params));
  const merged = mergeHotelRates(filterByDestination(normalized, params), source);
  return applyFilters(merged, params);
}

function sanitizeImportFilename(filename) {
  const original = basename(String(filename || 'hotel-prices.csv'));
  const extension = extname(original).toLowerCase() || '.csv';
  const stem = basename(original, extname(original))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'hotel-prices';
  return `${stem}${extension}`;
}

function getImportDir() {
  return resolve(process.env.HOTEL_IMPORT_DIR || 'data/imports');
}

async function loadInventorySources(status) {
  const readableFiles = status.files.filter((file) => file.readable);
  const loadedFiles = await Promise.all(readableFiles.map(readInventoryFile));
  const remoteLoads = await Promise.allSettled(getRemoteInventoryUrls().map(readRemoteInventoryUrl));
  const loadedRemote = remoteLoads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = remoteLoads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '远程供应商文件读取失败。');
  const loaded = [...loadedFiles, ...loadedRemote];
  const rows = loaded.flatMap((file) =>
    file.rows.map((row) => ({
      ...row,
      __inventoryFile: file.sourceLabel || file.filePath
    }))
  );

  return {
    loaded,
    rows,
    sourceCount: loaded.length,
    sourceErrors,
    status: { ...status, sourceErrors }
  };
}

function buildInventoryCoverage(rows) {
  const normalized = rows
    .map((row, index) => normalizeHotel(row, index, 1))
    .filter((hotel) => hotel.available && hotel.city);
  const mergedHotels = mergeHotelRates(normalized);
  const citySet = new Set(normalized.map((hotel) => hotel.city));
  const provinceSet = new Set(normalized.map((hotel) => hotel.province).filter(Boolean));
  const coveredCityItems = cityCatalog.filter((city) => citySet.has(city.city));
  const coveredCitySet = new Set(coveredCityItems.map((city) => city.city));
  const coveredProvinceSet = new Set(coveredCityItems.map((city) => city.province));
  const totalProvinces = new Set(cityCatalog.map((city) => city.province)).size;
  const rowCountByCity = countBy(normalized.map((hotel) => hotel.city));
  const hotelCountByCity = countBy(mergedHotels.map((hotel) => hotel.city));
  const sourcesByCity = groupSourcesByCity(normalized);
  const cityCoverage = cityCatalog.map(({ province, city }) => ({
    province,
    city,
    covered: coveredCitySet.has(city),
    rowCount: rowCountByCity.get(city) || 0,
    hotelCount: hotelCountByCity.get(city) || 0,
    sourceCount: sourcesByCity.get(city)?.length || 0,
    sources: sourcesByCity.get(city) || []
  }));
  const missingCities = cityCatalog
    .filter((city) => !coveredCitySet.has(city.city))
    .map(({ province, city }) => ({ province, city }));
  const provinceCoverage = [...new Set(cityCatalog.map((city) => city.province))].map((province) => {
    const provinceCities = cityCatalog.filter((city) => city.province === province);
    const covered = provinceCities.filter((city) => coveredCitySet.has(city.city));
    return {
      province,
      coveredCities: covered.length,
      totalCities: provinceCities.length,
      coverageRatio: provinceCities.length ? Number((covered.length / provinceCities.length).toFixed(4)) : 0,
      missingCities: provinceCities.filter((city) => !coveredCitySet.has(city.city)).map((city) => city.city)
    };
  });

  return {
    rowCount: rows.length,
    hotelCount: mergedHotels.length,
    coveredCities: coveredCitySet.size,
    totalCities: cityCatalog.length,
    coverageRatio: cityCatalog.length ? Number((coveredCitySet.size / cityCatalog.length).toFixed(4)) : 0,
    coveredProvinces: coveredProvinceSet.size || provinceSet.size,
    totalProvinces,
    cityCoverage,
    missingCities,
    sourceCoverage: buildSourceCoverage(normalized),
    provinceCoverage
  };
}

function groupSourcesByCity(hotels) {
  const citySources = new Map();
  hotels.forEach((hotel) => {
    if (!hotel.city) return;
    const sources = citySources.get(hotel.city) || [];
    citySources.set(hotel.city, unique([...sources, hotel.providerName || hotel.sourceFile || '未知供应商']));
  });
  return citySources;
}

function buildSourceCoverage(hotels) {
  const totalProvinces = new Set(cityCatalog.map((city) => city.province)).size;
  const bySource = new Map();
  hotels.forEach((hotel) => {
    const sourceName = hotel.providerName || hotel.sourceFile || '未知供应商';
    bySource.set(sourceName, [...(bySource.get(sourceName) || []), hotel]);
  });

  return [...bySource.entries()].map(([sourceName, sourceHotels]) => {
    const citySet = new Set(sourceHotels.map((hotel) => hotel.city).filter(Boolean));
    const coveredCities = cityCatalog.filter((city) => citySet.has(city.city));
    const provinceSet = new Set(coveredCities.map((city) => city.province));
    return {
      sourceName,
      rowCount: sourceHotels.length,
      hotelCount: mergeHotelRates(sourceHotels).length,
      coveredCities: coveredCities.length,
      totalCities: cityCatalog.length,
      coverageRatio: cityCatalog.length ? Number((coveredCities.length / cityCatalog.length).toFixed(4)) : 0,
      coveredProvinces: provinceSet.size,
      totalProvinces,
      missingCities: cityCatalog
        .filter((city) => !citySet.has(city.city))
        .map(({ province, city }) => ({ province, city }))
    };
  }).sort((a, b) => b.coveredCities - a.coveredCities || b.hotelCount - a.hotelCount || a.sourceName.localeCompare(b.sourceName, 'zh-CN'));
}

function countBy(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
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
  const rooms = getFirstArray(record, nestedRoomKeys);
  const directRates = getFirstArray(record, nestedRateKeys);

  if (rooms.length) {
    const rows = rooms.flatMap((room) => {
      if (!room || typeof room !== 'object') return [];
      const roomRates = getFirstArray(room, nestedRateKeys);
      if (roomRates.length) {
        return roomRates.map((rate) => mergeInventoryParts(record, room, rate));
      }
      return [mergeInventoryParts(record, room, null)];
    });
    if (rows.length) return rows;
  }

  if (directRates.length) {
    return directRates.map((rate) => mergeInventoryParts(record, null, rate));
  }

  return [stripNestedCollections(record)];
}

function mergeInventoryParts(hotel, room, rate) {
  const hotelFields = stripNestedCollections(hotel || {});
  const roomFields = stripNestedCollections(room || {});
  const rateFields = stripNestedCollections(rate || {});
  const row = { ...hotelFields, ...roomFields, ...rateFields };
  const roomName = pickFromParts([roomFields], 'roomName') || pickFromParts([roomFields], 'name');
  const rateName = pickFromParts([rateFields], 'roomName') || pickFromParts([rateFields], 'name');

  row.id = pickFromParts([hotelFields, row], 'id') || row.id;
  row.name = pickFromParts([hotelFields, row], 'name') || row.name;
  row.roomName = formatRoomRateName(roomName, rateName) || row.roomName;
  row.amenities = unique([
    ...splitList(pickFromParts([hotelFields], 'amenities')),
    ...splitList(pickFromParts([roomFields], 'amenities')),
    ...splitList(pickFromParts([rateFields], 'amenities'))
  ]);
  row.tags = unique([
    ...splitList(pickFromParts([hotelFields], 'tags')),
    ...splitList(pickFromParts([roomFields], 'tags')),
    ...splitList(pickFromParts([rateFields], 'tags'))
  ]);

  return row;
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

function pickFromParts(parts, field) {
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const value = pick(part, field);
    if (value !== undefined) return value;
  }
  return undefined;
}

function formatRoomRateName(roomName, rateName) {
  if (roomName && rateName && roomName !== rateName) return `${roomName} · ${rateName}`;
  return rateName || roomName || '';
}

async function readInventoryFile(file) {
  const cacheKey = `file:${file.filePath}`;
  const cached = inventoryCache.get(cacheKey);
  if (cached?.size === file.size && cached?.mtimeMs === file.mtimeMs) {
    return { ...file, sourceLabel: file.filePath, rows: cached.rows, cache: 'hit' };
  }

  const raw = await readFile(file.filePath);
  const { text, format } = decodeInventoryContent(raw, file.filePath);
  const rows = parseInventory(text, format);
  inventoryCache.set(cacheKey, {
    type: 'file',
    size: file.size,
    mtimeMs: file.mtimeMs,
    rows,
    cachedAt: Date.now()
  });
  return { ...file, sourceLabel: file.filePath, rows, cache: 'miss' };
}

async function readRemoteInventoryUrl(url) {
  const cacheKey = `remote:${url}`;
  const cached = inventoryCache.get(cacheKey);
  const cacheTtlMs = getInventoryCacheSeconds() * 1000;
  if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
    return {
      filePath: url,
      sourceLabel: redactRemoteUrl(url),
      readable: true,
      rows: cached.rows,
      cache: 'hit',
      cachedAt: new Date(cached.cachedAt).toISOString()
    };
  }

  const response = await fetch(url, {
    headers: getRemoteInventoryHeaders(),
    signal: AbortSignal.timeout(getRemoteTimeoutMs())
  });
  if (!response.ok) {
    throw new Error(`${redactRemoteUrl(url)} 返回 HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  const maxBytes = getRemoteMaxBytes();
  if (contentLength > maxBytes) {
    throw new Error(`${redactRemoteUrl(url)} 文件超过 ${formatBytes(maxBytes)} 限制。`);
  }

  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.byteLength > maxBytes) {
    throw new Error(`${redactRemoteUrl(url)} 文件超过 ${formatBytes(maxBytes)} 限制。`);
  }

  const contentType = response.headers.get('content-type') || '';
  const contentEncoding = response.headers.get('content-encoding') || '';
  const { text, format } = decodeInventoryContent(raw, url, contentType, contentEncoding);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`${redactRemoteUrl(url)} 解压后文件超过 ${formatBytes(maxBytes)} 限制。`);
  }
  return {
    filePath: url,
    sourceLabel: redactRemoteUrl(url),
    readable: true,
    rows: cacheRemoteRows(cacheKey, parseInventory(text, format)),
    cache: 'miss'
  };
}

function cacheRemoteRows(cacheKey, rows) {
  inventoryCache.set(cacheKey, {
    type: 'remote',
    rows,
    cachedAt: Date.now()
  });
  return rows;
}

function getRemoteInventoryHeaders() {
  if (!process.env.HOTEL_DATA_URL_HEADERS) return {};
  const parsed = JSON.parse(process.env.HOTEL_DATA_URL_HEADERS);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('HOTEL_DATA_URL_HEADERS 必须是 JSON 对象。');
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function decodeInventoryContent(buffer, source, contentType = '', contentEncoding = '') {
  const format = getInventoryFormat(source, contentType);
  const shouldGunzip = gzipFormats.has(format) || contentEncoding.toLowerCase().includes('gzip');
  const decoded = shouldGunzip && isGzipBuffer(buffer) ? gunzipSync(buffer) : buffer;
  return {
    text: decoded.toString('utf8'),
    format: normalizeInventoryFormat(format)
  };
}

function getInventoryFormat(source, contentType = '') {
  const path = getInventoryPathname(source);
  const loweredPath = path.toLowerCase();
  for (const format of allowedInventoryFormats) {
    if (loweredPath.endsWith(format)) return format;
  }

  const loweredType = contentType.toLowerCase();
  if (loweredType.includes('ndjson') || loweredType.includes('jsonl')) return '.jsonl';
  if (loweredType.includes('csv')) return '.csv';
  if (loweredType.includes('json')) return '.json';
  return '.json';
}

function getInventoryPathname(source) {
  try {
    return new URL(source).pathname;
  } catch {
    return String(source || '');
  }
}

function normalizeInventoryFormat(format) {
  return gzipFormats.has(format) ? format.replace(/\.gz$/, '') : format;
}

function isGzipBuffer(buffer) {
  return buffer?.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function getRemoteTimeoutMs() {
  return getPositiveInteger(process.env.HOTEL_DATA_URL_TIMEOUT_MS, defaultRemoteTimeoutMs);
}

function getRemoteMaxBytes() {
  return getPositiveInteger(process.env.HOTEL_DATA_URL_MAX_BYTES, defaultRemoteMaxBytes);
}

function getInventoryCacheSeconds() {
  return getPositiveInteger(process.env.HOTEL_DATA_CACHE_SECONDS, defaultInventoryCacheSeconds);
}

function getPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function redactRemoteUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryPattern.test(key)) {
        url.searchParams.set(key, 'REDACTED');
      }
    }
    return url.toString();
  } catch {
    return String(value);
  }
}

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function normalizeInventoryLocation(cityValue, provinceValue) {
  const rawCity = String(cityValue || '').trim();
  const rawProvince = String(provinceValue || '').trim();
  const explicitProvince = findProvince(rawProvince) || findProvince(rawCity) || '';
  const exactCity = findExactInventoryCity(rawCity);
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

function findExactInventoryCity(value) {
  const normalized = normalizeDestinationInput(value);
  return cityCatalog.find((item) => item.city === normalized) || null;
}

function normalizeHotel(row, index, nights, options = {}) {
  const price = parseMoney(pick(row, 'price'));
  const totalPrice = parseMoney(pick(row, 'totalPrice')) || price * nights;
  const star = Number(pick(row, 'star') || 0) || null;
  const location = normalizeInventoryLocation(pick(row, 'city'), pick(row, 'province'));
  const amenities = splitList(pick(row, 'amenities'));
  const tags = splitList(pick(row, 'tags'));
  const providerName = pick(row, 'providerName') || options.sourceLabel || basename(row.__inventoryFile || '本地供应商文件');
  const roomName = pick(row, 'roomName') || '供应商库存';
  const source = options.source || 'local';

  return {
    id: pick(row, 'id') || `local-${index}`,
    name: pick(row, 'name') || '未命名酒店',
    city: location.city,
    province: location.province,
    district: pick(row, 'district') || '',
    address: pick(row, 'address') || '',
    star,
    style: roomName,
    rating: Number(pick(row, 'rating') || 0) || null,
    reviews: Number(pick(row, 'reviews') || 0) || null,
    price,
    totalPrice,
    nights,
    originalPrice: parseMoney(pick(row, 'originalPrice')) || null,
    currency: pick(row, 'currency') || 'CNY',
    distance: row.distance || row['距离'] || null,
    amenities,
    tags: tags.length ? tags : ['真实库存'],
    image: pick(row, 'image') || defaultImage,
    payment: pick(row, 'payment') || '预订前确认',
    cancellation: pick(row, 'cancellation') || '预订前确认',
    source,
    providerName,
    checkIn: normalizeDate(pick(row, 'checkIn')),
    checkOut: normalizeDate(pick(row, 'checkOut')),
    available: pick(row, 'available') === undefined ? true : parseBoolean(pick(row, 'available')),
    bookingUrl: pick(row, 'bookingUrl') || '',
    sourceFile: row.__inventoryFile || '',
    rates: [{
      providerName,
      roomName,
      price,
      totalPrice,
      currency: pick(row, 'currency') || 'CNY',
      payment: pick(row, 'payment') || '预订前确认',
      cancellation: pick(row, 'cancellation') || '预订前确认',
      bookingUrl: pick(row, 'bookingUrl') || ''
    }]
  };
}

function pick(row, field) {
  for (const key of fieldAliases[field] || [field]) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return undefined;
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})[年/.-]?(\d{1,2})[月/.-]?(\d{1,2})/);
  if (!match) return raw;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function mergeHotelRates(hotels, source = 'local') {
  const merged = new Map();

  hotels.forEach((hotel) => {
    const key = getHotelKey(hotel);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...hotel,
        rates: [...hotel.rates],
        providerNames: [hotel.providerName],
        offerCount: 1
      });
      return;
    }

    existing.rates.push(...hotel.rates);
    existing.providerNames = unique([...existing.providerNames, hotel.providerName]);
    existing.amenities = unique([...(existing.amenities || []), ...(hotel.amenities || [])]);
    existing.tags = unique([...(existing.tags || []), ...(hotel.tags || [])]);
    existing.offerCount = existing.rates.length;
    if (hotel.rating && (!existing.rating || hotel.rating > existing.rating)) existing.rating = hotel.rating;
    if (hotel.reviews && (!existing.reviews || hotel.reviews > existing.reviews)) existing.reviews = hotel.reviews;
    if (hotel.price > 0 && (!existing.price || hotel.price < existing.price)) {
      existing.price = hotel.price;
      existing.totalPrice = hotel.totalPrice;
      existing.currency = hotel.currency;
      existing.payment = hotel.payment;
      existing.cancellation = hotel.cancellation;
      existing.bookingUrl = hotel.bookingUrl;
      existing.providerName = hotel.providerName;
      existing.style = hotel.style;
    }
  });

  return [...merged.values()].map((hotel) => {
    const rates = hotel.rates
      .filter((rate) => rate.price > 0)
      .sort((a, b) => a.price - b.price);
    const providerNames = unique(rates.map((rate) => rate.providerName));
    return {
      ...hotel,
      rates,
      providerNames,
      offerCount: rates.length,
      tags: unique([...(hotel.tags || []), rates.length > 1 ? `${rates.length} 个报价` : '真实库存']),
      source
    };
  });
}

function getHotelKey(hotel) {
  const locationKey = [
    hotel.province,
    hotel.city,
    hotel.name,
    hotel.address || hotel.district
  ]
    .map((value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ''))
    .join('|');
  if (hotel.name && hotel.city && (hotel.address || hotel.district)) return `place:${locationKey}`;

  const stableId = String(hotel.id || '').trim();
  if (stableId && !stableId.startsWith('local-')) return `id:${stableId}`;
  return `fallback:${locationKey}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function filterByDestination(hotels, params) {
  if (!params.city) return hotels;
  const city = findCity(params.city)?.city || '';
  const province = findProvince(params.city) || '';
  const normalized = normalizeDestinationInput(params.city);
  return hotels.filter((hotel) =>
    (city && hotel.city === city) ||
    (province && hotel.province === province) ||
    hotel.city === normalized ||
    hotel.province === normalized
  );
}

function isAvailableForDates(hotel, params) {
  if (!hotel.available) return false;
  if (!hotel.checkIn && !hotel.checkOut) return true;
  if (hotel.checkIn && hotel.checkOut) {
    return hotel.checkIn <= params.checkIn && hotel.checkOut >= params.checkOut;
  }
  if (hotel.checkIn) return hotel.checkIn === params.checkIn;
  return hotel.checkOut === params.checkOut;
}

function splitList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[|,，、;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'no', '否', '不可用', '无房', '满房', '停售', '下架'].includes(String(value).trim().toLowerCase());
}

function parseCsv(raw) {
  const rows = raw.trim().split(/\r?\n/);
  if (rows.length < 2) return [];
  const headers = splitCsvLine(rows[0]).map((header) => header.trim());
  return rows.slice(1).filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function parseJsonLines(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => flattenInventoryDocument(JSON.parse(line)));
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

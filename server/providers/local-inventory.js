import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseXlsxInventory } from '../../scripts/xlsx-inventory.js';
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
const defaultInventoryStaleCacheSeconds = 0;
const allowedImportExtensions = new Set(['.csv', '.json', '.jsonl', '.ndjson', '.xlsx']);
const allowedInventoryFormats = new Set(['.csv', '.json', '.jsonl', '.ndjson', '.xlsx', '.csv.gz', '.json.gz', '.jsonl.gz', '.ndjson.gz', '.xlsx.gz']);
const gzipFormats = new Set(['.csv.gz', '.json.gz', '.jsonl.gz', '.ndjson.gz', '.xlsx.gz']);
const sensitiveQueryPattern = /(token|key|secret|signature|sign|auth|access|password)/i;
const inventoryCache = new Map();
const inventoryCollectionKeys = ['hotels', 'items', 'data', 'results', 'records', 'list', '酒店列表', '酒店'];
const nestedRoomKeys = ['rooms', 'roomTypes', 'roomList', '房型', '房型列表', '房间'];
const nestedRateKeys = ['rates', 'offers', 'prices', 'roomRates', 'plans', 'products', '报价', '报价列表', '价格', '价格列表', '价格计划'];
const nestedCollectionKeys = new Set([...inventoryCollectionKeys, ...nestedRoomKeys, ...nestedRateKeys]);
const fieldAliases = {
  id: ['id', 'hotelId', 'hotel_id', 'offerId', 'offer_id', 'productId', 'product_id', 'roomTypeId', 'room_type_id', '酒店ID', '酒店编号', '供应商酒店ID', '报价ID', '报价编号', '产品ID', '产品编号', '房型ID', '房型编号'],
  masterHotelId: ['masterHotelId', 'master_hotel_id', 'standardHotelId', 'standard_hotel_id', 'canonicalHotelId', 'canonical_hotel_id', 'unifiedHotelId', 'unified_hotel_id', 'globalHotelId', 'global_hotel_id', '标准ID', '统一ID', '酒店标准ID', '统一酒店ID', '标准酒店ID', '主酒店ID'],
  name: ['name', 'hotelName', 'hotel_name', 'title', 'hotelTitle', 'hotel_title', '酒店名称', '酒店名', '酒店', '名称', '酒店中文名'],
  province: ['province', 'provinceName', 'province_name', '省份', '省', '省份名称', '地区省份'],
  city: ['city', 'cityName', 'city_name', 'destination', 'destinationCity', 'destination_city', '目的地', '目的地城市', '城市', '城市名称', '市'],
  district: ['district', 'businessDistrict', 'business_district', 'areaName', 'area_name', '行政区', '区县', '区域', '商圈'],
  address: ['address', 'hotelAddress', 'hotel_address', 'location', '酒店地址', '地址', '详细地址'],
  star: ['star', 'starRating', 'star_rating', 'stars', '星级', '酒店星级', '挂牌星级'],
  rating: ['rating', 'score', 'reviewScore', 'review_score', '评分', '用户评分', '点评分'],
  reviews: ['reviews', 'commentCount', 'comment_count', 'reviewCount', 'review_count', '点评数', '评论数', '评价数'],
  price: ['price', 'lowestPrice', 'lowest_price', 'dailyPrice', 'daily_price', 'salePrice', 'sale_price', 'sellPrice', 'sell_price', 'sellingPrice', 'selling_price', 'roomPrice', 'room_price', '最低价', '价格', '日价', '房价', '售卖价', '销售价', '售价', '含税价'],
  totalPrice: ['totalPrice', 'total_price', 'amount', 'totalAmount', 'total_amount', 'orderAmount', 'order_amount', '总价', '合计价', '订单金额', '订单总价', '总金额'],
  originalPrice: ['originalPrice', 'original_price', 'marketPrice', 'market_price', 'rackRate', 'rack_rate', '门市价', '原价', '划线价'],
  currency: ['currency', 'currencyCode', 'currency_code', '币种', '货币'],
  amenities: ['amenities', 'facilities', 'facilityNames', 'facility_names', '设施', '酒店设施', '服务设施'],
  tags: ['tags', 'labels', '标签', '卖点', '推荐标签'],
  image: ['image', 'imageUrl', 'image_url', 'coverImage', 'cover_image', '图片', '图片链接', '封面图'],
  payment: ['payment', 'paymentType', 'payment_type', 'payType', 'pay_type', '支付方式', '付款方式'],
  cancellation: ['cancellation', 'cancelPolicy', 'cancel_policy', 'cancellationPolicy', 'cancellation_policy', '取消政策', '退改政策'],
  providerName: ['source', 'sourceName', 'source_name', 'provider', 'providerName', 'provider_name', 'supplier', 'supplierName', 'supplier_name', '供应商', '供应商名称', '渠道', '渠道名称', '来源', '数据源'],
  checkIn: ['checkIn', 'check_in', 'startDate', 'start_date', 'arrivalDate', 'arrival_date', '入住日期', '入住', '可售开始日期', '开始日期'],
  checkOut: ['checkOut', 'check_out', 'endDate', 'end_date', 'departureDate', 'departure_date', '离店日期', '离店', '可售结束日期', '结束日期'],
  available: ['available', 'isAvailable', 'is_available', 'inStock', 'in_stock', 'stock', '可售', '是否可售', '有房', '可订', '库存状态', '售卖状态', '状态'],
  bookingUrl: ['bookingUrl', 'booking_url', 'bookUrl', 'book_url', 'url', '预订链接', '下单链接', '详情页', '链接'],
  roomName: ['style', 'roomName', 'room_name', 'rateName', 'rate_name', 'planName', 'plan_name', '房型', '房型名称', '价格计划', '报价名称']
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

export function getRemoteInventoryManifestUrls() {
  return [
    process.env.HOTEL_DATA_MANIFEST_URLS,
    process.env.HOTEL_DATA_MANIFEST_URL
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\n,;]/))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getRemoteInventoryConfigSources() {
  if (!process.env.HOTEL_DATA_MANIFEST_CONFIG) return [];
  return parseRemoteInventoryConfigSources(process.env.HOTEL_DATA_MANIFEST_CONFIG);
}

export function clearInventoryCache() {
  inventoryCache.clear();
}

export async function getLocalInventoryStatus() {
  const importedFiles = await listImportedInventoryFiles();
  const remoteUrls = getRemoteInventoryUrls();
  const remoteManifestUrls = getRemoteInventoryManifestUrls();
  const remoteConfigSources = getRemoteInventoryConfigSources();
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
    configured: Boolean(process.env.HOTEL_DATA_FILE || process.env.HOTEL_DATA_FILES || remoteUrls.length || remoteManifestUrls.length || remoteConfigSources.length || importedFiles.length),
    readable: readableFiles.length > 0 || remoteUrls.length > 0 || remoteManifestUrls.length > 0 || remoteConfigSources.length > 0,
    filePath: filePaths[0],
    filePaths,
    fileCount: filePaths.length,
    readableCount: readableFiles.length + remoteUrls.length + remoteManifestUrls.length + remoteConfigSources.length,
    remoteCount: remoteUrls.length + remoteManifestUrls.length + remoteConfigSources.length,
    remoteInventory: {
      configured: remoteUrls.length > 0 || remoteManifestUrls.length > 0 || remoteConfigSources.length > 0,
      urlCount: remoteUrls.length,
      manifestUrlCount: remoteManifestUrls.length,
      configSourceCount: remoteConfigSources.length,
      urls: remoteUrls.map(redactRemoteUrl),
      manifestUrls: remoteManifestUrls.map(redactRemoteUrl),
      timeoutMs: getRemoteTimeoutMs(),
      maxBytes: getRemoteMaxBytes(),
      cacheSeconds: getInventoryCacheSeconds(),
      staleCacheSeconds: getInventoryStaleCacheSeconds(),
      staleCacheConfigured: getInventoryStaleCacheSeconds() > 0,
      loadCount: 0,
      manifestCount: 0,
      okCount: 0,
      partialCount: 0,
      staleCount: 0,
      failedCount: 0,
      loadingCount: 0,
      loads: []
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

export async function saveImportedInventoryFile(payload = {}) {
  const { filename } = payload;
  const safeName = sanitizeImportFilename(filename);
  const extension = extname(safeName).toLowerCase();
  if (!allowedImportExtensions.has(extension)) {
    throw new Error('仅支持 .csv、.json、.jsonl、.ndjson 或 .xlsx 酒店价格文件。');
  }
  const normalizedPayload = normalizeImportPayload(payload, extension);
  if (normalizedPayload.size === 0) {
    throw new Error('文件内容不能为空。');
  }
  if (normalizedPayload.size > maxImportBytes) {
    throw new Error('单个导入文件不能超过 8MB。');
  }

  const rows = parseInventory(normalizedPayload.content, extension);
  if (!rows.length) {
    throw new Error('没有识别到酒店价格记录。');
  }

  const importDir = getImportDir();
  await mkdir(importDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const targetPath = join(importDir, `${stamp}-${safeName}`);
  await writeFile(targetPath, normalizedPayload.content, normalizedPayload.encoding);
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

export async function getLocalInventoryCoverage(status = null, params = {}) {
  const inventoryStatus = status || await getLocalInventoryStatus();
  if (!inventoryStatus.readable) {
    return buildInventoryCoverage([], params);
  }
  const inventory = await loadInventorySources(inventoryStatus);
  return {
    ...buildInventoryCoverage(inventory.rows, params),
    sourceCount: inventory.sourceCount,
    sourceErrors: inventory.sourceErrors,
    remoteInventory: inventory.status.remoteInventory
  };
}

export function parseInventory(raw, extension = '.json', options = {}) {
  const fieldMap = normalizeFieldMap(options.fieldMap || {});
  const mapRows = (rows) => rows.map((row) => mapInventoryRow(row, fieldMap));
  if (extension === '.xlsx') return mapRows(parseXlsxInventory(asBuffer(raw)));
  const content = asText(raw);
  if (extension === '.csv') return mapRows(parseCsv(content));
  if (extension === '.jsonl' || extension === '.ndjson') return mapRows(parseJsonLines(content));
  const parsed = JSON.parse(content);
  return mapRows(flattenInventoryDocument(parsed));
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
  const remoteTasks = [
    ...getRemoteInventoryUrls().map((url) => ({
      type: 'source',
      url,
      name: redactRemoteUrl(url),
      load: () => readRemoteInventoryUrl(url)
    })),
    ...getRemoteInventoryManifestUrls().map((url) => ({
      type: 'manifest',
      url,
      name: `${redactRemoteUrl(url)} 清单`,
      load: () => readRemoteInventoryManifestUrl(url)
    })),
    ...getRemoteInventoryConfigSources().map((source) => ({
      type: 'config-source',
      url: source.url,
      name: source.name,
      load: () => readRemoteInventoryUrl(source.url, {
        sourceName: source.name,
        fieldMap: source.fieldMap,
        headers: source.headers,
        type: 'config-source'
      })
    }))
  ];
  const remoteLoads = await Promise.allSettled(remoteTasks.map((task) => task.load()));
  const loadedRemote = remoteLoads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const remoteLoadDetails = remoteLoads.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value.remoteLoads || [result.value.remoteLoad].filter(Boolean);
    }
    return result.reason?.remoteLoads?.length
      ? result.reason.remoteLoads
      : [buildRemoteInventoryFailedLoad(remoteTasks[index], result.reason)];
  });
  const sourceErrors = [
    ...remoteLoads
      .filter((result) => result.status === 'rejected')
      .flatMap((result) => result.reason?.sourceErrors || [result.reason?.message || '远程供应商文件读取失败。']),
    ...loadedRemote.flatMap((source) => source.sourceErrors || [])
  ];
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
    sourceCount: loaded.reduce((sum, source) => sum + Number(source.sourceCount || 1), 0),
    sourceErrors,
    status: {
      ...status,
      sourceErrors,
      remoteInventory: buildRemoteInventoryStatus(status.remoteInventory, remoteLoadDetails)
    }
  };
}

function buildInventoryCoverage(rows, params = {}) {
  const dateFiltered = hasCoverageDates(params);
  const normalized = rows
    .map((row, index) => normalizeHotel(row, index, 1))
    .filter((hotel) => hotel.available && hotel.city)
    .filter((hotel) => !dateFiltered || isAvailableForDates(hotel, params));
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
    provinceCoverage,
    query: dateFiltered ? { checkIn: params.checkIn, checkOut: params.checkOut } : null
  };
}

function hasCoverageDates(params) {
  return Boolean(params?.checkIn && params?.checkOut);
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
  const { content, format } = decodeInventoryContent(raw, file.filePath);
  const rows = parseInventory(content, format);
  inventoryCache.set(cacheKey, {
    type: 'file',
    size: file.size,
    mtimeMs: file.mtimeMs,
    rows,
    cachedAt: Date.now()
  });
  return { ...file, sourceLabel: file.filePath, rows, cache: 'miss' };
}

async function readRemoteInventoryUrl(url, options = {}) {
  const fieldMap = normalizeFieldMap(options.fieldMap || {});
  const headers = normalizeRemoteHeaders(options.headers || {});
  const cacheKey = `remote:${url}:${options.sourceName || ''}:${JSON.stringify(fieldMap)}:${JSON.stringify(headers)}`;
  const cached = inventoryCache.get(cacheKey);
  const cacheTtlMs = getInventoryCacheSeconds() * 1000;
  if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
    return buildCachedRemoteInventoryUrlResult(url, options, cached, 'hit');
  }

  let rows;
  try {
    const { content, format } = await fetchRemoteInventoryContent(url, { headers });
    rows = parseInventory(content, format, { fieldMap }).map((row) => ({
      ...row,
      source: row.source || row.provider || row.supplier || options.sourceName || row.source
    }));
  } catch (error) {
    const staleResult = buildStaleRemoteInventoryUrlResult(url, options, cached, error);
    if (staleResult) return staleResult;
    throw error;
  }
  return {
    filePath: url,
    sourceLabel: options.sourceName || redactRemoteUrl(url),
    readable: true,
    rows: cacheRemoteRows(cacheKey, rows),
    sourceCount: 1,
    cache: 'miss',
    remoteLoad: buildRemoteInventoryLoad({
      url,
      name: options.sourceName || redactRemoteUrl(url),
      status: 'ok',
      rowCount: rows.length,
      type: options.type || 'source',
      groupUrl: options.groupUrl || url,
      cache: 'miss'
    })
  };
}

function buildCachedRemoteInventoryUrlResult(url, options, cached, cacheState, error = null) {
  const sourceLabel = options.sourceName || redactRemoteUrl(url);
  const remoteLoad = buildRemoteInventoryLoad({
    url,
    name: sourceLabel,
    status: cacheState === 'stale' ? 'stale' : 'ok',
    rowCount: cached.rows.length,
    type: options.type || 'source',
    groupUrl: options.groupUrl || url,
    cache: cacheState,
    cachedAt: cached.cachedAt,
    ...(error ? { error: error.message || '远程供应商文件读取失败。' } : {})
  });
  const sourceErrors = error
    ? [`${sourceLabel} 读取失败，已使用过期缓存：${error.message || '远程供应商文件读取失败。'}`]
    : [];
  return {
    filePath: url,
    sourceLabel,
    readable: true,
    rows: cached.rows,
    sourceCount: 1,
    cache: cacheState,
    cachedAt: new Date(cached.cachedAt).toISOString(),
    ...(sourceErrors.length ? { sourceErrors } : {}),
    remoteLoad
  };
}

function buildStaleRemoteInventoryUrlResult(url, options, cached, error) {
  if (!canUseStaleInventoryCache(cached)) return null;
  return buildCachedRemoteInventoryUrlResult(url, options, cached, 'stale', error);
}

async function readRemoteInventoryManifestUrl(url) {
  const cacheKey = `remote-manifest:${url}`;
  const cached = inventoryCache.get(cacheKey);
  const cacheTtlMs = getInventoryCacheSeconds() * 1000;
  if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
    return buildCachedRemoteInventoryManifestResult(url, cached, 'hit');
  }

  let sources;
  try {
    const { content } = await fetchRemoteInventoryContent(url);
    sources = parseRemoteInventoryManifestSources(asText(content), url);
    if (!sources.length) {
      throw new Error(`${redactRemoteUrl(url)} 没有识别到远程供应商清单。`);
    }
  } catch (error) {
    const staleResult = buildStaleRemoteInventoryManifestResult(url, cached, error);
    if (staleResult) return staleResult;
    throw error;
  }

  const loads = await Promise.allSettled(sources.map((source) =>
    readRemoteInventoryUrl(source.url, {
      sourceName: source.name,
      fieldMap: source.fieldMap,
      headers: source.headers,
      groupUrl: url,
      type: 'manifest-source'
    })
  ));
  const loaded = loads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = loads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '远程供应商清单子源读取失败。');
  const childLoads = loads.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value.remoteLoad
      : buildRemoteInventoryFailedLoad(sources[index], result.reason, { groupUrl: url, type: 'manifest-source' })
  ).filter(Boolean);
  if (!loaded.length) {
    const error = new Error(`${redactRemoteUrl(url)} 的所有供应商子源读取失败。`);
    error.sourceErrors = sourceErrors;
    error.remoteLoads = [
      buildRemoteInventoryLoad({
        url,
        name: `${redactRemoteUrl(url)} 清单`,
        status: 'failed',
        rowCount: 0,
        sourceCount: sources.length,
        failedCount: sourceErrors.length,
        type: 'manifest',
        error: error.message
      }),
      ...childLoads
    ];
    const staleResult = buildStaleRemoteInventoryManifestResult(url, cached, error);
    if (staleResult) return staleResult;
    throw error;
  }

  const rows = loaded.flatMap((source) => source.rows);
  const sourceCount = loaded.reduce((sum, source) => sum + Number(source.sourceCount || 1), 0);
  const remoteLoads = [
    buildRemoteInventoryLoad({
      url,
      name: `${redactRemoteUrl(url)} 清单`,
      status: sourceErrors.length ? 'partial' : 'ok',
      rowCount: rows.length,
      sourceCount: sources.length,
      failedCount: sourceErrors.length,
      type: 'manifest',
      cache: 'miss'
    }),
    ...childLoads
  ];
  inventoryCache.set(cacheKey, {
    type: 'remote-manifest',
    rows,
    sourceCount,
    sourceErrors,
    remoteLoads,
    cachedAt: Date.now()
  });
  return {
    filePath: url,
    sourceLabel: redactRemoteUrl(url),
    readable: true,
    rows,
    sourceCount,
    sourceErrors,
    remoteLoads,
    cache: 'miss'
  };
}

function buildCachedRemoteInventoryManifestResult(url, cached, cacheState, error = null) {
  const sourceLabel = redactRemoteUrl(url);
  const sourceErrors = error
    ? [`${sourceLabel} 清单读取失败，已使用过期缓存：${error.message || '远程供应商清单读取失败。'}`]
    : cached.sourceErrors || [];
  return {
    filePath: url,
    sourceLabel,
    readable: true,
    rows: cached.rows,
    sourceCount: cached.sourceCount,
    sourceErrors,
    remoteLoads: markRemoteInventoryLoadsCached(cached.remoteLoads || [], cached.cachedAt, cacheState, error),
    cache: cacheState,
    cachedAt: new Date(cached.cachedAt).toISOString()
  };
}

function buildStaleRemoteInventoryManifestResult(url, cached, error) {
  if (!canUseStaleInventoryCache(cached)) return null;
  return buildCachedRemoteInventoryManifestResult(url, cached, 'stale', error);
}

function buildRemoteInventoryLoad({
  url,
  name,
  status,
  rowCount = 0,
  sourceCount = 0,
  failedCount = 0,
  type = 'source',
  groupUrl = '',
  cache = '',
  cachedAt = null,
  error = ''
}) {
  const safeUrl = redactRemoteUrl(url || '');
  const safeGroupUrl = redactRemoteUrl(groupUrl || url || '');
  return {
    key: `${type}:${safeGroupUrl}:${safeUrl || name || ''}`,
    url: safeUrl,
    name: name || safeUrl || '远程价格源',
    status,
    rowCount: Number(rowCount || 0),
    sourceCount: Number(sourceCount || 0),
    failedCount: Number(failedCount || 0),
    groupUrl: safeGroupUrl,
    type,
    ...(cache ? { cache } : {}),
    ...(cachedAt ? { cachedAt: new Date(cachedAt).toISOString() } : {}),
    ...(error ? { error } : {})
  };
}

function buildRemoteInventoryFailedLoad(source = {}, error, options = {}) {
  return buildRemoteInventoryLoad({
    url: source.url || '',
    name: source.name || redactRemoteUrl(source.url || ''),
    status: 'failed',
    rowCount: 0,
    type: options.type || source.type || 'source',
    groupUrl: options.groupUrl || source.groupUrl || source.url || '',
    error: error?.message || '远程供应商文件读取失败。'
  });
}

function buildRemoteInventoryStatus(base = {}, loads = []) {
  const normalizedLoads = loads.filter(Boolean);
  const sourceLoads = normalizedLoads.filter((load) => load.type !== 'manifest');
  return {
    ...base,
    loadCount: sourceLoads.length,
    manifestCount: normalizedLoads.length - sourceLoads.length,
    okCount: sourceLoads.filter((load) => load.status === 'ok').length,
    partialCount: sourceLoads.filter((load) => load.status === 'partial').length,
    staleCount: sourceLoads.filter((load) => load.status === 'stale').length,
    failedCount: sourceLoads.filter((load) => load.status === 'failed').length,
    loadingCount: sourceLoads.filter((load) => load.status === 'loading').length,
    loads: normalizedLoads
  };
}

function markRemoteInventoryLoadsCached(loads, cachedAt, cacheState = 'hit', error = null) {
  return loads.map((load) => ({
    ...load,
    status: cacheState === 'stale' && load.type !== 'manifest' ? 'stale' : load.status,
    cache: cacheState,
    cachedAt: new Date(cachedAt).toISOString(),
    ...(error && load.type === 'manifest' ? { error: error.message || '远程供应商清单读取失败。' } : {})
  }));
}

function canUseStaleInventoryCache(cached) {
  const staleCacheSeconds = getInventoryStaleCacheSeconds();
  if (!cached || staleCacheSeconds <= 0) return false;
  return Date.now() - cached.cachedAt < (getInventoryCacheSeconds() + staleCacheSeconds) * 1000;
}

async function fetchRemoteInventoryContent(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      ...getRemoteInventoryHeaders(),
      ...normalizeRemoteHeaders(options.headers || {})
    },
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
  const { content, format } = decodeInventoryContent(raw, url, contentType, contentEncoding);
  const decodedSize = Buffer.isBuffer(content) ? content.byteLength : Buffer.byteLength(content, 'utf8');
  if (decodedSize > maxBytes) {
    throw new Error(`${redactRemoteUrl(url)} 解压后文件超过 ${formatBytes(maxBytes)} 限制。`);
  }
  return {
    content,
    format
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

function parseRemoteInventoryManifestSources(content, manifestUrl) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const sources = Array.isArray(parsed?.sources)
    ? parsed.sources
    : Array.isArray(parsed?.feeds)
      ? parsed.feeds
      : Array.isArray(parsed?.inventorySources)
        ? parsed.inventorySources
        : [];
  return sources
    .filter((source) => source && typeof source === 'object' && (source.url || source.href))
    .map((source, index) => normalizeRemoteInventorySource(source, index, manifestUrl));
}

function parseRemoteInventoryConfigSources(content) {
  const parsed = JSON.parse(content);
  const sources = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sources)
      ? parsed.sources
      : Array.isArray(parsed?.feeds)
        ? parsed.feeds
        : Array.isArray(parsed?.inventorySources)
          ? parsed.inventorySources
          : [parsed];
  return sources
    .filter((source) => source && typeof source === 'object' && (source.url || source.href))
    .map((source, index) => normalizeRemoteInventorySource(source, index));
}

function normalizeRemoteInventorySource(source, index, baseUrl = null) {
  const rawUrl = source.url || source.href;
  return {
    url: baseUrl ? new URL(rawUrl, baseUrl).href : new URL(rawUrl).href,
    name: String(source.name || source.provider || source.supplier || `远程供应商${index + 1}`),
    fieldMap: normalizeFieldMap(source.fieldMap || source.fields || {}),
    headers: normalizeRemoteHeaders(source.headers || {})
  };
}

function getRemoteInventoryHeaders() {
  if (!process.env.HOTEL_DATA_URL_HEADERS) return {};
  return normalizeRemoteHeaders(JSON.parse(process.env.HOTEL_DATA_URL_HEADERS), 'HOTEL_DATA_URL_HEADERS');
}

function normalizeRemoteHeaders(value, label = 'headers') {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed) return {};
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function decodeInventoryContent(buffer, source, contentType = '', contentEncoding = '') {
  const format = getInventoryFormat(source, contentType);
  const shouldGunzip = gzipFormats.has(format) || contentEncoding.toLowerCase().includes('gzip');
  const decoded = shouldGunzip && isGzipBuffer(buffer) ? gunzipSync(buffer) : buffer;
  const normalizedFormat = normalizeInventoryFormat(format);
  return {
    content: normalizedFormat === '.xlsx' ? decoded : decoded.toString('utf8'),
    format: normalizedFormat
  };
}

function getInventoryFormat(source, contentType = '') {
  const path = getInventoryPathname(source);
  const loweredPath = path.toLowerCase();
  for (const format of allowedInventoryFormats) {
    if (loweredPath.endsWith(format)) return format;
  }

  const loweredType = contentType.toLowerCase();
  if (loweredType.includes('spreadsheetml.sheet')) return '.xlsx';
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

function normalizeImportPayload(payload, extension) {
  if (payload.contentBase64) {
    return {
      content: Buffer.from(String(payload.contentBase64), 'base64'),
      encoding: undefined,
      size: Buffer.byteLength(String(payload.contentBase64), 'base64')
    };
  }
  if (typeof payload.content !== 'string') return { content: '', encoding: 'utf8', size: 0 };
  if (extension === '.xlsx') {
    const buffer = Buffer.from(payload.content, 'base64');
    return { content: buffer, encoding: undefined, size: buffer.byteLength };
  }
  return {
    content: payload.content,
    encoding: 'utf8',
    size: Buffer.byteLength(payload.content, 'utf8')
  };
}

function asBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
}

function asText(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
}

function getRemoteTimeoutMs() {
  return getPositiveInteger(process.env.HOTEL_DATA_URL_TIMEOUT_MS, defaultRemoteTimeoutMs);
}

function getRemoteMaxBytes() {
  return getPositiveInteger(process.env.HOTEL_DATA_URL_MAX_BYTES, defaultRemoteMaxBytes);
}

function getInventoryCacheSeconds() {
  return getNonNegativeInteger(process.env.HOTEL_DATA_CACHE_SECONDS, defaultInventoryCacheSeconds);
}

function getInventoryStaleCacheSeconds() {
  return getNonNegativeInteger(process.env.HOTEL_DATA_STALE_CACHE_SECONDS, defaultInventoryStaleCacheSeconds);
}

function getPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function getNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
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
  const masterHotelId = normalizeHotelIdentifier(pick(row, 'masterHotelId'));

  return {
    id: pick(row, 'id') || `local-${index}`,
    masterHotelId,
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
      bookingUrl: pick(row, 'bookingUrl') || '',
      masterHotelId
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

function normalizeFieldMap(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, sourcePath]) =>
    typeof sourcePath === 'string' ||
    (Array.isArray(sourcePath) && sourcePath.every((item) => typeof item === 'string'))
  ));
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

function normalizeHotelIdentifier(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
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
  if (hotel.masterHotelId) return `master:${hotel.masterHotelId}`;

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

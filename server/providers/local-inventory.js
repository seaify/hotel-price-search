import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { applyFilters, findCity, getNightCount } from '../hotel-data.js';

const defaultImage = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80';
const maxImportBytes = 8 * 1024 * 1024;
const allowedExtensions = new Set(['.csv', '.json']);
const fieldAliases = {
  id: ['id', 'hotelId', 'hotel_id', '酒店ID', '酒店编号', '供应商酒店ID'],
  name: ['name', 'hotelName', 'hotel_name', '酒店名称', '酒店名', '名称'],
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

export async function getLocalInventoryStatus() {
  const importedFiles = await listImportedInventoryFiles();
  const filePaths = unique([...getLocalInventoryPaths(), ...importedFiles.map((file) => file.filePath)]);
  const files = await Promise.all(filePaths.map(async (filePath) => {
    try {
      await access(filePath, constants.R_OK);
      return { filePath, readable: true };
    } catch {
      return { filePath, readable: false };
    }
  }));
  const readableFiles = files.filter((file) => file.readable);

  return {
    configured: Boolean(process.env.HOTEL_DATA_FILE || process.env.HOTEL_DATA_FILES || importedFiles.length),
    readable: readableFiles.length > 0,
    filePath: filePaths[0],
    filePaths,
    fileCount: filePaths.length,
    readableCount: readableFiles.length,
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
      .filter((entry) => entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase()))
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
  if (!allowedExtensions.has(extension)) {
    throw new Error('仅支持 .csv 或 .json 酒店价格文件。');
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

  const readableFiles = status.files.filter((file) => file.readable);
  const loaded = await Promise.all(readableFiles.map(async (file) => {
    const raw = await readFile(file.filePath, 'utf8');
    const rows = parseInventory(raw, extname(file.filePath).toLowerCase());
    return { ...file, rows };
  }));
  const rows = loaded.flatMap((file) =>
    file.rows.map((row) => ({
      ...row,
      __inventoryFile: file.filePath
    }))
  );
  const nights = getNightCount(params.checkIn, params.checkOut);
  const normalized = rows
    .map((row, index) => normalizeHotel(row, index, nights))
    .filter((hotel) => isAvailableForDates(hotel, params));
  const merged = mergeHotelRates(filterByDestination(normalized, params));

  return {
    hotels: applyFilters(merged, params),
    status,
    rowCount: rows.length,
    sourceCount: readableFiles.length
  };
}

export function parseInventory(raw, extension = '.json') {
  if (extension === '.csv') return parseCsv(raw);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.hotels || [];
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

function normalizeHotel(row, index, nights) {
  const price = parseMoney(pick(row, 'price'));
  const totalPrice = parseMoney(pick(row, 'totalPrice')) || price * nights;
  const star = Number(pick(row, 'star') || 0) || null;
  const destination = pick(row, 'city');
  const city = findCity(destination)?.city || destination || '';
  const knownCity = findCity(city);
  const amenities = splitList(pick(row, 'amenities'));
  const tags = splitList(pick(row, 'tags'));
  const providerName = pick(row, 'providerName') || basename(row.__inventoryFile || '本地供应商文件');
  const roomName = pick(row, 'roomName') || '供应商库存';

  return {
    id: pick(row, 'id') || `local-${index}`,
    name: pick(row, 'name') || '未命名酒店',
    city,
    province: pick(row, 'province') || knownCity?.province || '',
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
    source: 'local',
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

function mergeHotelRates(hotels) {
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
      source: 'local'
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
  const city = findCity(params.city)?.city || params.city;
  return hotels.filter((hotel) => hotel.city === city || hotel.province === city);
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

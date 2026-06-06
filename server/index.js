import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyFilters,
  buildDemoHotels,
  cityCatalog,
  findCity,
  getNightCount,
  resolveDestination,
  summarizeCities
} from './hotel-data.js';
import {
  getLocalInventoryStatus,
  listImportedInventoryFiles,
  saveImportedInventoryFile,
  searchLocalInventory
} from './providers/local-inventory.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = normalize(join(__dirname, '..'));
const publicDir = join(rootDir, 'public');
const port = Number(process.env.PORT || 5174);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

let cachedToken = null;

export function createHotelServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      if (url.pathname === '/api/cities') {
        return sendJson(response, summarizeCities());
      }

      if (url.pathname === '/api/status') {
        return sendJson(response, await getProviderStatus());
      }

      if (url.pathname === '/api/imports') {
        if (request.method === 'GET') {
          return sendJson(response, {
            imports: await listImportedInventoryFiles(),
            providers: await getProviderStatus()
          });
        }
        if (request.method === 'POST') {
          try {
            const payload = await readJsonBody(request);
            const imported = await saveImportedInventoryFile(payload);
            return sendJson(response, {
              imported,
              imports: await listImportedInventoryFiles(),
              providers: await getProviderStatus()
            }, 201);
          } catch (error) {
            return sendJson(response, { error: 'IMPORT_FAILED', message: error.message }, 400);
          }
        }
        return sendJson(response, { error: 'METHOD_NOT_ALLOWED' }, 405);
      }

      if (url.pathname === '/api/search') {
        const params = Object.fromEntries(url.searchParams.entries());
        const payload = await searchHotels(params);
        return sendJson(response, payload);
      }

      return serveStatic(url.pathname, response);
    } catch (error) {
      console.error(error);
      return sendJson(response, { error: 'SERVER_ERROR', message: '服务暂时不可用，请稍后再试。' }, 500);
    }
  });
}

export async function searchHotels(params) {
  const normalized = normalizeSearchParams(params);
  const providerEnabled = Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
  const localStatus = await getLocalInventoryStatus();
  let inventoryFallbackStatus = null;
  let inventoryFailureNotice = '';

  if (localStatus.readable) {
    const localResults = await searchLocalInventory(normalized);
    const sourceErrors = localResults.status.sourceErrors || [];
    const errorNotice = sourceErrors.length ? `${sourceErrors.length} 个远程供应商文件读取失败。` : '';

    if (localResults.sourceCount > 0) {
      const page = paginateHotels(localResults.hotels, normalized);
      const providers = await getProviderStatus();
      providers.localInventory = localResults.status;
      return {
        source: 'local',
        sourceLabel: '供应商真实库存',
        mode: 'live-file',
        generatedAt: new Date().toISOString(),
        query: normalized,
        total: page.total,
        returned: page.hotels.length,
        coverageCities: page.coverageCities,
        pagination: page.pagination,
        hotels: page.hotels,
        notice: page.total
          ? `${errorNotice}价格来自 ${localResults.sourceCount} 个已接入的供应商库存源，已按同酒店合并并优先显示最低价。`
          : `${errorNotice}${localStatus.readableCount} 个供应商库存源已接入，但当前条件没有可售酒店。`,
        providers
      };
    }

    inventoryFallbackStatus = localResults.status;
    inventoryFailureNotice = errorNotice ? `${errorNotice} 当前已回退到备用数据源。` : '';
  }

  if (providerEnabled && normalized.destinationType === 'city') {
    try {
      const liveResults = await searchAmadeus(normalized);
      if (liveResults.hotels.length > 0) {
        const page = paginateHotels(liveResults.hotels, normalized);
        const providers = await getProviderStatus();
        if (inventoryFallbackStatus) providers.localInventory = inventoryFallbackStatus;
        return {
          source: 'amadeus',
          sourceLabel: 'Amadeus 实时价格',
          mode: 'live',
          generatedAt: new Date().toISOString(),
          query: normalized,
          total: page.total,
          returned: page.hotels.length,
          coverageCities: page.coverageCities,
          pagination: page.pagination,
          hotels: page.hotels,
          notice: `${inventoryFailureNotice}价格来自已配置的实时供应商接口，仍需在跳转预订前二次确认库存和政策。`,
          providers
        };
      }
    } catch (error) {
      console.warn('Live provider failed, falling back to demo data:', error.message);
    }
  }

  const hotels = searchDemoInventory(normalized);
  const page = paginateHotels(hotels, normalized);
  const providers = await getProviderStatus();
  if (inventoryFallbackStatus) providers.localInventory = inventoryFallbackStatus;

  return {
    source: 'demo',
    sourceLabel: '全国示例价格库',
    mode: providerEnabled ? 'fallback' : 'demo',
    generatedAt: new Date().toISOString(),
    query: normalized,
    total: page.total,
    returned: page.hotels.length,
    coverageCities: page.coverageCities,
    pagination: page.pagination,
    hotels: page.hotels,
    notice: providerEnabled
      ? `${inventoryFailureNotice}实时接口未返回可用结果，当前展示示例价格。`
      : `${inventoryFailureNotice}当前未配置酒店供应商 API 或本地供应商文件，展示的是用于开发演示的全国示例价格；接入供应商后可查询真实价格。`,
    providers
  };
}

async function getProviderStatus() {
  const localInventory = await getLocalInventoryStatus();
  return {
    localInventory,
    amadeus: {
      configured: Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET),
      baseUrl: process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com'
    },
    demo: {
      enabled: true,
      cities: cityCatalog.length
    }
  };
}

function normalizeSearchParams(params) {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const checkIn = params.checkIn || toDateInput(today);
  const checkOut = params.checkOut || toDateInput(tomorrow);
  const destination = resolveDestination(params.city);
  const city = destination.type === 'nationwide'
    ? ''
    : destination.type === 'unknown'
      ? params.city || ''
      : destination.label;

  return {
    city,
    destinationType: destination.type,
    keyword: params.keyword || '',
    checkIn,
    checkOut,
    adults: clampNumber(params.adults, 1, 8, 2),
    rooms: clampNumber(params.rooms, 1, 5, 1),
    minPrice: params.minPrice || '',
    maxPrice: params.maxPrice || '',
    star: params.star || '',
    sort: params.sort || 'recommend',
    limit: clampNumber(params.limit, 1, 100, 24),
    offset: clampNumber(params.offset, 0, 100000, 0)
  };
}

function searchDemoInventory(params) {
  const destination = resolveDestination(params.city);
  if (destination.type === 'unknown') return [];
  const cities = destination.type === 'city' ? [destination.city] : destination.cities;
  const batch = cities.flatMap((city) => buildDemoHotels({ ...params, city: city.city }));
  return applyFilters(batch, params);
}

function paginateHotels(hotels, params) {
  const total = hotels.length;
  const offset = Math.min(params.offset, total);
  const limit = params.limit;
  const pageHotels = hotels.slice(offset, offset + limit);
  return {
    hotels: pageHotels,
    total,
    coverageCities: new Set(hotels.map((hotel) => hotel.city).filter(Boolean)).size,
    pagination: {
      offset,
      limit,
      nextOffset: offset + pageHotels.length,
      hasMore: offset + pageHotels.length < total
    }
  };
}

async function searchAmadeus(params) {
  const city = findCity(params.city);
  if (!city?.code) {
    return { hotels: [] };
  }

  const token = await getAmadeusToken();
  const baseUrl = process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com';
  const listUrl = new URL('/v1/reference-data/locations/hotels/by-city', baseUrl);
  listUrl.searchParams.set('cityCode', city.code);
  listUrl.searchParams.set('radius', '20');
  listUrl.searchParams.set('radiusUnit', 'KM');
  listUrl.searchParams.set('hotelSource', 'ALL');

  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const listData = await readProviderJson(listResponse);
  const hotelIds = (listData.data || []).slice(0, 60).map((item) => item.hotelId).filter(Boolean);
  if (hotelIds.length === 0) return { hotels: [] };

  const nights = getNightCount(params.checkIn, params.checkOut);
  const offers = [];
  for (let index = 0; index < hotelIds.length; index += 20) {
    const offerUrl = new URL('/v3/shopping/hotel-offers', baseUrl);
    offerUrl.searchParams.set('hotelIds', hotelIds.slice(index, index + 20).join(','));
    offerUrl.searchParams.set('adults', String(params.adults));
    offerUrl.searchParams.set('checkInDate', params.checkIn);
    offerUrl.searchParams.set('checkOutDate', params.checkOut);
    offerUrl.searchParams.set('roomQuantity', String(params.rooms));
    offerUrl.searchParams.set('currency', 'CNY');
    offerUrl.searchParams.set('bestRateOnly', 'true');

    const offerResponse = await fetch(offerUrl, {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const offerData = await readProviderJson(offerResponse);
    offers.push(...(offerData.data || []));
  }

  const hotels = offers.map((item, index) => {
    const offer = item.offers?.[0];
    const price = Number(offer?.price?.total || offer?.price?.base || 0);
    return {
      id: item.hotel?.hotelId || `amadeus-${index}`,
      name: item.hotel?.name || '未命名酒店',
      city: city.city,
      province: city.province,
      district: item.hotel?.address?.cityName || city.city,
      address: buildAddress(item.hotel),
      star: Number(item.hotel?.rating || 0) || null,
      style: '实时库存',
      rating: null,
      reviews: null,
      price: Math.round(price),
      totalPrice: Math.round(price * Math.max(1, Number(params.rooms || 1))),
      nights,
      originalPrice: null,
      currency: offer?.price?.currency || 'CNY',
      distance: null,
      amenities: [offer?.boardType, offer?.room?.typeEstimated?.category, offer?.policies?.paymentType].filter(Boolean),
      tags: ['实时价格', offer?.policies?.cancellations ? '含取消政策' : '需确认政策'].filter(Boolean),
      image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',
      payment: offer?.policies?.paymentType || '需确认',
      cancellation: offer?.policies?.cancellations ? '查看取消政策' : '预订前确认',
      source: 'amadeus'
    };
  }).filter((hotel) => hotel.price > 0);

  return { hotels: applyFilters(hotels, params) };
}

async function getAmadeusToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken;
  }

  const baseUrl = process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com';
  const tokenUrl = new URL('/v1/security/oauth2/token', baseUrl);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AMADEUS_CLIENT_ID,
    client_secret: process.env.AMADEUS_CLIENT_SECRET
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await readProviderJson(response);
  cachedToken = {
    access_token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000
  };
  return cachedToken;
}

async function readProviderJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.errors?.[0]?.title || data.error_description || response.statusText;
    throw new Error(message);
  }
  return data;
}

function buildAddress(hotel) {
  const lines = hotel?.address?.lines || [];
  return [lines.join(' '), hotel?.address?.cityName, hotel?.address?.countryCode].filter(Boolean).join(', ');
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

async function serveStatic(pathname, response) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(decodeURIComponent(requestPath)).replace(/^[/\\]+/, '');
  const filePath = join(publicDir, safePath);
  const fileRelation = relative(publicDir, filePath);
  if (fileRelation.startsWith('..') || fileRelation === '') {
    return sendJson(response, { error: 'FORBIDDEN' }, 403);
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(response, { error: 'NOT_FOUND' }, 404);
    }
    throw error;
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > 10 * 1024 * 1024) {
      throw new Error('请求体不能超过 10MB。');
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('请求体必须是 JSON。');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createHotelServer().listen(port, () => {
    console.log(`Hotel price search is running at http://localhost:${port}`);
  });
}

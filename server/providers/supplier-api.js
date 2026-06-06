import { parseInventory, searchInventoryRows } from './local-inventory.js';

const defaultSupplierApiTimeoutMs = 10_000;
const sensitiveQueryPattern = /(token|key|secret|signature|sign|auth|access|password)/i;

export function getSupplierApiStatus() {
  const url = getSupplierApiUrl();
  return {
    configured: Boolean(url),
    name: getSupplierApiName(),
    url: url ? redactUrl(url) : '',
    method: getSupplierApiMethod(),
    timeoutMs: getSupplierApiTimeoutMs(),
    headersConfigured: Boolean(process.env.HOTEL_SUPPLIER_API_HEADERS)
  };
}

export async function searchSupplierApiInventory(params) {
  const status = getSupplierApiStatus();
  if (!status.configured) {
    return { hotels: [], status, rowCount: 0, sourceCount: 0 };
  }

  const { url, init } = buildSupplierApiRequest(params);
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${redactUrl(url)} 返回 HTTP ${response.status}`);
  }

  const format = getSupplierApiResponseFormat(url, response.headers.get('content-type') || '');
  const rows = parseInventory(text, format);
  return {
    hotels: searchInventoryRows(rows, params, {
      source: 'supplier-api',
      sourceLabel: status.name
    }),
    status,
    rowCount: rows.length,
    sourceCount: 1
  };
}

function buildSupplierApiRequest(params) {
  const method = getSupplierApiMethod();
  const url = new URL(getSupplierApiUrl());
  const query = buildSupplierQuery(params);
  const headers = {
    Accept: 'application/json, text/csv, application/x-ndjson',
    ...getSupplierApiHeaders()
  };
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(getSupplierApiTimeoutMs())
  };

  if (method === 'GET') {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  } else {
    init.headers = { 'Content-Type': 'application/json', ...headers };
    init.body = JSON.stringify(query);
  }

  return { url, init };
}

function buildSupplierQuery(params) {
  return {
    city: params.city || '',
    destinationType: params.destinationType || '',
    keyword: params.keyword || '',
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults,
    rooms: params.rooms,
    minPrice: params.minPrice || '',
    maxPrice: params.maxPrice || '',
    star: params.star || '',
    sort: params.sort || '',
    limit: params.limit,
    offset: params.offset
  };
}

function getSupplierApiUrl() {
  return process.env.HOTEL_SUPPLIER_API_URL || '';
}

function getSupplierApiName() {
  return process.env.HOTEL_SUPPLIER_API_NAME || '实时供应商API';
}

function getSupplierApiMethod() {
  const method = String(process.env.HOTEL_SUPPLIER_API_METHOD || 'GET').trim().toUpperCase();
  return method === 'POST' ? 'POST' : 'GET';
}

function getSupplierApiHeaders() {
  if (!process.env.HOTEL_SUPPLIER_API_HEADERS) return {};
  const parsed = JSON.parse(process.env.HOTEL_SUPPLIER_API_HEADERS);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('HOTEL_SUPPLIER_API_HEADERS 必须是 JSON 对象。');
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function getSupplierApiTimeoutMs() {
  const number = Number(process.env.HOTEL_SUPPLIER_API_TIMEOUT_MS);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : defaultSupplierApiTimeoutMs;
}

function getSupplierApiResponseFormat(url, contentType) {
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith('.csv') || contentType.toLowerCase().includes('csv')) return '.csv';
  if (pathname.endsWith('.jsonl') || pathname.endsWith('.ndjson') || /jsonl|ndjson/i.test(contentType)) return '.jsonl';
  return '.json';
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryPattern.test(key)) {
        url.searchParams.set(key, 'REDACTED');
      }
    }
    return url.toString();
  } catch {
    return String(value || '');
  }
}

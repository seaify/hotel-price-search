import { parseInventory, searchInventoryRows } from './local-inventory.js';

const defaultSupplierApiTimeoutMs = 10_000;
const sensitiveQueryPattern = /(token|key|secret|signature|sign|auth|access|password)/i;

export function getSupplierApiStatus() {
  const sources = getSupplierApiSources();
  const firstSource = sources[0] || null;
  return {
    configured: sources.length > 0,
    name: getSupplierApiName(),
    url: firstSource ? redactUrl(firstSource.url) : '',
    urls: sources.map((source) => redactUrl(source.url)),
    apiCount: sources.length,
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

  const loads = await Promise.allSettled(getSupplierApiSources().map((source) => readSupplierApiSource(source, params)));
  const loaded = loads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = loads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '实时供应商 API 读取失败。');
  if (!loaded.length && sourceErrors.length) {
    throw new Error(sourceErrors.join('；'));
  }

  const rows = loaded.flatMap((source) =>
    source.rows.map((row) => ({
      ...row,
      source: row.source || row.provider || row.supplier || source.name,
      __inventoryFile: source.name
    }))
  );
  const nextStatus = {
    ...status,
    sourceCount: loaded.length,
    sourceErrors,
    rowCount: rows.length
  };

  return {
    hotels: searchInventoryRows(rows, params, {
      source: 'supplier-api',
      sourceLabel: status.name
    }),
    status: nextStatus,
    rowCount: rows.length,
    sourceCount: loaded.length
  };
}

async function readSupplierApiSource(source, params) {
  const { url, init } = buildSupplierApiRequest(source, params);
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${redactUrl(url)} 返回 HTTP ${response.status}`);
  }

  const format = getSupplierApiResponseFormat(url, response.headers.get('content-type') || '');
  return {
    ...source,
    rows: parseInventory(text, format)
  };
}

function buildSupplierApiRequest(source, params) {
  const method = getSupplierApiMethod();
  const url = new URL(source.url);
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

function getSupplierApiSources() {
  const urls = [
    process.env.HOTEL_SUPPLIER_API_URLS,
    process.env.HOTEL_SUPPLIER_API_URL
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\n,;]/))
    .map((value) => value.trim())
    .filter(Boolean);
  const names = [
    process.env.HOTEL_SUPPLIER_API_NAMES,
    process.env.HOTEL_SUPPLIER_API_NAME
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\n,;]/))
    .map((value) => value.trim())
    .filter(Boolean);

  return urls.map((url, index) => ({
    url,
    name: names[index] || names[0] || getSupplierApiName()
  }));
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

import { parseInventory, searchInventoryRows } from './local-inventory.js';

const defaultSupplierApiTimeoutMs = 10_000;
const sensitiveQueryPattern = /(token|key|secret|signature|sign|auth|access|password)/i;

export function getSupplierApiStatus() {
  const sources = getSupplierApiSources();
  const firstSource = sources[0] || null;
  const methods = unique(sources.map((source) => source.method));
  return {
    configured: sources.length > 0,
    name: getSupplierApiName(),
    url: firstSource ? redactUrl(firstSource.url) : '',
    urls: sources.map((source) => redactUrl(source.url)),
    apiCount: sources.length,
    method: methods.length === 1 ? methods[0] : methods.length ? 'MIXED' : getSupplierApiMethod(),
    methods,
    timeoutMs: firstSource?.timeoutMs || getSupplierApiTimeoutMs(),
    headersConfigured: sources.some((source) => Object.keys(source.headers || {}).length > 0)
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
      ...mapSupplierRow(row, source.fieldMap),
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
  const method = source.method || getSupplierApiMethod();
  const url = new URL(source.url);
  const query = buildSupplierQuery(params);
  const headers = {
    Accept: 'application/json, text/csv, application/x-ndjson',
    ...(source.headers || getSupplierApiHeaders())
  };
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(source.timeoutMs || getSupplierApiTimeoutMs())
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
  const configuredSources = getSupplierApiConfigSources();
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
  const method = getSupplierApiMethod();
  const headers = getSupplierApiHeaders();
  const timeoutMs = getSupplierApiTimeoutMs();

  const envSources = urls.map((url, index) => ({
    url,
    name: names[index] || names[0] || getSupplierApiName(),
    method,
    headers,
    timeoutMs
  }));
  return [...configuredSources, ...envSources];
}

function getSupplierApiConfigSources() {
  if (!process.env.HOTEL_SUPPLIER_API_CONFIG) return [];
  const parsed = JSON.parse(process.env.HOTEL_SUPPLIER_API_CONFIG);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : [parsed];
  return items
    .filter((item) => item && typeof item === 'object' && (item.url || item.endpoint))
    .map((item, index) => ({
      url: String(item.url || item.endpoint),
      name: String(item.name || item.provider || `实时供应商${index + 1}`),
      method: normalizeMethod(item.method || getSupplierApiMethod()),
      headers: normalizeHeaders(item.headers || {}),
      timeoutMs: getPositiveInteger(item.timeoutMs, getSupplierApiTimeoutMs()),
      fieldMap: normalizeFieldMap(item.fieldMap || item.fields || {})
    }));
}

function mapSupplierRow(row, fieldMap = {}) {
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

function getSupplierApiName() {
  return process.env.HOTEL_SUPPLIER_API_NAME || '实时供应商API';
}

function getSupplierApiMethod() {
  return normalizeMethod(process.env.HOTEL_SUPPLIER_API_METHOD || 'GET');
}

function getSupplierApiHeaders() {
  if (!process.env.HOTEL_SUPPLIER_API_HEADERS) return {};
  return normalizeHeaders(process.env.HOTEL_SUPPLIER_API_HEADERS);
}

function normalizeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  return method === 'POST' ? 'POST' : 'GET';
}

function normalizeHeaders(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('HOTEL_SUPPLIER_API_HEADERS 必须是 JSON 对象。');
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function getSupplierApiTimeoutMs() {
  return getPositiveInteger(process.env.HOTEL_SUPPLIER_API_TIMEOUT_MS, defaultSupplierApiTimeoutMs);
}

function getPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

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
    headersConfigured: sources.some((source) => Object.keys(source.headers || {}).length > 0),
    requestMapConfigured: sources.some((source) =>
      Object.keys(source.requestMap || {}).length > 0 ||
      Object.keys(source.requestDefaults || {}).length > 0
    ),
    responsePathConfigured: sources.some((source) =>
      source.responsePath?.length > 0 ||
      source.paginationPath?.length > 0
    )
  };
}

export async function searchSupplierApiInventory(params) {
  const status = getSupplierApiStatus();
  const sources = getSupplierApiSources();
  if (!status.configured) {
    return { hotels: [], status, rowCount: 0, sourceCount: 0 };
  }

  const loads = await Promise.allSettled(sources.map((source) => readSupplierApiSource(source, params)));
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
  const hotels = searchInventoryRows(rows, params, {
    source: 'supplier-api',
    sourceLabel: status.name
  });
  const upstreamPage = buildSupplierApiPage(loaded, hotels, params);
  if (upstreamPage) {
    nextStatus.upstreamTotal = upstreamPage.total;
    nextStatus.pagination = upstreamPage.pagination;
  }

  return {
    hotels,
    status: nextStatus,
    rowCount: rows.length,
    sourceCount: loaded.length,
    ...(upstreamPage ? upstreamPage : {})
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
  const parsed = parseSupplierApiResponse(text, format, source);
  return {
    ...source,
    rows: parsed.rows,
    pagination: parsed.pagination
  };
}

function parseSupplierApiResponse(text, format, source = {}) {
  if (format !== '.json') {
    return {
      rows: parseInventory(text, format),
      pagination: null
    };
  }

  const payload = JSON.parse(text);
  const rowPayload = extractSupplierApiRowsPayload(payload, source);
  const rows = parseInventory(JSON.stringify(rowPayload), format);
  return {
    rows,
    pagination: extractSupplierApiPagination(payload, rows.length, source, rowPayload)
  };
}

function extractSupplierApiRowsPayload(payload, source) {
  if (!source.responsePath?.length) return payload;
  const value = getMappedValue(payload, source.responsePath);
  if (!hasMappedValue(value)) {
    throw new Error(`${source.name || '实时供应商'} 响应中没有找到 responsePath。`);
  }
  return value;
}

function extractSupplierApiPagination(payload, rowCount, source = {}, rowPayload = null) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return null;
  const configuredPagination = source.paginationPath?.length
    ? getMappedValue(payload, source.paginationPath)
    : null;
  const candidates = [
    configuredPagination,
    payload.pagination,
    payload.pageInfo,
    payload.page_info,
    payload.meta?.pagination,
    payload.meta,
    rowPayload?.pagination,
    rowPayload?.pageInfo,
    rowPayload?.page_info,
    rowPayload?.meta?.pagination,
    rowPayload?.meta,
    payload
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  const total = firstNumber(candidates, ['total', 'totalCount', 'total_count', 'totalResults', 'total_results', 'totalHotels', 'total_hotels', 'matchedCount', 'matched_count']);
  if (total === null) return null;

  const limit = firstNumber(candidates, ['limit', 'pageSize', 'page_size', 'size', 'perPage', 'per_page']);
  const page = firstNumber(candidates, ['page', 'pageNo', 'page_no', 'pageNumber', 'page_number']);
  const offset = firstNumber(candidates, ['offset', 'skip', 'start', 'startIndex', 'start_index']);
  const returned = firstNumber(candidates, ['returned', 'returnedCount', 'returned_count', 'resultCount', 'result_count', 'count']);
  return {
    total,
    limit,
    offset: offset ?? (page !== null && limit !== null ? Math.max(0, page - 1) * limit : null),
    nextOffset: firstNumber(candidates, ['nextOffset', 'next_offset']),
    hasMore: firstBoolean(candidates, ['hasMore', 'has_more']),
    coverageCities: firstNumber(candidates, ['coverageCities', 'coverage_cities', 'coveredCities', 'covered_cities', 'cityCount', 'city_count']),
    returned: returned ?? rowCount
  };
}

function buildSupplierApiPage(loaded, hotels, params) {
  if (loaded.length !== 1 || !loaded[0].pagination) return null;
  const metadata = loaded[0].pagination;
  const requestedOffset = getPositiveInteger(params.offset, 0);
  const requestedLimit = getPositiveInteger(params.limit, hotels.length || 24);
  const offset = metadata.offset ?? requestedOffset;
  const limit = metadata.limit ?? requestedLimit;
  const returned = metadata.returned ?? hotels.length;
  const total = Math.max(metadata.total, offset + hotels.length);
  const nextOffset = metadata.nextOffset ?? offset + (metadata.limit ? limit : returned);
  const hasMore = metadata.hasMore ?? nextOffset < total;

  return {
    total,
    returned: hotels.length,
    coverageCities: metadata.coverageCities ?? new Set(hotels.map((hotel) => hotel.city).filter(Boolean)).size,
    pagination: {
      offset,
      limit,
      nextOffset,
      hasMore
    }
  };
}

function firstNumber(candidates, fields) {
  for (const candidate of candidates) {
    for (const field of fields) {
      const value = candidate[field];
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return Math.round(number);
    }
  }
  return null;
}

function firstBoolean(candidates, fields) {
  for (const candidate of candidates) {
    for (const field of fields) {
      const value = candidate[field];
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) {
        return value.trim().toLowerCase() === 'true';
      }
    }
  }
  return null;
}

function buildSupplierApiRequest(source, params) {
  const method = source.method || getSupplierApiMethod();
  const url = new URL(source.url);
  const query = buildSupplierQuery(params, source);
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
    appendSearchParams(url, query);
  } else {
    init.headers = { 'Content-Type': 'application/json', ...headers };
    init.body = JSON.stringify(query);
  }

  return { url, init };
}

function buildSupplierQuery(params, source = {}) {
  const pagination = buildSupplierPaginationQuery(params);
  const defaultQuery = {
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
  const baseQuery = {
    ...defaultQuery,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  const requestMap = source.requestMap || {};
  const requestDefaults = cloneRequestDefaults(source.requestDefaults || {});
  if (!Object.keys(requestMap).length) {
    return { ...defaultQuery, ...requestDefaults };
  }

  const mappedQuery = requestDefaults;
  Object.entries(requestMap).forEach(([targetPath, sourcePath]) => {
    const value = getMappedValue(baseQuery, sourcePath);
    if (hasMappedValue(value)) setPathValue(mappedQuery, targetPath, value);
  });
  return mappedQuery;
}

function buildSupplierPaginationQuery(params) {
  const limit = Number(params.limit);
  const offset = Number(params.offset);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { page: '', pageSize: '' };
  }
  const safeLimit = Math.round(limit);
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.round(offset) : 0;
  return {
    page: Math.floor(safeOffset / safeLimit) + 1,
    pageSize: safeLimit
  };
}

function appendSearchParams(url, query, prefix = '') {
  Object.entries(query || {}).forEach(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (!hasMappedValue(value)) return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      appendSearchParams(url, value, nextKey);
      return;
    }
    url.searchParams.set(nextKey, Array.isArray(value) ? value.join(',') : String(value));
  });
}

function setPathValue(target, path, value) {
  const keys = String(path || '').split('.').map((key) => key.trim()).filter(Boolean);
  if (!keys.length) return;
  let current = target;
  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || Array.isArray(current[key]) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  });
  current[keys[keys.length - 1]] = value;
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
      fieldMap: normalizeFieldMap(item.fieldMap || item.fields || {}),
      requestMap: normalizeFieldMap(item.requestMap || item.queryMap || {}),
      requestDefaults: normalizeRequestDefaults(item.requestDefaults || item.defaultParams || item.defaults || {}),
      responsePath: normalizePathList(item.responsePath || item.resultsPath || item.recordsPath || item.itemsPath || item.dataPath),
      paginationPath: normalizePathList(item.paginationPath || item.pageInfoPath)
    }));
}

function mapSupplierRow(row, fieldMap = {}) {
  if (!fieldMap || !Object.keys(fieldMap).length) return row;
  const mapped = { ...row };
  Object.entries(fieldMap).forEach(([targetField, sourcePath]) => {
    const value = getMappedValue(row, sourcePath);
    if (hasMappedValue(value)) {
      mapped[targetField] = value;
    }
  });
  return mapped;
}

function getMappedValue(row, sourcePath) {
  const paths = Array.isArray(sourcePath) ? sourcePath : [sourcePath];
  for (const path of paths) {
    const value = getPathValue(row, path);
    if (hasMappedValue(value)) return value;
  }
  return undefined;
}

function hasMappedValue(value) {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
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

function normalizePathList(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  }
  return [];
}

function normalizeRequestDefaults(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return cloneRequestDefaults(value);
}

function cloneRequestDefaults(value) {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
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

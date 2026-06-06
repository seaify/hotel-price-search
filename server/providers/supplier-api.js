import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cityCatalog, normalizeDestinationInput, resolveDestination } from '../hotel-data.js';
import { parseInventory, searchInventoryRows } from './local-inventory.js';

const defaultSupplierApiTimeoutMs = 10_000;
const defaultSupplierApiCacheSeconds = 0;
const defaultSupplierApiCacheMaxEntries = 1000;
const defaultSupplierCoverageProbeLimit = 1;
const defaultSupplierCoverageProbeConcurrency = 4;
const maxSupplierCoverageProbeConcurrency = 20;
const defaultSupplierDestinationMapCacheSeconds = 300;
const defaultSupplierDestinationMapMaxBytes = 4 * 1024 * 1024;
const sensitiveQueryPattern = /(token|key|secret|signature|sign|auth|access|password)/i;
const supplierAuthCache = new Map();
const supplierApiResponseCache = new Map();
const supplierDestinationMapCache = new Map();

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
    cacheSeconds: firstSource?.cacheSeconds ?? getSupplierApiCacheSeconds(),
    cacheMaxEntries: getSupplierApiCacheMaxEntries(),
    cacheConfigured: sources.some((source) => Number(source.cacheSeconds || 0) > 0),
    headersConfigured: sources.some((source) => Object.keys(source.headers || {}).length > 0),
    authConfigured: sources.some((source) => Boolean(source.auth)),
    cityFanoutConfigured: sources.some((source) => source.cityFanout),
    destinationMapConfigured: sources.some((source) =>
      source.destinationMap?.configured ||
      Boolean(source.destinationMapFile || source.destinationMapUrl)
    ),
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

  const loads = await Promise.allSettled(sources.map((source) => readSupplierApiSourceLoads(source, params)));
  const loaded = loads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = loads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '实时供应商 API 读取失败。')
    .concat(loaded.flatMap((source) => source.sourceErrors || []));
  if (!loaded.length && sourceErrors.length) {
    throw new Error(sourceErrors.join('；'));
  }

  const rows = loaded.flatMap((source) => mapSupplierRows(source, source.rows));
  const nextStatus = {
    ...status,
    sourceCount: loaded.reduce((sum, source) => sum + Number(source.sourceCount || 1), 0),
    sourceErrors,
    rowCount: rows.length,
    fanoutRequestCount: loaded.reduce((sum, source) => sum + Number(source.fanoutRequestCount || 0), 0),
    cacheHitCount: loaded.reduce((sum, source) => sum + Number(source.cacheHitCount || 0), 0),
    cacheMissCount: loaded.reduce((sum, source) => sum + Number(source.cacheMissCount || 0), 0)
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
    sourceCount: nextStatus.sourceCount,
    ...(upstreamPage ? upstreamPage : {})
  };
}

export async function probeSupplierApiCoverage(params, options = {}) {
  const status = getSupplierApiStatus();
  const sources = getSupplierApiSources();
  const destination = resolveDestination(params.city);
  const cities = getSupplierCoverageCities(destination, options);
  const probeLimit = getSupplierCoverageProbeLimit(options.probeLimit);
  const concurrency = getSupplierCoverageProbeConcurrency(options.concurrency);
  const startedAt = Date.now();

  if (!status.configured || !cities.length) {
    return buildSupplierCoverageSummary({
      status,
      cities,
      sourceResults: [],
      sourceErrors: [],
      requestCount: 0,
      probeLimit,
      concurrency,
      generatedMs: Date.now() - startedAt,
      query: buildSupplierCoverageQuery(params, destination)
    });
  }

  const tasks = cities.flatMap((city) =>
    sources.map((source) => async () => {
      const cityParams = {
        ...params,
        city: city.city,
        destinationType: 'city',
        limit: probeLimit,
        offset: 0
      };
      const loaded = await readSupplierApiSource(source, cityParams);
      const rows = mapSupplierRows(source, loaded.rows, city);
      const hotels = searchInventoryRows(rows, cityParams, {
        source: 'supplier-api',
        sourceLabel: source.name
      });

      return {
        province: city.province,
        city: city.city,
        sourceName: source.name,
        rowCount: rows.length,
        hotelCount: hotels.length
      };
    })
  );
  const loads = await settleLimited(tasks, concurrency);
  const sourceResults = loads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = loads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '实时供应商覆盖探测失败。');

  return buildSupplierCoverageSummary({
    status,
    cities,
    sourceResults,
    sourceErrors,
    requestCount: tasks.length,
    probeLimit,
    concurrency,
    generatedMs: Date.now() - startedAt,
    query: buildSupplierCoverageQuery(params, destination)
  });
}

export async function getSupplierDestinationCoverage(params = {}, options = {}) {
  const status = getSupplierApiStatus();
  const sources = getSupplierApiSources();
  const destination = resolveDestination(params.city);
  const cities = getSupplierCoverageCities(destination, options);
  const loads = await Promise.allSettled(sources.map(async (source) => {
    const destinationMap = await getSupplierDestinationMap(source);
    return buildSupplierDestinationSourceCoverage(source, destinationMap, cities);
  }));
  const sourceCoverage = loads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = loads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '实时供应商目的地编码表读取失败。');
  const cityCoverage = cities.map(({ province, city }) => {
    const coveredSources = sourceCoverage.filter((source) => source.coveredCitySet.has(city));
    return {
      province,
      city,
      covered: coveredSources.length > 0,
      sourceCount: coveredSources.length,
      sources: coveredSources.map((source) => source.sourceName),
      codes: coveredSources.map((source) => ({
        sourceName: source.sourceName,
        cityId: source.cityCodes.get(city)?.cityId || '',
        cityCode: source.cityCodes.get(city)?.cityCode || '',
        destinationId: source.cityCodes.get(city)?.destinationId || '',
        destinationCode: source.cityCodes.get(city)?.destinationCode || ''
      }))
    };
  });
  const coveredCities = cityCoverage.filter((item) => item.covered);
  const totalProvinces = new Set(cities.map((city) => city.province)).size;

  return {
    configured: status.configured,
    type: 'supplier-destination-map',
    generatedAt: new Date().toISOString(),
    query: {
      destinationType: destination.type,
      city: params.city || '',
      label: destination.label
    },
    apiCount: status.apiCount,
    sourceCount: sourceCoverage.length,
    sourceErrors,
    coveredCities: coveredCities.length,
    totalCities: cities.length,
    coverageRatio: cities.length ? Number((coveredCities.length / cities.length).toFixed(4)) : 0,
    coveredProvinces: new Set(coveredCities.map((item) => item.province)).size,
    totalProvinces,
    cityCoverage,
    missingCities: cityCoverage
      .filter((item) => !item.covered)
      .map(({ province, city }) => ({ province, city })),
    sourceCoverage: sourceCoverage.map(({ coveredCitySet, cityCodes, ...source }) => source)
  };
}

async function readSupplierApiSourceLoads(source, params) {
  const cities = getSupplierFanoutCities(source, params);
  if (!cities.length) return readSupplierApiSource(source, params);

  const loads = await settleLimited(
    cities.map((city) => async () => {
      const loaded = await readSupplierApiSource(source, {
        ...params,
        city: city.city,
        destinationType: 'city'
      });
      return {
        ...loaded,
        rows: loaded.rows.map((row) => ({ ...row, __supplierFallbackCity: city }))
      };
    }),
    source.cityFanoutConcurrency
  );
  const loaded = loads
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const sourceErrors = loads
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '实时供应商城市请求失败。');
  if (!loaded.length) {
    throw new Error(`${source.name} 的城市扇出请求全部失败。`);
  }

  return {
    ...source,
    rows: loaded.flatMap((item) => item.rows),
    pagination: null,
    sourceErrors,
    sourceCount: loaded.length,
    fanoutRequestCount: cities.length,
    cacheHitCount: loaded.reduce((sum, item) => sum + Number(item.cacheHitCount || 0), 0),
    cacheMissCount: loaded.reduce((sum, item) => sum + Number(item.cacheMissCount || 0), 0)
  };
}

async function readSupplierApiSource(source, params) {
  const { url, init } = await buildSupplierApiRequest(source, params);
  const cacheSeconds = getSupplierApiSourceCacheSeconds(source);
  const cacheKey = cacheSeconds > 0 ? buildSupplierApiCacheKey(source, url, init) : '';
  if (cacheKey) {
    const cached = supplierApiResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < cacheSeconds * 1000) {
      const parsed = cloneSupplierApiParsedResponse(cached.parsed);
      return {
        ...source,
        rows: parsed.rows,
        pagination: parsed.pagination,
        cache: 'hit',
        cacheHitCount: 1,
        cacheMissCount: 0,
        cachedAt: new Date(cached.cachedAt).toISOString()
      };
    }
  }

  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${redactUrl(url)} 返回 HTTP ${response.status}`);
  }

  const format = getSupplierApiResponseFormat(url, response.headers.get('content-type') || '');
  const parsed = parseSupplierApiResponse(text, format, source);
  if (cacheKey) {
    setSupplierApiResponseCache(cacheKey, parsed);
  }
  return {
    ...source,
    rows: parsed.rows,
    pagination: parsed.pagination,
    cache: cacheKey ? 'miss' : 'disabled',
    cacheHitCount: 0,
    cacheMissCount: cacheKey ? 1 : 0
  };
}

function getSupplierFanoutCities(source, params) {
  if (!source.cityFanout || !['nationwide', 'province'].includes(params.destinationType)) return [];
  const destination = resolveDestination(params.city);
  const cities = destination.type === 'nationwide' || destination.type === 'province'
    ? destination.cities
    : [];
  if (!cities.length) return [];
  return source.cityFanoutLimit > 0 ? cities.slice(0, source.cityFanoutLimit) : cities;
}

function getSupplierCoverageCities(destination, options = {}) {
  const cities = destination.type === 'nationwide' || destination.type === 'province'
    ? destination.cities
    : destination.type === 'city'
      ? [destination.city]
      : [];
  const cityLimit = getPositiveInteger(options.cityLimit, 0);
  return cityLimit > 0 ? cities.slice(0, cityLimit) : cities;
}

function getSupplierCoverageProbeLimit(value) {
  return getPositiveInteger(value ?? process.env.HOTEL_SUPPLIER_COVERAGE_PROBE_LIMIT, defaultSupplierCoverageProbeLimit);
}

function getSupplierCoverageProbeConcurrency(value) {
  return Math.min(
    getPositiveInteger(value ?? process.env.HOTEL_SUPPLIER_COVERAGE_PROBE_CONCURRENCY, defaultSupplierCoverageProbeConcurrency),
    maxSupplierCoverageProbeConcurrency
  );
}

function buildSupplierCoverageQuery(params, destination) {
  return {
    destinationType: destination.type,
    city: params.city || '',
    label: destination.label,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults,
    rooms: params.rooms,
    keyword: params.keyword || ''
  };
}

function buildSupplierCoverageSummary({
  status,
  cities,
  sourceResults,
  sourceErrors,
  requestCount,
  probeLimit,
  concurrency,
  generatedMs,
  query
}) {
  const resultsByCity = new Map();
  const resultsBySource = new Map();
  sourceResults.forEach((result) => {
    const cityResults = resultsByCity.get(result.city) || [];
    resultsByCity.set(result.city, [...cityResults, result]);
    const sourceResultsForName = resultsBySource.get(result.sourceName) || [];
    resultsBySource.set(result.sourceName, [...sourceResultsForName, result]);
  });

  const cityCoverage = cities.map(({ province, city }) => {
    const results = resultsByCity.get(city) || [];
    const coveredResults = results.filter((result) => result.hotelCount > 0);
    const sources = coveredResults.map((result) => result.sourceName);
    const rowCount = results.reduce((sum, result) => sum + result.rowCount, 0);
    const hotelCount = results.reduce((sum, result) => sum + result.hotelCount, 0);
    return {
      province,
      city,
      covered: hotelCount > 0,
      hotelCount,
      rowCount,
      sourceCount: unique(sources).length,
      sources: unique(sources)
    };
  });
  const coveredCities = cityCoverage.filter((item) => item.covered);
  const sourceCoverage = [...resultsBySource.entries()].map(([sourceName, results]) => {
    const citySet = new Set(results.filter((result) => result.hotelCount > 0).map((result) => result.city));
    const coveredCityItems = cities.filter((city) => citySet.has(city.city));
    return {
      sourceName,
      rowCount: results.reduce((sum, result) => sum + result.rowCount, 0),
      hotelCount: results.reduce((sum, result) => sum + result.hotelCount, 0),
      coveredCities: coveredCityItems.length,
      totalCities: cities.length,
      coverageRatio: cities.length ? Number((coveredCityItems.length / cities.length).toFixed(4)) : 0,
      coveredProvinces: new Set(coveredCityItems.map((city) => city.province)).size,
      totalProvinces: new Set(cities.map((city) => city.province)).size,
      missingCities: cities
        .filter((city) => !citySet.has(city.city))
        .map(({ province, city }) => ({ province, city }))
    };
  }).sort((a, b) => b.coveredCities - a.coveredCities || b.hotelCount - a.hotelCount || a.sourceName.localeCompare(b.sourceName, 'zh-CN'));
  const provinceCoverage = [...new Set(cities.map((city) => city.province))].map((province) => {
    const provinceCities = cities.filter((city) => city.province === province);
    const covered = provinceCities.filter((city) => cityCoverage.some((item) => item.city === city.city && item.covered));
    return {
      province,
      coveredCities: covered.length,
      totalCities: provinceCities.length,
      coverageRatio: provinceCities.length ? Number((covered.length / provinceCities.length).toFixed(4)) : 0,
      missingCities: provinceCities
        .filter((city) => !covered.some((item) => item.city === city.city))
        .map((city) => city.city)
    };
  });

  return {
    configured: status.configured,
    type: 'supplier-api',
    generatedAt: new Date().toISOString(),
    generatedMs,
    query,
    apiCount: status.apiCount,
    sourceCount: sourceCoverage.length,
    requestCount,
    completedRequestCount: sourceResults.length,
    failedRequestCount: sourceErrors.length,
    probeLimit,
    concurrency,
    sourceErrors,
    rowCount: sourceResults.reduce((sum, result) => sum + result.rowCount, 0),
    hotelCount: sourceResults.reduce((sum, result) => sum + result.hotelCount, 0),
    coveredCities: coveredCities.length,
    totalCities: cities.length,
    coverageRatio: cities.length ? Number((coveredCities.length / cities.length).toFixed(4)) : 0,
    coveredProvinces: new Set(coveredCities.map((item) => item.province)).size,
    totalProvinces: new Set(cities.map((city) => city.province)).size,
    cityCoverage,
    missingCities: cityCoverage
      .filter((item) => !item.covered)
      .map(({ province, city }) => ({ province, city })),
    sourceCoverage,
    provinceCoverage,
    catalogTotalCities: cityCatalog.length
  };
}

function buildSupplierDestinationSourceCoverage(source, destinationMap, cities) {
  const cityCodes = new Map();
  const cityCoverage = cities.map(({ province, city }) => {
    const destination = getSupplierDestinationValue(destinationMap, 'cities', city);
    const covered = Object.keys(destination).length > 0;
    const code = {
      cityId: pickDestinationValue(destination, ['cityId', 'id']) || '',
      cityCode: pickDestinationValue(destination, ['cityCode', 'code']) || '',
      destinationId: pickDestinationValue(destination, ['destinationId', 'cityId', 'id', 'code']) || '',
      destinationCode: pickDestinationValue(destination, ['destinationCode', 'cityCode', 'code', 'id']) || ''
    };
    if (covered) cityCodes.set(city, code);
    return {
      province,
      city,
      covered,
      ...code
    };
  });
  const coveredCities = cityCoverage.filter((item) => item.covered);
  const totalProvinces = new Set(cities.map((city) => city.province)).size;
  return {
    sourceName: source.name,
    configured: destinationMap.configured,
    destinationMapFile: source.destinationMapFile || '',
    destinationMapUrl: source.destinationMapUrl ? redactUrl(source.destinationMapUrl) : '',
    coveredCities: coveredCities.length,
    totalCities: cities.length,
    coverageRatio: cities.length ? Number((coveredCities.length / cities.length).toFixed(4)) : 0,
    coveredProvinces: new Set(coveredCities.map((item) => item.province)).size,
    totalProvinces,
    missingCities: cityCoverage
      .filter((item) => !item.covered)
      .map(({ province, city }) => ({ province, city })),
    cityCoverage,
    coveredCitySet: new Set(coveredCities.map((item) => item.city)),
    cityCodes
  };
}

async function settleLimited(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await tasks[currentIndex]()
        };
      } catch (error) {
        results[currentIndex] = {
          status: 'rejected',
          reason: error
        };
      }
    }
  }));
  return results;
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

async function buildSupplierApiRequest(source, params) {
  const method = source.method || getSupplierApiMethod();
  const url = new URL(source.url);
  const query = await buildSupplierQuery(params, source);
  const headers = {
    Accept: 'application/json, text/csv, application/x-ndjson',
    ...(source.headers || getSupplierApiHeaders())
  };
  const authHeaders = await getSupplierAuthHeaders(source);
  const requestHeaders = {
    ...headers,
    ...authHeaders
  };
  const init = {
    method,
    headers: requestHeaders,
    signal: AbortSignal.timeout(source.timeoutMs || getSupplierApiTimeoutMs())
  };

  if (method === 'GET') {
    appendSearchParams(url, query);
  } else {
    init.headers = { 'Content-Type': 'application/json', ...requestHeaders };
    init.body = JSON.stringify(query);
  }

  return { url, init };
}

async function getSupplierAuthHeaders(source) {
  if (!source.auth) return {};
  const token = await getSupplierAuthToken(source.auth, source);
  return {
    [source.auth.headerName]: formatAuthHeaderValue(source.auth, token)
  };
}

async function getSupplierAuthToken(auth, source) {
  const cacheKey = getSupplierAuthCacheKey(auth, source);
  const cached = supplierAuthCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + auth.cacheSkewMs) {
    return cached.accessToken;
  }

  const { url, init } = buildSupplierAuthRequest(auth);
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`${source.name || '实时供应商'} token 接口返回 HTTP ${response.status}`);
  }

  const accessToken = getMappedValue(payload, auth.tokenPath);
  if (!hasMappedValue(accessToken)) {
    throw new Error(`${source.name || '实时供应商'} token 响应缺少 access token。`);
  }
  const expiresIn = Number(getMappedValue(payload, auth.expiresInPath) || auth.expiresInSeconds);
  const expiresAt = Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : auth.expiresInSeconds) * 1000;
  supplierAuthCache.set(cacheKey, {
    accessToken: String(accessToken),
    expiresAt
  });
  return String(accessToken);
}

function buildSupplierAuthRequest(auth) {
  const method = auth.method || 'POST';
  const url = new URL(auth.tokenUrl);
  const payload = {
    ...auth.body,
    [auth.grantTypeField]: auth.grantType,
    [auth.clientIdField]: auth.clientId,
    [auth.clientSecretField]: auth.clientSecret
  };
  if (auth.scope) payload[auth.scopeField] = auth.scope;
  const headers = {
    Accept: 'application/json',
    ...auth.headers
  };
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(auth.timeoutMs)
  };

  if (method === 'GET') {
    appendSearchParams(url, payload);
    return { url, init };
  }

  if (auth.requestFormat === 'json') {
    init.headers = { 'Content-Type': 'application/json', ...headers };
    init.body = JSON.stringify(payload);
  } else {
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
    init.body = new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)]));
  }
  return { url, init };
}

function getSupplierAuthCacheKey(auth, source) {
  return [
    source.name,
    auth.tokenUrl,
    auth.clientId,
    auth.scope,
    JSON.stringify(auth.body)
  ].join('|');
}

function formatAuthHeaderValue(auth, token) {
  return auth.headerPrefix ? `${auth.headerPrefix} ${token}` : token;
}

async function buildSupplierQuery(params, source = {}) {
  const pagination = buildSupplierPaginationQuery(params);
  const destinationMap = await getSupplierDestinationMap(source);
  const destinationFields = buildSupplierDestinationQuery(params, { ...source, destinationMap });
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
    ...destinationFields,
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
    timeoutMs,
    cacheSeconds: getSupplierApiCacheSeconds()
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
      cacheSeconds: getNonNegativeInteger(item.cacheSeconds ?? item.cacheTtlSeconds ?? item.responseCacheSeconds, getSupplierApiCacheSeconds()),
      auth: normalizeSupplierAuth(item.auth),
      cityFanout: parseBoolean(item.cityFanout ?? item.fanoutCities ?? item.destinationFanout, false),
      cityFanoutLimit: getPositiveInteger(item.cityFanoutLimit ?? item.fanoutLimit, 0),
      cityFanoutConcurrency: getPositiveInteger(item.cityFanoutConcurrency ?? item.fanoutConcurrency, 4),
      destinationMap: normalizeSupplierDestinationMap(
        item.destinationMap || item.destinations || {
          cities: item.cityMap || item.cityCodes || item.cityIds,
          provinces: item.provinceMap || item.provinceCodes || item.provinceIds
        }
      ),
      destinationMapFile: normalizeOptionalString(item.destinationMapFile || item.destinationMapPath || item.cityMapFile || item.cityCodeFile),
      destinationMapUrl: normalizeOptionalString(item.destinationMapUrl || item.cityMapUrl || item.cityCodeUrl),
      destinationMapHeaders: normalizeHeaders(item.destinationMapHeaders || item.destinationMapUrlHeaders || {}),
      destinationMapCacheSeconds: getPositiveInteger(item.destinationMapCacheSeconds ?? item.mapCacheSeconds, defaultSupplierDestinationMapCacheSeconds),
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

function mapSupplierRows(source, rows, fallbackCity = null) {
  return rows.map((row) => {
    const mapped = mapSupplierRow(row, source.fieldMap);
    const rowFallbackCity = mapped.__supplierFallbackCity || fallbackCity;
    return {
      ...mapped,
      province: mapped.province || rowFallbackCity?.province,
      city: mapped.city || rowFallbackCity?.city,
      source: mapped.source || mapped.provider || mapped.supplier || mapped.providerName || source.name,
      __inventoryFile: source.name
    };
  });
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

async function getSupplierDestinationMap(source = {}) {
  const maps = [source.destinationMap];
  if (source.destinationMapFile) {
    maps.push(await readSupplierDestinationMapFile(source.destinationMapFile));
  }
  if (source.destinationMapUrl) {
    maps.push(await readSupplierDestinationMapUrl(source.destinationMapUrl, source));
  }
  return mergeSupplierDestinationMaps(...maps);
}

async function readSupplierDestinationMapFile(filePath) {
  const resolvedPath = resolve(filePath);
  const info = await stat(resolvedPath);
  const cacheKey = `destination-map-file:${resolvedPath}`;
  const cached = supplierDestinationMapCache.get(cacheKey);
  if (cached?.size === info.size && cached?.mtimeMs === info.mtimeMs) {
    return cached.map;
  }

  if (info.size > defaultSupplierDestinationMapMaxBytes) {
    throw new Error(`${resolvedPath} 目的地编码表超过 ${formatBytes(defaultSupplierDestinationMapMaxBytes)} 限制。`);
  }
  const text = await readFile(resolvedPath, 'utf8');
  const map = parseSupplierDestinationMapText(text, resolvedPath);
  supplierDestinationMapCache.set(cacheKey, {
    type: 'file',
    size: info.size,
    mtimeMs: info.mtimeMs,
    map,
    cachedAt: Date.now()
  });
  return map;
}

async function readSupplierDestinationMapUrl(url, source = {}) {
  const headers = source.destinationMapHeaders || {};
  const cacheKey = `destination-map-url:${url}:${JSON.stringify(headers)}`;
  const cached = supplierDestinationMapCache.get(cacheKey);
  const cacheTtlMs = Number(source.destinationMapCacheSeconds || defaultSupplierDestinationMapCacheSeconds) * 1000;
  if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
    return cached.map;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(source.timeoutMs || getSupplierApiTimeoutMs())
  });
  if (!response.ok) {
    throw new Error(`${redactUrl(url)} 目的地编码表返回 HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > defaultSupplierDestinationMapMaxBytes) {
    throw new Error(`${redactUrl(url)} 目的地编码表超过 ${formatBytes(defaultSupplierDestinationMapMaxBytes)} 限制。`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > defaultSupplierDestinationMapMaxBytes) {
    throw new Error(`${redactUrl(url)} 目的地编码表超过 ${formatBytes(defaultSupplierDestinationMapMaxBytes)} 限制。`);
  }
  const map = parseSupplierDestinationMapText(text, redactUrl(url));
  supplierDestinationMapCache.set(cacheKey, {
    type: 'url',
    map,
    cachedAt: Date.now()
  });
  return map;
}

function parseSupplierDestinationMapText(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} 目的地编码表必须是 JSON。`);
  }
  const map = normalizeSupplierDestinationMap(parsed);
  if (!map.configured) {
    throw new Error(`${label} 目的地编码表没有识别到城市或省份编码。`);
  }
  return map;
}

function buildSupplierDestinationQuery(params, source = {}) {
  const destination = resolveDestination(params.city);
  const city = destination.type === 'city' ? destination.city : null;
  const provinceName = city?.province || destination.province || (destination.type === 'province' ? destination.label : '');
  const supplierCity = city ? getSupplierDestinationValue(source.destinationMap, 'cities', city.city) : {};
  const supplierProvince = provinceName ? getSupplierDestinationValue(source.destinationMap, 'provinces', provinceName) : {};
  const supplierDestination = {
    ...supplierProvince,
    ...supplierCity
  };
  const cityCode = pickDestinationValue(supplierCity, ['cityCode', 'code', 'id']) || city?.code || '';
  const cityId = pickDestinationValue(supplierCity, ['cityId', 'id', 'code']) || '';
  const provinceCode = pickDestinationValue(supplierProvince, ['provinceCode', 'code', 'id']) || '';
  const provinceId = pickDestinationValue(supplierProvince, ['provinceId', 'id', 'code']) || '';

  return {
    cityName: city?.city || (destination.type === 'city' ? params.city || '' : ''),
    cityCode,
    cityId,
    province: provinceName,
    provinceName,
    provinceCode,
    provinceId,
    destinationLabel: destination.label,
    destinationCode: pickDestinationValue(supplierDestination, ['destinationCode', 'cityCode', 'provinceCode', 'code', 'id']) || cityCode || provinceCode,
    destinationId: pickDestinationValue(supplierDestination, ['destinationId', 'cityId', 'provinceId', 'id', 'code']) || cityId || provinceId,
    supplierDestination,
    supplierCity,
    supplierProvince
  };
}

function getSupplierDestinationValue(destinationMap, type, key) {
  if (!destinationMap?.configured || !key) return {};
  const typed = destinationMap[type]?.get(String(key).trim()) || destinationMap[type]?.get(normalizeDestinationInput(key));
  const shared = destinationMap.any?.get(String(key).trim()) || destinationMap.any?.get(normalizeDestinationInput(key));
  return typed || shared || {};
}

function pickDestinationValue(value, fields) {
  for (const field of fields) {
    if (hasMappedValue(value?.[field])) return value[field];
  }
  return '';
}

function normalizeSupplierDestinationMap(value) {
  if (!value || typeof value !== 'object') {
    return createEmptySupplierDestinationMap();
  }
  if (Array.isArray(value)) {
    return normalizeSupplierDestinationRows(value);
  }
  for (const key of ['destinations', 'items', 'data', 'records', 'list']) {
    if (Array.isArray(value[key])) return normalizeSupplierDestinationRows(value[key]);
  }
  const nestedKeys = new Set([
    'cities',
    'cityMap',
    'cityCodes',
    'cityIds',
    'provinces',
    'provinceMap',
    'provinceCodes',
    'provinceIds'
  ]);
  const directEntries = Object.fromEntries(Object.entries(value).filter(([key]) => !nestedKeys.has(key)));
  const cities = mergeMaps(
    normalizeSupplierDestinationEntryMap(value.cities || value.cityMap || value.cityCodes || value.cityIds, 'cities'),
    normalizeSupplierDestinationEntries(directEntries)
  );
  const provinces = mergeMaps(
    normalizeSupplierDestinationEntryMap(value.provinces || value.provinceMap || value.provinceCodes || value.provinceIds, 'provinces'),
    normalizeSupplierDestinationEntries(directEntries)
  );
  const any = normalizeSupplierDestinationEntries(directEntries);
  return {
    configured: Boolean(cities.size || provinces.size || any.size),
    cities,
    provinces,
    any
  };
}

function normalizeSupplierDestinationRows(rows) {
  const cities = new Map();
  const provinces = new Map();
  rows
    .filter((row) => row && !Array.isArray(row) && typeof row === 'object')
    .forEach((row) => {
      const cityName = getFirstDestinationField(row, ['city', 'cityName', 'destinationCity', '城市', '市', 'name', 'destinationName', '目的地']);
      const provinceName = getFirstDestinationField(row, ['province', 'provinceName', '省份', '省']);
      const normalizedDestination = normalizeSupplierDestinationValue(row);
      if (cityName) addSupplierDestinationEntry(cities, cityName, normalizedDestination);
      if (provinceName && (!cityName || hasProvinceDestinationFields(row))) {
        addSupplierDestinationEntry(provinces, provinceName, normalizedDestination);
      }
    });
  return {
    configured: Boolean(cities.size || provinces.size),
    cities,
    provinces,
    any: new Map()
  };
}

function normalizeSupplierDestinationEntryMap(value, type) {
  if (Array.isArray(value)) return normalizeSupplierDestinationRows(value)[type] || new Map();
  return normalizeSupplierDestinationEntries(value);
}

function normalizeSupplierDestinationEntries(value) {
  const entries = new Map();
  if (!value || Array.isArray(value) || typeof value !== 'object') return entries;
  Object.entries(value).forEach(([key, destination]) => {
    const trimmedKey = String(key || '').trim();
    const normalizedKey = normalizeDestinationInput(trimmedKey);
    const normalizedDestination = normalizeSupplierDestinationValue(destination);
    if (!normalizedKey || !Object.keys(normalizedDestination).length) return;
    addSupplierDestinationEntry(entries, trimmedKey, normalizedDestination);
  });
  return entries;
}

function addSupplierDestinationEntry(entries, key, value) {
  const trimmedKey = String(key || '').trim();
  const normalizedKey = normalizeDestinationInput(trimmedKey);
  if (!normalizedKey || !Object.keys(value).length) return;
  entries.set(trimmedKey, value);
  entries.set(normalizedKey, value);
}

function getFirstDestinationField(row, fields) {
  for (const field of fields) {
    const value = row[field];
    if (hasMappedValue(value)) return String(value).trim();
  }
  return '';
}

function hasProvinceDestinationFields(row) {
  return [
    'provinceId',
    'provinceCode',
    'province_id',
    'province_code',
    '省份ID',
    '省份编码',
    '省编码'
  ].some((field) => hasMappedValue(row[field]));
}

function normalizeSupplierDestinationValue(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'string' || typeof value === 'number') {
    return { code: String(value), id: String(value) };
  }
  if (!Array.isArray(value) && typeof value === 'object') {
    return cloneRequestDefaults(value);
  }
  return {};
}

function createEmptySupplierDestinationMap() {
  return { configured: false, cities: new Map(), provinces: new Map(), any: new Map() };
}

function mergeSupplierDestinationMaps(...destinationMaps) {
  const maps = destinationMaps.filter(Boolean);
  const cities = mergeMaps(...maps.map((map) => map.cities || new Map()));
  const provinces = mergeMaps(...maps.map((map) => map.provinces || new Map()));
  const any = mergeMaps(...maps.map((map) => map.any || new Map()));
  return {
    configured: Boolean(cities.size || provinces.size || any.size),
    cities,
    provinces,
    any
  };
}

function mergeMaps(...maps) {
  const merged = new Map();
  maps.forEach((map) => {
    map.forEach((value, key) => merged.set(key, value));
  });
  return merged;
}

function normalizeSupplierAuth(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const tokenUrl = String(value.tokenUrl || value.url || value.endpoint || '').trim();
  if (!tokenUrl) return null;
  const type = String(value.type || 'client_credentials').trim().toLowerCase().replace(/-/g, '_');
  if (type !== 'client_credentials') return null;
  return {
    type,
    tokenUrl,
    method: normalizeMethod(value.method || 'POST'),
    requestFormat: String(value.requestFormat || value.format || 'form').trim().toLowerCase() === 'json' ? 'json' : 'form',
    headers: normalizeHeaders(value.headers || {}),
    body: normalizeRequestDefaults(value.body || value.params || {}),
    clientId: getAuthConfigValue(value.clientId, value.clientIdEnv),
    clientSecret: getAuthConfigValue(value.clientSecret, value.clientSecretEnv),
    clientIdField: String(value.clientIdField || 'client_id'),
    clientSecretField: String(value.clientSecretField || 'client_secret'),
    grantType: String(value.grantType || 'client_credentials'),
    grantTypeField: String(value.grantTypeField || 'grant_type'),
    scope: getAuthConfigValue(value.scope, value.scopeEnv),
    scopeField: String(value.scopeField || 'scope'),
    tokenPath: normalizePathList(value.tokenPath || value.accessTokenPath || 'access_token'),
    expiresInPath: normalizePathList(value.expiresInPath || value.expiresPath || 'expires_in'),
    expiresInSeconds: getPositiveInteger(value.expiresInSeconds, 3600),
    headerName: String(value.headerName || 'Authorization'),
    headerPrefix: value.headerPrefix === null || value.headerPrefix === false ? '' : String(value.headerPrefix || 'Bearer'),
    timeoutMs: getPositiveInteger(value.timeoutMs, getSupplierApiTimeoutMs()),
    cacheSkewMs: getPositiveInteger(value.cacheSkewSeconds, 60) * 1000
  };
}

function getAuthConfigValue(value, envName) {
  if (envName && process.env[String(envName)]) return process.env[String(envName)];
  return value === undefined || value === null ? '' : String(value);
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

function getSupplierApiSourceCacheSeconds(source = {}) {
  return getNonNegativeInteger(source.cacheSeconds, getSupplierApiCacheSeconds());
}

function getSupplierApiCacheSeconds() {
  return getNonNegativeInteger(process.env.HOTEL_SUPPLIER_API_CACHE_SECONDS, defaultSupplierApiCacheSeconds);
}

function buildSupplierApiCacheKey(source, url, init) {
  return [
    'supplier-api',
    source.name,
    init.method || 'GET',
    url.toString(),
    init.body || ''
  ].join('|');
}

function setSupplierApiResponseCache(cacheKey, parsed) {
  supplierApiResponseCache.set(cacheKey, {
    parsed: cloneSupplierApiParsedResponse(parsed),
    cachedAt: Date.now()
  });
  const maxEntries = getSupplierApiCacheMaxEntries();
  while (supplierApiResponseCache.size > maxEntries) {
    const oldestKey = supplierApiResponseCache.keys().next().value;
    supplierApiResponseCache.delete(oldestKey);
  }
}

function getSupplierApiCacheMaxEntries() {
  return getPositiveInteger(process.env.HOTEL_SUPPLIER_API_CACHE_MAX_ENTRIES, defaultSupplierApiCacheMaxEntries);
}

function cloneSupplierApiParsedResponse(parsed) {
  return JSON.parse(JSON.stringify({
    rows: parsed?.rows || [],
    pagination: parsed?.pagination || null
  }));
}

function normalizeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  return method === 'POST' ? 'POST' : 'GET';
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
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

function getNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
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

function normalizeOptionalString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

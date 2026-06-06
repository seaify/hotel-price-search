import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cityCatalog } from '../server/hotel-data.js';

const defaultManifestPath = 'public/hotel-inventory.manifest.json';

export async function auditInventoryCoverage(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  const manifestPath = resolve(rootDir, options.manifestPath || defaultManifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sources = getManifestSources(manifest);
  const minHotelsPerCity = Math.max(
    options.requireCityHotels ? 1 : 0,
    getNonNegativeInteger(options.minHotelsPerCity, 0)
  );
  const minRowsPerCity = getNonNegativeInteger(options.minRowsPerCity, 0);
  const minPricedHotelsPerCity = getNonNegativeInteger(options.minPricedHotelsPerCity, 0);
  const minPricedRowsPerCity = getNonNegativeInteger(options.minPricedRowsPerCity, 0);
  const maxPriceAgeHours = getNonNegativeNumber(options.maxPriceAgeHours, 0);
  const referenceTime = normalizeTimestamp(options.referenceTime || options.now || new Date().toISOString());
  const freshnessCutoff = maxPriceAgeHours && referenceTime
    ? new Date(new Date(referenceTime).getTime() - maxPriceAgeHours * 60 * 60 * 1000).toISOString()
    : '';
  const query = normalizeAuditQuery(options);
  const dateFiltered = Boolean(query);
  const coveredCitySet = new Set();
  const unknownDestinations = new Set();
  const unscopedSources = [];
  const cityStatsByCity = new Map();
  const sourceCoverage = [];

  sources.forEach((source, index) => {
    const coverage = getSourceCoverage(source);
    const sourceName = getSourceName(source, index);
    const effectiveStats = coverage.cityStats.map((stat) => ({
      ...stat,
      ...getCityStatCountsForQuery(stat, query)
    }));
    if (dateFiltered) {
      effectiveStats
        .filter((stat) => stat.rowCount > 0 || stat.hotelCount > 0)
        .forEach((stat) => coveredCitySet.add(stat.city));
    } else {
      coverage.cities.forEach((city) => coveredCitySet.add(city));
    }
    coverage.unknownDestinations.forEach((destination) => unknownDestinations.add(destination));
    effectiveStats.forEach((stat) => {
      const existing = cityStatsByCity.get(stat.city) || {
        province: stat.province,
        city: stat.city,
        rowCount: 0,
        hotelCount: 0,
        pricedRowCount: 0,
        pricedHotelCount: 0,
        minPrice: 0,
        updatedAt: '',
        sources: new Set()
      };
      existing.rowCount += stat.rowCount;
      existing.hotelCount += stat.hotelCount;
      existing.pricedRowCount += stat.pricedRowCount;
      existing.pricedHotelCount += stat.pricedHotelCount;
      existing.minPrice = minPositivePrice(existing.minPrice, stat.minPrice);
      existing.updatedAt = maxTimestamp(existing.updatedAt, stat.updatedAt);
      if (stat.rowCount > 0 || stat.hotelCount > 0 || stat.pricedRowCount > 0 || stat.pricedHotelCount > 0) existing.sources.add(sourceName);
      cityStatsByCity.set(stat.city, existing);
    });
    if (!coverage.hasScope) {
      unscopedSources.push({
        name: getSourceName(source, index),
        url: source.url || source.href || ''
      });
    }
    const effectiveCities = dateFiltered
      ? effectiveStats.filter((stat) => stat.rowCount > 0 || stat.hotelCount > 0).map((stat) => stat.city)
      : coverage.cities;
    sourceCoverage.push({
      name: sourceName,
      url: source.url || source.href || '',
      cityCount: effectiveCities.length,
      cities: effectiveCities.sort((a, b) => a.localeCompare(b, 'zh-CN')),
      provinces: coverage.provinces,
      cityStatsCount: coverage.cityStats.length,
      rowCount: effectiveStats.reduce((sum, stat) => sum + stat.rowCount, 0),
      hotelCount: effectiveStats.reduce((sum, stat) => sum + stat.hotelCount, 0),
      pricedRowCount: effectiveStats.reduce((sum, stat) => sum + stat.pricedRowCount, 0),
      pricedHotelCount: effectiveStats.reduce((sum, stat) => sum + stat.pricedHotelCount, 0),
      minPrice: effectiveStats.reduce((minimum, stat) => minPositivePrice(minimum, stat.minPrice), 0),
      unknownDestinations: coverage.unknownDestinations,
      hasScope: coverage.hasScope
    });
  });

  const missingCities = cityCatalog
    .filter((item) => !coveredCitySet.has(item.city))
    .map(({ province, city }) => ({ province, city }));
  const coveredCities = cityCatalog.filter((item) => coveredCitySet.has(item.city));
  const coveredProvinceSet = new Set(coveredCities.map((item) => item.province));
  const provinceSet = new Set(cityCatalog.map((item) => item.province));
  const citiesWithHotelStats = cityCatalog
    .filter((item) => Number(cityStatsByCity.get(item.city)?.hotelCount || 0) > 0)
    .map(({ province, city }) => ({ province, city }));
  const citiesWithoutHotelStats = options.requireCityHotels
    ? cityCatalog
      .filter((item) => Number(cityStatsByCity.get(item.city)?.hotelCount || 0) <= 0)
      .map(({ province, city }) => ({ province, city }))
    : [];
  const citiesBelowMinimums = minHotelsPerCity || minRowsPerCity
    ? cityCatalog
      .map(({ province, city }) => {
        const stats = cityStatsByCity.get(city) || {};
        return {
          province,
          city,
          rowCount: Number(stats.rowCount || 0),
          hotelCount: Number(stats.hotelCount || 0),
          minRowCount: minRowsPerCity,
          minHotelCount: minHotelsPerCity
        };
      })
      .filter((item) => item.hotelCount < minHotelsPerCity || item.rowCount < minRowsPerCity)
    : [];
  const citiesWithPricedHotels = cityCatalog
    .filter((item) => Number(cityStatsByCity.get(item.city)?.pricedHotelCount || 0) > 0)
    .map(({ province, city }) => ({ province, city }));
  const citiesBelowPriceMinimums = minPricedHotelsPerCity || minPricedRowsPerCity
    ? cityCatalog
      .map(({ province, city }) => {
        const stats = cityStatsByCity.get(city) || {};
        return {
          province,
          city,
          pricedRowCount: Number(stats.pricedRowCount || 0),
          pricedHotelCount: Number(stats.pricedHotelCount || 0),
          minPricedRowCount: minPricedRowsPerCity,
          minPricedHotelCount: minPricedHotelsPerCity,
          minPrice: Number(stats.minPrice || 0)
        };
      })
      .filter((item) => item.pricedHotelCount < minPricedHotelsPerCity || item.pricedRowCount < minPricedRowsPerCity)
    : [];
  const citiesWithFreshPrices = freshnessCutoff
    ? cityCatalog
      .filter((item) => {
        const updatedAt = cityStatsByCity.get(item.city)?.updatedAt || '';
        return updatedAt && updatedAt >= freshnessCutoff;
      })
      .map(({ province, city }) => ({ province, city }))
    : [];
  const citiesWithStalePrices = freshnessCutoff
    ? cityCatalog
      .map(({ province, city }) => ({
        province,
        city,
        updatedAt: cityStatsByCity.get(city)?.updatedAt || '',
        maxPriceAgeHours,
        referenceTime
      }))
      .filter((item) => !item.updatedAt || item.updatedAt < freshnessCutoff)
    : [];
  const basePassed = missingCities.length === 0 && unscopedSources.length === 0 && unknownDestinations.size === 0;
  const effectiveRowCount = dateFiltered
    ? [...cityStatsByCity.values()].reduce((sum, item) => sum + Number(item.rowCount || 0), 0)
    : sumSourceNumber(sources, 'rowCount');
  const effectiveHotelCount = dateFiltered
    ? [...cityStatsByCity.values()].reduce((sum, item) => sum + Number(item.hotelCount || 0), 0)
    : sumSourceNumber(sources, 'hotelCount');
  const effectivePricedRowCount = dateFiltered
    ? [...cityStatsByCity.values()].reduce((sum, item) => sum + Number(item.pricedRowCount || 0), 0)
    : sumSourceNumber(sources, 'pricedRowCount') || [...cityStatsByCity.values()].reduce((sum, item) => sum + Number(item.pricedRowCount || 0), 0);
  const effectivePricedHotelCount = dateFiltered
    ? [...cityStatsByCity.values()].reduce((sum, item) => sum + Number(item.pricedHotelCount || 0), 0)
    : sumSourceNumber(sources, 'pricedHotelCount') || [...cityStatsByCity.values()].reduce((sum, item) => sum + Number(item.pricedHotelCount || 0), 0);
  const summary = {
    manifestPath,
    sourceCount: sources.length,
    scopedSourceCount: sourceCoverage.filter((source) => source.hasScope).length,
    unscopedSourceCount: unscopedSources.length,
    rowCount: effectiveRowCount,
    hotelCount: effectiveHotelCount,
    pricedRowCount: effectivePricedRowCount,
    pricedHotelCount: effectivePricedHotelCount,
    coveredCities: coveredCities.length,
    totalCities: cityCatalog.length,
    coverageRatio: cityCatalog.length ? Number((coveredCities.length / cityCatalog.length).toFixed(4)) : 0,
    coveredProvinces: coveredProvinceSet.size,
    totalProvinces: provinceSet.size,
    minHotelsPerCity,
    minRowsPerCity,
    minPricedHotelsPerCity,
    minPricedRowsPerCity,
    maxPriceAgeHours,
    freshnessCutoff,
    citiesWithHotelStats: citiesWithHotelStats.length,
    citiesWithPricedHotels: citiesWithPricedHotels.length,
    citiesWithFreshPrices: citiesWithFreshPrices.length,
    totalCitiesWithRequiredHotelStats: options.requireCityHotels ? cityCatalog.length : 0,
    citiesWithoutHotelStats,
    citiesBelowMinimums,
    citiesBelowPriceMinimums,
    citiesWithStalePrices,
    missingCities,
    unscopedSources,
    unknownDestinations: [...unknownDestinations].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    sourceCoverage: sourceCoverage.sort((a, b) => b.cityCount - a.cityCount || a.name.localeCompare(b.name, 'zh-CN')),
    query,
    passed: basePassed && citiesWithoutHotelStats.length === 0 && citiesBelowMinimums.length === 0 && citiesBelowPriceMinimums.length === 0 && citiesWithStalePrices.length === 0
  };

  if (options.missingCsvPath) {
    await writeFile(resolve(rootDir, options.missingCsvPath), buildMissingCitiesCsv(summary), 'utf8');
  }
  return summary;
}

function getManifestSources(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (Array.isArray(manifest?.sources)) return manifest.sources;
  if (Array.isArray(manifest?.feeds)) return manifest.feeds;
  if (Array.isArray(manifest?.inventorySources)) return manifest.inventorySources;
  return [];
}

function getSourceCoverage(source) {
  const cityStats = getSourceCityStats(source);
  const cityValues = collectDestinationValues([
    source.city,
    source.cities,
    source.cityName,
    source.cityNames,
    source.coverageCities
  ]);
  const provinceValues = collectDestinationValues([
    source.province,
    source.provinces,
    source.provinceName,
    source.provinceNames,
    source.coverageProvinces
  ]);
  const destinationValues = collectDestinationValues([
    source.destination,
    source.destinations,
    source.coverage,
    source.scope
  ]);
  const cities = new Set();
  const provinces = new Set();
  const unknownDestinations = new Set();

  cityStats.forEach((stat) => {
    cities.add(stat.city);
  });
  cityValues.forEach((value) => {
    const city = findCity(value);
    if (city) {
      cities.add(city.city);
    } else {
      const province = findProvince(value);
      if (province) provinces.add(province);
      else unknownDestinations.add(normalizeDestinationInput(value));
    }
  });
  provinceValues.forEach((value) => {
    const province = findProvince(value);
    if (province) provinces.add(province);
    else unknownDestinations.add(normalizeDestinationInput(value));
  });
  destinationValues.forEach((value) => {
    const province = findProvince(value);
    if (province) {
      provinces.add(province);
      return;
    }
    const city = findCity(value);
    if (city) cities.add(city.city);
    else unknownDestinations.add(normalizeDestinationInput(value));
  });

  provinces.forEach((province) => {
    cityCatalog
      .filter((item) => item.province === province)
      .forEach((item) => cities.add(item.city));
  });

  return {
    cities: [...cities].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    provinces: [...provinces].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    unknownDestinations: [...unknownDestinations].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    cityStats,
    hasScope: Boolean(cityValues.length || provinceValues.length || destinationValues.length || cityStats.length)
  };
}

function getSourceCityStats(source) {
  const rawStats = source.cityStats || source.cityCoverage || source.coverageByCity || [];
  const values = Array.isArray(rawStats)
    ? rawStats
    : Object.entries(rawStats || {}).map(([city, value]) => (
      value && typeof value === 'object' ? { city, ...value } : { city, hotelCount: value }
    ));

  return values
    .map(normalizeCityStat)
    .filter(Boolean)
    .sort((a, b) => a.province.localeCompare(b.province, 'zh-CN') || a.city.localeCompare(b.city, 'zh-CN'));
}

function normalizeCityStat(value) {
  if (!value || typeof value !== 'object') return null;
  const rawCity = value.city || value.cityName || value.destination || value.name;
  const rawProvince = value.province || value.provinceName;
  const city = findCity(rawCity);
  if (!city) return null;
  return {
    province: findProvince(rawProvince) || city.province,
    city: city.city,
    rowCount: Number(value.rowCount ?? value.rows ?? value.rateCount ?? value.priceCount ?? 0),
    hotelCount: Number(value.hotelCount ?? value.hotels ?? 0),
    pricedRowCount: Number(value.pricedRowCount ?? value.pricedRows ?? value.rowsWithPrice ?? value.priceRows ?? value.pricedRateCount ?? 0),
    pricedHotelCount: Number(value.pricedHotelCount ?? value.pricedHotels ?? value.hotelsWithPrice ?? value.priceHotelCount ?? 0),
    minPrice: Number(value.minPrice ?? value.lowestPrice ?? 0) || 0,
    updatedAt: normalizeTimestamp(value.updatedAt || value.fetchedAt || value.syncedAt || value.priceUpdatedAt || value.rateUpdatedAt || ''),
    dateStats: normalizeDateStats(value.dateStats || value.availabilityStats || value.stayStats || [])
  };
}

function normalizeDateStats(rawStats) {
  const values = Array.isArray(rawStats)
    ? rawStats
    : Object.entries(rawStats || {}).map(([range, value]) => {
      const [checkIn, checkOut] = range.split('|');
      return value && typeof value === 'object'
        ? { checkIn, checkOut, ...value }
        : { checkIn, checkOut, hotelCount: value };
    });

  return values
    .map((value) => {
      if (!value || typeof value !== 'object') return null;
      return {
        checkIn: normalizeDate(value.checkIn || value.startDate || value.availableFrom || ''),
        checkOut: normalizeDate(value.checkOut || value.endDate || value.availableTo || ''),
        rowCount: Number(value.rowCount ?? value.rows ?? value.rateCount ?? value.priceCount ?? 0),
        hotelCount: Number(value.hotelCount ?? value.hotels ?? 0),
        pricedRowCount: Number(value.pricedRowCount ?? value.pricedRows ?? value.rowsWithPrice ?? value.priceRows ?? value.pricedRateCount ?? 0),
        pricedHotelCount: Number(value.pricedHotelCount ?? value.pricedHotels ?? value.hotelsWithPrice ?? value.priceHotelCount ?? 0),
        minPrice: Number(value.minPrice ?? value.lowestPrice ?? 0) || 0,
        updatedAt: normalizeTimestamp(value.updatedAt || value.fetchedAt || value.syncedAt || value.priceUpdatedAt || value.rateUpdatedAt || '')
      };
    })
    .filter(Boolean);
}

function getCityStatCountsForQuery(stat, query) {
  if (!query) return {
    rowCount: stat.rowCount,
    hotelCount: stat.hotelCount,
    pricedRowCount: stat.pricedRowCount,
    pricedHotelCount: stat.pricedHotelCount,
    minPrice: stat.minPrice,
    updatedAt: stat.updatedAt
  };
  const matchingDateStats = (stat.dateStats || []).filter((dateStat) => dateStatCoversStay(dateStat, query));
  return {
    rowCount: matchingDateStats.reduce((sum, dateStat) => sum + Number(dateStat.rowCount || 0), 0),
    hotelCount: matchingDateStats.reduce((sum, dateStat) => sum + Number(dateStat.hotelCount || 0), 0),
    pricedRowCount: matchingDateStats.reduce((sum, dateStat) => sum + Number(dateStat.pricedRowCount || 0), 0),
    pricedHotelCount: matchingDateStats.reduce((sum, dateStat) => sum + Number(dateStat.pricedHotelCount || 0), 0),
    minPrice: matchingDateStats.reduce((minimum, dateStat) => minPositivePrice(minimum, dateStat.minPrice), 0),
    updatedAt: matchingDateStats.reduce((latest, dateStat) => maxTimestamp(latest, dateStat.updatedAt), '') || stat.updatedAt
  };
}

function dateStatCoversStay(dateStat, query) {
  if (!dateStat.checkIn && !dateStat.checkOut) return true;
  if (dateStat.checkIn && dateStat.checkOut) {
    return dateStat.checkIn <= query.checkIn && dateStat.checkOut >= query.checkOut;
  }
  if (dateStat.checkIn) return dateStat.checkIn === query.checkIn;
  return dateStat.checkOut === query.checkOut;
}

function collectDestinationValues(values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return collectDestinationValues(value);
    if (!value) return [];
    return String(value).split(/[|,，、;\n]/).map((item) => item.trim()).filter(Boolean);
  });
}

function findCity(value) {
  const normalized = normalizeDestinationInput(value);
  if (!normalized) return null;
  return cityCatalog.find((item) => item.city === normalized)
    || cityCatalog.find((item) => normalized.includes(item.city))
    || null;
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

function normalizeAuditQuery(options = {}) {
  const checkIn = normalizeDate(options.checkIn);
  const checkOut = normalizeDate(options.checkOut);
  if (!checkIn || !checkOut) return null;
  return { checkIn, checkOut };
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

function maxTimestamp(current, next) {
  if (!next) return current || '';
  if (!current) return next;
  return next > current ? next : current;
}

function minPositivePrice(current, next) {
  const price = Number(next || 0);
  if (!Number.isFinite(price) || price <= 0) return current || 0;
  if (!current) return price;
  return price < current ? price : current;
}

function getSourceName(source, index) {
  return String(source.name || source.provider || source.supplier || `供应商源${index + 1}`);
}

function sumSourceNumber(sources, field) {
  return sources.reduce((sum, source) => sum + Number(source?.[field] || 0), 0);
}

function getNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function getNonNegativeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function buildMissingCitiesCsv(summary) {
  const rows = [
    ['province', 'city'],
    ...summary.missingCities.map((item) => [item.province, item.city])
  ];
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatAuditText(summary) {
  const percent = (summary.coverageRatio * 100).toFixed(1);
  const lines = [
    `Inventory coverage: ${summary.coveredCities}/${summary.totalCities} cities (${percent}%)`,
    summary.query ? `Stay dates: ${summary.query.checkIn} to ${summary.query.checkOut}` : '',
    `Province coverage: ${summary.coveredProvinces}/${summary.totalProvinces}`,
    `Sources: ${summary.scopedSourceCount}/${summary.sourceCount} scoped${summary.unscopedSourceCount ? `, ${summary.unscopedSourceCount} unscoped` : ''}`,
    `Rows: ${summary.rowCount || 0}, hotels: ${summary.hotelCount || 0}`
  ].filter(Boolean);
  if (summary.missingCities.length) {
    lines.push(`Missing cities: ${summary.missingCities.slice(0, 20).map((item) => `${item.province}/${item.city}`).join(', ')}${summary.missingCities.length > 20 ? ` ... +${summary.missingCities.length - 20}` : ''}`);
  }
  if (summary.citiesWithoutHotelStats.length) {
    lines.push(`Cities without hotel stats: ${summary.citiesWithoutHotelStats.slice(0, 20).map((item) => `${item.province}/${item.city}`).join(', ')}${summary.citiesWithoutHotelStats.length > 20 ? ` ... +${summary.citiesWithoutHotelStats.length - 20}` : ''}`);
  }
  if (summary.citiesBelowMinimums.length) {
    lines.push(`Cities below minimums: ${summary.citiesBelowMinimums.slice(0, 20).map((item) => `${item.province}/${item.city} hotels ${item.hotelCount}/${item.minHotelCount}, rows ${item.rowCount}/${item.minRowCount}`).join(', ')}${summary.citiesBelowMinimums.length > 20 ? ` ... +${summary.citiesBelowMinimums.length - 20}` : ''}`);
  }
  if (summary.citiesBelowPriceMinimums.length) {
    lines.push(`Cities below price minimums: ${summary.citiesBelowPriceMinimums.slice(0, 20).map((item) => `${item.province}/${item.city} priced hotels ${item.pricedHotelCount}/${item.minPricedHotelCount}, priced rows ${item.pricedRowCount}/${item.minPricedRowCount}`).join(', ')}${summary.citiesBelowPriceMinimums.length > 20 ? ` ... +${summary.citiesBelowPriceMinimums.length - 20}` : ''}`);
  }
  if (summary.citiesWithStalePrices.length) {
    lines.push(`Cities with stale prices: ${summary.citiesWithStalePrices.slice(0, 20).map((item) => `${item.province}/${item.city} updated ${item.updatedAt || 'missing'}`).join(', ')}${summary.citiesWithStalePrices.length > 20 ? ` ... +${summary.citiesWithStalePrices.length - 20}` : ''}`);
  }
  if (summary.unscopedSources.length) {
    lines.push(`Unscoped sources: ${summary.unscopedSources.map((source) => source.name).join(', ')}`);
  }
  if (summary.unknownDestinations.length) {
    lines.push(`Unknown destinations: ${summary.unknownDestinations.join(', ')}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') options.manifestPath = argv[++index];
    else if (arg === '--missing-csv') options.missingCsvPath = argv[++index];
    else if (arg === '--check-in') options.checkIn = argv[++index];
    else if (arg === '--check-out') options.checkOut = argv[++index];
    else if (arg === '--require-all-cities') options.requireAllCities = true;
    else if (arg === '--require-city-hotels') options.requireCityHotels = true;
    else if (arg === '--min-hotels-per-city') options.minHotelsPerCity = argv[++index];
    else if (arg === '--min-rows-per-city') options.minRowsPerCity = argv[++index];
    else if (arg === '--min-priced-hotels-per-city') options.minPricedHotelsPerCity = argv[++index];
    else if (arg === '--min-priced-rows-per-city') options.minPricedRowsPerCity = argv[++index];
    else if (arg === '--max-price-age-hours') options.maxPriceAgeHours = argv[++index];
    else if (arg === '--reference-time') options.referenceTime = argv[++index];
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/audit-inventory-coverage.js [options]

Options:
  --manifest <file>       Manifest file. Default: public/hotel-inventory.manifest.json
  --missing-csv <file>    Write missing city CSV report
  --check-in YYYY-MM-DD   Audit inventory available for this check-in date
  --check-out YYYY-MM-DD  Audit inventory available through this check-out date
  --require-all-cities    Exit non-zero unless all catalog cities are explicitly covered
  --require-city-hotels   Also require cityStats hotelCount > 0 for every catalog city
  --min-hotels-per-city N Require at least N cityStats hotels per city
  --min-rows-per-city N   Require at least N cityStats rows per city
  --min-priced-hotels-per-city N Require at least N priced hotels per city
  --min-priced-rows-per-city N   Require at least N priced rows per city
  --max-price-age-hours N Require every city price update to be within N hours
  --reference-time <time> Reference timestamp for freshness checks. Default: now
  --json                  Print full JSON summary
`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const summary = await auditInventoryCoverage(options);
      console.log(options.json ? JSON.stringify(summary, null, 2) : formatAuditText(summary));
      const shouldGate = options.requireAllCities
        || options.requireCityHotels
        || getNonNegativeInteger(options.minHotelsPerCity, 0) > 0
        || getNonNegativeInteger(options.minRowsPerCity, 0) > 0
        || getNonNegativeInteger(options.minPricedHotelsPerCity, 0) > 0
        || getNonNegativeInteger(options.minPricedRowsPerCity, 0) > 0
        || getNonNegativeNumber(options.maxPriceAgeHours, 0) > 0;
      if (shouldGate && !summary.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

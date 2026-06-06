import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildDemoHotels, cityCatalog } from '../server/hotel-data.js';
import { createHotelServer, searchHotels } from '../server/index.js';
import { clearInventoryCache } from '../server/providers/local-inventory.js';

describe('hotel search data', () => {
  it('covers major cities nationwide', () => {
    assert.ok(cityCatalog.length >= 300);
    assert.ok(cityCatalog.some((city) => city.city === '北京'));
    assert.ok(cityCatalog.some((city) => city.city === '三亚'));
    assert.ok(cityCatalog.some((city) => city.city === '乌鲁木齐'));
    assert.ok(cityCatalog.some((city) => city.city === '喀什'));
  });

  it('filters demo hotels by price and star', () => {
    const hotels = buildDemoHotels({
      city: '上海',
      checkIn: '2026-06-06',
      checkOut: '2026-06-08',
      star: '5',
      maxPrice: '2000'
    });

    assert.ok(hotels.length > 0);
    assert.ok(hotels.every((hotel) => hotel.city === '上海'));
    assert.ok(hotels.every((hotel) => hotel.star === 5));
    assert.ok(hotels.every((hotel) => hotel.price <= 2000));
    assert.ok(hotels.every((hotel) => hotel.nights === 2));
  });

  it('returns nationwide demo results without a city', async () => {
    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    const result = await searchHotels({
      city: '',
      keyword: '近商圈',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07'
    });

    assert.equal(result.source, 'demo');
    assert.ok(result.hotels.length > 20);
    assert.ok(result.total > result.hotels.length);
    assert.equal(result.pagination.hasMore, true);
    assert.equal(result.pagination.nextOffset, result.hotels.length);
    assert.ok(new Set(result.hotels.map((hotel) => hotel.city)).size > 10);
  });

  it('paginates nationwide results with limit and offset', async () => {
    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    const firstPage = await searchHotels({
      city: '',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07',
      limit: '10',
      offset: '0'
    });
    const secondPage = await searchHotels({
      city: '',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07',
      limit: '10',
      offset: '10'
    });

    assert.equal(firstPage.hotels.length, 10);
    assert.equal(secondPage.hotels.length, 10);
    assert.equal(firstPage.total, secondPage.total);
    assert.notEqual(firstPage.hotels[0].id, secondPage.hotels[0].id);
    assert.ok(firstPage.coverageCities >= 300);
  });

  it('returns province-wide demo results for province destinations', async () => {
    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;

    const result = await searchHotels({
      city: '广东省',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07',
      limit: '100'
    });

    assert.equal(result.source, 'demo');
    assert.equal(result.query.city, '广东');
    assert.equal(result.query.destinationType, 'province');
    assert.equal(result.coverageCities, 21);
    assert.equal(result.total, 21 * 14);
    assert.ok(result.hotels.every((hotel) => hotel.province === '广东'));
    assert.ok(result.hotels.some((hotel) => hotel.city === '深圳'));
    assert.ok(result.hotels.some((hotel) => hotel.city === '广州'));
  });

  it('does not fall back to Beijing for unknown destinations', async () => {
    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;

    const result = await searchHotels({
      city: '不存在目的地',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07'
    });

    assert.equal(result.source, 'demo');
    assert.equal(result.query.destinationType, 'unknown');
    assert.equal(result.total, 0);
    assert.equal(result.hotels.length, 0);
  });

  it('prefers province intent for destinations with province suffixes', async () => {
    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;

    const result = await searchHotels({
      city: '海南省',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07',
      limit: '100'
    });

    assert.equal(result.query.city, '海南');
    assert.equal(result.query.destinationType, 'province');
    assert.equal(result.coverageCities, 19);
    assert.ok(result.hotels.every((hotel) => hotel.province === '海南'));
  });

  it('prefers a configured local inventory file over demo data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-inventory-'));
    const filePath = join(dir, 'prices.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(filePath, JSON.stringify([
      {
        id: 'real-001',
        name: '北京真实供应商酒店',
        province: '北京',
        city: '北京',
        district: '朝阳',
        star: 5,
        rating: 4.9,
        price: 999,
        tags: ['真实库存', '近商圈'],
        amenities: ['早餐'],
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));

    process.env.HOTEL_DATA_FILE = filePath;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    try {
      const result = await searchHotels({
        city: '北京',
        keyword: '真实供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '北京真实供应商酒店');
    } finally {
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('filters real supplier inventory by province destination', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-province-inventory-'));
    const filePath = join(dir, 'province.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(filePath, JSON.stringify([
      {
        id: 'gd-001',
        name: '广州省域供应商酒店',
        province: '广东',
        city: '广州',
        district: '天河',
        price: 620,
        source: '省域供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'gd-002',
        name: '深圳省域供应商酒店',
        province: '广东',
        city: '深圳',
        district: '南山',
        price: 720,
        source: '省域供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'fj-001',
        name: '厦门省域供应商酒店',
        province: '福建',
        city: '厦门',
        district: '思明',
        price: 680,
        source: '省域供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));

    process.env.HOTEL_DATA_FILE = filePath;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    clearInventoryCache();

    try {
      const result = await searchHotels({
        city: '广东',
        keyword: '省域供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.query.destinationType, 'province');
      assert.equal(result.total, 2);
      assert.equal(result.coverageCities, 2);
      assert.ok(result.hotels.every((hotel) => hotel.province === '广东'));
      assert.ok(result.hotels.some((hotel) => hotel.city === '广州'));
      assert.ok(result.hotels.some((hotel) => hotel.city === '深圳'));
    } finally {
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes administrative suffixes in supplier province and city fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-admin-normalize-'));
    const filePath = join(dir, 'admin.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(filePath, JSON.stringify([
      {
        id: 'admin-gd-001',
        name: '深圳行政全称供应商酒店',
        province: '广东省',
        city: '深圳市',
        price: 720,
        source: '行政区供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'admin-gd-002',
        name: '广州合并行政供应商酒店',
        city: '广东省广州市',
        price: 620,
        source: '行政区供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'admin-gx-001',
        name: '南宁自治区供应商酒店',
        province: '广西壮族自治区',
        city: '南宁市',
        price: 520,
        source: '行政区供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'admin-hi-001',
        name: '海南省字段供应商酒店',
        province: '海南省',
        city: '海南省',
        price: 500,
        source: '行政区供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));

    process.env.HOTEL_DATA_FILE = filePath;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    clearInventoryCache();

    try {
      const guangdong = await searchHotels({
        city: '广东省',
        keyword: '行政',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(guangdong.source, 'local');
      assert.equal(guangdong.total, 2);
      assert.ok(guangdong.hotels.every((hotel) => hotel.province === '广东'));
      assert.ok(guangdong.hotels.some((hotel) => hotel.city === '深圳'));
      assert.ok(guangdong.hotels.some((hotel) => hotel.city === '广州'));

      const guangxi = await searchHotels({
        city: '广西',
        keyword: '自治区',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(guangxi.total, 1);
      assert.equal(guangxi.hotels[0].province, '广西');
      assert.equal(guangxi.hotels[0].city, '南宁');

      const hainan = await searchHotels({
        city: '海南省',
        keyword: '字段',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(hainan.total, 1);
      assert.equal(hainan.hotels[0].province, '海南');
      assert.equal(hainan.hotels[0].city, '');
    } finally {
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports real inventory city coverage through the HTTP API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-coverage-'));
    const filePath = join(dir, 'coverage.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(filePath, JSON.stringify([
      {
        id: 'coverage-bj-001',
        name: '北京覆盖统计酒店',
        province: '北京',
        city: '北京',
        price: 900,
        source: '覆盖供应商A',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'coverage-sh-001',
        name: '上海覆盖统计酒店',
        province: '上海',
        city: '上海',
        price: 990,
        source: '覆盖供应商A',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'coverage-sz-001',
        name: '深圳覆盖统计酒店',
        province: '广东',
        city: '深圳',
        price: 880,
        source: '覆盖供应商B',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));

    process.env.HOTEL_DATA_FILE = filePath;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    clearInventoryCache();

    const server = createHotelServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const coverageResponse = await fetch(`${baseUrl}/api/coverage`);
      const coverage = await coverageResponse.json();
      assert.equal(coverageResponse.status, 200);
      assert.equal(coverage.rowCount, 3);
      assert.equal(coverage.hotelCount, 3);
      assert.equal(coverage.coveredCities, 3);
      assert.equal(coverage.totalCities, cityCatalog.length);
      assert.equal(coverage.coveredProvinces, 3);
      assert.ok(coverage.cityCoverage.some((item) => item.province === '北京' && item.city === '北京' && item.covered && item.hotelCount === 1));
      assert.ok(coverage.cityCoverage.some((item) => item.province === '北京' && item.city === '北京' && item.sourceCount === 1 && item.sources.includes('覆盖供应商A')));
      assert.ok(coverage.cityCoverage.some((item) => item.province === '广东' && item.city === '深圳' && item.sources.includes('覆盖供应商B')));
      assert.ok(coverage.cityCoverage.some((item) => item.province === '广东' && item.city === '广州' && !item.covered && item.hotelCount === 0));
      assert.ok(coverage.missingCities.some((item) => item.province === '广东' && item.city === '广州'));
      assert.ok(coverage.sourceCoverage.some((item) => item.sourceName === '覆盖供应商A' && item.coveredCities === 2 && item.hotelCount === 2));
      assert.ok(coverage.sourceCoverage.some((item) => item.sourceName === '覆盖供应商B' && item.coveredCities === 1 && item.hotelCount === 1));
      assert.ok(coverage.provinceCoverage.some((item) => item.province === '广东' && item.coveredCities === 1 && item.totalCities === 21));

      const csvResponse = await fetch(`${baseUrl}/api/coverage?format=csv`);
      const csv = await csvResponse.text();
      assert.equal(csvResponse.status, 200);
      assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
      assert.match(csv, /province,city,covered,hotelCount,rowCount,sourceCount,sources/);
      assert.match(csv, /北京,北京,yes,1,1,1,覆盖供应商A/);
      assert.match(csv, /广东,深圳,yes,1,1,1,覆盖供应商B/);
      assert.match(csv, /广东,广州,no,0,0,0,/);

      const statusResponse = await fetch(`${baseUrl}/api/status`);
      const status = await statusResponse.json();
      assert.equal(status.localInventory.coverage.coveredCities, 3);
      assert.equal(status.localInventory.coverage.totalCities, cityCatalog.length);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('filters real inventory coverage by requested stay dates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-date-coverage-'));
    const filePath = join(dir, 'date-coverage.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(filePath, JSON.stringify([
      {
        id: 'date-coverage-bj-001',
        name: '北京日期覆盖酒店',
        province: '北京',
        city: '北京',
        price: 900,
        source: '日期覆盖供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'date-coverage-gz-001',
        name: '广州过期覆盖酒店',
        province: '广东',
        city: '广州',
        price: 700,
        source: '日期覆盖供应商',
        checkIn: '2026-01-01',
        checkOut: '2026-02-01',
        available: true
      }
    ]));

    process.env.HOTEL_DATA_FILE = filePath;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    clearInventoryCache();

    const server = createHotelServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const coverageResponse = await fetch(`${baseUrl}/api/coverage?checkIn=2026-06-06&checkOut=2026-06-07`);
      const coverage = await coverageResponse.json();
      assert.equal(coverageResponse.status, 200);
      assert.deepEqual(coverage.query, { checkIn: '2026-06-06', checkOut: '2026-06-07' });
      assert.equal(coverage.coveredCities, 1);
      assert.ok(coverage.cityCoverage.some((item) => item.province === '北京' && item.city === '北京' && item.covered));
      assert.ok(coverage.cityCoverage.some((item) => item.province === '广东' && item.city === '广州' && !item.covered && item.hotelCount === 0));
      assert.ok(coverage.missingCities.some((item) => item.province === '广东' && item.city === '广州'));
      assert.equal(coverage.sourceCoverage[0].coveredCities, 1);

      const csvResponse = await fetch(`${baseUrl}/api/coverage.csv?checkIn=2026-06-06&checkOut=2026-06-07`);
      const csv = await csvResponse.text();
      assert.equal(csvResponse.status, 200);
      assert.match(csv, /北京,北京,yes,1,1,1,日期覆盖供应商/);
      assert.match(csv, /广东,广州,no,0,0,0,/);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('probes live supplier API coverage by city through the HTTP API', async () => {
    const envKeys = [
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'HOTEL_SUPPLIER_COVERAGE_PROBE_LIMIT',
      'HOTEL_SUPPLIER_COVERAGE_PROBE_CONCURRENCY',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);

    const requestedCities = [];
    const requestedPageSizes = [];
    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const city = url.searchParams.get('cityName');
      requestedCities.push(city);
      requestedPageSizes.push(url.searchParams.get('pageSize'));
      const availableCities = new Set(['南京', '无锡']);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: availableCities.has(city)
          ? [
              {
                id: `coverage-probe-${city}`,
                hotelName: `${city}实时覆盖酒店`,
                province: '江苏省',
                city: `${city}市`,
                price: city === '南京' ? 560 : 460,
                source: '覆盖探测供应商',
                checkIn: '2026-06-01',
                checkOut: '2026-12-31',
                available: true
              }
            ]
          : []
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const supplierAddress = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '覆盖探测供应商',
      url: `http://127.0.0.1:${supplierAddress.port}/probe`,
      method: 'GET',
      requestMap: {
        cityName: 'city',
        pageSize: 'limit'
      }
    });

    const server = createHotelServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const coverageResponse = await fetch(`${baseUrl}/api/supplier-coverage?city=江苏省&checkIn=2026-06-06&checkOut=2026-06-07&cityLimit=3&probeLimit=1&concurrency=1`);
      const coverage = await coverageResponse.json();
      assert.equal(coverageResponse.status, 200);
      assert.equal(coverage.configured, true);
      assert.equal(coverage.query.destinationType, 'province');
      assert.equal(coverage.query.label, '江苏');
      assert.equal(coverage.totalCities, 3);
      assert.equal(coverage.coveredCities, 2);
      assert.equal(coverage.requestCount, 3);
      assert.equal(coverage.completedRequestCount, 3);
      assert.equal(coverage.failedRequestCount, 0);
      assert.equal(coverage.probeLimit, 1);
      assert.equal(coverage.concurrency, 1);
      assert.deepEqual(requestedCities, ['南京', '无锡', '徐州']);
      assert.deepEqual(requestedPageSizes, ['1', '1', '1']);
      assert.ok(coverage.cityCoverage.some((item) => item.city === '南京' && item.covered && item.sources.includes('覆盖探测供应商')));
      assert.ok(coverage.cityCoverage.some((item) => item.city === '无锡' && item.covered));
      assert.ok(coverage.cityCoverage.some((item) => item.city === '徐州' && !item.covered));
      assert.ok(coverage.missingCities.some((item) => item.province === '江苏' && item.city === '徐州'));
      assert.equal(coverage.sourceCoverage[0].sourceName, '覆盖探测供应商');
      assert.equal(coverage.sourceCoverage[0].coveredCities, 2);
      assert.equal(coverage.sourceCoverage[0].hotelCount, 2);

      const csvResponse = await fetch(`${baseUrl}/api/supplier-coverage.csv?city=江苏省&checkIn=2026-06-06&checkOut=2026-06-07&cityLimit=3&probeLimit=1&concurrency=1`);
      const csv = await csvResponse.text();
      assert.equal(csvResponse.status, 200);
      assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
      assert.match(csvResponse.headers.get('content-disposition'), /hotel-supplier-coverage\.csv/);
      assert.match(csv, /江苏,南京,yes,1,1,1,覆盖探测供应商/);
      assert.match(csv, /江苏,徐州,no,0,0,0,/);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
    }
  });

  it('refreshes cached local inventory when the supplier file changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-refresh-'));
    const filePath = join(dir, 'prices.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    process.env.HOTEL_DATA_FILE = filePath;
    clearInventoryCache();

    try {
      await writeFile(filePath, JSON.stringify([
        {
          id: 'refresh-001',
          name: '南京刷新供应商酒店',
          province: '江苏',
          city: '南京',
          district: '玄武',
          price: 520,
          checkIn: '2026-06-01',
          checkOut: '2026-12-31',
          available: true
        }
      ]));

      const first = await searchHotels({
        city: '南京',
        keyword: '刷新供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(first.hotels[0].price, 520);

      await writeFile(filePath, JSON.stringify([
        {
          id: 'refresh-001',
          name: '南京刷新供应商酒店',
          province: '江苏',
          city: '南京',
          district: '玄武',
          price: 430,
          source: '刷新后的供应商',
          checkIn: '2026-06-01',
          checkOut: '2026-12-31',
          available: true
        }
      ]));

      const second = await searchHotels({
        city: '南京',
        keyword: '刷新供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(second.hotels[0].price, 430);
    } finally {
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges multiple supplier files and shows the lowest price per hotel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-suppliers-'));
    const ctripPath = join(dir, 'ctrip.json');
    const meituanPath = join(dir, 'meituan.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(ctripPath, JSON.stringify([
      {
        id: 'shared-001',
        name: '上海多供应商酒店',
        province: '上海',
        city: '上海',
        district: '黄浦',
        star: 5,
        rating: 4.8,
        price: 1180,
        source: '携程供应商',
        tags: ['真实库存'],
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));
    await writeFile(meituanPath, JSON.stringify([
      {
        id: 'shared-001',
        name: '上海多供应商酒店',
        province: '上海',
        city: '上海',
        district: '黄浦',
        star: 5,
        rating: 4.7,
        price: 980,
        source: '美团供应商',
        tags: ['真实库存'],
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));

    delete process.env.HOTEL_DATA_FILE;
    process.env.HOTEL_DATA_FILES = `${ctripPath},${meituanPath}`;
    delete process.env.HOTEL_IMPORT_DIR;
    try {
      const result = await searchHotels({
        city: '上海',
        keyword: '多供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].price, 980);
      assert.equal(result.hotels[0].offerCount, 2);
      assert.deepEqual(result.hotels[0].providerNames.sort(), ['携程供应商', '美团供应商'].sort());
      assert.equal(result.providers.localInventory.readableCount, 2);
    } finally {
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges supplier hotels by master hotel id across different channel ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-master-id-'));
    const ctripPath = join(dir, 'ctrip-master.json');
    const meituanPath = join(dir, 'meituan-master.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(ctripPath, JSON.stringify([
      {
        id: 'ctrip-sh-991',
        masterHotelId: 'CN-SH-HOTEL-0001',
        name: '上海统一ID江景酒店',
        province: '上海',
        city: '上海',
        district: '浦东',
        address: '上海市浦东新区滨江大道 1 号',
        star: 5,
        rating: 4.8,
        price: 1280,
        source: '携程供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));
    await writeFile(meituanPath, JSON.stringify([
      {
        id: 'meituan-8842',
        standardHotelId: 'CN-SH-HOTEL-0001',
        name: '上海陆家嘴江景大酒店',
        province: '上海市',
        city: '上海市',
        district: '陆家嘴',
        address: '上海浦东滨江大道一号',
        star: 5,
        rating: 4.7,
        price: 1080,
        source: '美团供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ]));

    delete process.env.HOTEL_DATA_FILE;
    process.env.HOTEL_DATA_FILES = `${ctripPath},${meituanPath}`;
    delete process.env.HOTEL_IMPORT_DIR;

    try {
      const result = await searchHotels({
        city: '上海',
        keyword: '江景',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].masterHotelId, 'cn-sh-hotel-0001');
      assert.equal(result.hotels[0].price, 1080);
      assert.equal(result.hotels[0].offerCount, 2);
      assert.deepEqual(result.hotels[0].providerNames.sort(), ['携程供应商', '美团供应商'].sort());
      assert.deepEqual(result.hotels[0].rates.map((rate) => rate.price), [1080, 1280]);
    } finally {
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads JSON Lines supplier exports from local files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-jsonl-'));
    const filePath = join(dir, 'prices.ndjson');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    const lines = [
      {
        id: 'jsonl-001',
        hotelName: '重庆JSONL供应商酒店',
        province: '重庆',
        city: '重庆',
        district: '渝中',
        price: 558,
        source: 'JSONL供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      },
      {
        id: 'jsonl-002',
        hotelName: '重庆JSONL备用酒店',
        province: '重庆',
        city: '重庆',
        district: '江北',
        price: 498,
        source: 'JSONL供应商',
        checkIn: '2026-06-01',
        checkOut: '2026-12-31',
        available: true
      }
    ].map((row) => JSON.stringify(row)).join('\n');
    await writeFile(filePath, lines);

    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    process.env.HOTEL_DATA_FILE = filePath;
    clearInventoryCache();

    try {
      const result = await searchHotels({
        city: '重庆',
        keyword: 'JSONL',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 2);
      assert.equal(result.hotels[0].providerName, 'JSONL供应商');
      assert.ok(result.hotels.some((hotel) => hotel.name === '重庆JSONL供应商酒店'));
    } finally {
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads gzip-compressed supplier CSV files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-gzip-'));
    const filePath = join(dir, 'prices.csv.gz');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    const csv = [
      'id,name,province,city,district,address,star,rating,price,currency,tags,source,checkIn,checkOut,available',
      'gzip-001,厦门压缩供应商酒店,福建,厦门,思明,厦门市思明区环岛路 1 号,5,4.8,788,CNY,真实库存,压缩CSV供应商,2026-06-01,2026-12-31,true'
    ].join('\n');
    await writeFile(filePath, gzipSync(Buffer.from(csv, 'utf8')));

    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    process.env.HOTEL_DATA_FILE = filePath;
    clearInventoryCache();

    try {
      const result = await searchHotels({
        city: '厦门',
        keyword: '压缩供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '厦门压缩供应商酒店');
      assert.equal(result.hotels[0].price, 788);
      assert.equal(result.hotels[0].providerName, '压缩CSV供应商');
    } finally {
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('expands nested hotel rooms and rates from supplier JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-nested-'));
    const filePath = join(dir, 'nested.json');
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    await writeFile(filePath, JSON.stringify({
      provider: '嵌套供应商',
      hotels: [
        {
          id: 'nested-001',
          hotelName: '成都嵌套报价酒店',
          province: '四川',
          city: '成都',
          district: '锦江',
          address: '成都市锦江区春熙路 88 号',
          star: 5,
          rating: 4.8,
          amenities: ['泳池', '免费 Wi-Fi'],
          tags: ['真实库存', '春熙路'],
          rooms: [
            {
              roomName: '高级大床房',
              amenities: ['浴缸'],
              rates: [
                {
                  rateName: '含早可取消',
                  price: 760,
                  originalPrice: 920,
                  checkIn: '2026-06-01',
                  checkOut: '2026-12-31',
                  available: true,
                  payment: '在线付',
                  cancellation: '限时免费取消',
                  bookingUrl: 'https://example.com/nested-001-breakfast'
                },
                {
                  rateName: '不含早',
                  price: 680,
                  checkIn: '2026-06-01',
                  checkOut: '2026-12-31',
                  available: true,
                  payment: '到店付',
                  cancellation: '预订前确认',
                  bookingUrl: 'https://example.com/nested-001-room-only'
                }
              ]
            },
            {
              roomName: '行政套房',
              offers: [
                {
                  rateName: '双早礼遇',
                  price: 1280,
                  checkIn: '2026-06-01',
                  checkOut: '2026-12-31',
                  available: true,
                  bookingUrl: 'https://example.com/nested-001-suite'
                }
              ]
            }
          ]
        }
      ]
    }));

    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    process.env.HOTEL_DATA_FILE = filePath;
    clearInventoryCache();

    try {
      const result = await searchHotels({
        city: '成都',
        keyword: '嵌套报价',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '成都嵌套报价酒店');
      assert.equal(result.hotels[0].price, 680);
      assert.equal(result.hotels[0].offerCount, 3);
      assert.equal(result.hotels[0].rates[0].roomName, '高级大床房 · 不含早');
      assert.equal(result.hotels[0].rates[2].roomName, '行政套房 · 双早礼遇');
      assert.ok(result.hotels[0].amenities.includes('泳池'));
      assert.ok(result.hotels[0].amenities.includes('浴缸'));
      assert.equal(result.hotels[0].bookingUrl, 'https://example.com/nested-001-room-only');
    } finally {
      clearInventoryCache();
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports a supplier file through the HTTP API and makes it searchable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-upload-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    process.env.HOTEL_IMPORT_DIR = dir;

    const server = createHotelServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const csv = [
        'id,name,province,city,district,address,star,rating,price,currency,tags,source,checkIn,checkOut,available',
        'upload-001,广州上传导入酒店,广东,广州,天河,广州市天河路 1 号,4,4.6,688,CNY,真实库存,上传供应商,2026-06-01,2026-12-31,true'
      ].join('\n');
      const importResponse = await fetch(`${baseUrl}/api/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'upload.csv', content: csv })
      });
      const imported = await importResponse.json();
      assert.equal(importResponse.status, 201);
      assert.equal(imported.imported.rowCount, 1);
      assert.equal(imported.providers.localInventory.readableCount, 1);

      const searchResponse = await fetch(`${baseUrl}/api/search?city=%E5%B9%BF%E5%B7%9E&keyword=%E4%B8%8A%E4%BC%A0%E5%AF%BC%E5%85%A5&checkIn=2026-06-06&checkOut=2026-06-07`);
      const result = await searchResponse.json();
      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '广州上传导入酒店');
      assert.equal(result.hotels[0].price, 688);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('imports Chinese-header supplier CSV files without manual column mapping', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-zh-upload-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    process.env.HOTEL_IMPORT_DIR = dir;

    const server = createHotelServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const csv = [
        '酒店ID,酒店名称,省份,城市,行政区,酒店地址,星级,用户评分,最低价,推荐标签,供应商,入住日期,离店日期,是否可售,预订链接',
        'zh-001,杭州中文导入酒店,浙江,杭州,西湖,杭州市西湖区文三路 9 号,4,4.7,¥588,真实库存,中文供应商,2026年06月01日,2026年12月31日,可售,https://example.com/hotels/zh-001'
      ].join('\n');
      const importResponse = await fetch(`${baseUrl}/api/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: '中文供应商.csv', content: csv })
      });
      assert.equal(importResponse.status, 201);

      const searchResponse = await fetch(`${baseUrl}/api/search?city=%E6%9D%AD%E5%B7%9E&keyword=%E4%B8%AD%E6%96%87%E5%AF%BC%E5%85%A5&checkIn=2026-06-06&checkOut=2026-06-07`);
      const result = await searchResponse.json();
      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '杭州中文导入酒店');
      assert.equal(result.hotels[0].price, 588);
      assert.equal(result.hotels[0].providerName, '中文供应商');
      assert.equal(result.hotels[0].bookingUrl, 'https://example.com/hotels/zh-001');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('queries a configured live supplier API and normalizes hotel prices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousApiUrl = process.env.HOTEL_SUPPLIER_API_URL;
    const previousApiUrls = process.env.HOTEL_SUPPLIER_API_URLS;
    const previousApiConfig = process.env.HOTEL_SUPPLIER_API_CONFIG;
    const previousApiName = process.env.HOTEL_SUPPLIER_API_NAME;
    const previousApiNames = process.env.HOTEL_SUPPLIER_API_NAMES;
    const previousApiMethod = process.env.HOTEL_SUPPLIER_API_METHOD;
    const previousApiHeaders = process.env.HOTEL_SUPPLIER_API_HEADERS;
    const previousAmadeusId = process.env.AMADEUS_CLIENT_ID;
    const previousAmadeusSecret = process.env.AMADEUS_CLIENT_SECRET;
    const requests = [];

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_SUPPLIER_API_URLS;
    delete process.env.HOTEL_SUPPLIER_API_CONFIG;
    delete process.env.HOTEL_SUPPLIER_API_NAMES;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    process.env.HOTEL_IMPORT_DIR = dir;
    process.env.HOTEL_SUPPLIER_API_NAME = '测试实时供应商';
    process.env.HOTEL_SUPPLIER_API_METHOD = 'GET';
    process.env.HOTEL_SUPPLIER_API_HEADERS = JSON.stringify({ Authorization: 'Bearer supplier-token' });
    clearInventoryCache();

    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      requests.push({
        city: url.searchParams.get('city'),
        checkIn: url.searchParams.get('checkIn'),
        checkOut: url.searchParams.get('checkOut'),
        adults: url.searchParams.get('adults'),
        authorization: request.headers.authorization
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'live-api-001',
            hotelName: '杭州实时供应商酒店',
            province: '浙江省',
            city: '杭州市',
            district: '西湖',
            price: 688,
            source: '测试实时供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true,
            bookingUrl: 'https://example.com/live-api-001'
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_URL = `http://127.0.0.1:${address.port}/prices?api_key=secret-value`;

    try {
      const result = await searchHotels({
        city: '杭州',
        keyword: '实时供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        adults: '2',
        rooms: '1'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.mode, 'supplier-api');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].source, 'supplier-api');
      assert.equal(result.hotels[0].name, '杭州实时供应商酒店');
      assert.equal(result.hotels[0].province, '浙江');
      assert.equal(result.hotels[0].city, '杭州');
      assert.equal(result.hotels[0].price, 688);
      assert.equal(result.hotels[0].bookingUrl, 'https://example.com/live-api-001');
      assert.equal(result.providers.supplierApi.configured, true);
      assert.equal(result.providers.supplierApi.name, '测试实时供应商');
      assert.equal(result.providers.supplierApi.url, `http://127.0.0.1:${address.port}/prices?api_key=REDACTED`);
      assert.deepEqual(result.providers.supplierApi.urls, [`http://127.0.0.1:${address.port}/prices?api_key=REDACTED`]);
      assert.equal(result.providers.supplierApi.apiCount, 1);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].city, '杭州');
      assert.equal(requests[0].checkIn, '2026-06-06');
      assert.equal(requests[0].checkOut, '2026-06-07');
      assert.equal(requests[0].adults, '2');
      assert.equal(requests[0].authorization, 'Bearer supplier-token');
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousApiUrl === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URL;
      } else {
        process.env.HOTEL_SUPPLIER_API_URL = previousApiUrl;
      }
      if (previousApiUrls === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URLS;
      } else {
        process.env.HOTEL_SUPPLIER_API_URLS = previousApiUrls;
      }
      if (previousApiConfig === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_CONFIG;
      } else {
        process.env.HOTEL_SUPPLIER_API_CONFIG = previousApiConfig;
      }
      if (previousApiName === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAME;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAME = previousApiName;
      }
      if (previousApiNames === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAMES;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAMES = previousApiNames;
      }
      if (previousApiMethod === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_METHOD;
      } else {
        process.env.HOTEL_SUPPLIER_API_METHOD = previousApiMethod;
      }
      if (previousApiHeaders === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_HEADERS;
      } else {
        process.env.HOTEL_SUPPLIER_API_HEADERS = previousApiHeaders;
      }
      if (previousAmadeusId === undefined) {
        delete process.env.AMADEUS_CLIENT_ID;
      } else {
        process.env.AMADEUS_CLIENT_ID = previousAmadeusId;
      }
      if (previousAmadeusSecret === undefined) {
        delete process.env.AMADEUS_CLIENT_SECRET;
      } else {
        process.env.AMADEUS_CLIENT_SECRET = previousAmadeusSecret;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('caches identical live supplier API responses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-response-cache-'));
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'HOTEL_SUPPLIER_API_CACHE_SECONDS',
      'HOTEL_SUPPLIER_API_STALE_CACHE_SECONDS',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    let requestCount = 0;
    const supplierServer = createHttpServer((request, response) => {
      requestCount += 1;
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'cache-live-001',
            hotelName: '上海缓存实时供应商酒店',
            province: '上海市',
            city: '上海市',
            price: 730,
            source: '缓存供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '缓存供应商',
      url: `http://127.0.0.1:${address.port}/cached-prices`,
      method: 'GET',
      cacheSeconds: 30
    });

    try {
      const query = {
        city: '上海',
        keyword: '缓存实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      };
      const first = await searchHotels(query);
      const second = await searchHotels(query);

      assert.equal(first.source, 'supplier-api');
      assert.equal(second.source, 'supplier-api');
      assert.equal(first.total, 1);
      assert.equal(second.total, 1);
      assert.equal(requestCount, 1);
      assert.equal(first.providers.supplierApi.cacheConfigured, true);
      assert.equal(first.providers.supplierApi.cacheMissCount, 1);
      assert.equal(first.providers.supplierApi.cacheHitCount, 0);
      assert.equal(second.providers.supplierApi.cacheMissCount, 0);
      assert.equal(second.providers.supplierApi.cacheHitCount, 1);
      assert.equal(second.hotels[0].name, '上海缓存实时供应商酒店');
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses stale cached live supplier API responses after transient failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-stale-cache-'));
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'HOTEL_SUPPLIER_API_CACHE_SECONDS',
      'HOTEL_SUPPLIER_API_STALE_CACHE_SECONDS',
      'HOTEL_SUPPLIER_API_RETRY_COUNT',
      'HOTEL_SUPPLIER_API_RETRY_DELAY_MS',
      'HOTEL_SUPPLIER_API_RETRY_STATUS_CODES',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    let requestCount = 0;
    const supplierServer = createHttpServer((request, response) => {
      requestCount += 1;
      if (requestCount === 2) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'temporarily_unavailable' }));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'stale-live-001',
            hotelName: '深圳过期缓存实时供应商酒店',
            province: '广东省',
            city: '深圳市',
            price: 710,
            source: '过期缓存供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '过期缓存供应商',
      url: `http://127.0.0.1:${address.port}/stale-prices`,
      method: 'GET',
      cacheSeconds: 0,
      staleCacheSeconds: 60,
      retryCount: 0
    });

    try {
      const query = {
        city: '深圳',
        keyword: '过期缓存实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      };
      const first = await searchHotels(query);
      const second = await searchHotels(query);

      assert.equal(first.source, 'supplier-api');
      assert.equal(second.source, 'supplier-api');
      assert.equal(first.total, 1);
      assert.equal(second.total, 1);
      assert.equal(requestCount, 2);
      assert.equal(first.providers.supplierApi.staleCacheConfigured, true);
      assert.equal(first.providers.supplierApi.cacheMissCount, 1);
      assert.equal(first.providers.supplierApi.cacheStaleCount, 0);
      assert.equal(second.providers.supplierApi.cacheHitCount, 0);
      assert.equal(second.providers.supplierApi.cacheStaleCount, 1);
      assert.equal(second.hotels[0].name, '深圳过期缓存实时供应商酒店');
      assert.ok(second.providers.supplierApi.sourceErrors.some((message) => /已使用过期缓存/.test(message)));
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('retries transient live supplier API failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-retry-'));
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'HOTEL_SUPPLIER_API_STALE_CACHE_SECONDS',
      'HOTEL_SUPPLIER_API_RETRY_COUNT',
      'HOTEL_SUPPLIER_API_RETRY_DELAY_MS',
      'HOTEL_SUPPLIER_API_RETRY_STATUS_CODES',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    let requestCount = 0;
    const supplierServer = createHttpServer((request, response) => {
      requestCount += 1;
      if (requestCount === 1) {
        response.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': '0'
        });
        response.end(JSON.stringify({ error: 'temporarily_unavailable' }));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'retry-live-001',
            hotelName: '广州重试实时供应商酒店',
            province: '广东省',
            city: '广州市',
            price: 650,
            source: '重试供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '重试供应商',
      url: `http://127.0.0.1:${address.port}/retry-prices`,
      method: 'GET',
      retryCount: 1,
      retryDelayMs: 1,
      retryStatusCodes: [503]
    });

    try {
      const result = await searchHotels({
        city: '广州',
        keyword: '重试实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '广州重试实时供应商酒店');
      assert.equal(result.providers.supplierApi.retryConfigured, true);
      assert.equal(result.providers.supplierApi.retryCount, 1);
      assert.equal(result.providers.supplierApi.retryAttemptCount, 1);
      assert.equal(requestCount, 2);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fetches and caches client credentials tokens for live supplier APIs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-auth-'));
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET',
      'SUPPLIER_CLIENT_ID',
      'SUPPLIER_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = dir;
    process.env.SUPPLIER_CLIENT_ID = 'client-id';
    process.env.SUPPLIER_CLIENT_SECRET = 'client-secret';
    clearInventoryCache();

    let tokenRequestCount = 0;
    let priceRequestCount = 0;
    const tokenBodies = [];
    const priceAuthorizations = [];
    const supplierServer = createHttpServer(async (request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/oauth/token') {
        let body = '';
        for await (const chunk of request) body += chunk;
        tokenRequestCount += 1;
        tokenBodies.push(Object.fromEntries(new URLSearchParams(body)));
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
          access_token: 'supplier-live-token',
          expires_in: 3600
        }));
        return;
      }

      priceRequestCount += 1;
      priceAuthorizations.push(request.headers.authorization);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'auth-live-001',
            hotelName: '南京Token实时供应商酒店',
            province: '江苏省',
            city: '南京市',
            district: '秦淮',
            price: 566,
            source: 'Token实时供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: 'Token实时供应商',
      url: `http://127.0.0.1:${address.port}/prices`,
      method: 'GET',
      auth: {
        type: 'client_credentials',
        tokenUrl: `http://127.0.0.1:${address.port}/oauth/token`,
        clientIdEnv: 'SUPPLIER_CLIENT_ID',
        clientSecretEnv: 'SUPPLIER_CLIENT_SECRET',
        scope: 'hotel.search'
      }
    });

    try {
      const first = await searchHotels({
        city: '南京',
        keyword: 'Token实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      const second = await searchHotels({
        city: '南京',
        keyword: 'Token实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(first.source, 'supplier-api');
      assert.equal(first.total, 1);
      assert.equal(first.hotels[0].name, '南京Token实时供应商酒店');
      assert.equal(first.hotels[0].price, 566);
      assert.equal(first.providers.supplierApi.authConfigured, true);
      assert.equal(second.source, 'supplier-api');
      assert.equal(tokenRequestCount, 1);
      assert.equal(priceRequestCount, 2);
      assert.deepEqual(tokenBodies[0], {
        grant_type: 'client_credentials',
        client_id: 'client-id',
        client_secret: 'client-secret',
        scope: 'hotel.search'
      });
      assert.deepEqual(priceAuthorizations, ['Bearer supplier-live-token', 'Bearer supplier-live-token']);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves pagination metadata from a single live supplier API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-pagination-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousManifestUrl = process.env.HOTEL_DATA_MANIFEST_URL;
    const previousManifestUrls = process.env.HOTEL_DATA_MANIFEST_URLS;
    const previousManifestConfig = process.env.HOTEL_DATA_MANIFEST_CONFIG;
    const previousApiUrl = process.env.HOTEL_SUPPLIER_API_URL;
    const previousApiUrls = process.env.HOTEL_SUPPLIER_API_URLS;
    const previousApiConfig = process.env.HOTEL_SUPPLIER_API_CONFIG;
    const previousApiName = process.env.HOTEL_SUPPLIER_API_NAME;
    const previousApiNames = process.env.HOTEL_SUPPLIER_API_NAMES;
    const previousApiMethod = process.env.HOTEL_SUPPLIER_API_METHOD;
    const previousApiHeaders = process.env.HOTEL_SUPPLIER_API_HEADERS;
    const previousAmadeusId = process.env.AMADEUS_CLIENT_ID;
    const previousAmadeusSecret = process.env.AMADEUS_CLIENT_SECRET;
    const requests = [];

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_URL;
    delete process.env.HOTEL_DATA_MANIFEST_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
    delete process.env.HOTEL_SUPPLIER_API_URL;
    delete process.env.HOTEL_SUPPLIER_API_URLS;
    delete process.env.HOTEL_SUPPLIER_API_CONFIG;
    delete process.env.HOTEL_SUPPLIER_API_NAME;
    delete process.env.HOTEL_SUPPLIER_API_NAMES;
    delete process.env.HOTEL_SUPPLIER_API_METHOD;
    delete process.env.HOTEL_SUPPLIER_API_HEADERS;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pageNo = Number(url.searchParams.get('pageNo') || 1);
      const limit = Number(url.searchParams.get('pageSize') || 2);
      const offset = (pageNo - 1) * limit;
      requests.push({
        city: url.searchParams.get('city'),
        destinationType: url.searchParams.get('destinationType'),
        limit: url.searchParams.get('limit'),
        offset: url.searchParams.get('offset'),
        pageNo: url.searchParams.get('pageNo'),
        pageSize: url.searchParams.get('pageSize')
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        total: 1250,
        coverageCities: 393,
        pagination: {
          offset,
          limit,
          nextOffset: offset + limit,
          hasMore: true
        },
        hotels: [
          {
            id: `live-page-${offset + 1}`,
            hotelName: '北京分页实时供应商酒店',
            province: '北京市',
            city: '北京市',
            district: '朝阳',
            price: 610,
            source: '分页实时供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          },
          {
            id: `live-page-${offset + 2}`,
            hotelName: '上海分页实时供应商酒店',
            province: '上海市',
            city: '上海市',
            district: '静安',
            price: 690,
            source: '分页实时供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '分页实时供应商',
      url: `http://127.0.0.1:${address.port}/paged-prices`,
      method: 'GET',
      requestMap: {
        destinationType: 'destinationType',
        pageNo: 'page',
        pageSize: 'pageSize'
      }
    });

    try {
      const result = await searchHotels({
        city: '',
        keyword: '分页实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        limit: '2',
        offset: '2'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.mode, 'supplier-api');
      assert.equal(result.total, 1250);
      assert.equal(result.returned, 2);
      assert.equal(result.coverageCities, 393);
      assert.deepEqual(result.pagination, {
        offset: 2,
        limit: 2,
        nextOffset: 4,
        hasMore: true
      });
      assert.equal(result.hotels.length, 2);
      assert.ok(result.hotels.some((hotel) => hotel.name === '北京分页实时供应商酒店'));
      assert.ok(result.hotels.some((hotel) => hotel.name === '上海分页实时供应商酒店'));
      assert.equal(result.providers.supplierApi.upstreamTotal, 1250);
      assert.deepEqual(result.providers.supplierApi.pagination, result.pagination);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].city, null);
      assert.equal(requests[0].destinationType, 'nationwide');
      assert.equal(requests[0].limit, null);
      assert.equal(requests[0].offset, null);
      assert.equal(requests[0].pageNo, '2');
      assert.equal(requests[0].pageSize, '2');
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousManifestUrl === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URL;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URL = previousManifestUrl;
      }
      if (previousManifestUrls === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URLS;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URLS = previousManifestUrls;
      }
      if (previousManifestConfig === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
      } else {
        process.env.HOTEL_DATA_MANIFEST_CONFIG = previousManifestConfig;
      }
      if (previousApiUrl === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URL;
      } else {
        process.env.HOTEL_SUPPLIER_API_URL = previousApiUrl;
      }
      if (previousApiUrls === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URLS;
      } else {
        process.env.HOTEL_SUPPLIER_API_URLS = previousApiUrls;
      }
      if (previousApiConfig === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_CONFIG;
      } else {
        process.env.HOTEL_SUPPLIER_API_CONFIG = previousApiConfig;
      }
      if (previousApiName === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAME;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAME = previousApiName;
      }
      if (previousApiNames === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAMES;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAMES = previousApiNames;
      }
      if (previousApiMethod === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_METHOD;
      } else {
        process.env.HOTEL_SUPPLIER_API_METHOD = previousApiMethod;
      }
      if (previousApiHeaders === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_HEADERS;
      } else {
        process.env.HOTEL_SUPPLIER_API_HEADERS = previousApiHeaders;
      }
      if (previousAmadeusId === undefined) {
        delete process.env.AMADEUS_CLIENT_ID;
      } else {
        process.env.AMADEUS_CLIENT_ID = previousAmadeusId;
      }
      if (previousAmadeusSecret === undefined) {
        delete process.env.AMADEUS_CLIENT_SECRET;
      } else {
        process.env.AMADEUS_CLIENT_SECRET = previousAmadeusSecret;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges prices from multiple configured live supplier APIs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-multi-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousApiUrl = process.env.HOTEL_SUPPLIER_API_URL;
    const previousApiUrls = process.env.HOTEL_SUPPLIER_API_URLS;
    const previousApiConfig = process.env.HOTEL_SUPPLIER_API_CONFIG;
    const previousApiName = process.env.HOTEL_SUPPLIER_API_NAME;
    const previousApiNames = process.env.HOTEL_SUPPLIER_API_NAMES;
    const previousApiMethod = process.env.HOTEL_SUPPLIER_API_METHOD;
    const previousApiHeaders = process.env.HOTEL_SUPPLIER_API_HEADERS;
    const previousAmadeusId = process.env.AMADEUS_CLIENT_ID;
    const previousAmadeusSecret = process.env.AMADEUS_CLIENT_SECRET;
    const requestedPaths = [];

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_SUPPLIER_API_URL;
    delete process.env.HOTEL_SUPPLIER_API_CONFIG;
    delete process.env.HOTEL_SUPPLIER_API_NAME;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    process.env.HOTEL_IMPORT_DIR = dir;
    process.env.HOTEL_SUPPLIER_API_METHOD = 'GET';
    clearInventoryCache();

    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      requestedPaths.push(url.pathname);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (url.pathname === '/supplier-a') {
        response.end(JSON.stringify({
          hotels: [
            {
              id: 'multi-live-001',
              hotelName: '成都多实时供应商酒店',
              province: '四川省',
              city: '成都市',
              district: '锦江',
              address: '成都市锦江区春熙路 88 号',
              price: 760,
              source: '实时供应商A',
              checkIn: '2026-06-01',
              checkOut: '2026-12-31',
              available: true
            }
          ]
        }));
        return;
      }
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'multi-live-001',
            hotelName: '成都多实时供应商酒店',
            province: '四川省',
            city: '成都市',
            district: '锦江',
            address: '成都市锦江区春熙路 88 号',
            price: 690,
            source: '实时供应商B',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true,
            bookingUrl: 'https://example.com/live-b'
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_URLS = [
      `http://127.0.0.1:${address.port}/supplier-a?token=a-secret`,
      `http://127.0.0.1:${address.port}/supplier-b?token=b-secret`
    ].join(',');
    process.env.HOTEL_SUPPLIER_API_NAMES = '实时供应商A,实时供应商B';

    try {
      const result = await searchHotels({
        city: '成都',
        keyword: '多实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '成都多实时供应商酒店');
      assert.equal(result.hotels[0].price, 690);
      assert.equal(result.hotels[0].offerCount, 2);
      assert.equal(result.hotels[0].bookingUrl, 'https://example.com/live-b');
      assert.deepEqual(result.hotels[0].providerNames.sort(), ['实时供应商A', '实时供应商B'].sort());
      assert.equal(result.providers.supplierApi.apiCount, 2);
      assert.equal(result.providers.supplierApi.sourceCount, 2);
      assert.deepEqual(result.providers.supplierApi.urls, [
        `http://127.0.0.1:${address.port}/supplier-a?token=REDACTED`,
        `http://127.0.0.1:${address.port}/supplier-b?token=REDACTED`
      ]);
      assert.deepEqual(requestedPaths.sort(), ['/supplier-a', '/supplier-b'].sort());
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousApiUrl === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URL;
      } else {
        process.env.HOTEL_SUPPLIER_API_URL = previousApiUrl;
      }
      if (previousApiUrls === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URLS;
      } else {
        process.env.HOTEL_SUPPLIER_API_URLS = previousApiUrls;
      }
      if (previousApiConfig === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_CONFIG;
      } else {
        process.env.HOTEL_SUPPLIER_API_CONFIG = previousApiConfig;
      }
      if (previousApiName === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAME;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAME = previousApiName;
      }
      if (previousApiNames === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAMES;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAMES = previousApiNames;
      }
      if (previousApiMethod === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_METHOD;
      } else {
        process.env.HOTEL_SUPPLIER_API_METHOD = previousApiMethod;
      }
      if (previousApiHeaders === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_HEADERS;
      } else {
        process.env.HOTEL_SUPPLIER_API_HEADERS = previousApiHeaders;
      }
      if (previousAmadeusId === undefined) {
        delete process.env.AMADEUS_CLIENT_ID;
      } else {
        process.env.AMADEUS_CLIENT_ID = previousAmadeusId;
      }
      if (previousAmadeusSecret === undefined) {
        delete process.env.AMADEUS_CLIENT_SECRET;
      } else {
        process.env.AMADEUS_CLIENT_SECRET = previousAmadeusSecret;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fans out province live supplier API searches by city', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-fanout-'));
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    const requestedCities = [];
    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const city = url.searchParams.get('cityName');
      requestedCities.push(city);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: `fanout-${city}`,
            hotelName: `${city}城市扇出供应商酒店`,
            province: '江苏省',
            city: `${city}市`,
            district: city === '南京' ? '秦淮' : '滨湖',
            price: city === '南京' ? 520 : 430,
            source: '城市扇出供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '城市扇出供应商',
      url: `http://127.0.0.1:${address.port}/city-prices`,
      method: 'GET',
      cityFanout: true,
      cityFanoutLimit: 2,
      cityFanoutConcurrency: 1,
      requestMap: {
        cityName: 'city'
      }
    });

    try {
      const result = await searchHotels({
        city: '江苏省',
        keyword: '城市扇出',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 2);
      assert.equal(result.coverageCities, 2);
      assert.deepEqual(requestedCities, ['南京', '无锡']);
      assert.deepEqual(result.hotels.map((hotel) => hotel.name).sort(), [
        '南京城市扇出供应商酒店',
        '无锡城市扇出供应商酒店'
      ].sort());
      assert.equal(result.providers.supplierApi.cityFanoutConfigured, true);
      assert.equal(result.providers.supplierApi.fanoutRequestCount, 2);
      assert.equal(result.providers.supplierApi.sourceCount, 2);
      assert.equal(result.providers.supplierApi.rowCount, 2);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps supplier destination codes for live API requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-destination-map-'));
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    const requestedCityIds = [];
    const requestedCityCodes = [];
    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const cityId = url.searchParams.get('supplierCityId');
      requestedCityIds.push(cityId);
      requestedCityCodes.push(url.searchParams.get('supplierCityCode'));
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: `mapped-destination-${cityId}`,
            hotelName: `${cityId}编码实时酒店`,
            price: cityId === '320100' ? 610 : 480,
            source: '编码供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '编码供应商',
      url: `http://127.0.0.1:${address.port}/mapped-prices`,
      method: 'GET',
      cityFanout: true,
      cityFanoutLimit: 2,
      cityFanoutConcurrency: 1,
      destinationMap: {
        cities: {
          南京: { cityId: '320100', cityCode: 'NKG-SUP' },
          无锡: { cityId: '320200', cityCode: 'WUX-SUP' }
        }
      },
      requestMap: {
        supplierCityId: 'supplierDestination.cityId',
        supplierCityCode: 'cityCode',
        checkInDate: 'checkIn',
        checkOutDate: 'checkOut'
      }
    });

    try {
      const result = await searchHotels({
        city: '江苏省',
        keyword: '编码实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 2);
      assert.equal(result.coverageCities, 2);
      assert.deepEqual(requestedCityIds, ['320100', '320200']);
      assert.deepEqual(requestedCityCodes, ['NKG-SUP', 'WUX-SUP']);
      assert.deepEqual(result.hotels.map((hotel) => hotel.city).sort(), ['南京', '无锡']);
      assert.deepEqual(result.hotels.map((hotel) => hotel.province).sort(), ['江苏', '江苏']);
      assert.deepEqual(result.hotels.map((hotel) => hotel.name).sort(), [
        '320100编码实时酒店',
        '320200编码实时酒店'
      ].sort());
      assert.equal(result.providers.supplierApi.destinationMapConfigured, true);
      assert.equal(result.providers.supplierApi.cityFanoutConfigured, true);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads supplier destination maps from files and URLs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-external-destination-map-'));
    const destinationMapFile = join(dir, 'supplier-destinations.json');
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = join(dir, 'imports');
    clearInventoryCache();
    await writeFile(destinationMapFile, JSON.stringify([
      { province: '江苏', city: '南京', cityId: 'FILE-320100', cityCode: 'FILE-NKG' }
    ]));

    const requests = [];
    const supplierServer = createHttpServer((request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/destination-map') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
          destinations: [
            { province: '江苏', city: '南京', cityId: 'URL-320100', cityCode: 'URL-NKG' }
          ]
        }));
        return;
      }

      const cityId = url.searchParams.get('supplierCityId');
      requests.push({ path: url.pathname, cityId });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: `${url.pathname}-${cityId}`,
            hotelName: url.pathname === '/file-prices' ? '南京文件外部映射酒店' : '南京远程外部映射酒店',
            price: url.pathname === '/file-prices' ? 620 : 590,
            source: url.pathname === '/file-prices' ? '文件编码供应商' : '远程编码供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify([
      {
        name: '文件编码供应商',
        url: `http://127.0.0.1:${address.port}/file-prices`,
        method: 'GET',
        cityFanout: true,
        cityFanoutLimit: 1,
        destinationMapFile,
        requestMap: {
          supplierCityId: 'cityId',
          checkInDate: 'checkIn',
          checkOutDate: 'checkOut'
        }
      },
      {
        name: '远程编码供应商',
        url: `http://127.0.0.1:${address.port}/url-prices`,
        method: 'GET',
        cityFanout: true,
        cityFanoutLimit: 1,
        destinationMapUrl: `http://127.0.0.1:${address.port}/destination-map`,
        destinationMapCacheSeconds: 1,
        requestMap: {
          supplierCityId: 'supplierDestination.cityId',
          checkInDate: 'checkIn',
          checkOutDate: 'checkOut'
        }
      }
    ]);

    try {
      const result = await searchHotels({
        city: '江苏省',
        keyword: '外部映射',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 2);
      assert.equal(result.coverageCities, 1);
      assert.deepEqual(requests, [
        { path: '/file-prices', cityId: 'FILE-320100' },
        { path: '/url-prices', cityId: 'URL-320100' }
      ]);
      assert.deepEqual(result.hotels.map((hotel) => hotel.city), ['南京', '南京']);
      assert.deepEqual(result.hotels.map((hotel) => hotel.province), ['江苏', '江苏']);
      assert.deepEqual(result.hotels.map((hotel) => hotel.name).sort(), [
        '南京文件外部映射酒店',
        '南京远程外部映射酒店'
      ].sort());
      assert.equal(result.providers.supplierApi.destinationMapConfigured, true);
      assert.equal(result.providers.supplierApi.sourceCount, 2);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports supplier destination map coverage through the HTTP API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-supplier-destination-coverage-'));
    const destinationMapFile = join(dir, 'supplier-destinations.json');
    const envKeys = [
      'HOTEL_DATA_FILE',
      'HOTEL_DATA_FILES',
      'HOTEL_IMPORT_DIR',
      'HOTEL_DATA_URL',
      'HOTEL_DATA_URLS',
      'HOTEL_DATA_MANIFEST_URL',
      'HOTEL_DATA_MANIFEST_URLS',
      'HOTEL_DATA_MANIFEST_CONFIG',
      'HOTEL_SUPPLIER_API_URL',
      'HOTEL_SUPPLIER_API_URLS',
      'HOTEL_SUPPLIER_API_CONFIG',
      'HOTEL_SUPPLIER_API_NAME',
      'HOTEL_SUPPLIER_API_NAMES',
      'HOTEL_SUPPLIER_API_METHOD',
      'HOTEL_SUPPLIER_API_HEADERS',
      'AMADEUS_CLIENT_ID',
      'AMADEUS_CLIENT_SECRET'
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    envKeys.forEach((key) => delete process.env[key]);
    process.env.HOTEL_IMPORT_DIR = join(dir, 'imports');
    clearInventoryCache();
    await writeFile(destinationMapFile, JSON.stringify([
      { province: '江苏', city: '南京', cityId: '320100', cityCode: 'NKG' },
      { province: '江苏', city: '无锡', cityId: '320200', cityCode: 'WUX' }
    ]));
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '编码覆盖供应商',
      url: 'http://127.0.0.1:9/not-called',
      method: 'GET',
      destinationMapFile,
      requestMap: {
        cityId: 'cityId'
      }
    });

    const server = createHotelServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const coverageResponse = await fetch(`${baseUrl}/api/supplier-destinations?city=江苏省&cityLimit=3`);
      const coverage = await coverageResponse.json();
      assert.equal(coverageResponse.status, 200);
      assert.equal(coverage.configured, true);
      assert.equal(coverage.type, 'supplier-destination-map');
      assert.equal(coverage.query.destinationType, 'province');
      assert.equal(coverage.query.label, '江苏');
      assert.equal(coverage.totalCities, 3);
      assert.equal(coverage.coveredCities, 2);
      assert.equal(coverage.sourceCount, 1);
      assert.equal(coverage.sourceCoverage[0].sourceName, '编码覆盖供应商');
      assert.equal(coverage.sourceCoverage[0].coveredCities, 2);
      assert.equal(coverage.sourceCoverage[0].totalCities, 3);
      assert.equal(coverage.sourceCoverage[0].cityCoverage.find((item) => item.city === '南京').cityId, '320100');
      assert.ok(!('coveredCitySet' in coverage.sourceCoverage[0]));
      assert.ok(!('cityCodes' in coverage.sourceCoverage[0]));
      assert.ok(coverage.cityCoverage.some((item) => item.city === '南京' && item.covered && item.sources.includes('编码覆盖供应商')));
      assert.ok(coverage.cityCoverage.some((item) => item.city === '徐州' && !item.covered));
      assert.ok(coverage.missingCities.some((item) => item.province === '江苏' && item.city === '徐州'));

      const csvResponse = await fetch(`${baseUrl}/api/supplier-destinations.csv?city=江苏省&cityLimit=3`);
      const csv = await csvResponse.text();
      assert.equal(csvResponse.status, 200);
      assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
      assert.match(csvResponse.headers.get('content-disposition'), /hotel-supplier-destinations\.csv/);
      assert.match(csv, /province,city,mapped,sourceCount,sources,codes/);
      assert.match(csv, /江苏,南京,yes,1,编码覆盖供应商,编码覆盖供应商:320100/);
      assert.match(csv, /江苏,徐州,no,0,,/);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      clearInventoryCache();
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('supports per-source live supplier API config with mixed methods and headers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-config-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousApiUrl = process.env.HOTEL_SUPPLIER_API_URL;
    const previousApiUrls = process.env.HOTEL_SUPPLIER_API_URLS;
    const previousApiConfig = process.env.HOTEL_SUPPLIER_API_CONFIG;
    const previousApiName = process.env.HOTEL_SUPPLIER_API_NAME;
    const previousApiNames = process.env.HOTEL_SUPPLIER_API_NAMES;
    const previousApiMethod = process.env.HOTEL_SUPPLIER_API_METHOD;
    const previousApiHeaders = process.env.HOTEL_SUPPLIER_API_HEADERS;
    const previousAmadeusId = process.env.AMADEUS_CLIENT_ID;
    const previousAmadeusSecret = process.env.AMADEUS_CLIENT_SECRET;
    const requests = [];

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_SUPPLIER_API_URL;
    delete process.env.HOTEL_SUPPLIER_API_URLS;
    delete process.env.HOTEL_SUPPLIER_API_NAME;
    delete process.env.HOTEL_SUPPLIER_API_NAMES;
    delete process.env.HOTEL_SUPPLIER_API_METHOD;
    delete process.env.HOTEL_SUPPLIER_API_HEADERS;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    const supplierServer = createHttpServer(async (request, response) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push({
        path: url.pathname,
        method: request.method,
        city: url.searchParams.get('city'),
        cityName: url.searchParams.get('cityName'),
        arrivalDate: url.searchParams.get('arrivalDate'),
        departureDate: url.searchParams.get('departureDate'),
        pageNo: url.searchParams.get('pageNo'),
        pageSize: url.searchParams.get('pageSize'),
        start: url.searchParams.get('start'),
        locale: url.searchParams.get('locale'),
        currency: url.searchParams.get('currency'),
        authorization: request.headers.authorization,
        apiKey: request.headers['x-api-key'],
        body: body ? JSON.parse(body) : null
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        hotels: [
          {
            id: 'config-live-001',
            hotelName: '武汉配置实时供应商酒店',
            province: '湖北省',
            city: '武汉市',
            district: '江汉',
            address: '武汉市江汉区建设大道 1 号',
            price: url.pathname === '/get-prices' ? 620 : 580,
            source: url.pathname === '/get-prices' ? '配置GET供应商' : '配置POST供应商',
            checkIn: '2026-06-01',
            checkOut: '2026-12-31',
            available: true,
            bookingUrl: url.pathname === '/post-prices' ? 'https://example.com/config-post' : ''
          }
        ]
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify([
      {
        name: '配置GET供应商',
        url: `http://127.0.0.1:${address.port}/get-prices?token=get-secret`,
        method: 'GET',
        headers: { Authorization: 'Bearer get-token' },
        requestDefaults: {
          locale: 'zh-CN',
          currency: 'CNY'
        },
        requestMap: {
          cityName: 'city',
          arrivalDate: 'checkIn',
          departureDate: 'checkOut',
          pageNo: 'page',
          pageSize: 'pageSize',
          start: 'offset'
        }
      },
      {
        name: '配置POST供应商',
        url: `http://127.0.0.1:${address.port}/post-prices?key=post-secret`,
        method: 'POST',
        headers: { 'X-Api-Key': 'post-key' },
        requestDefaults: {
          channel: 'direct'
        },
        requestMap: {
          'destination.cityName': 'city',
          'stay.arrival': 'checkIn',
          'stay.departure': 'checkOut',
          'occupancy.adultCount': 'adults',
          'pagination.pageNo': 'page',
          'pagination.pageSize': 'pageSize',
          'pagination.offset': 'offset'
        }
      }
    ]);

    try {
      const result = await searchHotels({
        city: '武汉',
        keyword: '配置实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        adults: '2',
        rooms: '1'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '武汉配置实时供应商酒店');
      assert.equal(result.hotels[0].price, 580);
      assert.equal(result.hotels[0].offerCount, 2);
      assert.equal(result.hotels[0].bookingUrl, 'https://example.com/config-post');
      assert.deepEqual(result.hotels[0].providerNames.sort(), ['配置GET供应商', '配置POST供应商'].sort());
      assert.equal(result.providers.supplierApi.apiCount, 2);
      assert.equal(result.providers.supplierApi.method, 'MIXED');
      assert.deepEqual(result.providers.supplierApi.methods.sort(), ['GET', 'POST']);
      assert.equal(result.providers.supplierApi.headersConfigured, true);
      assert.deepEqual(result.providers.supplierApi.urls, [
        `http://127.0.0.1:${address.port}/get-prices?token=REDACTED`,
        `http://127.0.0.1:${address.port}/post-prices?key=REDACTED`
      ]);

      const getRequest = requests.find((item) => item.path === '/get-prices');
      const postRequest = requests.find((item) => item.path === '/post-prices');
      assert.equal(getRequest.method, 'GET');
      assert.equal(getRequest.city, null);
      assert.equal(getRequest.cityName, '武汉');
      assert.equal(getRequest.arrivalDate, '2026-06-06');
      assert.equal(getRequest.departureDate, '2026-06-07');
      assert.equal(getRequest.pageNo, '1');
      assert.equal(getRequest.pageSize, '24');
      assert.equal(getRequest.start, '0');
      assert.equal(getRequest.locale, 'zh-CN');
      assert.equal(getRequest.currency, 'CNY');
      assert.equal(getRequest.authorization, 'Bearer get-token');
      assert.equal(postRequest.method, 'POST');
      assert.equal(postRequest.apiKey, 'post-key');
      assert.equal(postRequest.body.channel, 'direct');
      assert.equal(postRequest.body.city, undefined);
      assert.equal(postRequest.body.destination.cityName, '武汉');
      assert.equal(postRequest.body.stay.arrival, '2026-06-06');
      assert.equal(postRequest.body.stay.departure, '2026-06-07');
      assert.equal(postRequest.body.occupancy.adultCount, 2);
      assert.equal(postRequest.body.pagination.pageNo, 1);
      assert.equal(postRequest.body.pagination.pageSize, 24);
      assert.equal(postRequest.body.pagination.offset, 0);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousApiUrl === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URL;
      } else {
        process.env.HOTEL_SUPPLIER_API_URL = previousApiUrl;
      }
      if (previousApiUrls === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URLS;
      } else {
        process.env.HOTEL_SUPPLIER_API_URLS = previousApiUrls;
      }
      if (previousApiConfig === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_CONFIG;
      } else {
        process.env.HOTEL_SUPPLIER_API_CONFIG = previousApiConfig;
      }
      if (previousApiName === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAME;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAME = previousApiName;
      }
      if (previousApiNames === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAMES;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAMES = previousApiNames;
      }
      if (previousApiMethod === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_METHOD;
      } else {
        process.env.HOTEL_SUPPLIER_API_METHOD = previousApiMethod;
      }
      if (previousApiHeaders === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_HEADERS;
      } else {
        process.env.HOTEL_SUPPLIER_API_HEADERS = previousApiHeaders;
      }
      if (previousAmadeusId === undefined) {
        delete process.env.AMADEUS_CLIENT_ID;
      } else {
        process.env.AMADEUS_CLIENT_ID = previousAmadeusId;
      }
      if (previousAmadeusSecret === undefined) {
        delete process.env.AMADEUS_CLIENT_SECRET;
      } else {
        process.env.AMADEUS_CLIENT_SECRET = previousAmadeusSecret;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps non-standard live supplier API fields before normalization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hotel-live-api-field-map-'));
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousApiUrl = process.env.HOTEL_SUPPLIER_API_URL;
    const previousApiUrls = process.env.HOTEL_SUPPLIER_API_URLS;
    const previousApiConfig = process.env.HOTEL_SUPPLIER_API_CONFIG;
    const previousApiName = process.env.HOTEL_SUPPLIER_API_NAME;
    const previousApiNames = process.env.HOTEL_SUPPLIER_API_NAMES;
    const previousApiMethod = process.env.HOTEL_SUPPLIER_API_METHOD;
    const previousApiHeaders = process.env.HOTEL_SUPPLIER_API_HEADERS;
    const previousAmadeusId = process.env.AMADEUS_CLIENT_ID;
    const previousAmadeusSecret = process.env.AMADEUS_CLIENT_SECRET;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_SUPPLIER_API_URL;
    delete process.env.HOTEL_SUPPLIER_API_URLS;
    delete process.env.HOTEL_SUPPLIER_API_NAME;
    delete process.env.HOTEL_SUPPLIER_API_NAMES;
    delete process.env.HOTEL_SUPPLIER_API_METHOD;
    delete process.env.HOTEL_SUPPLIER_API_HEADERS;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    process.env.HOTEL_IMPORT_DIR = dir;
    clearInventoryCache();

    const supplierServer = createHttpServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: true,
        data: {
          paging: {
            totalCount: 42,
            pageNo: 1,
            pageSize: 24,
            hasMore: true
          },
          hotelList: [
            {
              offerId: 'mapped-live-001',
              hotel: {
                title: '厦门映射实时供应商酒店',
                provinceName: '福建省',
                cityName: '厦门市',
                areaName: '思明',
                location: '厦门市思明区环岛路 99 号',
                stars: 5,
                score: 4.8
              },
              rate: {
                sale: 888,
                list: 1088,
                plan: '豪华海景房',
                pay: '在线付',
                cancel: '限时免费取消',
                book: 'https://example.com/mapped-live-001'
              },
              stay: {
                from: '2026-06-01',
                to: '2026-12-31'
              },
              stock: 'available'
            }
          ]
        }
      }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_SUPPLIER_API_CONFIG = JSON.stringify({
      name: '字段映射供应商',
      url: `http://127.0.0.1:${address.port}/mapped`,
      method: 'GET',
      responsePath: 'data.hotelList',
      paginationPath: 'data.paging',
      fieldMap: {
        id: 'offerId',
        name: 'hotel.title',
        province: 'hotel.provinceName',
        city: 'hotel.cityName',
        district: 'hotel.areaName',
        address: 'hotel.location',
        star: 'hotel.stars',
        rating: 'hotel.score',
        price: 'rate.sale',
        originalPrice: 'rate.list',
        roomName: 'rate.plan',
        payment: 'rate.pay',
        cancellation: 'rate.cancel',
        bookingUrl: 'rate.book',
        checkIn: 'stay.from',
        checkOut: 'stay.to',
        available: 'stock'
      }
    });

    try {
      const result = await searchHotels({
        city: '厦门',
        keyword: '映射实时',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'supplier-api');
      assert.equal(result.total, 42);
      assert.equal(result.returned, 1);
      assert.deepEqual(result.pagination, {
        offset: 0,
        limit: 24,
        nextOffset: 24,
        hasMore: true
      });
      assert.equal(result.hotels[0].name, '厦门映射实时供应商酒店');
      assert.equal(result.hotels[0].province, '福建');
      assert.equal(result.hotels[0].city, '厦门');
      assert.equal(result.hotels[0].district, '思明');
      assert.equal(result.hotels[0].star, 5);
      assert.equal(result.hotels[0].rating, 4.8);
      assert.equal(result.hotels[0].price, 888);
      assert.equal(result.hotels[0].originalPrice, 1088);
      assert.equal(result.hotels[0].style, '豪华海景房');
      assert.equal(result.hotels[0].payment, '在线付');
      assert.equal(result.hotels[0].cancellation, '限时免费取消');
      assert.equal(result.hotels[0].bookingUrl, 'https://example.com/mapped-live-001');
      assert.equal(result.hotels[0].providerName, '字段映射供应商');
      assert.equal(result.providers.supplierApi.responsePathConfigured, true);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousApiUrl === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URL;
      } else {
        process.env.HOTEL_SUPPLIER_API_URL = previousApiUrl;
      }
      if (previousApiUrls === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_URLS;
      } else {
        process.env.HOTEL_SUPPLIER_API_URLS = previousApiUrls;
      }
      if (previousApiConfig === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_CONFIG;
      } else {
        process.env.HOTEL_SUPPLIER_API_CONFIG = previousApiConfig;
      }
      if (previousApiName === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAME;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAME = previousApiName;
      }
      if (previousApiNames === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_NAMES;
      } else {
        process.env.HOTEL_SUPPLIER_API_NAMES = previousApiNames;
      }
      if (previousApiMethod === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_METHOD;
      } else {
        process.env.HOTEL_SUPPLIER_API_METHOD = previousApiMethod;
      }
      if (previousApiHeaders === undefined) {
        delete process.env.HOTEL_SUPPLIER_API_HEADERS;
      } else {
        process.env.HOTEL_SUPPLIER_API_HEADERS = previousApiHeaders;
      }
      if (previousAmadeusId === undefined) {
        delete process.env.AMADEUS_CLIENT_ID;
      } else {
        process.env.AMADEUS_CLIENT_ID = previousAmadeusId;
      }
      if (previousAmadeusSecret === undefined) {
        delete process.env.AMADEUS_CLIENT_SECRET;
      } else {
        process.env.AMADEUS_CLIENT_SECRET = previousAmadeusSecret;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads a remote supplier CSV URL as searchable real inventory', async () => {
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousManifestConfig = process.env.HOTEL_DATA_MANIFEST_CONFIG;
    const previousDataUrlHeaders = process.env.HOTEL_DATA_URL_HEADERS;
    const previousCacheSeconds = process.env.HOTEL_DATA_CACHE_SECONDS;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
    delete process.env.HOTEL_DATA_URL_HEADERS;
    process.env.HOTEL_DATA_CACHE_SECONDS = '3600';
    clearInventoryCache();

    const csv = [
      'id,name,province,city,district,address,star,rating,price,currency,tags,source,checkIn,checkOut,available,bookingUrl',
      'remote-001,深圳远程供应商酒店,广东,深圳,南山,深圳市南山区科技园 88 号,5,4.9,899,CNY,真实库存,远程供应商,2026-06-01,2026-12-31,true,https://example.com/remote-001'
    ].join('\n');
    let requestCount = 0;
    const supplierServer = createHttpServer((request, response) => {
      requestCount += 1;
      assert.ok(request.url.includes('token=secret-value'));
      response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
      response.end(csv);
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();

    process.env.HOTEL_DATA_URL = `http://127.0.0.1:${address.port}/remote.csv?token=secret-value`;

    try {
      const result = await searchHotels({
        city: '深圳',
        keyword: '远程供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '深圳远程供应商酒店');
      assert.equal(result.hotels[0].price, 899);
      assert.equal(result.hotels[0].providerName, '远程供应商');
      assert.equal(result.providers.localInventory.remoteCount, 1);
      assert.equal(result.providers.localInventory.readableCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.urls[0], `http://127.0.0.1:${address.port}/remote.csv?token=REDACTED`);
      assert.equal(result.providers.localInventory.remoteInventory.loadCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.okCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.failedCount, 0);
      assert.equal(result.providers.localInventory.remoteInventory.loads[0].rowCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.loads[0].cache, 'miss');
      assert.equal(result.providers.localInventory.remoteInventory.loads[0].url, `http://127.0.0.1:${address.port}/remote.csv?token=REDACTED`);

      const cachedResult = await searchHotels({
        city: '深圳',
        keyword: '远程供应商',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(cachedResult.total, 1);
      assert.equal(cachedResult.providers.localInventory.remoteInventory.loads[0].cache, 'hit');
      assert.equal(requestCount, 1);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousManifestConfig === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
      } else {
        process.env.HOTEL_DATA_MANIFEST_CONFIG = previousManifestConfig;
      }
      if (previousDataUrlHeaders === undefined) {
        delete process.env.HOTEL_DATA_URL_HEADERS;
      } else {
        process.env.HOTEL_DATA_URL_HEADERS = previousDataUrlHeaders;
      }
      if (previousCacheSeconds === undefined) {
        delete process.env.HOTEL_DATA_CACHE_SECONDS;
      } else {
        process.env.HOTEL_DATA_CACHE_SECONDS = previousCacheSeconds;
      }
    }
  });

  it('uses stale cached remote supplier inventory after transient failures', async () => {
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousManifestUrl = process.env.HOTEL_DATA_MANIFEST_URL;
    const previousManifestUrls = process.env.HOTEL_DATA_MANIFEST_URLS;
    const previousManifestConfig = process.env.HOTEL_DATA_MANIFEST_CONFIG;
    const previousDataUrlHeaders = process.env.HOTEL_DATA_URL_HEADERS;
    const previousCacheSeconds = process.env.HOTEL_DATA_CACHE_SECONDS;
    const previousStaleCacheSeconds = process.env.HOTEL_DATA_STALE_CACHE_SECONDS;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_URL;
    delete process.env.HOTEL_DATA_MANIFEST_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
    delete process.env.HOTEL_DATA_URL_HEADERS;
    process.env.HOTEL_DATA_CACHE_SECONDS = '0';
    process.env.HOTEL_DATA_STALE_CACHE_SECONDS = '60';
    clearInventoryCache();

    const csv = [
      'id,name,province,city,district,address,star,rating,price,currency,tags,source,checkIn,checkOut,available,bookingUrl',
      'remote-stale-001,广州远程过期缓存供应商酒店,广东,广州,天河,广州市天河区缓存路 8 号,5,4.8,799,CNY,真实库存,远程过期缓存供应商,2026-06-01,2026-12-31,true,https://example.com/remote-stale-001'
    ].join('\n');
    let requestCount = 0;
    const supplierServer = createHttpServer((request, response) => {
      requestCount += 1;
      if (requestCount === 2) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'temporarily unavailable' }));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
      response.end(csv);
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_DATA_URL = `http://127.0.0.1:${address.port}/remote-stale.csv`;

    try {
      const query = {
        city: '广州',
        keyword: '远程过期缓存',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      };
      const first = await searchHotels(query);
      const second = await searchHotels(query);

      assert.equal(first.source, 'local');
      assert.equal(second.source, 'local');
      assert.equal(first.total, 1);
      assert.equal(second.total, 1);
      assert.equal(second.hotels[0].name, '广州远程过期缓存供应商酒店');
      assert.equal(requestCount, 2);
      assert.equal(first.providers.localInventory.remoteInventory.loads[0].cache, 'miss');
      assert.equal(second.providers.localInventory.remoteInventory.staleCount, 1);
      assert.equal(second.providers.localInventory.remoteInventory.failedCount, 0);
      assert.equal(second.providers.localInventory.remoteInventory.loads[0].status, 'stale');
      assert.equal(second.providers.localInventory.remoteInventory.loads[0].cache, 'stale');
      assert.match(second.providers.localInventory.remoteInventory.loads[0].error, /HTTP 503/);
      assert.ok(second.providers.localInventory.sourceErrors.some((message) => /已使用过期缓存/.test(message)));
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousManifestUrl === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URL;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URL = previousManifestUrl;
      }
      if (previousManifestUrls === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URLS;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URLS = previousManifestUrls;
      }
      if (previousManifestConfig === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
      } else {
        process.env.HOTEL_DATA_MANIFEST_CONFIG = previousManifestConfig;
      }
      if (previousDataUrlHeaders === undefined) {
        delete process.env.HOTEL_DATA_URL_HEADERS;
      } else {
        process.env.HOTEL_DATA_URL_HEADERS = previousDataUrlHeaders;
      }
      if (previousCacheSeconds === undefined) {
        delete process.env.HOTEL_DATA_CACHE_SECONDS;
      } else {
        process.env.HOTEL_DATA_CACHE_SECONDS = previousCacheSeconds;
      }
      if (previousStaleCacheSeconds === undefined) {
        delete process.env.HOTEL_DATA_STALE_CACHE_SECONDS;
      } else {
        process.env.HOTEL_DATA_STALE_CACHE_SECONDS = previousStaleCacheSeconds;
      }
    }
  });

  it('loads a remote supplier manifest with per-source field maps', async () => {
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousManifestUrl = process.env.HOTEL_DATA_MANIFEST_URL;
    const previousManifestUrls = process.env.HOTEL_DATA_MANIFEST_URLS;
    const previousManifestConfig = process.env.HOTEL_DATA_MANIFEST_CONFIG;
    const previousDataUrlHeaders = process.env.HOTEL_DATA_URL_HEADERS;
    const previousCacheSeconds = process.env.HOTEL_DATA_CACHE_SECONDS;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
    delete process.env.HOTEL_DATA_URL_HEADERS;
    process.env.HOTEL_DATA_CACHE_SECONDS = '3600';
    clearInventoryCache();

    const standardCsv = [
      'id,name,province,city,district,address,star,rating,price,currency,tags,source,checkIn,checkOut,available,bookingUrl',
      'manifest-standard-001,北京Manifest远程标准酒店,北京,北京,朝阳,北京市朝阳区清单路 2 号,5,4.7,920,CNY,真实库存,标准远程供应商,2026-06-01,2026-12-31,true,https://example.com/manifest-standard-001'
    ].join('\n');
    const mappedJson = JSON.stringify({
      offers: [
        {
          offerId: 'manifest-mapped-001',
          hotel: {
            title: '厦门Manifest远程映射酒店',
            provinceName: '福建省',
            cityName: '厦门市',
            areaName: '思明',
            location: '厦门市思明区清单路 1 号',
            stars: 5,
            score: 4.8
          },
          rate: {
            sale: 888,
            list: 1088,
            plan: '海景大床房',
            book: 'https://example.com/manifest-mapped-001'
          },
          stay: {
            from: '2026-06-01',
            to: '2026-12-31'
          },
          stock: 'available'
        }
      ]
    });

    const supplierServer = createHttpServer((request, response) => {
      if (request.url === '/manifest.json') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
          sources: [
            {
              name: '映射远程供应商',
              url: '/mapped.json',
              headers: {
                Authorization: 'Bearer mapped-token'
              },
              fieldMap: {
                id: 'offerId',
                name: 'hotel.title',
                province: 'hotel.provinceName',
                city: 'hotel.cityName',
                district: 'hotel.areaName',
                address: 'hotel.location',
                star: 'hotel.stars',
                rating: 'hotel.score',
                price: ['rate.sale', 'price'],
                originalPrice: 'rate.list',
                roomName: 'rate.plan',
                bookingUrl: 'rate.book',
                checkIn: 'stay.from',
                checkOut: 'stay.to',
                available: 'stock'
              }
            },
            {
              name: '标准远程供应商',
              url: '/standard.csv',
              headers: {
                'X-Api-Key': 'standard-key'
              }
            }
          ]
        }));
        return;
      }
      if (request.url === '/mapped.json') {
        assert.equal(request.headers.authorization, 'Bearer mapped-token');
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(mappedJson);
        return;
      }
      if (request.url === '/standard.csv') {
        assert.equal(request.headers['x-api-key'], 'standard-key');
        response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
        response.end(standardCsv);
        return;
      }
      response.writeHead(404);
      response.end('not found');
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_DATA_MANIFEST_URL = `http://127.0.0.1:${address.port}/manifest.json`;

    try {
      const result = await searchHotels({
        city: '',
        keyword: 'Manifest远程',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 2);
      assert.match(result.notice, /2 个已接入的供应商库存源/);
      assert.equal(result.providers.localInventory.remoteCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.manifestUrlCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.manifestUrls[0], `http://127.0.0.1:${address.port}/manifest.json`);
      assert.equal(result.providers.localInventory.remoteInventory.loadCount, 2);
      assert.equal(result.providers.localInventory.remoteInventory.manifestCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.okCount, 2);
      assert.equal(result.providers.localInventory.remoteInventory.failedCount, 0);
      assert.ok(result.providers.localInventory.remoteInventory.loads.some((load) =>
        load.type === 'manifest' && load.rowCount === 2 && load.sourceCount === 2
      ));
      assert.ok(result.providers.localInventory.remoteInventory.loads.some((load) =>
        load.name === '映射远程供应商' && load.rowCount === 1
      ));

      const appServer = createHotelServer();
      await new Promise((resolve) => appServer.listen(0, resolve));
      try {
        const appAddress = appServer.address();
        const statusResponse = await fetch(`http://127.0.0.1:${appAddress.port}/api/status`);
        const status = await statusResponse.json();
        assert.equal(statusResponse.status, 200);
        assert.equal(status.localInventory.remoteInventory.loadCount, 2);
        assert.equal(status.localInventory.remoteInventory.manifestCount, 1);
        assert.equal(status.localInventory.remoteInventory.okCount, 2);
        assert.ok(status.localInventory.remoteInventory.loads.some((load) =>
          load.type === 'manifest' && load.rowCount === 2
        ));
      } finally {
        await new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve()));
      }

      const mapped = result.hotels.find((hotel) => hotel.name === '厦门Manifest远程映射酒店');
      assert.ok(mapped);
      assert.equal(mapped.city, '厦门');
      assert.equal(mapped.province, '福建');
      assert.equal(mapped.price, 888);
      assert.equal(mapped.originalPrice, 1088);
      assert.equal(mapped.style, '海景大床房');
      assert.equal(mapped.providerName, '映射远程供应商');
      assert.equal(mapped.bookingUrl, 'https://example.com/manifest-mapped-001');

      const standard = result.hotels.find((hotel) => hotel.name === '北京Manifest远程标准酒店');
      assert.ok(standard);
      assert.equal(standard.price, 920);
      assert.equal(standard.providerName, '标准远程供应商');

      const sourceCoverage = result.providers.localInventory.coverage.sourceCoverage;
      assert.ok(sourceCoverage.some((item) => item.sourceName === '映射远程供应商' && item.coveredCities === 1));
      assert.ok(sourceCoverage.some((item) => item.sourceName === '标准远程供应商' && item.coveredCities === 1));

      const cachedResult = await searchHotels({
        city: '',
        keyword: 'Manifest远程',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });
      assert.equal(cachedResult.total, 2);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousManifestUrl === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URL;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URL = previousManifestUrl;
      }
      if (previousManifestUrls === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URLS;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URLS = previousManifestUrls;
      }
      if (previousManifestConfig === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
      } else {
        process.env.HOTEL_DATA_MANIFEST_CONFIG = previousManifestConfig;
      }
      if (previousDataUrlHeaders === undefined) {
        delete process.env.HOTEL_DATA_URL_HEADERS;
      } else {
        process.env.HOTEL_DATA_URL_HEADERS = previousDataUrlHeaders;
      }
      if (previousCacheSeconds === undefined) {
        delete process.env.HOTEL_DATA_CACHE_SECONDS;
      } else {
        process.env.HOTEL_DATA_CACHE_SECONDS = previousCacheSeconds;
      }
    }
  });

  it('loads inline remote supplier config from the environment', async () => {
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousManifestUrl = process.env.HOTEL_DATA_MANIFEST_URL;
    const previousManifestUrls = process.env.HOTEL_DATA_MANIFEST_URLS;
    const previousManifestConfig = process.env.HOTEL_DATA_MANIFEST_CONFIG;
    const previousDataUrlHeaders = process.env.HOTEL_DATA_URL_HEADERS;
    const previousCacheSeconds = process.env.HOTEL_DATA_CACHE_SECONDS;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URL;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_URL;
    delete process.env.HOTEL_DATA_MANIFEST_URLS;
    delete process.env.HOTEL_DATA_URL_HEADERS;
    process.env.HOTEL_DATA_CACHE_SECONDS = '3600';
    clearInventoryCache();

    const mappedJson = JSON.stringify({
      offers: [
        {
          offerId: 'inline-mapped-001',
          hotel: {
            title: '厦门内联配置映射酒店',
            provinceName: '福建省',
            cityName: '厦门市',
            areaName: '思明',
            location: '厦门市思明区内联路 1 号'
          },
          rate: {
            sale: 788,
            book: 'https://example.com/inline-mapped-001'
          },
          stay: {
            from: '2026-06-01',
            to: '2026-12-31'
          },
          stock: 'available'
        }
      ]
    });

    const supplierServer = createHttpServer((request, response) => {
      assert.equal(request.url, '/inline-mapped.json');
      assert.equal(request.headers.authorization, 'Bearer inline-token');
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(mappedJson);
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();
    process.env.HOTEL_DATA_MANIFEST_CONFIG = JSON.stringify({
      sources: [
        {
          name: '内联配置供应商',
          url: `http://127.0.0.1:${address.port}/inline-mapped.json`,
          headers: {
            Authorization: 'Bearer inline-token'
          },
          fieldMap: {
            id: 'offerId',
            name: 'hotel.title',
            province: 'hotel.provinceName',
            city: 'hotel.cityName',
            district: 'hotel.areaName',
            address: 'hotel.location',
            price: 'rate.sale',
            bookingUrl: 'rate.book',
            checkIn: 'stay.from',
            checkOut: 'stay.to',
            available: 'stock'
          }
        }
      ]
    });

    try {
      const result = await searchHotels({
        city: '厦门',
        keyword: '内联配置',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'local');
      assert.equal(result.total, 1);
      assert.equal(result.hotels[0].name, '厦门内联配置映射酒店');
      assert.equal(result.hotels[0].price, 788);
      assert.equal(result.hotels[0].providerName, '内联配置供应商');
      assert.equal(result.providers.localInventory.remoteCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.configSourceCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.manifestUrlCount, 0);
      assert.equal(result.providers.localInventory.remoteInventory.loadCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.okCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.loads[0].name, '内联配置供应商');
      assert.equal(result.providers.localInventory.remoteInventory.loads[0].rowCount, 1);
      assert.match(result.notice, /1 个已接入的供应商库存源/);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousManifestUrl === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URL;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URL = previousManifestUrl;
      }
      if (previousManifestUrls === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_URLS;
      } else {
        process.env.HOTEL_DATA_MANIFEST_URLS = previousManifestUrls;
      }
      if (previousManifestConfig === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
      } else {
        process.env.HOTEL_DATA_MANIFEST_CONFIG = previousManifestConfig;
      }
      if (previousDataUrlHeaders === undefined) {
        delete process.env.HOTEL_DATA_URL_HEADERS;
      } else {
        process.env.HOTEL_DATA_URL_HEADERS = previousDataUrlHeaders;
      }
      if (previousCacheSeconds === undefined) {
        delete process.env.HOTEL_DATA_CACHE_SECONDS;
      } else {
        process.env.HOTEL_DATA_CACHE_SECONDS = previousCacheSeconds;
      }
    }
  });

  it('falls back to demo data when every remote supplier URL fails to load', async () => {
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousManifestConfig = process.env.HOTEL_DATA_MANIFEST_CONFIG;
    const previousDataUrlHeaders = process.env.HOTEL_DATA_URL_HEADERS;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
    delete process.env.HOTEL_DATA_URL_HEADERS;
    clearInventoryCache();

    const supplierServer = createHttpServer((request, response) => {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'temporarily unavailable' }));
    });
    await new Promise((resolve) => supplierServer.listen(0, resolve));
    const address = supplierServer.address();

    process.env.HOTEL_DATA_URL = `http://127.0.0.1:${address.port}/remote.csv`;

    try {
      const result = await searchHotels({
        city: '',
        keyword: '近商圈',
        checkIn: '2026-06-06',
        checkOut: '2026-06-07'
      });

      assert.equal(result.source, 'demo');
      assert.ok(result.total > 20);
      assert.equal(result.providers.localInventory.remoteCount, 1);
      assert.equal(result.providers.localInventory.sourceErrors.length, 1);
      assert.equal(result.providers.localInventory.remoteInventory.loadCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.failedCount, 1);
      assert.equal(result.providers.localInventory.remoteInventory.loads[0].status, 'failed');
      assert.match(result.providers.localInventory.remoteInventory.loads[0].error, /HTTP 503/);
      assert.match(result.notice, /远程供应商文件读取失败|回退到备用数据源/);
    } finally {
      clearInventoryCache();
      await new Promise((resolve, reject) => supplierServer.close((error) => error ? reject(error) : resolve()));
      if (previousFile === undefined) {
        delete process.env.HOTEL_DATA_FILE;
      } else {
        process.env.HOTEL_DATA_FILE = previousFile;
      }
      if (previousFiles === undefined) {
        delete process.env.HOTEL_DATA_FILES;
      } else {
        process.env.HOTEL_DATA_FILES = previousFiles;
      }
      if (previousImportDir === undefined) {
        delete process.env.HOTEL_IMPORT_DIR;
      } else {
        process.env.HOTEL_IMPORT_DIR = previousImportDir;
      }
      if (previousDataUrl === undefined) {
        delete process.env.HOTEL_DATA_URL;
      } else {
        process.env.HOTEL_DATA_URL = previousDataUrl;
      }
      if (previousDataUrls === undefined) {
        delete process.env.HOTEL_DATA_URLS;
      } else {
        process.env.HOTEL_DATA_URLS = previousDataUrls;
      }
      if (previousManifestConfig === undefined) {
        delete process.env.HOTEL_DATA_MANIFEST_CONFIG;
      } else {
        process.env.HOTEL_DATA_MANIFEST_CONFIG = previousManifestConfig;
      }
      if (previousDataUrlHeaders === undefined) {
        delete process.env.HOTEL_DATA_URL_HEADERS;
      } else {
        process.env.HOTEL_DATA_URL_HEADERS = previousDataUrlHeaders;
      }
    }
  });
});

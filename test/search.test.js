import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildDemoHotels, cityCatalog } from '../server/hotel-data.js';
import { createHotelServer, searchHotels } from '../server/index.js';

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

  it('loads a remote supplier CSV URL as searchable real inventory', async () => {
    const previousFile = process.env.HOTEL_DATA_FILE;
    const previousFiles = process.env.HOTEL_DATA_FILES;
    const previousImportDir = process.env.HOTEL_IMPORT_DIR;
    const previousDataUrl = process.env.HOTEL_DATA_URL;
    const previousDataUrls = process.env.HOTEL_DATA_URLS;
    const previousDataUrlHeaders = process.env.HOTEL_DATA_URL_HEADERS;

    delete process.env.HOTEL_DATA_FILE;
    delete process.env.HOTEL_DATA_FILES;
    delete process.env.HOTEL_IMPORT_DIR;
    delete process.env.HOTEL_DATA_URLS;
    delete process.env.HOTEL_DATA_URL_HEADERS;

    const csv = [
      'id,name,province,city,district,address,star,rating,price,currency,tags,source,checkIn,checkOut,available,bookingUrl',
      'remote-001,深圳远程供应商酒店,广东,深圳,南山,深圳市南山区科技园 88 号,5,4.9,899,CNY,真实库存,远程供应商,2026-06-01,2026-12-31,true,https://example.com/remote-001'
    ].join('\n');
    const supplierServer = createHttpServer((request, response) => {
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
    } finally {
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
      if (previousDataUrlHeaders === undefined) {
        delete process.env.HOTEL_DATA_URL_HEADERS;
      } else {
        process.env.HOTEL_DATA_URL_HEADERS = previousDataUrlHeaders;
      }
    }
  });
});

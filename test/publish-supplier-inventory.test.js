import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cityCatalog } from '../server/hotel-data.js';
import { publishSupplierInventory } from '../scripts/publish-supplier-inventory.js';

describe('supplier inventory publisher', () => {
  it('verifies, splits and builds Pages for a valid nationwide supplier file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-publish-pass-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>').catch(async () => {
      await mkdir(join(root, 'public'), { recursive: true });
      await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    });
    const inventoryJson = JSON.stringify(cityCatalog.map(({ province, city }, index) => ({
      offer: {
        channelId: `hotel-${index + 1}`,
        sale: 400 + index,
        updatedAt: '2026-06-06T12:00:00Z'
      },
      hotel: {
        title: `${city}发布酒店`,
        provinceName: province,
        cityName: city
      },
      stay: {
        from: '2026-06-01',
        to: '2026-12-31'
      },
      supplier: {
        name: '全国发布供应商'
      }
    })));
    const fieldMap = {
      id: 'offer.channelId',
      name: 'hotel.title',
      province: 'hotel.provinceName',
      city: 'hotel.cityName',
      price: 'offer.sale',
      providerName: 'supplier.name',
      checkIn: 'stay.from',
      checkOut: 'stay.to',
      updatedAt: 'offer.updatedAt'
    };
    const inventoryServer = await startInventoryServer(inventoryJson, {
      path: '/supplier.json',
      contentType: 'application/json',
      requiredHeaders: { authorization: 'Bearer publish-token' }
    });

    try {
      const result = await publishSupplierInventory({
        rootDir: root,
        inputFiles: [inventoryServer.url],
        fieldMap,
        headers: { Authorization: 'Bearer publish-token' },
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        maxPriceAgeHours: 24,
        referenceTime: '2026-06-06T18:00:00Z'
      });
      assert.equal(result.published, true);
      assert.equal(result.verification.coverage.coveredCities, cityCatalog.length);
      assert.equal(result.build.coverage.passed, true);
      assert.equal(result.build.coverage.pricedHotelCount, cityCatalog.length);
      await access(join(root, 'docs', 'hotel-inventory.manifest.json'));
      const manifest = JSON.parse(await readFile(join(root, 'public', 'hotel-inventory.manifest.json'), 'utf8'));
      assert.equal(manifest.sources.length, cityCatalog.length);
      assert.ok(manifest.sources.every((source) => source.pricedHotelCount >= 1));
    } finally {
      await inventoryServer.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('publishes a nationwide multi-source manifest with per-source config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-publish-manifest-'));
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    const mappedCities = cityCatalog.filter((_, index) => index % 2 === 0);
    const standardCities = cityCatalog.filter((_, index) => index % 2 === 1);
    const mappedJson = JSON.stringify(mappedCities.map(({ province, city }, index) => ({
      offer: {
        id: `mapped-${index + 1}`,
        sale: 500 + index,
        updatedAt: '2026-06-06T12:00:00Z'
      },
      hotel: {
        title: `${city}清单映射发布酒店`,
        provinceName: province,
        cityName: city
      },
      stay: {
        from: '2026-06-01',
        to: '2026-12-31'
      }
    })));
    const standardCsv = [
      'id,name,province,city,source,price,checkIn,checkOut,updatedAt',
      ...standardCities.map(({ province, city }, index) => [
        `standard-${index + 1}`,
        `${city}清单标准发布酒店`,
        province,
        city,
        '标准清单发布供应商',
        600 + index,
        '2026-06-01',
        '2026-12-31',
        '2026-06-06T12:00:00Z'
      ].join(','))
    ].join('\n');
    const server = await startPublishSourceManifestServer({ mappedJson, standardCsv });

    try {
      const result = await publishSupplierInventory({
        rootDir: root,
        sourceManifest: server.manifestUrl,
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        maxPriceAgeHours: 24,
        referenceTime: '2026-06-06T18:00:00Z'
      });

      assert.equal(result.published, true);
      assert.equal(result.verification.coverage.coveredCities, cityCatalog.length);
      assert.equal(result.build.coverage.pricedHotelCount, cityCatalog.length);
      assert.deepEqual(server.requests, {
        mappedAuthorization: 'Bearer mapped-publish-token',
        standardApiKey: 'standard-publish-key'
      });
      const manifest = JSON.parse(await readFile(join(root, 'public', 'hotel-inventory.manifest.json'), 'utf8'));
      assert.equal(manifest.sources.length, cityCatalog.length);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not replace existing published shards when verification fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-publish-fail-'));
    await mkdir(join(root, 'public', 'inventory', 'existing'), { recursive: true });
    await mkdir(join(root, 'supplier'), { recursive: true });
    const existingShard = join(root, 'public', 'inventory', 'existing', 'keep.jsonl');
    await writeFile(existingShard, '{"id":"existing"}\n');
    const inputFile = join(root, 'supplier', 'partial.csv');
    await writeFile(inputFile, [
      'id,name,province,city,source,price',
      'bj-1,北京无价酒店,北京,北京,部分供应商,0',
      'bad-1,未知城市酒店,,,部分供应商,288'
    ].join('\n'));

    try {
      const result = await publishSupplierInventory({ rootDir: root, inputFiles: [inputFile] });
      assert.equal(result.published, false);
      assert.equal(result.split, null);
      assert.equal(await readFile(existingShard, 'utf8'), '{"id":"existing"}\n');
      await assert.rejects(() => access(join(root, 'docs', 'hotel-inventory.manifest.json')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function startInventoryServer(content, options = {}) {
  const routePath = options.path || '/supplier.csv';
  const contentType = options.contentType || 'text/csv; charset=utf-8';
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (requestUrl.pathname !== routePath) {
      response.writeHead(404).end();
      return;
    }
    if (!hasRequiredHeaders(request, options.requiredHeaders || {})) {
      response.writeHead(401).end('unauthorized');
      return;
    }
    response.writeHead(200, { 'content-type': contentType });
    response.end(content);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${routePath}?signature=a,b;c`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function startPublishSourceManifestServer({ mappedJson, standardCsv }) {
  const requests = {};
  const server = createServer((request, response) => {
    if (request.url === '/manifest.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        sources: [
          {
            name: '映射清单发布供应商',
            url: '/mapped.json',
            headers: { Authorization: 'Bearer mapped-publish-token' },
            fieldMap: {
              id: 'offer.id',
              name: 'hotel.title',
              province: 'hotel.provinceName',
              city: 'hotel.cityName',
              price: 'offer.sale',
              checkIn: 'stay.from',
              checkOut: 'stay.to',
              updatedAt: 'offer.updatedAt'
            }
          },
          {
            name: '标准清单发布供应商',
            url: '/standard.csv',
            headers: { 'X-Api-Key': 'standard-publish-key' }
          }
        ]
      }));
      return;
    }
    if (request.url === '/mapped.json') {
      requests.mappedAuthorization = request.headers.authorization;
      response.writeHead(request.headers.authorization === 'Bearer mapped-publish-token' ? 200 : 401, { 'content-type': 'application/json; charset=utf-8' });
      response.end(mappedJson);
      return;
    }
    if (request.url === '/standard.csv') {
      requests.standardApiKey = request.headers['x-api-key'];
      response.writeHead(request.headers['x-api-key'] === 'standard-publish-key' ? 200 : 401, { 'content-type': 'text/csv; charset=utf-8' });
      response.end(standardCsv);
      return;
    }
    response.writeHead(404).end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    manifestUrl: `http://127.0.0.1:${port}/manifest.json`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function hasRequiredHeaders(request, requiredHeaders) {
  return Object.entries(requiredHeaders).every(([name, value]) =>
    request.headers[String(name).toLowerCase()] === value
  );
}

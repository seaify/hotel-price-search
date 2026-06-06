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
      contentType: 'application/json'
    });

    try {
      const result = await publishSupplierInventory({
        rootDir: root,
        inputFiles: [inventoryServer.url],
        fieldMap,
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

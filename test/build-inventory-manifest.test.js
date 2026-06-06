import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildInventoryManifest } from '../scripts/build-inventory-manifest.js';

describe('inventory manifest builder', () => {
  it('generates destination-scoped Pages manifest entries from inventory shards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-manifest-'));
    const inventoryDir = join(root, 'public', 'inventory');
    await mkdir(join(inventoryDir, 'south'), { recursive: true });

    await writeFile(join(inventoryDir, 'south', 'gd.csv'), [
      'id,masterHotelId,name,province,city,address,source,price,checkIn,checkOut,available',
      'sz-1,CN-GD-SZ-1,深圳湾测试酒店,广东省,深圳市,深圳南山测试路 1 号,南方供应商,588,2026-06-01,2026-12-31,true',
      'gz-1,CN-GD-GZ-1,广州塔测试酒店,广东省,广州市,广州海珠测试路 2 号,南方供应商,688,2026-06-01,2026-12-31,true'
    ].join('\n'));
    await writeFile(join(inventoryDir, 'beijing.jsonl'), [
      JSON.stringify({ id: 'bj-1', name: '北京国贸测试酒店', province: '北京', city: '北京', source: '北京供应商', price: 788, checkIn: '2026-06-01', checkOut: '2026-12-31' }),
      JSON.stringify({ id: 'bj-2', name: '北京朝阳测试酒店', province: '北京市', city: '北京市', source: '北京供应商', price: 888, checkIn: '2026-06-01', checkOut: '2026-12-31' })
    ].join('\n'));

    try {
      const manifest = await buildInventoryManifest({ rootDir: root });
      assert.equal(manifest.sources.length, 2);

      const south = manifest.sources.find((source) => source.url === 'inventory/south/gd.csv');
      assert.ok(south);
      assert.equal(south.name, '南方供应商');
      assert.deepEqual(south.cities, ['广州', '深圳']);
      assert.equal(south.rowCount, 2);
      assert.equal(south.hotelCount, 2);
      assert.equal(south.pricedRowCount, 2);
      assert.equal(south.pricedHotelCount, 2);
      assert.equal(south.minPrice, 588);
      assert.equal(south.provinces, undefined);
      assert.deepEqual(south.cityStats, [
        { province: '广东', city: '广州', rowCount: 1, hotelCount: 1, pricedRowCount: 1, pricedHotelCount: 1, minPrice: 688, dateStats: [{ checkIn: '2026-06-01', checkOut: '2026-12-31', rowCount: 1, hotelCount: 1, pricedRowCount: 1, pricedHotelCount: 1, minPrice: 688 }] },
        { province: '广东', city: '深圳', rowCount: 1, hotelCount: 1, pricedRowCount: 1, pricedHotelCount: 1, minPrice: 588, dateStats: [{ checkIn: '2026-06-01', checkOut: '2026-12-31', rowCount: 1, hotelCount: 1, pricedRowCount: 1, pricedHotelCount: 1, minPrice: 588 }] }
      ]);

      const beijing = manifest.sources.find((source) => source.url === 'inventory/beijing.jsonl');
      assert.ok(beijing);
      assert.equal(beijing.name, '北京供应商');
      assert.deepEqual(beijing.cities, ['北京']);
      assert.equal(beijing.rowCount, 2);
      assert.equal(beijing.hotelCount, 2);
      assert.equal(beijing.pricedRowCount, 2);
      assert.equal(beijing.pricedHotelCount, 2);
      assert.equal(beijing.minPrice, 788);
      assert.deepEqual(beijing.cityStats, [
        { province: '北京', city: '北京', rowCount: 2, hotelCount: 2, pricedRowCount: 2, pricedHotelCount: 2, minPrice: 788, dateStats: [{ checkIn: '2026-06-01', checkOut: '2026-12-31', rowCount: 2, hotelCount: 2, pricedRowCount: 2, pricedHotelCount: 2, minPrice: 788 }] }
      ]);

      const written = JSON.parse(await readFile(join(root, 'public', 'hotel-inventory.manifest.json'), 'utf8'));
      assert.deepEqual(written.sources, manifest.sources);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records latest price update timestamps in source, city and date stats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-manifest-freshness-'));
    const inventoryDir = join(root, 'public', 'inventory');
    await mkdir(inventoryDir, { recursive: true });
    await writeFile(join(inventoryDir, 'fresh.csv'), [
      'id,name,province,city,source,price,checkIn,checkOut,updatedAt',
      'sz-1,深圳新鲜价格酒店,广东,深圳,新鲜供应商,588,2026-06-01,2026-12-31,2026-06-06T10:00:00Z',
      'sz-2,深圳更新价格酒店,广东,深圳,新鲜供应商,688,2026-06-01,2026-12-31,2026-06-06T12:00:00Z'
    ].join('\n'));

    try {
      const manifest = await buildInventoryManifest({ rootDir: root });
      const source = manifest.sources[0];
      assert.equal(source.updatedAt, '2026-06-06T12:00:00.000Z');
      assert.equal(source.cityStats[0].updatedAt, '2026-06-06T12:00:00.000Z');
      assert.equal(source.cityStats[0].dateStats[0].updatedAt, '2026-06-06T12:00:00.000Z');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('counts only available rows with positive parsed prices', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-manifest-prices-'));
    const inventoryDir = join(root, 'public', 'inventory');
    await mkdir(inventoryDir, { recursive: true });
    await writeFile(join(inventoryDir, 'prices.csv'), [
      'id,name,province,city,source,lowestPrice,totalAmount,available,checkIn,checkOut',
      'sz-1,深圳有价酒店,广东,深圳,价格供应商,"¥1,288.50",,true,2026-06-01,2026-12-31',
      'sz-2,深圳总价酒店,广东,深圳,价格供应商,,588元,true,2026-06-01,2026-12-31',
      'sz-3,深圳零价酒店,广东,深圳,价格供应商,0,,true,2026-06-01,2026-12-31',
      'sz-4,深圳不可售酒店,广东,深圳,价格供应商,488,,false,2026-06-01,2026-12-31'
    ].join('\n'));

    try {
      const manifest = await buildInventoryManifest({ rootDir: root });
      const source = manifest.sources[0];
      assert.equal(source.rowCount, 4);
      assert.equal(source.hotelCount, 4);
      assert.equal(source.pricedRowCount, 2);
      assert.equal(source.pricedHotelCount, 2);
      assert.equal(source.minPrice, 588);
      assert.deepEqual(source.cityStats, [{
        province: '广东',
        city: '深圳',
        rowCount: 3,
        hotelCount: 3,
        pricedRowCount: 2,
        pricedHotelCount: 2,
        minPrice: 588,
        dateStats: [{
          checkIn: '2026-06-01',
          checkOut: '2026-12-31',
          rowCount: 3,
          hotelCount: 3,
          pricedRowCount: 2,
          pricedHotelCount: 2,
          minPrice: 588
        }]
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

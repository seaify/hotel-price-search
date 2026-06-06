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
      'id,masterHotelId,name,province,city,address,source,price',
      'sz-1,CN-GD-SZ-1,深圳湾测试酒店,广东省,深圳市,深圳南山测试路 1 号,南方供应商,588',
      'gz-1,CN-GD-GZ-1,广州塔测试酒店,广东省,广州市,广州海珠测试路 2 号,南方供应商,688'
    ].join('\n'));
    await writeFile(join(inventoryDir, 'beijing.jsonl'), [
      JSON.stringify({ id: 'bj-1', name: '北京国贸测试酒店', province: '北京', city: '北京', source: '北京供应商', price: 788 }),
      JSON.stringify({ id: 'bj-2', name: '北京朝阳测试酒店', province: '北京市', city: '北京市', source: '北京供应商', price: 888 })
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
      assert.equal(south.provinces, undefined);
      assert.deepEqual(south.cityStats, [
        { province: '广东', city: '广州', rowCount: 1, hotelCount: 1 },
        { province: '广东', city: '深圳', rowCount: 1, hotelCount: 1 }
      ]);

      const beijing = manifest.sources.find((source) => source.url === 'inventory/beijing.jsonl');
      assert.ok(beijing);
      assert.equal(beijing.name, '北京供应商');
      assert.deepEqual(beijing.cities, ['北京']);
      assert.equal(beijing.rowCount, 2);
      assert.equal(beijing.hotelCount, 2);
      assert.deepEqual(beijing.cityStats, [
        { province: '北京', city: '北京', rowCount: 2, hotelCount: 2 }
      ]);

      const written = JSON.parse(await readFile(join(root, 'public', 'hotel-inventory.manifest.json'), 'utf8'));
      assert.deepEqual(written.sources, manifest.sources);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

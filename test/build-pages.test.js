import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPages } from '../scripts/build-pages.js';
import { cityCatalog } from '../server/hotel-data.js';

describe('GitHub Pages builder', () => {
  it('copies nested inventory shards and generates the Pages inventory manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-build-'));
    await mkdir(join(root, 'public', 'inventory', 'guangdong'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'app.js'), 'console.log("app");\n');
    await writeFile(join(root, 'public', 'inventory', 'guangdong', 'shenzhen.csv'), [
      'id,masterHotelId,name,province,city,address,source,price',
      'sz-1,CN-SZ-1,深圳发布测试酒店,广东省,深圳市,深圳南山测试路 1 号,发布供应商,588'
    ].join('\n'));

    try {
      const result = await buildPages({ rootDir: root });
      const manifest = JSON.parse(await readFile(join(root, 'docs', 'hotel-inventory.manifest.json'), 'utf8'));
      const docsStaticData = await readFile(join(root, 'docs', 'static-data.js'), 'utf8');
      const publicStaticData = await readFile(join(root, 'public', 'static-data.js'), 'utf8');

      assert.equal(result.inventory.generatedManifest, true);
      assert.equal(result.inventory.sourceCount, 1);
      assert.equal(manifest.sources.length, 1);
      assert.equal(manifest.sources[0].url, 'inventory/guangdong/shenzhen.csv');
      assert.deepEqual(manifest.sources[0].cities, ['深圳']);
      assert.equal(manifest.sources[0].rowCount, 1);
      assert.equal(manifest.sources[0].hotelCount, 1);
      assert.deepEqual(manifest.sources[0].cityStats, [
        { province: '广东', city: '深圳', rowCount: 1, hotelCount: 1 }
      ]);
      assert.match(docsStaticData, /window\.HOTEL_STATIC_MODE = true;/);
      assert.match(publicStaticData, /window\.HOTEL_STATIC_MODE = false;/);
      await access(join(root, 'docs', 'inventory', 'guangdong', 'shenzhen.csv'));
      await access(join(root, 'docs', '.nojekyll'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects partial inventory coverage when full coverage is required', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-coverage-'));
    await mkdir(join(root, 'public', 'inventory'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'inventory', 'beijing.csv'), [
      'id,name,province,city,source,price',
      'bj-1,北京发布测试酒店,北京,北京,北京供应商,788'
    ].join('\n'));

    try {
      await assert.rejects(
        () => buildPages({ rootDir: root, requireFullInventoryCoverage: true }),
        new RegExp(`Inventory coverage audit failed: 1/${cityCatalog.length} cities covered`)
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects manifests that do not meet the configured per-city hotel minimum', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-minimums-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    const cityStats = cityCatalog.map(({ province, city }) => ({
      province,
      city,
      rowCount: 4,
      hotelCount: 1
    }));
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{ name: '低深度外部源', url: 'https://example.com/inventory/all.csv', provinces, cityStats }]
    }));

    try {
      await assert.rejects(
        () => buildPages({ rootDir: root, minHotelsPerCity: 2 }),
        /Below minimums: .* hotels 1\/2/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

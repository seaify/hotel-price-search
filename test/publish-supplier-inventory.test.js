import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const inputFile = join(root, 'supplier', 'nationwide.csv');
    await writeFile(inputFile, [
      'id,name,province,city,source,price,checkIn,checkOut,updatedAt',
      ...cityCatalog.map(({ province, city }, index) => [
        `hotel-${index + 1}`,
        `${city}发布酒店`,
        province,
        city,
        '全国发布供应商',
        400 + index,
        '2026-06-01',
        '2026-12-31',
        '2026-06-06T12:00:00Z'
      ].join(','))
    ].join('\n'));

    try {
      const result = await publishSupplierInventory({
        rootDir: root,
        inputFiles: [inputFile],
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

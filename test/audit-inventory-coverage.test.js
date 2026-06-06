import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cityCatalog } from '../server/hotel-data.js';
import { auditInventoryCoverage } from '../scripts/audit-inventory-coverage.js';

describe('inventory coverage audit', () => {
  it('expands province and city manifest scopes into a nationwide coverage report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-coverage-audit-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const manifestPath = join(root, 'public', 'hotel-inventory.manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      sources: [
        { name: '广东分片', url: 'inventory/gd.csv', provinces: ['广东省'], rowCount: 200, hotelCount: 120 },
        { name: '北京分片', url: 'inventory/bj.csv', cities: ['北京市'], rowCount: 50, hotelCount: 30 },
        { name: '未标注范围', url: 'inventory/global.csv', rowCount: 10, hotelCount: 8 },
        { name: '未知城市', url: 'inventory/unknown.csv', cities: ['不存在市'] }
      ]
    }));

    try {
      const summary = await auditInventoryCoverage({
        rootDir: root,
        missingCsvPath: 'missing.csv'
      });
      const guangdongCityCount = cityCatalog.filter((item) => item.province === '广东').length;

      assert.equal(summary.sourceCount, 4);
      assert.equal(summary.scopedSourceCount, 3);
      assert.equal(summary.unscopedSourceCount, 1);
      assert.equal(summary.coveredCities, guangdongCityCount + 1);
      assert.equal(summary.coveredProvinces, 2);
      assert.equal(summary.rowCount, 260);
      assert.equal(summary.hotelCount, 158);
      assert.equal(summary.passed, false);
      assert.deepEqual(summary.unscopedSources.map((source) => source.name), ['未标注范围']);
      assert.deepEqual(summary.unknownDestinations, ['不存在']);
      assert.ok(summary.missingCities.some((item) => item.city === '上海'));

      const missingCsv = await readFile(join(root, 'missing.csv'), 'utf8');
      assert.match(missingCsv, /^province,city\n/);
      assert.match(missingCsv, /上海,上海/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes when all catalog provinces are explicitly covered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-coverage-full-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{ name: '全国分片', url: 'inventory/all.csv', provinces }]
    }));

    try {
      const summary = await auditInventoryCoverage({ rootDir: root });
      assert.equal(summary.coveredCities, cityCatalog.length);
      assert.equal(summary.missingCities.length, 0);
      assert.equal(summary.unscopedSourceCount, 0);
      assert.equal(summary.unknownDestinations.length, 0);
      assert.equal(summary.passed, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

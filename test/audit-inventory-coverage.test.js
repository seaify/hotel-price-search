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

  it('requires per-city hotel stats when strict inventory evidence is requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-coverage-city-stats-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [
        {
          name: '范围声明源',
          url: 'inventory/all.csv',
          provinces,
          cityStats: [{ province: '北京', city: '北京', rowCount: 10, hotelCount: 6 }]
        }
      ]
    }));

    try {
      const summary = await auditInventoryCoverage({ rootDir: root, requireCityHotels: true });
      assert.equal(summary.coveredCities, cityCatalog.length);
      assert.equal(summary.missingCities.length, 0);
      assert.equal(summary.citiesWithHotelStats, 1);
      assert.equal(summary.citiesWithoutHotelStats.length, cityCatalog.length - 1);
      assert.ok(summary.citiesWithoutHotelStats.some((item) => item.city === '上海'));
      assert.equal(summary.passed, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags cities below configured hotel and row minimums', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-coverage-minimums-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    const cityStats = cityCatalog.map(({ province, city }) => ({
      province,
      city,
      rowCount: city === '北京' ? 4 : 12,
      hotelCount: city === '北京' ? 2 : 8
    }));
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{ name: '深度统计源', url: 'inventory/all.csv', provinces, cityStats }]
    }));

    try {
      const summary = await auditInventoryCoverage({
        rootDir: root,
        minHotelsPerCity: 5,
        minRowsPerCity: 10
      });
      assert.equal(summary.coveredCities, cityCatalog.length);
      assert.equal(summary.missingCities.length, 0);
      assert.equal(summary.citiesBelowMinimums.length, 1);
      assert.deepEqual(summary.citiesBelowMinimums[0], {
        province: '北京',
        city: '北京',
        rowCount: 4,
        hotelCount: 2,
        minRowCount: 10,
        minHotelCount: 5
      });
      assert.equal(summary.passed, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

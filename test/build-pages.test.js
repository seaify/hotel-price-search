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
      'id,masterHotelId,name,province,city,address,source,price,checkIn,checkOut',
      'sz-1,CN-SZ-1,深圳发布测试酒店,广东省,深圳市,深圳南山测试路 1 号,发布供应商,588,2026-06-01,2026-12-31'
    ].join('\n'));

    try {
      const result = await buildPages({ rootDir: root, generatedAt: '2026-06-06T00:00:00Z' });
      const manifest = JSON.parse(await readFile(join(root, 'docs', 'hotel-inventory.manifest.json'), 'utf8'));
      const readiness = JSON.parse(await readFile(join(root, 'docs', 'inventory-readiness.json'), 'utf8'));
      const docsStaticData = await readFile(join(root, 'docs', 'static-data.js'), 'utf8');
      const publicStaticData = await readFile(join(root, 'public', 'static-data.js'), 'utf8');

      assert.equal(result.inventory.generatedManifest, true);
      assert.equal(result.inventory.sourceCount, 1);
      assert.equal(result.readiness.generatedAt, '2026-06-06T00:00:00Z');
      assert.equal(readiness.schemaVersion, 1);
      assert.equal(readiness.mode, 'inventory-audit');
      assert.equal(readiness.passed, false);
      assert.equal(readiness.coverage.coveredCities, 1);
      assert.equal(readiness.coverage.totalCities, cityCatalog.length);
      assert.equal(readiness.coverage.hotelCount, 1);
      assert.equal(readiness.coverage.pricedRowCount, 1);
      assert.equal(readiness.coverage.missingCityCount, cityCatalog.length - 1);
      assert.equal(readiness.coverage.sourceCoverage[0].coveredCities, 1);
      assert.equal(readiness.failures[0].type, 'missing-cities');
      assert.equal(manifest.sources.length, 1);
      assert.equal(manifest.sources[0].url, 'inventory/guangdong/shenzhen.csv');
      assert.deepEqual(manifest.sources[0].cities, ['深圳']);
      assert.equal(manifest.sources[0].rowCount, 1);
      assert.equal(manifest.sources[0].hotelCount, 1);
      assert.equal(manifest.sources[0].pricedRowCount, 1);
      assert.equal(manifest.sources[0].pricedHotelCount, 1);
      assert.equal(manifest.sources[0].minPrice, 588);
      assert.deepEqual(manifest.sources[0].cityStats, [
        { province: '广东', city: '深圳', rowCount: 1, hotelCount: 1, pricedRowCount: 1, pricedHotelCount: 1, minPrice: 588, dateStats: [{ checkIn: '2026-06-01', checkOut: '2026-12-31', rowCount: 1, hotelCount: 1, pricedRowCount: 1, pricedHotelCount: 1, minPrice: 588 }] }
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

  it('rejects manifests that do not meet the configured per-city priced hotel minimum', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-price-minimums-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    const cityStats = cityCatalog.map(({ province, city }) => ({
      province,
      city,
      rowCount: 4,
      hotelCount: 2,
      pricedRowCount: city === '北京' ? 0 : 4,
      pricedHotelCount: city === '北京' ? 0 : 2,
      minPrice: city === '北京' ? 0 : 388
    }));
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{ name: '低价格证据源', url: 'https://example.com/inventory/all.csv', provinces, cityStats }]
    }));

    try {
      await assert.rejects(
        () => buildPages({ rootDir: root, minPricedHotelsPerCity: 1 }),
        /Below price minimums: 北京\/北京 priced hotels 0\/1/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects manifests that do not meet configured nationwide totals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-total-minimums-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{
        name: '总量不足外部源',
        url: 'https://example.com/inventory/all.csv',
        provinces,
        rowCount: 100,
        hotelCount: 80,
        pricedRowCount: 60,
        pricedHotelCount: 40
      }]
    }));

    try {
      await assert.rejects(
        () => buildPages({ rootDir: root, minTotalHotels: 100, minTotalPricedRows: 70 }),
        /Below total minimums: hotels 80\/100, priced rows 60\/70/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects manifests without per-city availability for the configured stay dates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-date-evidence-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    const cityStats = cityCatalog.map(({ province, city }) => ({
      province,
      city,
      rowCount: 6,
      hotelCount: 3,
      dateStats: [{
        checkIn: city === '北京' ? '2026-01-01' : '2026-06-01',
        checkOut: city === '北京' ? '2026-02-01' : '2026-12-31',
        rowCount: 6,
        hotelCount: 3
      }]
    }));
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{ name: '日期外部源', url: 'https://example.com/inventory/all.csv', provinces, cityStats }]
    }));

    try {
      await assert.rejects(
        () => buildPages({
          rootDir: root,
          requireFullInventoryCoverage: true,
          checkIn: '2026-06-06',
          checkOut: '2026-06-07'
        }),
        /Missing: 北京\/北京/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects manifests with stale per-city price updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-pages-freshness-'));
    await mkdir(join(root, 'public'), { recursive: true });
    const provinces = [...new Set(cityCatalog.map((item) => item.province))];
    const cityStats = cityCatalog.map(({ province, city }) => ({
      province,
      city,
      rowCount: 6,
      hotelCount: 3,
      updatedAt: city === '北京' ? '2026-06-04T09:00:00Z' : '2026-06-06T09:00:00Z'
    }));
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    await writeFile(join(root, 'public', 'hotel-inventory.manifest.json'), JSON.stringify({
      sources: [{ name: '过期价格源', url: 'https://example.com/inventory/all.csv', provinces, cityStats }]
    }));

    try {
      await assert.rejects(
        () => buildPages({
          rootDir: root,
          maxPriceAgeHours: 24,
          referenceTime: '2026-06-06T12:00:00Z'
        }),
        /Stale prices: 北京\/北京 updated 2026-06-04T09:00:00.000Z/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cityCatalog } from '../server/hotel-data.js';
import { verifySupplierInventory } from '../scripts/verify-supplier-inventory.js';

describe('supplier inventory verifier', () => {
  it('passes a nationwide supplier file with priced city evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-verify-pass-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'nationwide.csv');
    await writeFile(inputFile, [
      'id,name,province,city,source,price,checkIn,checkOut,updatedAt',
      ...cityCatalog.map(({ province, city }, index) => [
        `hotel-${index + 1}`,
        `${city}验收酒店`,
        province,
        city,
        '全国验收供应商',
        300 + index,
        '2026-06-01',
        '2026-12-31',
        '2026-06-06T12:00:00Z'
      ].join(','))
    ].join('\n'));

    try {
      const result = await verifySupplierInventory({
        cwd: root,
        inputFiles: [inputFile],
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        maxPriceAgeHours: 24,
        referenceTime: '2026-06-06T18:00:00Z'
      });
      assert.equal(result.passed, true);
      assert.equal(result.split.skippedRowCount, 0);
      assert.equal(result.coverage.coveredCities, cityCatalog.length);
      assert.equal(result.coverage.pricedHotelCount, cityCatalog.length);
      assert.equal(result.coverage.citiesBelowPriceMinimums.length, 0);
      assert.equal(result.nextCommands.length, 2);
      assert.match(result.nextCommands[0], /split:inventory-shards/);
      assert.match(result.nextCommands[1], /HOTEL_PAGES_REQUIRE_FULL_INVENTORY_COVERAGE=true/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses field map files while verifying non-standard supplier exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-verify-field-map-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'nationwide.json');
    const fieldMapFile = join(root, 'supplier', 'field-map.json');
    await writeFile(inputFile, JSON.stringify(cityCatalog.map(({ province, city }, index) => ({
      offer: {
        id: `mapped-${index + 1}`,
        amount: 500 + index,
        updatedAt: '2026-06-06T12:00:00Z'
      },
      hotel: {
        title: `${city}映射验收酒店`,
        provinceName: province,
        cityName: city
      },
      stay: {
        from: '2026-06-01',
        to: '2026-12-31'
      },
      supplier: {
        name: '映射验收供应商'
      }
    }))));
    await writeFile(fieldMapFile, JSON.stringify({
      id: 'offer.id',
      name: 'hotel.title',
      province: 'hotel.provinceName',
      city: 'hotel.cityName',
      price: 'offer.amount',
      providerName: 'supplier.name',
      checkIn: 'stay.from',
      checkOut: 'stay.to',
      updatedAt: 'offer.updatedAt'
    }));

    try {
      const result = await verifySupplierInventory({
        cwd: root,
        inputFiles: [inputFile],
        fieldMap: fieldMapFile,
        checkIn: '2026-06-06',
        checkOut: '2026-06-07',
        maxPriceAgeHours: 24,
        referenceTime: '2026-06-06T18:00:00Z'
      });
      assert.equal(result.passed, true);
      assert.equal(result.coverage.coveredCities, cityCatalog.length);
      assert.equal(result.coverage.pricedHotelCount, cityCatalog.length);
      assert.match(result.nextCommands[0], /--field-map/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when city coverage and priced evidence are incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-verify-fail-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'partial.csv');
    await writeFile(inputFile, [
      'id,name,province,city,source,price',
      'bj-1,北京无价酒店,北京,北京,部分供应商,0',
      'bad-1,未知城市酒店,,,部分供应商,288'
    ].join('\n'));

    try {
      const result = await verifySupplierInventory({ cwd: root, inputFiles: [inputFile] });
      assert.equal(result.passed, false);
      assert.equal(result.split.skippedRowCount, 1);
      assert.equal(result.coverage.coveredCities, 1);
      assert.ok(result.coverage.missingCities.some((item) => item.city === '上海'));
      assert.deepEqual(result.coverage.citiesBelowPriceMinimums.find((item) => item.city === '北京'), {
        province: '北京',
        city: '北京',
        pricedRowCount: 0,
        pricedHotelCount: 0,
        minPricedRowCount: 1,
        minPricedHotelCount: 1,
        minPrice: 0
      });
      assert.deepEqual(result.nextCommands, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

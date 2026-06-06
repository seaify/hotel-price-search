import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cityCatalog } from '../server/hotel-data.js';
import {
  buildPublishSupplierInventoryOptions,
  inspectPublishSupplierInventoryConfig
} from '../scripts/publish-supplier-inventory-from-env.js';
import {
  formatSupplierInventoryConfigText,
  writeGithubOutput
} from '../scripts/check-supplier-inventory-config.js';
import { verifySupplierInventoryFromEnv } from '../scripts/verify-supplier-inventory-from-env.js';

describe('supplier inventory env publisher config', () => {
  it('loads JSON input lists without splitting signed URL punctuation', () => {
    const options = buildPublishSupplierInventoryOptions({
      HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON: JSON.stringify([
        'https://supplier.example.com/export.csv?signature=a,b;c',
        'https://supplier.example.com/export-2.jsonl.gz?token=x;y,z'
      ]),
      HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON: '{"Authorization":"Bearer supplier-token"}',
      HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON: '{"sources":[{"url":"https://supplier.example.com/export.csv","headers":{"Authorization":"Bearer source-token"}}]}',
      HOTEL_SUPPLIER_FIELD_MAP_JSON: '{"id":"offer.id","price":"rate.sale"}',
      HOTEL_SUPPLIER_CHECK_IN: '2026-06-06',
      HOTEL_SUPPLIER_CHECK_OUT: '2026-06-07',
      HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY: '20',
      HOTEL_SUPPLIER_MIN_PRICED_HOTELS_PER_CITY: '20',
      HOTEL_SUPPLIER_MIN_TOTAL_HOTELS: '100000',
      HOTEL_SUPPLIER_MIN_TOTAL_PRICED_ROWS: '120000',
      HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS: '6'
    }, '/repo');

    assert.deepEqual(options.inputFiles, [
      'https://supplier.example.com/export.csv?signature=a,b;c',
      'https://supplier.example.com/export-2.jsonl.gz?token=x;y,z'
    ]);
    assert.equal(options.rootDir, '/repo');
    assert.equal(options.headers, '{"Authorization":"Bearer supplier-token"}');
    assert.equal(options.sourceManifest, '{"sources":[{"url":"https://supplier.example.com/export.csv","headers":{"Authorization":"Bearer source-token"}}]}');
    assert.equal(options.fieldMap, '{"id":"offer.id","price":"rate.sale"}');
    assert.equal(options.checkIn, '2026-06-06');
    assert.equal(options.checkOut, '2026-06-07');
    assert.equal(options.minHotelsPerCity, '20');
    assert.equal(options.minPricedHotelsPerCity, '20');
    assert.equal(options.minTotalHotels, '100000');
    assert.equal(options.minTotalPricedRows, '120000');
    assert.equal(options.maxPriceAgeHours, '6');
  });

  it('loads newline-separated supplier inventory inputs', () => {
    const options = buildPublishSupplierInventoryOptions({
      HOTEL_SUPPLIER_INVENTORY_INPUTS: [
        'https://supplier.example.com/north.csv.gz?signature=a,b;c',
        '',
        'https://supplier.example.com/south.jsonl'
      ].join('\n')
    }, '/repo');

    assert.deepEqual(options.inputFiles, [
      'https://supplier.example.com/north.csv.gz?signature=a,b;c',
      'https://supplier.example.com/south.jsonl'
    ]);
  });

  it('loads workflow-dispatch JSON arrays from the plain input field', () => {
    const options = buildPublishSupplierInventoryOptions({
      HOTEL_SUPPLIER_INVENTORY_INPUTS: JSON.stringify([
        'https://supplier.example.com/one.csv?signature=a,b',
        'https://supplier.example.com/two.jsonl?signature=c;d'
      ]),
      HOTEL_SUPPLIER_SOURCE_MANIFEST_URL: 'https://supplier.example.com/sources.json',
      HOTEL_SUPPLIER_FIELD_MAP_JSON: '{"price":"rate.salePrice"}'
    }, '/repo');

    assert.deepEqual(options.inputFiles, [
      'https://supplier.example.com/one.csv?signature=a,b',
      'https://supplier.example.com/two.jsonl?signature=c;d'
    ]);
    assert.equal(options.sourceManifest, 'https://supplier.example.com/sources.json');
    assert.equal(options.fieldMap, '{"price":"rate.salePrice"}');
  });

  it('lets workflow-dispatch inputs override scheduled supplier secrets', () => {
    const options = buildPublishSupplierInventoryOptions({
      HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE: [
        'https://manual.example.com/today-north.xlsx?signature=a,b;c',
        'https://manual.example.com/today-south.zip?signature=x;y,z'
      ].join('\n'),
      HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON: JSON.stringify([
        'https://secret.example.com/scheduled.csv'
      ]),
      HOTEL_SUPPLIER_SOURCE_MANIFEST_OVERRIDE: 'https://manual.example.com/sources.json?signature=manual',
      HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON: JSON.stringify({
        sources: [
          {
            name: 'scheduled-source',
            url: 'https://secret.example.com/sources.json'
          }
        ]
      })
    }, '/repo');

    assert.deepEqual(options.inputFiles, [
      'https://manual.example.com/today-north.xlsx?signature=a,b;c',
      'https://manual.example.com/today-south.zip?signature=x;y,z'
    ]);
    assert.equal(options.sourceManifest, 'https://manual.example.com/sources.json?signature=manual');
  });

  it('reports non-sensitive workflow-dispatch configuration status', () => {
    const report = inspectPublishSupplierInventoryConfig({
      HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE: [
        'https://manual.example.com/today-north.xlsx?signature=a,b;c',
        'https://manual.example.com/today-south.zip?token=secret-value'
      ].join('\n'),
      HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON: JSON.stringify([
        'https://secret.example.com/scheduled.csv'
      ]),
      HOTEL_SUPPLIER_SOURCE_MANIFEST_OVERRIDE: 'https://manual.example.com/sources.json?signature=manual',
      HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON: '{"Authorization":"Bearer supplier-token"}',
      HOTEL_SUPPLIER_FIELD_MAP_JSON: '{"price":"rate.sale"}',
      HOTEL_SUPPLIER_CHECK_IN: '2026-06-06',
      HOTEL_SUPPLIER_CHECK_OUT: '2026-06-07',
      HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY: '20',
      HOTEL_SUPPLIER_MIN_TOTAL_PRICED_ROWS: '120000',
      HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS: '6',
      HOTEL_SUPPLIER_INVENTORY_BASE_URL: 'https://cdn.example.com/hotel-price-search/'
    });
    const text = formatSupplierInventoryConfigText(report);

    assert.equal(report.configured, true);
    assert.equal(report.inputCount, 2);
    assert.equal(report.inputSource, 'workflow-dispatch');
    assert.equal(report.manifestConfigured, true);
    assert.equal(report.manifestSource, 'workflow-dispatch');
    assert.equal(report.headersConfigured, true);
    assert.equal(report.fieldMapConfigured, true);
    assert.equal(report.checkInConfigured, true);
    assert.equal(report.checkOutConfigured, true);
    assert.equal(report.minHotelsPerCity, '20');
    assert.equal(report.minTotalPricedRows, '120000');
    assert.equal(report.maxPriceAgeHours, '6');
    assert.equal(report.inventoryBaseUrlConfigured, true);
    assert.match(text, /Inventory inputs: 2 \(workflow-dispatch\)/);
    assert.doesNotMatch(text, /manual\.example\.com/);
    assert.doesNotMatch(text, /secret-value/);
    assert.doesNotMatch(text, /supplier-token/);
  });

  it('reports missing supplier configuration without throwing', () => {
    const report = inspectPublishSupplierInventoryConfig({});

    assert.equal(report.configured, false);
    assert.equal(report.inputCount, 0);
    assert.equal(report.inputSource, 'none');
    assert.equal(report.manifestConfigured, false);
    assert.equal(report.manifestSource, 'none');
    assert.match(formatSupplierInventoryConfigText(report), /Next action:/);
  });

  it('writes GitHub Actions outputs for workflow gating', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-config-output-'));
    const outputPath = join(root, 'github-output');
    try {
      await writeGithubOutput(outputPath, inspectPublishSupplierInventoryConfig({
        HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE: 'https://manual.example.com/today.xlsx'
      }));
      const output = await readFile(outputPath, 'utf8');

      assert.match(output, /^configured=true$/m);
      assert.match(output, /^input_count=1$/m);
      assert.match(output, /^input_source=workflow-dispatch$/m);
      assert.match(output, /^manifest_configured=false$/m);
      assert.match(output, /^manifest_source=none$/m);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('verifies nationwide supplier inventory from workflow environment variables without publishing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-env-verify-'));
    const inventoryPath = join(root, 'supplier.csv');
    const rows = [
      'id,name,province,city,source,price,checkIn,checkOut,updatedAt',
      ...cityCatalog.map(({ province, city }, index) => [
        `env-${index + 1}`,
        `${city}环境预检酒店`,
        province,
        city,
        '环境预检供应商',
        500 + index,
        '2026-06-01',
        '2026-12-31',
        '2026-06-06T12:00:00Z'
      ].join(','))
    ];
    await writeFile(inventoryPath, rows.join('\n'), 'utf8');

    try {
      const result = await verifySupplierInventoryFromEnv({
        HOTEL_SUPPLIER_INVENTORY_INPUTS_OVERRIDE: 'supplier.csv',
        HOTEL_SUPPLIER_CHECK_IN: '2026-06-06',
        HOTEL_SUPPLIER_CHECK_OUT: '2026-06-07',
        HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS: '24',
        HOTEL_SUPPLIER_FRESHNESS_REFERENCE_TIME: '2026-06-06T18:00:00Z'
      }, root);

      assert.equal(result.passed, true);
      assert.equal(result.split.rowCount, cityCatalog.length);
      assert.equal(result.coverage.coveredCities, cityCatalog.length);
      assert.equal(result.coverage.pricedHotelCount, cityCatalog.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires at least one configured supplier inventory input', () => {
    assert.throws(
      () => buildPublishSupplierInventoryOptions({}, '/repo'),
      /Set HOTEL_SUPPLIER_INVENTORY_INPUTS/
    );
  });

  it('allows a source manifest without standalone supplier inventory inputs', () => {
    const options = buildPublishSupplierInventoryOptions({
      HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON: JSON.stringify({
        sources: [
          {
            name: 'manifest-source',
            url: 'https://supplier.example.com/manifest-source.csv'
          }
        ]
      })
    }, '/repo');

    assert.deepEqual(options.inputFiles, []);
    assert.match(options.sourceManifest, /manifest-source/);
  });
});

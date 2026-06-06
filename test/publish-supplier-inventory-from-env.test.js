import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishSupplierInventoryOptions } from '../scripts/publish-supplier-inventory-from-env.js';

describe('supplier inventory env publisher config', () => {
  it('loads JSON input lists without splitting signed URL punctuation', () => {
    const options = buildPublishSupplierInventoryOptions({
      HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON: JSON.stringify([
        'https://supplier.example.com/export.csv?signature=a,b;c',
        'https://supplier.example.com/export-2.jsonl.gz?token=x;y,z'
      ]),
      HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON: '{"Authorization":"Bearer supplier-token"}',
      HOTEL_SUPPLIER_FIELD_MAP_JSON: '{"id":"offer.id","price":"rate.sale"}',
      HOTEL_SUPPLIER_CHECK_IN: '2026-06-06',
      HOTEL_SUPPLIER_CHECK_OUT: '2026-06-07',
      HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY: '20',
      HOTEL_SUPPLIER_MIN_PRICED_HOTELS_PER_CITY: '20',
      HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS: '6'
    }, '/repo');

    assert.deepEqual(options.inputFiles, [
      'https://supplier.example.com/export.csv?signature=a,b;c',
      'https://supplier.example.com/export-2.jsonl.gz?token=x;y,z'
    ]);
    assert.equal(options.rootDir, '/repo');
    assert.equal(options.headers, '{"Authorization":"Bearer supplier-token"}');
    assert.equal(options.fieldMap, '{"id":"offer.id","price":"rate.sale"}');
    assert.equal(options.checkIn, '2026-06-06');
    assert.equal(options.checkOut, '2026-06-07');
    assert.equal(options.minHotelsPerCity, '20');
    assert.equal(options.minPricedHotelsPerCity, '20');
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

  it('requires at least one configured supplier inventory input', () => {
    assert.throws(
      () => buildPublishSupplierInventoryOptions({}, '/repo'),
      /Set HOTEL_SUPPLIER_INVENTORY_INPUTS/
    );
  });
});

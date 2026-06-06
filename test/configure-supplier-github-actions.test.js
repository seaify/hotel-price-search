import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSupplierGitHubActionsConfigPlan,
  configureSupplierGitHubActions,
  formatSupplierGitHubActionsConfigPlan
} from '../scripts/configure-supplier-github-actions.js';

describe('supplier GitHub Actions config helper', () => {
  it('builds a masked configuration plan from supplier inputs and gates', async () => {
    const plan = await buildSupplierGitHubActionsConfigPlan({
      repo: 'seaify/hotel-price-search',
      inputFiles: [
        'https://supplier.example.com/nationwide.csv?token=secret-value',
        'https://supplier.example.com/south.xlsx?signature=a,b;c'
      ],
      headersJson: '{"Authorization":"Bearer supplier-token"}',
      fieldMapJson: '{"price":"rate.salePrice"}',
      checkIn: '2026-06-06',
      checkOut: '2026-06-07',
      minHotelsPerCity: '20',
      minTotalPricedRows: '120000',
      triggerDryRun: true,
      preview: true
    });
    const text = formatSupplierGitHubActionsConfigPlan(plan);

    assert.equal(plan.repo, 'seaify/hotel-price-search');
    assert.equal(plan.preview, true);
    assert.equal(plan.triggerDryRun, true);
    assert.deepEqual(plan.secrets.map((item) => item.name), [
      'HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON',
      'HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON',
      'HOTEL_SUPPLIER_FIELD_MAP_JSON'
    ]);
    assert.deepEqual(plan.variables.map((item) => item.name), [
      'HOTEL_SUPPLIER_CHECK_IN',
      'HOTEL_SUPPLIER_CHECK_OUT',
      'HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY',
      'HOTEL_SUPPLIER_MIN_TOTAL_PRICED_ROWS'
    ]);
    assert.match(text, /Preview mode/);
    assert.doesNotMatch(text, /secret-value/);
    assert.doesNotMatch(text, /supplier-token/);
  });

  it('reads supplier input and mapping files into GitHub config secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-supplier-gh-config-'));
    const inputsPath = join(root, 'inputs.txt');
    const fieldMapPath = join(root, 'field-map.json');
    await writeFile(inputsPath, [
      'https://supplier.example.com/nationwide.csv?token=secret-value',
      'https://supplier.example.com/nationwide-2.jsonl.gz?signature=x;y,z'
    ].join('\n'));
    await writeFile(fieldMapPath, JSON.stringify({ price: 'rate.salePrice' }));

    try {
      const calls = [];
      const plan = await configureSupplierGitHubActions({
        repo: 'seaify/hotel-price-search',
        ref: 'main',
        inputsFile: inputsPath,
        fieldMapFile: fieldMapPath,
        minPricedHotelsPerCity: '10',
        triggerDryRun: true
      }, async (args, stdin = '') => {
        calls.push({ args, stdin });
        return { stdout: '', stderr: '' };
      });

      assert.equal(plan.secrets.length, 2);
      assert.equal(plan.variables.length, 1);
      assert.equal(calls.length, 4);
      assert.deepEqual(calls[0].args, [
        'secret',
        'set',
        'HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON',
        '--repo',
        'seaify/hotel-price-search'
      ]);
      assert.match(calls[0].stdin, /nationwide\.csv/);
      assert.deepEqual(calls[1].args, [
        'secret',
        'set',
        'HOTEL_SUPPLIER_FIELD_MAP_JSON',
        '--repo',
        'seaify/hotel-price-search'
      ]);
      assert.deepEqual(calls[2], {
        args: [
          'variable',
          'set',
          'HOTEL_SUPPLIER_MIN_PRICED_HOTELS_PER_CITY',
          '--repo',
          'seaify/hotel-price-search'
        ],
        stdin: '10'
      });
      assert.deepEqual(calls[3], {
        args: [
          'workflow',
          'run',
          'publish-supplier-inventory.yml',
          '--ref',
          'main',
          '-f',
          'dry_run=true',
          '--repo',
          'seaify/hotel-price-search'
        ],
        stdin: ''
      });
      assert.ok(calls.every((call) => !call.args.join(' ').includes('secret-value')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects conflicting input sources', async () => {
    await assert.rejects(
      () => buildSupplierGitHubActionsConfigPlan({
        inputFiles: ['https://supplier.example.com/a.csv'],
        inputsJson: '["https://supplier.example.com/b.csv"]'
      }),
      /either --inputs-json or repeated --input/
    );
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditInventoryCoverage } from '../scripts/audit-inventory-coverage.js';
import { splitInventoryShards } from '../scripts/split-inventory-shards.js';

describe('inventory shard splitter', () => {
  it('splits a nationwide supplier file into city shards and rebuilds the Pages manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-shards-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'nationwide.csv');
    await writeFile(inputFile, [
      'id,masterHotelId,name,province,city,address,source,price',
      'sz-1,CN-GD-SZ-1,深圳湾拆分酒店,广东省,深圳市,深圳南山拆分路 1 号,全国供应商,588',
      'sz-2,CN-GD-SZ-2,深圳福田拆分酒店,广东省,深圳市,深圳福田拆分路 2 号,全国供应商,688',
      'gz-1,CN-GD-GZ-1,广州塔拆分酒店,广东省,广州市,广州海珠拆分路 3 号,全国供应商,788',
      'bad-1,CN-UNKNOWN-1,未知城市酒店,,,未知地址,全国供应商,188'
    ].join('\n'));

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inputFile],
        clean: true
      });

      assert.equal(result.rowCount, 4);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 1);
      assert.equal(result.manifest.sources.length, 2);

      const shenzhenSource = result.manifest.sources.find((source) => source.cities?.includes('深圳'));
      const guangzhouSource = result.manifest.sources.find((source) => source.cities?.includes('广州'));
      assert.ok(shenzhenSource);
      assert.ok(guangzhouSource);
      assert.equal(shenzhenSource.rowCount, 2);
      assert.equal(guangzhouSource.rowCount, 1);

      const shenzhenRows = (await readFile(join(root, 'public', shenzhenSource.url), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(shenzhenRows.length, 2);
      assert.equal(shenzhenRows[0].name, '深圳湾拆分酒店');

      const coverage = await auditInventoryCoverage({ rootDir: root });
      assert.equal(coverage.coveredCities, 2);
      assert.ok(coverage.missingCities.some((item) => item.city === '北京'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

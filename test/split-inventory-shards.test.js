import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { deflateRawSync, gzipSync } from 'node:zlib';
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

  it('loads a remote supplier CSV URL before writing city shards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-remote-shards-'));
    const inventoryServer = await startInventoryServer([
      'id,name,province,city,source,price',
      'bj-1,北京远程拆分酒店,北京,北京,远程供应商,588',
      'sh-1,上海远程拆分酒店,上海,上海,远程供应商,688'
    ].join('\n'));

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inventoryServer.url],
        clean: true
      });

      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 0);
      assert.equal(result.manifest.sources.length, 2);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('北京')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('上海')));
    } finally {
      await inventoryServer.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sends request headers while loading protected remote supplier inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-shards-headers-'));
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<!doctype html><title>Hotel Search</title>');
    const inventory = [
      'id,name,province,city,source,price',
      'bj-auth,北京认证酒店,北京,北京,认证供应商,488'
    ].join('\n');
    const server = await startInventoryServer(inventory, {
      requiredHeaders: {
        authorization: 'Bearer supplier-token',
        'x-api-key': 'supplier-key'
      }
    });

    try {
      await assert.rejects(
        () => splitInventoryShards({
          rootDir: root,
          inputFiles: [server.url],
          outputDir: 'public/inventory',
          clean: true
        }),
        /HTTP 401/
      );

      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [server.url],
        headers: {
          Authorization: 'Bearer supplier-token',
          'X-Api-Key': 'supplier-key'
        },
        outputDir: 'public/inventory',
        clean: true
      });

      assert.equal(result.rowCount, 1);
      assert.equal(result.shardCount, 1);
      assert.deepEqual(result.requestHeaders, {
        Authorization: '***',
        'X-Api-Key': '***'
      });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads gzip-compressed local CSV supplier files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-gzip-shards-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'nationwide.csv.gz');
    const csv = [
      'id,name,province,city,source,price',
      'hz-1,杭州压缩拆分酒店,浙江,杭州,压缩供应商,588',
      'nj-1,南京压缩拆分酒店,江苏,南京,压缩供应商,688'
    ].join('\n');
    await writeFile(inputFile, gzipSync(Buffer.from(csv, 'utf8')));

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inputFile],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('杭州')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('南京')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads local ZIP supplier archives with multiple inventory files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-zip-shards-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'nationwide.zip');
    const archive = buildZipArchive({
      'north/beijing.csv': [
        'id,name,province,city,source,price',
        'bj-zip-1,北京ZIP拆分酒店,北京,北京,ZIP供应商,588'
      ].join('\n'),
      'east/shanghai.jsonl': [
        JSON.stringify({ id: 'sh-zip-1', name: '上海ZIP拆分酒店', province: '上海', city: '上海', source: 'ZIP供应商', price: 688 })
      ].join('\n'),
      'README.txt': 'not inventory'
    });
    await writeFile(inputFile, archive);

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inputFile],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 0);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('北京')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('上海')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads local XLSX supplier workbooks before writing city shards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-xlsx-shards-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'nationwide.xlsx');
    await writeFile(inputFile, buildXlsxWorkbook([
      ['id', 'name', 'province', 'city', 'source', 'price'],
      ['bj-xlsx-1', '北京Excel拆分酒店', '北京', '北京', 'Excel供应商', '588'],
      ['sh-xlsx-1', '上海Excel拆分酒店', '上海', '上海', 'Excel供应商', '688']
    ], { worksheetTarget: '/xl/worksheets/sheet1.xml' }));

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inputFile],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 0);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('北京')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('上海')));
      assert.ok(result.manifest.sources.every((source) => source.pricedHotelCount === 1));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads remote XLSX supplier URLs by spreadsheet content type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-remote-xlsx-shards-'));
    const workbook = buildXlsxWorkbook([
      ['id', 'name', 'province', 'city', 'source', 'price'],
      ['xa-remote-xlsx-1', '西安远程Excel酒店', '陕西', '西安', '远程Excel供应商', '588'],
      ['cs-remote-xlsx-1', '长沙远程Excel酒店', '湖南', '长沙', '远程Excel供应商', '688']
    ]);
    const inventoryServer = await startInventoryServer(workbook, {
      path: '/supplier-export',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inventoryServer.url],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('西安')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('长沙')));
    } finally {
      await inventoryServer.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads XLSX supplier workbooks inside ZIP archives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-zip-xlsx-shards-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'supplier-exports.zip');
    const archive = buildZipArchive({
      'exports/nationwide.xlsx': buildXlsxWorkbook([
        ['id', 'name', 'province', 'city', 'source', 'price'],
        ['cd-xlsx-zip-1', '成都ZIP Excel酒店', '四川', '成都', 'ZIP Excel供应商', '588'],
        ['wh-xlsx-zip-1', '武汉ZIP Excel酒店', '湖北', '武汉', 'ZIP Excel供应商', '688']
      ]),
      'README.txt': 'not inventory'
    });
    await writeFile(inputFile, archive);

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inputFile],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 0);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('成都')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('武汉')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps non-standard supplier fields before writing city shards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-field-map-shards-'));
    await mkdir(join(root, 'supplier'), { recursive: true });
    const inputFile = join(root, 'supplier', 'custom.json');
    await writeFile(inputFile, JSON.stringify([
      {
        offer: { channelId: 'custom-bj-1', price: 588 },
        hotel: { title: '北京映射拆分酒店', provinceName: '北京', cityName: '北京' },
        supplier: { name: '映射供应商' }
      },
      {
        offer: { channelId: 'custom-sh-1', price: 688 },
        hotel: { title: '上海映射拆分酒店', provinceName: '上海', cityName: '上海' },
        supplier: { name: '映射供应商' }
      }
    ]));

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inputFile],
        fieldMap: {
          id: 'offer.channelId',
          name: 'hotel.title',
          province: 'hotel.provinceName',
          city: 'hotel.cityName',
          price: 'offer.price',
          providerName: 'supplier.name'
        },
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 0);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('北京')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('上海')));
      assert.ok(result.manifest.sources.every((source) => source.pricedHotelCount === 1));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads multi-source manifests with per-source headers and field maps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-source-manifest-shards-'));
    const server = await startSourceManifestServer({
      mappedJson: JSON.stringify([
        {
          offer: { id: 'manifest-bj-1', sale: 588 },
          hotel: { title: '北京清单映射酒店', provinceName: '北京', cityName: '北京' }
        }
      ]),
      standardCsv: [
        'id,name,province,city,source,price',
        'manifest-sh-1,上海清单标准酒店,上海,上海,标准清单供应商,688'
      ].join('\n')
    });

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        sourceManifest: server.manifestUrl,
        clean: true
      });

      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.equal(result.skippedRowCount, 0);
      assert.deepEqual(server.requests, {
        mappedAuthorization: 'Bearer mapped-token',
        standardApiKey: 'standard-key'
      });
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('北京')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('上海')));
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads gzip-compressed remote JSON Lines supplier URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-remote-gzip-shards-'));
    const jsonl = [
      JSON.stringify({ id: 'cd-1', name: '成都远程压缩酒店', province: '四川', city: '成都', source: '远程压缩供应商', price: 588 }),
      JSON.stringify({ id: 'wh-1', name: '武汉远程压缩酒店', province: '湖北', city: '武汉', source: '远程压缩供应商', price: 688 })
    ].join('\n');
    const inventoryServer = await startInventoryServer(gzipSync(Buffer.from(jsonl, 'utf8')), {
      path: '/supplier.jsonl.gz',
      contentType: 'application/gzip'
    });

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inventoryServer.url],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('成都')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('武汉')));
    } finally {
      await inventoryServer.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads remote ZIP supplier archives before writing city shards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hotel-remote-zip-shards-'));
    const archive = buildZipArchive({
      'guangdong/guangzhou.csv': [
        'id,name,province,city,source,price',
        'gz-zip-1,广州远程ZIP酒店,广东,广州,远程ZIP供应商,588'
      ].join('\n'),
      'zhejiang/hangzhou.json': JSON.stringify([
        { id: 'hz-zip-1', name: '杭州远程ZIP酒店', province: '浙江', city: '杭州', source: '远程ZIP供应商', price: 688 }
      ])
    });
    const inventoryServer = await startInventoryServer(archive, {
      path: '/supplier.zip',
      contentType: 'application/zip'
    });

    try {
      const result = await splitInventoryShards({
        rootDir: root,
        inputFiles: [inventoryServer.url],
        clean: true
      });
      assert.equal(result.rowCount, 2);
      assert.equal(result.shardCount, 2);
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('广州')));
      assert.ok(result.manifest.sources.some((source) => source.cities?.includes('杭州')));
    } finally {
      await inventoryServer.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function startInventoryServer(content, options = {}) {
  const routePath = options.path || '/supplier.csv';
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (requestUrl.pathname !== routePath) {
      response.writeHead(404).end();
      return;
    }
    if (!hasRequiredHeaders(request, options.requiredHeaders || {})) {
      response.writeHead(401).end('unauthorized');
      return;
    }
    response.writeHead(200, { 'content-type': options.contentType || 'text/csv; charset=utf-8' });
    response.end(content);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${routePath}?signature=a,b;c`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function startSourceManifestServer({ mappedJson, standardCsv }) {
  const requests = {};
  const server = createServer((request, response) => {
    if (request.url === '/manifest.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        sources: [
          {
            name: '映射清单供应商',
            url: '/mapped.json',
            headers: { Authorization: 'Bearer mapped-token' },
            fieldMap: {
              id: 'offer.id',
              name: 'hotel.title',
              province: 'hotel.provinceName',
              city: 'hotel.cityName',
              price: 'offer.sale'
            }
          },
          {
            name: '标准清单供应商',
            url: '/standard.csv',
            headers: { 'X-Api-Key': 'standard-key' }
          }
        ]
      }));
      return;
    }
    if (request.url === '/mapped.json') {
      requests.mappedAuthorization = request.headers.authorization;
      response.writeHead(request.headers.authorization === 'Bearer mapped-token' ? 200 : 401, { 'content-type': 'application/json; charset=utf-8' });
      response.end(mappedJson);
      return;
    }
    if (request.url === '/standard.csv') {
      requests.standardApiKey = request.headers['x-api-key'];
      response.writeHead(request.headers['x-api-key'] === 'standard-key' ? 200 : 401, { 'content-type': 'text/csv; charset=utf-8' });
      response.end(standardCsv);
      return;
    }
    response.writeHead(404).end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    manifestUrl: `http://127.0.0.1:${port}/manifest.json`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function hasRequiredHeaders(request, requiredHeaders) {
  return Object.entries(requiredHeaders).every(([name, value]) =>
    request.headers[String(name).toLowerCase()] === value
  );
}

function buildZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(entries).forEach(([name, content]) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressedBuffer = deflateRawSync(dataBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressedBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, compressedBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressedBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(0, 34);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + compressedBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildXlsxWorkbook(rows, options = {}) {
  const sharedStrings = [];
  const sharedStringIndexes = new Map();
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, columnIndex) => {
      const text = String(value ?? '');
      const sharedStringIndex = getSharedStringIndex(text, sharedStrings, sharedStringIndexes);
      return `<c r="${formatCellReference(columnIndex, rowNumber)}" t="s"><v>${sharedStringIndex}</v></c>`;
    }).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  return buildZipArchive({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
      '</Types>'
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '</Relationships>'
    ].join(''),
    'xl/workbook.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>',
      '</workbook>'
    ].join(''),
    'xl/_rels/workbook.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${escapeXml(options.worksheetTarget || 'worksheets/sheet1.xml')}"/>`,
      '</Relationships>'
    ].join(''),
    'xl/sharedStrings.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${rows.flat().length}" uniqueCount="${sharedStrings.length}">`,
      sharedStrings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join(''),
      '</sst>'
    ].join(''),
    'xl/worksheets/sheet1.xml': [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      `<sheetData>${sheetRows}</sheetData>`,
      '</worksheet>'
    ].join('')
  });
}

function getSharedStringIndex(value, sharedStrings, sharedStringIndexes) {
  if (!sharedStringIndexes.has(value)) {
    sharedStringIndexes.set(value, sharedStrings.length);
    sharedStrings.push(value);
  }
  return sharedStringIndexes.get(value);
}

function formatCellReference(columnIndex, rowNumber) {
  let index = columnIndex + 1;
  let letters = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return `${letters}${rowNumber}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

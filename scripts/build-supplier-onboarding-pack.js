import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cityCatalog } from '../server/hotel-data.js';

const defaultRootDir = fileURLToPath(new URL('..', import.meta.url));
const defaultOutputDir = 'public/supplier-onboarding';

export async function buildSupplierOnboardingPack(options = {}) {
  const rootDir = resolve(options.rootDir || defaultRootDir);
  const outputDir = resolve(rootDir, options.outputDir || defaultOutputDir);
  if (options.clean !== false) await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const files = {
    'index.html': buildIndexHtml(),
    'README.md': buildReadme(),
    'city-catalog.csv': buildCityCatalogCsv(),
    'required-fields.md': buildRequiredFields(),
    'supplier-field-map.template.json': `${JSON.stringify(buildFieldMapTemplate(), null, 2)}\n`,
    'sample-valid-inventory.csv': buildSampleInventoryCsv()
  };

  files['supplier-inventory.template.csv'] = await readTemplate(rootDir, 'data/supplier-inventory.template.csv');
  files['supplier-source-manifest.template.json'] = await readTemplate(rootDir, 'data/supplier-source-manifest.template.json');

  for (const [name, content] of Object.entries(files)) {
    await writeFile(resolve(outputDir, name), content, 'utf8');
  }

  return {
    outputDir,
    fileCount: Object.keys(files).length,
    cityCount: cityCatalog.length,
    files: Object.keys(files)
  };
}

async function readTemplate(rootDir, path) {
  try {
    return await readFile(resolve(rootDir, path), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (path.endsWith('.csv')) {
      return 'id,masterHotelId,name,province,city,district,address,star,rating,reviews,price,totalPrice,currency,source,checkIn,checkOut,available,updatedAt,bookingUrl\n';
    }
    return `${JSON.stringify({ sources: [{ name: 'supplier-nationwide', url: 'https://supplier.example.com/exports/nationwide-hotels.jsonl.gz' }] }, null, 2)}\n`;
  }
}

function buildIndexHtml() {
  const links = [
    ['README.md', '交付说明'],
    ['supplier-inventory.template.csv', '标准 CSV 模板'],
    ['supplier-source-manifest.template.json', '多源清单模板'],
    ['supplier-field-map.template.json', '字段映射模板'],
    ['city-catalog.csv', '全国城市目录'],
    ['required-fields.md', '字段要求'],
    ['sample-valid-inventory.csv', '示例库存 CSV']
  ];
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>酒店价格供应商交付包</title>',
    '  <style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:880px;margin:40px auto;padding:0 20px;line-height:1.7;color:#17202a}h1{font-size:28px}a{color:#0f766e}li{margin:8px 0}.note{padding:14px 16px;background:#f7f9f8;border:1px solid #dce7e2;border-radius:8px}</style>',
    '</head>',
    '<body>',
    '  <h1>酒店价格供应商交付包</h1>',
    `  <p class="note">请按模板交付 CSV/JSON/JSONL/XLSX/ZIP 数据。正式发布需要覆盖全国城市目录中的 ${cityCatalog.length} 个城市，并提供可解析正价和价格更新时间证据。</p>`,
    '  <ul>',
    ...links.map(([href, label]) => `    <li><a href="${href}" download>${label}</a></li>`),
    '  </ul>',
    '  <p>数据准备好后，先在 GitHub Actions 的 Publish supplier inventory 里勾选 dry_run 预检；通过后再取消 dry_run 正式发布。</p>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

function buildReadme() {
  return [
    '# 酒店价格供应商交付包',
    '',
    '这个目录用于把全国酒店价格数据交给 hotel-price-search 发布流程。请供应商或渠道系统按这里的模板导出 CSV/JSON/JSONL/XLSX/ZIP 文件。',
    '',
    '## 交付物',
    '',
    '- `supplier-inventory.template.csv`: 标准 CSV 表头模板。',
    '- `supplier-source-manifest.template.json`: 多供应商或多分片 URL 清单模板。',
    '- `supplier-field-map.template.json`: 非标准字段映射模板。',
    '- `city-catalog.csv`: 发布验收使用的全国城市目录。',
    '- `sample-valid-inventory.csv`: 可通过格式解析的少量示例行，不代表真实库存。',
    '- `required-fields.md`: 字段说明和发布验收要求。',
    '',
    '## 验收规则',
    '',
    `发布全国真实价格时，至少需要覆盖 city-catalog.csv 中的 ${cityCatalog.length} 个城市。`,
    '每个城市至少要有 1 家可识别酒店、1 条可解析正价报价；生产发布建议提高到每城 20 家以上，并要求 `updatedAt` 足够新。',
    '',
    '## 预检命令',
    '',
    '```bash',
    'npm run verify:supplier-inventory -- --input /absolute/path/supplier-nationwide.csv',
    'npm run verify:supplier-inventory -- --input /absolute/path/supplier-nationwide.csv --check-in 2026-06-06 --check-out 2026-06-07 --min-hotels-per-city 20 --min-priced-hotels-per-city 20 --max-price-age-hours 6 --reference-time 2026-06-06T12:00:00Z',
    '```',
    '',
    'GitHub Actions 里先运行 `Publish supplier inventory` 并勾选 `dry_run`；预检通过后再取消 `dry_run` 正式发布到 GitHub Pages。',
    ''
  ].join('\n');
}

function buildRequiredFields() {
  return [
    '# 字段要求',
    '',
    '| 字段 | 必填 | 说明 | 示例 |',
    '| --- | --- | --- | --- |',
    '| `id` | 是 | 供应商报价或酒店在该源内的唯一 ID | `ctrip-10001` |',
    '| `masterHotelId` | 建议 | 跨渠道合并同一家酒店的标准 ID | `CN-BJ-000001` |',
    '| `name` | 是 | 酒店名称 | `北京国贸供应商酒店` |',
    '| `province` | 是 | 省级行政区，建议不带“省/市/自治区”后缀也可 | `北京` |',
    '| `city` | 是 | 城市或地区名，需要能匹配 `city-catalog.csv` | `北京` |',
    '| `district` | 否 | 区县或商圈 | `朝阳` |',
    '| `address` | 否 | 酒店地址 | `北京市朝阳区示例路 1 号` |',
    '| `star` | 否 | 星级，数字 1-5 | `5` |',
    '| `rating` | 否 | 评分 | `4.8` |',
    '| `reviews` | 否 | 点评数 | `1200` |',
    '| `price` | 是 | 当前可售最低价，必须是大于 0 的数字 | `688` |',
    '| `totalPrice` | 否 | 入住周期总价；缺省时按 `price * nights` 计算 | `1376` |',
    '| `currency` | 否 | 币种，默认 CNY | `CNY` |',
    '| `source` | 是 | 供应商或渠道名 | `直接签约供应商` |',
    '| `checkIn` | 建议 | 报价可覆盖入住开始日期 | `2026-06-06` |',
    '| `checkOut` | 建议 | 报价可覆盖离店日期 | `2026-06-07` |',
    '| `available` | 建议 | 是否可售，`true/false` | `true` |',
    '| `updatedAt` | 建议 | 价格更新时间，用于新鲜度验收 | `2026-06-06T12:00:00Z` |',
    '| `bookingUrl` | 否 | 跳转预订 URL | `https://supplier.example.com/hotel/10001` |',
    '',
    '如果供应商字段名不同，使用 `supplier-field-map.template.json` 配置映射。'
  ].join('\n');
}

function buildFieldMapTemplate() {
  return {
    description: 'Map internal hotel-price-search fields to supplier export field names or JSON paths.',
    standardFields: [
      'id',
      'masterHotelId',
      'name',
      'province',
      'city',
      'district',
      'address',
      'star',
      'rating',
      'reviews',
      'price',
      'totalPrice',
      'currency',
      'source',
      'checkIn',
      'checkOut',
      'available',
      'updatedAt',
      'bookingUrl'
    ],
    jsonFieldMapExample: {
      id: 'offer.id',
      masterHotelId: 'hotel.standardId',
      name: 'hotel.name',
      province: 'hotel.provinceName',
      city: 'hotel.cityName',
      district: 'hotel.districtName',
      address: 'hotel.address',
      star: 'hotel.star',
      rating: 'hotel.rating',
      reviews: 'hotel.reviewCount',
      price: 'rate.salePrice',
      totalPrice: 'rate.totalPrice',
      currency: 'rate.currency',
      source: 'supplier.name',
      checkIn: 'stay.checkIn',
      checkOut: 'stay.checkOut',
      available: 'rate.available',
      updatedAt: 'rate.updatedAt',
      bookingUrl: 'rate.bookingUrl'
    },
    chineseCsvFieldMapExample: {
      id: '报价ID',
      masterHotelId: '标准酒店ID',
      name: '酒店名称',
      province: '省份',
      city: '城市',
      district: '区县',
      address: '地址',
      star: '星级',
      rating: '评分',
      reviews: '点评数',
      price: '最低价',
      totalPrice: '总价',
      currency: '币种',
      source: '供应商',
      checkIn: '入住日期',
      checkOut: '离店日期',
      available: '是否可售',
      updatedAt: '更新时间',
      bookingUrl: '预订链接'
    }
  };
}

function buildCityCatalogCsv() {
  return [
    ['province', 'city', 'code', 'tier'].map(csvCell).join(','),
    ...cityCatalog.map((item) => [
      item.province,
      item.city,
      item.code,
      item.tier
    ].map(csvCell).join(','))
  ].join('\n') + '\n';
}

function buildSampleInventoryCsv() {
  const rows = [
    ['id', 'masterHotelId', 'name', 'province', 'city', 'district', 'address', 'star', 'rating', 'reviews', 'price', 'totalPrice', 'currency', 'source', 'checkIn', 'checkOut', 'available', 'updatedAt', 'bookingUrl'],
    ['sample-bj-001', 'CN-BJ-SAMPLE-001', '北京供应商示例酒店', '北京', '北京', '朝阳', '北京市朝阳区示例路 1 号', '5', '4.8', '1200', '688', '688', 'CNY', '供应商示例', '2026-06-06', '2026-06-07', 'true', '2026-06-06T12:00:00Z', 'https://supplier.example.com/hotels/sample-bj-001'],
    ['sample-sh-001', 'CN-SH-SAMPLE-001', '上海供应商示例酒店', '上海', '上海', '浦东', '上海市浦东新区示例路 1 号', '5', '4.7', '980', '728', '728', 'CNY', '供应商示例', '2026-06-06', '2026-06-07', 'true', '2026-06-06T12:00:00Z', 'https://supplier.example.com/hotels/sample-sh-001'],
    ['sample-sz-001', 'CN-SZ-SAMPLE-001', '深圳供应商示例酒店', '广东', '深圳', '南山', '深圳市南山区示例路 1 号', '4', '4.6', '860', '588', '588', 'CNY', '供应商示例', '2026-06-06', '2026-06-07', 'true', '2026-06-06T12:00:00Z', 'https://supplier.example.com/hotels/sample-sz-001']
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') options.outputDir = argv[++index];
    else if (arg === '--no-clean') options.clean = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/build-supplier-onboarding-pack.js [options]

Options:
  --output <dir>  Output directory. Default: public/supplier-onboarding
  --no-clean      Keep existing files in the output directory
  --json          Print JSON result
  --help          Show this help text
`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await buildSupplierOnboardingPack(options);
      console.log(options.json ? JSON.stringify(result, null, 2) : `Built supplier onboarding pack in ${result.outputDir} (${result.fileCount} files, ${result.cityCount} cities).`);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

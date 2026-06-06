import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectPublishSupplierInventoryConfig } from './publish-supplier-inventory-from-env.js';

export function formatSupplierInventoryConfigText(report) {
  const lines = [
    `Supplier inventory configured: ${formatYesNo(report.configured)}`,
    `Inventory inputs: ${report.inputCount} (${report.inputSource})`,
    `Source manifest: ${formatYesNo(report.manifestConfigured)} (${report.manifestSource})`,
    `Request headers configured: ${formatYesNo(report.headersConfigured)}`,
    `Field map configured: ${formatYesNo(report.fieldMapConfigured)}`,
    `Stay check-in configured: ${formatYesNo(report.checkInConfigured)}`,
    `Stay check-out configured: ${formatYesNo(report.checkOutConfigured)}`,
    `Minimum hotels per city: ${formatValue(report.minHotelsPerCity, '1')}`,
    `Minimum rows per city: ${formatValue(report.minRowsPerCity, '1')}`,
    `Minimum priced hotels per city: ${formatValue(report.minPricedHotelsPerCity, '1')}`,
    `Minimum priced rows per city: ${formatValue(report.minPricedRowsPerCity, '1')}`,
    `Minimum total hotels: ${formatValue(report.minTotalHotels, 'not set')}`,
    `Minimum total rows: ${formatValue(report.minTotalRows, 'not set')}`,
    `Minimum total priced hotels: ${formatValue(report.minTotalPricedHotels, 'not set')}`,
    `Minimum total priced rows: ${formatValue(report.minTotalPricedRows, 'not set')}`,
    `Maximum price age hours: ${formatValue(report.maxPriceAgeHours, 'not set')}`,
    `Freshness reference time configured: ${formatYesNo(report.freshnessReferenceTimeConfigured)}`,
    `Inventory base URL configured: ${formatYesNo(report.inventoryBaseUrlConfigured)}`
  ];

  if (!report.configured) {
    lines.push('Next action: set supplier_inventory_inputs or supplier_source_manifest_url when running the GitHub Actions workflow, or configure the corresponding repository secrets for scheduled publishing.');
  }

  return lines.join('\n');
}

export function formatSupplierInventoryConfigMarkdown(report) {
  const rows = [
    ['Configured', formatYesNo(report.configured)],
    ['Inventory input count', String(report.inputCount)],
    ['Inventory input source', report.inputSource],
    ['Source manifest', formatYesNo(report.manifestConfigured)],
    ['Source manifest source', report.manifestSource],
    ['Request headers', formatYesNo(report.headersConfigured)],
    ['Field map', formatYesNo(report.fieldMapConfigured)],
    ['Stay check-in', formatYesNo(report.checkInConfigured)],
    ['Stay check-out', formatYesNo(report.checkOutConfigured)],
    ['Minimum hotels per city', formatValue(report.minHotelsPerCity, '1')],
    ['Minimum rows per city', formatValue(report.minRowsPerCity, '1')],
    ['Minimum priced hotels per city', formatValue(report.minPricedHotelsPerCity, '1')],
    ['Minimum priced rows per city', formatValue(report.minPricedRowsPerCity, '1')],
    ['Minimum total hotels', formatValue(report.minTotalHotels, 'not set')],
    ['Minimum total rows', formatValue(report.minTotalRows, 'not set')],
    ['Minimum total priced hotels', formatValue(report.minTotalPricedHotels, 'not set')],
    ['Minimum total priced rows', formatValue(report.minTotalPricedRows, 'not set')],
    ['Maximum price age hours', formatValue(report.maxPriceAgeHours, 'not set')],
    ['Freshness reference time', formatYesNo(report.freshnessReferenceTimeConfigured)],
    ['Inventory base URL', formatYesNo(report.inventoryBaseUrlConfigured)]
  ];

  const lines = [
    '## Supplier inventory configuration',
    '',
    '| Check | Value |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${escapeMarkdownTable(label)} | ${escapeMarkdownTable(value)} |`)
  ];

  if (!report.configured) {
    lines.push(
      '',
      'No supplier inventory source is configured yet. Set `supplier_inventory_inputs` or `supplier_source_manifest_url` when manually running this workflow, or configure repository secrets for scheduled publishing.'
    );
  }

  return `${lines.join('\n')}\n`;
}

export async function writeGithubOutput(path, report) {
  const output = [
    `configured=${report.configured ? 'true' : 'false'}`,
    `input_count=${report.inputCount}`,
    `input_source=${report.inputSource}`,
    `manifest_configured=${report.manifestConfigured ? 'true' : 'false'}`,
    `manifest_source=${report.manifestSource}`,
    ''
  ].join('\n');
  await appendFile(path, output);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--github-output') options.githubOutput = argv[++index];
    else if (arg === '--github-summary') options.githubSummary = argv[++index];
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-supplier-inventory-config.js [options]

Options:
  --json                   Print non-sensitive configuration JSON
  --github-output <file>   Append configured=true/false and source metadata for GitHub Actions
  --github-summary <file>  Append a Markdown summary for GitHub Actions
  --help                   Show this help text
`);
}

function formatValue(value, fallback) {
  return String(value || '').trim() || fallback;
}

function formatYesNo(value) {
  return value ? 'yes' : 'no';
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const report = inspectPublishSupplierInventoryConfig();
      console.log(options.json ? JSON.stringify(report, null, 2) : formatSupplierInventoryConfigText(report));
      if (options.githubOutput) await writeGithubOutput(options.githubOutput, report);
      if (options.githubSummary) await appendFile(options.githubSummary, formatSupplierInventoryConfigMarkdown(report));
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

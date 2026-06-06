import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workflowName = 'publish-supplier-inventory.yml';
const secretOptionMap = [
  ['inputsJson', 'HOTEL_SUPPLIER_INVENTORY_INPUTS_JSON'],
  ['headersJson', 'HOTEL_SUPPLIER_INVENTORY_HEADERS_JSON'],
  ['sourceManifestJson', 'HOTEL_SUPPLIER_SOURCE_MANIFEST_JSON'],
  ['sourceManifestUrl', 'HOTEL_SUPPLIER_SOURCE_MANIFEST_URL'],
  ['fieldMapJson', 'HOTEL_SUPPLIER_FIELD_MAP_JSON']
];
const variableOptionMap = [
  ['checkIn', 'HOTEL_SUPPLIER_CHECK_IN'],
  ['checkOut', 'HOTEL_SUPPLIER_CHECK_OUT'],
  ['minHotelsPerCity', 'HOTEL_SUPPLIER_MIN_HOTELS_PER_CITY'],
  ['minRowsPerCity', 'HOTEL_SUPPLIER_MIN_ROWS_PER_CITY'],
  ['minPricedHotelsPerCity', 'HOTEL_SUPPLIER_MIN_PRICED_HOTELS_PER_CITY'],
  ['minPricedRowsPerCity', 'HOTEL_SUPPLIER_MIN_PRICED_ROWS_PER_CITY'],
  ['minTotalHotels', 'HOTEL_SUPPLIER_MIN_TOTAL_HOTELS'],
  ['minTotalRows', 'HOTEL_SUPPLIER_MIN_TOTAL_ROWS'],
  ['minTotalPricedHotels', 'HOTEL_SUPPLIER_MIN_TOTAL_PRICED_HOTELS'],
  ['minTotalPricedRows', 'HOTEL_SUPPLIER_MIN_TOTAL_PRICED_ROWS'],
  ['maxPriceAgeHours', 'HOTEL_SUPPLIER_MAX_PRICE_AGE_HOURS'],
  ['freshnessReferenceTime', 'HOTEL_SUPPLIER_FRESHNESS_REFERENCE_TIME'],
  ['inventoryBaseUrl', 'HOTEL_SUPPLIER_INVENTORY_BASE_URL']
];

export async function buildSupplierGitHubActionsConfigPlan(options = {}) {
  const normalized = await normalizeOptions(options);
  const secrets = secretOptionMap
    .map(([key, name]) => ({ name, value: normalized[key] }))
    .filter((item) => hasValue(item.value));
  const variables = variableOptionMap
    .map(([key, name]) => ({ name, value: normalized[key] }))
    .filter((item) => hasValue(item.value));
  if (!secrets.length && !variables.length && !normalized.triggerDryRun) {
    throw new Error('No supplier GitHub Actions configuration was provided.');
  }
  return {
    repo: normalized.repo || '',
    ref: normalized.ref || 'main',
    preview: Boolean(normalized.preview),
    triggerDryRun: Boolean(normalized.triggerDryRun),
    secrets,
    variables
  };
}

export async function configureSupplierGitHubActions(options = {}, runner = runGh) {
  const plan = await buildSupplierGitHubActionsConfigPlan(options);
  if (!plan.preview) {
    for (const secret of plan.secrets) {
      await runner(buildGhArgs(['secret', 'set', secret.name], plan.repo), secret.value);
    }
    for (const variable of plan.variables) {
      await runner(buildGhArgs(['variable', 'set', variable.name], plan.repo), variable.value);
    }
    if (plan.triggerDryRun) {
      await runner(buildGhArgs([
        'workflow',
        'run',
        workflowName,
        '--ref',
        plan.ref,
        '-f',
        'dry_run=true'
      ], plan.repo));
    }
  }
  return plan;
}

export function formatSupplierGitHubActionsConfigPlan(plan) {
  const lines = [
    `Repository: ${plan.repo || '(current repository)'}`,
    `Secrets to set: ${plan.secrets.length ? plan.secrets.map((item) => item.name).join(', ') : 'none'}`,
    `Variables to set: ${plan.variables.length ? plan.variables.map((item) => item.name).join(', ') : 'none'}`,
    `Trigger dry-run workflow: ${plan.triggerDryRun ? 'yes' : 'no'}`
  ];
  if (plan.preview) lines.unshift('Preview mode: no GitHub settings were changed.');
  return lines.join('\n');
}

async function normalizeOptions(options) {
  const normalized = { ...options };
  normalized.inputFiles = (options.inputFiles || []).map(String).map((item) => item.trim()).filter(Boolean);
  if (hasValue(options.inputsJson) && normalized.inputFiles.length) {
    throw new Error('Use either --inputs-json or repeated --input, not both.');
  }
  if (hasValue(options.inputsFile)) {
    const text = await readFile(resolve(options.inputsFile), 'utf8');
    if (text.trim().startsWith('[')) normalized.inputsJson = validateJsonArray(text, 'supplier inventory inputs');
    else normalized.inputsJson = JSON.stringify(text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
  } else if (hasValue(options.inputsJson)) {
    normalized.inputsJson = validateJsonArray(options.inputsJson, 'supplier inventory inputs');
  } else if (normalized.inputFiles.length) {
    normalized.inputsJson = JSON.stringify(normalized.inputFiles);
  }

  normalized.headersJson = await normalizeJsonOption(options.headersJson, options.headersFile, 'request headers', false);
  normalized.sourceManifestJson = await normalizeJsonOption(options.sourceManifestJson, options.sourceManifestFile, 'supplier source manifest', true);
  normalized.fieldMapJson = await normalizeJsonOption(options.fieldMapJson, options.fieldMapFile, 'field map', false);
  return normalized;
}

async function normalizeJsonOption(jsonValue, filePath, label, allowArray = false) {
  if (hasValue(jsonValue) && hasValue(filePath)) throw new Error(`Use either inline ${label} JSON or a ${label} file, not both.`);
  if (hasValue(filePath)) return validateJsonValue(await readFile(resolve(filePath), 'utf8'), label, allowArray);
  if (hasValue(jsonValue)) return validateJsonValue(jsonValue, label, allowArray);
  return '';
}

function validateJsonArray(value, label) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return JSON.stringify(parsed);
}

function validateJsonValue(value, label, allowArray = false) {
  const parsed = JSON.parse(value);
  if (!parsed || (typeof parsed !== 'object') || (!allowArray && Array.isArray(parsed))) {
    throw new Error(`${label} must be a JSON object${allowArray ? ' or array' : ''}.`);
  }
  return JSON.stringify(parsed);
}

function buildGhArgs(args, repo) {
  return repo ? [...args, '--repo', repo] : args;
}

function runGh(args, stdin = '') {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `gh exited with code ${code}`));
      }
    });
    if (stdin) child.stdin.end(`${stdin}\n`);
    else child.stdin.end();
  });
}

function hasValue(value) {
  return String(value ?? '').trim() !== '';
}

function parseArgs(argv) {
  const options = { inputFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') options.repo = argv[++index];
    else if (arg === '--ref') options.ref = argv[++index];
    else if (arg === '--input') options.inputFiles.push(argv[++index]);
    else if (arg === '--inputs-json') options.inputsJson = argv[++index];
    else if (arg === '--inputs-file') options.inputsFile = argv[++index];
    else if (arg === '--headers-json') options.headersJson = argv[++index];
    else if (arg === '--headers-file') options.headersFile = argv[++index];
    else if (arg === '--source-manifest-json') options.sourceManifestJson = argv[++index];
    else if (arg === '--source-manifest-file') options.sourceManifestFile = argv[++index];
    else if (arg === '--source-manifest-url') options.sourceManifestUrl = argv[++index];
    else if (arg === '--field-map-json') options.fieldMapJson = argv[++index];
    else if (arg === '--field-map-file') options.fieldMapFile = argv[++index];
    else if (arg === '--check-in') options.checkIn = argv[++index];
    else if (arg === '--check-out') options.checkOut = argv[++index];
    else if (arg === '--min-hotels-per-city') options.minHotelsPerCity = argv[++index];
    else if (arg === '--min-rows-per-city') options.minRowsPerCity = argv[++index];
    else if (arg === '--min-priced-hotels-per-city') options.minPricedHotelsPerCity = argv[++index];
    else if (arg === '--min-priced-rows-per-city') options.minPricedRowsPerCity = argv[++index];
    else if (arg === '--min-total-hotels') options.minTotalHotels = argv[++index];
    else if (arg === '--min-total-rows') options.minTotalRows = argv[++index];
    else if (arg === '--min-total-priced-hotels') options.minTotalPricedHotels = argv[++index];
    else if (arg === '--min-total-priced-rows') options.minTotalPricedRows = argv[++index];
    else if (arg === '--max-price-age-hours') options.maxPriceAgeHours = argv[++index];
    else if (arg === '--freshness-reference-time') options.freshnessReferenceTime = argv[++index];
    else if (arg === '--inventory-base-url') options.inventoryBaseUrl = argv[++index];
    else if (arg === '--trigger-dry-run') options.triggerDryRun = true;
    else if (arg === '--preview') options.preview = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/configure-supplier-github-actions.js [options]

Sets GitHub Actions secrets and variables used by Publish supplier inventory.
Secret values are sent to gh through stdin and are not printed.

Options:
  --repo owner/name                       Repository. Defaults to the current gh repository context
  --ref branch                            Workflow ref for --trigger-dry-run. Default: main
  --input <url-or-path>                   Supplier export input. Can be repeated
  --inputs-json <json-array>              Supplier export inputs JSON array
  --inputs-file <file>                    Newline list or JSON array of supplier inputs
  --headers-json <json>                   Protected supplier request headers
  --headers-file <file>                   Headers JSON file
  --source-manifest-url <url>             Supplier source manifest URL
  --source-manifest-json <json>           Supplier source manifest JSON
  --source-manifest-file <file>           Supplier source manifest JSON file
  --field-map-json <json>                 Field map JSON
  --field-map-file <file>                 Field map JSON file
  --check-in DATE                         Coverage gate check-in date
  --check-out DATE                        Coverage gate check-out date
  --min-hotels-per-city N                 Minimum hotels per city
  --min-rows-per-city N                   Minimum rows per city
  --min-priced-hotels-per-city N          Minimum priced hotels per city
  --min-priced-rows-per-city N            Minimum priced rows per city
  --min-total-hotels N                    Minimum nationwide hotels
  --min-total-rows N                      Minimum nationwide rows
  --min-total-priced-hotels N             Minimum nationwide priced hotels
  --min-total-priced-rows N               Minimum nationwide priced rows
  --max-price-age-hours N                 Maximum price age in hours
  --freshness-reference-time TIMESTAMP    Reference timestamp for freshness
  --inventory-base-url URL                Absolute inventory shard base URL
  --trigger-dry-run                       Trigger Publish supplier inventory with dry_run=true
  --preview                               Show what would be set without changing GitHub
  --json                                  Print JSON plan
  --help                                  Show this help text
`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const plan = await configureSupplierGitHubActions(options);
      console.log(options.json ? JSON.stringify({
        ...plan,
        secrets: plan.secrets.map((item) => ({ name: item.name, value: '***' })),
        variables: plan.variables.map((item) => ({ name: item.name, value: item.value }))
      }, null, 2) : formatSupplierGitHubActionsConfigPlan(plan));
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

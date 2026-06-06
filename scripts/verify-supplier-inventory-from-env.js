import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPublishSupplierInventoryOptions } from './publish-supplier-inventory-from-env.js';
import {
  formatSupplierInventoryVerificationText,
  verifySupplierInventory
} from './verify-supplier-inventory.js';

export async function verifySupplierInventoryFromEnv(env = process.env, cwd = process.cwd()) {
  return verifySupplierInventory(buildPublishSupplierInventoryOptions(env, cwd));
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-supplier-inventory-from-env.js [options]

Reads the same HOTEL_SUPPLIER_* environment variables as publish:supplier-inventory:env,
then verifies supplier inventory coverage without writing public inventory shards.

Options:
  --json   Print full JSON verification result
  --help   Show this help text
`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await verifySupplierInventoryFromEnv();
      console.log(options.json ? JSON.stringify(result, null, 2) : formatSupplierInventoryVerificationText(result));
      if (!result.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { repairHttpMethodsLive } from './repair-transactional-make-m10.mjs';

const CONFIRMATION = 'APPLY_TARGET35_HTTP_METHOD_REPAIR_ONCE';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const apply = args[0] === '--apply';
  const confirmation = apply ? args[1] : '';
  if ((!apply && args.length !== 0) || (apply && args.length !== 2)) {
    process.stderr.write('HTTP_METHOD_REPAIR_FAIL:usage_invalid');
    process.exitCode = 2;
  } else if (apply && confirmation !== CONFIRMATION) {
    process.stderr.write('HTTP_METHOD_REPAIR_FAIL:apply_confirmation_required');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(JSON.stringify(await repairHttpMethodsLive({ apply, confirmation })));
    } catch (error) {
      process.stderr.write(`HTTP_METHOD_REPAIR_FAIL:${error instanceof Error ? error.message : 'unknown'}`);
      process.exitCode = 1;
    }
  }
}

import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('remote environment transaction: fresh shell, safe overrides, task guard, process verification and rollback', async () => {
  await promisify(execFile)('python3', ['tests/environment_script_test.py']);
});

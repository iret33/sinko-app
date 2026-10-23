// npm run sync-contract: copies Sinko's two contract fixtures into test/fixtures and records where they came from.
//
//   tests/fixtures/state-cases.json         the shared state (parseState / editState), run against both of Sinko's parsers
//   tests/fixtures/learned-rule-cases.json  what the box learned (learnedRules)
//
// Sinko is read from ../sinko (or SINKO_DIR) and never written to. test/fixtures/sinko-contract.json records Sinko's VERSION, the git commit
// and a SHA-256 of each file, so the tests can tell when a fixture was edited by hand instead of synced.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sinko = resolve(root, process.env.SINKO_DIR || '../sinko');
const FILES = ['state-cases.json', 'learned-rule-cases.json'];

if (!existsSync(join(sinko, 'tests', 'fixtures'))) {
  console.error(`Sinko is not at ${sinko}. Clone https://github.com/iret33/sinko there (or set SINKO_DIR).`);
  process.exit(1);
}

function git(...args: string[]): string {
  try { return execFileSync('git', ['-C', sinko, ...args], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

const out = join(root, 'test', 'fixtures');
mkdirSync(out, { recursive: true });
const files: Record<string, string> = {};
for (const name of FILES) {
  const from = join(sinko, 'tests', 'fixtures', name);
  JSON.parse(readFileSync(from, 'utf8'));                       // refuse to copy something that is not JSON
  copyFileSync(from, join(out, name));
  files[name] = createHash('sha256').update(readFileSync(from)).digest('hex');
}
const record = {
  sinkoVersion: readFileSync(join(sinko, 'VERSION'), 'utf8').trim(),
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--', 'tests/fixtures') !== '',
  files,
};
writeFileSync(join(out, 'sinko-contract.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`Copied ${FILES.join(', ')} from Sinko ${record.sinkoVersion} (${record.commit.slice(0, 8) || 'no git'}).`);

// npm run sync-strings: copies the parent page's words (English and Arabic) from Sinko into src/i18n/sinko-strings.json.
//
// Sinko keeps them as object literals: STR, LIVE_STR and FIRST_STR in web/app.js, BOX_STR in web/pb-box.js. The page merges them in that
// order (app.js lines 283-332), and so does this. The literals are read with TypeScript's parser and converted value by value; nothing in
// Sinko is run. Anything that is not a plain string, number, array or object stops the copy.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

type Value = string | number | boolean | Value[] | { [k: string]: Value };
type Table = { en: Record<string, Value>; ar: Record<string, Value> };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sinko = resolve(root, process.env.SINKO_DIR || '../sinko');
if (!existsSync(join(sinko, 'web', 'app.js'))) {
  console.error(`Sinko is not at ${sinko}. Clone https://github.com/iret33/sinko there (or set SINKO_DIR).`);
  process.exit(1);
}

function literal(node: ts.Node, where: string): Value {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((e, i) => literal(e, where + '[' + i + ']'));
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, Value> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) throw new Error(where + ': not a plain property');
      out[p.name.text] = literal(p.initializer, where + '.' + p.name.text);
    }
    return out;
  }
  throw new Error(where + ': not a plain value (' + ts.SyntaxKind[node.kind] + ')');
}

function tables(file: string, names: string[]): Record<string, Table> {
  const text = readFileSync(join(sinko, 'web', file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2015, true, ts.ScriptKind.JS);
  const found: Record<string, Table> = {};
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer) {
      found[node.name.text] = literal(node.initializer, node.name.text) as unknown as Table;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const n of names) if (!found[n]) throw new Error(`${n} not found in web/${file}`);
  return found;
}

const page = tables('app.js', ['STR', 'LIVE_STR', 'FIRST_STR']);
const box = tables('pb-box.js', ['BOX_STR']);
const merged: Table = { en: {}, ar: {} };
for (const t of [page.STR, page.LIVE_STR, page.FIRST_STR, box.BOX_STR]) {
  for (const lang of ['en', 'ar'] as const) Object.assign(merged[lang], t[lang]);
}
let commit = '';
try { commit = execFileSync('git', ['-C', sinko, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const out = {
  comment: 'Copied from Sinko by npm run sync-strings (web/app.js STR, LIVE_STR, FIRST_STR; web/pb-box.js BOX_STR). Do not edit: change Sinko, then sync.',
  sinkoVersion: readFileSync(join(sinko, 'VERSION'), 'utf8').trim(),
  commit,
  en: merged.en,
  ar: merged.ar,
};
writeFileSync(join(root, 'src', 'i18n', 'sinko-strings.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`Copied ${Object.keys(merged.en).length} English and ${Object.keys(merged.ar).length} Arabic strings from Sinko ${out.sinkoVersion}.`);

// Bundles each Lambda into dist/<name>/index.js, which the CDK stack uploads as-is.
// One file per function, dependencies included, so what runs is what was tested.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functions = ['screening', 'notifier', 'digest', 'probe'];

rmSync(path.join(root, 'dist'), { recursive: true, force: true });

for (const name of functions) {
  const result = await build({
    entryPoints: [path.join(root, 'src', name, 'index.ts')],
    outfile: path.join(root, 'dist', name, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    metafile: true,
  });
  const bytes = Object.values(result.metafile.outputs).reduce(
    (total, out) => (out.entryPoint ? total + out.bytes : total),
    0,
  );
  console.log(`${name.padEnd(10)} ${(bytes / 1024).toFixed(0)} KB`);
}

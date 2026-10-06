// Runs the real screening analyser against real Bedrock from your machine, with no AWS deployment.
//
//   npm run screen:local                       scores the sample resumes in fixtures/resumes
//   npm run screen:local -- path/to/resume.pdf scores one file
//
// Needs AWS credentials that can call Bedrock in ap-south-1 (for example after `aws login`).
// Each call costs a fraction of a cent.
import { build } from 'esbuild';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundle = path.join(tmpdir(), `hireflow-analysis-${process.pid}.cjs`);
await build({
  entryPoints: [path.join(root, 'src/screening/analysis.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error',
});
const { BedrockAnalyser } = require(bundle);
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');

const region = process.env.AWS_REGION ?? 'ap-south-1';
const modelId = process.env.BEDROCK_MODEL_ID ?? 'apac.amazon.nova-lite-v1:0';
const analyser = new BedrockAnalyser(new BedrockRuntimeClient({ region }), modelId);

// The same job the demo data seeds
const job = {
  title: 'Software Engineer, New Grad',
  description:
    'Build internal tools and services end to end across a React front end, a NestJS API and PostgreSQL. You will own features, write tests and learn how production systems behave.',
  requiredSkills: ['react', 'typescript', 'node.js', 'nestjs', 'postgresql', 'aws'],
};

const arg = process.argv[2];
const dir = path.join(root, 'fixtures/resumes');
const files = arg ? [arg] : readdirSync(dir).filter((f) => f.endsWith('.pdf')).map((f) => path.join(dir, f));

console.log(`${modelId} in ${region}\n`);
for (const file of files) {
  if (statSync(file).size > 5 * 1024 * 1024) {
    console.log(`${path.basename(file)}: skipped, over the 5 MB upload limit`);
    continue;
  }
  const started = Date.now();
  try {
    const result = await analyser.analyse(readFileSync(file), job);
    console.log(`${path.basename(file)}  score ${result.fitScore}  (${Date.now() - started} ms)`);
    console.log(`  ${result.summary}`);
    console.log(`  skills: ${result.skills.join(', ') || 'none'}\n`);
  } catch (error) {
    console.log(`${path.basename(file)}: failed, ${error.name}: ${String(error.message).slice(0, 200)}\n`);
  }
}

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DEFAULT_CONFIG, type HireflowConfig } from '../lib/config';
import { HireflowStack } from '../lib/hireflow-stack';

/** Empty stand-ins for the esbuild output, so tests do not depend on a Lambda build. */
export function stubLambdaDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hireflow-lambdas-'));
  for (const name of ['screening', 'notifier', 'digest', 'probe']) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'index.js'), 'exports.handler = async () => ({});\n');
  }
  return dir;
}

export function synth(overrides: Partial<HireflowConfig> = {}): Template {
  const app = new App();
  const stack = new HireflowStack(app, 'TestStack', {
    config: { ...DEFAULT_CONFIG, ...overrides },
    lambdaCodeDir: stubLambdaDir(),
    env: { account: '111111111111', region: 'ap-south-1' },
  });
  return Template.fromStack(stack);
}

type Json = Record<string, unknown>;

export interface Statement {
  owner: string;
  Effect: string;
  Action: string[];
  Resource: unknown[];
  Condition?: Json;
}

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Every IAM statement in the template, with the logical id of the policy or role that owns it. */
export function allStatements(template: Template): Statement[] {
  const out: Statement[] = [];
  const resources = template.toJSON().Resources as Record<string, { Type: string; Properties: Json }>;
  for (const [owner, resource] of Object.entries(resources)) {
    const documents: Json[] = [];
    if (resource.Type === 'AWS::IAM::Policy') documents.push(resource.Properties.PolicyDocument as Json);
    if (resource.Type === 'AWS::IAM::Role') {
      for (const policy of asArray(resource.Properties.Policies as { PolicyDocument: Json }[])) {
        documents.push(policy.PolicyDocument);
      }
    }
    for (const document of documents) {
      for (const s of asArray(document.Statement as Json | Json[])) {
        out.push({
          owner,
          Effect: s.Effect as string,
          Action: asArray(s.Action as string | string[]),
          Resource: asArray(s.Resource),
          Condition: s.Condition as Json | undefined,
        });
      }
    }
  }
  return out;
}

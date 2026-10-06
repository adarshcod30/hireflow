#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { readConfig } from '../lib/config';
import { HireflowStack } from '../lib/hireflow-stack';

const app = new App();

new HireflowStack(app, 'HireflowStack', {
  config: readConfig(app.node),
  // The region is fixed in code, not read from the CLI profile: Bedrock, SES and the
  // inference profile used here are regional, and a profile default would move the whole stack
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: (app.node.tryGetContext('region') as string) ?? 'ap-south-1',
  },
  description: 'HireFlow: NestJS API, Postgres, SQS, Lambda and Bedrock on AWS',
});

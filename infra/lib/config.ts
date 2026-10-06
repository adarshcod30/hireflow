import type { Node } from 'constructs';

/** Everything that differs between one deployment of HireFlow and another. */
export interface HireflowConfig {
  /** Public hostname of the API. Caddy on the instance gets a certificate for it. */
  apiDomain: string;
  /** SES sender address. SES sends a verification email to it when the stack is created. */
  senderEmail: string;
  /** Gets alarms and the daily digest. While SES is in the sandbox it also receives every candidate email. */
  alertEmail: string;
  /** owner/name of the GitHub repository allowed to deploy through OIDC. */
  githubRepo: string;
  /** Alarm threshold for gross monthly spend, before credits. */
  monthlyBudgetUsd: number;
  /** Bedrock inference profile used for resume screening. */
  bedrockModelId: string;
}

export const DEFAULT_CONFIG: HireflowConfig = {
  apiDomain: 'api.adarshdwivedi.site',
  senderEmail: 'adarshdwivedi256@gmail.com',
  alertEmail: 'adarshdeveloper24@gmail.com',
  githubRepo: 'adarshcod30/hireflow',
  monthlyBudgetUsd: 40,
  bedrockModelId: 'apac.amazon.nova-lite-v1:0',
};

/** Defaults, overridden by `cdk deploy -c apiDomain=...` or the cdk.json context. */
export function readConfig(node: Node): HireflowConfig {
  const pick = <K extends keyof HireflowConfig>(key: K): HireflowConfig[K] => {
    const value = node.tryGetContext(key) as unknown;
    if (value === undefined || value === null || value === '') return DEFAULT_CONFIG[key];
    return (typeof DEFAULT_CONFIG[key] === 'number' ? Number(value) : value) as HireflowConfig[K];
  };
  return {
    apiDomain: pick('apiDomain'),
    senderEmail: pick('senderEmail'),
    alertEmail: pick('alertEmail'),
    githubRepo: pick('githubRepo'),
    monthlyBudgetUsd: pick('monthlyBudgetUsd'),
    bedrockModelId: pick('bedrockModelId'),
  };
}

import type { Node } from 'constructs';

/** Everything that differs between one deployment of HireFlow and another. */
export interface HireflowConfig {
  /** Public hostname of the API. Caddy on the instance gets a certificate for it. */
  apiDomain: string;
  /**
   * SES sender address. It has to be on a domain you control: the stack verifies the whole domain
   * with DKIM, and the DNS records to publish are in the stack outputs. A mailbox on a free provider
   * such as gmail.com cannot be signed, and Gmail files mail sent that way under Spam.
   */
  senderEmail: string;
  /** The address of the first administrator. Kept apart from the sender so changing one cannot touch the other. */
  adminEmail: string;
  /** Gets alarms and the daily digest. While SES is in the sandbox it also receives every candidate email. */
  alertEmail: string;
  /** owner/name of the GitHub repository allowed to deploy through OIDC. */
  githubRepo: string;
  /**
   * How GitHub names this repository inside its OIDC tokens. Repositories created from 2026 on use an
   * immutable form with numeric ids, such as `repo:owner@123/name@456`, which survives a rename.
   * Older repositories use `repo:owner/name`. To find yours:
   *   gh api repos/OWNER/REPO/actions/oidc/customization/sub --jq .sub_claim_prefix
   * Leave it empty to use the classic form built from githubRepo.
   */
  githubSubject: string;
  /** Alarm threshold for gross monthly spend, before credits. */
  monthlyBudgetUsd: number;
  /** Bedrock inference profile used for resume screening. */
  bedrockModelId: string;
}

export const DEFAULT_CONFIG: HireflowConfig = {
  apiDomain: 'api.adarshdwivedi.site',
  senderEmail: 'no-reply@adarshdwivedi.site',
  adminEmail: 'adarshdwivedi256@gmail.com',
  alertEmail: 'adarshdeveloper24@gmail.com',
  githubRepo: 'adarshcod30/hireflow',
  githubSubject: 'repo:adarshcod30@201125240/hireflow@1406556665',
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
    adminEmail: pick('adminEmail'),
    alertEmail: pick('alertEmail'),
    githubRepo: pick('githubRepo'),
    githubSubject: pick('githubSubject'),
    monthlyBudgetUsd: pick('monthlyBudgetUsd'),
    bedrockModelId: pick('bedrockModelId'),
  };
}

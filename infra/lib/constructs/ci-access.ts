import { Duration, Stack } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CiAccessProps {
  /** owner/name. Only workflows on the main branch of this repository can assume the role. */
  githubRepo: string;
  instance: ec2.IInstance;
  artifacts: s3.IBucket;
  webBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
}

const ISSUER = 'token.actions.githubusercontent.com';

/**
 * Lets GitHub Actions deploy without a stored access key. GitHub signs a token
 * for each workflow run, AWS checks it against this provider and hands back
 * credentials that last an hour. The role can ship a release and a web build
 * and nothing else: it cannot change infrastructure or read a secret.
 */
export class CiAccess extends Construct {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: CiAccessProps) {
    super(scope, id);
    const { region, account, stackName } = Stack.of(this);

    const provider = new iam.OidcProviderNative(this, 'GitHub', {
      url: `https://${ISSUER}`,
      clientIds: ['sts.amazonaws.com'],
    });

    this.role = new iam.Role(this, 'DeployRole', {
      roleName: 'hireflow-github-deploy',
      description: 'GitHub Actions deploys for adarshcod30/hireflow (main branch only)',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: { [`${ISSUER}:aud`]: 'sts.amazonaws.com' },
        StringLike: { [`${ISSUER}:sub`]: `repo:${props.githubRepo}:ref:refs/heads/main` },
      }),
    });

    props.artifacts.grantPut(this.role, 'releases/*');
    props.webBucket.grantReadWrite(this.role);
    props.webBucket.grantDelete(this.role);
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [
          `arn:aws:ssm:${region}::document/AWS-RunShellScript`,
          `arn:aws:ec2:${region}:${account}:instance/${props.instance.instanceId}`,
        ],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetCommandInvocation', 'ssm:ListCommandInvocations'],
        // These two actions do not support resource-level permissions
        resources: ['*'],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${account}:distribution/${props.distribution.distributionId}`],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:aws:cloudformation:${region}:${account}:stack/${stackName}/*`],
      }),
    );
  }
}

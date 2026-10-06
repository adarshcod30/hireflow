import * as fs from 'node:fs';
import * as path from 'node:path';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

// Pinned so a rebuild gives the same machine. Checksums come from the vendors' release pages.
const NODE_VERSION = '22.23.2';
const NODE_SHA256 = 'fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8';
const CADDY_VERSION = '2.11.7';
const CADDY_SHA512 =
  '3db36ba90c7a6e8dda40ee3dd71fa08844c76b5fb08f61b31e5e78d2ed38e71c51dc7baed875e50d1ca1279196e84302967237386ae87c91ae9f2aaceada682e';

export interface ApiHostProps {
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  apiDomain: string;
  acmeEmail: string;
  resumes: s3.IBucket;
  artifacts: s3.IBucket;
  notificationsQueue: sqs.IQueue;
  /** Secrets the instance reads at deploy time, by the name the activate script asks for. */
  secrets: Record<'db' | 'jwt' | 'internal-hmac' | 'admin', secretsmanager.ISecret>;
  /** Plain configuration, written to /hireflow/env/NAME and turned into NAME=value for the API. */
  environment: Record<string, string>;
}

/** The one EC2 instance that runs the API behind Caddy, reached through Session Manager rather than SSH. */
export class ApiHost extends Construct {
  readonly instance: ec2.Instance;
  readonly publicIp: string;
  readonly apiLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: ApiHostProps) {
    super(scope, id);

    this.apiLogGroup = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: '/hireflow/api',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new logs.LogGroup(this, 'DeployLogs', {
      logGroupName: '/hireflow/deploy',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'HireFlow API instance',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // What the API does at run time: presign uploads and queue notifications
    props.resumes.grantPut(role);
    props.notificationsQueue.grantSendMessages(role);
    // What the deploy script does: pull a release, read configuration and secrets
    props.artifacts.grantRead(role);
    for (const secret of Object.values(props.secrets)) secret.grantRead(role);
    const { region, account } = Stack.of(this);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${region}:${account}:parameter/hireflow`,
          `arn:aws:ssm:${region}:${account}:parameter/hireflow/*`,
        ],
      }),
    );

    const bootstrap = fs
      .readFileSync(path.join(__dirname, '..', '..', 'assets', 'bootstrap.sh'), 'utf8')
      .replaceAll('__NODE_VERSION__', NODE_VERSION)
      .replaceAll('__NODE_SHA256__', NODE_SHA256)
      .replaceAll('__CADDY_VERSION__', CADDY_VERSION)
      .replaceAll('__CADDY_SHA512__', CADDY_SHA512)
      .replaceAll('__API_DOMAIN__', props.apiDomain)
      .replaceAll('__ACME_EMAIL__', props.acmeEmail);
    const userData = ec2.UserData.custom(bootstrap);

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: props.securityGroup,
      role,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      // Pinned in cdk.context.json on first synth so a new AMI does not silently replace the machine
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        cachedInContext: true,
      }),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(16, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }),
        },
      ],
      requireImdsv2: true,
      userData,
      userDataCausesReplacement: false,
    });

    // A fixed address, so the DNS record survives a stop and start
    const eip = new ec2.CfnEIP(this, 'Eip', { instanceId: this.instance.instanceId, domain: 'vpc' });
    this.publicIp = eip.attrPublicIp;

    for (const [name, value] of Object.entries(props.environment)) {
      new ssm.StringParameter(this, `Env${name}`, { parameterName: `/hireflow/env/${name}`, stringValue: value });
    }
    for (const [name, secret] of Object.entries(props.secrets)) {
      new ssm.StringParameter(this, `Secret${name}`, {
        parameterName: `/hireflow/secrets/${name}`,
        stringValue: secret.secretArn,
        description: 'ARN only. The value stays in Secrets Manager.',
      });
    }
  }
}

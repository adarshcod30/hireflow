import * as path from 'node:path';
import { CfnOutput, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { ApiHost } from './constructs/api-host';
import { CiAccess } from './constructs/ci-access';
import { Database } from './constructs/database';
import { Network } from './constructs/network';
import { Observability } from './constructs/observability';
import { AppSecrets } from './constructs/secrets';
import { Storage } from './constructs/storage';
import { Website } from './constructs/website';
import { Workers } from './constructs/workers';
import { type HireflowConfig } from './config';

export interface HireflowStackProps extends StackProps {
  config: HireflowConfig;
  /** Where the built Lambda bundles are. The build script writes them to lambdas/dist. */
  lambdaCodeDir?: string;
}

export class HireflowStack extends Stack {
  constructor(scope: Construct, id: string, props: HireflowStackProps) {
    super(scope, id, props);
    const { config } = props;
    const lambdaCodeDir = props.lambdaCodeDir ?? path.join(__dirname, '..', '..', 'lambdas', 'dist');

    Tags.of(this).add('Project', 'hireflow');

    const network = new Network(this, 'Network');
    const storage = new Storage(this, 'Storage');
    const secrets = new AppSecrets(this, 'Secrets', { adminEmail: config.adminEmail });
    const database = new Database(this, 'Database', {
      vpc: network.vpc,
      clientSecurityGroup: network.apiSecurityGroup,
    });
    const website = new Website(this, 'Website', { apiDomain: config.apiDomain, region: this.region });

    const workers = new Workers(this, 'Workers', {
      resumes: storage.resumes,
      internalSecret: secrets.internalHmac,
      apiDomain: config.apiDomain,
      senderEmail: config.senderEmail,
      alertEmail: config.alertEmail,
      bedrockModelId: config.bedrockModelId,
      codeDir: lambdaCodeDir,
    });

    // The browser posts a resume straight to S3, from the web app's origin
    storage.resumes.addCorsRule({
      allowedMethods: [s3.HttpMethods.POST],
      allowedOrigins: [website.url, 'http://localhost:5173'],
      allowedHeaders: ['*'],
      maxAge: 3000,
    });

    const host = new ApiHost(this, 'ApiHost', {
      vpc: network.vpc,
      securityGroup: network.apiSecurityGroup,
      apiDomain: config.apiDomain,
      acmeEmail: config.alertEmail,
      resumes: storage.resumes,
      artifacts: storage.artifacts,
      notificationsQueue: workers.notificationsQueue,
      secrets: {
        db: database.instance.secret!,
        jwt: secrets.jwt,
        'internal-hmac': secrets.internalHmac,
        admin: secrets.admin,
      },
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        TRUST_PROXY: '1',
        LOG_LEVEL: 'info',
        ENABLE_DOCS: 'true',
        DATABASE_SSL: 'true',
        STORAGE_DRIVER: 's3',
        QUEUE_DRIVER: 'sqs',
        OUTBOX_RELAY_ENABLED: 'true',
        AWS_REGION: this.region,
        RESUME_BUCKET: storage.resumes.bucketName,
        NOTIFICATIONS_QUEUE_URL: workers.notificationsQueue.queueUrl,
        WEB_ORIGINS: website.url,
        // A working day. The console has no refresh flow yet, and 15 minutes signed people out mid-task.
        JWT_EXPIRES_IN: '8h',
      },
    });

    // Mail is sent from a verified domain, signed with DKIM, so that Gmail and others trust it.
    // The three CNAME records in the outputs prove ownership and publish the signing keys.
    const senderDomain = config.senderEmail.split('@')[1];
    const domainIdentity = new ses.EmailIdentity(this, 'IdentitySenderDomain', {
      identity: ses.Identity.domain(senderDomain),
      dkimSigning: true,
    });
    // While SES is in the sandbox it only delivers to verified addresses, and the alert address gets
    // every candidate email. It receives one verification email that must be clicked once.
    new ses.EmailIdentity(this, `Identity${config.alertEmail.replace(/[^a-zA-Z0-9]/g, '')}`, {
      identity: ses.Identity.email(config.alertEmail),
    });

    const observability = new Observability(this, 'Observability', {
      alertEmail: config.alertEmail,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      instance: host.instance,
      database: database.instance,
      workers,
      apiLogGroup: host.apiLogGroup,
    });

    const ci = new CiAccess(this, 'CiAccess', {
      githubRepo: config.githubRepo,
      githubSubject: config.githubSubject,
      instance: host.instance,
      artifacts: storage.artifacts,
      webBucket: website.bucket,
      distribution: website.distribution,
    });

    const out = (id: string, value: string, description: string) => new CfnOutput(this, id, { value, description });
    out('ApiPublicIp', host.publicIp, 'Point the A record for the API domain here');
    out('ApiUrl', `https://${config.apiDomain}`, 'API base URL');
    out('WebUrl', website.url, 'Web app URL');
    out('InstanceId', host.instance.instanceId, 'API instance, for SSM deploys and Session Manager');
    out('ArtifactsBucket', storage.artifacts.bucketName, 'Release bundles are uploaded here');
    out('WebBucket', website.bucket.bucketName, 'Static web build is synced here');
    out(
      'DistributionId',
      website.distribution.distributionId,
      'CloudFront distribution to invalidate after a web deploy',
    );
    out('ResumeBucket', storage.resumes.bucketName, 'Candidate resumes');
    [
      [domainIdentity.dkimDnsTokenName1, domainIdentity.dkimDnsTokenValue1],
      [domainIdentity.dkimDnsTokenName2, domainIdentity.dkimDnsTokenValue2],
      [domainIdentity.dkimDnsTokenName3, domainIdentity.dkimDnsTokenValue3],
    ].forEach(([name, value], i) =>
      out(`DkimRecord${i + 1}`, `${name} CNAME ${value}`, 'Publish this DNS record to sign mail'),
    );
    out('AdminSecretArn', secrets.admin.secretArn, 'First admin login (email and password)');
    out('DeployRoleArn', ci.role.roleArn, 'GitHub Actions assumes this role through OIDC');
    out('AlertsTopicArn', observability.topic.topicArn, 'All alarms publish here');
    out(
      'DashboardUrl',
      `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=HireFlow`,
      'CloudWatch dashboard',
    );
  }
}

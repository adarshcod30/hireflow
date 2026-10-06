import * as path from 'node:path';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface WorkersProps {
  resumes: s3.IBucket;
  internalSecret: secretsmanager.ISecret;
  apiDomain: string;
  senderEmail: string;
  alertEmail: string;
  bedrockModelId: string;
  /** Folder holding one built bundle per function: screening/, notifier/, digest/, probe/. */
  codeDir: string;
}

const QUEUE_ENCRYPTION = { encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true };

/**
 * The asynchronous half of the system.
 *
 *   resume lands in S3 -> queue -> screening Lambda -> Bedrock -> result posted to the API
 *   status changes in the API -> outbox -> queue -> notifier Lambda -> SES
 *   every morning -> digest Lambda -> SES
 *   every five minutes -> probe Lambda -> CloudWatch metric
 *
 * Each queue has a dead-letter queue, so a message that keeps failing is
 * parked where an alarm can see it instead of being retried forever.
 */
export class Workers extends Construct {
  readonly screeningQueue: sqs.Queue;
  readonly screeningDlq: sqs.Queue;
  readonly notificationsQueue: sqs.Queue;
  readonly notificationsDlq: sqs.Queue;
  readonly screening: lambda.Function;
  readonly notifier: lambda.Function;
  readonly digest: lambda.Function;
  readonly probe: lambda.Function;

  constructor(scope: Construct, id: string, props: WorkersProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const apiBaseUrl = `https://${props.apiDomain}`;

    this.screeningDlq = new sqs.Queue(this, 'ScreeningDlq', {
      retentionPeriod: Duration.days(14),
      ...QUEUE_ENCRYPTION,
    });
    this.screeningQueue = new sqs.Queue(this, 'ScreeningQueue', {
      // Longer than the function timeout, so a slow screening is not delivered twice
      visibilityTimeout: Duration.seconds(6 * 90),
      deadLetterQueue: { queue: this.screeningDlq, maxReceiveCount: 4 },
      ...QUEUE_ENCRYPTION,
    });

    this.notificationsDlq = new sqs.Queue(this, 'NotificationsDlq', {
      retentionPeriod: Duration.days(14),
      ...QUEUE_ENCRYPTION,
    });
    this.notificationsQueue = new sqs.Queue(this, 'NotificationsQueue', {
      visibilityTimeout: Duration.seconds(6 * 30),
      deadLetterQueue: { queue: this.notificationsDlq, maxReceiveCount: 5 },
      ...QUEUE_ENCRYPTION,
    });

    const fn = (
      name: string,
      dir: string,
      extra: Partial<lambda.FunctionProps> & { environment?: Record<string, string> },
    ) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(props.codeDir, dir)),
        tracing: lambda.Tracing.ACTIVE,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        ...extra,
        environment: { NODE_OPTIONS: '--enable-source-maps', ...extra.environment },
      });

    const apiAccess = { API_BASE_URL: apiBaseUrl, INTERNAL_SECRET_ARN: props.internalSecret.secretArn };

    this.screening = fn('Screening', 'screening', {
      description: 'Scores a resume against its job with Bedrock Nova and posts the result to the API',
      timeout: Duration.seconds(90),
      memorySize: 512,
      environment: { ...apiAccess, BEDROCK_MODEL_ID: props.bedrockModelId },
    });
    this.notifier = fn('Notifier', 'notifier', {
      description: 'Sends candidate status emails through SES, once per status change',
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: { ...apiAccess, NOTIFY_FROM: props.senderEmail, NOTIFY_REDIRECT_TO: props.alertEmail },
    });
    this.digest = fn('Digest', 'digest', {
      description: 'Emails the applications that have waited too long for a recruiter',
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: { ...apiAccess, NOTIFY_FROM: props.senderEmail, DIGEST_TO: props.alertEmail, DIGEST_DAYS: '7' },
    });
    this.probe = fn('Probe', 'probe', {
      description: 'Calls the API readiness endpoint from outside and publishes the result as a metric',
      timeout: Duration.seconds(15),
      memorySize: 128,
      environment: { PROBE_URL: `${apiBaseUrl}/health/ready` },
    });

    // Read the resume, read the shared secret, call exactly one Bedrock model
    props.resumes.grantRead(this.screening);
    for (const f of [this.screening, this.notifier, this.digest]) props.internalSecret.grantRead(f);
    this.screening.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${stack.region}:${stack.account}:inference-profile/${props.bedrockModelId}`,
          // The profile routes across regions, so the model itself is named without one
          `arn:aws:bedrock:*::foundation-model/${props.bedrockModelId.replace(/^[a-z]+\./, '')}`,
        ],
      }),
    );
    // Mail can only go out from the one verified sender
    for (const f of [this.notifier, this.digest]) {
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [`arn:aws:ses:${stack.region}:${stack.account}:identity/*`],
          conditions: { StringEquals: { 'ses:FromAddress': props.senderEmail } },
        }),
      );
    }

    this.screening.addEventSource(
      new sources.SqsEventSource(this.screeningQueue, {
        batchSize: 5,
        // Bedrock throttles new accounts hard, so two at a time is plenty
        maxConcurrency: 2,
        reportBatchItemFailures: true,
      }),
    );
    this.notifier.addEventSource(
      new sources.SqsEventSource(this.notificationsQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(2),
        maxConcurrency: 5,
        reportBatchItemFailures: true,
      }),
    );

    // A resume arriving anywhere under resumes/ starts the pipeline
    props.resumes.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(this.screeningQueue), {
      prefix: 'resumes/',
      suffix: '.pdf',
    });

    // 09:00 IST
    new events.Rule(this, 'DigestSchedule', {
      description: 'Daily recruiter digest',
      schedule: events.Schedule.cron({ minute: '30', hour: '3' }),
      targets: [new targets.LambdaFunction(this.digest)],
    });
    new events.Rule(this, 'ProbeSchedule', {
      description: 'Uptime probe',
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(this.probe)],
    });
  }
}

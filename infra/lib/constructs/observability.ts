import { Duration } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import type { Workers } from './workers';

export interface ObservabilityProps {
  alertEmail: string;
  monthlyBudgetUsd: number;
  instance: ec2.IInstance;
  database: rds.IDatabaseInstance;
  workers: Workers;
  apiLogGroup: logs.ILogGroup;
}

const METRICS_NAMESPACE = 'HireFlow';

/**
 * What tells a human that something is wrong: alarms that email, one dashboard,
 * and a spend alarm. Every alarm goes to the same SNS topic, so there is one
 * subscription to confirm and one place to add a pager later.
 */
export class Observability extends Construct {
  readonly topic: sns.Topic;
  readonly dashboard: cloudwatch.Dashboard;
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);
    const { workers, instance, database } = props;

    this.topic = new sns.Topic(this, 'Alerts', { displayName: 'HireFlow alerts', enforceSSL: true });
    this.topic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const notify = new actions.SnsAction(this.topic);

    const alarm = (
      name: string,
      metric: cloudwatch.IMetric,
      options: Partial<cloudwatch.AlarmProps> & { threshold: number; description: string },
    ) => {
      const a = new cloudwatch.Alarm(this, name, {
        metric,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmName: `hireflow-${name}`,
        ...options,
        alarmDescription: options.description,
      });
      a.addAlarmAction(notify);
      a.addOkAction(notify);
      this.alarms.push(a);
      return a;
    };
    const dlqDepth = (q: Workers['screeningDlq']) =>
      q.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: 'Maximum' });

    // A message in a dead-letter queue means a job failed every retry. Someone should look.
    alarm('screening-dlq-not-empty', dlqDepth(workers.screeningDlq), {
      threshold: 1,
      description: 'A resume could not be screened after several attempts. Check the screening Lambda logs.',
    });
    alarm('notifications-dlq-not-empty', dlqDepth(workers.notificationsDlq), {
      threshold: 1,
      description: 'A candidate email could not be sent after several attempts. Check the notifier Lambda logs.',
    });
    alarm(
      'screening-backlog',
      workers.screeningQueue.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5) }),
      {
        threshold: 15 * 60,
        description: 'A resume has waited over 15 minutes for screening.',
      },
    );
    for (const [name, fn] of [
      ['screening', workers.screening],
      ['notifier', workers.notifier],
      ['digest', workers.digest],
    ] as const) {
      alarm(`${name}-errors`, fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }), {
        threshold: 1,
        description: `The ${name} Lambda threw an error.`,
      });
    }

    // The probe publishes 1 when /health/ready answers 200 and 0 otherwise. Missing data counts as down.
    const apiHealthy = new cloudwatch.Metric({
      namespace: METRICS_NAMESPACE,
      metricName: 'ApiHealthy',
      statistic: 'Minimum',
      period: Duration.minutes(5),
    });
    alarm('api-down', apiHealthy, {
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      description:
        'The API readiness check failed twice in a row, seen from outside AWS. Covers DNS, TLS, the app and the database.',
    });

    // Server errors, counted from the API log
    const errors5xx = new logs.MetricFilter(this, 'Api5xx', {
      logGroup: props.apiLogGroup,
      metricNamespace: METRICS_NAMESPACE,
      metricName: 'Api5xx',
      filterPattern: logs.FilterPattern.numberValue('$.res.statusCode', '>=', 500),
      metricValue: '1',
      defaultValue: 0,
    });
    alarm('api-5xx', errors5xx.metric({ statistic: 'Sum', period: Duration.minutes(5) }), {
      threshold: 5,
      description: 'Five or more 5xx responses in five minutes.',
    });

    const instanceMetric = (metricName: string, namespace = 'AWS/EC2', statistic = 'Maximum') =>
      new cloudwatch.Metric({
        namespace,
        metricName,
        statistic,
        period: Duration.minutes(5),
        dimensionsMap: { InstanceId: instance.instanceId },
      });
    const statusCheck = alarm(
      'instance-status-check',
      instanceMetric('StatusCheckFailed_System', 'AWS/EC2', 'Maximum'),
      {
        threshold: 1,
        evaluationPeriods: 2,
        description: 'The host under the API instance is impaired. EC2 is asked to recover it.',
      },
    );
    statusCheck.addAlarmAction(new actions.Ec2Action(actions.Ec2InstanceAction.RECOVER));
    alarm('instance-memory', instanceMetric('mem_used_percent', 'HireFlow/Host', 'Average'), {
      threshold: 85,
      evaluationPeriods: 3,
      description: 'The API instance has used more than 85 percent of its memory for 15 minutes.',
    });
    alarm('database-cpu', database.metricCPUUtilization({ period: Duration.minutes(5) }), {
      threshold: 80,
      evaluationPeriods: 3,
      description: 'Database CPU above 80 percent for 15 minutes.',
    });
    alarm(
      'database-storage-low',
      database.metricFreeStorageSpace({ period: Duration.minutes(5), statistic: 'Minimum' }),
      {
        threshold: 3 * 1024 ** 3,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        description: 'Less than 3 GB of database storage is free.',
      },
    );

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', { dashboardName: 'HireFlow' });
    const graph = (title: string, left: cloudwatch.IMetric[], extra: Partial<cloudwatch.GraphWidgetProps> = {}) =>
      new cloudwatch.GraphWidget({ title, left, width: 8, height: 6, ...extra });
    this.dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({ title: 'Alarms', alarms: this.alarms, width: 24, height: 4 }),
      graph('API healthy (1 = up)', [apiHealthy], { leftYAxis: { min: 0, max: 1 } }),
      graph('API 5xx responses', [errors5xx.metric({ statistic: 'Sum', period: Duration.minutes(5) })]),
      graph(
        'Instance CPU and memory',
        [
          instanceMetric('CPUUtilization', 'AWS/EC2', 'Average'),
          instanceMetric('mem_used_percent', 'HireFlow/Host', 'Average'),
        ],
        { leftYAxis: { min: 0, max: 100 } },
      ),
      graph('Screening queue', [
        workers.screeningQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
        workers.screeningDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
      ]),
      graph('Notifications queue', [
        workers.notificationsQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
        workers.notificationsDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
      ]),
      graph('Lambda duration (p95)', [
        workers.screening.metricDuration({ statistic: 'p95' }),
        workers.notifier.metricDuration({ statistic: 'p95' }),
      ]),
      graph('Database CPU and connections', [database.metricCPUUtilization(), database.metricDatabaseConnections()]),
      graph('Database free storage (bytes)', [database.metricFreeStorageSpace()]),
      graph('Lambda errors', [
        workers.screening.metricErrors(),
        workers.notifier.metricErrors(),
        workers.digest.metricErrors(),
      ]),
    );

    // Gross spend, before credits, for resources tagged Project=hireflow. The tag
    // has to be activated for cost allocation once (see docs/runbook.md).
    new budgets.CfnBudget(this, 'Budget', {
      budget: {
        budgetName: 'hireflow-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: ['user:Project$hireflow'] },
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: [
        { threshold: 80, type: 'ACTUAL' },
        { threshold: 100, type: 'FORECASTED' },
      ].map(({ threshold, type }) => ({
        notification: {
          notificationType: type,
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
      })),
    });
  }
}

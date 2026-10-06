import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface DatabaseProps {
  vpc: ec2.IVpc;
  /** The only group allowed to connect. */
  clientSecurityGroup: ec2.ISecurityGroup;
}

/** PostgreSQL 17 on the smallest instance that runs it, single zone, in the isolated subnets. */
export class Database extends Construct {
  readonly instance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'HireFlow Postgres: API instance only',
      allowAllOutbound: false,
    });
    securityGroup.addIngressRule(props.clientSecurityGroup, ec2.Port.tcp(5432), 'API instance');

    this.instance = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroup],
      publiclyAccessible: false,
      databaseName: 'hireflow',
      // The password is generated into Secrets Manager. The characters below
      // are left out so it can sit in a connection URL without escaping.
      credentials: rds.Credentials.fromGeneratedSecret('hireflow', {
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\=,',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: Duration.days(7),
      // 02:30 to 03:30 IST, when nobody is applying for jobs
      preferredBackupWindow: '21:00-22:00',
      preferredMaintenanceWindow: 'sun:22:00-sun:23:00',
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      // A demo environment: destroying the stack destroys the data, snapshot and all
      deletionProtection: false,
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}

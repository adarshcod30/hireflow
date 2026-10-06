import { Match, Template } from 'aws-cdk-lib/assertions';
import { allStatements, synth } from './helpers';

let template: Template;
beforeAll(() => {
  template = synth();
});

const resources = (type: string): Record<string, { Properties: Record<string, any> }> =>
  template.findResources(type) as Record<string, { Properties: Record<string, any> }>;

describe('network', () => {
  it('has no NAT gateway, so the stack does not pay for one', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('routes to the internet only from the two public subnets', () => {
    // One default route per public route table. The isolated subnets have none.
    const routes = Object.values(resources('AWS::EC2::Route'));
    expect(routes).toHaveLength(2);
    for (const route of routes) expect(route.Properties.DestinationCidrBlock).toBe('0.0.0.0/0');
  });

  it('lets the world reach the API instance on 80 and 443 only, never SSH', () => {
    const groups = Object.values(resources('AWS::EC2::SecurityGroup'));
    const api = groups.find((g) => /API instance/.test(g.Properties.GroupDescription as string))!;
    const ports = (api.Properties.SecurityGroupIngress as { FromPort: number; CidrIp: string }[]).map(
      (r) => r.FromPort,
    );
    expect(ports.sort()).toEqual([443, 80]);
    expect(JSON.stringify(template.toJSON())).not.toMatch(/"FromPort":22\b/);
  });
});

describe('database', () => {
  it('is private, encrypted, backed up and not multi-zone', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      DBInstanceClass: 'db.t4g.micro',
      PubliclyAccessible: false,
      StorageEncrypted: true,
      StorageType: 'gp3',
      MultiAZ: false,
      BackupRetentionPeriod: 7,
    });
  });

  it('accepts connections from the API security group and from nothing else', () => {
    const ingress = Object.values(resources('AWS::EC2::SecurityGroupIngress'));
    expect(ingress).toHaveLength(1);
    expect(ingress[0].Properties).toMatchObject({ FromPort: 5432, ToPort: 5432, IpProtocol: 'tcp' });
    expect(ingress[0].Properties.SourceSecurityGroupId).toBeDefined();
    expect(ingress[0].Properties.CidrIp).toBeUndefined();
  });

  it('generates its password in Secrets Manager instead of taking one from the template', () => {
    const secrets = Object.values(resources('AWS::SecretsManager::Secret'));
    expect(secrets).toHaveLength(4);
    for (const secret of secrets) expect(secret.Properties.GenerateSecretString).toBeDefined();
  });
});

describe('api host', () => {
  it('runs on an ARM t4g.micro with an encrypted disk, and requires IMDSv2', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.micro',
      BlockDeviceMappings: [Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }) })],
    });
    // IMDSv2 only: a stolen URL fetched through the app cannot reach the instance credentials
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: Match.objectLike({ MetadataOptions: Match.objectLike({ HttpTokens: 'required' }) }),
    });
  });

  it('boots with pinned, checksummed downloads and the right domain, and no secret', () => {
    const userData = Buffer.from(
      (Object.values(resources('AWS::EC2::Instance'))[0].Properties.UserData as { 'Fn::Base64': string })['Fn::Base64'],
      'utf8',
    ).toString('utf8');
    expect(userData).toContain('sha256sum -c');
    expect(userData).toContain('sha512sum -c');
    expect(userData).toContain('api.adarshdwivedi.site');
    expect(userData).not.toMatch(/__[A-Z_]+__/); // every placeholder was filled in
    expect(userData).not.toMatch(/AKIA|secret_access_key|password=/i);
  });

  it('keeps a fixed public address so the DNS record survives a restart', () => {
    template.resourceCountIs('AWS::EC2::EIP', 1);
  });

  it('can read exactly its own configuration and secrets', () => {
    const statements = allStatements(template).filter((s) => s.owner.startsWith('ApiHostRoleDefaultPolicy'));
    const actions = statements.flatMap((s) => s.Action);
    expect(actions).toEqual(
      expect.arrayContaining(['secretsmanager:GetSecretValue', 'sqs:SendMessage', 'ssm:GetParametersByPath']),
    );
    expect(actions).not.toContain('s3:DeleteObject*');
    expect(actions).not.toContain('sqs:*');
  });
});

describe('storage', () => {
  it('blocks public access, encrypts and refuses plain HTTP on every bucket', () => {
    const buckets = Object.values(resources('AWS::S3::Bucket'));
    expect(buckets).toHaveLength(3);
    for (const bucket of buckets) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties.BucketEncryption).toBeDefined();
    }
    const policies = JSON.stringify(Object.values(resources('AWS::S3::BucketPolicy')));
    expect(policies.match(/aws:SecureTransport/g)).toHaveLength(3);
  });

  it('lets only the web app origin post a resume from a browser', () => {
    const resumes = Object.values(resources('AWS::S3::Bucket')).find((b) => b.Properties.CorsConfiguration)!;
    const rule = (resumes.Properties.CorsConfiguration as { CorsRules: any[] }).CorsRules[0];
    expect(rule.AllowedMethods).toEqual(['POST']);
    expect(rule.AllowedOrigins).toHaveLength(2);
    // The first origin is the CloudFront domain, a token that resolves at deploy time
    expect(JSON.stringify(rule.AllowedOrigins[0])).toContain('"DomainName"');
    expect(rule.AllowedOrigins).not.toContain('*');
  });
});

describe('queues and workers', () => {
  it('parks a message in a dead-letter queue after repeated failures', () => {
    const queues = Object.values(resources('AWS::SQS::Queue'));
    expect(queues).toHaveLength(4);
    const redriven = queues.filter((q) => q.Properties.RedrivePolicy);
    expect(redriven).toHaveLength(2);
    for (const q of redriven) expect(q.Properties.RedrivePolicy.maxReceiveCount).toBeGreaterThanOrEqual(4);
    for (const q of queues) expect(q.Properties.SqsManagedSseEnabled).toBe(true);
  });

  it('starts screening when a PDF appears under resumes/', () => {
    const notifications = JSON.stringify(template.findResources('Custom::S3BucketNotifications'));
    expect(notifications).toContain('s3:ObjectCreated:*');
    expect(notifications).toContain('resumes/');
    expect(notifications).toContain('.pdf');
  });

  it('runs every function on Node 22 ARM with tracing and a bounded log retention', () => {
    const functions = Object.values(resources('AWS::Lambda::Function')).filter(
      (f) => f.Properties.Runtime === 'nodejs22.x',
    );
    expect(functions).toHaveLength(4);
    for (const fn of functions) {
      expect(fn.Properties.Architectures).toEqual(['arm64']);
      expect(fn.Properties.TracingConfig).toEqual({ Mode: 'Active' });
    }
    template.resourceCountIs('AWS::Logs::LogGroup', 6);
    for (const group of Object.values(resources('AWS::Logs::LogGroup'))) {
      expect(group.Properties.RetentionInDays).toBeGreaterThan(0);
    }
  });

  it('reports failures per message, so one bad resume does not replay the whole batch', () => {
    const mappings = Object.values(resources('AWS::Lambda::EventSourceMapping'));
    expect(mappings).toHaveLength(2);
    for (const mapping of mappings) {
      expect(mapping.Properties.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
      expect(mapping.Properties.ScalingConfig.MaximumConcurrency).toBeGreaterThanOrEqual(2);
    }
  });

  it('sets each visibility timeout above six times the function timeout', () => {
    const timeouts = Object.fromEntries(
      Object.values(resources('AWS::Lambda::Function')).map((f) => [
        f.Properties.Description as string,
        f.Properties.Timeout as number,
      ]),
    );
    const screening = timeouts[Object.keys(timeouts).find((k) => /Scores a resume/.test(k))!];
    const notifier = timeouts[Object.keys(timeouts).find((k) => /status emails/.test(k))!];
    const visibility = Object.values(resources('AWS::SQS::Queue'))
      .map((q) => q.Properties.VisibilityTimeout as number | undefined)
      .filter((v): v is number => v !== undefined);
    expect(visibility).toContain(screening * 6);
    expect(visibility).toContain(notifier * 6);
  });

  it('digests every morning at 09:00 IST and probes every five minutes', () => {
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(30 3 * * ? *)' });
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(5 minutes)' });
  });

  it('passes the shared secret by ARN, never by value', () => {
    const environments = Object.values(resources('AWS::Lambda::Function')).map(
      (f) => f.Properties.Environment?.Variables ?? {},
    );
    for (const env of environments) {
      for (const key of Object.keys(env)) expect(key).not.toMatch(/SECRET$|KEY$|PASSWORD/);
    }
    expect(JSON.stringify(environments)).toContain('INTERNAL_SECRET_ARN');
  });
});

describe('least privilege', () => {
  it('allows a wildcard resource only for the three actions that cannot be scoped', () => {
    const wildcard = allStatements(template)
      .filter((s) => s.Resource.includes('*'))
      .flatMap((s) => s.Action)
      .sort();
    const allowed = new Set([
      'xray:PutTraceSegments', // tracing has no resource-level permissions
      'xray:PutTelemetryRecords',
      'logs:PutRetentionPolicy', // CDK's own log-retention helper
      'logs:DeleteRetentionPolicy',
      'ssm:GetCommandInvocation', // the CI role polling its own command
      'ssm:ListCommandInvocations',
    ]);
    expect(wildcard.filter((a) => !allowed.has(a))).toEqual([]);
  });

  it('never grants an action that is a bare wildcard', () => {
    for (const s of allStatements(template)) {
      for (const action of s.Action) expect(action).not.toMatch(/^\*$|^[a-z0-9]+:\*$/);
    }
  });

  it('limits Bedrock to the one configured model, through its inference profile', () => {
    const bedrock = allStatements(template).filter((s) => s.Action.some((a) => a.startsWith('bedrock:')));
    expect(bedrock).toHaveLength(1);
    expect(bedrock[0].Action).toEqual(['bedrock:InvokeModel']);
    const text = JSON.stringify(bedrock[0].Resource);
    expect(text).toContain('inference-profile/apac.amazon.nova-lite-v1:0');
    expect(text).toContain('foundation-model/amazon.nova-lite-v1:0');
  });

  it('lets the mailers send only as the verified sender', () => {
    const ses = allStatements(template).filter((s) => s.Action.includes('ses:SendEmail'));
    expect(ses).toHaveLength(2);
    for (const s of ses) {
      expect(s.Condition).toEqual({ StringEquals: { 'ses:FromAddress': 'no-reply@adarshdwivedi.site' } });
    }
  });

  it('keeps the JWT and database secrets away from the Lambdas', () => {
    const lambdaPolicies = allStatements(template).filter((s) =>
      /^Workers(Screening|Notifier|Digest|Probe)ServiceRole/.test(s.owner),
    );
    const secretStatements = lambdaPolicies.filter((s) => s.Action.some((a) => a.startsWith('secretsmanager:')));
    expect(secretStatements.length).toBeGreaterThan(0);
    for (const s of secretStatements) expect(JSON.stringify(s.Resource)).toContain('SecretsInternalHmac');
  });
});

describe('web delivery', () => {
  it('serves over HTTPS only, from a private bucket, with security headers', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https', Compress: true }),
      }),
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("connect-src 'self' https://api\\.adarshdwivedi\\.site"),
          }),
          FrameOptions: Match.objectLike({ FrameOption: 'DENY' }),
          StrictTransportSecurity: Match.objectLike({ Override: true }),
        }),
      }),
    });
  });

  it('sends unknown paths to the app, so client-side routes survive a refresh', () => {
    const config = Object.values(resources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    expect(config.CustomErrorResponses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        expect.objectContaining({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
      ]),
    );
  });
});

describe('continuous deployment access', () => {
  it('trusts GitHub for one repository and one branch, with an audience check', () => {
    const roles = Object.values(resources('AWS::IAM::Role')).filter(
      (r) => r.Properties.RoleName === 'hireflow-github-deploy',
    );
    expect(roles).toHaveLength(1);
    const condition = roles[0].Properties.AssumeRolePolicyDocument.Statement[0].Condition;
    expect(condition.StringEquals['token.actions.githubusercontent.com:aud']).toBe('sts.amazonaws.com');
    // The immutable form GitHub gives new repositories: owner and repository ids, not just names
    expect(condition.StringLike['token.actions.githubusercontent.com:sub']).toBe(
      'repo:adarshcod30@201125240/hireflow@1406556665:ref:refs/heads/main',
    );
    expect(roles[0].Properties.MaxSessionDuration).toBe(3600);
  });

  it('falls back to the classic owner/name subject when no immutable one is configured', () => {
    const role = Object.values(synth({ githubSubject: '' }).findResources('AWS::IAM::Role')).find(
      (r) => r.Properties.RoleName === 'hireflow-github-deploy',
    )!;
    const condition = role.Properties.AssumeRolePolicyDocument.Statement[0].Condition;
    expect(condition.StringLike['token.actions.githubusercontent.com:sub']).toBe(
      'repo:adarshcod30/hireflow:ref:refs/heads/main',
    );
  });

  it('never trusts a wildcard subject, so no other repository or branch can deploy', () => {
    for (const subject of ['', 'repo:someone@1/else@2']) {
      const role = Object.values(synth({ githubSubject: subject }).findResources('AWS::IAM::Role')).find(
        (r) => r.Properties.RoleName === 'hireflow-github-deploy',
      )!;
      const sub = role.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringLike[
        'token.actions.githubusercontent.com:sub'
      ] as string;
      expect(sub).not.toContain('*');
      expect(sub.endsWith(':ref:refs/heads/main')).toBe(true);
    }
  });

  it('can ship a release and a web build but cannot touch infrastructure or secrets', () => {
    const actions = allStatements(template)
      .filter((s) => s.owner.startsWith('CiAccessDeployRole'))
      .flatMap((s) => s.Action);
    expect(actions).toEqual(expect.arrayContaining(['ssm:SendCommand', 'cloudfront:CreateInvalidation']));
    expect(
      actions.filter((a) => /^(iam|ec2|rds|secretsmanager|cloudformation:(Create|Update|Delete)).*/.test(a)),
    ).toEqual([]);
  });
});

describe('alerting', () => {
  it('emails every alarm through one SNS topic', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'adarshdeveloper24@gmail.com',
    });
    const alarms = Object.values(resources('AWS::CloudWatch::Alarm'));
    expect(alarms).toHaveLength(12);
    for (const alarm of alarms) {
      expect(alarm.Properties.AlarmActions).toHaveLength(
        alarm.Properties.AlarmName === 'hireflow-instance-status-check' ? 2 : 1,
      );
      expect(alarm.Properties.OKActions).toHaveLength(1);
    }
  });

  it('treats missing probe data as an outage, because silence is how a dead probe looks', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'hireflow-api-down',
      TreatMissingData: 'breaching',
      ComparisonOperator: 'LessThanThreshold',
      EvaluationPeriods: 2,
    });
  });

  it('asks EC2 to recover an impaired host', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'hireflow-instance-status-check',
      AlarmActions: Match.arrayWith([Match.objectLike({ 'Fn::Join': Match.anyValue() })]),
    });
    expect(JSON.stringify(resources('AWS::CloudWatch::Alarm'))).toContain(':automate:ap-south-1:ec2:recover');
  });

  it('watches gross spend for resources tagged Project=hireflow', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: 'hireflow-monthly',
        BudgetLimit: { Amount: 40, Unit: 'USD' },
        CostFilters: { TagKeyValue: ['user:Project$hireflow'] },
        CostTypes: Match.objectLike({ IncludeCredit: false }),
      }),
    });
  });

  it('sends from a verified domain with DKIM, and verifies the alert address as a sandbox recipient', () => {
    template.resourceCountIs('AWS::SES::EmailIdentity', 2);
    template.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'adarshdwivedi.site',
      DkimAttributes: { SigningEnabled: true },
    });
    template.hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: 'adarshdeveloper24@gmail.com' });
  });

  it('prints the three DKIM records to publish, so no one has to dig through the console', () => {
    const outputs = Object.keys(template.toJSON().Outputs as object);
    expect(outputs).toEqual(expect.arrayContaining(['DkimRecord1', 'DkimRecord2', 'DkimRecord3']));
  });

  it('keeps the first administrator on their own address, independent of the mail sender', () => {
    const moved = synth({ senderEmail: 'hello@example.org' });
    moved.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: JSON.stringify({ email: 'adarshdwivedi256@gmail.com' }),
      }),
    });
    moved.hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: 'example.org' });
  });
});

describe('configuration', () => {
  it('uses the overridden API domain everywhere it matters', () => {
    const t = synth({ apiDomain: 'api.example.org' });
    const json = JSON.stringify(t.toJSON());
    expect(json).toContain('https://api.example.org/health/ready');
    expect(json).toContain('api.example.org {');
    expect(json).not.toContain('api.adarshdwivedi.site');
  });

  it('tags everything with the project name, which the budget filters on', () => {
    const instance = Object.values(resources('AWS::EC2::Instance'))[0].Properties.Tags as {
      Key: string;
      Value: string;
    }[];
    expect(instance).toEqual(expect.arrayContaining([{ Key: 'Project', Value: 'hireflow' }]));
  });
});

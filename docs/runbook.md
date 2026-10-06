# Runbook

Everything here is a command you can paste. Region is `ap-south-1` throughout.

## First deployment

You need AWS credentials for the target account (`aws login`, or any profile), Node 22 and `jq`.

```bash
# 1. Build the Lambda bundles the stack uploads
cd lambdas && npm ci && npm run build && cd ..

# 2. Create the CDK toolkit stack once per account and region
cd infra && npm ci
npx cdk bootstrap aws://ACCOUNT_ID/ap-south-1

# 3. Deploy. Override anything in lib/config.ts with -c
npx cdk deploy -c apiDomain=api.example.com -c senderEmail=you@example.com -c alertEmail=you@example.com
```

The deploy prints the outputs you need. Then:

1. **DNS.** Create an `A` record for the API domain pointing at the `ApiPublicIp` output.
2. **Confirm email.** SES and SNS each send a confirmation email to the addresses you gave. Click the
   links, or nothing downstream can send or alert.
3. **Ship the API and the web app.**

```bash
scripts/deploy-api.sh --seed     # --seed adds three demo jobs, leave it off for a clean install
scripts/deploy-web.sh
```

4. **Collect the admin login.** It was generated into Secrets Manager, never printed in a log:

```bash
aws secretsmanager get-secret-value --secret-id "$(aws cloudformation describe-stacks \
  --stack-name HireflowStack --query "Stacks[0].Outputs[?OutputKey=='AdminSecretArn'].OutputValue" --output text)" \
  --query SecretString --output text
```

5. **Switch on continuous deployment.** Set these repository variables (they are identifiers, not secrets):
   `AWS_ROLE_ARN` (the `DeployRoleArn` output), `AWS_REGION`, `ARTIFACTS_BUCKET`, `INSTANCE_ID`,
   `WEB_BUCKET`, `DISTRIBUTION_ID` and `API_URL`. Until `AWS_ROLE_ARN` is set the deploy workflow skips itself.

```bash
gh variable set AWS_ROLE_ARN --body "arn:aws:iam::ACCOUNT_ID:role/hireflow-github-deploy"
```

6. **Count the cost by project.** Activate the `Project` cost allocation tag once, so the budget can filter on it:

```bash
aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=Project,Status=Active --region us-east-1
```

## Checking a deployment

Two scripts, from different angles. Both exit non-zero on any failure.

```bash
# From the outside, as a stranger sees it. No AWS credentials. Runs automatically after every deploy.
API_URL=https://api.example.com WEB_URL=https://dxxxx.cloudfront.net scripts/smoke.sh

# The whole candidate-to-email journey on real AWS: apply, upload, Bedrock screening, status change,
# SES email, re-apply, a bad file. Needs AWS credentials. Removes its own test data.
scripts/e2e-live.sh
```

`smoke.sh` checks TLS, security headers, CORS (the web origin is allowed, another is not), what anonymous callers
can and cannot reach, a clean 404 and 400, the CSP, caching headers, a private resume bucket, and that SSH and
the app port are closed. `e2e-live.sh` also proves S3 refuses an oversize file, a wrong content type and a
wrong key, and that a file which only claims to be a PDF ends as `failed` rather than retrying forever.

## Demo data

```bash
scripts/seed-remote.sh            # 4 recruiters, 13 jobs, 130 applications, each with a resume
scripts/seed-remote.sh --reset    # remove the demo data and add it fresh
```

The resumes are uploaded to S3, so the real pipeline scores them in the background (about 35 a minute at the
peak, Bedrock and Lambda concurrency permitting). Nothing is emailed. Everything uses `example.com` addresses.

## Deploying a change

Push to `main`. CI runs the four test suites and ShellCheck, and on success the deploy workflow
packages the API, ships it through SSM and publishes the web app. To do the same by hand:

```bash
scripts/deploy-api.sh && scripts/deploy-web.sh
```

`activate.sh` on the instance switches releases only after migrations succeed, and switches back if
`/health/ready` does not answer within 80 seconds. The restart itself leaves a gap of a few seconds, during which
the API answers `502` and the workers retry (see decision 14). Migrations only go forward, so a release that drops
or renames a column should be split in two: first stop using it, then remove it in a later release.

## Rolling back

An automatic rollback covers a release that does not start. For one that starts but is wrong, point
`current` at an earlier release (the five newest are kept) and restart:

```bash
aws ssm start-session --target "$INSTANCE_ID"     # needs the session-manager-plugin
sudo ls -t /opt/hireflow/releases
sudo ln -sfn /opt/hireflow/releases/PREVIOUS_ID /opt/hireflow/current && sudo systemctl restart hireflow-api
```

## Looking at the system

| I want to | Do this |
|---|---|
| See the dashboard | The `DashboardUrl` output (CloudWatch dashboard `HireFlow`) |
| Read API logs | `aws logs tail /hireflow/api --follow` |
| Read deploy logs | `aws logs tail /hireflow/deploy --follow` |
| Read a Lambda's logs | `aws logs tail /aws/lambda/<function name> --follow` (names are in the console) |
| Query one request | CloudWatch Logs Insights on `/hireflow/api`: `fields @timestamp, req.method, req.url, res.statusCode \| filter req.id = "..."` |
| Get a shell | `aws ssm start-session --target <InstanceId>` |
| Check the queues | `aws sqs get-queue-attributes --queue-url <url> --attribute-names All` |

Every API response carries an `x-request-id` header, and the same id appears in the log line.

## When an alarm fires

| Alarm | Meaning | First step |
|---|---|---|
| `hireflow-api-down` | The probe saw `/health/ready` fail twice, or saw nothing | Open the dashboard. If the instance is healthy, read `/hireflow/api`. A 503 from `/health/ready` means the database |
| `hireflow-api-5xx` | Five server errors in five minutes | Logs Insights on `/hireflow/api` filtered to `res.statusCode >= 500` |
| `hireflow-screening-dlq-not-empty` | A resume failed screening after 4 attempts | Read the screening Lambda's logs for the application id, fix the cause, then redrive from the DLQ in the SQS console |
| `hireflow-notifications-dlq-not-empty` | An email failed after 5 attempts | Read the notifier logs. A permanent SES error is logged and not retried, so this means something transient that kept failing |
| `hireflow-screening-backlog` | A resume has waited over 15 minutes | Check for Bedrock throttling in the screening logs |
| `hireflow-*-errors` | A Lambda threw | Its log group, same time window |
| `hireflow-instance-status-check` | EC2 reports the host impaired. It has been asked to recover | Wait ten minutes. The EIP and disk survive recovery. Redeploy if the API did not return on its own |
| `hireflow-instance-memory` | Over 85% memory for 15 minutes | `systemctl status hireflow-api` for restarts. The service is capped at 600 MB and restarts if it exceeds it |
| `hireflow-database-cpu` / `-storage-low` | Database CPU above 80% for 15 minutes, or under 3 GB free | Storage autoscales to 50 GB. For CPU, look at slow queries in the `postgresql` log group |

An alarm that returns to OK sends a second email, so a quiet inbox after a burst means it recovered.

## Secrets

JWT signing key, the Lambda-to-API key and the first admin password are generated by Secrets Manager
and never appear in the repository, the template or a log. To rotate the JWT key (this signs everyone
out), set a new value on the secret and redeploy to rewrite the environment file:

```bash
aws secretsmanager put-secret-value --secret-id <JwtSecretArn> --secret-string "$(openssl rand -base64 48 | tr -d '/+=')"
scripts/deploy-api.sh --skip-build
```

Rotating the Lambda-to-API key takes the same two steps for `InternalHmac`. Warm Lambdas still hold
the old value, so their first request after the rotation gets a `401`. The client reads the secret again on
a `401` and retries once, so nothing is lost and no restart is needed. A second `401` is treated as a real
rejection and surfaces as an error.

## SES

The account starts in the sandbox, so mail goes only to verified addresses. The notifier runs with
`NOTIFY_REDIRECT_TO` set to the alert address, which sends every candidate email there with the real
recipient in the subject. To send to real candidates, verify a sending domain, request production
access in the SES console and clear that variable in `lib/constructs/workers.ts`.

## Cost

Rates are the on-demand prices in the AWS Pricing API for Mumbai, read on 6 October 2026.

| Item | Rate | About per month |
|---|---|---|
| EC2 `t4g.micro` | $0.0056 / hour | $4.09 |
| RDS `db.t4g.micro`, PostgreSQL, single zone | $0.021 / hour | $15.33 |
| RDS storage, 20 GB gp3 | about $0.131 / GB-month | $2.62 |
| EBS, 16 GB gp3 | $0.0912 / GB-month | $1.46 |
| Public IPv4 address (the instance) | $0.005 / hour | $3.65 |
| Secrets Manager, 4 secrets | $0.40 each | $1.60 |
| CloudWatch alarms, 12 (the first 10 in an account are free) | $0.10 each | up to $1.20 |
| Lambda, SQS, EventBridge, SNS, S3, CloudFront at this volume | inside free tiers or cents | under $1 |
| Bedrock Nova Lite screening | about $0.00018 per one-page resume | cents |
| **Total** | | **about $30** |

The AWS Budget alarm in the stack watches gross spend (credits excluded) against $40 a month and emails at 80% actual and 100% forecast.

## Teardown

```bash
scripts/teardown.sh --yes
```

This destroys the stack: the database and its backups, every resume, the buckets, the queues and the
Lambdas. Nothing is kept, on purpose. Three things outlive it by design: the CDK toolkit stack (other
projects can use it), the SES identity verification emails already clicked, and Secrets Manager's
recovery window on the deleted secrets (no charge once deleted). To remove the toolkit stack as well,
delete the `CDKToolkit` stack in CloudFormation after emptying its bucket.

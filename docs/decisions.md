# Decisions

Each entry says what was chosen, why, and what it costs. Several are cheap-and-simple choices made
on purpose for a one-instance system, and the last column says when they would stop being right.

## 1. One EC2 instance for the API, not Lambda or Fargate

**Chosen:** a `t4g.micro` running Caddy and the NestJS API under systemd.

**Why:** the API holds a connection pool to PostgreSQL and runs an outbox relay every five seconds.
Both suit a process that stays up. On Lambda the pool would need RDS Proxy, and the relay would need
its own scheduled function. The instance costs $0.0056 an hour in Mumbai (about $4.09 a month).

**Cost of the choice:** one machine is one point of failure, and patching is on us. It is mitigated
with an alarm that asks EC2 to recover an impaired host, an external uptime probe, immutable releases
and an automatic rollback. It is not mitigated against a zone outage.

**Revisit when:** traffic needs a second instance. Then it becomes an Auto Scaling group behind an ALB,
and the outbox relay already copes with several instances (see 5).

## 2. Caddy on the instance, no load balancer

An Application Load Balancer is $0.0239 an hour in this region, about $17.45 a month, more than four
times the instance it would sit in front of. Caddy terminates TLS, obtains and renews the certificate
by itself, and proxies to the app on localhost. The certificate is requested only after the first
deploy, once DNS points at the instance, so failed attempts cannot trip Let's Encrypt's rate limit.

## 3. No NAT gateway

The instance sits in a public subnet and reaches AWS over the internet gateway, which is free. The
database sits in an isolated subnet with no route out at all. The Lambdas are not in the VPC. A NAT
gateway would have protected nothing that needed protecting and added $0.056 an hour in Mumbai (about $40.88 a month) plus $0.056 for every GB through it.

A test fails the build if a NAT gateway appears, or if any route to the internet leaves an isolated subnet.

## 4. PostgreSQL on RDS, single zone, hand-written migrations

`db.t4g.micro`, PostgreSQL 17, gp3, encrypted, seven days of backups, in a subnet group with no route out. Single zone
means a zone failure is an outage with a restore, not a failover. That is the honest trade at this price.

The schema is plain SQL in one migration file, not generated: `citext` for emails, enums, a generated
`tsvector` column with a GIN index for job search, partial indexes for the common queries and `CHECK`
constraints that state the business rules. TypeORM runs the file but does not own the schema.

The connection uses TLS with certificate verification switched off, so it is encrypted but does not
prove which server answered. Inside an isolated subnet that is acceptable. Pinning the RDS CA bundle
is on the roadmap.

## 5. A transactional outbox instead of calling SQS from the request

A status change must update the row and tell the candidate. Doing both in the request has two bad
outcomes: the update commits and the publish fails (a silent lost email), or the publish succeeds and
the update rolls back (an email about something that did not happen).

So the request writes the message to an `outbox` table in the same transaction as the update, and a
relay publishes it. The relay claims a batch with `FOR UPDATE SKIP LOCKED`, so two relays never take the
same rows, and it records `attempts` and `last_error` on failure.

The result is at-least-once delivery. See 6 for how that becomes one email.

## 6. At-least-once delivery, made effectively-once by a claim

SQS can deliver a message twice. Sending twice would mean two emails. Before it sends, the notifier asks
the API to claim the outbox id. The claim is a row in `notification_claims` with a unique key, so the
second attempt is refused. If SES fails after the claim, the Lambda deletes the claim so a retry can
send. If SES refuses permanently (a rejected address, say), the claim stays and nothing retries.

The remaining gap is a crash between a successful send and the end of the function, which can lose
the guarantee in one direction (no email) but never the other (two emails). That is the right way round.

## 7. HMAC between the Lambdas and the API

The API is a normal HTTPS service, not behind API Gateway, so there is no SigV4 to lean on. Each internal
request carries `HMAC-SHA256(secret, timestamp.METHOD.pathAndQuery.sha256(body))` and is rejected when
the timestamp is more than 300 seconds old. The secret lives in Secrets Manager and only the three
Lambdas that call the API can read it.

What this does not do: it limits replay to a five-minute window but does not stop a replay inside it.
That is acceptable because every internal endpoint is idempotent (see 6). Rotation is manual.

## 8. Resumes go straight from the browser to S3

The API hands out a presigned POST whose policy fixes the object key, the content type
(`application/pdf`) and a size between 1 byte and 5 MB. S3 enforces all three, so a tampered request
is refused by S3 itself, and the API never carries file bytes. Re-applying with the same email returns
`200` without a new ticket, so a second request cannot overwrite the first resume.

## 9. Keyset pagination

Lists are ordered by `(created_at DESC, id DESC)` and the cursor is the last row's pair. On a scratch
database with 200,000 applications for one job, page 1 took 0.2 ms either way, but a page 150,000 rows
deep took 0.22 ms with the cursor and 52 ms with `OFFSET`, about 235 times slower (median of 50 runs,
local PostgreSQL 18). The cursor query reads 4 buffers; `OFFSET` has to walk past every skipped row.
The cost is that you cannot jump to page 40, which a recruiter inbox never needs.

## 10. Screening with Bedrock Nova Lite

The PDF goes to the model as a document block, and the model is forced to answer through a typed tool
(`record_screening`: an integer score, a short summary, a list of skills), so there is no free text to
parse. The resume is treated as untrusted: the system prompt says so, and the output is clamped and
de-duplicated afterwards because a schema alone is not a guarantee.

Measured on three synthetic resumes against the seeded job: a strong match scored 90, an irrelevant
one scored 10, and a resume that told the model to ignore its instructions and output 100 scored 0.
(The later run on the deployed system, with 130 resumes, scored the injection resume 20, level with other weak ones. Both are small samples.)
That is three examples, not a benchmark, and the README says so. Each call took 2.3 to 3.2 seconds and used
about 2,275 input and 53 output tokens, roughly $0.00018.

Nova Lite is used rather than a Claude model by choice: it is cheap, accepts PDFs directly, and is
available through an Asia Pacific inference profile in the same region as everything else.

## 11. Deploying through SSM Run Command, authorised by OIDC

There is no SSH key and no port 22. CI uploads a release bundle to S3 and sends one command through
SSM Run Command, which unpacks it and runs `activate.sh`. CI authenticates with a GitHub OIDC token
that AWS exchanges for an hour of credentials, and the role is limited to the `main` branch of this
repository. The role can ship a release and a web build. It cannot change infrastructure or read a secret.

Infrastructure changes are applied by hand with `cdk deploy`, on purpose: the pipeline that ships code
should not be able to rewrite IAM.

## 12. SES stays in the sandbox, with a redirect

SES accounts start in a sandbox that only sends to verified addresses. Leaving it needs an
approval request, which is not worth it for a portfolio project. Instead the notifier has a redirect
mode: every email goes to one verified inbox with the real recipient in the subject
(`[to someone@example.com] ...`). The templates, the escaping and the claim logic all run exactly as in production.
Where that mail comes from turned out to matter, see decision 16.

## 13. CDK in TypeScript, with tests

The stack is written in the same language as the app and has 38 assertion tests: no NAT, no SSH, a
private database, IMDSv2, a dead-letter queue on every worker queue, one-model Bedrock access, one
repository and one branch in the OIDC trust, and an allowlist for every wildcard IAM resource. A
mutation check (adding a NAT gateway and opening port 22) makes three of them fail.

## 14. A restart is the price of one instance

Releasing means restarting the one API process, so every deploy has a gap of a few seconds when requests
get a `502` from Caddy. I saw it live: a push during a screening run made eight worker calls fail in the same
second. They were all retried through SQS and finished, which is exactly what the queue is for, but a person
loading the dashboard in that moment would see an error. A second instance behind a load balancer, drained one
at a time, would remove the gap. For a demo the cheaper answer is to accept it, keep every worker call
retryable, and run the smoke test after each deploy so a release that does not come back is caught at once.

## 15. The uptime probe starts before DNS exists, and that is on purpose

The probe is created with the stack, a few minutes before anyone can point a DNS name at the new server. For
that first stretch it reports the API as down, which is true. The one thing worth knowing: resolvers cache a
"no such name" answer for the zone's negative TTL (an hour here), so for up to an hour after the record appears
some probe runs still fail. It cost me an alarm and a confusing afternoon. The probe now logs the underlying
reason (`ENOTFOUND`, `ECONNRESET`, a timeout), so the next person can tell DNS from an app fault in one look.

## 16. Send from a domain you own, signed with DKIM

The first version sent as a `gmail.com` address through SES, which looks fine in the SES console and still fails
in practice. All nine messages the live system sent (eight application emails and one digest) arrived, and every
one was filed under **Spam**, because Gmail sees a Gmail sender that Google did not sign. The fix is the standard one:
verify `adarshdwivedi.site` in SES, publish the three DKIM CNAMEs, and send as `no-reply@adarshdwivedi.site`. The
first message sent after the records verified landed in the inbox. It costs nothing. The stack prints the three records
as outputs so nobody has to copy them out of the console, and the administrator's address became its own setting so
that moving the sender could not rewrite the admin secret.

## 17. An eight hour session, because there is no refresh flow

Access tokens lasted 15 minutes and there is no refresh token, so a recruiter was signed out in the middle of
reading a candidate. A refresh flow is the right fix and is on the roadmap, but it adds a token store, rotation and
theft detection. Until then the lifetime is set to a working day (`JWT_EXPIRES_IN=8h`) from the stack, which is a
conscious trade: a stolen token is valid for longer, and deactivating a user takes effect on their next request
because the API checks the account on every call.

## 18. One theme switch, set on the root element

The console used to be dark and the public site light, hard-coded per layout, so a recruiter flipping between the
two saw the page change colour. The theme is now one attribute on `<html>`, read by every token, so dialogs rendered
outside the app shell get the same colours and one button flips the lot. The first visit follows the operating
system. The sign-in page sets its own `data-theme="dark"`, which is how it stays identical in both modes.

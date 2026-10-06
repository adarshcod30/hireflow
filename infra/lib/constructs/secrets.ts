import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Secrets that never appear in the template, the repository or a log line.
 * Secrets Manager generates each value and only the instance role and the
 * Lambdas that need one can read it.
 *
 * No fixed secret names on purpose: a deleted secret keeps its name for the
 * recovery window, which would block a redeploy straight after a teardown.
 */
export class AppSecrets extends Construct {
  /** Signs candidate and recruiter JWTs. Only the API reads it. */
  readonly jwt: secretsmanager.Secret;
  /** Shared by the API and the Lambdas to sign internal requests. A raw string, not JSON. */
  readonly internalHmac: secretsmanager.Secret;
  /** The first admin account, created by the deploy script. JSON with email and password. */
  readonly admin: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: { adminEmail: string }) {
    super(scope, id);

    this.jwt = new secretsmanager.Secret(this, 'Jwt', {
      description: 'HireFlow: JWT signing key',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.internalHmac = new secretsmanager.Secret(this, 'InternalHmac', {
      description: 'HireFlow: HMAC key for requests from the Lambdas to the API',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.admin = new secretsmanager.Secret(this, 'Admin', {
      description: 'HireFlow: first admin login',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ email: props.adminEmail }),
        generateStringKey: 'password',
        passwordLength: 24,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}

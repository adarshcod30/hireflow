import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

const privateBucket = (overrides: s3.BucketProps = {}): s3.BucketProps => ({
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  ...overrides,
});

/** Resumes uploaded by candidates and the release bundles the deploy script ships to the instance. */
export class Storage extends Construct {
  readonly resumes: s3.Bucket;
  readonly artifacts: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.resumes = new s3.Bucket(
      this,
      'Resumes',
      privateBucket({
        lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      }),
    );

    this.artifacts = new s3.Bucket(
      this,
      'Artifacts',
      privateBucket({
        lifecycleRules: [{ prefix: 'releases/', expiration: Duration.days(30) }],
      }),
    );
  }
}

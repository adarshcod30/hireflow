import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Two subnets per zone and, on purpose, no NAT gateway.
 *
 * The API instance lives in a public subnet and reaches AWS services over the
 * internet gateway, which costs nothing. The database lives in an isolated
 * subnet with no route out at all. A NAT gateway would add about $33 a month
 * to protect a machine that already has to accept public traffic.
 */
export class Network extends Construct {
  readonly vpc: ec2.Vpc;
  /** The API instance. The database accepts connections from this group and nothing else. */
  readonly apiSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc: this.vpc,
      description: 'HireFlow API instance: HTTP and HTTPS in, no SSH (use Session Manager)',
      allowAllOutbound: true,
    });
    // Port 80 is needed for the certificate challenge and the redirect to HTTPS
    this.apiSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP, redirected to HTTPS by Caddy');
    this.apiSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
  }
}

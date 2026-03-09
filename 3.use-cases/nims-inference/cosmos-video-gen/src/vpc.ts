import {
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class VPCResources extends Construct {
  public readonly vpc: Vpc;
  public readonly apiLoadBalancerSecurityGroup: SecurityGroup;
  public readonly nimLoadBalancerSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new Vpc(this, 'VPC', {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: SubnetType.PUBLIC,
        },
      ],
      maxAzs: 3,
      natGateways: 0,
    });

    // Security group for API Load Balancer
    this.apiLoadBalancerSecurityGroup = new SecurityGroup(
      this,
      'ApiLoadBalancerSecurityGroup',
      {
        vpc: this.vpc,
        description: 'Security Group for API ALB',
      },
    );

    this.apiLoadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'Allow HTTPS traffic to API',
    );

    // Security group for NIM Load Balancer
    this.nimLoadBalancerSecurityGroup = new SecurityGroup(
      this,
      'NimLoadBalancerSecurityGroup',
      {
        vpc: this.vpc,
        description: 'Security Group for NIM ALB',
      },
    );

    this.nimLoadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'Allow HTTPS traffic to NIM',
    );
  }
}

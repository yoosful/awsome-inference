import { Duration, Stack } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  IVpc,
  Peer,
  Port,
  SecurityGroup,
} from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
} from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerCertificate,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

interface ECSResourcesProps {
  vpc: IVpc;
  apiCertificate: Certificate;
  hostedZone: IHostedZone;
  apiHostName: string;
  domainName: string;
  videoBucket: Bucket;
  nimEndpoint: string;
}

export class ECSResources extends Construct {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ECSResourcesProps) {
    super(scope, id);

    const cluster = new Cluster(this, 'ApiCluster', {
      vpc: props.vpc,
      clusterName: 'cosmos-video-api-cluster',
    });

    const taskDefinition = new FargateTaskDefinition(this, 'ApiTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    props.videoBucket.grantReadWrite(taskDefinition.taskRole);

    const container = taskDefinition.addContainer('ApiContainer', {
      image: ContainerImage.fromAsset(
        path.join(__dirname, 'resources', 'videoApiServer'),
      ),
      logging: LogDriver.awsLogs({
        streamPrefix: 'cosmos-video-api',
        logRetention: RetentionDays.ONE_WEEK,
      }),
      environment: {
        COSMOS_NIM_ENDPOINT: props.nimEndpoint,
        S3_BUCKET_NAME: props.videoBucket.bucketName,
        AWS_DEFAULT_REGION: Stack.of(this).region,
      },
    });

    container.addPortMappings({
      containerPort: 8000,
    });

    const fargateSecurityGroup = new SecurityGroup(
      this,
      'FargateSecurityGroup',
      {
        vpc: props.vpc,
        description: 'Security group for Fargate API service',
        allowAllOutbound: true,
      },
    );

    const albSecurityGroup = new SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for API ALB',
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'Allow HTTPS traffic',
    );

    fargateSecurityGroup.connections.allowFrom(
      albSecurityGroup,
      Port.tcp(8000),
    );

    const service = new FargateService(this, 'ApiService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [fargateSecurityGroup],
      assignPublicIp: true,
    });

    const loadBalancer = new ApplicationLoadBalancer(this, 'ApiLoadBalancer', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const listener = loadBalancer.addListener('HttpsListener', {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [
        ListenerCertificate.fromCertificateManager(props.apiCertificate),
      ],
    });

    listener.addTargets('ApiTarget', {
      port: 8000,
      protocol: ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    new ARecord(this, 'ApiARecord', {
      zone: props.hostedZone,
      recordName: props.apiHostName,
      target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
    });

    this.apiEndpoint = `https://${props.apiHostName}.${props.domainName}`;
  }
}

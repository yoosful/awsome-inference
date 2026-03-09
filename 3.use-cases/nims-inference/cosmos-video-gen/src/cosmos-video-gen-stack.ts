import { App, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { config } from 'dotenv';
import {
  VPCResources,
  CertificateResources,
  S3Resources,
  EC2Resources,
  ECSResources,
} from '.';

config();

interface CosmosVideoGenProps extends StackProps {
  domainName: string;
  apiHostName: string;
  nimHostName: string;
  instanceType: string;
  cosmosContainer: string;
  cosmosTag: string;
  videoRetentionDays: number;
}

export class CosmosVideoGenStack extends Stack {
  constructor(scope: Construct, id: string, props: CosmosVideoGenProps) {
    super(scope, id, props);

    // Validate required props
    if (!props.domainName) {
      throw new Error('Domain Name is required');
    }
    if (!props.apiHostName) {
      throw new Error('API Host Name is required');
    }
    if (!props.nimHostName) {
      throw new Error('NIM Host Name is required');
    }

    // Create VPC and networking
    const vpcResources = new VPCResources(this, 'VPCResources');

    // Create SSL certificates
    const certificateResources = new CertificateResources(
      this,
      'CertificateResources',
      {
        domainName: props.domainName,
        apiHostName: props.apiHostName,
        nimHostName: props.nimHostName,
      },
    );

    // Create S3 bucket for video storage
    const s3Resources = new S3Resources(this, 'S3Resources', {
      videoRetentionDays: props.videoRetentionDays,
    });

    // Create EC2 instance with Cosmos NIM
    const ec2Resources = new EC2Resources(this, 'EC2Resources', {
      vpc: vpcResources.vpc,
      nimCertificate: certificateResources.nimCertificate,
      hostedZone: certificateResources.hostedZone,
      nimHostName: props.nimHostName,
      domainName: props.domainName,
      instanceType: props.instanceType,
      cosmosContainer: props.cosmosContainer,
      cosmosTag: props.cosmosTag,
    });

    // Create ECS Fargate with API server
    const ecsResources = new ECSResources(this, 'ECSResources', {
      vpc: vpcResources.vpc,
      apiCertificate: certificateResources.apiCertificate,
      hostedZone: certificateResources.hostedZone,
      apiHostName: props.apiHostName,
      domainName: props.domainName,
      videoBucket: s3Resources.videoBucket,
      nimEndpoint: ec2Resources.nimEndpoint,
    });

    // Output important values
    new CfnOutput(this, 'ApiEndpoint', {
      value: ecsResources.apiEndpoint,
      description: 'API Server Endpoint',
    });

    new CfnOutput(this, 'NimEndpoint', {
      value: ec2Resources.nimEndpoint,
      description: 'Cosmos NIM Endpoint',
    });

    new CfnOutput(this, 'VideoBucket', {
      value: s3Resources.videoBucket.bucketName,
      description: 'S3 Bucket for Generated Videos',
    });
  }
}

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION || 'us-west-2',
};

const stackProps: CosmosVideoGenProps = {
  domainName: process.env.DOMAIN_NAME || '',
  apiHostName: process.env.API_HOST_NAME || 'cosmos-api',
  nimHostName: process.env.NIM_HOST_NAME || 'cosmos-nim',
  instanceType: process.env.INSTANCE_TYPE || 'g5.12xlarge',
  cosmosContainer:
    process.env.COSMOS_CONTAINER ||
    'nvcr.io/nim/nvidia/cosmos-predict1-7b-text2world',
  cosmosTag: process.env.COSMOS_TAG || 'latest',
  videoRetentionDays: parseInt(process.env.VIDEO_RETENTION_DAYS || '7', 10),
  env: devEnv,
};

const app = new App();

new CosmosVideoGenStack(app, 'CosmosVideoGenStack', stackProps);

app.synth();

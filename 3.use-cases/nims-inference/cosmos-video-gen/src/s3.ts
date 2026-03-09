import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import {
  Bucket,
  BlockPublicAccess,
  BucketEncryption,
  CorsRule,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface S3ResourcesProps {
  videoRetentionDays: number;
}

export class S3Resources extends Construct {
  public readonly videoBucket: Bucket;

  constructor(scope: Construct, id: string, props: S3ResourcesProps) {
    super(scope, id);

    // CORS configuration for video access from web browsers
    const corsRule: CorsRule = {
      allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 3000,
    };

    this.videoBucket = new Bucket(this, 'VideoBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      cors: [corsRule],
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(props.videoRetentionDays),
          id: 'DeleteOldVideos',
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}

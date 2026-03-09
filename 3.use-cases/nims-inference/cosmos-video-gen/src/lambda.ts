import { Duration } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class RegisterTargetsFunction extends Construct {
  public readonly registerTargets: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.registerTargets = new NodejsFunction(
      this,
      'RegisterTargetsFunction',
      {
        entry: path.join(
          __dirname,
          'resources',
          'registerTargets',
          'index.ts',
        ),
        handler: 'handler',
        runtime: Runtime.NODEJS_18_X,
        timeout: Duration.minutes(15),
        logRetention: RetentionDays.ONE_WEEK,
      },
    );

    this.registerTargets.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'autoscaling:DescribeAutoScalingGroups',
          'elasticloadbalancing:RegisterTargets',
          'elasticloadbalancing:DeregisterTargets',
        ],
        resources: ['*'],
      }),
    );
  }
}

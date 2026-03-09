import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
} from '@aws-sdk/client-auto-scaling';
import {
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';

const autoScalingClient = new AutoScalingClient({});
const elbClient = new ElasticLoadBalancingV2Client({});

interface CloudFormationCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    AutoScalingGroupName: string;
    TargetGroupArn: string;
  };
  PhysicalResourceId?: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
}

interface CloudFormationCustomResourceResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
}

export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceResponse> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { AutoScalingGroupName, TargetGroupArn } =
    event.ResourceProperties;

  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      // Get instances from Auto Scaling Group
      const describeCommand = new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [AutoScalingGroupName],
      });

      const asgResponse = await autoScalingClient.send(describeCommand);
      const instances =
        asgResponse.AutoScalingGroups?.[0]?.Instances?.map(
          (instance) => instance.InstanceId!,
        ) || [];

      console.log('Instances to register:', instances);

      if (instances.length > 0) {
        // Register instances with target group
        const registerCommand = new RegisterTargetsCommand({
          TargetGroupArn,
          Targets: instances.map((id) => ({ Id: id })),
        });

        await elbClient.send(registerCommand);
        console.log('Instances registered successfully');
      }
    } else if (event.RequestType === 'Delete') {
      // Get instances from Auto Scaling Group
      const describeCommand = new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [AutoScalingGroupName],
      });

      const asgResponse = await autoScalingClient.send(describeCommand);
      const instances =
        asgResponse.AutoScalingGroups?.[0]?.Instances?.map(
          (instance) => instance.InstanceId!,
        ) || [];

      console.log('Instances to deregister:', instances);

      if (instances.length > 0) {
        // Deregister instances from target group
        const deregisterCommand = new DeregisterTargetsCommand({
          TargetGroupArn,
          Targets: instances.map((id) => ({ Id: id })),
        });

        await elbClient.send(deregisterCommand);
        console.log('Instances deregistered successfully');
      }
    }

    return {
      Status: 'SUCCESS',
      PhysicalResourceId:
        event.PhysicalResourceId ||
        `${AutoScalingGroupName}-${TargetGroupArn}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      Status: 'FAILED',
      Reason: error instanceof Error ? error.message : 'Unknown error',
      PhysicalResourceId:
        event.PhysicalResourceId ||
        `${AutoScalingGroupName}-${TargetGroupArn}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  }
};

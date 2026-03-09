import { Stack, Fn, CustomResource, Duration } from 'aws-cdk-lib';
import { CfnAutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  IVpc,
  CfnLaunchTemplate,
} from 'aws-cdk-lib/aws-ec2';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  ListenerCertificate,
  TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {
  ManagedPolicy,
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
  InstanceProfile,
} from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { RegisterTargetsFunction } from './lambda';

interface EC2ResourcesProps {
  vpc: IVpc;
  nimCertificate: Certificate;
  hostedZone: IHostedZone;
  nimHostName: string;
  domainName: string;
  instanceType: string;
  cosmosContainer: string;
  cosmosTag: string;
}

export class EC2Resources extends Construct {
  public readonly autoScalingGroup: CfnAutoScalingGroup;
  public readonly targetGroup: ApplicationTargetGroup;
  public readonly loadBalancer: ApplicationLoadBalancer;
  public readonly nimEndpoint: string;

  constructor(scope: Construct, id: string, props: EC2ResourcesProps) {
    super(scope, id);

    // Create IAM Role for EC2
    const ec2Role = new Role(this, 'EC2Role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Add permission to access NGC API key secret
    ec2Role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${Stack.of(this).region}:${
            Stack.of(this).account
          }:secret:NGC_API_KEY-*`,
        ],
      }),
    );

    const instanceProfile = new InstanceProfile(this, 'EC2InstanceProfile', {
      role: ec2Role,
    });

    // Create Security Group for EC2
    const ec2SecurityGroup = new SecurityGroup(this, 'EC2SecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: 'Security group for Cosmos NIM EC2 instance',
    });

    ec2SecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(22),
      'Allow SSH access',
    );

    // Create ALB Security Group
    const albSecurityGroup = new SecurityGroup(this, 'ALBSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: 'Security group for Cosmos NIM ALB',
    });

    albSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'Allow HTTPS traffic',
    );

    // Allow traffic from ALB to EC2
    ec2SecurityGroup.connections.allowFrom(albSecurityGroup, Port.tcp(8000));

    // Create user data script
    const userData = UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      '',
      '# Enable exit on error and enable command printing for debugging',
      'set -ex',
      '',
      '# Function to log messages',
      'log_message() {',
      '    echo "$(date \'+%Y-%m-%d %H:%M:%S\') - $1" | tee -a /var/log/user-data.log',
      '}',
      '',
      'log_message "Starting user-data script execution"',
      '',
      '# Update and install dependencies',
      'log_message "Updating package lists and installing dependencies"',
      'apt-get update',
      'apt-get install -y gcc unzip python3-pip',
      '',
      '# Install AWS CLI',
      'log_message "Installing AWS CLI"',
      'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"',
      'unzip awscliv2.zip',
      './aws/install',
      '',
      '# Install NVIDIA drivers and CUDA toolkit',
      'log_message "Installing NVIDIA drivers and CUDA toolkit"',
      'wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb',
      'dpkg -i cuda-keyring_1.1-1_all.deb',
      'apt-get update',
      'apt-get install -y cuda-toolkit-12-6 nvidia-open',
      '',
      '# Install Docker',
      'log_message "Installing Docker"',
      'apt-get install -y apt-transport-https ca-certificates curl software-properties-common',
      'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add -',
      'add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"',
      'apt-get update',
      'apt-get install -y docker-ce docker-ce-cli containerd.io',
      '',
      '# Install NVIDIA Container Toolkit',
      'log_message "Installing NVIDIA Container Toolkit"',
      'curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg',
      'curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \\',
      "    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \\",
      '    tee /etc/apt/sources.list.d/nvidia-container-toolkit.list',
      'apt-get update',
      'apt-get install -y nvidia-container-toolkit',
      '',
      '# Configure Docker to use NVIDIA runtime',
      'log_message "Configuring Docker to use NVIDIA runtime"',
      'nvidia-ctk runtime configure --runtime=docker',
      'systemctl restart docker',
      '',
      '# Retrieve NGC API Key from Secrets Manager',
      'log_message "Retrieving NGC API Key from Secrets Manager"',
      `NGC_API_KEY=$(aws secretsmanager get-secret-value --secret-id NGC_API_KEY --query SecretString --output text --region ${
        Stack.of(this).region
      })`,
      '',
      '# Create cache directory',
      'log_message "Creating cache directory"',
      'mkdir -p /home/ubuntu/.cache/nim',
      'chown ubuntu:ubuntu /home/ubuntu/.cache/nim',
      '',
      '# Login to NGC',
      'log_message "Logging in to NGC"',
      "echo $NGC_API_KEY | docker login nvcr.io -u '$oauthtoken' --password-stdin",
      '',
      '# Run the Cosmos NIM container',
      'log_message "Running the Cosmos NIM container"',
      'docker run -d --restart unless-stopped --name=cosmos-predict1-text2world \\',
      '  --runtime=nvidia \\',
      '  --gpus \'"device=0,1,2,3"\' \\',
      '  -e NGC_API_KEY=$NGC_API_KEY \\',
      '  -v "/home/ubuntu/.cache/nim:/opt/nim/.cache" \\',
      '  -p 8000:8000 \\',
      `  ${props.cosmosContainer}:${props.cosmosTag}`,
      '',
      'log_message "Cosmos NIM container started successfully"',
      'log_message "Waiting for container to be ready (this may take 20-30 minutes)..."',
      '',
      '# Wait for the container to be ready',
      'for i in {1..120}; do',
      '    if curl -s http://localhost:8000/v1/health/ready > /dev/null 2>&1; then',
      '        log_message "Cosmos NIM is ready!"',
      '        break',
      '    fi',
      '    log_message "Waiting for Cosmos NIM to be ready... ($i/120)"',
      '    sleep 15',
      'done',
      '',
      'log_message "User-data script execution completed"',
    );

    // Create Launch Template
    const launchTemplate = new CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        imageId: MachineImage.lookup({
          name: 'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*',
          owners: ['099720109477'],
        }).getImage(this).imageId,
        instanceType: props.instanceType,
        iamInstanceProfile: {
          arn: instanceProfile.instanceProfileArn,
        },
        securityGroupIds: [ec2SecurityGroup.securityGroupId],
        userData: Fn.base64(userData.render()),
        blockDeviceMappings: [
          {
            deviceName: '/dev/sda1',
            ebs: {
              volumeSize: 200,
              volumeType: 'gp3',
              deleteOnTermination: true,
            },
          },
        ],
      },
    });

    // Create Auto Scaling Group
    this.autoScalingGroup = new CfnAutoScalingGroup(this, 'AutoScalingGroup', {
      minSize: '1',
      maxSize: '1',
      desiredCapacity: '1',
      vpcZoneIdentifier: props.vpc
        .selectSubnets({ subnetType: SubnetType.PUBLIC })
        .subnetIds,
      launchTemplate: {
        launchTemplateId: launchTemplate.ref,
        version: launchTemplate.attrLatestVersionNumber,
      },
      tags: [
        {
          key: 'Name',
          value: 'cosmos-nim-instance',
          propagateAtLaunch: true,
        },
      ],
    });

    // Create Application Load Balancer
    this.loadBalancer = new ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    // Create Target Group
    this.targetGroup = new ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.vpc,
      port: 8000,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.INSTANCE,
      healthCheck: {
        path: '/v1/health/ready',
        interval: Duration.seconds(60),
        timeout: Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });

    // Add HTTPS listener
    this.loadBalancer.addListener('HttpsListener', {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [ListenerCertificate.fromCertificateManager(props.nimCertificate)],
      defaultTargetGroups: [this.targetGroup],
    });

    // Create custom resource to register targets
    const registerTargetsFunction = new RegisterTargetsFunction(
      this,
      'RegisterTargetsFunction',
    );

    const provider = new Provider(this, 'RegisterTargetsProvider', {
      onEventHandler: registerTargetsFunction.registerTargets,
      logRetention: RetentionDays.ONE_DAY,
    });

    new CustomResource(this, 'RegisterTargetsCustomResource', {
      serviceToken: provider.serviceToken,
      properties: {
        AutoScalingGroupName: this.autoScalingGroup.ref,
        TargetGroupArn: this.targetGroup.targetGroupArn,
      },
    });

    // Create Route53 A record
    new ARecord(this, 'NimARecord', {
      zone: props.hostedZone,
      recordName: props.nimHostName,
      target: RecordTarget.fromAlias(
        new LoadBalancerTarget(this.loadBalancer),
      ),
    });

    // Store internal endpoint for API server
    this.nimEndpoint = `https://${props.nimHostName}.${props.domainName}`;
  }
}

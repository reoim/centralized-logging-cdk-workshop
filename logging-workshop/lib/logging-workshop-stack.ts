import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as logs from '@aws-cdk/aws-logs';
import * as cloudtrail from '@aws-cdk/aws-cloudtrail';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as cw_actions from '@aws-cdk/aws-cloudwatch-actions';
import * as sns from '@aws-cdk/aws-sns';
import * as subs from '@aws-cdk/aws-sns-subscriptions';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';

import fs = require('fs');

export class LoggingWorkshopStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // The code that defines your stack goes here
    
    // Create s3 bucket
    const logBucket = new s3.Bucket(this, 'LogBucket');
    
    // CloudFormation output for the bucket name
    new cdk.CfnOutput(this, 'LogBucketName', { value: logBucket.bucketName });
    
    // Create CloudtWatch LogGroup for ClouTrail log
    const trailLogGroup = new logs.LogGroup(this, 'TrailLog', {
      logGroupName: 'TrailLog',
      retention: logs.RetentionDays.THREE_MONTHS
    });
    
    // Send CloudTrail log to logGroup and bucket
    const trail = new cloudtrail.Trail(this, 'CloudTrail', {
      cloudWatchLogGroup:trailLogGroup,
      sendToCloudWatchLogs: true,
      bucket: logBucket,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true
    });
    
    // Create metric filter for console sign-in failure 
    const signInFailureMetricFilter = new logs.MetricFilter(this, 'SignInFailMetricFilter', {
        logGroup: trailLogGroup,
        metricNamespace: 'CloudTrailMetrics',
        metricName: 'ConsoleSigninFailureCount',
        filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.stringValue('$.eventName','=', 'ConsoleLogin'),
        logs.FilterPattern.stringValue('$.errorMessage','=', 'Failed authentication')),
        metricValue: '1'
    });
  
    // Create CloudWatch alarm for 3 times sign-in failure
    const alarm = new cloudwatch.Alarm(this, 'TrailAlarm', {
        alarmName:'ConsoleSignInFailures',
        metric: signInFailureMetricFilter.metric(),
        threshold: 3,
        evaluationPeriods: 1,
        statistic: 'Sum'
    });
    
    // Create SNS topic ans subscription
    const topic = new sns.Topic(this, 'TrailTopic');
    const email = this.node.tryGetContext('email');
    topic.addSubscription(new subs.EmailSubscription(email));
    
    // Add alarm action. (send it to SNS topic)
    alarm.addAlarmAction(new cw_actions.SnsAction(topic));
    
    
    // Create VPC
    const demoVpc = new ec2.Vpc(this, 'DemoVpc', {
        cidr: "192.168.0.0/16",
        subnetConfiguration: [
        {
            cidrMask: 24,
            name: 'webserver',
            subnetType: ec2.SubnetType.PUBLIC
        }]
    });
    
    // Create LogGroup for VPC Flow Log
    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogGroup', {
      logGroupName: 'VpcFlowLogGroup',
      retention: logs.RetentionDays.THREE_MONTHS
    });
    
    // Enalbe VPC flow log. Send it to the LogGroup
    demoVpc.addFlowLog('FlowLogToLogGroup', {
      trafficType: ec2.FlowLogTrafficType.ALL,
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup)
    });
    // Send the rejected flow log to s3 bucket
    demoVpc.addFlowLog('FlowLogToS3', {
      trafficType: ec2.FlowLogTrafficType.REJECT,
      destination: ec2.FlowLogDestination.toS3(logBucket)
    });
    
    
    // (Config) Install the unified CloudWatch agent by cfn-init
    const configInstallAgent = new ec2.InitConfig([
      ec2.InitPackage.rpm('https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm')
      ]);
      
    // (Config) Create file on the EC2 instance
    const configAgent = new ec2.InitConfig([
        ec2.InitFile.fromAsset(
          '/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json', // TargetFile path
          'resources/cfn-init/amazon-cloudwatch-agent.json' // Path of the asset
          )
      ]);
      
    // (Config) Start the unified CloudWatch agent
    const configStartAgent = new ec2.InitConfig([
        ec2.InitCommand.shellCommand('/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json')
      ])
    
    // Define config set with configs. When instance start, the cfninit will init the default config set. 
    const cfnInit = ec2.CloudFormationInit.fromConfigSets({
      configSets: {
        // Applies the configs below in this order
        default: [
          'installCwAgent',
          'configCwAgent', 
          'startAgent']
      },
      configs: {
        installCwAgent: configInstallAgent,
        configCwAgent: configAgent,
        startAgent: configStartAgent
      }
    })
    
    // IAM role
    const webServerRole = new iam.Role(this, 'WebServerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    // Add policy for cloudwatch log agent to the role
    webServerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));
    
    // Machine Image
    const amznLinux = ec2.MachineImage.latestAmazonLinux({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
    });
    
    // Create ec2 instance
    const demo_instance = new ec2.Instance(this, 'WebServerInstance', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      vpc: demoVpc,
      machineImage: amznLinux,
      instanceName: 'WebServer',
      role: webServerRole,
      init: cfnInit
    });
    
    // Add userdata (bootstrap)
    const bootstrap = fs.readFileSync('resources/userdata/bootstrap.sh', 'utf8');
    demo_instance.addUserData(bootstrap);  
    
    // Define security group
    const instance_sg = new ec2.SecurityGroup(this, 'WebServer', {
      vpc: demoVpc,
      allowAllOutbound:true,
      description: 'Webserver Security Group'
    })
    
    // Allow inbound traffic for SSH (port 22), and HTTP (port 80).
    instance_sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');
    instance_sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH from anywhere');
    
    // Add the security group to the instance
    demo_instance.addSecurityGroup(instance_sg);
    
      // Create log group for cloudwatch agent
    const webServerLogGroup = new logs.LogGroup(this, 'WebServerLogGroup', {
      logGroupName: 'WebServerLogGroup',
      retention: logs.RetentionDays.ONE_MONTH
    });
    
    // Create custom metric 
    const webServerMetricFilter = new logs.MetricFilter(this, 'WebServerMetricFilter', {
      logGroup: webServerLogGroup,
      metricNamespace: 'WebServerMetric',
      metricName: 'BytesTransferred',
      filterPattern: logs.FilterPattern.literal('[ip, id, user, timestamp, request, status_code, size]'),
      metricValue: '$size',
      defaultValue: 0
    });
    
    //expose a metric from the metric filter
    const webServerMetric = webServerMetricFilter.metric();    
  }
}

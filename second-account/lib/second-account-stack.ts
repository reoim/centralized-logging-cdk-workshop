import * as cdk from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigw from '@aws-cdk/aws-apigateway';
import * as logs from '@aws-cdk/aws-logs';

export class SecondAccountStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    
    // Defines an AWS Lambda resource
    const sample = new lambda.Function(this, 'SampleHandler', {
      runtime: lambda.Runtime.PYTHON_3_7,    // execution environment
      code: lambda.Code.fromAsset('resources/lambda'),  // code loaded from "resources/lambda" directory
      handler: 'sample.handler'                // file is "sample", function is "handler"
    });
    
    const apigwLogGroup = new logs.LogGroup(this, 'APIgatewayLogs', {
      logGroupName: 'APIgatewayLogs',
      retention: logs.RetentionDays.THREE_MONTHS
    });
    
    // Defines an API Gateway REST API resource backed by our "sample" function.
    const api = new apigw.LambdaRestApi(this, 'Endpoint', {
      handler: sample,
      deployOptions: {
        accessLogDestination: new apigw.LogGroupLogDestination(apigwLogGroup),
        accessLogFormat: apigw.AccessLogFormat.clf()
      }
    });
    
    //Metric for the number of client-side errors captured in a given period.
    //@default - sum over 5 minutes
    const clientErrorMetric = api.metricClientError();
  }
}

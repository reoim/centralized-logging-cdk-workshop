#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { LoggingWorkshopStack } from '../lib/logging-workshop-stack';

const envRegion = { region: 'us-east-1' };
const app = new cdk.App();
new LoggingWorkshopStack(app, 'LoggingWorkshopStack', { env: envRegion });

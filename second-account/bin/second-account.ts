#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SecondAccountStack } from '../lib/second-account-stack';

const envRegion = { region: 'us-east-2' };
const app = new cdk.App();
new SecondAccountStack(app, 'SecondAccountStack', { env: envRegion });

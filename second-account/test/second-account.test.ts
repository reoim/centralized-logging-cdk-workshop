import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as SecondAccount from '../lib/second-account-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new SecondAccount.SecondAccountStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});

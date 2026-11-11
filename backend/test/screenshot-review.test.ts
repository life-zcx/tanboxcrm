import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/lib/errors';
import { issueScreenshotReviewToken, verifyScreenshotReviewToken } from '../src/ai/screenshot-review';

test('review token binds the exact screenshot batch and expires', () => {
  const now=Date.now();
  const token=issueScreenshotReviewToken('original-batch',now);
  assert.doesNotThrow(()=>verifyScreenshotReviewToken(token,'original-batch',now+1000));
  assert.throws(()=>verifyScreenshotReviewToken(token,'different-batch',now+1000),AppError);
  assert.throws(()=>verifyScreenshotReviewToken(token,'original-batch',now+31*60*1000),AppError);
  assert.throws(()=>verifyScreenshotReviewToken(token.slice(0,-1)+(token.endsWith('0')?'1':'0'),'original-batch',now+1000),AppError);
});

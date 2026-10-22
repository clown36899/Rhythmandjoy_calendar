import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCancellationRefund, verifyCancellationRefund, readCancellationRefundText, waitForCancellationRefund } from './cancellation-refund.mjs';

const refund = (mode, amount = null) => ({ mode, amount, expectedPaidAmount: 12000, currency: 'KRW' });
const money = (amount, paid = 12000) => ({ paidAmount: paid, refundAmount: amount, retainedAmount: paid - amount });

test('legacy queued/automatic tasks keep their behavior; new monetary contracts reject malformed amounts', () => {
  assert.equal(normalizeCancellationRefund(undefined), null);
  for (const value of [false, [], {}, refund('unknown', 0), refund('none', 1), refund('full', 0), refund('custom', -1), refund('custom', 12001), refund('custom', 0.5), refund('custom', '0'), refund('policy', 0), { ...refund('none', 0), expectedPaidAmount: 0 }, { ...refund('none', 0), currency: 'USD' }]) {
    assert.throws(() => normalizeCancellationRefund(value));
  }
});

test('refund selection checks full, zero, custom, and policy against the actual paid amount', () => {
  for (const [mode, amount] of [['full', 12000], ['none', 0], ['custom', 3500]]) {
    assert.equal(verifyCancellationRefund(refund(mode, amount), money(amount)).ok, true);
    assert.equal(verifyCancellationRefund(refund(mode, amount), money(amount === 0 ? 12000 : 0)).ok, false);
  }
  assert.equal(verifyCancellationRefund(refund('policy'), money(6000), 6000).ok, true);
  assert.equal(verifyCancellationRefund(refund('policy'), money(0), 6000).ok, false);
  assert.equal(verifyCancellationRefund(refund('none', 0), money(0, 6000)).ok, false);
  for (const value of [null, {}, money(null), { ...money(0), retainedAmount: 0 }, { ...money(0), refundAmount: '0' }]) {
    assert.equal(verifyCancellationRefund(refund('none', 0), value).ok, false);
  }
});

test('reads the native cancellation labels and never equates missing or ambiguous text with zero', () => {
  assert.deepEqual(readCancellationRefundText('결제금액\n12,000원\n환불금액\n0원(0%)\n취소수수료\n12,000원'), money(0));
  assert.deepEqual(readCancellationRefundText('결제금액: 12,000원\n취소수수료: 6,000원\n환불금액: 6,000원(D-1일전 50% 환불)'), money(6000));
  assert.equal(readCancellationRefundText('환불금액: -1원').refundAmount, null);
  assert.equal(readCancellationRefundText('환불금액: 0원 환불금액: 12,000원').refundAmount, null);
  assert.equal(readCancellationRefundText('환불금액 계산 중').refundAmount, null);
});

test('waits for native recalculation and blocks mismatches instead of choosing a full refund', async () => {
  const rendered = [money(12000), money(0)];
  assert.equal((await waitForCancellationRefund(() => rendered.shift(), refund('none', 0))).refundAmount, 0);
  await assert.rejects(waitForCancellationRefund(() => money(12000), refund('none', 0), null, 0), /다릅니다/);
  await assert.rejects(waitForCancellationRefund(() => money(6000), refund('policy'), 0, 0), /다릅니다/);
});

// One monetary contract shared by both platform adapters and recovery.
// Stored inside the existing cancellation task payload; no separate queue.
export function normalizeCancellationRefund(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['full', 'none', 'custom', 'policy'].includes(value.mode)
    || value.currency !== 'KRW'
    || !Number.isSafeInteger(value.expectedPaidAmount) || value.expectedPaidAmount <= 0) {
    throw new Error('취소 작업의 환불 설정이 올바르지 않습니다.');
  }
  const { mode, amount, expectedPaidAmount, currency } = value;
  if (mode === 'policy' ? amount !== null
    : !Number.isSafeInteger(amount) || amount < 0 || amount > expectedPaidAmount
      || (mode === 'full' && amount !== expectedPaidAmount) || (mode === 'none' && amount !== 0)) {
    throw new Error('취소 작업의 환불금액이 결제금액 또는 환불 방식과 맞지 않습니다.');
  }
  return { mode, amount, expectedPaidAmount, currency };
}

export function verifyCancellationRefund(request, amounts, expectedPolicyAmount = null) {
  const refund = normalizeCancellationRefund(request);
  if (!refund) return null;
  const paid = amounts?.paidAmount;
  const amount = amounts?.refundAmount;
  const retained = amounts?.retainedAmount;
  let reason = '';
  if (![paid, amount, retained].every(Number.isSafeInteger) || paid <= 0 || amount < 0 || retained < 0 || paid !== amount + retained) {
    reason = '플랫폼의 결제·환불·위약금액을 정확히 확인할 수 없습니다.';
  } else if (paid !== refund.expectedPaidAmount) {
    reason = '플랫폼 결제금액이 취소 요청 당시 금액과 다릅니다.';
  } else if (refund.mode !== 'policy' && amount !== refund.amount) {
    reason = `요청한 환불액 ${refund.amount}원과 플랫폼 환불액 ${amount}원이 다릅니다.`;
  } else if (refund.mode === 'policy' && expectedPolicyAmount !== null && amount !== expectedPolicyAmount) {
    reason = '플랫폼 환불액이 취소 직전에 확인한 금액과 다릅니다.';
  }
  return { ok: !reason, reason, mode: refund.mode, paidAmount: paid, refundAmount: amount, retainedAmount: retained };
}

export function readCancellationRefundText(text) {
  const read = (label) => {
    const matches = [...String(text || '').matchAll(new RegExp(`${label}\\s*[:：]?\\s*([0-9][0-9,]*)\\s*원`, 'g'))];
    if (matches.length !== 1) return null;
    const number = Number(matches[0][1].replaceAll(',', ''));
    return Number.isSafeInteger(number) ? number : null;
  };
  return { paidAmount: read('결제금액'), refundAmount: read('환불금액'), retainedAmount: read('취소수수료') };
}

export async function waitForCancellationRefund(readAmounts, request, expectedPolicyAmount = null, timeoutMs = 4000) {
  const started = Date.now();
  let verification;
  do {
    verification = verifyCancellationRefund(request, await readAmounts(), expectedPolicyAmount);
    if (verification?.ok) return verification;
    if (Date.now() - started >= timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
  throw new Error(verification?.reason || '환불금액을 확인하지 못했습니다.');
}

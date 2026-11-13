function roundHalfUp(numerator, denominator) {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

function checkoutTotal(order) {
  const subtotalCents = order.lines
    .map((line) => line.unitPriceCents * line.quantity)
    .reduce((sum, cents) => sum + cents, 0);
  const discountCents = roundHalfUp(subtotalCents * order.discountPercent, 100);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = roundHalfUp(taxableCents * order.taxRateBps, 10000);
  const qualifiesForFreeShipping = taxableCents >= order.freeShippingThresholdCents;
  const shippingCents = qualifiesForFreeShipping ? 0 : order.shippingCents;
  return {
    subtotalCents,
    discountCents,
    taxCents,
    shippingCents,
    totalCents: taxableCents + taxCents + shippingCents,
  };
}

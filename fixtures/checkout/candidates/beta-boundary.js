function checkoutTotal(order) {
  const subtotalCents = order.lines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  );
  const discountCents = Math.floor((subtotalCents * order.discountPercent + 50) / 100);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.floor((taxableCents * order.taxRateBps + 5000) / 10000);
  const shippingCents = taxableCents > order.freeShippingThresholdCents ? 0 : order.shippingCents;
  return {
    subtotalCents,
    discountCents,
    taxCents,
    shippingCents,
    totalCents: taxableCents + taxCents + shippingCents,
  };
}

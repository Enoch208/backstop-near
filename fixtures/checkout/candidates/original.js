function checkoutTotal(order) {
  const subtotal = order.lines.reduce(
    (sum, line) => sum + (line.unitPriceCents / 100) * line.quantity,
    0,
  );
  const tax = subtotal * (order.taxRateBps / 10000);
  const discount = (subtotal + tax) * (order.discountPercent / 100);
  const taxable = subtotal - discount;
  const shipping = taxable > order.freeShippingThresholdCents / 100 ? 0 : order.shippingCents / 100;
  return {
    subtotalCents: Math.round(subtotal * 100),
    discountCents: Math.round(discount * 100),
    taxCents: Math.round(tax * 100),
    shippingCents: Math.round(shipping * 100),
    totalCents: Math.round((taxable + tax + shipping) * 100),
  };
}

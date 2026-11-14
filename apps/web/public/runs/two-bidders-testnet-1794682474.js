function mergeIntervals(ranges) {
  const sorted = ranges
    .filter(([start, end]) => start < end)
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result = [];
  for (const [start, end] of sorted) {
    const last = result[result.length - 1];
    if (last && start < last[1]) {
      if (end > last[1]) last[1] = end;
    } else {
      result.push([start, end]);
    }
  }
  return result;
}

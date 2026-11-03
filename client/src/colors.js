// A stable color per user, so someone's cursor is the same color everywhere.
const PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

export function colorFor(id) {
  return PALETTE[Math.abs(Number(id) || 0) % PALETTE.length];
}

export const CEREMONY_ESTIMATES = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;

export type CeremonyEstimate = (typeof CEREMONY_ESTIMATES)[number];

export function isCeremonyEstimate(estimate: number): estimate is CeremonyEstimate {
  return CEREMONY_ESTIMATES.includes(estimate as CeremonyEstimate);
}

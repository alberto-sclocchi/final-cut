// Counts the votes in one matchup and picks the winner.
// A tie goes to the movie with more hype points, then to a random pick.
export function pickMatchupWinner(
  aId: string,
  bId: string,
  picks: string[],
  hypePoints: Record<string, number>,
  random: () => number = Math.random
): string {
  let votesA = 0;
  let votesB = 0;

  for (const pick of picks) {
    if (pick === aId) votesA++;
    if (pick === bId) votesB++;
  }

  if (votesA > votesB) return aId;
  if (votesB > votesA) return bId;

  // tied on votes, so use the hype points
  const pointsA = hypePoints[aId] ?? 0;
  const pointsB = hypePoints[bId] ?? 0;
  if (pointsA > pointsB) return aId;
  if (pointsB > pointsA) return bId;

  // still tied, so pick randomly
  return random() < 0.5 ? aId : bId;
}

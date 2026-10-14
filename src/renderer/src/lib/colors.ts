const HUES = [262, 199, 152, 38, 330, 12, 90, 225]

export function colorForIndex(i: number): string {
  return `hsl(${HUES[i % HUES.length]} 70% 60%)`
}

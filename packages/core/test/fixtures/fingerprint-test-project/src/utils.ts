// Utility functions for testing
export function capitalize(str: string): string {
  if (str.length === 0) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function sum(numbers: number[]): number {
  return numbers.reduce((acc, n) => acc + n, 0)
}

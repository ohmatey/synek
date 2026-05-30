// Tiny class-name concatenator. Filters falsy.
export function cn(...inputs: (string | false | null | undefined | 0)[]): string {
  return inputs.filter(Boolean).join(' ')
}

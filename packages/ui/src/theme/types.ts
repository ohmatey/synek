// User preference. 'system' resolves to light or dark at runtime.
export type Theme = 'light' | 'dark' | 'system'

// Concrete theme actually applied. Always light or dark.
export type ResolvedTheme = 'light' | 'dark'

export type Severity = 'warning' | 'error'
export interface Diagnostic { severity: Severity; code: string; path: string[]; message: string }
export type ParseResult<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] }

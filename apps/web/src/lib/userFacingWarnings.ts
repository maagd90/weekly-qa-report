const HIDDEN_TECHNICAL_WARNING_PATTERNS = [
  /^\[technical\]/i,
  /^\d+:\s*missing submitted date,\s*skipped$/i,
  /connection skipped because selected project .* does not match configured project/i,
];

/**
 * Removes row-level parser diagnostics that are useful in logs/metadata but
 * disruptive and unactionable in stakeholder-facing screens. Operational
 * warnings such as unavailable integrations remain visible.
 */
export function userFacingWarnings(messages: readonly string[] | null | undefined): string[] {
  return [...new Set((messages || []).map((message) => message.trim()).filter(Boolean))]
    .filter((message) => !HIDDEN_TECHNICAL_WARNING_PATTERNS.some((pattern) => pattern.test(message)));
}

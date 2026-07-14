/**
 * Produces a safe, useful message from an unknown thrown value.
 *
 * JavaScript permits throwing strings, objects, `null`, and other non-Error
 * values. This helper preserves normal `Error.message` values, converts other
 * values with `String`, and uses the fallback when the result is empty.
 *
 * @param error Unknown value caught from an operation.
 * @param fallback Message used when the thrown value has no useful text.
 * @returns A non-empty message suitable for logs and API error responses.
 */
export function toErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || fallback;
}

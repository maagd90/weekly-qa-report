import fs from 'fs';

/**
 * Reads and parses a UTF-8 JSON file into the caller's declared type.
 *
 * This helper deliberately returns `null` for a missing, unreadable, or
 * malformed file. Runtime cache files are optional and recoverable; callers
 * can rebuild them instead of wrapping every read in duplicate try/catch code.
 * The generic type documents the expected shape but does not perform runtime
 * schema validation.
 *
 * @typeParam T Expected parsed JSON shape.
 * @param filePath Absolute or process-relative file path.
 * @returns Parsed data, or `null` when the file cannot be read and parsed.
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Serializes a value as human-readable UTF-8 JSON.
 *
 * The function does not create the parent directory. Callers must establish
 * their runtime directories before writing so directory failures remain clear.
 * Serialization and filesystem errors are allowed to propagate to the caller.
 *
 * @param filePath Destination file path.
 * @param value JSON-serializable value to persist.
 */
export function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

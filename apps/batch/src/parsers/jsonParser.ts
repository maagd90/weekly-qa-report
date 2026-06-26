import type { Dataset } from '../types/dataset';
import { emptyDataset } from '../types/dataset';

export function parseJsonBuffer(buffer: Buffer, sourceFile: string): Dataset | { headers: string[]; rows: Record<string, unknown>[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch (e) {
    const ds = emptyDataset();
    ds.meta.sourceFiles = [sourceFile];
    ds.meta.warnings.push(`Invalid JSON: ${(e as Error).message}`);
    return ds;
  }

  // Full dataset export shape
  if (parsed && typeof parsed === 'object' && 'weeklyLog' in (parsed as object)) {
    const ds = parsed as Dataset;
    ds.meta = ds.meta || emptyDataset().meta;
    ds.meta.sourceFiles = [sourceFile];
    ds.meta.formats = [...(ds.meta.formats || []), 'json-dataset'];
    return ds;
  }

  // JIRA REST API issues array
  const obj = parsed as Record<string, unknown>;
  let issues: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    issues = parsed as Record<string, unknown>[];
  } else if (Array.isArray(obj.issues)) {
    issues = obj.issues as Record<string, unknown>[];
  } else if (Array.isArray(obj.worklog)) {
    return { headers: Object.keys((obj.worklog as Record<string, unknown>[])[0] || {}), rows: obj.worklog as Record<string, unknown>[] };
  }

  if (issues.length > 0) {
    const rows = issues.map((issue) => {
      const fields = (issue.fields || issue) as Record<string, unknown>;
      return {
        'Issue key': issue.key || fields.key,
        Summary: fields.summary,
        Assignee: typeof fields.assignee === 'object' && fields.assignee ? (fields.assignee as { displayName?: string }).displayName : fields.assignee,
        Status: typeof fields.status === 'object' && fields.status ? (fields.status as { name?: string }).name : fields.status,
        Priority: typeof fields.priority === 'object' && fields.priority ? (fields.priority as { name?: string }).name : fields.priority,
        Created: fields.created,
        Resolved: fields.resolutiondate || fields.resolved,
      };
    });
    return { headers: Object.keys(rows[0] || {}), rows };
  }

  // Generic array of objects
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
    const rows = parsed as Record<string, unknown>[];
    return { headers: Object.keys(rows[0]), rows };
  }

  const ds = emptyDataset();
  ds.meta.sourceFiles = [sourceFile];
  ds.meta.warnings.push('JSON format not recognized');
  return ds;
}

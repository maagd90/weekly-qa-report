/** Minimal JIRA RSS/XML item extraction */
export function parseXmlBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const text = buffer.toString('utf8');
  const rows: Record<string, unknown>[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    rows.push({
      'Issue key': get('key') || get('title').split(' ')[0],
      Summary: get('summary') || get('title'),
      Assignee: get('assignee'),
      Status: get('status'),
      Priority: get('priority'),
      Created: get('created'),
    });
  }
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

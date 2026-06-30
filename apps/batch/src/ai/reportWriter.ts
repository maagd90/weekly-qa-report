import Anthropic from '@anthropic-ai/sdk';
import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';

const DEFAULT_REPORT_MODEL = 'claude-sonnet-4-6';

export const SUMMARY_MIN_CHARS = 250;
export const SUMMARY_MAX_CHARS = 500;

const SUMMARY_FORMAT = `Output ONLY a "## Summary" heading followed by the summary text (no other sections).
The summary MUST be between ${SUMMARY_MIN_CHARS} and ${SUMMARY_MAX_CHARS} characters including spaces.
Write 2–4 precise sentences: key metrics, main risk, UAT status if available, and one clear takeaway. No filler, no bullet lists, no tables.`;

const SYSTEM = `You are a QA metrics report writer. You MUST call the provided tools to get real numbers.
Never invent or estimate metrics. If a tool returns empty data, state that briefly using real wording.
${SUMMARY_FORMAT}`;

function reportPrompt(reportType: ReportType, filter: FilterParams): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  const focus: Record<ReportType, string> = {
    full: 'Query execution mix, UAT, testers, cycles, and defects, then distill into the summary.',
    executive: 'Query result mix, UAT summary, and tester stats, then distill into the summary.',
    testers: 'Query tester stats and execution volume, then distill into the summary.',
    cycles: 'Query cycle health and coverage gaps, then distill into the summary.',
  };
  return `Generate a ${reportType} QA report for ${scope}. ${focus[reportType]} ${SUMMARY_FORMAT}`;
}

function plainTextLength(text: string): number {
  return text
    .replace(/^#+\s*[^\n]*\n?/gm, '')
    .replace(/[*_`#[\]()>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function extractSummaryBody(markdown: string): string {
  const match = markdown.match(/##\s*Summary\s*\n+([\s\S]*)/i);
  if (match) return match[1].trim();
  return markdown.replace(/^#+\s*[^\n]*\n?/gm, '').trim();
}

function truncateToMax(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  const slice = normalized.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > SUMMARY_MIN_CHARS ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[.,;:\s]+$/, '')}.`;
}

function padToMin(text: string, min: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length >= min) return normalized;
  const pad = ' Review charts for full metrics and trends in this period.';
  const combined = `${normalized}${pad}`.replace(/\s+/g, ' ').trim();
  if (combined.length >= min) return combined.slice(0, SUMMARY_MAX_CHARS);
  return combined;
}

export function normalizeReportSummary(markdown: string): string {
  let body = extractSummaryBody(markdown);
  if (!body) body = 'No summary generated for this period.';

  if (plainTextLength(body) > SUMMARY_MAX_CHARS) {
    body = truncateToMax(body, SUMMARY_MAX_CHARS);
  }
  if (plainTextLength(body) < SUMMARY_MIN_CHARS) {
    body = padToMin(body, SUMMARY_MIN_CHARS);
    if (plainTextLength(body) > SUMMARY_MAX_CHARS) {
      body = truncateToMax(body, SUMMARY_MAX_CHARS);
    }
  }

  return `## Summary\n\n${body.trim()}`;
}

export async function generateReportFromDataset(
  dataset: Dataset,
  params: GenerateParams,
  apiKey: string,
  filter: FilterParams,
): Promise<{ markdown: string; toolCalls: { toolName: string; rowCount: number }[] }> {
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_REPORT_MODEL;
  const toolCalls: { toolName: string; rowCount: number }[] = [];

  const tools = AI_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] },
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: reportPrompt(params.reportType, filter) },
  ];

  let markdown = '';
  for (let round = 0; round < 6; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM,
      tools,
      messages,
    });

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUseBlocks.length) {
      for (const block of response.content) {
        if (block.type === 'text') markdown += block.text;
      }
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUseBlocks) {
      const result = executeTool(tu.name, dataset, filter);
      const rowCount = Array.isArray(result) ? result.length : 1;
      toolCalls.push({ toolName: tu.name, rowCount });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const raw = markdown.trim() || 'No content generated for this period.';
  return { markdown: normalizeReportSummary(raw), toolCalls };
}

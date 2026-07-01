import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { loadReportConfig } from '../config/loadReportConfig';
import { AI_TOOLS, executeTool } from './datasetTools';
import { getAnthropicFetchOptions } from './proxy';

export const SUMMARY_MIN_CHARS = 280;
export const SUMMARY_MAX_CHARS = 720;

const SUMMARY_FORMAT = `Output ONLY a "## Summary" heading followed by the summary body (no other sections).
The summary body MUST be between ${SUMMARY_MIN_CHARS} and ${SUMMARY_MAX_CHARS} characters (plain text, excluding markdown markers).
Format as 4–5 bullet points using markdown "- " lines. Each bullet MUST start with a bold label and colon, e.g. "- **Execution quality:** …"
Write for a VP audience: outcome-first, confident tone, no run-on sentences, no filler ("logged", "holds", "raised" stacks).
Cover: execution/pass rate, highest-risk cycle, defect backlog ownership, UAT closure posture, and one clear recommendation.
Use exact numbers from tools. Do not invent metrics.`;

const SYSTEM = `You are a senior QA director drafting a weekly brief for the VP of Engineering.
You MUST call the provided tools to get real numbers — never invent or estimate metrics.
If a tool returns empty data, state that briefly in one bullet.
${SUMMARY_FORMAT}`;

function reportPrompt(reportType: ReportType, filter: FilterParams): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  const focus: Record<ReportType, string> = {
    full: 'Query execution mix, cycle health, defect backlog, and UAT summary. Frame release readiness and top risks for executive review.',
    executive: 'Query result mix, UAT summary, and cycle health. Lead with whether the period is release-ready.',
    testers: 'Call get_tester_stats. Bullets on team coverage, volume leader, pass-rate spread, and one coaching or capacity note. Use real names.',
    cycles: 'Call get_cycle_health. Bullets on at-risk cycles, coverage gaps, pass-rate outliers, and recommended focus.',
  };
  return `Generate a ${reportType} QA report for ${scope}. ${focus[reportType]} ${SUMMARY_FORMAT}`;
}

function plainTextLength(text: string): number {
  return text
    .replace(/^#+\s*[^\n]*\n?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/[*_`#[\]()>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function plainTextLen(text: string): number {
  return plainTextLength(text);
}

function extractSummaryBody(markdown: string): string {
  const match = markdown.match(/##\s*Summary\s*\n+([\s\S]*)/i);
  if (match) return match[1].trim();
  return markdown.replace(/^#+\s*[^\n]*\n?/gm, '').trim();
}

function extractBullets(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l));
}

function truncateParagraph(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  const slice = normalized.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > SUMMARY_MIN_CHARS ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[.,;:\s]+$/, '')}.`;
}

function truncateBullets(bullets: string[], maxChars: number): string {
  const kept: string[] = [];
  for (const bullet of bullets) {
    const candidate = kept.length ? `${kept.join('\n')}\n${bullet}` : bullet;
    if (plainTextLen(candidate) > maxChars && kept.length >= 3) break;
    kept.push(bullet);
  }
  if (kept.length) return kept.join('\n');
  return truncateParagraph(bullets[0] ?? '', maxChars);
}

function padToMin(body: string, min: number): string {
  const bullets = extractBullets(body);
  if (bullets.length) {
    const extra = '- **Detail:** See attached metrics for full period breakdown.';
    const combined = `${body.trim()}\n${extra}`;
    if (plainTextLen(combined) >= min) return combined;
  }
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length >= min) return normalized;
  return `${normalized}\n\n- **Note:** Refer to the dashboard charts for complete metrics in this period.`.trim();
}

export function normalizeReportSummary(markdown: string): string {
  let body = extractSummaryBody(markdown);
  if (!body) body = '- **Status:** No summary generated for this period.';

  const bullets = extractBullets(body);
  if (bullets.length >= 2) {
    body = truncateBullets(bullets, SUMMARY_MAX_CHARS);
  } else if (plainTextLen(body) > SUMMARY_MAX_CHARS) {
    body = truncateParagraph(body, SUMMARY_MAX_CHARS);
  }

  if (plainTextLen(body) < SUMMARY_MIN_CHARS) {
    body = padToMin(body, SUMMARY_MIN_CHARS);
    if (plainTextLen(body) > SUMMARY_MAX_CHARS) {
      body = extractBullets(body).length >= 2
        ? truncateBullets(extractBullets(body), SUMMARY_MAX_CHARS)
        : truncateParagraph(body, SUMMARY_MAX_CHARS);
    }
  }

  return `## Summary\n\n${body.trim()}`;
}

function resolveConfigDir(params: GenerateParams): string {
  const root = path.resolve(__dirname, '../../..');
  return params.configDir || process.env.CONFIG_DIR || path.join(root, 'config');
}

export async function generateReportFromDataset(
  dataset: Dataset,
  params: GenerateParams,
  apiKey: string,
  filter: FilterParams,
): Promise<{ markdown: string; toolCalls: { toolName: string; rowCount: number }[] }> {
  const reportCfg = loadReportConfig(resolveConfigDir(params));
  const fetchOptions = getAnthropicFetchOptions();
  const client = new Anthropic({
    apiKey,
    ...(fetchOptions ? { fetchOptions } : {}),
  });
  const model = reportCfg.model;
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
      max_tokens: reportCfg.maxTokens,
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

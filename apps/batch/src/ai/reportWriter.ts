import Anthropic from '@anthropic-ai/sdk';
import type { Dataset, FilterParams, GenerateParams, ReportType } from '../types/dataset';
import { AI_TOOLS, executeTool } from './datasetTools';

const DEFAULT_REPORT_MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are a QA metrics report writer. You MUST call the provided tools to get real numbers.
Never invent or estimate metrics. If a tool returns empty data, say "No data available for this period."
Write clear markdown with headings. Include only facts from tool results.`;

function reportPrompt(reportType: ReportType, filter: FilterParams): string {
  const scope = `${filter.startDate || 'all'} to ${filter.endDate || 'all'}`;
  const typeGuide: Record<ReportType, string> = {
    full: 'Write a full report: executive summary, execution overview, testers, cycles, story/bug split, traceability, defect backlog.',
    executive: 'Write a 1-page executive summary only.',
    testers: 'Focus on tester performance and execution volume.',
    cycles: 'Focus on test cycle health, coverage gaps, and at-risk cycles.',
  };
  return `Generate a ${reportType} QA report for ${scope}. ${typeGuide[reportType]}`;
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
  for (let round = 0; round < 8; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
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

  return { markdown: markdown || '# Report\n\nNo content generated.', toolCalls };
}

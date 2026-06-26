import Anthropic from '@anthropic-ai/sdk';
import type { Dataset, GenerateParams } from '../types/dataset';
import { AI_TOOLS, executeTool, type ToolInput } from './datasetTools';

export interface ToolCallRecord {
  toolName: string;
  input: ToolInput;
  result: unknown;
  rowCount: number;
}

export interface ReportOutput {
  markdown: string;
  toolCalls: ToolCallRecord[];
}

const SYSTEM_PROMPT = `You are a QA Metrics Report Generator for a software team.

CRITICAL RULES — follow these without exception:
1. You MUST call the provided tools to retrieve ALL data before writing any section.
2. Every number, percentage, name, date, and status in your report MUST come directly from a tool result. Do NOT invent, estimate, or infer any value.
3. If a tool returns empty data for a metric, write exactly: "No data available for this period."
4. Quote risks, blockers, and accomplishments verbatim from the tool results — do not paraphrase.
5. After gathering data, write a professional report in Markdown.

REPORT STRUCTURE:
## Executive Summary
## Resource Performance
## CR Assignments
## Project Health
## Bug Analysis
## Risks & Blockers
## Recommendations
## Data Sources`;

function buildUserPrompt(params: GenerateParams): string {
  let prompt = `Generate a ${params.reportType === 'full' ? 'complete' : params.reportType} QA metrics report for ${params.startDate} to ${params.endDate}.`;
  if (params.projectId) prompt += ` Focus on project ID: ${params.projectId}.`;
  prompt += ' Use tools first, then write the report.';
  return prompt;
}

export async function generateReportFromDataset(
  dataset: Dataset,
  params: GenerateParams,
  apiKey: string,
  onProgress?: (event: { type: string; text?: string; toolName?: string; rowCount?: number }) => void
): Promise<ReportOutput> {
  const client = new Anthropic({ apiKey });
  const toolCalls: ToolCallRecord[] = [];
  let fullReport = '';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildUserPrompt(params) }];

  const defaultToolInput: ToolInput = {
    startDate: params.startDate,
    endDate: params.endDate,
    projectId: params.projectId,
  };

  for (let i = 0; i < 15; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: AI_TOOLS,
      messages,
    });

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        fullReport += block.text;
        onProgress?.({ type: 'delta', text: block.text });
      }
    }

    if (response.stop_reason !== 'tool_use') break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const toolInput = { ...defaultToolInput, ...(block.input as ToolInput) };
      const toolResult = executeTool(block.name, toolInput, dataset);
      const rowCount = Array.isArray(toolResult) ? toolResult.length : 1;
      toolCalls.push({ toolName: block.name, input: toolInput, result: toolResult, rowCount });
      onProgress?.({ type: 'tool_call', toolName: block.name, rowCount });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult) });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  return { markdown: fullReport, toolCalls };
}

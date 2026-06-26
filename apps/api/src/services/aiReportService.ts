import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { getClaudeApiKey } from '../routes/settings';
import { AI_TOOLS, executeTool, type ToolInput } from './aiTools';
import { getDb } from '../db/schema';

export interface ReportRequest {
  startDate: string;
  endDate: string;
  reportType: 'full' | 'executive' | 'resources' | 'projects';
  projectId?: string;
}

interface ToolCallRecord {
  toolName: string;
  input: ToolInput;
  result: unknown;
  rowCount: number;
}

const SYSTEM_PROMPT = `You are a QA Metrics Report Generator for a software team.

CRITICAL RULES — follow these without exception:
1. You MUST call the provided tools to retrieve ALL data before writing any section.
2. Every number, percentage, name, date, and status in your report MUST come directly from a tool result. Do NOT invent, estimate, or infer any value.
3. If a tool returns empty data for a metric, write exactly: "No data available for this period."
4. Quote risks, blockers, and accomplishments verbatim from the tool results — do not paraphrase.
5. After gathering data, write a professional report in the exact structure below.
6. Use Markdown formatting.

REPORT STRUCTURE (always follow this order):

## Executive Summary
2–4 sentences covering the period, total tests executed/passed/failed, bugs reported vs closed, number of active resources, and overall project health. Use exact numbers from get_resource_summary and get_project_status.

## Resource Performance
A table listing each resource with: tests executed, pass rate (%), bugs reported, bugs closed, hours spent, CRs assigned. Highlight top performers.

## CR Assignments
Which resource is on which Change Request, grouped by project. Include CR status and priority.

## Project Health
One subsection per project:
- **Status badge** and **% complete**
- Tests executed, bugs open/reported/closed
- Key Accomplishments (verbatim from DB)
- Risks (verbatim from DB)
- Blockers (verbatim from DB)
- Next Week Plan (verbatim from DB)

## Bug Analysis
Total bugs reported vs closed, closure rate (%), open bug count. Note any projects with increasing open bug counts.

## Risks & Blockers
Consolidated list of all risks and blockers across projects, verbatim from DB. Flag any critical items.

## Recommendations
Based ONLY on what the data shows (risks, blockers, low pass rates, delayed projects). Do not add generic advice not supported by the data.

## Data Sources
List each tool you called, the parameters, and how many rows it returned. This section ensures full transparency and auditability.`;

function buildUserPrompt(req: ReportRequest): string {
  const { startDate, endDate, reportType, projectId } = req;
  let prompt = `Generate a ${reportType === 'full' ? 'complete' : reportType} QA metrics report for the period from ${startDate} to ${endDate}.`;
  if (projectId) prompt += ` Focus on project ID: ${projectId}.`;
  prompt += `\n\nStart by calling the tools to gather all required data, then write the report.`;
  return prompt;
}

export async function generateReport(req: ReportRequest, res: Response): Promise<void> {
  const apiKey = getClaudeApiKey();
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Claude API key not configured. Go to Settings to add your key.' })}\n\n`);
    res.end();
    return;
  }

  const client = new Anthropic({ apiKey });
  const toolCalls: ToolCallRecord[] = [];
  let fullReport = '';

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserPrompt(req) },
  ];

  // Agentic tool-use loop
  // Claude will call tools multiple times until it has all the data it needs,
  // then produce the final text report.
  let iteration = 0;
  const MAX_ITERATIONS = 15; // safety limit

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: AI_TOOLS,
        messages,
      });

      // Collect any text content to stream
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          fullReport += block.text;
          res.write(`data: ${JSON.stringify({ type: 'delta', text: block.text })}\n\n`);
        }
      }

      // If no more tool use, we're done
      if (response.stop_reason !== 'tool_use') {
        break;
      }

      // Execute all tool calls in this response
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const toolInput = block.input as ToolInput;
        const toolResult = executeTool(block.name, toolInput);
        const rows = Array.isArray(toolResult) ? toolResult.length : 1;

        toolCalls.push({
          toolName: block.name,
          input: toolInput,
          result: toolResult,
          rowCount: rows,
        });

        // Send tool call notification to frontend so it can show "Querying data..."
        res.write(`data: ${JSON.stringify({
          type: 'tool_call',
          toolName: block.name,
          rowCount: rows,
        })}\n\n`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Add assistant's response and tool results to message history
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    // Save report to DB
    const db = getDb();
    db.prepare(`
      INSERT INTO ai_reports (created_at, start_date, end_date, report_type, project_id, report_markdown, tool_calls_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      req.startDate,
      req.endDate,
      req.reportType,
      req.projectId || null,
      fullReport,
      JSON.stringify(toolCalls),
    );

    res.write(`data: ${JSON.stringify({ type: 'done', toolCalls })}\n\n`);
  } catch (err) {
    const msg = (err as Error).message;
    res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
  }

  res.end();
}

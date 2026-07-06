export type AnthropicLogFn = (step: string, detail?: string) => void;

export function createAnthropicLogger(scope = 'anthropic'): { log: AnthropicLogFn; lines: string[] } {
  const lines: string[] = [];
  const log: AnthropicLogFn = (step, detail) => {
    const line = detail ? `[${scope}] ${step} — ${detail}` : `[${scope}] ${step}`;
    console.log(line);
    lines.push(line);
  };
  return { log, lines };
}

import type { ProjectColumnConfig, ProjectTabRow } from './api';

const MAX_QUERY_LENGTH = 2_000;
const MAX_TOKENS = 300;
const MAX_NESTING = 12;

type Operator = '=' | '!=' | 'IN' | 'NOT IN' | '~' | '!~' | '>' | '>=' | '<' | '<=';
type TokenType = 'word' | 'string' | 'operator' | 'leftParen' | 'rightParen' | 'comma' | 'eof';
type Node =
  | { kind: 'condition'; field: string; operator: Operator; values: string[]; position: number }
  | { kind: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'not'; value: Node };

interface Token { type: TokenType; value: string; position: number }

export interface GenericQueryResult {
  predicate?: (row: ProjectTabRow) => boolean;
  error?: string;
  errorPosition?: number;
}

function queryError(message: string, position: number): Error & { position: number } {
  return Object.assign(new Error(message), { position });
}

function tokenize(query: string): Token[] {
  if (query.length > MAX_QUERY_LENGTH) throw queryError(`Query must be ${MAX_QUERY_LENGTH} characters or fewer.`, MAX_QUERY_LENGTH);
  const tokens: Token[] = [];
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '(' || char === ')' || char === ',') {
      tokens.push({ type: char === '(' ? 'leftParen' : char === ')' ? 'rightParen' : 'comma', value: char, position: index });
      index += 1;
      continue;
    }
    const two = query.slice(index, index + 2);
    if (['!=', '!~', '>=', '<='].includes(two)) {
      tokens.push({ type: 'operator', value: two, position: index });
      index += 2;
      continue;
    }
    if (['=', '~', '>', '<'].includes(char)) {
      tokens.push({ type: 'operator', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === '"') {
      const position = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < query.length) {
        if (query[index] === '\\') {
          index += 1;
          if (index >= query.length) break;
          value += query[index];
          index += 1;
        } else if (query[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          value += query[index];
          index += 1;
        }
      }
      if (!closed) throw queryError('Close the quoted value with a double quote.', position);
      tokens.push({ type: 'string', value, position });
      continue;
    }
    const position = index;
    let value = '';
    while (index < query.length && !/[\s(),=~!<>"]/.test(query[index])) {
      value += query[index];
      index += 1;
    }
    if (!value) throw queryError(`Unexpected character "${query[index]}".`, index);
    tokens.push({ type: 'word', value, position });
    if (tokens.length > MAX_TOKENS) throw queryError(`Query must contain ${MAX_TOKENS} tokens or fewer.`, position);
  }
  tokens.push({ type: 'eof', value: '', position: query.length });
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[], private readonly fields: Map<string, ProjectColumnConfig>) {}

  parse(): Node {
    const expression = this.parseOr();
    const trailing = this.peek();
    if (trailing.type !== 'eof') throw queryError(`Unexpected "${trailing.value}".`, trailing.position);
    return expression;
  }

  private peek(offset = 0): Token { return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]; }
  private consume(): Token { const token = this.peek(); this.index += 1; return token; }
  private isWord(value: string, offset = 0): boolean { const token = this.peek(offset); return token.type === 'word' && token.value.toUpperCase() === value; }

  private parseOr(): Node {
    let node = this.parseAnd();
    while (this.isWord('OR')) { this.consume(); node = { kind: 'or', left: node, right: this.parseAnd() }; }
    return node;
  }

  private parseAnd(): Node {
    let node = this.parseUnary();
    while (this.isWord('AND')) { this.consume(); node = { kind: 'and', left: node, right: this.parseUnary() }; }
    return node;
  }

  private parseUnary(): Node {
    if (this.isWord('NOT')) { this.consume(); return { kind: 'not', value: this.parseUnary() }; }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    if (this.peek().type !== 'leftParen') return this.parseCondition();
    const opening = this.consume();
    this.depth += 1;
    if (this.depth > MAX_NESTING) throw queryError(`Query nesting cannot exceed ${MAX_NESTING} levels.`, opening.position);
    const node = this.parseOr();
    const closing = this.consume();
    this.depth -= 1;
    if (closing.type !== 'rightParen') throw queryError('Close the group with a right parenthesis.', closing.position);
    return node;
  }

  private parseCondition(): Node {
    const fieldToken = this.consume();
    if (fieldToken.type !== 'word') throw queryError('Enter a searchable field key.', fieldToken.position);
    const field = fieldToken.value.toLocaleLowerCase();
    const definition = this.fields.get(field);
    if (!definition) throw queryError(`Unknown or unavailable field "${fieldToken.value}".`, fieldToken.position);
    let operator: Operator;
    if (this.isWord('NOT') && this.isWord('IN', 1)) {
      this.consume(); this.consume(); operator = 'NOT IN';
    } else if (this.isWord('IN')) {
      this.consume(); operator = 'IN';
    } else {
      const token = this.consume();
      if (token.type !== 'operator') throw queryError(`Enter an operator after ${fieldToken.value}.`, token.position);
      operator = token.value as Operator;
    }
    const comparable = definition.type === 'date' || definition.type === 'number';
    const allowed: Operator[] = comparable
      ? ['=', '!=', 'IN', 'NOT IN', '>', '>=', '<', '<=']
      : definition.type === 'text'
        ? ['=', '!=', 'IN', 'NOT IN', '~', '!~']
        : ['=', '!=', 'IN', 'NOT IN'];
    if (!allowed.includes(operator)) throw queryError(`Operator ${operator} is not supported for ${definition.label}.`, fieldToken.position);
    const values = operator === 'IN' || operator === 'NOT IN' ? this.parseList() : [this.parseValue()];
    if (definition.type === 'number' && values.some((value) => !Number.isFinite(Number(value)))) {
      throw queryError(`${definition.label} requires numeric values.`, fieldToken.position);
    }
    if (definition.type === 'date' && values.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      throw queryError(`${definition.label} requires YYYY-MM-DD values.`, fieldToken.position);
    }
    return { kind: 'condition', field, operator, values, position: fieldToken.position };
  }

  private parseList(): string[] {
    const opening = this.consume();
    if (opening.type !== 'leftParen') throw queryError('IN values must be inside parentheses.', opening.position);
    const values: string[] = [];
    while (this.peek().type !== 'rightParen') {
      values.push(this.parseValue());
      if (this.peek().type === 'comma') this.consume();
      else if (this.peek().type !== 'rightParen') throw queryError('Separate IN values with commas.', this.peek().position);
    }
    this.consume();
    if (!values.length) throw queryError('IN requires at least one value.', opening.position);
    return values;
  }

  private parseValue(): string {
    const token = this.consume();
    if (token.type !== 'string' && token.type !== 'word') throw queryError('Enter a comparison value.', token.position);
    if (['AND', 'OR', 'NOT', 'IN'].includes(token.value.toUpperCase())) throw queryError(`Quote the value "${token.value}".`, token.position);
    return token.value;
  }
}

function compareValue(actualRaw: unknown, expectedRaw: string, type: ProjectColumnConfig['type']): number {
  if (type === 'number') return Number(actualRaw) - Number(expectedRaw);
  const actual = String(actualRaw ?? '').trim().toLocaleLowerCase();
  const expected = expectedRaw.trim().toLocaleLowerCase();
  return actual.localeCompare(expected);
}

function evaluate(row: ProjectTabRow, node: Node, fields: Map<string, ProjectColumnConfig>): boolean {
  if (node.kind === 'condition') {
    const definition = fields.get(node.field)!;
    const actual = row.values[definition.fieldKey];
    const normalizedActual = String(actual ?? '').trim().toLocaleLowerCase();
    const normalizedExpected = node.values.map((value) => value.trim().toLocaleLowerCase());
    if (node.operator === '=') return normalizedActual === normalizedExpected[0];
    if (node.operator === '!=') return normalizedActual !== normalizedExpected[0];
    if (node.operator === '~') return normalizedActual.includes(normalizedExpected[0]);
    if (node.operator === '!~') return !normalizedActual.includes(normalizedExpected[0]);
    if (node.operator === 'IN') return normalizedExpected.includes(normalizedActual);
    if (node.operator === 'NOT IN') return !normalizedExpected.includes(normalizedActual);
    if (actual === null || actual === undefined || actual === '') return false;
    const comparison = compareValue(actual, node.values[0], definition.type);
    if (node.operator === '>') return comparison > 0;
    if (node.operator === '>=') return comparison >= 0;
    if (node.operator === '<') return comparison < 0;
    return comparison <= 0;
  }
  if (node.kind === 'not') return !evaluate(row, node.value, fields);
  if (node.kind === 'and') return evaluate(row, node.left, fields) && evaluate(row, node.right, fields);
  return evaluate(row, node.left, fields) || evaluate(row, node.right, fields);
}

export function compileGenericTableQuery(query: string, columns: ProjectColumnConfig[]): GenericQueryResult {
  if (!query.trim()) return { predicate: () => true };
  try {
    const fields = new Map(columns
      .filter((column) => column.searchable || column.filterable)
      .map((column) => [column.fieldKey.toLocaleLowerCase(), column]));
    const ast = new Parser(tokenize(query), fields).parse();
    return { predicate: (row) => evaluate(row, ast, fields) };
  } catch (error) {
    const failure = error as Error & { position?: number };
    return { error: failure.message || 'The advanced query is invalid.', errorPosition: failure.position };
  }
}

import type { DashboardUatRow } from 'qa-dashboard-batch';
import {
  EMPTY_VENDOR_PORTAL_FILTERS,
  submittedDisplayValue,
  visibleVendorPortalRowValues,
  type VendorPortalBasicFilters,
} from './vendorPortalBugFilters';

const MAX_QUERY_LENGTH = 2_000;
const MAX_TOKENS = 300;
const MAX_NESTING = 12;

type FieldName = 'ticket' | 'subject' | 'area' | 'changeRequest' | 'priority' | 'status' | 'by' | 'submitted' | 'text';
type ComparisonOperator = '=' | '!=' | 'IN' | 'NOT IN' | '~' | '!~' | '>' | '>=' | '<' | '<=';
type TokenType = 'word' | 'string' | 'operator' | 'leftParen' | 'rightParen' | 'comma' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

type QueryNode =
  | { kind: 'condition'; field: FieldName; operator: ComparisonOperator; values: string[]; position: number }
  | { kind: 'and' | 'or'; left: QueryNode; right: QueryNode }
  | { kind: 'not'; value: QueryNode };

export interface VendorPortalQueryResult {
  predicate?: (row: DashboardUatRow) => boolean;
  error?: string;
  errorPosition?: number;
}

const FIELD_ALIASES: Record<string, FieldName> = {
  ticket: 'ticket',
  subject: 'subject',
  area: 'area',
  changerequest: 'changeRequest',
  priority: 'priority',
  status: 'status',
  by: 'by',
  submitted: 'submitted',
  text: 'text',
};

function queryError(message: string, position: number): Error & { position: number } {
  return Object.assign(new Error(message), { position });
}

function tokenize(query: string): Token[] {
  if (query.length > MAX_QUERY_LENGTH) throw queryError(`Query must be ${MAX_QUERY_LENGTH} characters or fewer.`, MAX_QUERY_LENGTH);
  const tokens: Token[] = [];
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '(' || char === ')' || char === ',') {
      tokens.push({
        type: char === '(' ? 'leftParen' : char === ')' ? 'rightParen' : 'comma',
        value: char,
        position: index,
      });
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

  constructor(private readonly tokens: Token[]) {}

  parse(): QueryNode {
    const expression = this.parseOr();
    const trailing = this.peek();
    if (trailing.type !== 'eof') throw queryError(`Unexpected "${trailing.value}".`, trailing.position);
    return expression;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  private consume(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private isWord(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === 'word' && token.value.toUpperCase() === value;
  }

  private parseOr(): QueryNode {
    let node = this.parseAnd();
    while (this.isWord('OR')) {
      this.consume();
      node = { kind: 'or', left: node, right: this.parseAnd() };
    }
    return node;
  }

  private parseAnd(): QueryNode {
    let node = this.parseUnary();
    while (this.isWord('AND')) {
      this.consume();
      node = { kind: 'and', left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): QueryNode {
    if (this.isWord('NOT')) {
      this.consume();
      return { kind: 'not', value: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    if (this.peek().type === 'leftParen') {
      const opening = this.consume();
      this.depth += 1;
      if (this.depth > MAX_NESTING) throw queryError(`Query nesting cannot exceed ${MAX_NESTING} levels.`, opening.position);
      const node = this.parseOr();
      const closing = this.consume();
      this.depth -= 1;
      if (closing.type !== 'rightParen') throw queryError('Close the group with a right parenthesis.', closing.position);
      return node;
    }
    return this.parseCondition();
  }

  private parseCondition(): QueryNode {
    const fieldToken = this.consume();
    if (fieldToken.type !== 'word') throw queryError('Enter a searchable field name.', fieldToken.position);
    const field = FIELD_ALIASES[fieldToken.value.toLocaleLowerCase()];
    if (!field) throw queryError(`Unknown field "${fieldToken.value}".`, fieldToken.position);

    let operator: ComparisonOperator;
    if (this.isWord('NOT') && this.isWord('IN', 1)) {
      this.consume();
      this.consume();
      operator = 'NOT IN';
    } else if (this.isWord('IN')) {
      this.consume();
      operator = 'IN';
    } else {
      const token = this.consume();
      if (token.type !== 'operator') throw queryError(`Enter an operator after ${fieldToken.value}.`, token.position);
      operator = token.value as ComparisonOperator;
    }
    this.validateOperator(field, operator, fieldToken.position);
    const values = operator === 'IN' || operator === 'NOT IN'
      ? this.parseList()
      : [this.parseValue()];
    if (field === 'submitted') {
      const validDateValues = values.every((value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value)
        || (['=', '!=', 'IN', 'NOT IN'].includes(operator) && value === '—'));
      if (!validDateValues) {
        throw queryError('Submitted date comparisons require YYYY-MM-DD values.', fieldToken.position);
      }
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
    if (['AND', 'OR', 'NOT', 'IN'].includes(token.value.toUpperCase())) {
      throw queryError(`Quote the value "${token.value}".`, token.position);
    }
    return token.value;
  }

  private validateOperator(field: FieldName, operator: ComparisonOperator, position: number): void {
    const allowed: ComparisonOperator[] = field === 'submitted'
      ? ['=', '!=', 'IN', 'NOT IN', '>', '>=', '<', '<=']
      : field === 'text'
        ? ['=', '!=', '~', '!~']
        : ['=', '!=', 'IN', 'NOT IN', '~', '!~'];
    if (!allowed.includes(operator)) throw queryError(`Operator ${operator} is not supported for ${field}.`, position);
  }
}

function fieldValue(row: DashboardUatRow, field: FieldName): string {
  if (field === 'ticket') return row.id || '—';
  if (field === 'subject') return row.subject || '—';
  if (field === 'area') return row.area || '—';
  if (field === 'changeRequest') return row.cr?.trim() || '—';
  if (field === 'priority') return row.priority || '—';
  if (field === 'status') return row.status || '—';
  if (field === 'by') return row.submitter || '—';
  if (field === 'submitted') return submittedDisplayValue(row);
  return visibleVendorPortalRowValues(row).join(' ');
}

function evaluateCondition(row: DashboardUatRow, node: Extract<QueryNode, { kind: 'condition' }>): boolean {
  const actual = fieldValue(row, node.field).trim().toLocaleLowerCase();
  const expected = node.values.map((value) => value.trim().toLocaleLowerCase());
  if (node.operator === '=') return actual === expected[0];
  if (node.operator === '!=') return actual !== expected[0];
  if (node.operator === '~') return actual.includes(expected[0]);
  if (node.operator === '!~') return !actual.includes(expected[0]);
  if (node.operator === 'IN') return expected.includes(actual);
  if (node.operator === 'NOT IN') return !expected.includes(actual);
  if (node.field === 'submitted' && actual === '—') return false;
  if (node.operator === '>') return actual > expected[0];
  if (node.operator === '>=') return actual >= expected[0];
  if (node.operator === '<') return actual < expected[0];
  return actual <= expected[0];
}

function evaluate(row: DashboardUatRow, node: QueryNode): boolean {
  if (node.kind === 'condition') return evaluateCondition(row, node);
  if (node.kind === 'and') return evaluate(row, node.left) && evaluate(row, node.right);
  if (node.kind === 'or') return evaluate(row, node.left) || evaluate(row, node.right);
  if (node.kind === 'not') return !evaluate(row, node.value);
  return false;
}

export function compileVendorPortalQuery(query: string): VendorPortalQueryResult {
  if (!query.trim()) return { predicate: () => true };
  try {
    const ast = new Parser(tokenize(query)).parse();
    return { predicate: (row) => evaluate(row, ast) };
  } catch (error) {
    const failure = error as Error & { position?: number };
    return {
      error: failure.message || 'The advanced query is invalid.',
      errorPosition: failure.position,
    };
  }
}

function flattenBasicConditions(node: QueryNode): Extract<QueryNode, { kind: 'condition' }>[] | null {
  if (node.kind === 'condition') return [node];
  if (node.kind !== 'and') return null;
  const left = flattenBasicConditions(node.left);
  const right = flattenBasicConditions(node.right);
  return left && right ? [...left, ...right] : null;
}

export function advancedQueryToBasicFilters(query: string): VendorPortalBasicFilters | null {
  if (!query.trim()) return { ...EMPTY_VENDOR_PORTAL_FILTERS };
  try {
    const ast = new Parser(tokenize(query)).parse();
    const conditions = flattenBasicConditions(ast);
    if (!conditions) return null;
    const filters = { ...EMPTY_VENDOR_PORTAL_FILTERS };
    const target: Partial<Record<FieldName, keyof VendorPortalBasicFilters>> = {
      status: 'status',
      priority: 'priority',
      area: 'area',
      changeRequest: 'changeRequest',
      by: 'reportedBy',
      text: 'text',
    };
    for (const condition of conditions) {
      const key = target[condition.field];
      const convertible = key
        && ((condition.field === 'text' && condition.operator === '~')
          || (condition.field !== 'text' && condition.operator === '='))
        && condition.values.length === 1
        && !filters[key];
      if (!convertible || !key) return null;
      filters[key] = condition.values[0];
    }
    return filters;
  } catch {
    return null;
  }
}

export function vendorPortalQuerySuggestions(rows: DashboardUatRow[]): string[] {
  const distinct = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return [
    'status = "Pending"',
    'priority = "High"',
    'text ~ "payment"',
    ...distinct(rows.map((row) => row.status)).map((value) => `status = "${value.replace(/"/g, '\\"')}"`),
    ...distinct(rows.map((row) => row.priority)).map((value) => `priority = "${value.replace(/"/g, '\\"')}"`),
    ...distinct(rows.map((row) => row.cr)).map((value) => `changeRequest = "${value.replace(/"/g, '\\"')}"`),
  ].slice(0, 80);
}

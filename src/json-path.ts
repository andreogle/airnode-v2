/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition, functional/immutable-data, functional/no-let, functional/no-loop-statements, unicorn/no-array-callback-reference, unicorn/no-nested-ternary, unicorn/no-null */

/**
 * Minimal JSONPath evaluator supporting:
 * - Root reference: $
 * - Dot notation: $.foo.bar
 * - Bracket notation: $['foo']['bar']
 * - Array indices: $.data[0], $.data[-1] (negative = from end)
 * - Array slices: $.data[0:3], $.data[1:], $.data[:2]
 * - Wildcard: $.data[*], $.data.*
 * - Deep scan: $..name (recursive descent)
 * - Filter expressions: $.data[?(@.active==true)]
 * - Union: $.data[0,2,4]
 */

type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function tokenize(path: string): readonly string[] {
  if (!path.startsWith('$')) {
    throw new Error(`JSONPath must start with $: ${path}`);
  }

  const tokens: string[] = [];
  const rest = path.slice(1);

  let index = 0;
  while (index < rest.length) {
    if (rest[index] === '.') {
      if (rest[index + 1] === '.') {
        tokens.push('..');
        index += 2;
      } else {
        index += 1;
      }

      if (index < rest.length && rest[index] !== '[' && rest[index] !== '.') {
        const start = index;
        while (index < rest.length && rest[index] !== '.' && rest[index] !== '[') {
          index += 1;
        }
        const token = rest.slice(start, index);
        tokens.push(token === '*' ? '[*]' : token);
      }
    } else if (rest[index] === '[') {
      const end = rest.indexOf(']', index);
      if (end === -1) {
        throw new Error(`Unclosed bracket at position ${String(index)}: ${path}`);
      }
      tokens.push(rest.slice(index, end + 1));
      index = end + 1;
    } else {
      const start = index;
      while (index < rest.length && rest[index] !== '.' && rest[index] !== '[') {
        index += 1;
      }
      tokens.push(rest.slice(start, index));
    }
  }

  return tokens;
}

function getValues(object: JsonValue): readonly JsonValue[] {
  if (Array.isArray(object)) return object;
  if (object !== null && typeof object === 'object') return Object.values(object);
  return [];
}

function deepScan(object: JsonValue, key: string): readonly JsonValue[] {
  const results: JsonValue[] = [];
  const queue: JsonValue[] = [object];

  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    if (current === null || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      queue.push(...current);
    } else {
      const record = current as { readonly [k: string]: JsonValue };
      if (key === '*') {
        results.push(...Object.values(record));
      } else if (key in record) {
        results.push(record[key]!);
      }
      queue.push(...Object.values(record));
    }
  }

  return results;
}

function parseFilter(expr: string): (item: JsonValue) => boolean {
  // Supports: (@.field==value), (@.field!=value), (@.field>value), etc.
  const match = /^\(@\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)\)$/.exec(expr.trim());
  if (!match) {
    throw new Error(`Unsupported filter expression: ${expr}`);
  }

  const field = match[1]!;
  const op = match[2]!;
  const rawValue = match[3]!.trim();

  const compareValue =
    rawValue === 'true'
      ? true
      : rawValue === 'false'
        ? false
        : rawValue === 'null'
          ? null
          : rawValue.startsWith("'") || rawValue.startsWith('"')
            ? rawValue.slice(1, -1)
            : Number(rawValue);

  return (item: JsonValue): boolean => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as { readonly [k: string]: JsonValue };
    const fieldValue = record[field];
    if (fieldValue === undefined) return false;

    switch (op) {
      case '==': {
        return fieldValue === compareValue;
      }
      case '!=': {
        return fieldValue !== compareValue;
      }
      case '>': {
        return typeof fieldValue === 'number' && typeof compareValue === 'number' && fieldValue > compareValue;
      }
      case '<': {
        return typeof fieldValue === 'number' && typeof compareValue === 'number' && fieldValue < compareValue;
      }
      case '>=': {
        return typeof fieldValue === 'number' && typeof compareValue === 'number' && fieldValue >= compareValue;
      }
      case '<=': {
        return typeof fieldValue === 'number' && typeof compareValue === 'number' && fieldValue <= compareValue;
      }
      default: {
        return false;
      }
    }
  };
}

function resolveToken(current: readonly JsonValue[], token: string, isDeepScan: boolean): readonly JsonValue[] {
  if (isDeepScan) {
    return current.flatMap((c) => deepScan(c, token === '[*]' ? '*' : token));
  }

  // Bracket notation
  if (token.startsWith('[')) {
    const inner = token.slice(1, -1);

    // Wildcard: [*]
    if (inner === '*') {
      return current.flatMap(getValues);
    }

    // Filter: [?(@.field==value)]
    if (inner.startsWith('?')) {
      const predicate = parseFilter(inner.slice(1));
      return current.flatMap((c) => {
        if (!Array.isArray(c)) return [];
        return c.filter(predicate);
      });
    }

    // Union: [0,2,4] or ['a','b']
    if (inner.includes(',')) {
      const parts = inner.split(',').map((p) => p.trim());
      return current.flatMap((c) =>
        parts.flatMap((part) => {
          const unquoted = part.replaceAll(/^['"]|['"]$/g, '');
          if (c === null || typeof c !== 'object') return [];
          if (Array.isArray(c)) {
            const index = Number(unquoted);
            const value_ = c[index < 0 ? c.length + index : index];
            return value_ === undefined ? [] : [value_];
          }
          const record = c as { readonly [k: string]: JsonValue };
          const value = record[unquoted];
          return value === undefined ? [] : [value];
        })
      );
    }

    // Slice: [start:end]
    if (inner.includes(':')) {
      const [startString, endString] = inner.split(':');
      return current.flatMap((c) => {
        if (!Array.isArray(c)) return [];
        const start = startString === '' || startString === undefined ? 0 : Number(startString);
        const end = endString === '' || endString === undefined ? c.length : Number(endString);
        return c.slice(start < 0 ? c.length + start : start, end < 0 ? c.length + end : end);
      });
    }

    // Quoted property: ['name'] or ["name"]
    const unquoted = inner.replaceAll(/^['"]|['"]$/g, '');
    if (inner.startsWith("'") || inner.startsWith('"')) {
      return current.flatMap((c) => {
        if (c === null || typeof c !== 'object' || Array.isArray(c)) return [];
        const record = c as { readonly [k: string]: JsonValue };
        const value = record[unquoted];
        return value === undefined ? [] : [value];
      });
    }

    // Numeric index: [0], [-1]
    const index = Number(unquoted);
    if (!Number.isNaN(index)) {
      return current.flatMap((c) => {
        if (!Array.isArray(c)) return [];
        const value = c[index < 0 ? c.length + index : index];
        return value === undefined ? [] : [value];
      });
    }

    // Fallback: treat as property name
    return current.flatMap((c) => {
      if (c === null || typeof c !== 'object' || Array.isArray(c)) return [];
      const record = c as { readonly [k: string]: JsonValue };
      const value = record[unquoted];
      return value === undefined ? [] : [value];
    });
  }

  // Dot notation property
  return current.flatMap((c) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) return [];
    const record = c as { readonly [k: string]: JsonValue };
    const value = record[token];
    return value === undefined ? [] : [value];
  });
}

export function query(data: JsonValue, path: string): JsonValue | undefined {
  const tokens = tokenize(path);
  let current: readonly JsonValue[] = [data];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === '..') {
      index += 1;
      const nextToken = tokens[index];
      if (!nextToken) {
        throw new Error('Deep scan (..) must be followed by a property or bracket expression');
      }
      current = resolveToken(current, nextToken, true);
    } else {
      current = resolveToken(current, token, false);
    }
    index += 1;
  }

  if (current.length === 0) return undefined;
  if (current.length === 1) return current[0];
  return current;
}

export function queryAll(data: JsonValue, path: string): readonly JsonValue[] {
  const tokens = tokenize(path);
  let current: readonly JsonValue[] = [data];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === '..') {
      index += 1;
      const nextToken = tokens[index];
      if (!nextToken) {
        throw new Error('Deep scan (..) must be followed by a property or bracket expression');
      }
      current = resolveToken(current, nextToken, true);
    } else {
      current = resolveToken(current, token, false);
    }
    index += 1;
  }

  return current;
}

export type { JsonValue };

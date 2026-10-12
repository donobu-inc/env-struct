import type { snakeToCamel } from './utils.js';

/** Match SnakeToCamelKey, including mixed-case names and repeated underscores. */
function camelKey(key: string): string {
  const parts = key.split('_');
  let result = parts.pop()!;
  if (result === result.toUpperCase()) result = result.toLowerCase();
  while (parts.length) {
    result = parts.pop()!.toLowerCase() + result.charAt(0).toUpperCase() + result.slice(1);
  }
  return result;
}

/** Copy JSON-shaped parsed values without retaining references to the input. */
export function camelize<T>(value: T): snakeToCamel<T> {
  const ancestors = new Set<object>();

  function unsupported(path: string, kind: string): never {
    throw new TypeError(
      `Env.toCamelCase(): unsupported ${kind} at ${path}; expected JSON-shaped values or undefined`,
    );
  }

  function copy(input: unknown, path: string): unknown {
    if (input === null || input === undefined) return input;
    if (typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) unsupported(path, 'non-finite number');
      return input;
    }
    if (typeof input !== 'object') return unsupported(path, typeof input);

    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    ) {
      const kind = prototype?.constructor?.name ?? 'object';
      return unsupported(path, kind);
    }
    if (ancestors.has(input)) return unsupported(path, 'circular reference');
    if (Object.getOwnPropertySymbols(input).length) return unsupported(path, 'symbol key');

    ancestors.add(input);
    const result = array ? new Array(input.length) : Object.create(prototype);
    const originalKeys = new Map<string, string>();
    for (const key of Object.keys(input)) {
      const childPath = array ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
      if (
        array &&
        (!Number.isInteger(Number(key)) ||
          String(Number(key)) !== key ||
          Number(key) >= input.length ||
          Number(key) < 0)
      ) {
        unsupported(childPath, 'array property');
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!('value' in descriptor)) unsupported(childPath, 'accessor property');
      const convertedKey = array ? key : camelKey(key);
      const previous = originalKeys.get(convertedKey);
      if (previous !== undefined) {
        throw new TypeError(
          `Env.toCamelCase(): key collision at ${path}: ${JSON.stringify(previous)} and ${JSON.stringify(key)} both become ${JSON.stringify(convertedKey)}`,
        );
      }
      originalKeys.set(convertedKey, key);
      Object.defineProperty(result, convertedKey, {
        ...descriptor,
        value: copy(descriptor.value, childPath),
      });
    }
    ancestors.delete(input);
    // Preserve schema-level readonly freezing without freezing mutable children.
    return Object.isFrozen(input) ? Object.freeze(result) : result;
  }

  return copy(value, '$') as snakeToCamel<T>;
}

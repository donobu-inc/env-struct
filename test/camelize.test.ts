import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod/v4';
import { Env } from '../src';
import type { SnakeToCamelKey, snakeToCamel } from '../src';

describe('Env.toCamelCase', () => {
  it('deeply copies nested JSON objects, arrays, tuples, records, and optional values', () => {
    const env = Env.fromZod(
      {
        SERVICE_CONFIG: z.object({
          API_URL: z.string(),
          WORKERS: z.array(z.object({ MAX_RETRIES: z.number() })),
          ROUTES: z.record(z.string(), z.object({ IS_PUBLIC: z.boolean() })),
          PAIR: z.tuple([z.string(), z.object({ ITEM_COUNT: z.number() })]),
          EMPTY: z.null(),
        }),
        OPTIONAL_VALUE: z.string().optional(),
      },
      {
        SERVICE_CONFIG: JSON.stringify({
          API_URL: 'https://example.com',
          WORKERS: [{ MAX_RETRIES: 3 }],
          ROUTES: { PUBLIC_API: { IS_PUBLIC: true } },
          PAIR: ['value', { ITEM_COUNT: 1 }],
          EMPTY: null,
        }),
      },
    );

    const first = env.toCamelCase();
    const second = env.toCamelCase();
    expect(first).toEqual({
      serviceConfig: {
        apiUrl: 'https://example.com',
        workers: [{ maxRetries: 3 }],
        routes: { publicApi: { isPublic: true } },
        pair: ['value', { itemCount: 1 }],
        empty: null,
      },
      optionalValue: undefined,
    });
    expectTypeOf(first.serviceConfig.workers).toEqualTypeOf<Array<{ maxRetries: number }>>();
    expectTypeOf(first.serviceConfig.pair).toEqualTypeOf<[string, { itemCount: number }]>();
    expectTypeOf(first.optionalValue).toEqualTypeOf<string | undefined>();
    expect(first).not.toBe(second);
    expect(first.serviceConfig).not.toBe(second.serviceConfig);
    expect(first.serviceConfig.workers).not.toBe(env.data.SERVICE_CONFIG.WORKERS);

    first.serviceConfig.workers[0].maxRetries = 10;
    first.serviceConfig.routes.publicApi.isPublic = false;
    first.serviceConfig.pair[1].itemCount = 9;
    first.optionalValue = 'local';
    expect(env.data.SERVICE_CONFIG.WORKERS[0].MAX_RETRIES).toBe(3);
    expect(env.meta.SERVICE_CONFIG.val.ROUTES.PUBLIC_API.IS_PUBLIC).toBe(true);
    expect(env.data.SERVICE_CONFIG.PAIR[1].ITEM_COUNT).toBe(1);
    expect(second.serviceConfig.workers[0].maxRetries).toBe(3);
    expect(env.data.OPTIONAL_VALUE).toBeUndefined();

    env.data.SERVICE_CONFIG.WORKERS[0].MAX_RETRIES = 5;
    env.source.SERVICE_CONFIG = 'invalid JSON';
    expect(second.serviceConfig.workers[0].maxRetries).toBe(3);
    expect(env.toCamelCase().serviceConfig.workers[0].maxRetries).toBe(5);
    expect('camel' in env).toBe(false);
  });

  it('preserves readonly protections on copied nested keys and arrays', () => {
    const env = Env.fromZod(
      {
        CONFIG: z
          .object({
            FIXED_VALUE: z.object({ ITEM_COUNT: z.number() }).readonly(),
            MUTABLE_VALUE: z.object({ ITEM_COUNT: z.number() }),
            ITEMS: z.array(z.object({ ITEM_COUNT: z.number() }).readonly()).readonly(),
          })
          .readonly(),
      },
      {
        CONFIG:
          '{"FIXED_VALUE":{"ITEM_COUNT":1},"MUTABLE_VALUE":{"ITEM_COUNT":2},"ITEMS":[{"ITEM_COUNT":3}]}',
      },
    );
    const result = env.toCamelCase();
    expectTypeOf(result).toEqualTypeOf<{
      config: {
        readonly fixedValue: { readonly itemCount: number };
        readonly mutableValue: { itemCount: number };
        readonly items: ReadonlyArray<{ readonly itemCount: number }>;
      };
    }>();
    expect(Object.isFrozen(result)).toBe(false);
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(Object.isFrozen(result.config.items)).toBe(true);
    expect(Object.isFrozen(result.config.items[0])).toBe(true);
    expect(Reflect.set(result.config.fixedValue, 'itemCount', 99)).toBe(false);
    result.config.mutableValue.itemCount = 99;
    expect(env.data.CONFIG.MUTABLE_VALUE.ITEM_COUNT).toBe(2);
    expect(result.config.fixedValue).not.toBe(env.data.CONFIG.FIXED_VALUE);
  });

  it('preserves readonly on the root when the whole schema is readonly', () => {
    const env = Env.fromZod(z.object({ API_URL: z.string() }).readonly(), { API_URL: 'url' });
    const result = env.toCamelCase();
    expectTypeOf(result).toEqualTypeOf<{ readonly apiUrl: string }>();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, 'apiUrl', 'other')).toBe(false);
  });

  it('identifies nested collisions by their original path and keys', () => {
    const env = Env.fromZod(
      { CONFIG: z.array(z.object({ API_URL: z.string(), apiUrl: z.string() })) },
      {
        CONFIG: '[{"API_URL":"secret-one","apiUrl":"secret-two"}]',
      },
    );
    expect(() => env.toCamelCase()).toThrow(
      'key collision at $["CONFIG"][0]: "API_URL" and "apiUrl" both become "apiUrl"',
    );
  });

  class CustomValue {
    value = 1;
  }
  const unsupportedValues: Array<[string, () => unknown]> = [
    ['Date', () => new Date()],
    ['Map', () => new Map([['a', 1]])],
    ['Set', () => new Set([1])],
    ['CustomValue', () => new CustomValue()],
    ['RegExp', () => /value/],
    ['Promise', () => Promise.resolve(1)],
    ['WeakMap', () => new WeakMap()],
    ['Uint8Array', () => new Uint8Array([1])],
    ['bigint', () => 1n],
    ['symbol', () => Symbol('value')],
    ['function', () => () => 1],
    ['non-finite number', () => Infinity],
    ['non-finite number', () => NaN],
  ];
  it.each(unsupportedValues)(
    'rejects %s from transforms with a path, while retaining it in data',
    (kind, create) => {
      const value = create();
      const env = Env.fromZod(
        {
          CONFIG: z.string().transform(() => ({ ROWS: [{ VALUE: value }] })),
        },
        { CONFIG: 'input' },
      );
      expect(env.data.CONFIG.ROWS[0].VALUE).toBe(value);
      expect(() => env.toCamelCase()).toThrow(
        `unsupported ${kind} at $["CONFIG"]["ROWS"][0]["VALUE"]`,
      );
    },
  );

  it('rejects cycles without affecting access to the parsed configuration', () => {
    const value: { SELF?: unknown } = {};
    value.SELF = value;
    const env = Env.fromZod({ CONFIG: z.string().transform(() => value) }, { CONFIG: 'input' });
    expect(() => env.toCamelCase()).toThrow('circular reference at $["CONFIG"]["SELF"]');
    expect(env.data.CONFIG.SELF).toBe(value);
  });

  it('accepts repeated references without sharing them with the original', () => {
    const shared = { ITEM_COUNT: 1 };
    const env = Env.fromZod(
      { CONFIG: z.string().transform(() => ({ A: shared, B: shared })) },
      { CONFIG: 'input' },
    );
    const result = env.toCamelCase();
    expect(result.config).toEqual({ a: { itemCount: 1 }, b: { itemCount: 1 } });
    expect(result.config.a).not.toBe(shared);
    expect(result.config.b).not.toBe(shared);
  });

  it('handles null-prototype records and prototype-related keys as ordinary data', () => {
    const record = Object.assign(Object.create(null), { API_URL: 'url' });
    const env = Env.fromZod(
      {
        CONFIG: z.string().transform(() => ({
          RECORD: record,
          constructor: { ITEM_COUNT: 1 },
          ['__proto__']: { IS_ADMIN: false },
        })),
      },
      { CONFIG: 'input' },
    );
    const result = env.toCamelCase();
    expect(result.config).not.toHaveProperty('RECORD');
    expect(result.config.record.apiUrl).toBe('url');
    expect(Object.getPrototypeOf(result.config.record)).toBeNull();
    expect(result.config.constructor).toEqual({ itemCount: 1 });
    expect(Object.getPrototypeOf(result.config)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result.config, 'Proto')).toBe(true);
  });

  it('rejects symbol keys and accessor properties rather than retaining hidden behavior', () => {
    for (const [value, kind] of [
      [{ [Symbol('key')]: 1 }, 'symbol key'],
      [
        {
          get VALUE() {
            return 1;
          },
        },
        'accessor property',
      ],
    ] as const) {
      const env = Env.fromZod({ CONFIG: z.string().transform(() => value) }, { CONFIG: 'input' });
      expect(() => env.toCamelCase()).toThrow(`unsupported ${kind}`);
    }
  });

  it('aligns key conversion with its types for mixed casing, digits, and separators', () => {
    const cases = [
      ['FOO_BAR', 'fooBar'],
      ['foo_bAr', 'fooBAr'],
      ['FOO__BAR', 'fooBar'],
      ['_FOO', 'Foo'],
      ['FOO_', 'foo'],
      ['FOO_1_BAR', 'foo1Bar'],
      ['ApiKey', 'ApiKey'],
      ['PORT', 'port'],
    ];
    for (const [key, expected] of cases) {
      expect(Env.fromValues({ [key]: 'value' }).toCamelCase()).toEqual({ [expected]: 'value' });
    }
    expectTypeOf<SnakeToCamelKey<'FOO_1_BAR'>>().toEqualTypeOf<'foo1Bar'>();
    expectTypeOf<
      snakeToCamel<{ DATE: Date; MAP: Map<string, number>; BIG: bigint }>
    >().toEqualTypeOf<{ date: never; map: never; big: never }>();
  });
});

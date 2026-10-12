import { describe, expect, expectTypeOf, it } from 'vitest';
import { z, ZodError, ZodObject } from 'zod/v4';
import { Env } from '../src';
import type { EnvPick } from '../src';

describe('Env', () => {
  it.each(['shape', 'object', 'names', 'values'] as const)(
    'rejects the declared __proto__ key consistently through the %s factory',
    (factory) => {
      const shape = { ['__proto__']: z.string() };
      const source = { ['__proto__']: 'value' };
      const create = () => {
        switch (factory) {
          case 'shape':
            return Env.fromZod(shape, source);
          case 'object':
            return Env.fromZod(z.object(shape), source);
          case 'names':
            return Env.fromNames(['__proto__'], source);
          case 'values':
            return Env.fromValues(source);
        }
      };
      expect(create).toThrow(TypeError);
      expect(create).toThrow(
        '"__proto__" is not supported as a declared environment variable name',
      );
      expect(Object.getPrototypeOf(source)).toBe(Object.prototype);
      expect(source.__proto__).toBe('value');
    },
  );

  it('ignores an undeclared __proto__ source key when parsing and narrowing', () => {
    const env = Env.fromNames(['PORT'], { PORT: '3000', ['__proto__']: 'unused' });
    expect(env.data.PORT).toBe('3000');
    expect(env.pick('PORT').source).toEqual({ PORT: '3000' });
    expect(env.omit().source).toEqual({ PORT: '3000' });
    expect(env.toCamelCase()).toEqual({ port: '3000' });
  });

  it.each([undefined, '128'])(
    'parses bigint data with an optional source value of %s',
    (optional) => {
      const env = Env.fromZod(
        {
          BIGINT_REQUIRED: z.coerce.bigint(),
          BIGINT_OPTIONAL: z.coerce.bigint().optional(),
        },
        { BIGINT_REQUIRED: '9007199254740993', BIGINT_OPTIONAL: optional },
      );

      expectTypeOf(env.data.BIGINT_REQUIRED).toEqualTypeOf<bigint>();
      expectTypeOf(env.data.BIGINT_OPTIONAL).toEqualTypeOf<bigint | undefined>();
      expect(env.data.BIGINT_REQUIRED).toBe(9007199254740993n);
      expect(env.data.BIGINT_OPTIONAL).toBe(optional === undefined ? undefined : 128n);
      expect(env.meta.BIGINT_REQUIRED).toEqual({
        name: 'BIGINT_REQUIRED',
        raw: '9007199254740993',
        val: 9007199254740993n,
      });
      expect(env.meta.BIGINT_OPTIONAL.raw).toBe(optional);
      expect(env.meta.BIGINT_OPTIONAL.val).toBe(env.data.BIGINT_OPTIONAL);
      expect(env.pick('BIGINT_REQUIRED').data.BIGINT_REQUIRED).toBe(9007199254740993n);
      expect(env.omit('BIGINT_REQUIRED').data.BIGINT_OPTIONAL).toBe(env.data.BIGINT_OPTIONAL);
    },
  );

  it('parses typed values, and exposes rich metadata', () => {
    const schema = z.object({
      PORT: z.number(),
      FEATURE_ENABLED: z.boolean(),
      CONFIG: z.object({ nested: z.string() }),
      OPTIONAL: z.string().optional(),
      camelCased: z.string(),
    });

    const env = Env.fromZod(schema, {
      PORT: ' 8080 ',
      FEATURE_ENABLED: ' YeS ',
      CONFIG: ' { "nested": "value" } ',
      OPTIONAL: '  whitespace is preserved for string fields  ',
      camelCased: 'alreadyCamel',
      EXTRA: 'This is not included in the schema but it should not cause a failure',
    });

    expect(env.data).toEqual({
      PORT: 8080,
      FEATURE_ENABLED: true,
      CONFIG: { nested: 'value' },
      OPTIONAL: '  whitespace is preserved for string fields  ',
      camelCased: 'alreadyCamel',
    });

    expect(env.meta.PORT).toEqual({
      name: 'PORT',
      val: 8080,
      raw: ' 8080 ',
    });

    expect(env.data.PORT).toBe(8080);
    expect(env.data.CONFIG).toEqual({ nested: 'value' });

    expect(env.keys).toEqual({
      PORT: 'PORT',
      FEATURE_ENABLED: 'FEATURE_ENABLED',
      CONFIG: 'CONFIG',
      OPTIONAL: 'OPTIONAL',
      camelCased: 'camelCased',
    });

    expect(Object.isFrozen(env.meta)).toBe(true);
    expect(Object.isFrozen(env.meta.PORT)).toBe(true);
    expect(Object.isFrozen(env.data)).toBe(true);
    expect(Object.isFrozen(env.toCamelCase())).toBe(false);

    expect(env.toCamelCase()).toEqual({
      port: 8080,
      featureEnabled: true,
      config: { nested: 'value' },
      optional: '  whitespace is preserved for string fields  ',
      camelCased: 'alreadyCamel',
    });
    expect(env.toCamelCase().featureEnabled).toBe(true);
    expect(env.toCamelCase().camelCased).toBe('alreadyCamel');
  });

  it('freezes accessor containers without freezing or revalidating nested values', () => {
    const env = Env.fromZod(
      {
        CONFIG: z.object({ retries: z.number().positive() }),
        TAGS: z.array(z.string()),
      },
      { CONFIG: '{"retries":3}', TAGS: '["initial"]' },
    );

    for (const container of [env.data, env.meta, env.meta.CONFIG, env.keys]) {
      expect(Object.isFrozen(container)).toBe(true);
    }
    expect(Reflect.set(env.data, 'CONFIG', { retries: 9 })).toBe(false);
    expect(Object.isFrozen(env.data.CONFIG)).toBe(false);
    expect(Object.isFrozen(env.data.TAGS)).toBe(false);
    expectTypeOf(env.toCamelCase()).toEqualTypeOf<{
      config: { retries: number };
      tags: string[];
    }>();

    env.data.CONFIG.retries = -1;
    env.data.TAGS.push('added');
    expect(env.data.CONFIG.retries).toBe(-1);
    expect(env.meta.CONFIG.val).toBe(env.data.CONFIG);
    expect(env.meta.CONFIG.val.retries).toBe(-1);
    expect(env.toCamelCase().tags).not.toBe(env.data.TAGS);
    expect(env.meta.TAGS.val).toEqual(['initial', 'added']);
    expect(env.meta.CONFIG.raw).toBe('{"retries":3}');
    expect(() => env.schema.parse(env.data)).toThrow(ZodError);
  });

  it('preserves schema-level readonly types and shallow freezing through every value view', () => {
    const env = Env.fromZod(
      {
        CONFIG: z
          .object({
            retries: z.number(),
            nested: z.object({ count: z.number() }),
            fixed: z.object({ count: z.number() }).readonly(),
          })
          .readonly(),
        ITEMS: z.array(z.object({ count: z.number() })).readonly(),
      },
      {
        CONFIG: '{"retries":3,"nested":{"count":1},"fixed":{"count":2}}',
        ITEMS: '[{"count":1}]',
      },
    );

    type Config = {
      readonly retries: number;
      readonly nested: { count: number };
      readonly fixed: { readonly count: number };
    };
    expectTypeOf(env.data.CONFIG).toEqualTypeOf<Config>();
    expectTypeOf(env.toCamelCase().config).toEqualTypeOf<Config>();
    expectTypeOf(env.meta.CONFIG.val).toEqualTypeOf<Config>();
    expectTypeOf(env.toCamelCase().items).toEqualTypeOf<ReadonlyArray<{ count: number }>>();

    for (const config of [env.data.CONFIG, env.toCamelCase().config, env.meta.CONFIG.val]) {
      expect(Object.isFrozen(config)).toBe(true);
      expect(Reflect.set(config, 'retries', 9)).toBe(false);
      expect(Object.isFrozen(config.fixed)).toBe(true);
      expect(Reflect.set(config.fixed, 'count', 9)).toBe(false);
      expect(Object.isFrozen(config.nested)).toBe(false);
    }
    expect(Object.isFrozen(env.data.ITEMS)).toBe(true);
    expect(() => (env.data.ITEMS as unknown[]).push({ count: 2 })).toThrow(TypeError);
    const copy = env.toCamelCase();
    copy.config.nested.count = 7;
    copy.items[0].count = 8;
    expect(copy.config.nested.count).toBe(7);
    expect(copy.items[0].count).toBe(8);
    expect(env.data.CONFIG.nested.count).toBe(1);
    expect(env.data.ITEMS[0].count).toBe(1);
    expect(env.meta.ITEMS.val[0].count).toBe(1);
  });

  it('preserves Zod readonly map and set types without promising runtime immutability', () => {
    const env = Env.fromZod(
      {
        LIMITS: z
          .array(z.tuple([z.string(), z.number()]))
          .transform((entries) => new Map(entries))
          .readonly(),
        TAGS: z
          .array(z.string())
          .transform((tags) => new Set(tags))
          .readonly(),
        START_AT: z.coerce.date().readonly(),
      },
      { LIMITS: '[["requests",100]]', TAGS: '["initial"]', START_AT: '2026-10-12' },
    );

    expectTypeOf(env.data.LIMITS).toEqualTypeOf<ReadonlyMap<string, number>>();
    expectTypeOf(env.data.TAGS).toEqualTypeOf<ReadonlySet<string>>();
    expectTypeOf(env.data.START_AT).toEqualTypeOf<Date>();
    expect(Object.isFrozen(env.data.LIMITS)).toBe(true);
    expect(Object.isFrozen(env.data.TAGS)).toBe(true);
    expect(Object.isFrozen(env.data.START_AT)).toBe(true);
    (env.data.LIMITS as Map<string, number>).set('requests', 200);
    (env.data.TAGS as Set<string>).add('added');
    env.data.START_AT.setUTCFullYear(2027);
    expect(env.data.LIMITS.get('requests')).toBe(200);
    expect(env.data.TAGS.has('added')).toBe(true);
    expect(env.meta.START_AT.val.getUTCFullYear()).toBe(2027);
  });

  it('reports top-level camelCase collisions only when conversion is requested', () => {
    const schema = z.object({
      FOO_BAR: z.string(),
      fooBar: z.string().optional(),
    });

    const env = Env.fromZod(schema, {
      FOO_BAR: 'fromSnake',
      fooBar: 'fromCamel',
    });

    expect(env.data.FOO_BAR).toBe('fromSnake');
    expect(env.data.fooBar).toBe('fromCamel');
    expect(() => env.toCamelCase()).toThrow(
      'key collision at $: "FOO_BAR" and "fooBar" both become "fooBar"',
    );
  });

  it('supports constructing from a plain ZodRawShape', () => {
    const env = Env.fromZod(
      {
        PORT: z.number(),
        NAME: z.string(),
      },
      {
        PORT: '3000',
        NAME: ' example ',
        EXTRA: 'This is not included in the schema but it should not cause a failure',
      },
    );

    expect(env.schema).toBeInstanceOf(ZodObject);
    expect(env.data.PORT).toBe(3000);
    expect(env.data.NAME).toBe(' example ');
  });

  it('infers a string schema from an env var name list', () => {
    const env = Env.fromNames(['FOO', 'BAR', 'MISSING'] as const, {
      FOO: 'hello',
      BAR: ' world ',
      EXTRA: 'value',
    });

    expect(env.schema.shape.FOO).toBeDefined();
    expect(env.schema.shape.BAR).toBeDefined();
    expect(env.schema.shape.MISSING).toBeDefined();

    expect(env.data.FOO).toBe('hello');
    expect(env.data.BAR).toBe(' world ');
    expect(env.data.MISSING).toBe(undefined);

    expect(env.meta.FOO).toEqual({
      name: 'FOO',
      val: 'hello',
      raw: 'hello',
    });
    expect(env.meta.BAR).toEqual({
      name: 'BAR',
      val: ' world ',
      raw: ' world ',
    });
    expect(env.meta.MISSING).toEqual({
      name: 'MISSING',
      val: undefined,
      raw: undefined,
    });
    expect(env.keys).toEqual({
      FOO: 'FOO',
      BAR: 'BAR',
      MISSING: 'MISSING',
    });
  });

  it.each([
    ['true', true],
    ['1', true],
    ['on', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['off', false],
    ['no', false],
  ])('coerces boolean token %s to %s', (rawValue, expected) => {
    const schema = z.object({
      FLAG: z.boolean(),
    });

    const env = Env.fromZod(schema, { FLAG: rawValue });

    expect(env.data.FLAG).toBe(expected);
    expect(env.meta.FLAG).toEqual({
      name: 'FLAG',
      val: expected,
      raw: rawValue,
    });
  });

  it('throws a ZodError when boolean tokens are unrecognised', () => {
    const schema = z.object({
      FLAG: z.boolean(),
    });

    expect(() => Env.fromZod(schema, { FLAG: 'maybe' })).toThrow(ZodError);
  });

  it('throws a ZodError when numeric fields contain non-numeric data', () => {
    const schema = z.object({
      PORT: z.number(),
    });

    expect(() => Env.fromZod(schema, { PORT: 'not-a-number' })).toThrow(ZodError);
  });

  it('requires object-like fields to contain valid JSON', () => {
    const schema = z.object({
      CONFIG: z.object({ nested: z.string() }),
    });

    expect(() => Env.fromZod(schema, { CONFIG: '{broken json' })).toThrow(ZodError);

    const env = Env.fromZod(schema, { CONFIG: '{"nested":"value"}' });
    expect(env.data.CONFIG).toEqual({ nested: 'value' });
  });

  it('omits specified keys while preserving parsing and camel accessors', () => {
    const base = Env.fromZod(
      z.object({
        PORT: z.number(),
        TOKEN: z.string(),
        OPTIONAL: z.string().optional(),
      }),
      {
        PORT: '4200',
        TOKEN: 'secret',
        OPTIONAL: 'maybe',
        UNDECLARED_SECRET: 'another-secret',
      },
    );

    const withoutToken = base.omit('TOKEN');

    expect(withoutToken.data.PORT).toBe(4200);
    expect(withoutToken.data.OPTIONAL).toBe('maybe');
    expect('TOKEN' in withoutToken.data).toBe(false);
    expect(withoutToken.meta.PORT.val).toBe(4200);
    expect((withoutToken.data as any).TOKEN).toBeUndefined();
    expect('TOKEN' in withoutToken.meta).toBe(false);
    expect(withoutToken.source).toEqual({ PORT: '4200', OPTIONAL: 'maybe' });
    expect(withoutToken.source).not.toBe(base.source);
    expect(base.source.TOKEN).toBe('secret');
    expect(base.data.TOKEN).toBe('secret');
    expect(JSON.stringify(withoutToken)).not.toContain('secret');
    expect(withoutToken.keys).toEqual({
      PORT: 'PORT',
      OPTIONAL: 'OPTIONAL',
    });
    expect(withoutToken.toCamelCase()).toEqual({
      port: 4200,
      optional: 'maybe',
    });
  });

  it('throws when attempting to omit undeclared keys', () => {
    const base = Env.fromZod(
      z.object({
        PORT: z.number(),
      }),
      {
        PORT: '3000',
      },
    );

    expect(() => base.omit('MISSING' as any)).toThrowError(
      /Env\.omit\(\): attempted to omit undeclared key "MISSING"/,
    );
  });

  it('drops whole-object super-refinements from omit subsets', () => {
    const schema = z
      .object({
        USERNAME: z.string(),
        MIRROR: z.string(),
      })
      .superRefine((data, ctx) => {
        if (data.USERNAME !== data.MIRROR) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['MIRROR'],
            message: 'mirror must match username',
          });
        }
      });

    const env = Env.fromZod(schema, {
      USERNAME: 'admin',
      MIRROR: 'admin',
    });

    const subset = env.omit('MIRROR');
    expect(subset.data.USERNAME).toBe('admin');
    expect('MIRROR' in subset.data).toBe(false);
    expect(subset.source).toEqual({ USERNAME: 'admin' });
    expect(subset.schema.parse({ USERNAME: 'other' })).toEqual({ USERNAME: 'other' });
    expect(() => env.schema.parse({ USERNAME: 'other', MIRROR: 'admin' })).toThrow(
      /mirror must match username/,
    );

    expect(() =>
      Env.fromZod(schema, {
        USERNAME: 'admin',
        MIRROR: 'other',
      }).omit('MIRROR'),
    ).toThrowError(/mirror must match username/);
  });

  it('preserves blank strings and distinguishes them from missing values', () => {
    const schema = z.object({
      OPTIONAL: z.string().optional(),
      ALSO_OPTIONAL: z.number().optional(),
    });

    const withBlankString = Env.fromZod(schema, {
      OPTIONAL: '   ',
    });
    expect(withBlankString.data.OPTIONAL).toBe('   ');
    expect(withBlankString.meta.OPTIONAL.raw).toBe('   ');
    expect(withBlankString.data.ALSO_OPTIONAL).toBeUndefined();

    expect(() =>
      Env.fromZod(schema, {
        ALSO_OPTIONAL: '',
      }),
    ).toThrow(ZodError);

    const missing = Env.fromZod(schema, {});
    expect(missing.data.OPTIONAL).toBeUndefined();
    expect(missing.data.ALSO_OPTIONAL).toBeUndefined();
    expect(missing.meta.OPTIONAL.raw).toBeUndefined();
    expect(missing.meta.ALSO_OPTIONAL.raw).toBeUndefined();
  });

  it('applies JSON parsing fallback for non-object schemas when possible', () => {
    const schema = z.object({
      ANYTHING: z.any(),
    });

    const env = Env.fromZod(schema, { ANYTHING: '{"answer":42}' });

    expect(env.data.ANYTHING).toEqual({ answer: 42 });
    expect(env.meta.ANYTHING.raw).toBe('{"answer":42}');
  });

  it('avoids JSON parsing literal-like strings in fallback mode', () => {
    const schema = z.object({
      FLAG: z.enum(['true', 'false']),
    });

    const env = Env.fromZod(schema, { FLAG: 'true' });

    expect(env.data.FLAG).toBe('true');
    expect(env.meta.FLAG.raw).toBe('true');
  });

  it('parses array fields from JSON strings', () => {
    const schema = z.object({
      TAGS: z.array(z.string()),
      PORTS: z.array(z.number()),
      SERVERS: z.array(z.object({ host: z.string(), port: z.number() })),
    });

    const env = Env.fromZod(schema, {
      TAGS: '["dev", "staging", "production"]',
      PORTS: '[3000, 8080, 9090]',
      SERVERS: '[{"host":"localhost","port":3000},{"host":"example.com","port":8080}]',
    });

    expect(env.data.TAGS).toEqual(['dev', 'staging', 'production']);
    expect(env.data.PORTS).toEqual([3000, 8080, 9090]);
    expect(env.data.SERVERS).toEqual([
      { host: 'localhost', port: 3000 },
      { host: 'example.com', port: 8080 },
    ]);

    expect(env.meta.TAGS).toEqual({
      name: 'TAGS',
      val: ['dev', 'staging', 'production'],
      raw: '["dev", "staging", "production"]',
    });
  });

  it('handles empty arrays', () => {
    const schema = z.object({
      ITEMS: z.array(z.string()),
      OPTIONAL_ITEMS: z.array(z.number()).optional(),
    });

    const env = Env.fromZod(schema, {
      ITEMS: '[]',
    });

    expect(env.data.ITEMS).toEqual([]);
    expect(env.data.OPTIONAL_ITEMS).toBeUndefined();
    expect(env.meta.ITEMS.val).toEqual([]);
  });

  it('throws ZodError when array fields contain invalid JSON', () => {
    const schema = z.object({
      TAGS: z.array(z.string()),
    });

    expect(() => Env.fromZod(schema, { TAGS: '[invalid json' })).toThrow(ZodError);
    expect(() => Env.fromZod(schema, { TAGS: 'not-an-array' })).toThrow(ZodError);
  });

  it('throws ZodError when array elements do not match schema', () => {
    const schema = z.object({
      PORTS: z.array(z.number()),
    });

    expect(() => Env.fromZod(schema, { PORTS: '["not", "numbers"]' })).toThrow(ZodError);
  });

  it('preserves whitespace in array JSON strings and trims values after parsing', () => {
    const schema = z.object({
      TAGS: z.array(z.string()),
    });

    const env = Env.fromZod(schema, {
      TAGS: ' ["foo", "bar"] ',
    });

    expect(env.data.TAGS).toEqual(['foo', 'bar']);
    expect(env.meta.TAGS.raw).toBe(' ["foo", "bar"] ');
  });

  it('creates a scoped Env via pick with an independent source containing only selected keys', () => {
    const baseEnv = Env.fromNames(['FOO', 'BAR', 'BAZ'] as const, {
      FOO: ' foo ',
      BAR: 'bar',
      BAZ: 'baz',
      UNDECLARED_SECRET: 'secret',
    });

    const subset = baseEnv.pick('FOO', 'BAR');

    expect(subset.data.FOO).toBe(' foo ');
    expect(subset.data.BAR).toBe('bar');
    expect(subset.keys).toEqual({ FOO: 'FOO', BAR: 'BAR' });
    expect(subset.meta.FOO.raw).toBe(' foo ');
    expect(subset.meta.BAR.raw).toBe('bar');
    expect(subset.source).toEqual({ FOO: ' foo ', BAR: 'bar' });
    expect(subset.source).not.toBe(baseEnv.source);
    expect(subset.data).toEqual({ FOO: ' foo ', BAR: 'bar' });
    expect(subset.toCamelCase()).toEqual({ foo: ' foo ', bar: 'bar' });
    expect(Object.keys(subset.meta)).toEqual(['FOO', 'BAR']);

    baseEnv.source.FOO = 'changed';
    expect(subset.source.FOO).toBe(' foo ');
    subset.source.BAR = 'subset-only';
    expect(baseEnv.source.BAR).toBe('bar');
  });

  it('drops whole-object checks when using pick, even when all keys are retained', () => {
    const schema = z
      .object({
        FLAG: z.literal('enabled'),
        SECRET: z.string().optional(),
      })
      .check(
        z.superRefine((data, ctx) => {
          if (data.FLAG === 'enabled' && !data.SECRET) {
            ctx.addIssue({
              code: 'custom',
              message: 'SECRET is required when FLAG is enabled',
            });
          }
        }),
      );

    const env = Env.fromZod(schema, {
      FLAG: 'enabled',
      SECRET: 'shh',
    });

    const subset = env.pick('FLAG', 'SECRET');

    expect(subset.schema.parse({ FLAG: 'enabled' })).toEqual({ FLAG: 'enabled' });
    expect(() => env.schema.parse({ FLAG: 'enabled' })).toThrow(ZodError);
    expect(() => subset.schema.parse({ FLAG: 'disabled' })).toThrow(ZodError);
  });

  it.each(['pick', 'omit'] as const)(
    '%s retains field validation, transforms, defaults, and nested refinements',
    (method) => {
      const schema = z
        .object({
          PORT: z
            .number()
            .int()
            .positive()
            .refine((port) => port !== 8080, 'reserved port'),
          LABEL: z.string().transform((label) => label.trim()),
          DEFAULTED: z.number().default(3000),
          OPTIONAL: z.string().optional(),
          RANGE: z
            .object({ min: z.number(), max: z.number() })
            .refine((range) => range.min <= range.max, 'invalid range'),
          SECRET: z.string(),
        })
        .refine((data) => data.SECRET === 'secret', 'invalid secret');
      const source = {
        PORT: '4200',
        LABEL: ' hello ',
        RANGE: '{"min":1,"max":2}',
        SECRET: 'secret',
      };
      const env = Env.fromZod(schema, source);
      // Narrowing reads current values but does not run the whole-object rule.
      source.SECRET = 'changed';
      const narrow = () =>
        method === 'pick'
          ? env.pick('PORT', 'LABEL', 'DEFAULTED', 'OPTIONAL', 'RANGE')
          : env.omit('SECRET');
      const subset = narrow();

      expect(subset.data).toEqual({
        PORT: 4200,
        LABEL: 'hello',
        DEFAULTED: 3000,
        OPTIONAL: undefined,
        RANGE: { min: 1, max: 2 },
      });
      expect(subset.source).toEqual({
        PORT: '4200',
        LABEL: ' hello ',
        DEFAULTED: undefined,
        OPTIONAL: undefined,
        RANGE: '{"min":1,"max":2}',
      });
      expect(subset.meta.LABEL).toEqual({ name: 'LABEL', raw: ' hello ', val: 'hello' });
      expectTypeOf(subset.data.PORT).toEqualTypeOf<number>();
      expectTypeOf(subset.data.OPTIONAL).toEqualTypeOf<string | undefined>();
      expect(() => subset.schema.parse({ ...subset.data, PORT: -1 })).toThrow(ZodError);
      expect(() => subset.schema.parse({ ...subset.data, PORT: 8080 })).toThrow(/reserved port/);
      expect(() => subset.schema.parse({ ...subset.data, RANGE: { min: 2, max: 1 } })).toThrow(
        /invalid range/,
      );
      source.PORT = '8080';
      expect(narrow).toThrow(/reserved port/);
      expect(env.data.PORT).toBe(4200);
    },
  );

  it('supports empty subsets and chained narrowing without restoring excluded fields', () => {
    const env = Env.fromNames(['FOO', 'BAR'], { FOO: 'foo', BAR: 'bar', SECRET: 'secret' });
    const subset = env.pick('FOO', 'BAR').omit('BAR').pick('FOO');
    expect(subset.source).toEqual({ FOO: 'foo' });
    expect(env.omit().source).toEqual({ FOO: 'foo', BAR: 'bar' });
    for (const empty of [env.pick(), env.omit('FOO', 'BAR')]) {
      expect(empty.source).toEqual({});
      expect(empty.data).toEqual({});
      expect(empty.meta).toEqual({});
      expect(empty.toCamelCase()).toEqual({});
      expect(empty.keys).toEqual({});
    }
    expect(() => subset.pick('BAR' as any)).toThrow(/undeclared key "BAR"/);
  });

  it('uses field output types and values after dropping whole-object transforms', () => {
    const env = Env.fromZod(
      z
        .object({ COUNT: z.string(), SECRET: z.string() })
        .transform((data) => ({ COUNT: Number(data.COUNT), ADDED: data.SECRET })),
      { COUNT: '42', SECRET: 'secret' },
    );
    const picked = env.pick('COUNT');
    const omitted = env.omit('SECRET');
    expectTypeOf(picked).toEqualTypeOf<EnvPick<typeof env, 'COUNT'>>();
    expectTypeOf(omitted).toEqualTypeOf<typeof picked>();
    expectTypeOf(picked.data.COUNT).toEqualTypeOf<string>();
    expectTypeOf(omitted.data.COUNT).toEqualTypeOf<string>();
    for (const subset of [picked, omitted]) {
      expect(subset.data).toEqual({ COUNT: '42' });
      expect(subset.toCamelCase()).toEqual({ count: '42' });
      expect(subset.meta.COUNT.val).toBe('42');
      expect(subset.source).toEqual({ COUNT: '42' });
      expect(subset.schema.parse({ COUNT: '43' })).toEqual({ COUNT: '43' });
    }
    expect(env.data).toEqual({ COUNT: 42, ADDED: 'secret' });
  });

  describe('factory helpers', () => {
    it('creates an Env via fromZod', () => {
      const schema = z.object({
        API_KEY: z.string(),
      });

      const env = Env.fromZod(schema, { API_KEY: 'secret' });

      expect(env.data.API_KEY).toBe('secret');
      expect(env.schema).toBe(schema);
    });

    it('creates an Env via fromZod using a raw schema shape', () => {
      const env = Env.fromZod(
        {
          PORT: z.number(),
          HOST: z.string(),
        },
        {
          PORT: '7000',
          HOST: ' example.net ',
        },
      );

      expect(env.data.PORT).toBe(7000);
      expect(env.data.HOST).toBe(' example.net ');
      expect(env.schema.shape.PORT).toBeDefined();
    });

    it('creates an Env via fromNames', () => {
      const env = Env.fromNames(['FOO', 'BAR'] as const, {
        FOO: ' value ',
        BAR: 'other',
      });

      expect(env.data.FOO).toBe(' value ');
      expect(env.data.BAR).toBe('other');
      expect(env.schema.shape.FOO).toBeDefined();
    });

    it('creates an Env via fromZod with transformed outputs', () => {
      const schema = z
        .object({
          PORT: z.string().min(1),
          API_KEY: z.string().transform((val) => val.trim()),
        })
        .transform((data) => ({
          PORT: Number(data.PORT),
          API_KEY: data.API_KEY,
        }));

      const env = Env.fromZod(schema, {
        PORT: '8080',
        API_KEY: '  secret  ',
      });

      expect(env.data.PORT).toBe(8080);
      expect(env.meta.PORT).toEqual({
        name: 'PORT',
        val: 8080,
        raw: '8080',
      });
      expect(env.data.API_KEY).toBe('secret');
      expect(env.meta.API_KEY.val).toBe('secret');
      expect(env.toCamelCase().port).toBe(8080);
      expect(env.schema.shape.PORT).toBeDefined();
    });

    it('reflects transform additions, removals, and type changes in accessors', () => {
      const schema = z
        .object({
          COUNT: z.string(),
          OPTIONAL_FLAG: z.string().optional(),
          REMOVE_ME: z.string(),
        })
        .transform((input) => {
          const count = Number(input.COUNT);
          return {
            COUNT: count,
            ADDED_FIELD: `count:${count}`,
            OPTIONAL_FLAG: input.OPTIONAL_FLAG ? true : false,
          };
        });

      const env = Env.fromZod(schema, {
        COUNT: '42',
        REMOVE_ME: 'this-will-be-removed',
      });

      expect(env.data.COUNT).toBe(42);
      expect(env.data.ADDED_FIELD).toBe('count:42');
      expect(env.data.OPTIONAL_FLAG).toBe(false);
      expectTypeOf<
        'REMOVE_ME' extends keyof typeof env.data ? true : false
      >().toEqualTypeOf<false>();
      expect((env.data as any)['REMOVE_ME']).toBeUndefined();
      expect(env.toCamelCase().count).toBe(42);
      expect(env.toCamelCase().addedField).toBe('count:42');
      expect(env.toCamelCase().optionalFlag).toBe(false);

      type ExpectedCamel = {
        count: number;
        addedField: string;
        optionalFlag: boolean;
      };

      expectTypeOf(env.toCamelCase()).toEqualTypeOf<ExpectedCamel>();
      expect(env.toCamelCase()).not.toHaveProperty('removeMe');

      type ExpectedData = {
        readonly COUNT: number;
        readonly OPTIONAL_FLAG: boolean;
        readonly ADDED_FIELD: string;
      };

      expectTypeOf(env.data).toEqualTypeOf<ExpectedData>();
    });

    it('infers schema from values via fromValues', () => {
      const env = Env.fromValues({
        ANTHROPIC_API_KEY: ' test-anthropic-key ',
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
        OPENAI_API_KEY: 'test-openai-key',
      });

      expect(env.data.ANTHROPIC_API_KEY).toBe(' test-anthropic-key ');
      expect(env.data.GOOGLE_GENERATIVE_AI_API_KEY).toBe('test-google-key');
      expect(env.data.OPENAI_API_KEY).toBe('test-openai-key');
      expect(env.keys).toEqual({
        ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
        GOOGLE_GENERATIVE_AI_API_KEY: 'GOOGLE_GENERATIVE_AI_API_KEY',
        OPENAI_API_KEY: 'OPENAI_API_KEY',
      });
    });
  });
});

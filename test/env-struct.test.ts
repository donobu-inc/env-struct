import { describe, expect, expectTypeOf, it } from 'vitest';
import { z, ZodError, ZodObject } from 'zod/v4';
import { Env } from '../src';

describe('Env', () => {
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
    expect(Object.isFrozen(env.camel)).toBe(true);

    expect(env.camel).toEqual({
      port: 8080,
      featureEnabled: true,
      config: { nested: 'value' },
      optional: '  whitespace is preserved for string fields  ',
      camelCased: 'alreadyCamel',
    });
    expect(env.camel.featureEnabled).toBe(true);
    expect(env.camel.camelCased).toBe('alreadyCamel');
  });

  it('camel accessor tolerates key collisions from snake/camel aliases', () => {
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
    expect(env.camel.fooBar).toBe('fromSnake');
  });

  it('supports constructing from a plain ZodRawShape', () => {
    const env = Env.fromSchema(
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
      },
    );

    const withoutToken = base.omit('TOKEN');

    expect(withoutToken.data.PORT).toBe(4200);
    expect(withoutToken.data.OPTIONAL).toBe('maybe');
    expect('TOKEN' in withoutToken.data).toBe(false);
    expect(withoutToken.meta.PORT.val).toBe(4200);
    expect((withoutToken.data as any).TOKEN).toBeUndefined();
    expect('TOKEN' in withoutToken.meta).toBe(false);
    expect(withoutToken.source).toBe(base.source);
    expect(withoutToken.keys).toEqual({
      PORT: 'PORT',
      OPTIONAL: 'OPTIONAL',
    });
    expect(withoutToken.camel).toEqual({
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

  it('continues to honour cross-field refinements for omit subsets', () => {
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

  it('creates a scoped Env via pick while sharing the same source', () => {
    const baseEnv = Env.fromNames(['FOO', 'BAR', 'BAZ'] as const, {
      FOO: ' foo ',
      BAR: 'bar',
      BAZ: 'baz',
    });

    const subset = baseEnv.pick('FOO', 'BAR');

    expect(subset.data.FOO).toBe(' foo ');
    expect(subset.data.BAR).toBe('bar');
    expect(subset.keys).toEqual({ FOO: 'FOO', BAR: 'BAR' });
    expect(subset.meta.FOO.raw).toBe(' foo ');
    expect(subset.meta.BAR.raw).toBe('bar');
  });

  it('preserves schema refinements when using pick', () => {
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

    expect(() =>
      subset.schema.parse({
        FLAG: 'enabled',
      }),
    ).toThrow(ZodError);
  });

  describe('factory helpers', () => {
    it('creates an Env via fromSchema', () => {
      const env = Env.fromSchema(
        {
          PORT: z.number(),
          HOST: z.string(),
        },
        {
          PORT: '5000',
          HOST: ' example.com ',
        },
      );

      expect(env.data.PORT).toBe(5000);
      expect(env.data.HOST).toBe(' example.com ');
    });

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
      expect(env.camel.port).toBe(8080);
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
      expect(env.camel.count).toBe(42);
      expect(env.camel.addedField).toBe('count:42');
      expect(env.camel.optionalFlag).toBe(false);

      type ExpectedCamel = {
        readonly count: number;
        readonly addedField: string;
        readonly optionalFlag: boolean;
      };

      expectTypeOf(env.camel).toEqualTypeOf<ExpectedCamel>();

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

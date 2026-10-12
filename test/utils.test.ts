import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod/v4';
import { Env } from '../src/env-struct.js';
import type { SnakeToCamelKey, snakeToCamel } from '../src/utils.js';

describe('snakeToCamel (type)', () => {
  it('camel-cases nested object structures', () => {
    type Input = {
      FOO_BAR: string;
      NESTED_VALUE: {
        CHILD_KEY: number;
        INNER_OBJECT: {
          DEEP_FLAG: boolean;
        };
      };
      MIXED: {
        AlreadyCamel: string;
      };
    };

    expectTypeOf<snakeToCamel<Input>>().toEqualTypeOf<{
      fooBar: string;
      nestedValue: {
        childKey: number;
        innerObject: {
          deepFlag: boolean;
        };
      };
      mixed: {
        AlreadyCamel: string;
      };
    }>();
  });

  it('handles tuples and arrays', () => {
    type Input = {
      ARRAY_ITEMS: Array<{ CHILD_FLAG: boolean }>;
      TUPLE_PAIR: [{ USER_ID: string }, { SESSION_ID: string }];
      READONLY_TUPLE: readonly [{ FIRST_NAME: string }, { LAST_NAME: string }];
    };

    expectTypeOf<snakeToCamel<Input>>().toEqualTypeOf<{
      arrayItems: Array<{ childFlag: boolean }>;
      tuplePair: [{ userId: string }, { sessionId: string }];
      readonlyTuple: readonly [{ firstName: string }, { lastName: string }];
    }>();
  });

  it('preserves readonly and optional modifiers at each level', () => {
    type Input = {
      readonly CONFIG_VALUE?: {
        readonly FIXED_KEY: string;
        MUTABLE_KEY: number;
      };
      ITEMS: ReadonlyArray<{ readonly ITEM_ID: string; ITEM_COUNT: number }>;
    };

    expectTypeOf<snakeToCamel<Input>>().toEqualTypeOf<{
      readonly configValue?: { readonly fixedKey: string; mutableKey: number };
      items: ReadonlyArray<{ readonly itemId: string; itemCount: number }>;
    }>();
  });

  it('aligns with Env.toCamelCase output', () => {
    const envSchema = z
      .object({
        STRING_REQUIRED: z.string(),
        STRING_OPTIONAL: z.string().optional(),
        NUMBER_REQUIRED: z.coerce.number(),
        NUMBER_OPTIONAL: z.coerce.number().optional(),
        BOOLEAN_REQUIRED: z.coerce.boolean(),
        BOOLEAN_OPTIONAL: z.coerce.boolean().optional(),
      })
      .transform((data) => {
        const result: {
          STRING_REQUIRED: string;
          STRING_OPTIONAL?: string;
          NUMBER_REQUIRED: string;
          NUMBER_OPTIONAL?: string;
          BOOLEAN_REQUIRED?: boolean;
          BOOLEAN_OPTIONAL: boolean;
          INTRODUCED_FIELD: string;
        } = {
          STRING_REQUIRED: data.STRING_REQUIRED.trim(),
          NUMBER_REQUIRED: `value:${data.NUMBER_REQUIRED}`,
          BOOLEAN_OPTIONAL: data.BOOLEAN_OPTIONAL ?? false,
          INTRODUCED_FIELD: `${data.STRING_REQUIRED.trim()}-${Number(data.NUMBER_REQUIRED)}`,
        };

        if (data.STRING_OPTIONAL) {
          result.STRING_OPTIONAL = data.STRING_OPTIONAL.toUpperCase();
        }

        if (data.NUMBER_OPTIONAL !== undefined) {
          result.NUMBER_OPTIONAL = `opt:${data.NUMBER_OPTIONAL}`;
        }

        if (data.BOOLEAN_REQUIRED) {
          result.BOOLEAN_REQUIRED = data.BOOLEAN_REQUIRED;
        }

        return result;
      });

    type CamelEnv = snakeToCamel<z.infer<typeof envSchema>>;

    expectTypeOf<CamelEnv>().toEqualTypeOf<{
      stringRequired: string;
      stringOptional?: string;
      numberRequired: string;
      numberOptional?: string;
      booleanRequired?: boolean;
      booleanOptional: boolean;
      introducedField: string;
    }>();

    const rawSource = {
      STRING_REQUIRED: '  hello ',
      STRING_OPTIONAL: 'optional',
      NUMBER_REQUIRED: '42',
      NUMBER_OPTIONAL: '7',
      BOOLEAN_REQUIRED: '',
      BOOLEAN_OPTIONAL: '1',
    } as const;

    const transformed = envSchema.parse(rawSource);

    expect(transformed).toStrictEqual({
      STRING_REQUIRED: 'hello',
      STRING_OPTIONAL: 'OPTIONAL',
      NUMBER_REQUIRED: 'value:42',
      NUMBER_OPTIONAL: 'opt:7',
      BOOLEAN_OPTIONAL: true,
      INTRODUCED_FIELD: 'hello-42',
    });
    expect(transformed.BOOLEAN_REQUIRED).toBeUndefined();

    const env = Env.fromZod(envSchema, rawSource);

    const camelEnv: CamelEnv = env.toCamelCase();

    expectTypeOf(env.toCamelCase()).toEqualTypeOf<CamelEnv>();

    expect(camelEnv).toMatchObject({
      stringRequired: 'hello',
      stringOptional: 'OPTIONAL',
      numberRequired: 'value:42',
      numberOptional: 'opt:7',
      booleanOptional: true,
      introducedField: 'hello-42',
    });

    expect(camelEnv.introducedField).toBe('hello-42');
    expect(camelEnv.booleanRequired).toBeUndefined();
  });

  it('converts snake_case strings while preserving mixed case', () => {
    expectTypeOf<SnakeToCamelKey<'FOO_BAR' | 'NODE_ENV' | 'PORT' | 'ApiKey'>>().toEqualTypeOf<
      'fooBar' | 'nodeEnv' | 'port' | 'ApiKey'
    >();
  });
});

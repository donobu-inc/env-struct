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
      readonly fooBar: string;
      readonly nestedValue: {
        readonly childKey: number;
        readonly innerObject: {
          readonly deepFlag: boolean;
        };
      };
      readonly mixed: {
        readonly AlreadyCamel: string;
      };
    }>();
  });

  it('handles tuples, arrays, maps, sets, and promises', () => {
    type Input = {
      ARRAY_ITEMS: Array<{ CHILD_FLAG: boolean }>;
      TUPLE_PAIR: [{ USER_ID: string }, { SESSION_ID: string }];
      READONLY_TUPLE: readonly [{ FIRST_NAME: string }, { LAST_NAME: string }];
      VALUE_MAP: Map<string, { INNER_KEY: string }>;
      VALUE_SET: Set<{ INNER_FLAG: boolean }>;
      FUTURE_RESULT: Promise<{ WILL_RUN: boolean }>;
    };

    expectTypeOf<snakeToCamel<Input>>().toEqualTypeOf<{
      readonly arrayItems: Array<{ readonly childFlag: boolean }>;
      readonly tuplePair: [{ readonly userId: string }, { readonly sessionId: string }];
      readonly readonlyTuple: readonly [
        { readonly firstName: string },
        { readonly lastName: string },
      ];
      readonly valueMap: Map<string, { readonly innerKey: string }>;
      readonly valueSet: Set<{ readonly innerFlag: boolean }>;
      readonly futureResult: Promise<{ readonly willRun: boolean }>;
    }>();
  });

  it('aligns with Env camel accessor output', () => {
    const envSchema = z
      .object({
        STRING_REQUIRED: z.string(),
        STRING_OPTIONAL: z.string().optional(),
        NUMBER_REQUIRED: z.coerce.number(),
        NUMBER_OPTIONAL: z.coerce.number().optional(),
        BOOLEAN_REQUIRED: z.coerce.boolean(),
        BOOLEAN_OPTIONAL: z.coerce.boolean().optional(),
        BIGINT_REQUIRED: z.coerce.bigint(),
        BIGINT_OPTIONAL: z.coerce.bigint().optional(),
      })
      .transform((data) => {
        const result: {
          STRING_REQUIRED: string;
          STRING_OPTIONAL?: string;
          NUMBER_REQUIRED: string;
          NUMBER_OPTIONAL?: string;
          BOOLEAN_REQUIRED?: boolean;
          BOOLEAN_OPTIONAL: boolean;
          BIGINT_REQUIRED: bigint;
          BIGINT_OPTIONAL?: bigint;
          INTRODUCED_FIELD: string;
        } = {
          STRING_REQUIRED: data.STRING_REQUIRED.trim(),
          NUMBER_REQUIRED: `value:${data.NUMBER_REQUIRED}`,
          BOOLEAN_OPTIONAL: data.BOOLEAN_OPTIONAL ?? false,
          BIGINT_REQUIRED: data.BIGINT_REQUIRED,
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

        if (data.BIGINT_OPTIONAL !== undefined) {
          result.BIGINT_OPTIONAL = data.BIGINT_OPTIONAL;
        }

        return result;
      });

    type CamelEnv = snakeToCamel<z.infer<typeof envSchema>>;

    expectTypeOf<CamelEnv>().toEqualTypeOf<{
      readonly stringRequired: string;
      readonly stringOptional?: string;
      readonly numberRequired: string;
      readonly numberOptional?: string;
      readonly booleanRequired?: boolean;
      readonly booleanOptional: boolean;
      readonly bigintRequired: bigint;
      readonly bigintOptional?: bigint;
      readonly introducedField: string;
    }>();

    const rawSource = {
      STRING_REQUIRED: '  hello ',
      STRING_OPTIONAL: 'optional',
      NUMBER_REQUIRED: '42',
      NUMBER_OPTIONAL: '7',
      BOOLEAN_REQUIRED: '',
      BOOLEAN_OPTIONAL: '1',
      BIGINT_REQUIRED: '64',
      BIGINT_OPTIONAL: '128',
    } as const;

    const transformed = envSchema.parse(rawSource);

    expect(transformed).toStrictEqual({
      STRING_REQUIRED: 'hello',
      STRING_OPTIONAL: 'OPTIONAL',
      NUMBER_REQUIRED: 'value:42',
      NUMBER_OPTIONAL: 'opt:7',
      BOOLEAN_OPTIONAL: true,
      BIGINT_REQUIRED: BigInt(64),
      BIGINT_OPTIONAL: BigInt(128),
      INTRODUCED_FIELD: 'hello-42',
    });
    expect(transformed.BOOLEAN_REQUIRED).toBeUndefined();

    const env = Env.fromZod(envSchema, rawSource);

    const camelEnv: CamelEnv = env.camel;

    expectTypeOf(env.camel).toEqualTypeOf<CamelEnv>();

    expect(camelEnv).toMatchObject({
      stringRequired: 'hello',
      stringOptional: 'OPTIONAL',
      numberRequired: 'value:42',
      numberOptional: 'opt:7',
      booleanOptional: true,
      bigintRequired: BigInt(64),
      bigintOptional: BigInt(128),
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

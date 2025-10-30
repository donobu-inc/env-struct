import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { snakeToCamel } from '../src/utils.js';

describe('snakeToCamel', () => {
  it('recursively converts object keys to camelCase', () => {
    const schema = z.object({
      FOO_BAR: z.string(),
      NESTED_VALUE: z.object({
        CHILD_KEY: z.number(),
      }),
      ARRAY_ITEMS: z.array(
        z.object({
          CHILD_FLAG: z.boolean(),
        }),
      ),
    });

    const camelSchema = snakeToCamel(schema);

    expect(camelSchema.shape.fooBar).toBeDefined();

    const nested = camelSchema.shape.nestedValue;
    expect(nested).toBeInstanceOf(z.ZodObject);
    expect(nested.shape.childKey).toBeDefined();

    const arraySchema = camelSchema.shape.arrayItems;
    expect(arraySchema).toBeInstanceOf(z.ZodArray);
    const arrayItem = arraySchema.element;
    expect(arrayItem).toBeInstanceOf(z.ZodObject);
    expect(arrayItem.shape.childFlag).toBeDefined();
  });

  it('preserves optional, nullable, and default behavior', () => {
    const schema = z.object({
      OPTIONAL_VALUE: z.string().optional(),
      NULLABLE_VALUE: z.number().nullable().optional(),
      DEFAULT_VALUE: z.string().default('fallback'),
    });

    const camelSchema = snakeToCamel(schema);

    expect(camelSchema.shape.optionalValue?._def.typeName).toBe('ZodOptional');
    expect(camelSchema.shape.nullableValue?._def.typeName).toBe('ZodOptional');
    expect(camelSchema.shape.defaultValue?._def.typeName).toBe('ZodDefault');

    const parsed = camelSchema.parse({
      nullableValue: null,
    });

    expect(parsed.optionalValue).toBeUndefined();
    expect(parsed.nullableValue).toBeNull();
    expect(parsed.defaultValue).toBe('fallback');
  });

  it('preserves default factories across conversion', () => {
    let counter = 0;
    const schema = z.object({
      DYNAMIC_VALUE: z.string().default(() => `${++counter}`),
    });

    const camelSchema = snakeToCamel(schema);

    const first = camelSchema.parse({});
    const second = camelSchema.parse({});

    expect(first.dynamicValue).toBe('1');
    expect(second.dynamicValue).toBe('2');
  });

  it('supports records, tuples, unions, intersections, and primitives', () => {
    const recordSchema = z.record(
      z.string(),
      z.object({
        INNER_FLAG: z.boolean(),
      }),
    );
    const tupleSchema = z.tuple([
      z.object({ FIRST_NAME: z.string() }),
      z.object({ LAST_NAME: z.string() }),
    ]);
    const unionSchema = z.union([
      z.object({ FOO_BAR: z.literal('one') }),
      z.object({ BAZ_QUX: z.literal('two') }),
    ]);
    const intersectionSchema = z.intersection(
      z.object({ FOO_BAR: z.string() }),
      z.object({ BAZ_QUX: z.number() }),
    );

    const convertedRecord = snakeToCamel(recordSchema);
    const convertedTuple = snakeToCamel(tupleSchema);
    const convertedUnion = snakeToCamel(unionSchema);
    const convertedIntersection = snakeToCamel(intersectionSchema);
    const primitiveSchema = z.string();

    const untouchedPrimitive = snakeToCamel(primitiveSchema);
    expect(untouchedPrimitive).toBe(primitiveSchema);

    const recordValue = convertedRecord.parse({
      group: { innerFlag: true },
    });

    expect(recordValue.group.innerFlag).toBe(true);

    const tupleValue = convertedTuple.parse([{ firstName: 'Ada' }, { lastName: 'Lovelace' }]);
    expect(tupleValue[0].firstName).toBe('Ada');
    expect(tupleValue[1].lastName).toBe('Lovelace');

    expect(convertedUnion.parse({ fooBar: 'one' }).fooBar).toBe('one');
    expect(convertedUnion.parse({ bazQux: 'two' }).bazQux).toBe('two');

    const intersectionValue = convertedIntersection.parse({ fooBar: 'hi', bazQux: 42 });
    expect(intersectionValue.fooBar).toBe('hi');
    expect(intersectionValue.bazQux).toBe(42);
  });
});

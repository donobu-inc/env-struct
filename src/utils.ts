import { z } from 'zod';

/**
 * Type-level string conversion from SNAKE_CASE to camelCase
 */
type SnakeToCamel<S extends string> = S extends `${infer T}_${infer U}`
  ? `${Lowercase<T>}${Capitalize<SnakeToCamel<U>>}`
  : Lowercase<S>;

/**
 * Recursively convert object shape keys from snake_case to camelCase at type level
 */
type SnakeToCamelShape<T extends z.ZodRawShape> = {
  [K in keyof T as K extends string ? SnakeToCamel<K> : K]: T[K] extends z.ZodObject<
    infer S extends z.ZodRawShape
  >
    ? z.ZodObject<SnakeToCamelShape<S>>
    : T[K] extends z.ZodArray<infer E>
      ? z.ZodArray<SnakeToCamelSchema<E>>
      : T[K] extends z.ZodOptional<infer O>
        ? z.ZodOptional<SnakeToCamelSchema<O>>
        : T[K] extends z.ZodNullable<infer N>
          ? z.ZodNullable<SnakeToCamelSchema<N>>
          : T[K] extends z.ZodDefault<infer D>
            ? z.ZodDefault<SnakeToCamelSchema<D>>
            : T[K];
};

/**
 * Type-level conversion for any Zod schema
 */
type SnakeToCamelSchema<T extends z.ZodTypeAny> =
  T extends z.ZodObject<infer S extends z.ZodRawShape>
    ? z.ZodObject<SnakeToCamelShape<S>>
    : T extends z.ZodArray<infer E>
      ? z.ZodArray<SnakeToCamelSchema<E>>
      : T extends z.ZodOptional<infer O>
        ? z.ZodOptional<SnakeToCamelSchema<O>>
        : T extends z.ZodNullable<infer N>
          ? z.ZodNullable<SnakeToCamelSchema<N>>
          : T extends z.ZodDefault<infer D>
            ? z.ZodDefault<SnakeToCamelSchema<D>>
            : T;

/**
 * Runtime string conversion from SNAKE_CASE to camelCase
 */
function convertSnakeToCamel(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively converts a Zod schema's field names from SNAKE_CASE to camelCase
 */
export function snakeToCamel<T extends z.ZodTypeAny>(schema: T): SnakeToCamelSchema<T> {
  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const newShape: Record<string, z.ZodTypeAny> = {};

    for (const [key, value] of Object.entries(shape)) {
      const camelKey = convertSnakeToCamel(key);
      newShape[camelKey] = snakeToCamel(value as z.ZodTypeAny);
    }

    return z.object(newShape) as SnakeToCamelSchema<T>;
  }

  // Handle ZodArray
  if (schema instanceof z.ZodArray) {
    return z.array(snakeToCamel(schema.element)) as SnakeToCamelSchema<T>;
  }

  // Handle ZodOptional
  if (schema instanceof z.ZodOptional) {
    return snakeToCamel(schema.unwrap()).optional() as SnakeToCamelSchema<T>;
  }

  // Handle ZodNullable
  if (schema instanceof z.ZodNullable) {
    return snakeToCamel(schema.unwrap()).nullable() as SnakeToCamelSchema<T>;
  }

  // Handle ZodDefault
  if (schema instanceof z.ZodDefault) {
    const innerSchema = snakeToCamel(schema.removeDefault());
    return innerSchema.default(schema._def.defaultValue()) as SnakeToCamelSchema<T>;
  }

  // Handle ZodRecord
  if (schema instanceof z.ZodRecord) {
    const keySchema = schema._def.keyType;
    const valueSchema = schema._def.valueType;
    return z.record(keySchema, snakeToCamel(valueSchema)) as unknown as SnakeToCamelSchema<T>;
  }

  // Handle ZodTuple
  if (schema instanceof z.ZodTuple) {
    const items = schema._def.items.map((item: z.ZodTypeAny) => snakeToCamel(item));
    return z.tuple(items as any) as unknown as SnakeToCamelSchema<T>;
  }

  // Handle ZodUnion
  if (schema instanceof z.ZodUnion) {
    const options = schema._def.options.map((option: z.ZodTypeAny) => snakeToCamel(option));
    return z.union(options as any) as unknown as SnakeToCamelSchema<T>;
  }

  // Handle ZodIntersection
  if (schema instanceof z.ZodIntersection) {
    return z.intersection(
      snakeToCamel(schema._def.left),
      snakeToCamel(schema._def.right),
    ) as unknown as SnakeToCamelSchema<T>;
  }

  // For all other types (primitives, etc.), return as-is
  return schema as SnakeToCamelSchema<T>;
}

type Primitive = string | number | boolean | null | undefined;

/**
 * Lowercase all-caps strings while leaving mixed-case names intact.
 * This mirrors the runtime casing logic used by `Env.toCamelCase()`.
 */
type NormalizePlain<S extends string> = S extends Uppercase<S> ? Lowercase<S> : S;

/**
 * Type-level string conversion from `SNAKE_CASE` (or all-caps) to `camelCase`.
 */
export type SnakeToCamelKey<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Lowercase<Head>}${Tail extends '' ? '' : Capitalize<SnakeToCamelKey<Tail>>}`
  : NormalizePlain<S>;

/**
 * Recursively camel-case keys and nested values, preserving property modifiers.
 */
type SnakeToCamelObject<T> = {
  [K in keyof T as K extends string ? SnakeToCamelKey<K> : K]: snakeToCamel<T[K]>;
};

type SnakeToCamelArray<T extends readonly unknown[]> = {
  [K in keyof T]: snakeToCamel<T[K]>;
};

/**
 * Recursively convert keys on JSON-shaped values from `SNAKE_CASE` (or ALL_CAPS) to `camelCase`.
 * Preserves existing readonly and optional modifiers without adding new ones.
 * Known non-JSON values map to never. Plain-object and finite-number restrictions
 * are checked at runtime by Env.toCamelCase(); TypeScript cannot express them fully.
 */
export type snakeToCamel<T> = 0 extends 1 & T
  ? T
  : unknown extends T
    ? unknown
    : T extends Primitive
      ? T
      : T extends
            | bigint
            | symbol
            | Function
            | Date
            | RegExp
            | ReadonlyMap<unknown, unknown>
            | ReadonlySet<unknown>
            | WeakMap<object, unknown>
            | WeakSet<object>
            | PromiseLike<unknown>
            | ArrayBuffer
            | ArrayBufferView
        ? never
        : T extends readonly unknown[]
          ? SnakeToCamelArray<T>
          : T extends object
            ? SnakeToCamelObject<T>
            : never;

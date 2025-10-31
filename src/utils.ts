type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Lowercase all-caps strings while leaving mixed-case names intact.
 * This mirrors the runtime casing logic used by `Env.fromZod().camel`.
 */
type NormalizePlain<S extends string> = S extends Uppercase<S> ? Lowercase<S> : S;

/**
 * Type-level string conversion from `SNAKE_CASE` (or all-caps) to `camelCase`.
 */
export type SnakeToCamelKey<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Lowercase<Head>}${Tail extends '' ? '' : Capitalize<SnakeToCamelKey<Tail>>}`
  : NormalizePlain<S>;

/**
 * Recursively camel-case keys and nested values.
 */
type SnakeToCamelObject<T> = {
  readonly [K in keyof T as K extends string ? SnakeToCamelKey<K> : K]: snakeToCamel<T[K]>;
};

type SnakeToCamelArray<T extends readonly unknown[]> = {
  [K in keyof T]: snakeToCamel<T[K]>;
};

/**
 * Recursively convert keys on arbitrary structures from `SNAKE_CASE` (or ALL_CAPS) to `camelCase`.
 * Designed for `z.infer` outputs, but works with any nested object, array, map, or promise.
 */
export type snakeToCamel<T> = T extends Primitive
  ? T
  : T extends (...args: any[]) => unknown
    ? T
    : T extends Promise<infer U>
      ? Promise<snakeToCamel<U>>
      : T extends Map<infer K, infer V>
        ? Map<snakeToCamel<K>, snakeToCamel<V>>
        : T extends ReadonlyMap<infer K, infer V>
          ? ReadonlyMap<snakeToCamel<K>, snakeToCamel<V>>
          : T extends Set<infer Item>
            ? Set<snakeToCamel<Item>>
            : T extends ReadonlySet<infer Item>
              ? ReadonlySet<snakeToCamel<Item>>
              : T extends WeakMap<infer K, infer V>
                ? WeakMap<K, snakeToCamel<V>>
                : T extends WeakSet<infer Item>
                  ? WeakSet<Item>
                  : T extends readonly unknown[]
                    ? SnakeToCamelArray<T>
                    : T extends object
                      ? SnakeToCamelObject<T>
                      : T;

import { z } from 'zod/v4';
import type { ZodObject, ZodRawShape, ZodType } from 'zod/v4';
import type { snakeToCamel } from './utils.js';

export type EnvSource = Record<string, string | undefined>;

/** Helper to infer per-key value types from the Zod object. */
export type InferEnv<S extends ZodRawShape> = { [K in keyof S]: z.infer<S[K]> };

/**
 * Creates a frozen record that maps each literal in the env var list back to itself.
 * Consumers rely on this to keep compile-time and runtime views of env var names aligned.
 */
const createEnvVarNames = <const Names extends readonly string[]>(
  names: Names,
): Readonly<{ [K in Names[number]]: K }> => {
  const result = {} as { [K in Names[number]]: K };

  for (const name of names) {
    const key = name as Names[number];
    result[key] = key;
  }

  return Object.freeze(result);
};

/** Shape built when only variable names are provided. */
type EnvShapeFromNames<Names extends readonly string[]> = {
  [K in Names[number]]: z.ZodOptional<z.ZodString>;
};

type EnvShapeFromRecord<Source extends EnvSource> = {
  [K in keyof Source & string]: z.ZodOptional<z.ZodString>;
};

/** Per-variable reflection and value. */
export interface EnvVar<TValue, TName extends string> {
  readonly name: TName;
  readonly val: TValue;
  readonly raw: string | undefined;
}

type ZodTypeAny = z.ZodType<any, any, any>;
type ZodRecordSchema = z.ZodType<Record<string, unknown>, any, any>;

type ParsedValue<
  Parsed extends Record<string, unknown>,
  Key extends string,
> = Key extends keyof Parsed ? Parsed[Key] : undefined;

type ParserOutputForSchema<S extends ZodRawShape, TSchema extends ZodRecordSchema> =
  z.output<TSchema> extends Record<string, unknown> ? z.output<TSchema> : never;

type DefaultParsed<S extends ZodRawShape> = { [K in keyof S & string]: z.infer<S[K]> };

type MetaByKey<S extends ZodRawShape, Parsed extends Record<string, unknown>> = Readonly<{
  [K in keyof S & string]: EnvVar<ParsedValue<Parsed, K>, K>;
}>;

/** Readonly view into parsed env variable values keyed by original env-var names. */
type RetainedKey<
  S extends ZodRawShape,
  Parsed extends Record<string, unknown>,
  Key extends keyof S & string,
> = Key extends keyof Parsed ? Key : never;

type RetainedKeys<S extends ZodRawShape, Parsed extends Record<string, unknown>> = {
  [K in keyof S & string]: RetainedKey<S, Parsed, K>;
}[keyof S & string];

type DataAccessor<S extends ZodRawShape, Parsed extends Record<string, unknown>> = Readonly<
  Parsed & {
    [K in RetainedKeys<S, Parsed>]: Parsed[K];
  }
>;

/** Readonly camelCase view into parsed env variable values. */
type CamelDataAccessor<Parsed extends Record<string, unknown>> = snakeToCamel<Parsed>;

type EnvVarNames<S extends ZodRawShape> = Readonly<{
  [K in keyof S & string]: K;
}>;

type PickShape<S extends ZodRawShape, Keys extends keyof S & string> = {
  [K in Keys]: S[K];
};

type PickParsed<Parsed extends Record<string, unknown>, Keys extends string> = {
  [K in Keys]: ParsedValue<Parsed, K>;
};

export type EnvShapeOf<TEnv extends EnvImpl<any, any>> =
  TEnv extends EnvImpl<infer S, any> ? S : never;

export type EnvParsedOf<TEnv extends EnvImpl<any, any>> =
  TEnv extends EnvImpl<any, infer Parsed> ? Parsed : never;

export type EnvPick<
  TEnv extends EnvImpl<any, any>,
  Keys extends keyof EnvShapeOf<TEnv> & string,
> = EnvImpl<PickShape<EnvShapeOf<TEnv>, Keys>, PickParsed<EnvParsedOf<TEnv>, Keys>>;

/** Resolve a default env source that works in Node and non-Node runtimes. */
const getDefaultEnvSource = (): EnvSource => {
  const env = (globalThis as { process?: { env?: EnvSource } }).process?.env;
  return env ?? {};
};

/**
 * Opinionated, construction-time validator for environment variables.
 * - Single z.object(...) schema enables cross-field rules via check()/superRefine.
 * - Source is DI-friendly (defaults to process.env).
 * - Validation happens on construction; throws ZodError on failure.
 * - Ergonomics: `env.data` exposes parsed values directly, `env.meta.MY_VAR.val` for individual access.
 */
class EnvImpl<S extends ZodRawShape, Parsed extends Record<string, unknown> = DefaultParsed<S>> {
  /** Whole-object schema used for validation. */
  public readonly schema: ZodObject<S>;
  /** Parser that may wrap the base schema (e.g. via transform). */
  private readonly parser: ZodRecordSchema;
  /** Raw env-var source. */
  public readonly source: EnvSource;
  /** Per-key metadata including parsed and raw values. */
  public readonly meta: MetaByKey<S, Parsed>;
  /** Direct value access keyed by env var name. */
  public readonly data: DataAccessor<S, Parsed>;
  /** Direct value access keyed by camelCase env var name (best-effort; collisions prefer first key). */
  public readonly camel: CamelDataAccessor<Parsed>;
  /** Declared environment variable names preserved as a literal map. */
  public readonly keys: EnvVarNames<S>;

  private constructor(
    schema: ZodObject<S>,
    source: EnvSource | undefined,
    parser: ZodRecordSchema,
  ) {
    this.schema = schema;
    this.parser = parser;
    this.source = source ?? getDefaultEnvSource();
    const declaredKeys = Object.keys(this.schema.shape) as Array<keyof S & string>;
    const declaredSet = new Set(declaredKeys as readonly (keyof S & string)[]);
    this.keys = createEnvVarNames(declaredKeys as readonly (keyof S & string)[]);
    // Build candidates from raw strings with minimal coercion.
    const { parsed, rawByKey } = buildValues<S, Parsed>(this.schema, this.parser, this.source);
    const parsedValues = parsed;
    const parsedRecord = parsedValues as unknown as Record<string, unknown>;
    // Capture parsed values while building frozen metadata containers.
    const metaByKey = {} as {
      [K in keyof S & string]: EnvVar<ParsedValue<Parsed, K>, K>;
    };
    const dataAccessor = {} as DataAccessor<S, Parsed>;
    // `camel` mirrors the parsed values but exposes camelCase property names for convenience.
    // We keep this as a plain object so we can wire lazy getters that share the same parsed cache.
    const camelAccessor: Record<string, unknown> = {};
    // Populate metadata and value accessors for each declared key.
    for (const key of declaredKeys) {
      metaByKey[key] = Object.freeze({
        name: key,
        val: parsedRecord[key as string] as ParsedValue<Parsed, typeof key>,
        raw: rawByKey[key],
      });
      Object.defineProperty(dataAccessor, key, {
        enumerable: true,
        get: () => parsedRecord[key as string] as ParsedValue<Parsed, typeof key>,
      });
      const camelKey = snakeToCamelKey(key);
      if (Object.prototype.hasOwnProperty.call(parsedRecord, key as string)) {
        // If two schema keys normalize to the same camelCase form, prefer the first declaration.
        // This avoids throwing on duplicate `defineProperty` calls and leaves the camel view best-effort.
        if (Object.prototype.hasOwnProperty.call(camelAccessor, camelKey)) {
          continue;
        }
        Object.defineProperty(camelAccessor, camelKey, {
          enumerable: true,
          get: () => parsedRecord[key as string],
        });
      }
    }

    // Surface additional transform outputs on the data accessor.
    for (const key of Object.keys(parsedRecord)) {
      if (declaredSet.has(key as keyof S & string)) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(dataAccessor, key)) {
        continue;
      }
      Object.defineProperty(dataAccessor, key, {
        enumerable: true,
        get: () => parsedRecord[key],
      });
    }

    // Surface any additional fields produced by transforms on the camel accessor.
    for (const key of Object.keys(parsedRecord)) {
      if (declaredSet.has(key as keyof S & string)) {
        continue;
      }
      const camelKey = snakeToCamelKey(key);
      if (Object.prototype.hasOwnProperty.call(camelAccessor, camelKey)) {
        continue;
      }
      Object.defineProperty(camelAccessor, camelKey, {
        enumerable: true,
        get: () => parsedRecord[key],
      });
    }

    this.meta = Object.freeze(metaByKey) as MetaByKey<S, Parsed>;
    this.data = Object.freeze(dataAccessor);
    this.camel = Object.freeze(camelAccessor) as CamelDataAccessor<Parsed>;
  }

  /**
   * Create a new Env scoped to a subset of keys while reusing the same source.
   */
  public pick<const Keys extends readonly (keyof S & string)[]>(
    ...keys: Keys
  ): EnvImpl<PickShape<S, Keys[number]>, PickParsed<Parsed, Keys[number]>> {
    // Build a Zod pick mask keyed by the original schema names. We use a partial
    // record so the compiler accepts extra keys beyond the exact subset literal.
    const mask: Partial<Record<keyof S & string, true>> = {};

    for (const key of keys) {
      mask[key] = true;
    }

    // Start with a plain Zod-level pick so field-level constraints stay intact.
    let subsetSchema = this.schema.pick(mask as any) as unknown as ZodObject<{
      [K in Keys[number]]: S[K];
    }>;
    // Cross-field validations live inside the internal `_def.checks` array. If no
    // refinements exist we can return early with the simple pick result.
    const baseChecks = (
      this.schema as unknown as {
        _def?: { checks?: Array<{ _zod?: { check?: (val: unknown, ctx: unknown) => void } }> };
      }
    )._def?.checks;

    if (Array.isArray(baseChecks) && baseChecks.length > 0) {
      // Knowing which keys were picked lets us skip rehydrating values that callers
      // may want to intentionally leave blank during validation.
      const baseKeys = Object.keys(this.schema.shape) as Array<keyof S & string>;
      const picked = new Set(keys as readonly (keyof S & string)[]);
      subsetSchema = subsetSchema.check(
        z.superRefine((data, ctx) => {
          // Create a shallow copy of the parsed subset so we can layer in any missing
          // fields required by the original refinement logic.
          const snapshot = { ...(data as Record<string, unknown>) };

          for (const key of baseKeys) {
            if (picked.has(key)) {
              continue;
            }
            if (!(key in snapshot)) {
              // Feed previously parsed values back into the snapshot. This mirrors what
              // the original refinement saw without forcing new parsing work.
              snapshot[key] = (this.data as any)[key];
            }
          }

          for (const check of baseChecks) {
            const run = check?._zod?.check as
              | ((payload: {
                  value: unknown;
                  issues: unknown[];
                  addIssue: (issue: any) => void;
                }) => void)
              | undefined;
            if (typeof run === 'function') {
              const originalValue = ctx.value;
              try {
                // Temporarily mirror the full dataset so cross-field checks see prior values.
                ctx.value = snapshot as typeof data;
                run(
                  ctx as unknown as {
                    value: unknown;
                    issues: unknown[];
                    addIssue: (issue: any) => void;
                  },
                );
              } finally {
                // Restore the payload so other refinements (if any) receive the expected context.
                ctx.value = originalValue;
              }
            }
          }
        }),
      );
    }

    return EnvImpl.fromZodObject(subsetSchema, this.source) as EnvImpl<
      PickShape<S, Keys[number]>,
      PickParsed<Parsed, Keys[number]>
    >;
  }

  /**
   * Create a new Env without the specified keys while reusing the same source.
   * Throws if any omitted key was not declared on the original schema.
   */
  public omit<const Keys extends readonly (keyof S & string)[]>(
    ...keys: Keys
  ): EnvImpl<
    PickShape<S, Exclude<keyof S & string, Keys[number]>>,
    PickParsed<Parsed, Exclude<keyof S & string, Keys[number]>>
  > {
    const declaredKeys = Object.keys(this.schema.shape) as Array<keyof S & string>;
    const declaredSet = new Set(declaredKeys);

    for (const key of keys) {
      if (!declaredSet.has(key)) {
        throw new Error(`Env.omit(): attempted to omit undeclared key "${key}"`);
      }
    }

    const omitSet = new Set(keys as readonly (keyof S & string)[]);
    const kept = declaredKeys.filter((key) => !omitSet.has(key));

    const picked = this.pick(...(kept as readonly (keyof S & string)[]));
    return picked as unknown as EnvImpl<
      PickShape<S, Exclude<keyof S & string, Keys[number]>>,
      PickParsed<Parsed, Exclude<keyof S & string, Keys[number]>>
    >;
  }

  public static fromZod<const Shape extends ZodRawShape>(
    schema: Shape,
    source?: EnvSource,
  ): EnvImpl<Shape, DefaultParsed<Shape>>;
  public static fromZod<TSchema extends ZodRecordSchema>(
    schema: TSchema,
    source?: EnvSource,
  ): EnvImpl<InferSchemaShape<TSchema>, ParserOutputForSchema<InferSchemaShape<TSchema>, TSchema>>;
  public static fromZod(
    schema: ZodRecordSchema | ZodRawShape,
    source?: EnvSource,
  ): EnvImpl<any, any> {
    if (isZodType(schema)) {
      return EnvImpl.fromZodSchema(schema as ZodRecordSchema, source);
    }

    return EnvImpl.fromRawShape(schema as ZodRawShape, source);
  }

  /** @deprecated Use `Env.fromZod()` instead. */
  public static fromSchema<S extends ZodRawShape>(schema: S, source?: EnvSource): Env<S> {
    return EnvImpl.fromZod(schema, source) as Env<S>;
  }

  /** @deprecated Use `Env.fromZod()` instead. */
  public static fromZodObject<S extends ZodRawShape>(
    schema: ZodObject<S>,
    source?: EnvSource,
  ): EnvImpl<S, ParserOutputForSchema<S, typeof schema>> {
    return EnvImpl.fromZod(schema, source);
  }

  public static fromNames<const Names extends readonly string[]>(
    names: Names,
    source?: EnvSource,
  ): Env<EnvShapeFromNames<Names>> {
    const schema = buildSchemaFromNames(names);
    return new EnvImpl<EnvShapeFromNames<Names>>(schema, source, schema);
  }

  public static fromValues<const Source extends EnvSource>(
    values: Source,
  ): Env<EnvShapeFromRecord<Source>> {
    const names = Object.keys(values) as (keyof Source & string)[];
    const schema = buildSchemaFromNames(names as readonly (keyof Source & string)[]);

    return new EnvImpl(schema, values, schema);
  }

  private static fromRawShape<S extends ZodRawShape>(
    schema: S,
    source?: EnvSource,
  ): EnvImpl<S, DefaultParsed<S>> {
    const zodSchema = z.object(schema);
    return new EnvImpl<S, DefaultParsed<S>>(zodSchema, source, zodSchema);
  }

  private static fromZodSchema<TSchema extends ZodRecordSchema>(
    schema: TSchema,
    source?: EnvSource,
  ): EnvImpl<InferSchemaShape<TSchema>, ParserOutputForSchema<InferSchemaShape<TSchema>, TSchema>> {
    const objectSchema = resolveObjectSchema(schema) as ZodObject<InferSchemaShape<TSchema>>;
    return new EnvImpl<
      InferSchemaShape<TSchema>,
      ParserOutputForSchema<InferSchemaShape<TSchema>, TSchema>
    >(objectSchema, source, schema);
  }
}

export const Env = EnvImpl;
export type Env<
  S extends ZodRawShape,
  Parsed extends Record<string, unknown> = DefaultParsed<S>,
> = EnvImpl<S, Parsed>;

/* ---------------- Internal, opinionated parsing ---------------- */

function buildValues<S extends ZodRawShape, Parsed extends Record<string, unknown>>(
  schema: ZodObject<S>,
  parser: ZodRecordSchema,
  source: EnvSource,
) {
  const shape = schema.shape as unknown as Record<string, ZodType | undefined>;
  const rawByKey: Record<string, string | undefined> = {};
  const candidate: Record<string, unknown> = {};

  for (const key of Object.keys(shape)) {
    const raw = source[key];
    rawByKey[key] = raw;
    const fieldSchema = shape[key];
    candidate[key] = coerceValue(fieldSchema, raw);
  }

  // Enforce field-level and cross-field rules. Let ZodError bubble.
  const parsed = parser.parse(candidate) as Parsed;
  return { parsed, rawByKey };
}

function coerceValue(schema: ZodType | undefined, raw: string | undefined): unknown {
  if (raw == null) {
    return undefined;
  }

  const normalized = raw.trim();
  const baseSchema = unwrapType(schema);
  const typeName = getTypeTag(baseSchema?._def);

  // Object-like schemas: require valid JSON.
  if (typeName && isObjectLike(typeName)) {
    return mustJsonParse(raw);
  }

  // Numbers.
  if (typeName === 'ZodNumber' || typeName === 'number') {
    if (normalized === '') {
      return raw;
    }

    const n = Number(normalized);
    return Number.isNaN(n) ? raw : n;
  }

  // Booleans: true/false/1/0/on/off/yes/no (case-insensitive).
  if (typeName === 'ZodBoolean' || typeName === 'boolean') {
    const v = normalized.toLowerCase();

    if (v === 'true' || v === '1' || v === 'on' || v === 'yes') {
      return true;
    } else if (v === 'false' || v === '0' || v === 'off' || v === 'no') {
      return false;
    } else {
      return raw; // let Zod produce a precise error
    }
  }

  // Strings: preserve raw value.
  if (typeName === 'ZodString' || typeName === 'string') {
    return raw;
  }

  // Fallback: attempt JSON first; if parse fails, keep original string.
  try {
    const trimmed = normalized;
    if (trimmed !== '' && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      return JSON.parse(trimmed);
    }
  } catch {
    return raw;
  }

  return raw;
}

function unwrapType(schema: ZodType | undefined): ZodType | undefined {
  let current: ZodType | undefined = schema;
  const seen = new Set<ZodType>();

  while (current && !seen.has(current)) {
    seen.add(current);
    const def = current._def as unknown as {
      typeName?: string;
      type?: string;
      innerType?: ZodType;
      schema?: ZodType;
      out?: ZodType;
    } | null;
    const typeName = getTypeTag(def);

    if (
      typeName === 'ZodOptional' ||
      typeName === 'optional' ||
      typeName === 'ZodNullable' ||
      typeName === 'nullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'default' ||
      typeName === 'ZodCatch' ||
      typeName === 'catch' ||
      typeName === 'ZodReadonly' ||
      typeName === 'readonly'
    ) {
      current = def?.innerType;
      continue;
    }

    if (
      typeName === 'ZodEffects' ||
      typeName === 'effects' ||
      typeName === 'transform' ||
      typeName === 'ZodBranded' ||
      typeName === 'branded'
    ) {
      const next = def?.schema;
      if (next) {
        current = next;
        continue;
      }
      break;
    }

    if (typeName === 'ZodPipeline' || typeName === 'pipeline' || typeName === 'pipe') {
      const next = (def as { in?: ZodType | undefined })?.in ?? def?.out;
      if (next) {
        current = next;
        continue;
      }
      break;
    }

    break;
  }

  return current;
}

function getTypeTag(def: { typeName?: string; type?: string } | null | undefined) {
  if (!def) {
    return undefined;
  }

  return (def.typeName as string | undefined) ?? (def.type as string | undefined);
}

function isObjectLike(typeName: string): boolean {
  return (
    typeName === 'ZodObject' ||
    typeName === 'object' ||
    typeName === 'ZodArray' ||
    typeName === 'array' ||
    typeName === 'ZodRecord' ||
    typeName === 'record' ||
    typeName === 'ZodMap' ||
    typeName === 'map' ||
    typeName === 'ZodTuple' ||
    typeName === 'tuple' ||
    typeName === 'ZodSet' ||
    typeName === 'set'
  );
}

function mustJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s; // invalid JSON; schema.parse will surface a clear error
  }
}

function isZodType(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' && value !== null && typeof (value as ZodTypeAny).parse === 'function'
  );
}

function buildSchemaFromNames<const Names extends readonly string[]>(
  names: Names,
): ZodObject<EnvShapeFromNames<Names>> {
  const shape = Object.fromEntries(
    names.map((name) => [name, z.string().optional()] as const),
  ) as EnvShapeFromNames<Names>;
  return z.object(shape);
}

/**
 * Convert a declared schema key into its camelCase accessor form.
 * Keeps pre-camel keys intact while downcasing ALL_CAPS and SNAKE_CASE names.
 */
function snakeToCamelKey(key: string): string {
  if (key.includes('_')) {
    return key.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  }

  return key === key.toUpperCase() ? key.toLowerCase() : key;
}

type InferSchemaShape<TSchema extends ZodTypeAny> =
  TSchema extends z.ZodObject<infer Shape>
    ? Shape
    : TSchema extends { _def: { innerType: infer Inner } }
      ? Inner extends ZodTypeAny
        ? InferSchemaShape<Inner>
        : never
      : TSchema extends { _def: { schema: infer Inner } }
        ? Inner extends ZodTypeAny
          ? InferSchemaShape<Inner>
          : never
        : TSchema extends { _def: { in: infer Inner } }
          ? Inner extends ZodTypeAny
            ? InferSchemaShape<Inner>
            : never
          : TSchema extends { _def: { out: infer Inner } }
            ? Inner extends ZodTypeAny
              ? InferSchemaShape<Inner>
              : never
            : never;

function resolveObjectSchema(schema: ZodRecordSchema): ZodObject<any> {
  const base = unwrapType(schema);
  if (base instanceof z.ZodObject) {
    return base;
  }
  const typeName = getTypeTag(base?._def);

  if (!base || (typeName !== 'ZodObject' && typeName !== 'object')) {
    throw new Error('Env.fromZod(): schema must ultimately resolve to a ZodObject');
  }

  return base as ZodObject<any>;
}

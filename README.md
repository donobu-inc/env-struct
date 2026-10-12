# env-struct

Schema-first environment variable loading with Zod. `env-struct` gives you
strongly typed values, shallowly frozen metadata (name, raw string, parsed value), and
literal-preserving key accessors that keep TypeScript happy.

## Features

- Single Zod schema drives validation and parsing.
- Per-variable metadata alongside parsed values (`env.meta.FOO`).
- Accessors for values parsed and validated at construction (`env.data.FOO`).
- Literal map of declared keys (`env.keys.FOO`).
- Works with partial schemas via `pick`, raw sources via `fromValues`, and
  simple name lists via `fromNames`.

## Installation

```sh
npm install env-struct zod
```

## Quick start

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const schema = {
  PORT: z.number().default(3000),
  FEATURE_FLAG: z.enum(['on', 'off']).default('off'),
  ROUTES: z
    .object({
      api: z.string().url(),
      docs: z.string().url(),
    })
    .default({
      api: 'https://api.example.com',
      docs: 'https://docs.example.com',
    }),
};
// The data source defaults to process.env
const env = Env.fromZod(schema);

console.log(env.data.PORT); // already-parsed number
console.log(env.meta.FEATURE_FLAG); // { name, val, raw }
console.log(env.keys.PORT); // "PORT"
console.log(env.data.ROUTES.api); // structured field stays parsed
```

## Parsing and validation

Values are parsed and validated immediately when you create an `Env`. Invalid
configuration throws a `ZodError` from the factory call. The `data` getters return
already-parsed values; they do not defer validation. Changing the
source afterward does not refresh those values. Create a new `Env` to parse and
validate an updated source.

`Env.fromZod` converts raw environment strings before Zod validates them:

- **Numbers:** `z.number()` accepts numeric strings such as `"3000"` without an
  explicit coercion schema. Surrounding whitespace is trimmed for conversion.
- **Booleans:** `z.boolean()` accepts `true`/`false`, `1`/`0`, `on`/`off`, and
  `yes`/`no`, case-insensitively and with surrounding whitespace ignored.
  Unrecognized tokens fail validation.
- **Objects and arrays:** JSON strings are parsed, then validated against the
  field's schema. Invalid JSON or values that do not match the schema fail
  validation.
- **Strings:** Raw strings retain their whitespace unless the schema transforms
  them, for example with `z.string().trim()`.
- **Empty and missing values:** An empty string is distinct from a missing
  variable. Missing values are passed to Zod as `undefined`, allowing optional
  fields and defaults. An empty string remains a string for `z.string()` and
  fails validation for plain `z.number()` or `z.boolean()`, even when optional.
  Explicit coercion schemas or other Zod wrappers can change these outcomes.

The source is a record of raw strings or `undefined`, defaulting to `process.env`.
`env-struct` does not read `.env` files; load them separately before constructing
your `Env`.

The top-level environment variable name `__proto__` is unsupported. All factories
throw a `TypeError` if it is declared, before parsing source values.

## Mutability

The `data`, `meta`, and `keys` containers, along with each metadata entry,
are shallowly frozen. Parsed values retain the mutability defined by their schemas;
`env-struct` does not deeply freeze them. Changes to mutable values are not
revalidated. Nested values are shared between `data` and `meta.KEY.val`, so mutating
a value through one view affects the other. `toCamelCase()` returns an independent
copy that preserves schema-defined readonly protections.

Use Zod's `.readonly()` on fields where you want readonly types and shallow runtime
freezing:

```ts
const env = Env.fromZod(
  {
    CONFIG: z.object({ retries: z.number().int().positive() }).readonly(),
  },
  { CONFIG: '{"retries":3}' },
);

env.data.CONFIG.retries; // 3; assigning to retries is blocked
```

Zod's `.readonly()` applies at the schema level where you use it; nested objects
need their own `.readonly()` if they should also be frozen. It uses `Object.freeze()`,
which does not prevent mutation of `Map`, `Set`, or `Date` through their methods at
runtime. Readonly map and set types restrict mutation in TypeScript. Callers are
responsible for controlling mutation when sharing configuration.

## Examples

### Create a deep camelCase copy

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const env = Env.fromZod(
  {
    SERVICE_CONFIG: z.object({
      API_URL: z.string().url(),
      WORKERS: z.array(z.object({ MAX_RETRIES: z.number() })),
    }),
    OPTIONAL_TOKEN: z.string().optional(),
  },
  {
    SERVICE_CONFIG: '{"API_URL":"https://example.com","WORKERS":[{"MAX_RETRIES":3}]}',
  },
);

const config = env.toCamelCase();
console.log(config.serviceConfig.apiUrl);
console.log(config.serviceConfig.workers[0].maxRetries); // 3
console.log(config.optionalToken); // undefined

config.serviceConfig.workers[0].maxRetries = 5;
console.log(env.data.SERVICE_CONFIG.WORKERS[0].MAX_RETRIES); // still 3
```

Each call returns a fresh copy of the current parsed values, recursively converting
object keys, including record keys and objects inside arrays. It does not reread
the source or revalidate values. Existing camelCase names stay intact; all-uppercase
names are lowercased, and underscore-separated names are joined in camelCase.

Conversion supports plain objects, arrays, strings, finite numbers, booleans,
`null`, and `undefined` (for optional values). It preserves readonly modifiers and
runtime freezing where applied by the schema. Mutable values remain mutable in the
copy; no objects or arrays are shared with the original or with another call's result.

If two sibling keys such as `API_URL` and `apiUrl` become the same name,
`toCamelCase()` throws a `TypeError` identifying both keys and their path. It also
rejects circular references and non-JSON values such as `Date`, `Map`, `Set`,
class instances, functions, and bigints, with an error identifying their path.
Only ordinary enumerable data properties are copied; symbol keys and enumerable
accessor properties are rejected. These conversion errors occur when the method
is called; the original parsed values remain available through `.data`.

### Share scoped env helpers with `pick`

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const base = Env.fromZod({
  PORT: z.number().default(3000),
  FEATURE_FLAG: z.enum(['on', 'off', 'beta']).default('off'),
  DB_URL: z.string().url(),
});

// Derive a focused view for HTTP handlers that only need a subset.
const serverEnv = base.pick('PORT', 'FEATURE_FLAG');

serve({
  port: serverEnv.data.PORT,
  featureFlag: serverEnv.data.FEATURE_FLAG,
});
```

`pick()` and `omit()` create a smaller configuration with validation for the fields
you keep. Each result has its own `.source` containing only the retained schema
keys; excluded keys and unrelated source variables are removed. The original
`Env` is unchanged, and later source mutations are not shared between the two.

Narrowing reparses the retained fields from their current source values. Field
validation, defaults, and field transforms are preserved, including refinements
within nested field schemas. Whole-object refinements and transforms are dropped.
For example, a full configuration can require an API token when authentication is
enabled; after omitting the token, the subset no longer checks that relationship.
Use the full schema to validate a complete configuration, and the narrowed schema
to validate only the retained fields.

The narrowed `.schema` is a fresh `z.object` using Zod's default unknown-key
stripping behavior; original object-level strictness and catchall settings are
not carried over. Whole-object transform outputs are not carried over either:
subset values and their types come from the retained field schemas.

### Drop fields while preserving field validation with `omit`

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const fullEnv = Env.fromZod({
  PORT: z.number().default(3000),
  DB_URL: z.string().url(),
  DB_PASSWORD: z.string(),
});

// Narrow the exposed fields for consumers that only need the remaining values.
const scopedEnv = fullEnv.omit('DB_PASSWORD');

scopedEnv.data.PORT; // 3000
scopedEnv.data.DB_URL; // still validated
// DB_PASSWORD is removed from data, meta, keys, source, and toCamelCase() results.
scopedEnv.source.DB_PASSWORD; // undefined

// For logging, explicitly select fields that are safe to disclose.
const logConfig = { port: scopedEnv.data.PORT };
console.log(logConfig);
```

Removing a password field does not guarantee that the remaining fields are safe
to disclose: database URLs, for example, can also contain credentials. For logging
or sending configuration to a client, select explicitly allowlisted fields as above.

### Parse structured data from JSON env values

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const schema = {
  SERVICE_ROUTES: z.record(z.string(), z.string().url()),
  WORKERS: z
    .array(z.object({ name: z.string(), concurrency: z.number().int().min(1) }))
    .default([{ name: 'email', concurrency: 2 }]),
};

const env = Env.fromZod(schema, {
  SERVICE_ROUTES:
    '{"auth":"https://api.example.com/auth","billing":"https://api.example.com/billing"}',
  WORKERS: '[{"name":"email","concurrency":4},{"name":"cleanup","concurrency":1}]',
});

const billingUrl = env.data.SERVICE_ROUTES.billing;
const workerNames = env.data.WORKERS.map((worker) => worker.name);
```

## API overview

- `Env.fromZod(shapeOrSchema, source?)` - Build from a Zod schema (transforms supported).
- `Env.fromNames(names, source?)` - Treat listed names as optional strings.
- `Env.fromValues(record)` - Infer optional string fields from a raw record (no coercion).
- `env.pick(...keys)` - Keep selected fields and copy only their source values;
  retain field validation and drop whole-object rules.
- `env.omit(...keys)` - Remove selected fields, including from the copied source;
  retain field validation and drop whole-object rules.
- `env.toCamelCase()` - Return an independent, deeply camelized copy of parsed
  JSON-shaped values. Throws on collisions or unsupported values.

Every `Env` exposes:

- `schema`: The backing `z.object`.
- `source`: The raw key/value record (defaults to `process.env`).
- `meta`: Shallowly frozen metadata per key (`name`, `val`, `raw`).
- `data`: Getters for values parsed and validated at construction.
- `keys`: Literal map of declared keys.

> `fromValues` is designed for lightweight adapters: it preserves the provided strings and simply marks them optional. Reach for `fromZod` if you need typed parsing or cross-field validation.

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.

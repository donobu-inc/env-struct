# env-struct

Schema-first environment variable loading with Zod. `env-struct` gives you
strongly typed values, frozen metadata (name, raw string, parsed value), and
literal-preserving key accessors that keep TypeScript happy.

## Features

- Single Zod schema drives validation and parsing.
- Per-variable metadata alongside parsed values (`env.meta.FOO`).
- Lazy getters for parsed data (`env.data.FOO`).
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
  PORT: z.coerce.number().default(3000),
  FEATURE_FLAG: z.enum(['on', 'off']).default('off'),
};

const env = Env.fromSchema(schema); // defaults to process.env

console.log(env.data.PORT); // parsed number (lazy getter)
console.log(env.meta.FEATURE_FLAG); // { name, val, raw }
console.log(env.keys.PORT); // "PORT"
```

## Examples

### Share scoped env helpers with `pick`

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const base = Env.fromSchema({
  PORT: z.coerce.number().default(3000),
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

### Parse structured data from JSON env values

```ts
import { z } from 'zod/v4';
import { Env } from 'env-struct';

const schema = {
  SERVICE_ROUTES: z.record(z.string().url()),
  WORKERS: z
    .array(z.object({ name: z.string(), concurrency: z.number().int().min(1) }))
    .default([{ name: 'email', concurrency: 2 }]),
};

const env = Env.fromSchema(schema, {
  SERVICE_ROUTES:
    '{"auth":"https://api.example.com/auth","billing":"https://api.example.com/billing"}',
  WORKERS:
    '[{"name":"email","concurrency":4},{"name":"cleanup","concurrency":1}]',
});

const billingUrl = env.data.SERVICE_ROUTES.billing;
const workerNames = env.data.WORKERS.map((worker) => worker.name);
```

## API overview

- `Env.fromSchema(shape, source?)` – build from a Zod raw shape
- `Env.fromZodObject(zodObject, source?)` – reuse an existing `z.object`
- `Env.fromNames(names, source?)` – treat listed names as optional strings
- `Env.fromValues(record)` – infer optional string fields from a raw record (no coercion)
- `env.pick(...keys)` – derive a narrowed `Env` with the same source

Every `Env` exposes:

- `schema`: the backing `z.object`
- `source`: the raw key/value record (defaults to `process.env`)
- `meta`: frozen metadata per key (`name`, `val`, `raw`)
- `data`: lazy getters for parsed values
- `keys`: literal map of declared keys

> `fromValues` is designed for lightweight adapters: it preserves the provided strings and simply marks them optional. Reach for `fromSchema`/`fromZodObject` if you need typed parsing or cross-field validation.

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.

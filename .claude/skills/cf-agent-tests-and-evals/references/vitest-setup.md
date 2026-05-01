# Vitest setup for a Cloudflare Agent

Copy-pasteable config for a new agent. Tested against `@cloudflare/vitest-pool-workers` ≥0.5.

## Files

```
agent/
├── wrangler.jsonc
├── vitest.config.ts
├── vitest.workspace.ts        ← only if you need WS tests
├── tsconfig.json
├── test/
│   ├── setup.ts
│   ├── unit/
│   └── ws/                    ← lives in the --no-isolate workspace
└── package.json
```

## `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-agent-tests",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": [
    "nodejs_compat",
    "experimental",
    "no_handle_cross_request_promise_resolution",
    "service_binding_extra_handlers",
    "rpc",
    "no_global_navigator",
    "no_global_fetch_mock"
  ],
  "ai": { "binding": "AI" },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "agent-test", "remote": true }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "MyAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent"] }
  ]
}
```

The seven compatibility flags above are required for the test runtime; the runner refuses to start without them.

## `vitest.config.ts` (default — isolated tests)

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" }
      }
    }
  }
});
```

## `vitest.workspace.ts` (for WebSocket tests)

```ts
export default [
  // Default: isolated, parallel, fast
  {
    extends: "./vitest.config.ts",
    test: { include: ["test/unit/**", "test/integration/**"] }
  },
  // Shared storage: WS multi-connection tests
  {
    extends: "./vitest.config.ts",
    test: {
      include: ["test/ws/**"],
      isolate: false,
      poolOptions: {
        workers: {
          isolatedStorage: false,
          singleWorker: true
        }
      }
    }
  }
];
```

The shared-storage workspace is non-negotiable for testing:
- WebSocket broadcast across multiple clients on the same DO instance
- Hibernation + rehydration paths
- Concurrent `setState` calls

## `test/setup.ts` — the warm-up trick

```ts
import { beforeAll } from "vitest";
import worker from "../src/index";

beforeAll(async () => {
  // Cold-start vite is slow; the first fetch in a file otherwise times out.
  // This warms it once per test file before any test runs.
  // The URL doesn't matter — we just need the module loaded and ready.
  await fetch("https://warmup-internal/", {
    cf: { skipBindingResolution: true } as any
  }).catch(() => {});
});
```

Without this, the first test in every file routinely times out under CI cold start.

## `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "experimentalDecorators": false,    // STANDARDS-TRACK ONLY — see Non-negotiables
    "useDefineForClassFields": true,
    "types": [
      "@cloudflare/vitest-pool-workers",
      "@cloudflare/workers-types/2024-01-01"
    ]
  },
  "include": ["src", "test"]
}
```

## `package.json` scripts

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:ws": "vitest run --project ws --no-isolate",
    "test:watch": "vitest",
    "evals": "tsx .claude/skills/cf-agent-tests-and-evals/scripts/eval-runner.ts",
    "typecheck": "tsc --noEmit && wrangler types --check"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240101.0",
    "vitest": "^2.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.7.0"
  }
}
```

## CI command

```yaml
- run: npm ci
- run: npm run typecheck
- run: npm run test:unit
- run: npm run test:ws -- --max-workers=1
- if: github.event_name == 'schedule'
  run: npm run evals -- --baseline evals/baseline/snapshots
```

`--max-workers=1` on the WS workspace prevents miniflare-port collisions when both projects run in the same CI job.

# CI/CD — full GitHub Actions deploy.yml

Branch-to-env mapping (the contract):

| Branch | Env | Action |
|---|---|---|
| PR (any) | preview | `wrangler deploy --dry-run` + tests, no traffic |
| `staging` | staging | `wrangler deploy --env staging` |
| `main` | production | `wrangler deploy --env production` |

Two real options:
1. **Workers Builds** (Cloudflare-managed). Push -> build runs in
   Cloudflare's build infra -> auto-deploy. Simpler, but less control.
2. **GitHub Actions with `cloudflare/wrangler-action@v3`**. Lives next
   to your existing CI. **Recommended for agents** — you want
   `wrangler types --check`, `tsc --noEmit`, and `npm test` all gated
   in the same job graph.

This file documents option 2.

## `.github/workflows/deploy.yml` (full)

```yaml
name: Deploy Agent

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]

# One deploy at a time per ref. Don't cancel a deploy mid-flight.
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  # Always-run validation. Catches build / type / test / migration
  # errors before they reach Cloudflare.
  test:
    name: Test + type-check + dry-run
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - run: npm ci

      # Regenerate Env types from wrangler.jsonc and fail if uncommitted.
      # Catches "added a binding, forgot to regen + commit types".
      - name: Type-check gate
        run: |
          npx wrangler types --env-interface Env
          git diff --exit-code worker-configuration.d.ts \
            || (echo "::error::worker-configuration.d.ts is stale. Run 'wrangler types' and commit." && exit 1)

      # Strict TS compile.
      - run: npx tsc --noEmit

      # Migration linter — every DO binding has a migration tag.
      - name: Migration linter
        run: |
          node -e '
            const fs = require("fs");
            const c = JSON.parse(fs.readFileSync("wrangler.jsonc","utf8")
              .replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,""));
            const bindings = (c.durable_objects?.bindings || []).map(b => b.class_name);
            const migrated = new Set();
            for (const m of c.migrations || []) {
              (m.new_sqlite_classes||[]).forEach(x => migrated.add(x));
              (m.new_classes||[]).forEach(x => migrated.add(x));
              (m.renamed_classes||[]).forEach(r => migrated.add(r.to));
              (m.transferred_classes||[]).forEach(t => migrated.add(t.to));
            }
            const missing = bindings.filter(b => !migrated.has(b));
            if (missing.length) { console.error("MIGRATION MISSING:", missing); process.exit(1); }
            console.log("ok");
          '

      # Vitest with the workers pool. See cf-agent-tests-and-evals.
      - run: npm test

      # Build-only. Catches bundling errors in PRs without touching prod.
      - run: npx wrangler deploy --dry-run --outdir=dist

  # Deploy on push only. PRs stop at test.
  deploy:
    name: Deploy
    needs: test
    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # Pin the GitHub Environment for protection rules + audit log.
    environment:
      name: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
      url: ${{ github.ref == 'refs/heads/main' && 'https://agent.example.com' || 'https://staging-agent.example.com' }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - run: npm ci

      - name: Deploy with secrets
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          # Pick the env from the branch. main -> production, staging -> staging.
          command: >
            deploy --env
            ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
          # Atomic secret co-deploy. Each line is read from the job env
          # and piped into `wrangler secret put` after the code lands.
          secrets: |
            OPENAI_API_KEY
            JWT_SIGNING_KEY
            ANTHROPIC_API_KEY
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          JWT_SIGNING_KEY: ${{ secrets.JWT_SIGNING_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # Capture deploy summary for downstream steps.
          WRANGLER_OUTPUT_FILE_PATH: ${{ runner.temp }}/deploy.ndjson

      # Smoke-test the deploy.
      - name: Smoke test
        env:
          DEPLOY_URL: ${{ github.ref == 'refs/heads/main' && 'https://agent.example.com' || 'https://staging-agent.example.com' }}
        run: bash .claude/skills/cf-agent-deploy-and-observe/scripts/verify-deploy.sh "$DEPLOY_URL"
```

## Per-PR preview deployments

If you want a preview URL per PR (without promoting traffic), add a
separate job that uploads a version with a preview alias:

```yaml
preview:
  name: PR preview
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: "22", cache: "npm" }
    - run: npm ci

    - name: Upload preview version
      uses: cloudflare/wrangler-action@v3
      with:
        apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        command: >
          versions upload --env staging
          --tag pr-${{ github.event.number }}
          --message "PR #${{ github.event.number }}: ${{ github.event.pull_request.title }}"
          --preview-alias pr-${{ github.event.number }}

    - name: Comment preview URL on PR
      uses: actions/github-script@v7
      with:
        script: |
          const url = `https://pr-${context.issue.number}-ai-ideator-agent-staging.<account>.workers.dev`;
          github.rest.issues.createComment({
            issue_number: context.issue.number,
            owner: context.repo.owner,
            repo: context.repo.repo,
            body: `Preview ready: ${url}`
          });
```

## Required GitHub repository secrets

| Secret | Source |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Dashboard -> My Profile -> API Tokens. Permissions: Workers Scripts:Edit, Workers KV:Edit, Workers AI:Edit, Vectorize:Edit, Account Analytics:Read, Logs:Edit. |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard -> any Workers/Pages page -> right sidebar |
| `OPENAI_API_KEY` | OpenAI dashboard. Use a separate key per environment. |
| `JWT_SIGNING_KEY` | Generated locally: `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | Anthropic console. Separate per environment. |

Use GitHub Environments (`production` and `staging`) so you can pin
"required reviewers" on production deploys and have an audit log.

## Workers Builds alternative (briefer)

If you don't need the type-check / migration-linter gates and want
fewer moving parts, hook GitHub directly to a Worker via Workers
Builds. Cloudflare runs your build command and deploys on push.

Auto-injected env vars in the build:
- `CI=true`
- `WORKERS_CI=1`
- `WORKERS_CI_COMMIT_SHA`
- `WORKERS_CI_BRANCH`

The Worker name in the dashboard must match `name` in your
`wrangler.jsonc` exactly, or the deploy fails.

Source: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

## What can go wrong (and how to spot it)

| Symptom | Likely cause | Fix |
|---|---|---|
| CI says "no migration found for class X" | Added DO binding without migration tag | Add `{tag, new_sqlite_classes:[...]}` |
| `tsc` fails in CI but passes locally | `worker-configuration.d.ts` not committed | `wrangler types` + commit |
| Deploy succeeds, agent 500s on first request | Missing secret in target env | Check `secrets.required`; `wrangler secret put` |
| `secrets:` step fails: "secret value is empty" | Job env missing the var | Check `secrets:` GitHub repo secrets |
| Worker deploys to `<name>-staging-staging` | `name` includes `-staging` in env block | Remove `-staging` from `env.staging.name` |
| Smoke test 404s on `/health` | Asset handler intercepting | Add `/health` to `run_worker_first` or move under `/agents/*` |

## Source

- GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- `wrangler-action` repo: https://github.com/cloudflare/wrangler-action

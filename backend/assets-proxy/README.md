```txt
npm install
npm run dev
```

```txt
npm run deploy
```

## Caching Polyhaven Assets

To avoid relying on the Polyhaven API (which could go down), you can download and cache asset lists locally:

```txt
npm run download-assets
```

This will download HDRIs, materials, and models from Polyhaven and save them as JSON files in the `public/` directory:
- `polyhaven-hdri.json`
- `polyhaven-material.json`
- `polyhaven-model.json`

## Type Generation

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

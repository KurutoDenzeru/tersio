# Tersio Dashboard App

React + TypeScript + Vite + shadcn/ui source for the Tersio Dashboard. Builds to `../dist` for the local CLI server and self-contained exports. Dashboard-owned code is linted with Oxlint; generated shadcn primitives remain covered by the app TypeScript build.

## Development

```bash
bun run lint
bun run build
```

The root package also exposes `bun run lint:dashboard` for the same Dashboard lint target.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```

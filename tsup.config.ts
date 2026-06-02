import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    programs: 'src/decode/registry.ts',
    render: 'src/render/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  shims: false,
  banner: ({ format }) => {
    // Only the CLI entry needs a shebang; tsup applies the banner to every
    // chunk, but a leading shebang on a library file is harmless and ignored
    // by bundlers. We keep it CLI-only by checking nothing here and instead
    // rely on the standalone shebang inside src/cli/index.ts.
    void format;
    return {};
  },
});

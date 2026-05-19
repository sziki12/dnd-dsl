const path = require('path');
const fs = require('fs');
const nodeExternals = require('webpack-node-externals');

// Resolve the nearest node_modules containing this project (for isEsmOnly)
const PROJECT_NODE_MODULES = path.resolve(__dirname, 'node_modules');

/**
 * NestJS CLI merges { ...defaultOptions, ...ourReturnedConfig } when the
 * webpack config exports a function.  We receive the NestJS default config,
 * patch what we need, and return it.
 *
 * What we patch:
 *  1. ts-loader — point at tsconfig.webpack.json (module:esnext / bundler
 *     resolution so import.meta is valid) and ensure transpileOnly is on.
 *  2. ForkTsCheckerWebpackPlugin — remove it.  Full type checking belongs in
 *     the IDE and a separate `tsc --noEmit` step, not the dev-server loop.
 *  3. resolve.alias — replace TsconfigPathsPlugin path aliases with direct
 *     webpack aliases (more reliable with extensionAlias).
 *  4. resolve.extensionAlias — map .js/.mjs → .ts/.mts so that nodenext-style
 *     imports (foo.js) resolve to the TypeScript source files.
 *  5. module.parser.javascript.url = false — stop webpack treating
 *     new URL('.', import.meta.url) as an asset dependency.
 *  6. externals — replace the plain nodeExternals() with a smart function
 *     that bundles ESM-only packages (langium, chevrotain, etc.) which
 *     cannot be require()'d at runtime from a CJS bundle.
 */

// ── Smart externals: bundle ESM-only packages, externalise the rest ──────────
const esmCache = new Map();

function isEsmOnly(moduleName) {
  // Strip subpath — "@chevrotain/utils/foo" → "@chevrotain/utils"
  const pkgName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  if (esmCache.has(pkgName)) return esmCache.get(pkgName);

  // Construct the package.json path directly — avoid require.resolve() which
  // fails for ESM-only packages that don't expose "./package.json" in exports.
  const pkgJsonPath = path.join(PROJECT_NODE_MODULES, pkgName, 'package.json');

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    if (pkgJson.type !== 'module') {
      esmCache.set(pkgName, false);
      return false;
    }

    function hasRequire(obj) {
      if (typeof obj !== 'object' || !obj) return false;
      if ('require' in obj) return true;
      return Object.values(obj).some(hasRequire);
    }

    const esmOnly = !hasRequire(pkgJson.exports ?? {});
    esmCache.set(pkgName, esmOnly);
    return esmOnly;
  } catch {
    esmCache.set(pkgName, false);
    return false;
  }
}

function smartExternals({ request }, callback) {
  // Relative, absolute, and project-alias imports — let webpack bundle them
  if (
    request.startsWith('.') ||
    request.startsWith('/') ||
    path.isAbsolute(request) ||          // Windows paths like C:\...
    request.startsWith('@dnd-language') ||
    request.startsWith('@dnd-cli')
  ) {
    return callback();
  }

  // Bundle ESM-only packages so webpack can handle ESM→CJS conversion
  if (isEsmOnly(request)) {
    return callback();
  }

  // Everything else stays as a CJS external
  callback(null, 'commonjs ' + request);
}

// ── Webpack config function (called by NestJS CLI with its defaults) ──────────
module.exports = (options) => {
  // ── 1. Patch ts-loader rule ────────────────────────────────────────────
  const rules = options.module?.rules ?? [];
  const tsRuleIdx = rules.findIndex((r) => {
    if (r.loader === 'ts-loader') return true;
    if (
      typeof r.use === 'object' &&
      !Array.isArray(r.use) &&
      r.use?.loader === 'ts-loader'
    )
      return true;
    if (Array.isArray(r.use) && r.use.some((u) => u?.loader === 'ts-loader'))
      return true;
    return false;
  });

  const patchedTsRule = {
    test: /\.tsx?$/,
    use: {
      loader: 'ts-loader',
      options: {
        // module:esnext + moduleResolution:bundler allows import.meta regardless
        // of the package.json "type" field (unlike nodenext which reads it).
        configFile: path.resolve(__dirname, 'tsconfig.webpack.json'),
        transpileOnly: true,
      },
    },
    exclude: /node_modules/,
  };

  if (tsRuleIdx !== -1) {
    rules[tsRuleIdx] = patchedTsRule;
  } else {
    rules.push(patchedTsRule);
  }

  // ── 2. Remove ForkTsCheckerWebpackPlugin ───────────────────────────────
  if (Array.isArray(options.plugins)) {
    options.plugins = options.plugins.filter(
      (p) => p?.constructor?.name !== 'ForkTsCheckerWebpackPlugin',
    );
  }

  // ── 3. Resolve aliases (mirrors tsconfig.json paths) ──────────────────
  options.resolve = options.resolve ?? {};
  options.resolve.alias = {
    ...(options.resolve.alias ?? {}),
    '@dnd-language': path.resolve(__dirname, 'src/dnd-language/language/src'),
    '@dnd-cli': path.resolve(__dirname, 'src/dnd-language/cli/src'),
  };

  // ── 4. .js imports → also try .ts (nodenext / ESM-style source) ────────
  options.resolve.extensionAlias = {
    '.js': ['.ts', '.js'],
    '.mjs': ['.mts', '.mjs'],
  };

  // ── 5. Disable URL-asset tracking ─────────────────────────────────────
  options.module.parser = {
    ...(options.module.parser ?? {}),
    javascript: {
      ...(options.module.parser?.javascript ?? {}),
      url: false,
    },
  };

  // ── 6. Smart externals ─────────────────────────────────────────────────
  options.externals = [smartExternals];

  return options;
};

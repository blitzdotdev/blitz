module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],

    // ⬇ disable the rule completely
    '@typescript-eslint/no-unused-vars': 'off',
  },
  overrides: [{
    // The presentation snapshot follows the reference repository's source
    // conventions. Keep authored Blitz adapters under the strict rules above
    // without rewriting the byte-restored implementation solely for lint.
    files: [
      'src/UiConfigRendererBlueprint2.tsx',
      'src/components/**/*.{ts,tsx}',
      'src/game-runtime/**/*.ts',
      'src/player.ts',
      'src/plugins/**/*.{ts,tsx}',
      'src/utils/AssetTracker.ts',
      'src/utils/CanvasFileDropHandler.tsx',
      'src/utils/EditorFeatures.ts',
      'src/utils/PlayModeHelper.ts',
      'src/utils/ProjectSettingsManager.ts',
      'src/utils/ScriptUtil.ts',
      'src/utils/UseMakeAsset.ts',
      'src/utils/icons.tsx',
      'src/utils/modules.ts',
      'src/utils/objectApplyCommands.tsx',
      'src/utils/three/assetEditorChecks.ts',
    ],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-async-promise-executor': 'off',
      'no-empty-pattern': 'off',
      'no-extra-boolean-cast': 'off',
      'no-extra-semi': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-refresh/only-export-components': 'off',
    },
  }],
}

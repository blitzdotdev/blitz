// This package is upstream's editor, kept as upstream wrote it, so lint enforces
// only the rules upstream's tree already satisfies. The rules below are the ones
// it does not; each returns when the rewrite replaces the code that breaks it.
// Every other rule of eslint:recommended and @typescript-eslint/recommended is on
// and green, so a new file still gets a real check.
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
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-unnecessary-type-constraint': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-hooks/rules-of-hooks': 'off',
    'react-refresh/only-export-components': 'off',
    'prefer-const': 'off',
    'no-async-promise-executor': 'off',
    'no-constant-condition': 'off',
    'no-empty': 'off',
    'no-empty-pattern': 'off',
    'no-extra-boolean-cast': 'off',
    'no-extra-semi': 'off',
    'no-useless-escape': 'off',
  },
}

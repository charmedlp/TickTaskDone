import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Fichiers à ignorer
  { ignores: ['dist/**', 'src/db/migrations/**'] },

  // Règles de base recommandées
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Environnement Node + ajustements
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // On tolère les variables préfixées par _ (ex. _req dans une route)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Doit rester EN DERNIER : désactive les règles de style qui entrent
  // en conflit avec Prettier, pour que les deux cohabitent sans se battre.
  prettier,
);
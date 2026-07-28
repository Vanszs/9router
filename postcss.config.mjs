export default {
  plugins: {
    // Scanning is owned entirely by @source directives in globals.css
    // (`@import "tailwindcss" source(none)` + explicit @source paths).
    // Leaving `base` unset avoids the base/@source double-conflict that
    // forced Tailwind to re-walk repo-root neighbors on every CSS rebuild.
    "@tailwindcss/postcss": {},
  },
};

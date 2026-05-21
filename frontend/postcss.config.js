const path = require('node:path');
// Carichiamo Tailwind con il config esplicito: Vite/PostCSS, quando viene
// invocato dal cwd repo-root, può fallire la ricerca del config se il cwd
// non coincide con `vite.config.ts → root` (`frontend/`).
module.exports = {
  plugins: [
    require('tailwindcss')({ config: path.resolve(__dirname, 'tailwind.config.js') }),
    require('autoprefixer'),
  ],
}
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "surface": "#0f131b",
        "surface-container": "#1c2028",
        "on-surface": "#dfe2ee",
        "primary": "#e2c499",
      },
      fontFamily: {
        manrope: ["Manrope", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      }
    },
  },
  plugins: [],
}

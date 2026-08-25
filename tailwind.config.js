/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)"
      },
      boxShadow: {
        soft: "var(--shadow-sm)",
        lift: "var(--shadow-md)",
        glass: "var(--shadow-glass)"
      },
      borderRadius: {
        glass: "var(--radius-lg)",
        floating: "var(--radius-xl)"
      }
    }
  },
  plugins: []
};

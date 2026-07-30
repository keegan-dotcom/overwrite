/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0E0D",
        pane: "#101614",
        line: "#1E2A26",
        mint: "#3DFFA8",
        mintdim: "#2BC17F",
        paper: "#E9F2EC",
        fog: "#8FA89C",
        amber: "#FFB84D",
        rose: "#FF6B7A"
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        sans: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"]
      }
    }
  },
  plugins: []
};

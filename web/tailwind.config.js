/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#E9F2EC",     // off-white text/borders
        cream: "#0E1512",
        ink: "#0A0E0D",       // page + dashboard bg
        pane: "#101614",      // panel
        line: "#1E2A26",      // faint rule
        darkline: "#1E2A26",
        fog: "#8FA89C",       // muted
        dfog: "#8FA89C",
        accent: "#3DFFA8",    // mint
        market: "#3DFFA8",
        mint: "#3DFFA8",
        amber: "#FFB84D",
        rose: "#FF6B7A"
      },
      fontFamily: {
        display: ["'Anton'", "sans-serif"],
        serif: ["'Spectral'", "Georgia", "serif"],
        sans: ["'Spectral'", "Georgia", "serif"],
        mono: ["'Courier Prime'", "'Courier New'", "monospace"]
      },
      boxShadow: {
        hard: "6px 6px 0 0 rgba(61,255,168,0.55)",
        hardsm: "3px 3px 0 0 rgba(61,255,168,0.55)",
        hardaccent: "6px 6px 0 0 #3DFFA8"
      }
    }
  },
  plugins: []
};

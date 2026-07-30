/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F2EFE6",     // warm newsprint
        cream: "#EAE6D8",
        ink: "#161513",       // near-black ink (also dashboard bg)
        pane: "#201F1C",      // dashboard panel
        line: "#D9D3C2",      // faint rule on paper
        darkline: "#35332E",  // rule on ink
        fog: "#6E6A5E",       // muted ink
        dfog: "#9A968A",      // muted on dark
        accent: "#E8450A",    // signal orange-red
        market: "#0E7C3F",    // print green (money)
        mint: "#27C281",      // terminal green (dashboard)
        amber: "#B97A00",
        rose: "#C42847"
      },
      fontFamily: {
        display: ["'Anton'", "sans-serif"],
        serif: ["'Spectral'", "Georgia", "serif"],
        sans: ["'Spectral'", "Georgia", "serif"],
        mono: ["'Courier Prime'", "'Courier New'", "monospace"]
      },
      boxShadow: {
        hard: "6px 6px 0 0 #161513",
        hardsm: "3px 3px 0 0 #161513",
        hardaccent: "6px 6px 0 0 #E8450A"
      }
    }
  },
  plugins: []
};

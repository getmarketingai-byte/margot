import type { Config } from "tailwindcss";
import containerQueries = require("@tailwindcss/container-queries");

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#eceef0",
          200: "#d3d6dc",
          400: "#7a808d",
          600: "#3a3f4b",
          900: "#0d1117"
        },
        accent: {
          DEFAULT: "#4f46e5",
          fg: "#ffffff"
        }
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"]
      },
      maxWidth: {
        screen: "100vw"
      }
    }
  },
  plugins: [containerQueries]
};

export default config;

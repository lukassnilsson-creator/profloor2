/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./index.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./App.tsx"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
      },
      colors: {
        kahrs: {
          accent: '#D2B7AC',
          bg: '#FBFBFB',
          panel: '#FFFFFF',
          border: '#E5E5E5',
          text: '#1A1A1A',
          muted: '#A0A0A0'
        }
      }
    },
  },
  plugins: [],
}

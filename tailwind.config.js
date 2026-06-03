/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f4f9',
          100: '#dce7f3',
          200: '#b3c9e8',
          300: '#7aa5d4',
          400: '#4a80bf',
          500: '#2a62a8',
          600: '#1c4d8a',
          700: '#163b6e',
          800: '#122e56',
          900: '#0F2744',
          950: '#091829',
        },
        gold: {
          50: '#fdf9ee',
          100: '#f9f0d0',
          200: '#f2e09f',
          300: '#e8c962',
          400: '#dfb53a',
          500: '#B8942A',
          600: '#9d7920',
          700: '#7e5c1a',
          800: '#67491a',
          900: '#573d1a',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Playfair Display', 'serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 39, 68, 0.06), 0 1px 2px rgba(15, 39, 68, 0.04)',
        'card-hover': '0 4px 12px rgba(15, 39, 68, 0.10), 0 2px 4px rgba(15, 39, 68, 0.06)',
      },
    },
  },
  plugins: [],
}

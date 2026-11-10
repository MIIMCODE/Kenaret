/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        vazir: ['Vazirmatn', 'system-ui', 'sans-serif'],
      },
      colors: {
        blush: {
          50: '#fff7f9',
          100: '#ffe9ef',
          200: '#ffd3de',
          300: '#ffaec3',
          400: '#ff84a5',
          500: '#f9628b',
          600: '#e84874',
          700: '#c93560',
          800: '#a52c50',
          900: '#882946',
        },
        cream: '#fffaf6',
        ink: {
          500: '#8b7f86',
          700: '#5c5058',
          900: '#3a3038',
        },
        lilac: {
          100: '#f3eefb',
          300: '#d6c6f2',
          500: '#a98ce0',
        },
        mint: {
          100: '#e9f7f1',
          500: '#4cb894',
        },
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(226, 106, 141, 0.28)',
        card: '0 2px 14px -4px rgba(58, 48, 56, 0.10)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pulse-heart': {
          '0%, 100%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.14)' },
          '60%': { transform: 'scale(1.06)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'sheet-in': {
          '0%': { opacity: '0', transform: 'translateY(18px) scale(.985)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'sheet-out': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(14px) scale(.99)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .45s cubic-bezier(.21,.9,.3,1) both',
        float: 'float 5s ease-in-out infinite',
        'pulse-heart': 'pulse-heart 1.6s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'sheet-in': 'sheet-in .18s cubic-bezier(.21,.9,.3,1) both',
        'sheet-out': 'sheet-out .14s ease-in both',
      },
    },
  },
  plugins: [],
}

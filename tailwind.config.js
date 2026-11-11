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
          /*
           * 600 and 700 are text steps on glass now, not fills. #e84874 was
           * 3.74:1 on white and, once every surface became translucent, 2.91
           * on the pinkest card the page can produce. 600 moved to #c93560
           * (5.05 on white, 3.92 on the worst card) — so text uses 800 or
           * darker, and 600/700 are left for icons, borders and decorations.
           * 800 is the lightest blush that clears 4.5 on glass: 5.31.
           */
          700: '#c93560',
          800: '#a52c50',
          900: '#882946',
        },
        cream: '#fffaf6',
        /*
         * Neo-morphism needs the surface and its raised form to be the same
         * material. `clay` is that material: a warm off-white one step darker
         * than `cream`, so extruded elements read as pressed out of the page
         * rather than stuck onto it.
         */
        clay: {
          50: '#fffdfb',
          100: '#fdf6f2',
          200: '#f8ece7',
          300: '#f1ded9',
          400: '#e8ccc9',
        },
        ink: {
          /*
           * 500 is the secondary-text step and it was 3.83:1 on plain white —
           * below the 4.5 the design requires, and it only got worse once
           * every surface became glass. Both steps moved darker in the
           * liquid-glass round: 500 is now 4.7:1 on the WORST composite the
           * page can produce (a card over the pink blob at full strength),
           * 700 is 5.9:1 there and 7.7:1 on white. Contrast measured on the
           * composited background, never on the token itself.
           */
          500: '#6b5f66',
          700: '#554a52',
          900: '#332a31',
        },
        lilac: {
          100: '#f3eefb',
          300: '#d6c6f2',
          500: '#a98ce0',
          /* Text steps. lilac-500 on clay-200 is 2.41:1; these are 6.30:1
             and 10.17:1, so the gradient digits stay legible at both ends. */
          700: '#67439f',
          900: '#452a68',
        },
        mint: {
          100: '#e9f7f1',
          500: '#4cb894',
          /* Text-only step. mint-500 on mint-100 is 2.22:1 — unreadable as a
             label, and white on mint-500 is 2.94:1. This reads at 5.80:1 on
             mint-100 and 6.40:1 behind white text. */
          700: '#1c6b55',
        },
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(226, 106, 141, 0.28)',
        card: '0 2px 14px -4px rgba(58, 48, 56, 0.10)',

        /*
         * The two lights of neo-morphism. One source, upper-left, casting a
         * white highlight and a warm shadow — the same direction everywhere,
         * or the whole page reads as broken rather than soft.
         */
        neo: '10px 10px 24px rgba(214, 186, 181, 0.55), -10px -10px 24px rgba(255, 255, 255, 0.95)',
        'neo-sm': '5px 5px 12px rgba(214, 186, 181, 0.5), -5px -5px 12px rgba(255, 255, 255, 0.9)',
        'neo-lg': '16px 16px 38px rgba(211, 180, 175, 0.6), -14px -14px 34px rgba(255, 255, 255, 0.98)',
        /* Pressed: the same two lights, moved inside. */
        'neo-in': 'inset 5px 5px 11px rgba(214, 186, 181, 0.62), inset -5px -5px 11px rgba(255, 255, 255, 0.95)',
        'neo-in-sm': 'inset 3px 3px 7px rgba(214, 186, 181, 0.55), inset -3px -3px 7px rgba(255, 255, 255, 0.9)',
        /* A raised thing that is also coloured (pink), so the highlight stays
           white but the shadow takes the hue. */
        'neo-pink': '8px 8px 18px rgba(232, 72, 116, 0.28), -8px -8px 18px rgba(255, 255, 255, 0.85)',
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
        /* A real spring: overshoots past the target and settles back.
           Two bounces, because one looks like a glitch and three looks drunk. */
        'spring-pop': {
          '0%': { transform: 'scale(0.86) translateY(2px)' },
          '38%': { transform: 'scale(1.13) translateY(-3px)' },
          '62%': { transform: 'scale(0.965) translateY(1px)' },
          '82%': { transform: 'scale(1.025) translateY(-0.5px)' },
          '100%': { transform: 'scale(1) translateY(0)' },
        },
        'spring-in': {
          '0%': { opacity: '0', transform: 'scale(0.72) translateY(6px)' },
          '55%': { opacity: '1', transform: 'scale(1.06) translateY(-2px)' },
          '78%': { transform: 'scale(0.98) translateY(1px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'nav-rise': {
          '0%': { opacity: '0', transform: 'translateY(18px) scale(0.96)' },
          '70%': { opacity: '1', transform: 'translateY(-2px) scale(1.01)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pulse-heart': {
          '0%, 100%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.14)' },
          '60%': { transform: 'scale(1.06)' },
        },
        /* Two slow, out-of-phase drifts so the background is never static
           but also never catches the eye. Amplitudes are small on purpose. */
        'blob-a': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(4%, 6%, 0) scale(1.08)' },
        },
        'blob-b': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1.04)' },
          '50%': { transform: 'translate3d(-5%, -4%, 0) scale(0.96)' },
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
        'blob-a': 'blob-a 22s ease-in-out infinite',
        'blob-b': 'blob-b 28s ease-in-out infinite',
        float: 'float 5s ease-in-out infinite',
        'pulse-heart': 'pulse-heart 1.6s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'sheet-in': 'sheet-in .18s cubic-bezier(.21,.9,.3,1) both',
        'sheet-out': 'sheet-out .14s ease-in both',
        /* The spring is in the keyframes, not the easing — a cubic-bezier
           cannot overshoot and come back twice. */
        'spring-pop': 'spring-pop .48s cubic-bezier(.34,1.56,.64,1) both',
        'spring-in': 'spring-in .34s cubic-bezier(.34,1.56,.64,1) both',
        'nav-rise': 'nav-rise .5s cubic-bezier(.34,1.56,.64,1) both',
      },
    },
  },
  plugins: [],
}

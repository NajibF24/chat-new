/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- PRIMARY GREEN (Berdasarkan GYS Brand Guidelines) ---
        primary: {
          300: '#48AE92', // Primary Color Derivatives (Light)
          500: '#007857', // Primary Color (Warna Utama)
          900: '#004E36', // Primary Color Derivatives (Dark)
          
          // Alias untuk memudahkan penggunaan (contoh: bg-primary, text-primary-light)
          light: '#48AE92',
          DEFAULT: '#007857',
          dark: '#004E36',
        },
        // --- NEUTRAL / STEEL (Berdasarkan GYS Brand Guidelines) ---
        steel: {
          100: '#F0F1F1', // Derivative Grey Light
          300: '#A5A7AA', // Derivative Grey
          500: '#6E6F72', // Grey Color (Warna Utama)

          // Alias
          lightest: '#F0F1F1',
          light: '#A5A7AA',
          DEFAULT: '#6E6F72',
        },
        // --- GYS BRANDING (Hanya menggunakan warna resmi) ---
        gys: {
          green: '#007857', 
          'green-dark': '#004E36',
          'green-light': '#48AE92',
          grey: '#6E6F72',
          'grey-light': '#A5A7AA',
          'grey-lightest': '#F0F1F1',
        }
      },
      fontFamily: {
        // Font 'Inter' adalah font resmi yang digunakan dalam Brand Guidelines GYS
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
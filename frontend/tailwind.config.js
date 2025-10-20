// tailwind.config.js
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: "#f1faf6",
                    100: "#def5ea",
                    200: "#b9e9d4",
                    300: "#8ad7ba",
                    400: "#58c29b",
                    500: "#2ea67e",   // primary
                    600: "#238565",
                    700: "#1c6a52",
                    800: "#155240",
                    900: "#0e3c2f",
                },
                accent: {
                    50: "#fff5f0",
                    100: "#ffe8df",
                    200: "#ffd0bf",
                    300: "#ffb396",
                    400: "#ff8e66",
                    500: "#ff6d3b",   // buttons/heart
                    600: "#e15026",
                    700: "#b83e1c",
                    800: "#8f3117",
                    900: "#6f2813",
                },
            },
            boxShadow: {
                soft: "0 10px 30px rgba(20, 96, 72, 0.12)",
            },
            fontFamily: {
                display: ['ui-sans-serif', 'system-ui', 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol']
            }
        },
    },
    plugins: [],
}

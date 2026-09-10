FROM node:24.20.0-alpine3.23@sha256:0388af2af070cd4736a1567cfed02469ba117848845b4165d87a333edb53d2ca AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_URL=/api
RUN npm run build

FROM nginxinc/nginx-unprivileged@sha256:4210a3296e7cae7b4f355da48192cd5ea51c88acf9892b95bff967cede85a915 AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1
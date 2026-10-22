FROM node:26.12.0-alpine3.23@sha256:2ae3a23c9c5d2129398f4844c7c43400c061faf6973852f0fa837323bff9a5a8 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_URL=/api
RUN npm run build

FROM nginxinc/nginx-unprivileged@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1
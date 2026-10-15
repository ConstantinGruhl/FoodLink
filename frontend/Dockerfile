FROM node:26.11.1-alpine3.23@sha256:f1394b3ffc021bc3f4aaf363e70a8d9667f7a9a63538bc824d7cc583129fffad AS build
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
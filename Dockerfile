FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL=/api
ARG VITE_WEBRTC_CONFIG
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WEBRTC_CONFIG=$VITE_WEBRTC_CONFIG
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

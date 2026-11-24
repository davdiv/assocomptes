ARG NODE_VERSION=26.13.1
FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /usr/app
COPY package.json package-lock.json preinstall.sh ./
RUN sh preinstall.sh && npm ci
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /usr/app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /usr/app/build ./build
COPY src/common ./src/common
COPY src/server ./src/server
COPY assocomptes ./
EXPOSE 8080
USER node
ENTRYPOINT ["./assocomptes"]

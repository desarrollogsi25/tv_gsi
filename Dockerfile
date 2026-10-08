FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY nx_tv.js ./
COPY src ./src

FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=builder /app /app
RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p media && chown -R app:app /app
USER app
EXPOSE 3002
CMD ["node", "nx_tv.js"]

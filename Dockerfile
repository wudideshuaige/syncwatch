FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY api/ ./api/
COPY tsconfig.json ./
EXPOSE 3001
CMD ["npx", "tsx", "api/server.ts"]

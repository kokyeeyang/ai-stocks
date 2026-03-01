FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/index.js"]

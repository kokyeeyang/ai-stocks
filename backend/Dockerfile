FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/index.js"]

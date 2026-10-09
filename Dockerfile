FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

ENV PORT=3888
EXPOSE 3888

CMD ["node", "server.js"]

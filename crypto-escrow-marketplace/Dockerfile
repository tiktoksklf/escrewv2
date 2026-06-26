FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4180
ENV DB_FILE=/data/vaultmarket-db.json

RUN mkdir -p /data

EXPOSE 4180

CMD ["npm", "start"]

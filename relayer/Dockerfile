# Minimal Docker image for the relayer service
FROM node:20-alpine

WORKDIR /app

# Copy service manifest and install only prod deps
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy the server
COPY server.js ./

ENV NODE_ENV=production

# Railway provides PORT; the app reads PORT or defaults to 8787
EXPOSE 8080

CMD ["npm", "start"]


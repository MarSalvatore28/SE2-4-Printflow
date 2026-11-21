FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --ignore-scripts: ningún paquete corre scripts al instalarse. bcrypt trae sus binarios ya compilados
# (prebuilds) y los carga al usarse, sin compilar nada.
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src

USER node
EXPOSE 9000
CMD ["node", "src/server.js"]

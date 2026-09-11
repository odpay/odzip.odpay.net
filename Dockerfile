FROM node:24-alpine

WORKDIR /app

COPY --chown=node:node package.json server.js index.html style.css app.js worker.js block-worker.js favicon.gif ./
COPY --chown=node:node wasm/odzip.js wasm/odzip.wasm ./wasm/

USER node
EXPOSE 3000

CMD ["node", "server.js", "3000"]

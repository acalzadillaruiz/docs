# GPS Nexus · la aplicación
#
# No hay paso de compilación, y no es un descuido: Node 22 ejecuta TypeScript
# directamente, así que lo que corre en el servidor es el mismo archivo que se lee en el
# repositorio. Una compilación de más es una diferencia de más entre lo que se revisa y
# lo que se ejecuta.
FROM node:22-alpine

# Las dependencias primero, y solo las de producción: con el package-lock por delante,
# reconstruir la imagen tras cambiar código no vuelve a bajar nada.
WORKDIR /app
COPY app/package.json app/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# El código de la aplicación y el esquema. El esquema entra en la imagen porque el
# migrador lo lee de ahí: así la versión del esquema y la del código son la misma cosa y
# no pueden desincronizarse.
COPY app/src ./src
COPY app/herramientas ./herramientas
COPY db/schema /db/schema
COPY i18n /i18n

# Sin privilegios. Si algún día alguien encuentra la forma de ejecutar algo dentro de
# este contenedor, que no lo haga como root.
RUN mkdir -p /documentos && chown -R node:node /documentos /app
USER node

ENV NODE_ENV=production
EXPOSE 8080

# El almacén de documentos va en un volumen: si vive dentro del contenedor, la primera
# actualización se lleva por delante las actas de recepción.
VOLUME ["/documentos"]

CMD ["node", "--experimental-strip-types", "src/servidor/arrancar.ts"]

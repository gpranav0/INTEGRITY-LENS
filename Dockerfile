FROM node:24-bookworm-slim AS dependencies
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
COPY . .

ARG VITE_DATA_ADAPTER=demo
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_SUPABASE_ASSIGNMENT_ID=

ENV VITE_DATA_ADAPTER=$VITE_DATA_ADAPTER
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_ASSIGNMENT_ID=$VITE_SUPABASE_ASSIGNMENT_ID

RUN npm run build

FROM nginx:1.27-alpine AS production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["nginx", "-g", "daemon off;"]

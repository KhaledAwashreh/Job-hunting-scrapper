# Multi-stage Dockerfile for Job Hunter
#
# Node 18 is EOL (no security patches since 2025-04-30 — see the note by
# the second FROM below for the full check). Using node:24-alpine, the
# current Active LTS line (EOL 2028-04-30).
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first (leverage Docker cache)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Final stage
#
# Node version check (asked for explicitly in the review brief — verified,
# not assumed):
#   - global fetch: enabled by default since Node 18.0.0 (experimental
#     warning only, functional).
#   - AbortSignal.timeout(): added in Node 17.3.0, present in every Node 18
#     release.
#   - RegExp lookbehind + \p{...} Unicode property escapes (apiAgent.js):
#     lookbehind since V8 6.2 / Node 8.3, unicode property escapes since
#     Node 10. Both long predate 18.
#   So node:18-alpine had every *feature* this app uses. It is still wrong:
#   Node 18 reached end-of-life on 2025-04-30 and has not received security
#   patches since — over a year before this fix, given today's date. That
#   EOL status, not a missing language feature, is why the base image
#   changes here.
FROM node:24-alpine

WORKDIR /app

# Copy only production dependencies and source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Static UI assets served by express.static() and res.sendFile()
# (src/server.js:84, :182): dashboard.html, styles.css, countries.json and
# components/*.js. Previously never copied — only an empty directory was
# created below — so every UI route 404'd in the image while /api/health
# still reported the container healthy.
COPY --from=builder /app/public ./public

# Search config read by src/utils/csvParser.js:5. Copied as a single file,
# not the whole data/ directory: data/resumes/ is gitignored and, unlike
# search-params.csv, may hold real local files (uploaded resumes) on the
# machine running `docker build .` with no .dockerignore to stop `COPY . .`
# in the builder stage from picking them up. Naming the exact file here
# guarantees only the tracked CSV — never a bystander's resume — ends up in
# an image layer.
COPY --from=builder /app/data/search-params.csv ./data/search-params.csv

# data/resumes/ is populated at runtime by the resume upload API
# (src/server.js's multer destination) and read by src/utils/resumeParser.js.
# It ships empty by design: resumes belong to a deployment/run, not the
# image, and mounting a volume over this path is the expected way to
# persist them.
RUN mkdir -p /app/data/resumes

# Deliberately NOT copying .env.example to ./.env. src/utils/loadEnv.js
# loads dotenv with override:false, so a real environment variable injected
# at `docker run` / by an orchestrator always wins over a baked .env file —
# but with nothing injected, baking .env.example meant the app silently ran
# on its placeholder values (ANTHROPIC_API_KEY=your_claude_key_here) instead
# of failing loudly on a missing key. Supply real config via injected
# environment variables, or mount a real .env at /app/.env at deploy time.

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check: probes both the API (db_initialized) and that the static
# UI is actually being served. Probing only /api/health (the previous
# behaviour) caught database problems but stayed green with a completely
# missing public/ directory — db_initialized has nothing to do with static
# file serving, which is exactly the bug this file fixes. GET / calls
# res.sendFile(.../public/dashboard.html); if public/ is ever missing again,
# that throws, Express's error handler returns 500, and this healthcheck
# now fails instead of lying.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');const port=process.env.PORT||3000;const paths=['/api/health','/'];Promise.all(paths.map(p=>new Promise((resolve,reject)=>{http.get({host:'localhost',port,path:p},(r)=>{r.resume();r.statusCode===200?resolve():reject(new Error(p+' returned '+r.statusCode))}).on('error',reject)}))).then(()=>process.exit(0)).catch((err)=>{console.error('healthcheck failed:',err.message);process.exit(1)})" || exit 1

# Run the application (matches package.json's "start" script: node src/server.js)
CMD ["node", "src/server.js"]

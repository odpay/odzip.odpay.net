# Zenith deployment

odzip is a stateless browser application served by Node. The committed JavaScript and WebAssembly files are the production build output; the container does not rebuild them.

## Runtime contract

- Build context: repository root
- Dockerfile: `Dockerfile`
- Image workflow: `.github/workflows/publish-container.yml`
- Production platform: `linux/amd64`
- Startup command: `node server.js 3000`
- Internal HTTP port: `3000`
- Readiness check: `GET /` returns the odzip page containing `<span class="wordmark">odzip</span>`
- Required services, environment variables, SMTP, and persistent storage: none
- Container smoke test: `bash scripts/zenith-smoke.sh IMAGE`

`wasm/odzip.js` and `wasm/odzip.wasm` are rebuilt separately by `.github/workflows/rebuild-wasm.yml`. The container packages the committed artifacts and does not need Emscripten or the upstream odzip source.

## Release flow

Merging an application or container change to `main` publishes an AMD64 image to GHCR. The workflow checks anonymous registry access, pulls the immutable digest without registry credentials, boots it, and uploads a `zenith-image-update` artifact with the verified source commit and digest.

Use that artifact to propose a reviewed update to the `app` image in `zenith-compose.yml`. Validate the manifest and confirm no newer image inputs have landed before opening or updating the pull request. A published image or merged digest change does not update the Zenith catalogue or running deployments; return to Zenith's **Publish an app** page for review after the compose change is merged and verified.

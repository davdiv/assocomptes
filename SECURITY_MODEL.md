# Threat model: davdiv/assocomptes

## System overview
assocomptes manages an association's people records, account sheets (cash box counts and accounting entries) and bank deposits. It is a single Node.js 26 / Express 4 process (`src/server`) serving a Hashspace single-page client (`src/client/statics`, built into `build/client`) and a JSON API under `/api`. Data lives in MongoDB (driver 7, `src/server/database`). It is deployed as a Docker image (`Dockerfile`, runs as `node`) behind Traefik with Authelia forwardAuth.

Infrastructure: no production infrastructure repository exists. The maintainer says production is close to the README and the e2e fixtures (`compose.e2e.yml`, `e2e/fixtures/traefik.yml`, `e2e/fixtures/authelia.yml`). In that setup the app port is never published, Traefik's `strip-identity` middleware clears `Remote-User/Groups/Name/Email` before Authelia's forwardAuth sets them, and Authelia's `default_policy: deny` requires `one_factor` for the app domain.

### Trust boundaries
1. Browser to Traefik (HTTPS, public): Authelia session cookie; identity is decided by Authelia.
2. Traefik to app (internal network): the app trusts `Remote-*` headers only when the TCP peer equals `AUTH_TRUSTED_PROXY` (`src/server/auth.js`).
3. App to MongoDB (internal network): the `--db-url` connection string, which may contain credentials.

### Components
| Component | Code |
|---|---|
| Auth | `src/server/auth.js`, `src/server/cli.js` (role-to-group mapping), `src/client/statics/login.js` |
| API | `src/server/server.js`, `restRouter.js`, `bodyParser.js`, `idValidator.js`, `keycloakPeople.js`, `apiErrorReporter.js`, `src/server/collections/**` |
| Validation | `src/common/validation/**`, `src/common/serialization.js`, `src/common/utils/**` |
| Database | `src/server/database/**` (MongoDB connection, init, indexes) |
| Web client | `src/client/statics/**` (Hashspace templates, pages, persistence) |
| Build & deploy | `Dockerfile`, `preinstall.sh`, `gulpfile.js`, `gruntfile.js`, `build-hashspace-parser.js`, `.github/workflows/**`, `compose.e2e.yml`, `e2e/fixtures/**` |

## Entry points
All of these are behind Authelia, and every route needs a non-empty `Remote-User` from the trusted proxy:
- `GET` SPA routes (`src/common/routes.js`) and static files. `?dev` switches to the dev HTML bundle.
- `GET /api/profile`: any authenticated user; returns the identity, roles and logout/profile URLs.
- `GET /api/keycloak/:id` (`readPeople`): maps an identity key to a person id in `keycloakPeople`.
- `/api/people`, `/api/account/sheets`, `/api/account/deposits` (`RestRouter`): `POST /` (write), `POST /search` (read; raw MongoDB `query` and `options` from the body are passed to `find()`, and only `projection` is forced), `GET /suggestions?q=` (read; people only, others throw "Not implemented"), `GET /:id` (read), `PUT /:id` (write), `DELETE /:id?lastChangeTimestamp=` (write).

## Assets (all critical per the maintainer)
- People personal data, confidentiality: names, sex, marital status, birth date/city/country, nationalities, contact details.
- Integrity of account sheets and deposits (financial records).
- Change history and audit attribution: `lastChangeBy`, `lastChangeTimestamp`, and the `*History` collections.
- Availability of the app.
- Secondary: the MongoDB connection string, and the identity mapping in `keycloakPeople`.

## Attackers that matter
- **Who can get an account (maintainer):** only association members or volunteers whose accounts the maintainer creates. There is no self-signup. Every attacker is therefore an authenticated member, possibly holding fewer roles than the data they target (for example, no `readPeople`), or a malicious member with a write role.
- **Roles (maintainer):** roles really differ between members (for example, some members cannot read people). Cross-role access counts in full.
- Unauthenticated internet attackers reach only Traefik and Authelia; the app port is not published (maintainer: production follows the README and fixtures).
- A compromised member browser or a cross-site attacker using a member's session (CSRF/XSS).
- Supply chain: npm dependencies and Hashspace fetched at a pinned revision by `preinstall.sh`.

## Existing controls
- Proxy trust: `auth.js` rejects requests whose peer is not `AUTH_TRUSTED_PROXY` (IPv4 or IPv4-mapped IPv6), or whose `Remote-User` is empty or contains a comma. Startup fails without a valid IP and HTTPS origin and logout URLs.
- CSRF: non-GET/HEAD/OPTIONS requests must send `Origin` equal to `AUTH_ORIGIN`; Authelia cookies are `same_site: lax`.
- Authorization: `requireGroup(role)` on every collection route, with separate read and write roles per collection. Role groups come from CLI options or `ASSOCOMPTES_*` env vars and default to the role names.
- Input: `bodyParser` caps bodies at 1 MB and parses with `serialization.parse`. `idValidator` validates `:id`. Each collection's `processToDB` runs a strict schema validator that rejects extra properties (`validators.object`).
- Audit: the server overwrites `lastChangeBy` and `lastChangeTimestamp`. Saves and deletes use optimistic concurrency on `lastChangeTimestamp` and write the previous version to `*History`.
- Runs as a non-root user in the container.

## Security invariants
- **Authentication and trusted headers (CWE-290, CWE-287):** identity comes only from `Remote-*` headers on connections whose socket peer is `AUTH_TRUSTED_PROXY`. Never read `X-Forwarded-For` or `req.ip` for this (Express `trust proxy` is not set). Every route, including static files and SPA routes, is mounted after `app.use(auth(...))` in `server.js`; a route registered before it is a gap. Traefik must strip `Remote-*` headers on every router that reaches the app.
- **Authorization (CWE-862, CWE-863, CWE-639):** every `/api` route except `/api/profile` must have `requireGroup` with that collection's role: read for `GET` and `POST /search`, write for `POST`, `PUT` and `DELETE`. The role must match the collection the handler touches. Data from one collection must not reach a user who lacks that collection's read role, for example through `/api/keycloak/:id` or through people data embedded in account sheets.
- **NoSQL injection and query abuse (CWE-943, CWE-400):** readers may use any filter on their own collection (maintainer: accepted risk). The invariant is that query input cannot run server-side JavaScript (`$where`, `$function`, `$accumulator`), reach another collection (`$lookup` is not reachable through `find`, but watch any future `aggregate`), override the forced `projection`, or cause unbounded cost (`limit`, `maxTimeMS`, `sort`, `hint`). `RestRouter` currently forwards `body.query` and `body.options` unchanged, so whether the database permits server-side JS (MongoDB `security.javascriptEnabled`) decides the `$where` risk. Gap: there is no allow-list of operators or options.
- **Regex injection and ReDoS (CWE-1333, CWE-625):** `PeopleCollection.suggestions` escapes every character below 256 through `diacriticsRegExp` before `new RegExp`. Characters at or above 256 pass through unescaped, and `q` is not type-checked: an array, or a missing value, throws. User-provided `$regex` in `/search` is covered by the NoSQL invariant above.
- **Mass assignment and audit integrity (CWE-915):** writes go through `processToDB`, and the validators reject unknown fields. `lastChangeBy` and `lastChangeTimestamp` are always set by the server from `req.identity`. `PUT` requires `body.id === params.id`. History rows are written for every update and delete; a write path that skips them is a gap.
- **CSRF (CWE-352):** state changes are never done on GET; non-GET requests require a matching `Origin`.
- **XSS (CWE-79):** Hashspace templates escape `{expr}` bindings. No `innerHTML`, `eval` or `new Function` was found in `src/client`. Any HTML-inserting helper or `dev` bundle quirk is an escape hatch to review. Server error responses are JSON.
- **Deserialization (CWE-502):** `serialization.parse` revives only `$date`, `$validationErrors`, `$notFoundError` and `$simpleError` into fixed classes. It must not create prototypes or functions from input; check `__proto__` keys that survive into Mongo documents or validators.
- **Secrets (CWE-532, CWE-798):** `init.js` logs the full `db-url`, which can expose MongoDB credentials in container logs (gap). No secrets are committed; the e2e Authelia secrets are test-only placeholders.
- **Supply chain (CWE-829):** Hashspace is fetched at a pinned revision. Several devDependencies are very old (gulp 3, grunt 0.4) but are build-time only; runtime dependencies are express, mongodb, raw-body, minimist and diacritics.

## Out of scope or accepted risk (from the maintainer)
- A reader using raw MongoDB filters in `/search` to read more of a collection they already have the read role for. Only server-side code execution, DoS and cross-collection access matter.
- Attacks that need a self-registered account, or direct network access to the app port.

## Open questions
- Is server-side JavaScript disabled on the production MongoDB (`security.javascriptEnabled: false` / `--noscripting`)? Unanswered, so assume the default (enabled). The app's code uses no `$where`, `$function`, `$accumulator`, mapReduce or aggregate.

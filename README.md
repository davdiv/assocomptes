# Description

assocomptes is a program to manage account sheets and bank deposits for an association.

Requires Node.js 26 and MongoDB 4.4 or later.

```sh
sh preinstall.sh && npm ci && npm run build
```

Run end-to-end tests with Docker Compose:

```sh
npx playwright install chromium
docker compose -f compose.e2e.yml up --build --wait
npm run test:e2e
docker compose -f compose.e2e.yml down --volumes
```

Deploy behind Traefik only; do not publish the app port. Set `AUTH_TRUSTED_PROXY` to Traefik's backend IP, `AUTH_ORIGIN` to the public HTTPS origin (no trailing slash), and `AUTH_LOGOUT_URL` to Authelia's HTTPS logout URL.
Use [the test routing example](e2e/fixtures/traefik.yml) to strip incoming `Remote-User`, `Remote-Groups`, `Remote-Name` and `Remote-Email` before Authelia supplies them.
Set `AUTH_PROFILE_URL` to an HTTPS Authelia settings URL (e.g. `https://auth.example.org/settings/security`) to show the user settings link.
Authelia group names default to the existing app roles. Override them with `--read-people-group`, `--write-people-group`, `--read-account-sheets-group`, `--write-account-sheets-group`, `--read-deposits-group` or `--write-deposits-group`.
Each option overrides its corresponding `ASSOCOMPTES_*` environment variable (e.g. `--read-people-group` overrides `ASSOCOMPTES_READ_PEOPLE_GROUP`).
To preserve audit attribution, keep each old subject's `keycloakPeople` row and add a row with `_id` set to the Authelia username and the same person `id`. Do not reuse an identity key for another person.

# License

	assocomptes : Program to manage account sheets and bank deposits for an association.
	Copyright (C) 2014 DivDE <divde@free.fr>

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <http://www.gnu.org/licenses/>.

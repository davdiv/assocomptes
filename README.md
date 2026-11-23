# Description

assocomptes is a program to manage account sheets and bank deposits for an association.

## Build

Use the Node.js version in `.nvmrc`. The first command fetches the pinned
Hashspace sources; npm needs them before resolving the local dependency.

```sh
nvm use
sh preinstall.sh
npm ci
npm run build
```

Assocomptes requires MongoDB **4.4 or later** with the MongoDB Node.js driver
7.x. Upgrade any older database server before deploying this version.

## End-to-end tests

With Docker Compose and the local dependencies installed:

```sh
npx playwright install chromium
docker compose -f compose.e2e.yml up --build --wait --wait-timeout 180
npm run test:e2e
docker compose -f compose.e2e.yml down --volumes
```

The stack runs Traefik, Authelia with test-only file-backend accounts, and
MongoDB 8.3.17. Open <https://assocomptes.localhost:18443> to try the test
stack locally; it uses Traefik's self-signed test certificate. Only Traefik and
the test MongoDB port are published, both on loopback. To test another supported
MongoDB version, set `E2E_MONGO_IMAGE` on the Compose command after tearing
down the old volumes.

## Deploying with Authelia

Assocomptes requires Traefik ForwardAuth and Authelia. Start from the
[deployment guide](deploy/authelia.md) for the example configuration, network
requirements, role names and audit identity migration. Do not publish the
Assocomptes backend port.

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

# Deploying Assocomptes with Traefik and Authelia

Use separate HTTPS hostnames, for example `accounts.example.org` for the app
and `auth.example.org` for the Authelia portal. Use valid production TLS
certificates on both. Disable any old ingress routes to Assocomptes that do not
use Authelia. Only Traefik should be able to reach the app: do not publish its
port, and place Traefik and the app on a dedicated private backend network
(with only those two services attached). Isolate MongoDB on its own network
and do not publish it. Restrict network access to the app from the database
side as well, where your networking stack supports filtering by destination.
Keep Authelia's internal port private and expose its portal through Traefik.

For Docker Compose, [the test stack](../compose.e2e.yml) shows the separate
proxy and database networks and assigns a fixed IP to Traefik on the app
network. Choose an unused subnet in production and reserve Traefik's address.
Set these environment variables on Assocomptes:

| Variable | Example | Meaning |
| --- | --- | --- |
| `AUTH_TRUSTED_PROXY` | `172.30.83.2` | Traefik's IP address **as seen by the app's TCP socket**, not a network range or a forwarded header. |
| `AUTH_ORIGIN` | `https://accounts.example.org` | Exact public HTTPS origin, with any non-default port and no trailing slash. |
| `AUTH_LOGOUT_URL` | `https://auth.example.org/logout` | Authelia logout URL. The app adds the return URL. |

The backend rejects requests without both the expected socket peer and a
nonempty identity. On every non-safe HTTP method, including `POST /search`,
it also requires an `Origin` header exactly matching `AUTH_ORIGIN`.
Browsers supply this on same-origin writes. The app does not enable CORS.

## Traefik and Authelia configuration

Use [the Traefik file-provider example](../e2e/fixtures/traefik.yml): replace
the two `.localhost` host rules and configure your production TLS certificates
or certificate resolver. Keep `strip-identity` before `authelia` on **every**
app router, including API and static assets. The first middleware strips the
four incoming `Remote-*` identity headers; the second copies their values
only from Authelia's successful ForwardAuth response. The Authelia portal
router itself does not use ForwardAuth. Do not enable insecure forwarded-header
trust on the public entrypoint (and keep header aliases rejected).

Use [the Authelia configuration example](../e2e/fixtures/authelia.yml): set the
cookie domain to the shared parent domain and update the `authelia_url`,
`default_redirection_url` and access-control domain to match your URLs.
Keep `default_policy: deny`; do not allow bypass for any Assocomptes route.
Use `two_factor` if your users have enrolled in MFA. Provide your own
session secret, storage encryption key, durable storage and notifier; never
deploy the test secrets or [test users](../e2e/fixtures/authelia-users.yml).

Assign groups with the same names and spelling as the former Assocomptes
client roles: `readPeople`, `writePeople`, `readAccountSheets`,
`writeAccountSheets`, `readDeposits` and `writeDeposits`. Read and write
permissions are independent. Do not migrate the old ticket roles: printing
has been removed.

## Preserve change history during cutover

Back up MongoDB. Export or inventory the users' old Keycloak subject IDs
(`sub`) and match each one to its chosen Authelia username using your identity
records. Verify the matches before provisioning groups. Preserve the existing
rows in the `keycloakPeople` collection; it is now simply an identity-to-person
map. Add a row keyed by the new username with the same person ID as the old
row. For example, from the Assocomptes database in a MongoDB shell:

```javascript
var oldSubject = "<old-sub>";
var username = "<authelia-username>";
var person = db.keycloakPeople.findOne({ _id: oldSubject });
if (!person || !person.id) throw new Error("Missing old identity mapping");
var existing = db.keycloakPeople.findOne({ _id: username });
if (existing && existing.id !== person.id) throw new Error("Conflicting identity mapping");
if (!existing) db.keycloakPeople.insertOne({ _id: username, id: person.id });
```

Keep both rows. Do not rewrite old `lastChangeBy` values or reuse usernames
for different people. Choose a different username if it collides with another
person's old subject or username. New writes store the Authelia username.
Verify that a legacy edit and a new edit both display the expected author
before cutover. Use a backup of your previous Traefik/Keycloak configuration
and redeploy the PR1 image for rollback; there is no in-app fallback.

Password migration is separate. For locally stored Keycloak 10 accounts, use
a protected, credential-inclusive server-side export, determine the actual
hash algorithms and parameters, and test whether each can be converted to a
format the target Authelia backend verifies using known-password staging
accounts. Do not use a partial admin-console export or commit credential
material to the deployment repository. Where the hashes are incompatible,
plan a password reset. Active sessions and MFA enrollment do not transfer.

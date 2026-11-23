const { test, expect } = require("@playwright/test");
const { MongoClient, ObjectId } = require("mongodb");

const loginUrl = /^http:\/\/keycloak\.localhost:18081\/auth\/realms\/assocomptes\/protocol\/openid-connect\/auth/;
const password = "local-e2e-password";
const dbUrl = "mongodb://127.0.0.1:27028/assocomptes_e2e";

async function signIn(page, username, path = "/") {
    await page.goto(path);
    await expect(page).toHaveURL(loginUrl);
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
    await expect(page.getByRole("link", { name: "Assocomptes" })).toBeVisible();
}

async function authorization(request, username) {
    const response = await request.post("http://127.0.0.1:18081/auth/realms/assocomptes/protocol/openid-connect/token", {
        form: { grant_type: "password", client_id: "assocomptes", username, password }
    });
    expect(response.status()).toBe(200);
    const { access_token: token } = await response.json();
    const { sub } = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return { headers: { Authorization: "Bearer " + token }, sub };
}

test("signs in through Keycloak and signs out of the session", async ({ page }) => {
    await signIn(page, "editor");
    await page.getByText("Editor Example", { exact: true }).click();
    await expect(page.getByRole("link", { name: "Paramètres utilisateur" })).toBeVisible();
    page.on("dialog", dialog => dialog.accept());
    await page.getByRole("link", { name: "Déconnexion" }).click();
    await expect(page).toHaveURL(loginUrl);
    await expect(page.locator("#kc-login")).toBeVisible();
});

test("denies anonymous API access and reader writes while showing the audit author", async ({ page, request }) => {
    const { headers, sub } = await authorization(request, "editor");
    const reader = await authorization(request, "reader");
    const response = await request.post("/api/people", { headers, data: { firstName: "ReadOnlyTestPerson" } });
    expect(response.status()).toBe(200);
    const { id } = await response.json();
    const authorId = new ObjectId();
    const client = await MongoClient.connect(dbUrl);
    const db = client.db();
    try {
        await db.collection("people").insertOne({
            _id: authorId, current: { firstName: "Audit", lastName: "Author", lastChangeTimestamp: new Date() }
        });
        await db.collection("keycloakPeople").replaceOne({ _id: sub }, { _id: sub, id: authorId.toString() }, { upsert: true });
        expect((await request.get("/api/people/" + id)).status()).toBe(403);
        expect((await request.get("/api/people/" + id, { headers: reader.headers })).status()).toBe(200);
        expect((await request.post("/api/people", { headers: reader.headers, data: { firstName: "Denied" } })).status()).toBe(403);

        await signIn(page, "reader", "/people/" + id);
        await expect(page.getByText("ReadOnlyTestPerson", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Audit Author", { exact: true })).toBeVisible();
        await expect(page.getByTitle("Modifier", { exact: true })).toHaveCount(0);
        await expect(page.getByTitle("Supprimer", { exact: true })).toHaveCount(0);
    } finally {
        await db.collection("keycloakPeople").deleteOne({ _id: sub });
        await db.collection("people").deleteMany({ _id: { $in: [authorId, new ObjectId(id)] } });
        await client.close();
    }
});

const date = { $date: Date.UTC(2020, 0, 2, 12) };
const records = [
    { endpoint: "/api/people", collection: "people", initial: { firstName: "Initial" }, update: { firstName: "Updated" } },
    {
        endpoint: "/api/account/sheets",
        collection: "accountSheets",
        initial: { days: [{ date, lines: [{ item: "Example", amount: 25 }] }] },
        update: { notes: "Updated sheet" }
    },
    {
        endpoint: "/api/account/deposits",
        collection: "deposits",
        initial: { depositNumber: "E2E-1", date, declaredAmount: 25 },
        update: { depositNumber: "E2E-2" }
    }
];

for (const { endpoint, collection, initial, update } of records) {
    test("creates, searches, updates and deletes " + collection + " with audit history", async ({ request }) => {
        const { headers, sub } = await authorization(request, "editor");
        const create = await request.post(endpoint, { headers, data: initial });
        expect(create.status()).toBe(200);
        const created = await create.json();
        expect(created).toMatchObject({ lastChangeBy: sub });

        const id = new ObjectId(created.id);
        const client = await MongoClient.connect(dbUrl);
        const db = client.db();
        const history = db.collection(collection + "History");
        try {
            const path = endpoint + "/" + created.id;
            const read = await request.get(path, { headers });
            expect(read.status()).toBe(200);
            expect(await read.json()).toEqual(created);

            const search = await request.post(endpoint + "/search", { headers, data: {
                options: { limit: 1, sort: [["current.lastChangeTimestamp", "desc"]] }
            } });
            expect(search.status()).toBe(200);
            expect(await search.json()).toEqual([created]);

            const write = await request.put(path, { headers, data: { ...created, ...update } });
            expect(write.status()).toBe(200);
            const updated = await write.json();
            expect(updated).toMatchObject({ ...update, id: created.id, lastChangeBy: sub });

            const remove = await request.delete(path, { headers, params: {
                lastChangeTimestamp: updated.lastChangeTimestamp.$date
            } });
            expect(remove.status()).toBe(200);
            expect((await request.get(path, { headers })).status()).toBe(404);
            const entries = await history.find({ id }).toArray();
            expect(entries).toHaveLength(2);
            expect(entries).toEqual(expect.arrayContaining([
                expect.objectContaining({ version: expect.objectContaining({ lastChangeBy: sub }) }),
                expect.objectContaining({ deleted: expect.objectContaining({ lastChangeBy: sub }) })
            ]));
        } finally {
            await db.collection(collection).deleteOne({ _id: id });
            await history.deleteMany({ id });
            await client.close();
        }
    });
}

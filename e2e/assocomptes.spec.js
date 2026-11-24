const { test, expect } = require("@playwright/test");
const { MongoClient, ObjectId } = require("mongodb");
const { execFileSync } = require("node:child_process");

const loginUrl = /^https:\/\/auth\.assocomptes\.localhost:18443\//;
const password = "local-e2e-password";
const dbUrl = "mongodb://127.0.0.1:27028/assocomptes_e2e";

async function signIn(page, username, path = "/") {
    await page.goto(path);
    await expect(page).toHaveURL(loginUrl);
    await page.locator("#username-textfield").fill(username);
    await page.locator("#password-textfield").fill(password);
    await page.locator("#sign-in-button").click();
    await expect(page.getByRole("link", { name: "Assocomptes" })).toBeVisible();
}

test("signs in through Authelia and signs out of the session", async ({ page }) => {
    await signIn(page, "editor");
    await page.getByText("Editor Example", { exact: true }).click();
    page.on("dialog", dialog => dialog.accept());
    await page.getByRole("link", { name: "Déconnexion" }).click();
    await expect(page).toHaveURL(loginUrl);
    await expect(page.locator("#sign-in-button")).toBeVisible();
    await page.goto("/");
    await expect(page.locator("#sign-in-button")).toBeVisible();
});

const forged = {
    "Remote-User": "editor",
    "Remote-Groups": "writePeople",
    "Remote-Name": "Forged Name",
    "Remote-Email": "forged@example.test"
};

test("rejects a direct backend request even with forged proxy and identity headers", () => {
    const headers = { ...forged, "X-Forwarded-For": "172.30.83.2" };
    const status = execFileSync("docker", ["compose", "-f", "compose.e2e.yml", "exec", "-T", "app", "node", "-e",
        `fetch("http://127.0.0.1:8080/api/profile", { headers: ${JSON.stringify(headers)} })
            .then(r => console.log(r.status), e => { console.error(e); process.exitCode = 1; })`
    ], { encoding: "utf8" });
    expect(status.trim()).toBe("401");
});

test("rejects anonymous API requests even when they send forged identity headers", async ({ request }) => {
    for (const headers of [{}, forged]) {
        const response = await request.get("/api/profile", {
            maxRedirects: 0, headers: { Accept: "application/json", ...headers }
        });
        expect(response.status()).toBe(401);
        expect(response.headers().location).toMatch(loginUrl);
    }
});

test("denies reader writes and header impersonation, and shows old and new audit authors", async ({ page, baseURL }) => {
    const headers = { Origin: baseURL };
    let newId;
    const oldId = new ObjectId();
    const sub = "d3f93b44-e225-4ab5-a29c-3ecc65b7dac0";
    const authorId = new ObjectId();
    const client = await MongoClient.connect(dbUrl);
    const db = client.db();
    try {
        await signIn(page, "editor");
        const response = await page.request.post("/api/people", { headers, data: { firstName: "ReadOnlyTestPerson" } });
        expect(response.status()).toBe(200);
        const created = await response.json();
        expect(created.lastChangeBy).toBe("editor");
        newId = new ObjectId(created.id);
        await db.collection("people").insertOne({
            _id: authorId, current: { firstName: "Audit", lastName: "Author", lastChangeTimestamp: new Date() }
        });
        const identities = [sub, "editor"].map(_id => ({ _id, id: authorId.toString() }));
        await db.collection("keycloakPeople").insertMany(identities);
        await db.collection("people").insertOne({
            _id: oldId, current: { firstName: "LegacyTestPerson", lastChangeBy: sub, lastChangeTimestamp: new Date() }
        });
        await page.context().clearCookies();
        await signIn(page, "reader", "/people/" + newId);
        expect((await page.request.get("/api/people/" + newId)).status()).toBe(200);
        expect((await page.request.post("/api/people", { headers, data: { firstName: "Denied" } })).status()).toBe(403);
        const impersonation = await page.request.get("/api/profile", { headers: forged });
        expect(impersonation.status()).toBe(200);
        expect(await impersonation.json()).toMatchObject({
            username: "reader", groups: ["readPeople", "readAccountSheets", "readDeposits"],
            name: "Reader Example", email: "reader@example.test"
        });
        expect((await page.request.post("/api/people", { headers: { ...headers, ...forged }, data: { firstName: "Denied" } })).status()).toBe(403);
        await expect(page.getByText("ReadOnlyTestPerson", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Audit Author", { exact: true })).toBeVisible();
        await expect(page.getByTitle("Modifier", { exact: true })).toHaveCount(0);
        await expect(page.getByTitle("Supprimer", { exact: true })).toHaveCount(0);
        await page.goto("/people/" + oldId);
        await expect(page.getByText("LegacyTestPerson", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Audit Author", { exact: true })).toBeVisible();
    } finally {
        await db.collection("keycloakPeople").deleteMany({ _id: { $in: [sub, "editor"] } });
        await db.collection("people").deleteMany({ _id: { $in: [authorId, oldId, ...(newId ? [newId] : [])] } });
        await client.close();
    }
});

test("rejects cookie-authenticated cross-origin writes and writes without an Origin", async ({ page }) => {
    await signIn(page, "editor");
    expect(await page.evaluate(async () => (await fetch("/api/people/search", {
        method: "POST", body: JSON.stringify({ options: { limit: 1 } })
    })).status)).toBe(200);
    for (const headers of [{ Origin: "https://other.example.test" }, {}]) {
        const result = await page.request.post("/api/people", {
            headers, data: { firstName: "Denied cross-origin" }, maxRedirects: 0
        });
        expect(result.status()).toBe(403);
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
    test("creates, searches, updates and deletes " + collection + " with audit history", async ({ page, baseURL }) => {
        await signIn(page, "editor");
        const request = page.request;
        const headers = { Origin: baseURL };
        const create = await request.post(endpoint, { headers, data: initial });
        expect(create.status()).toBe(200);
        const created = await create.json();
        expect(created).toMatchObject({ lastChangeBy: "editor" });

        const id = new ObjectId(created.id);
        const client = await MongoClient.connect(dbUrl);
        const db = client.db();
        const history = db.collection(collection + "History");
        try {
            const path = endpoint + "/" + created.id;
            const read = await request.get(path);
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
            expect(updated).toMatchObject({ ...update, id: created.id, lastChangeBy: "editor" });

            const remove = await request.delete(path, { headers, params: {
                lastChangeTimestamp: updated.lastChangeTimestamp.$date
            } });
            expect(remove.status()).toBe(200);
            expect((await request.get(path)).status()).toBe(404);
            const entries = await history.find({ id }).toArray();
            expect(entries).toHaveLength(2);
            expect(entries).toEqual(expect.arrayContaining([
                expect.objectContaining({ version: expect.objectContaining({ lastChangeBy: "editor" }) }),
                expect.objectContaining({ deleted: expect.objectContaining({ lastChangeBy: "editor" }) })
            ]));
        } finally {
            await db.collection(collection).deleteOne({ _id: id });
            await history.deleteMany({ id });
            await client.close();
        }
    });
}

function field(page, label) {
    return page.locator("label").and(page.getByText(label, { exact: true }))
        .locator("xpath=following-sibling::div[1]//input");
}

async function openNew(page, name) {
    await page.getByRole("link").filter({ hasText: name }).click();
    await expect(page).toHaveURL(/\/new\?/);
}

async function saveForm(page) {
    await page.getByRole("button").filter({ hasText: /^\s*Enregistrer\s*$/ }).click();
}

async function cancelEdit(page) {
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button").filter({ hasText: /^\s*Annuler\s*$/ }).click();
    await expect(page.getByTitle("Modifier", { exact: true })).toBeVisible();
}

async function deleteFromView(page) {
    const url = page.url();
    page.once("dialog", dialog => dialog.accept());
    await page.getByTitle("Supprimer", { exact: true }).click();
    await expect(page).not.toHaveURL(url);
    await page.goto(url);
    await expect(page.getByText("Le document demandé n'a pas pu être trouvé.")).toBeVisible();
}

test("creates, finds, edits, cancels and deletes a person in the UI", async ({ page }) => {
    const firstName = "Camille" + new ObjectId().toHexString();
    await signIn(page, "editor");
    await openNew(page, "Nouvelle personne");
    await saveForm(page);
    await expect(page.locator(".alert-danger")).toContainText("Vous devez préciser au moins un prénom");
    await expect(page).toHaveURL(/\/people\/new\?/);

    await field(page, "Prénom").fill(firstName);
    await field(page, "Nom").fill("Durand");
    await saveForm(page);
    await expect(page).toHaveURL(/\/people\/[\da-f]{24}$/);
    const url = page.url();
    await expect(page.getByRole("heading", { name: firstName + " Durand", exact: true })).toBeVisible();

    await page.getByTitle("Modifier", { exact: true }).click();
    await field(page, "Nom").fill("NomAnnulé");
    await cancelEdit(page);
    await expect(page.getByRole("heading", { name: firstName + " Durand", exact: true })).toBeVisible();
    await page.getByTitle("Modifier", { exact: true }).click();
    await expect(field(page, "Nom")).toHaveValue("Durand");
    await field(page, "Nom").fill("Martin");
    await saveForm(page);
    await expect(page.getByRole("heading", { name: firstName + " Martin", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: firstName + " Martin", exact: true })).toBeVisible();
    await page.goto("/");
    const search = page.locator(".navbar-form");
    await search.getByRole("textbox").fill(firstName);
    await search.getByRole("link").filter({ hasText: firstName + " Martin" }).click();
    await expect(page).toHaveURL(url);
    await deleteFromView(page);
});

async function searchReport(page, title) {
    await page.getByRole("link").filter({ hasText: title }).click();
    await field(page, "Date de début").fill("14/03/2020");
    await field(page, "Date de fin").fill("14/03/2020");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
}

test("creates and edits an account sheet and finds it in the accounts report", async ({ page }) => {
    await signIn(page, "editor");
    await openNew(page, "Nouvelle feuille de comptes");
    await field(page, "Date").fill("14/03/2020");
    const movement = page.locator(".form-group").filter({
        has: page.getByText("Mouvements de caisse", { exact: true })
    }).locator("xpath=following-sibling::div[1]");
    await movement.locator(".dropdown input").fill("RecetteE2E");
    await movement.locator("input").last().fill("0");
    await saveForm(page);
    await expect(page.locator(".alert-danger")).toContainText("La valeur doit être différente de 0.");
    await expect(page).toHaveURL(/\/accountSheets\/new\?/);

    await movement.locator("input").last().fill("24.50");
    await field(page, "Montant réel").fill("24.50");
    await saveForm(page);
    await expect(page).toHaveURL(/\/accountSheets\/[\da-f]{24}$/);
    const url = new URL(page.url());
    await expect(page.getByRole("cell", { name: "RecetteE2E", exact: true })).toBeVisible();

    await page.getByTitle("Modifier", { exact: true }).click();
    await page.locator("textarea").fill("Remarque de caisse E2E");
    await saveForm(page);
    await expect(page.getByText("Remarque de caisse E2E")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Remarque de caisse E2E")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "RecetteE2E" })).toContainText("24.50 €");

    await page.goto("/");
    await searchReport(page, "Rechercher dans les comptes");
    await expect(page.getByRole("heading", { name: "Résumé simplifié" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "RecetteE2E" }).first()).toContainText("24.50 €");
    await page.goto(url.href);
    await deleteFromView(page);
});

test("creates and edits a deposit and finds it in the deposits report", async ({ page }) => {
    await signIn(page, "editor");
    await openNew(page, "Nouveau dépôt");
    await field(page, "Date").fill("14/03/2020");
    await field(page, "Montant déclaré").fill("38.25");
    await saveForm(page);
    await expect(page.locator(".alert-danger")).toContainText("depositNumber: Ce champ est obligatoire.");
    await expect(page).toHaveURL(/\/deposits\/new\?/);

    await field(page, "Numéro").fill("DEP-E2E-001");
    await saveForm(page);
    await expect(page).toHaveURL(/\/deposits\/[\da-f]{24}$/);
    const url = new URL(page.url());
    await expect(page.getByRole("cell", { name: "DEP-E2E-001", exact: true })).toBeVisible();
    await page.getByTitle("Modifier", { exact: true }).click();
    await field(page, "Numéro").fill("DEP-E2E-002");
    await saveForm(page);
    await expect(page.getByRole("cell", { name: "DEP-E2E-002", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("cell", { name: "DEP-E2E-002", exact: true })).toBeVisible();

    await page.goto("/");
    await searchReport(page, "Rechercher dans les dépôts");
    const row = page.getByRole("row").filter({ hasText: "DEP-E2E-002" });
    await expect(row).toContainText("38.25 €");
    await row.locator(`a[href="${url.pathname}"]`).click();
    await expect(page).toHaveURL(url.href);
    await deleteFromView(page);
});

test("readers have no home creation shortcuts and cannot save a directly opened form", async ({ page }) => {
    await signIn(page, "reader");
    for (const name of ["Nouvelle personne", "Nouvelle feuille de comptes", "Nouveau dépôt"]) {
        await expect(page.getByRole("link").filter({ hasText: name })).toHaveCount(0);
    }

    await page.goto("/people/new");
    await field(page, "Prénom").fill("ReaderCannotCreate");
    await saveForm(page);
    await expect(page.locator(".alert-danger")).toContainText("Vous ne pouvez pas enregistrer ce document.");
    await expect(page).toHaveURL(/\/people\/new\?/);
});

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

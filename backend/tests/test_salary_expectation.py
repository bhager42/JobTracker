import io
import json
import zipfile

from fastapi.testclient import TestClient


def create(client: TestClient, **fields: object) -> dict[str, object]:
    res = client.post("/api/applications", json={"company": "Acme", "job_title": "Eng", **fields})
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


def test_set_update_and_clear(client: TestClient) -> None:
    app = create(client, salary_min=120000, salary_max=150000, salary_expectation=140000)
    assert app["salary_expectation"] == 140000
    url = f"/api/applications/{app['id']}"
    assert (
        client.patch(url, json={"salary_expectation": 145000}).json()["salary_expectation"]
        == 145000
    )
    assert client.patch(url, json={"salary_expectation": None}).json()["salary_expectation"] is None
    # Defaults to empty, and may sit outside the posted range (you can ask for more).
    assert create(client)["salary_expectation"] is None
    assert (
        create(client, salary_max=100000, salary_expectation=110000)["salary_expectation"] == 110000
    )


def test_validation(client: TestClient) -> None:
    for bad in (-1, 100_000_001, "lots"):
        res = client.post(
            "/api/applications",
            json={"company": "A", "job_title": "B", "salary_expectation": bad},
        )
        assert res.status_code == 422, bad


def test_listed_and_round_tripped_through_a_backup(client: TestClient) -> None:
    create(client, salary_expectation=150000)
    assert client.get("/api/applications").json()["items"][0]["salary_expectation"] == 150000
    zf = zipfile.ZipFile(io.BytesIO(client.get("/api/export").content))
    data = json.loads(zf.read("applications.json"))
    assert data["applications"][0]["salary_expectation"] == 150000
    assert "salary_expectation" in zf.read("applications.csv").decode("utf-8-sig").splitlines()[0]


def test_backups_from_before_the_field_still_import(client: TestClient) -> None:
    create(client, salary_expectation=150000)
    data = json.loads(
        zipfile.ZipFile(io.BytesIO(client.get("/api/export").content)).read("applications.json")
    )
    for app in data["applications"]:
        del app["salary_expectation"]  # as a 0.1.0/0.1.1 export
    client.delete("/api/applications/1")
    res = client.post("/api/import", files={"file": ("old.json", json.dumps(data).encode())})
    assert res.status_code == 200, res.text
    [app] = client.get("/api/applications").json()["items"]
    assert app["salary_expectation"] is None


def test_csv_maps_and_parses_it(client: TestClient) -> None:
    csv_text = "Company,Title,Expected salary\nAcme,Engineer,$150k\n"
    preview = client.post(
        "/api/import/csv/preview", files={"file": ("jobs.csv", csv_text.encode())}
    ).json()
    assert preview["suggested_mapping"]["salary_expectation"] == "Expected salary"
    assert "salary_expectation" in preview["fields"]
    res = client.post(
        "/api/import/csv",
        files={"file": ("jobs.csv", csv_text.encode())},
        data={"mapping": json.dumps(preview["suggested_mapping"])},
    )
    assert res.json()["created"] == 1
    assert client.get("/api/applications").json()["items"][0]["salary_expectation"] == 150000

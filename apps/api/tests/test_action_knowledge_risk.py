"""The GitHub Action (.github/actions/knowledge-risk): git history -> the same risk rules, CODEOWNERS, bots and
deleted files ignored, Markdown summary. Uses a throwaway git repo, no network."""

import importlib.util
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / ".github" / "actions" / "knowledge-risk" / "knowledge_risk.py"
spec = importlib.util.spec_from_file_location("knowledge_risk", SCRIPT)
kr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kr)


def _commit(repo: Path, author: str, files: dict[str, str]) -> None:
    for name, text in files.items():
        (repo / name).parent.mkdir(parents=True, exist_ok=True)
        (repo / name).write_text(text, encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", f"user.name={author}", "-c", f"user.email={author.split()[0].lower()}@x.test",
                    "commit", "-qm", f"change by {author}"], check=True)


def test_report_from_git_history(tmp_path):
    repo = tmp_path / "r"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    for i in range(6):
        _commit(repo, "Rohan D", {"deploy.yml": f"v{i}", "app.ts": f"a{i}"})
    for i in range(4):
        _commit(repo, "Neha K", {"app.ts": f"b{i}"})
    for i in range(6):
        _commit(repo, "dependabot[bot]", {"package.json": f"{i}"})
        _commit(repo, "Rohan D", {"old.txt": f"{i}"})
    (repo / "old.txt").unlink()
    _commit(repo, "Neha K", {".github/CODEOWNERS": "deploy.yml @rohan @neha\n"})

    rep = kr.build_report(str(repo), "", None, None)
    people = {p["person"]: p for p in rep["people"]}
    assert set(people) == {"rohan d"}  # app.ts is shared (6 vs 4), dependabot isn't a person
    files = {f["path"]: f for f in people["rohan d"]["sole_files"]}
    assert set(files) == {"deploy.yml"}  # old.txt was deleted, so it no longer counts
    assert files["deploy.yml"]["codeowners"] == ["@rohan", "@neha"] and people["rohan d"]["unowned_sole_files"] == 0
    md = kr.to_markdown(rep)
    assert "| rohan d |" in md and "CODEOWNERS: @rohan, @neha" in md and "no AI" in md


def test_codeowners_matching():
    rules = [("*.md", ["@docs"]), ("/src/", ["@core"]), ("src/billing/", ["@pay"])]
    assert kr.owners_for("README.md", rules) == ["@docs"]
    assert kr.owners_for("src/app.ts", rules) == ["@core"]
    assert kr.owners_for("src/billing/pay.ts", rules) == ["@pay"]  # last match wins, as on GitHub
    assert kr.owners_for("tests/x.py", rules) == []

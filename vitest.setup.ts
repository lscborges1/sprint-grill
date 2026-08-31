import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// O banco de runs é estado local: em teste, cada processo ganha um diretório
// temporário próprio — nenhum teste encosta no `.sprint-griller/` do repo.
if (process.env.VITEST) {
  process.env.SPRINT_GRILLER_INVESTIGATIONS_DB ??= path.join(
    mkdtempSync(path.join(tmpdir(), "refina-investigacoes-")),
    "investigacoes.db",
  );
}

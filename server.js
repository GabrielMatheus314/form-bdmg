const express = require("express");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const MAX_HTML_LENGTH = 2_000_000;

app.use(express.json({ limit: "8mb" }));

if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
}

app.use(express.static(__dirname));

function sanitizeFileName(fileName) {
  const raw = String(fileName || "").trim();
  const baseName = raw.replace(/\.pdf$/i, "") || "proposta-bdmg";
  const safe = baseName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);
  return `${safe || "proposta-bdmg"}.pdf`;
}

async function runLibreOfficeConvert(inputFilePath, outputDir) {
  const args = [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--nolockcheck",
    "--convert-to",
    "pdf:writer_pdf_Export",
    "--outdir",
    outputDir,
    inputFilePath
  ];

  const commands = ["soffice", "libreoffice"];
  for (const command of commands) {
    try {
      await execFileAsync(command, args, {
        timeout: 90000,
        maxBuffer: 10 * 1024 * 1024
      });
      return;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  const notFoundError = new Error(
    "LibreOffice nao encontrado no servidor. Instale o pacote e garanta o binario 'soffice' no PATH."
  );
  notFoundError.code = "LIBREOFFICE_NOT_FOUND";
  throw notFoundError;
}

app.get("/api-bdmg/health", (_req, res) => {
  res.json({ ok: true, service: "pdf-export" });
});

app.post("/api-bdmg/exportar-form-pdf", async (req, res) => {
  const html = typeof req.body?.html === "string" ? req.body.html : "";
  const requestedFileName = typeof req.body?.fileName === "string" ? req.body.fileName : "proposta-bdmg.pdf";

  if (!html.trim()) {
    res.status(400).json({ error: "Campo 'html' e obrigatorio." });
    return;
  }

  if (html.length > MAX_HTML_LENGTH) {
    res.status(413).json({ error: "HTML excede o limite permitido." });
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdmg-pdf-"));
  const inputFilePath = path.join(tempDir, "proposta.html");
  const outputFilePath = path.join(tempDir, "proposta.pdf");

  try {
    await fs.writeFile(inputFilePath, html, "utf8");
    await runLibreOfficeConvert(inputFilePath, tempDir);

    const pdfBuffer = await fs.readFile(outputFilePath);
    const safeFileName = sanitizeFileName(requestedFileName);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    if (error && error.code === "LIBREOFFICE_NOT_FOUND") {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: "Falha ao converter HTML em PDF com LibreOffice."
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});

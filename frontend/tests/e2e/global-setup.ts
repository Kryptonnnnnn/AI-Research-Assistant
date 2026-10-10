import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const backend = path.resolve(__dirname, "../../../backend");
const py = path.join(backend, ".venv/bin/python");

/** Generates the text-based PDF fixture (the database is prepared by start-backend.sh). */
export default async function globalSetup() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ara-fixture-"));
  // Text-based PDF fixture (page 1 filler, page 2 on photosynthesis) generated with the backend's reportlab.
  const script = `
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
pages = [
  ["Introduction to the study of plants and their environment.", "This page contains general background and nothing else of interest."],
  ["Photosynthesis converts light energy into chemical energy stored in glucose.", "Chlorophyll in the chloroplasts absorbs red and blue light most strongly.", "The light-dependent reactions produce ATP and NADPH, which power the Calvin cycle."],
]
cv = canvas.Canvas(sys.argv[1], pagesize=A4)
for lines in pages:
    y = 800
    for line in lines:
        cv.drawString(60, y, line); y -= 18
    cv.showPage()
cv.save()
`;
  const fixtures = path.resolve(__dirname, "fixtures");
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(path.join(tmp, "gen_pdf.py"), script);
  execFileSync(py, ["-I", path.join(tmp, "gen_pdf.py"), path.join(fixtures, "plants.pdf")]);
}

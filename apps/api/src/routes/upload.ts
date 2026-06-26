import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { importExcel } from '../importers/excelImporter';
import { extractPdfData } from '../importers/pdfImporter';
import { getDb } from '../db/schema';

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    cb(null, `${ts}_${file.originalname}`);
  },
});

const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/pdf',
]);

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.xlsx', '.xls', '.csv', '.pdf'];
    if (allowed.includes(ext) || ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Allowed: xlsx, csv, pdf`));
    }
  },
});

const router = Router();

// Detect if columns look like our template
function isTemplateFormat(headers: string[]): boolean {
  const required = ['ResourceID', 'CR_ID', 'Year', 'WeekNumber'];
  const upper = headers.map((h) => h.trim());
  return required.every((r) => upper.includes(r));
}

// POST /api/upload — upload a file and import it
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    if (ext === '.pdf') {
      // PDF: extract raw data and return for column mapping or AI parsing
      const rawData = await extractPdfData(filePath);
      const needsMapping = !isTemplateFormat(rawData.headers);
      return res.json({
        format: 'pdf',
        needsMapping,
        headers: rawData.headers,
        sampleRows: rawData.rows.slice(0, 5),
        filePath,
        text: rawData.text.slice(0, 2000), // snippet for display
      });
    }

    // Excel / CSV: try direct import
    const result = importExcel(filePath);

    // Check if any sheet had data — if no rows and no errors it's likely a foreign format
    const totalRows = result.rowsAdded + result.rowsUpdated;
    if (totalRows === 0 && result.errors.length === 0) {
      // Try to peek at headers to offer column mapping
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];
      const headers = rows[0] || [];
      return res.json({
        format: ext.replace('.', ''),
        needsMapping: true,
        headers,
        sampleRows: rows.slice(1, 6),
        filePath,
        importResult: result,
      });
    }

    return res.json({
      format: ext.replace('.', ''),
      needsMapping: false,
      importResult: result,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/upload/apply-mapping — apply a column mapping and re-import
router.post('/apply-mapping', async (req: Request, res: Response) => {
  const { filePath, mapping, weekYear, weekNumber } = req.body as {
    filePath: string;
    mapping: Record<string, string>; // sourceCol -> templateCol
    weekYear: number;
    weekNumber: number;
  };

  if (!filePath || !mapping) {
    return res.status(400).json({ error: 'filePath and mapping required' });
  }

  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(firstSheet) as Record<string, unknown>[];

    // Remap column names
    const remapped = rawRows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [srcCol, value] of Object.entries(row)) {
        const targetCol = mapping[srcCol];
        if (targetCol) out[targetCol] = value;
        else out[srcCol] = value; // keep unmapped cols too
      }
      // Inject year/week if not present
      if (!out['Year'] && weekYear) out['Year'] = weekYear;
      if (!out['WeekNumber'] && weekNumber) out['WeekNumber'] = weekNumber;
      return out;
    });

    // Write remapped data to a temp xlsx and import it
    const newWb = XLSX.utils.book_new();
    const newWs = XLSX.utils.json_to_sheet(remapped);
    XLSX.utils.book_append_sheet(newWb, newWs, 'Weekly_Log');

    const tempPath = filePath + '_mapped.xlsx';
    XLSX.writeFile(newWb, tempPath);

    const result = importExcel(tempPath);
    fs.unlinkSync(tempPath);

    // Save the mapping for re-use
    const db = getDb();
    const pattern = require('path').basename(filePath).replace(/^\d+_/, '').replace(/\.[^.]+$/, '');
    db.prepare(`INSERT OR REPLACE INTO column_mappings (pattern, mapping_json, created_at) VALUES (?, ?, ?)`)
      .run(pattern, JSON.stringify(mapping), new Date().toISOString());

    return res.json({ importResult: result });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/upload/mappings — saved column mappings
router.get('/mappings', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM column_mappings ORDER BY created_at DESC').all();
  res.json(rows);
});

export default router;

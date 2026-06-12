const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ExifParser = require('exif-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Persistente Speicherung
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const uploadsDir = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

let catches = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    catches = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`📦 ${catches.length} Fänge geladen`);
  }
} catch (e) {
  console.error('Konnte data.json nicht laden:', e.message);
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(catches, null, 2));
  } catch (e) {
    console.error('Konnte data.json nicht speichern:', e.message);
  }
}

// Multer Config (Foto-Upload)
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilder erlaubt'));
    }
  }
});

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname, { index: 'index.html' }));

// EXIF-Aufnahmedatum auslesen
function readPhotoDate(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const result = ExifParser.create(buffer).parse();
    const ts = result.tags.DateTimeOriginal || result.tags.CreateDate || result.tags.DateTime;
    if (ts) {
      const d = new Date(ts * 1000);
      if (!isNaN(d)) {
        return d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
      }
    }
  } catch (e) { /* kein EXIF vorhanden */ }
  return null;
}

// API: Fang eintragen (Foto Pflicht)
app.post('/api/catches', upload.single('photo'), (req, res) => {
  const { angler, fishType, length, weight, notes } = req.body;

  if (!angler || !fishType || !length || !req.file) {
    return res.status(400).json({ error: 'Fehlende Daten (Angler, Fischart, Länge und Foto sind Pflicht)' });
  }

  const photoPath = path.join(uploadsDir, req.file.filename);
  const photoDate = readPhotoDate(photoPath);

  const newCatch = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    angler,
    fishType,
    length: parseInt(length, 10),
    weight: weight ? parseFloat(weight) : null,
    notes: (notes || '').trim(),
    photo: `/uploads/${req.file.filename}`,
    date: new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
    photoDate: photoDate,
    createdAt: Date.now()
  };

  catches.push(newCatch);
  saveData();
  res.json(newCatch);
});

// API: Alle Fänge
app.get('/api/catches', (req, res) => {
  res.json(catches);
});

// API: Fang löschen
app.delete('/api/catches/:id', (req, res) => {
  const catchToDelete = catches.find(c => c.id === req.params.id);
  if (!catchToDelete) {
    return res.status(404).json({ error: 'Nicht gefunden' });
  }

  try {
    const photoFile = path.join(uploadsDir, path.basename(catchToDelete.photo));
    if (fs.existsSync(photoFile)) fs.unlinkSync(photoFile);
  } catch (e) { /* Foto-Löschung optional */ }

  catches = catches.filter(c => c.id !== req.params.id);
  saveData();
  res.json({ success: true });
});

// Health-Check (für Uptime-Pings)
app.get('/health', (req, res) => res.json({ ok: true, catches: catches.length }));

app.listen(PORT, () => {
  console.log(`🎣 Angel Challenge Server läuft auf Port ${PORT}`);
});

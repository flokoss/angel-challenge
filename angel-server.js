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
    // Atomar schreiben: erst temp-Datei, dann umbenennen — data.json kann nie halb geschrieben sein
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(catches, null, 2));
    fs.renameSync(tmp, DATA_FILE);
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

// Mindestmaße (exakt aus dem Original-Sheet, 0 = "keins")
const MIN_SIZES = {
  'Aal': 50, 'Äsche': 35, 'Bachforelle': 30, 'Bachsaibling': 30, 'Barbe': 0,
  'Barsch': 20, 'Brasse': 20, 'Döbel': 20, 'Dorsch': 38, 'Flunder': 20,
  'Graskarpfen': 60, 'Grundel': 0, 'Gründling': 0, 'Güster': 20, 'Hecht': 50,
  'Hering': 0, 'Hornhecht': 0, 'Karpfen': 35, 'Kliesche': 0, 'Köhler (Seelachs)': 0,
  'Lachs': 60, 'Makrele': 0, 'Meerforelle': 40, 'Pollack': 0, 'Quappe': 0,
  'Rapfen': 50, 'Reg.-Forelle': 30, 'Rotauge': 20, 'Rotfeder': 20, 'Scholle': 25,
  'Schleie': 25, 'Steinbutt': 30, 'Stint': 0, 'Ukelei': 0, 'Wels': 70,
  'Wittling': 23, 'Wolfsbarsch': 42, 'Zander': 45
};

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

// API: Fang eintragen (Messfoto Pflicht + optionale weitere Fangfotos)
const catchUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'extraPhotos', maxCount: 5 }
]);

app.post('/api/catches', catchUpload, (req, res) => {
  const { angler, fishType, length, weight, notes, deviceId } = req.body;
  const mainPhoto = req.files && req.files.photo && req.files.photo[0];
  const extraPhotos = (req.files && req.files.extraPhotos) || [];
  const allFiles = [mainPhoto, ...extraPhotos].filter(Boolean);

  function cleanupFiles() {
    allFiles.forEach(f => {
      try { fs.unlinkSync(path.join(uploadsDir, f.filename)); } catch (e) { }
    });
  }

  if (!angler || !fishType || !length || !mainPhoto) {
    cleanupFiles();
    return res.status(400).json({ error: 'Fehlende Daten (Angler, Fischart, Länge und Messfoto sind Pflicht)' });
  }

  // Regel 4: Mindestmaß serverseitig prüfen — untermaßige Einträge ablehnen
  const minSize = MIN_SIZES[fishType] || 0;
  if (parseInt(length, 10) < minSize) {
    cleanupFiles();
    return res.status(400).json({ error: `Mindestmaß für ${fishType}: ${minSize} cm — Eintrag abgelehnt` });
  }

  const photoPath = path.join(uploadsDir, mainPhoto.filename);
  const photoDate = readPhotoDate(photoPath);
  const photos = allFiles.map(f => `/uploads/${f.filename}`);

  const newCatch = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    angler,
    fishType,
    length: parseInt(length, 10),
    weight: weight ? parseFloat(weight) : null,
    notes: (notes || '').trim(),
    photo: photos[0],
    photos: photos,
    date: new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
    photoDate: photoDate,
    createdAt: Date.now(),
    deviceId: deviceId || null
  };

  catches.push(newCatch);
  saveData();
  const { deviceId: _d, ...publicCatch } = newCatch;
  res.json(publicCatch);
});

// API: Alle Fänge (ohne deviceId — die bleibt geheim)
app.get('/api/catches', (req, res) => {
  res.json(catches.map(({ deviceId, ...c }) => c));
});

// API: Fang löschen — nur vom eigenen Gerät
app.delete('/api/catches/:id', (req, res) => {
  const catchToDelete = catches.find(c => c.id === req.params.id);
  if (!catchToDelete) {
    return res.status(404).json({ error: 'Nicht gefunden' });
  }

  const requesterDevice = req.query.deviceId || '';
  if (catchToDelete.deviceId && catchToDelete.deviceId !== requesterDevice) {
    return res.status(403).json({ error: 'Du kannst nur deine eigenen Fänge löschen' });
  }

  const allPhotos = catchToDelete.photos && catchToDelete.photos.length ? catchToDelete.photos : [catchToDelete.photo];
  allPhotos.forEach(p => {
    try {
      const photoFile = path.join(uploadsDir, path.basename(p));
      if (fs.existsSync(photoFile)) fs.unlinkSync(photoFile);
    } catch (e) { /* Foto-Löschung optional */ }
  });

  catches = catches.filter(c => c.id !== req.params.id);
  saveData();
  res.json({ success: true });
});

// Health-Check (für Uptime-Pings)
app.get('/health', (req, res) => res.json({ ok: true, catches: catches.length }));

app.listen(PORT, () => {
  console.log(`🎣 Angel Challenge Server läuft auf Port ${PORT}`);
});

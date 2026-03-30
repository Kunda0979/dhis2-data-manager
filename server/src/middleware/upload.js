const multer = require('multer');
const path = require('path');

const MAX_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50', 10);
const effectiveMaxSize = Number.isFinite(MAX_SIZE_MB) && MAX_SIZE_MB > 0 ? MAX_SIZE_MB : 50;

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/json',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.json', '.csv', '.xlsx', '.xls'];

  if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload JSON, CSV, or Excel files.`), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: effectiveMaxSize * 1024 * 1024 },
  fileFilter,
});

module.exports = upload;

require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const pool = require("./db");

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// 🔧 Multer Setup
const storage = multer.diskStorage({
  destination: "./uploads/songs",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// 🔐 Signup
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
    [email, hash]
  );
  res.json({ user: result.rows[0] });
});

// 🔓 Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  if (result.rows.length === 0) return res.status(401).json({ error: "User not found" });

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid password" });

  res.json({ user: { id: user.id, email: user.email } });
});

// 🎵 Upload Song with Metadata Auto-Fill
app.post("/api/upload/song", upload.single("song"), async (req, res) => {
  try {
    const file = req.file;
    const filePath = path.resolve(file.path);
    const filename = path.parse(file.originalname).name;
    const userId = req.body.userId;

    // Parse metadata from uploaded song
    const mm = await import("music-metadata");
    const metadata = await mm.parseFile(filePath);

    const title = metadata.common.title || req.body.title || filename;
    const artist = metadata.common.artist || req.body.artist || "Unknown Artist";
    const album = metadata.common.album || req.body.album || "Unknown Album";
    const genre = metadata.common.genre?.[0] || req.body.genre || "Unknown";
    const language = req.body.language;
    const bitrate = metadata.format.bitrate || 0;
    const duration = metadata.format.duration || 0;

    // 🔥 Save thumbnail if present
    let thumbnailPath = null;
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const cover = metadata.common.picture[0];
      const coverFileName = `${Date.now()}-${filename}-cover.jpg`;
      const coverDir = path.join(__dirname, "uploads", "covers");
      if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });
      thumbnailPath = `uploads/covers/${coverFileName}`;
      fs.writeFileSync(path.join(__dirname, thumbnailPath), cover.data);
    }

    // 💾 Save to PostgreSQL
    await pool.query(
      `INSERT INTO songs 
      (title, artist, album, mood, genre, language, filepath, user_id, bitrate, duration, thumbnail) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        title,
        artist,
        album,
        req.body.mood || "",
        genre,
        language,
        file.path,
        userId,
        bitrate,
        duration,
        thumbnailPath,
      ]
    );

    res.json({ success: true, message: "Song uploaded with metadata!" });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
  app.get("/api/playlists", async (req, res) => {
  const userId = req.query.userId;
  const result = await pool.query(
    "SELECT id, name FROM playlists WHERE user_id = $1",
    [userId]
  );
  res.json(result.rows);
});
app.post("/api/song/play", async (req, res) => {
  const { userId, songId } = req.body;

  await pool.query(
    "INSERT INTO history (user_id, song_id) VALUES ($1, $2)",
    [userId, songId]
  );

  res.json({ success: true });
});
app.get("/api/user/recommendations", async (req, res) => {
  const { userId } = req.query;

  // Get last 3 songs from history
  const recent = await pool.query(
    `SELECT s.mood FROM history h 
     JOIN songs s ON s.id = h.song_id 
     WHERE h.user_id = $1 
     ORDER BY h.played_at DESC LIMIT 3`,
    [userId]
  );

  const moods = [...new Set(recent.rows.map((row) => row.mood))];

  // Recommend songs that match any of the recent moods
  const result = await pool.query(
    `SELECT * FROM songs 
     WHERE mood = ANY($1::text[]) 
     ORDER BY RANDOM() LIMIT 10`,
    [moods]
  );

  res.json(result.rows);
});

});

app.listen(5000, () => console.log("✅ Backend running on http://localhost:5000"));

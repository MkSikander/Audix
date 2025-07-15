const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "audix_db",
  password: "mk", // 🔁 Change this
  port: 5432,
});

module.exports = pool;
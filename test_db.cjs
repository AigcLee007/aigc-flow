const mysql = require("mysql2/promise");

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: "127.0.0.1",
      port: 3306,
      user: "root",
      password: "",
    });
    console.log("SUCCESS blank password");
    await conn.end();
  } catch (err) {
    console.error("ERROR blank:", err.message);
  }
})();

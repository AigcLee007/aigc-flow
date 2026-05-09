const auth = require("./authStore.file.cjs");

(async () => {
  try {
    const res = await auth.registerWithPassword({
      email: "test@example.com",
      password: "password123",
      displayName: "Test User"
    });
    console.log("SUCCESS:", res);
  } catch (err) {
    console.error("ERROR:", err);
  }
})();
